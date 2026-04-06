/**
 * api/cron/daily-report.js
 * Vercel cron job — runs every day at 03:30 UTC (04:30 WAT).
 * Sends a comprehensive daily Z-Report to the owner.
 *
 * vercel.json schedule: "30 3 * * *"
 *
 * Required environment variables (Vercel dashboard → Settings → Environment Variables):
 *   VITE_SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — Supabase service role key (bypasses RLS)
 *   RESEND_API_KEY             — Resend.com API key
 *   REPORT_EMAIL               — Owner's email address
 *   CRON_SECRET                — Vercel cron secret (auto-injected by Vercel)
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

// Accounting session: 08:00 WAT previous day to 08:00 WAT current day
function getSessionWAT() {
  const now = new Date()
  const watNow = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  const end = new Date(watNow)
  end.setHours(8, 0, 0, 0)
  if (watNow.getHours() < 8) end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - 1)
  const label = start.toLocaleDateString('en-NG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Africa/Lagos',
  })
  const y = start.getFullYear()
  const m = String(start.getMonth() + 1).padStart(2, '0')
  const d = String(start.getDate()).padStart(2, '0')
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label,
    short: `${d}/${m}/${y}`,
  }
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

export default async function handler(req, res) {
  const isCron     = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`
  const isInternal = req.headers['x-internal-secret'] === process.env.INTERNAL_API_SECRET
  if (!isCron && !isInternal) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const { start, end, label, short } = getSessionWAT()

    // Derive the WAT date string for attendance lookup
    const sessionDate = new Date(start)
    const watDate = new Date(sessionDate.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
    const dateStr = `${watDate.getFullYear()}-${String(watDate.getMonth() + 1).padStart(2, '0')}-${String(watDate.getDate()).padStart(2, '0')}`

    const [
      { data: orders },
      { data: orderItems },
      { data: returnsLog },
      { data: tillSessions },
      { data: payouts },
      { data: attendance },
      { data: debtors },
      { data: inventory },
      { data: roomStays },
      { data: reservations },
    ] = await Promise.all([
      supabase.from('orders').select('*, profiles(full_name), tables(name, table_categories(name)), covers').gte('created_at', start).lte('created_at', end),
      supabase.from('order_items').select('*, menu_items(name, menu_categories(name))').gte('created_at', start).lte('created_at', end).neq('status', 'cancelled'),
      supabase.from('returns_log').select('*').gte('requested_at', start).lte('requested_at', end),
      supabase.from('till_sessions').select('*, profiles(full_name)').gte('opened_at', start).lte('opened_at', end),
      supabase.from('payouts').select('*').gte('created_at', start).lte('created_at', end),
      supabase.from('attendance').select('*').eq('date', dateStr),
      supabase.from('debtors').select('*').gt('balance', 0),
      supabase.from('inventory').select('*').eq('is_active', true),
      supabase.from('room_stays').select('*').gte('created_at', start).lte('created_at', end),
      supabase.from('reservations').select('*').gte('created_at', start).lte('created_at', end),
    ])

    // Revenue
    const paid           = (orders || []).filter(o => o.status === 'paid')
    const voided         = (orders || []).filter(o => o.status === 'cancelled')
    const openOrders     = (orders || []).filter(o => o.status === 'open')
    const totalRevenue   = paid.reduce((s, o) => s + (o.total_amount || 0), 0)
    const totalCovers    = paid.reduce((s, o) => s + (o.covers || 0), 0)
    const revPerCover    = totalCovers > 0 ? totalRevenue / totalCovers : 0
    const avgOrder       = paid.length ? totalRevenue / paid.length : 0

    // Group payment methods properly (transfer:BankName, cash+transfer:X+Y, cash+card:X+Y)
    function classifyMethod(pm) {
      if (!pm) return 'transfer' // force-closed orders count as transfer
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
      cash: 'Cash', pos: 'POS / Card', transfer: 'Transfer', credit: 'Credit',
      split: 'Split', 'cash+transfer': 'Cash + Transfer', 'cash+pos': 'Cash + POS',
      complimentary: 'Complimentary',
    }
    const methodGroups = {}
    for (const o of paid) {
      const key = classifyMethod(o.payment_method)
      if (!methodGroups[key]) methodGroups[key] = { count: 0, revenue: 0 }
      methodGroups[key].count++
      methodGroups[key].revenue += o.total_amount || 0
    }
    const cashRev = methodGroups['cash']?.revenue || 0

    // Zone breakdown
    const zoneMap = {}
    for (const o of paid) {
      const zone = o.tables?.table_categories?.name || 'Takeaway / Unknown'
      if (!zoneMap[zone]) zoneMap[zone] = { count: 0, revenue: 0 }
      zoneMap[zone].count++
      zoneMap[zone].revenue += o.total_amount || 0
    }

    // Top items — use unit_price or total_price, exclude returned/cancelled items
    const itemMap = {}
    for (const item of (orderItems || [])) {
      if (!item.menu_items) continue
      if (item.return_requested || item.return_accepted) continue
      if ((item.status || '').toLowerCase() === 'cancelled') continue
      const k = item.menu_item_id
      if (!itemMap[k]) itemMap[k] = { name: item.menu_items.name, category: item.menu_items.menu_categories?.name || '—', qty: 0, revenue: 0 }
      itemMap[k].qty     += item.quantity || 1
      itemMap[k].revenue += item.total_price || (item.unit_price || 0) * (item.quantity || 1)
    }
    const topItems = Object.values(itemMap).sort((a, b) => b.qty - a.qty).slice(0, 10)

    // Returns (replaces voids)
    const acceptedReturns = (returnsLog || []).filter(r => ['accepted', 'bar_accepted', 'kitchen_accepted', 'griller_accepted'].includes(r.status))
    const pendingReturns  = (returnsLog || []).filter(r => r.status === 'pending')
    const rejectedReturns = (returnsLog || []).filter(r => ['rejected', 'manager_rejected'].includes(r.status))
    const totalReturnValue = acceptedReturns.reduce((s, r) => s + (r.item_total || 0), 0)

    // Till
    const totalFloat   = (tillSessions || []).reduce((s, t) => s + (t.opening_float || 0), 0)
    const totalPayouts = (payouts || []).reduce((s, p) => s + (p.amount || 0), 0)
    const expectedCash = cashRev - totalPayouts
    const unclosedTillCount = (tillSessions || []).filter(t => !t.closed_at).length

    // Staff
    const waitronMap = {}
    for (const o of paid) {
      const name = o.profiles?.full_name || 'Unknown'
      if (!waitronMap[name]) waitronMap[name] = { orders: 0, revenue: 0 }
      waitronMap[name].orders++
      waitronMap[name].revenue += o.total_amount || 0
    }
    const topWaitrons  = Object.entries(waitronMap).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8)
    const clockedIn    = (attendance || []).length
    const openShifts   = (attendance || []).filter(a => !a.clock_out).length

    // Debtors
    const totalDebt    = (debtors || []).reduce((s, d) => s + (d.balance || 0), 0)
    const newDebtors   = (debtors || []).filter(d => new Date(d.created_at) >= new Date(start) && new Date(d.created_at) <= new Date(end))
    const newDebtAmt   = newDebtors.reduce((s, d) => s + (d.balance || 0), 0)
    const overdue      = (debtors || []).filter(d => {
      const ref = d.last_payment_date ? new Date(d.last_payment_date) : new Date(d.created_at)
      return (Date.now() - ref.getTime()) / 86400000 > 30
    })

    // Stock
    const outOfStock   = (inventory || []).filter(i => (i.current_stock || 0) <= 0)
    const lowStock     = (inventory || []).filter(i => (i.current_stock || 0) > 0 && (i.current_stock || 0) <= (i.minimum_stock || 0))

    // Rooms
    const roomRevenue  = (roomStays || []).reduce((s, r) => s + (r.total_amount || 0), 0)
    const checkIns     = (roomStays || []).filter(r => r.status === 'checked_in').length
    const checkOuts    = (roomStays || []).filter(r => r.status === 'checked_out').length

    // Nook
    const nookBookings = (reservations || []).filter(r => r.zone === 'The Nook' || r.area === 'nook')
    const nookRevenue  = nookBookings.reduce((s, r) => s + (r.hire_fee || 0), 0)

    const grandTotal   = totalRevenue + roomRevenue

    // ── Build email HTML ──────────────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;margin:0;padding:20px;">
<div style="max-width:640px;margin:0 auto;">

  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border-radius:14px;padding:28px;margin-bottom:16px;">
    <div style="color:#f59e0b;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">🍺 Beeshop's Place Lounge</div>
    <div style="color:white;font-size:22px;font-weight:800;">Daily Z-Report</div>
    <div style="color:#94a3b8;font-size:13px;margin-top:4px;">${label}</div>
    <div style="margin-top:20px;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:16px 20px;display:inline-block;">
      <div style="color:#fbbf24;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Grand Total Revenue</div>
      <div style="color:white;font-size:32px;font-weight:900;letter-spacing:-1px;margin-top:4px;">${fmt(grandTotal)}</div>
      <div style="color:#94a3b8;font-size:11px;margin-top:2px;">${paid.length} paid orders · avg ${fmt(avgOrder)}</div>
    </div>
  </div>

  ${section('Revenue Summary', '💰', `
    ${kpiRow([kpiBox('F&B Revenue', fmt(totalRevenue), '#059669'), kpiBox('Room Revenue', fmt(roomRevenue), '#2563eb'), kpiBox('Nook Hire', fmt(nookRevenue), '#7c3aed')])}
    <div style="height:10px;"></div>
    ${kpiRow([kpiBox('Paid Orders', paid.length), kpiBox('Returned', acceptedReturns.length, acceptedReturns.length > 0 ? '#dc2626' : '#111827', acceptedReturns.length > 0 ? fmt(totalReturnValue) : ''), kpiBox('Still Open', openOrders.length, openOrders.length > 0 ? '#ea580c' : '#111827')])}
  `, '#059669')}

  ${section('Payment Methods', '💳', buildTable(
    [{ label: 'Method' }, { label: 'Orders' }, { label: 'Amount', right: true }, { label: '%', right: true }],
    Object.entries(methodGroups)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([key, d]) => [methodLabels[key] || key, d.count, fmt(d.revenue), pct(d.revenue, totalRevenue)]),
    'No paid orders.'
  ), '#2563eb')}

  ${section('Revenue by Zone', '🗺️', buildTable(
    [{ label: 'Zone' }, { label: 'Orders' }, { label: 'Revenue', right: true }, { label: '%', right: true }],
    Object.entries(zoneMap).sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([z, d]) => [z, d.count, fmt(d.revenue), pct(d.revenue, totalRevenue)]),
    'No zone data.'
  ), '#f59e0b')}

  ${section('Top 10 Selling Items', '🏆', buildTable(
    [{ label: '#' }, { label: 'Item' }, { label: 'Category' }, { label: 'Qty', right: true }, { label: 'Revenue', right: true }],
    topItems.map((item, i) => [`<span style="color:#9ca3af;font-size:11px;">${i+1}</span>`, `<strong style="font-size:12px;">${item.name}</strong>`, item.category, item.qty, fmt(item.revenue)]),
    'No item sales.'
  ), '#10b981')}

  ${section('Till & Cash Management', '🏧', `
    ${kpiRow([kpiBox('Opening Float', fmt(totalFloat)), kpiBox('Cash Revenue', fmt(cashRev), '#059669'), kpiBox('Total Payouts', fmt(totalPayouts), '#dc2626')])}
    <div style="height:10px;"></div>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;">
      <span style="color:#059669;font-weight:700;font-size:13px;">Expected Cash in Till: ${fmt(expectedCash)}</span>
      <span style="color:#6b7280;font-size:11px;margin-left:8px;">(Cash − payouts)</span>
    </div>
    ${unclosedTillCount > 0 ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 16px;margin-top:8px;"><span style="color:#ea580c;font-weight:700;font-size:12px;">⚠️ ${unclosedTillCount} till session(s) not closed at end of shift.</span></div>` : ''}
  `, '#f59e0b')}

  ${(returnsLog || []).length > 0
    ? section('Returned Items', '🔄', `
        ${kpiRow([kpiBox('Accepted', acceptedReturns.length, '#dc2626'), kpiBox('Pending', pendingReturns.length, pendingReturns.length > 0 ? '#ea580c' : '#6b7280'), kpiBox('Total Return Value', fmt(totalReturnValue), '#dc2626')])}
        ${acceptedReturns.length > 0 ? `<div style="margin-top:12px;">${buildTable(
          [{ label: 'Time' }, { label: 'Waitron' }, { label: 'Item' }, { label: 'Qty' }, { label: 'Amount', right: true }, { label: 'Reason' }],
          acceptedReturns.slice(0,10).map(r => [
            new Date(r.requested_at).toLocaleTimeString('en-NG', { hour:'2-digit', minute:'2-digit', timeZone:'Africa/Lagos' }),
            r.waitron_name || '—', r.item_name || '—', r.quantity || 1, fmt(r.item_total), r.return_reason || '—'
          ])
        )}</div>` : ''}
      `, '#dc2626')
    : section('Returned Items', '✅', `<p style="color:#059669;font-size:13px;font-weight:600;margin:4px 0;">No returned items today.</p>`, '#059669')
  }

  ${section('Staff Performance', '👥', `
    ${kpiRow([
      kpiBox('Clocked In', clockedIn),
      kpiBox('Open Shifts', openShifts, openShifts > 0 ? '#ea580c' : '#6b7280', openShifts > 0 ? 'Not yet out' : 'All closed'),
    ])}
    <div style="margin-top:12px;">
      ${buildTable(
        [{ label: 'Waitron' }, { label: 'Orders' }, { label: 'Revenue', right: true }, { label: '%', right: true }],
        topWaitrons.map(([name, s]) => [name, s.orders, fmt(s.revenue), pct(s.revenue, totalRevenue)]),
        'No waitron data.'
      )}
    </div>
  `, '#8b5cf6')}

  ${section('Debtors / Credit Accounts', '📋', `
    ${kpiRow([
      kpiBox('Total Outstanding', fmt(totalDebt), totalDebt > 0 ? '#dc2626' : '#059669'),
      kpiBox('Active Accounts', (debtors||[]).length),
      kpiBox('Overdue 30+ days', overdue.length, overdue.length > 0 ? '#dc2626' : '#059669'),
    ])}
    ${newDebtors.length > 0 ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 16px;margin-top:10px;"><span style="color:#ea580c;font-weight:700;font-size:12px;">⚠️ ${newDebtors.length} new credit account(s) today — ${fmt(newDebtAmt)} added.</span></div>` : ''}
    ${overdue.length > 0 ? `<div style="margin-top:10px;">${buildTable(
      [{ label: 'Name' }, { label: 'Phone' }, { label: 'Balance', right: true }],
      overdue.slice(0,5).map(d => [d.name||'—', d.phone||'—', fmt(d.balance)])
    )}</div>` : ''}
  `, '#ef4444')}

  ${outOfStock.length > 0 || lowStock.length > 0
    ? section('Main Store Stock Alerts', '📦', `
        ${outOfStock.length > 0 ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin-bottom:10px;">
          <div style="color:#dc2626;font-weight:700;font-size:12px;margin-bottom:6px;">🔴 Out of Stock (${outOfStock.length})</div>
          ${outOfStock.slice(0,10).map(i => `<div style="color:#374151;font-size:12px;padding:2px 0;">• ${i.item_name}</div>`).join('')}
          ${outOfStock.length > 10 ? `<div style="color:#9ca3af;font-size:11px;margin-top:4px;">...and ${outOfStock.length - 10} more</div>` : ''}
        </div>` : ''}
        ${lowStock.length > 0 ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 16px;">
          <div style="color:#ea580c;font-weight:700;font-size:12px;margin-bottom:6px;">🟡 Low Stock (${lowStock.length})</div>
          ${lowStock.slice(0,10).map(i => `<div style="color:#374151;font-size:12px;padding:2px 0;">• ${i.item_name} — ${i.current_stock} left (min: ${i.minimum_stock})</div>`).join('')}
          ${lowStock.length > 10 ? `<div style="color:#9ca3af;font-size:11px;margin-top:4px;">...and ${lowStock.length - 10} more</div>` : ''}
        </div>` : ''}
      `, '#f59e0b')
    : section('Main Store Stock', '✅', `<p style="color:#059669;font-size:13px;font-weight:600;margin:4px 0;">All main store inventory items are sufficiently stocked.</p>`, '#059669')
  }

  ${(roomStays||[]).length > 0 ? section('Rooms & Accommodation', '🛏️', `
    ${kpiRow([kpiBox('Check-Ins', checkIns, '#2563eb'), kpiBox('Check-Outs', checkOuts, '#7c3aed'), kpiBox('Room Revenue', fmt(roomRevenue), '#059669')])}
  `, '#2563eb') : ''}

  ${(reservations||[]).length > 0 ? section('Reservations & The Nook', '📅', `
    ${kpiRow([kpiBox('Reservations', (reservations||[]).length), kpiBox('Nook Bookings', nookBookings.length, '#7c3aed'), kpiBox('Nook Hire Revenue', fmt(nookRevenue), '#059669')])}
  `, '#7c3aed') : ''}

  <div style="text-align:center;padding:20px 0 10px;color:#94a3b8;font-size:11px;line-height:1.7;">
    <div style="font-weight:700;color:#64748b;margin-bottom:4px;">RestaurantOS · Beeshop's Place Lounge</div>
    <div>Trading period: 8:00 AM – 8:00 AM WAT · ${short}</div>
    <div>Generated at 4:30 AM WAT · <a href="https://beeshop.place" style="color:#f59e0b;text-decoration:none;">beeshop.place</a></div>
  </div>

</div>
</body>
</html>`

    const { data: emailData, error: emailError } = await resend.emails.send({
      from: 'RestaurantOS <reports@beeshop.place>',
      to: [process.env.REPORT_EMAIL || 'seventeenkay@proton.me'],
      subject: `Z-Report ${short} · ${fmt(grandTotal)} · ${paid.length} orders — Beeshop's Place`,
      html,
    })

    if (emailError) {
      console.error('[daily-report] Email failed:', emailError)
      return res.status(500).json({ error: emailError.message })
    }

    console.log(`[daily-report] OK — ${fmt(grandTotal)}, ${paid.length} orders, id: ${emailData?.id}`)
    return res.status(200).json({
      sent: true, emailId: emailData?.id, date: short,
      grandTotal, paidOrders: paid.length, returnedItems: acceptedReturns.length,
      stockAlerts: outOfStock.length + lowStock.length, overdueDebtors: overdue.length,
    })

  } catch (err) {
    console.error('[daily-report] Error:', err)
    return res.status(500).json({ error: err.message })
  }
}
