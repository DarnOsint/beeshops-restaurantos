/**
 * api/cron/returns-expiry.js
 * Runs daily (Vercel Hobby allows only daily crons). A station (bar / kitchen / grill) accepting a return only takes the
 * item off the waitron's bill provisionally — management has 24 hours to confirm.
 * Anything still unconfirmed after that goes back on the waitron's bill.
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1000
const STATION_ACCEPTED = ['bar_accepted', 'kitchen_accepted', 'griller_accepted']

export default async function handler(req, res) {
  const isCron = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`
  const isInternal = req.headers['x-internal-secret'] === process.env.INTERNAL_API_SECRET
  if (!isCron && !isInternal) return res.status(401).json({ error: 'Unauthorized' })

  const cutoff = new Date(Date.now() - APPROVAL_WINDOW_MS).toISOString()

  try {
    const { data: stale, error } = await supabase
      .from('returns_log')
      .select('id, order_id, order_item_id, item_name, quantity, status, waitron_id')
      .in('status', STATION_ACCEPTED)
      .lt('resolved_at', cutoff)

    if (error) throw error
    if (!stale || stale.length === 0) return res.json({ expired: 0, orders: 0 })

    const orderIds = new Set()
    let expired = 0

    for (const row of stale) {
      const { error: itemErr } = await supabase
        .from('order_items')
        .update({
          return_accepted: false,
          return_requested: false,
          return_reason: null,
          return_accepted_at: null,
          return_requested_at: null,
        })
        .eq('id', row.order_item_id)
      if (itemErr) {
        console.error('returns-expiry: item restore failed', row.id, itemErr.message)
        continue
      }

      const { error: logErr } = await supabase
        .from('returns_log')
        .update({
          status: 'expired',
          reviewed: true,
          reviewed_by_name: 'Auto — not confirmed within 24h',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      if (logErr) {
        console.error('returns-expiry: log update failed', row.id, logErr.message)
        continue
      }

      if (row.order_id) orderIds.add(row.order_id)
      expired++
    }

    // Recompute totals for the affected orders so the returned value is billable again
    for (const orderId of orderIds) {
      const { data: items, error: itemsErr } = await supabase
        .from('order_items')
        .select('total_price, extra_charge, status, return_accepted')
        .eq('order_id', orderId)
      if (itemsErr) {
        console.error('returns-expiry: total recalc failed', orderId, itemsErr.message)
        continue
      }
      const total = (items || [])
        .filter((i) => (i.status || '').toLowerCase() !== 'cancelled' && !i.return_accepted)
        .reduce((s, i) => s + (i.total_price || 0) + (i.extra_charge || 0), 0)
      await supabase
        .from('orders')
        .update({ total_amount: total, updated_at: new Date().toISOString() })
        .eq('id', orderId)
    }

    return res.json({ expired, orders: orderIds.size })
  } catch (e) {
    console.error('returns-expiry failed:', e)
    return res.status(500).json({ error: e.message || 'returns-expiry failed' })
  }
}
