/**
 * api/cron/weekly-summary.js
 * Vercel cron job — runs every Monday at 08:00 WAT.
 * Sends a weekly summary to the owner, starting with low-stock items.
 *
 * vercel.json schedule: "0 7 * * 1"
 *
 * Required environment variables:
 *   VITE_SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — Supabase service role key (bypasses RLS)
 *   RESEND_API_KEY             — Resend.com API key
 *   REPORT_EMAIL               — Owner's email address
 *   CRON_SECRET                — Vercel cron secret
 */

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const resend = new Resend(process.env.RESEND_API_KEY)

function fmt(n) {
  return `₦${Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function pct(num, den) {
  if (!den) return '0%'
  return `${Math.round((num / den) * 100)}%`
}

function section(title, icon, content, borderColor = '#e5e7eb') {
  return `
  <div style="background:white;border-radius:12px;padding:20px 24px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);border-top:3px solid ${borderColor};">
    <h3 style="margin:0 0 14px;color:#111827;font-size:14px;font-weight:700;">${icon} ${title}</h3>
    ${content}
  </div>`
}

function kpiRow(items) {
  return `<div style="display:grid;grid-template-columns:${Array(items.length).fill('1fr').join(' ')};gap:10px;">${items.join('')}</div>`
}

function kpiBox(label, value, color = '#111827', note = '') {
  return `<div style="background:#f9fafb;border-radius:10px;padding:14px 16px;">
    <div style="color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">${label}</div>
    <div style="color:${color};font-size:20px;font-weight:800;margin-top:4px;">${value}</div>
    ${note ? `<div style="color:#9ca3af;font-size:11px;margin-top:2px;">${note}</div>` : ''}
  </div>`
}

function buildTable(headers, rows, emptyMsg = 'No data') {
  if (!rows.length) return `<p style="color:#9ca3af;font-size:12px;margin:4px 0;">${emptyMsg}</p>`
  const ths = headers.map(h =>
    `<th style="text-align:${h.right ? 'right' : 'left'};color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;padding:6px 0;border-bottom:1px solid #e5e7eb;font-weight:600;">${h.label}</th>`
  ).join('')
  const trs = rows.map(row =>
    `<tr>${row.map((cell, i) =>
      `<td style="text-align:${headers[i]?.right ? 'right' : 'left'};padding:7px 0;border-bottom:1px solid #f3f4f6;color:#374151;font-size:12px;">${cell}</td>`
    ).join('')}</tr>`
  ).join('')
  return `<table style="width:100%;border-collapse:collapse;"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`
}

// Monday 08:00 WAT → fetch the past 7 days: previous Monday 08:00 WAT to Monday 08:00 WAT
function getWeekWindowWAT() {
  const now = new Date()
  const watNow = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  const end = new Date(watNow)
  end.setHours(8, 0, 0, 0)
  // If before 8am, the week starts one day earlier
  const start = new Date(end)
  start.setDate(start.getDate() - 7)
  const labelStart = start.toLocaleDateString('en-NG', { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'Africa/Lagos' })
  const labelEnd = end.toLocaleDateString('en-NG', { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'Africa/Lagos' })
  const y = start.getFullYear()
  const m = String(start.getMonth() + 1).padStart(2, '0')
  const d = String(start.getDate()).padStart(2, '0')
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label: `${labelStart} — ${labelEnd}`,
    short: `${d}/${m}/${y}`,
  }
}

export default async function handler(req, res) {
  const isCron     = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`
  const isInternal = req.headers['x-internal-secret'] === process.env.INTERNAL_API_SECRET
  if (!isCron && !isInternal) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const { start, end, label, short } = getWeekWindowWAT()

    const [
      { data: orders },
      { data: orderItems },
      { data: returnsLog },
      { data: payouts },
      { data: attendance },
      { data: debtors },
      { data: inventory },
      { data: roomStays },
      { data: reservations },
    ] = await Promise.all([
      supabase.from('orders').select('*, profiles(full_name), tables(name, table_categories(name)), covers, order_items(total_price, return_requested, return_accepted, status)').gte('created_at', start).lte('created_at', end),
      supabase.from('order_items').select('*, menu_items(name, menu_categories(name))').gte('created_at', start).lte('created_at', end).neq('status', 'cancelled'),
      supabase.from('returns_log').select('*').gte('requested_at', start).lte('requested_at', end),
      supabase.from('payouts').select('*').gte('created_at', start).lte('created_at', end),
      supabase.from('attendance').select('*'),
      supabase.from('debtors').select('*').gt('balance', 0),
      supabase.from('inventory').select('*').eq('is_active', true),
      supabase.from('room_stays').select('*').gte('created_at', start).lte('created_at', end),
      supabase.from('reservations').select('*').gte('created_at', start).lte('created_at', end),
    ])

    // ── LOW STOCK ITEMS (featured first) ──
    const lowStockItems = (inventory || [])
      .filter(i => (i.current_stock || 0) > 0 && (i.current_stock || 0) <= (i.minimum_stock || 0))
      .sort((a, b) => (a.current_stock / a.minimum_stock) - (b.current_stock / b.minimum_stock))

    const outOfStockItems = (inventory || []).filter(i => (i.current_stock || 0) <= 0)

    // Build a 6-column grid: 3 items per row, each cell = item name + remaining count
    const lowStockGridRows = []
    for (let i = 0; i < lowStockItems.length; i += 3) {
      const cells = lowStockItems.slice(i, i + 3).map(item => `
        <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;vertical-align:top;width:33.33%;">
          <div style="font-size:13px;font-weight:600;color:#111827;">${item.item_name}</div>
          <div style="font-size:11px;color:#d97706;margin-top:2px;">
            <span style="font-weight:700;">${item.current_stock}</span> left
            <span style="color:#9ca3af;">(min: ${item.minimum_stock} ${item.unit})</span>
          </div>
        </td>
      `).join('')
      // Pad empty cells if fewer than 3 items in this row
      const remaining = 3 - (lowStockItems.slice(i, i + 3).length)
      const emptyCells = remaining > 0 ? '<td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;" colspan="1"></td>'.repeat(remaining) : ''
      lowStockGridRows.push(`<tr>${cells}${emptyCells}</tr>`)
    }

    const lowStockHtml = lowStockItems.length > 0
      ? `<table style="width:100%;border-collapse:collapse;">${lowStockGridRows.join('')}</table>`
      : `<p style="color:#059669;font-size:13px;font-weight:600;margin:4px 0;">All items are sufficiently stocked.</p>`

    const outOfStockHtml = outOfStockItems.length > 0
      ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin-bottom:12px;">
          <div style="color:#dc2626;font-weight:700;font-size:12px;margin-bottom:6px;">🔴 Out of Stock (${outOfStockItems.length})</div>
          ${outOfStockItems.slice(0, 15).map(i => `<div style="color:#374151;font-size:12px;padding:2px 0;">• ${i.item_name}</div>`).join('')}
          ${outOfStockItems.length > 15 ? `<div style="color:#9ca3af;font-size:11px;margin-top:4px;">...and ${outOfStockItems.length - 15} more</div>` : ''}
        </div>`
      : ''

    // ── WEEKLY REVENUE ──
    const netOrderAmount = (o) => (o.order_items || [])
      .filter(i => !i.return_requested && !i.return_accepted && (i.status || '').toLowerCase() !== 'cancelled')
      .reduce((s, i) => s + (i.total_price || 0), 0)

    const paid     = (orders || []).filter(o => o.status === 'paid')
    const totalRev = paid.reduce((s, o) => s + netOrderAmount(o), 0)
    const avgOrder = paid.length ? totalRev / paid.length : 0

    // Top items
    const itemMap = {}
    for (const item of (orderItems || [])) {
      if (!item.menu_items) continue
      if (item.return_requested || item.return_accepted) continue
      if ((item.status || '').toLowerCase() === 'cancelled') continue
      const k = item.menu_item_id
      if (!itemMap[k]) itemMap[k] = { name: item.menu_items.name, category: item.menu_items.menu_categories?.name || '—', qty: 0, rev: 0 }
      itemMap[k].qty  += item.quantity || 1
      itemMap[k].rev  += item.total_price || (item.unit_price || 0) * (item.quantity || 1)
    }
    const topItems = Object.values(itemMap).sort((a, b) => b.qty - a.qty).slice(0, 10)

    // Payment methods
    function classifyMethod(pm) {
      if (!pm) return 'transfer'
      if (pm === 'cash') return 'cash'
      if (pm === 'card' || pm === 'bank_pos') return 'pos'
      if (pm.startsWith('transfer')) return 'transfer'
      if (pm === 'credit') return 'credit'
      if (pm === 'split') return 'split'
      if (pm.startsWith('cash+transfer')) return 'cash+transfer'
      if (pm.startsWith('cash+card')) return 'cash+pos'
      if (pm === 'complimentary') return 'complimentary'
      return pm
    }
    const methodLabels = {
      cash:'Cash', pos:'POS / Card', transfer:'Transfer', credit:'Credit',
      split:'Split', 'cash+transfer':'Cash + Transfer', 'cash+pos':'Cash + POS',
      complimentary:'Complimentary',
    }
    const methodGroups = {}
    for (const o of paid) {
      const key = classifyMethod(o.payment_method)
      if (!methodGroups[key]) methodGroups[key] = { count: 0, revenue: 0 }
      methodGroups[key].count++
      methodGroups[key].revenue += netOrderAmount(o)
    }

    // Debtors
    const totalDebt  = (debtors || []).reduce((s, d) => s + (d.balance || 0), 0)
    const overdue    = (debtors || []).filter(d => {
      const ref = d.last_payment_date ? new Date(d.last_payment_date) : new Date(d.created_at)
      return (Date.now() - ref.getTime()) / 86400000 > 30
    })

    // Returns
    const acceptedReturns = (returnsLog || []).filter(r => ['accepted','bar_accepted','kitchen_accepted','griller_accepted'].includes(r.status))
    const totalReturnVal  = acceptedReturns.reduce((s, r) => s + (r.item_total || 0), 0)

    // Rooms
    const roomRevenue = (roomStays || []).reduce((s, r) => s + (r.total_amount || 0), 0)
    const nookBookings = (reservations || []).filter(r => r.zone === 'The Nook' || r.area === 'nook')
    const nookRevenue  = nookBookings.reduce((s, r) => s + (r.hire_fee || 0), 0)

    const grandTotal = totalRev + roomRevenue
    const paidCount  = paid.length

    // ── BUILD HTML ──
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;margin:0;padding:20px;">
<div style="max-width:640px;margin:0 auto;">

  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border-radius:14px;padding:28px;margin-bottom:16px;">
    <div style="color:#f59e0b;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">🍺 Beeshop's Place Lounge</div>
    <div style="color:white;font-size:22px;font-weight:800;">Weekly Summary</div>
    <div style="color:#94a3b8;font-size:13px;margin-top:4px;">${label}</div>
    <div style="margin-top:20px;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:16px 20px;display:inline-block;">
      <div style="color:#fbbf24;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Weekly Grand Total Revenue</div>
      <div style="color:white;font-size:32px;font-weight:900;letter-spacing:-1px;margin-top:4px;">${fmt(grandTotal)}</div>
      <div style="color:#94a3b8;font-size:11px;margin-top:2px;">${paidCount} paid orders · avg ${fmt(avgOrder)}</div>
    </div>
  </div>

  ${section('🔴 Low Stock Items — Needs Immediate Attention', '📦', `
    ${outOfStockHtml}
    ${lowStockHtml}
    ${lowStockItems.length > 0 ? `<p style="color:#6b7280;font-size:11px;margin-top:8px;">${lowStockItems.length} item(s) running low · ${outOfStockItems.length} out of stock</p>` : ''}
  `, '#ef4444')}

  ${section('Revenue Overview', '💰', `
    ${kpiRow([kpiBox('Total Revenue', fmt(totalRev), '#059669'), kpiBox('Room Revenue', fmt(roomRevenue), '#2563eb'), kpiBox('Nook Hire', fmt(nookRevenue), '#7c3aed')])}
    <div style="height:10px;"></div>
    ${kpiRow([kpiBox('Paid Orders', paidCount), kpiBox('Avg Per Order', fmt(avgOrder)), kpiBox('Returned Value', fmt(totalReturnVal), totalReturnVal > 0 ? '#dc2626' : '#059669')])}
  `, '#059669')}

  ${section('Payment Methods Breakdown', '💳', buildTable(
    [{ label: 'Method' }, { label: 'Orders' }, { label: 'Amount', right: true }, { label: '%', right: true }],
    Object.entries(methodGroups).sort((a, b) => b[1].revenue - a[1].revenue).map(([key, d]) => [methodLabels[key] || key, d.count, fmt(d.revenue), pct(d.revenue, totalRev)])
  ), '#2563eb')}

  ${section('Top 10 Items This Week', '🏆', buildTable(
    [{ label: '#' }, { label: 'Item' }, { label: 'Category' }, { label: 'Qty', right: true }, { label: 'Revenue', right: true }],
    topItems.map((item, i) => [`<span style="color:#9ca3af;font-size:11px;">${i+1}</span>`, `<strong>${item.name}</strong>`, item.category, item.qty, fmt(item.rev)])
  ), '#10b981')}

  ${totalDebt > 0 ? section('Debtors / Credit Accounts', '📋', `
    ${kpiRow([kpiBox('Total Outstanding', fmt(totalDebt), '#dc2626'), kpiBox('Active Accounts', (debtors||[]).length), kpiBox('Overdue 30+ days', overdue.length, overdue.length > 0 ? '#dc2626' : '#059669')])}
    ${overdue.length > 0 ? `<div style="margin-top:10px;">${buildTable(
      [{ label: 'Name' }, { label: 'Phone' }, { label: 'Balance', right: true }],
      overdue.slice(0, 5).map(d => [d.name||'—', d.phone||'—', fmt(d.balance)])
    )}</div>` : ''}
  `, '#ef4444') : ''}

  ${(roomStays || []).length > 0 ? section('Rooms & Accommodation', '🛏️', `
    ${kpiRow([kpiBox('Total Stays', (roomStays||[]).length), kpiBox('Room Revenue', fmt(roomRevenue), '#059669'), kpiBox('Nook Hire', fmt(nookRevenue), '#7c3aed')])}
  `, '#2563eb') : ''}

  <div style="text-align:center;padding:20px 0 10px;color:#94a3b8;font-size:11px;line-height:1.7;">
    <div style="font-weight:700;color:#64748b;margin-bottom:4px;">RestaurantOS · Beeshop's Place Lounge</div>
    <div>Weekly period: ${label}</div>
    <div>Generated at 8:00 AM WAT · <a href="https://beeshop.place" style="color:#f59e0b;text-decoration:none;">beeshop.place</a></div>
  </div>

</div>
</body>
</html>`

    const { data: emailData, error: emailError } = await resend.emails.send({
      from: 'RestaurantOS <reports@beeshop.place>',
      to: [process.env.REPORT_EMAIL || 'seventeenkay@proton.me'],
      subject: `Weekly Summary ${short} · ${fmt(grandTotal)} · ${paidCount} orders — Beeshop's Place`,
      html,
    })

    if (emailError) {
      console.error('[weekly-summary] Email failed:', emailError)
      return res.status(500).json({ error: emailError.message })
    }

    console.log(`[weekly-summary] OK — ${fmt(grandTotal)}, ${paidCount} orders, id: ${emailData?.id}`)
    return res.status(200).json({
      sent: true, emailId: emailData?.id, week: short,
      grandTotal, paidOrders: paidCount,
      lowStockItems: lowStockItems.length,
      outOfStockItems: outOfStockItems.length,
    })

  } catch (err) {
    console.error('[weekly-summary] Error:', err)
    return res.status(500).json({ error: err.message })
  }
}
