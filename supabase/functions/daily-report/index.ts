// =============================================================================
// Beeshop's Place — Daily Report Edge Function
// Schedule : 03:30 UTC every day = 4:30am WAT (Africa/Lagos, UTC+1)
// Deploy   : supabase functions deploy daily-report
// Schedule : supabase functions schedule daily-report --cron "30 3 * * *"
// Secrets  : RESEND_API_KEY, OWNER_EMAIL  (set via supabase secrets set ...)
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`

const pct = (part: number, whole: number) =>
  whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`

function watBounds(daysAgo = 1) {
  // WAT = UTC+1. Midnight WAT = 23:00 UTC the previous calendar day.
  const now = new Date()
  // Target date in WAT
  const target = new Date(now.getTime() + 60 * 60 * 1000) // shift to WAT
  target.setUTCDate(target.getUTCDate() - daysAgo)
  target.setUTCHours(0, 0, 0, 0)   // midnight WAT
  const start = new Date(target.getTime() - 60 * 60 * 1000) // back to UTC
  const end   = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1)
  return { start, end }
}

function dateLabel(start: Date) {
  return start.toLocaleDateString('en-NG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Africa/Lagos',
  })
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchData(start: Date, end: Date) {
  const s = start.toISOString()
  const e = end.toISOString()

  const [
    ordersRes,
    orderItemsRes,
    voidsRes,
    payoutsRes,
    tillRes,
    attendanceRes,
    roomStaysRes,
    debtorPaymentsRes,
    inventoryRes,
  ] = await Promise.all([
    // All paid orders with waitron + table + zone info
    supabase.from('orders')
      .select('id, total_amount, payment_method, order_type, customer_name, closed_at, profiles(full_name), tables(name, table_categories(name))')
      .eq('status', 'paid')
      .gte('closed_at', s)
      .lte('closed_at', e),

    // Order items for top-selling analysis
    supabase.from('order_items')
      .select('quantity, total_price, menu_items(name, menu_categories(name))')
      .gte('created_at', s)
      .lte('created_at', e),

    // Voids
    supabase.from('void_log')
      .select('total_value, menu_item_name, quantity, void_type, reason, voided_by_name, approved_by_name, created_at')
      .gte('created_at', s)
      .lte('created_at', e),

    // Payouts (cash out of till)
    supabase.from('payouts')
      .select('amount, reason, category, created_at')
      .gte('created_at', s)
      .lte('created_at', e),

    // Till sessions
    supabase.from('till_sessions')
      .select('opened_at, closed_at, opening_float, closing_float, expected_cash, status')
      .gte('opened_at', s)
      .lte('opened_at', e),

    // Staff attendance
    supabase.from('attendance')
      .select('clock_in, clock_out, date, pos_machine, profiles(full_name, role)')
      .eq('date', start.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })),

    // Room stays checked in yesterday
    supabase.from('room_stays')
      .select('guest_name, total_amount, payment_method, nights, rooms(name)')
      .gte('check_in_at', s)
      .lte('check_in_at', e),

    // Debtor payments received yesterday
    supabase.from('debtor_payments')
      .select('amount, debtors(name)')
      .gte('created_at', s)
      .lte('created_at', e),

    // Low-stock inventory items
    supabase.from('inventory')
      .select('menu_item_id, current_stock, minimum_stock, menu_items(name)')
      .eq('is_active', true)
      .lte('current_stock', supabase.raw('minimum_stock')),
  ])

  return {
    orders:          ordersRes.data        || [],
    orderItems:      orderItemsRes.data    || [],
    voids:           voidsRes.data         || [],
    payouts:         payoutsRes.data       || [],
    tillSessions:    tillRes.data          || [],
    attendance:      attendanceRes.data    || [],
    roomStays:       roomStaysRes.data     || [],
    debtorPayments:  debtorPaymentsRes.data || [],
    inventory:       inventoryRes.data     || [],
  }
}

// ── HTML Email builder ────────────────────────────────────────────────────────

function buildEmail(dateStr: string, d: Awaited<ReturnType<typeof fetchData>>) {

  // ── Revenue totals ──
  const totalRevenue = d.orders.reduce((s, o) => s + (o.total_amount || 0), 0)
  const totalVoided  = d.voids.reduce((s, v) => s + (v.total_value || 0), 0)
  const totalPayouts = d.payouts.reduce((s, p) => s + (p.amount || 0), 0)
  const totalRooms   = d.roomStays.reduce((s, r) => s + (r.total_amount || 0), 0)
  const totalDebtorRecovered = d.debtorPayments.reduce((s, p) => s + (p.amount || 0), 0)
  const netRevenue   = totalRevenue - totalPayouts

  const cash     = d.orders.filter(o => o.payment_method === 'cash').reduce((s, o) => s + (o.total_amount || 0), 0)
  const transfer = d.orders.filter(o => o.payment_method === 'transfer').reduce((s, o) => s + (o.total_amount || 0), 0)
  const card     = d.orders.filter(o => o.payment_method === 'card').reduce((s, o) => s + (o.total_amount || 0), 0)
  const credit   = d.orders.filter(o => o.payment_method === 'credit').reduce((s, o) => s + (o.total_amount || 0), 0)

  const orderCount  = d.orders.length
  const avgOrder    = orderCount ? totalRevenue / orderCount : 0

  // ── Order types ──
  const tableOrders    = d.orders.filter(o => o.order_type === 'table')
  const cashSales      = d.orders.filter(o => o.order_type === 'cash_sale')
  const takeaways      = d.orders.filter(o => o.order_type === 'takeaway')

  // ── Per-waitron ──
  const waitronMap: Record<string, { revenue: number; orders: number }> = {}
  d.orders.forEach(o => {
    const name = (o.profiles as any)?.full_name || 'Unknown'
    if (!waitronMap[name]) waitronMap[name] = { revenue: 0, orders: 0 }
    waitronMap[name].revenue += o.total_amount || 0
    waitronMap[name].orders++
  })
  const waitronRows = Object.entries(waitronMap)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([name, w], i) => `
      <tr style="background:${i % 2 === 0 ? '#f8fafc' : 'white'}">
        <td style="padding:7px 12px;font-size:13px">${name}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:center">${w.orders}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:right;font-weight:600">${fmt(w.revenue)}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:right;color:#64748b">${fmt(w.orders ? w.revenue / w.orders : 0)}</td>
      </tr>`).join('')

  // ── Top selling items ──
  const itemMap: Record<string, { qty: number; revenue: number; category: string }> = {}
  d.orderItems.forEach(item => {
    const name = (item.menu_items as any)?.name || 'Unknown'
    const cat  = (item.menu_items as any)?.menu_categories?.name || ''
    if (!itemMap[name]) itemMap[name] = { qty: 0, revenue: 0, category: cat }
    itemMap[name].qty     += item.quantity || 0
    itemMap[name].revenue += item.total_price || 0
  })
  const topItems = Object.entries(itemMap)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 10)
    .map(([name, v], i) => `
      <tr style="background:${i % 2 === 0 ? '#f8fafc' : 'white'}">
        <td style="padding:7px 12px;font-size:13px">${name}</td>
        <td style="padding:7px 12px;font-size:13px;color:#64748b">${v.category}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:center">${v.qty}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:right;font-weight:600">${fmt(v.revenue)}</td>
      </tr>`).join('')

  // ── Zones / zones revenue ──
  const zoneMap: Record<string, number> = {}
  d.orders.forEach(o => {
    const zone = (o.tables as any)?.table_categories?.name || (o.order_type === 'takeaway' ? 'Takeaway' : 'Counter')
    zoneMap[zone] = (zoneMap[zone] || 0) + (o.total_amount || 0)
  })
  const zoneRows = Object.entries(zoneMap)
    .sort((a, b) => b[1] - a[1])
    .map(([zone, rev], i) => `
      <tr style="background:${i % 2 === 0 ? '#f8fafc' : 'white'}">
        <td style="padding:7px 12px;font-size:13px">${zone}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:right;font-weight:600">${fmt(rev)}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:right;color:#64748b">${pct(rev, totalRevenue)}</td>
      </tr>`).join('')

  // ── Hourly breakdown ──
  const hourMap: Record<number, number> = {}
  d.orders.forEach(o => {
    if (!o.closed_at) return
    const h = new Date(new Date(o.closed_at).getTime() + 3600000).getUTCHours() // WAT
    hourMap[h] = (hourMap[h] || 0) + (o.total_amount || 0)
  })
  const peakHour = Object.entries(hourMap).sort((a, b) => Number(b[1]) - Number(a[1]))[0]
  const peakLabel = peakHour ? (() => {
    const h = parseInt(peakHour[0])
    const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`
    return `${label} — ${fmt(Number(peakHour[1]))}`
  })() : 'N/A'

  // ── Staff attendance ──
  const attendanceRows = d.attendance
    .filter(a => (a.profiles as any)?.role !== 'owner')
    .sort((a, b) => a.clock_in?.localeCompare(b.clock_in || '') || 0)
    .map((a, i) => {
      const name = (a.profiles as any)?.full_name || 'Unknown'
      const role = (a.profiles as any)?.role || ''
      const cin  = a.clock_in  ? new Date(a.clock_in).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '—'
      const cout = a.clock_out ? new Date(a.clock_out).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '<span style="color:#ef4444">On shift</span>'
      const mins = a.clock_in && a.clock_out
        ? Math.round((new Date(a.clock_out).getTime() - new Date(a.clock_in).getTime()) / 60000)
        : null
      const duration = mins !== null ? (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`) : '—'
      const pos = a.pos_machine || '—'
      return `
        <tr style="background:${i % 2 === 0 ? '#f8fafc' : 'white'}">
          <td style="padding:7px 12px;font-size:13px">${name}</td>
          <td style="padding:7px 12px;font-size:12px;color:#64748b;text-transform:capitalize">${role}</td>
          <td style="padding:7px 12px;font-size:13px;text-align:center">${cin}</td>
          <td style="padding:7px 12px;font-size:13px;text-align:center">${cout}</td>
          <td style="padding:7px 12px;font-size:13px;text-align:center">${duration}</td>
          <td style="padding:7px 12px;font-size:12px;text-align:center;color:#64748b">${pos}</td>
        </tr>`
    }).join('')

  // ── Till sessions ──
  const tillRows = d.tillSessions.map((t, i) => {
    const open  = t.opened_at ? new Date(t.opened_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '—'
    const close = t.closed_at ? new Date(t.closed_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : 'Open'
    const diff  = t.expected_cash != null && t.closing_float != null
      ? t.closing_float - t.expected_cash : null
    const diffStr = diff === null ? '—' : diff >= 0
      ? `<span style="color:#16a34a">+${fmt(diff)}</span>`
      : `<span style="color:#dc2626">${fmt(diff)}</span>`
    return `
      <tr style="background:${i % 2 === 0 ? '#f8fafc' : 'white'}">
        <td style="padding:7px 12px;font-size:13px">${open}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:center">${close}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:right">${fmt(t.opening_float || 0)}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:right">${fmt(t.closing_float || 0)}</td>
        <td style="padding:7px 12px;font-size:13px;text-align:right">${diffStr}</td>
      </tr>`
  }).join('')

  // ── Voids ──
  const voidRows = d.voids.slice(0, 10).map((v, i) => `
    <tr style="background:${i % 2 === 0 ? '#f8fafc' : 'white'}">
      <td style="padding:7px 12px;font-size:13px">${v.menu_item_name || '—'}</td>
      <td style="padding:7px 12px;font-size:13px;text-align:center">${v.quantity || 1}</td>
      <td style="padding:7px 12px;font-size:13px;text-align:right;color:#dc2626">-${fmt(v.total_value || 0)}</td>
      <td style="padding:7px 12px;font-size:13px;color:#64748b">${v.reason || '—'}</td>
      <td style="padding:7px 12px;font-size:13px;color:#64748b">${v.approved_by_name || '—'}</td>
    </tr>`).join('')

  // ── Payouts ──
  const payoutRows = d.payouts.map((p, i) => `
    <tr style="background:${i % 2 === 0 ? '#f8fafc' : 'white'}">
      <td style="padding:7px 12px;font-size:13px">${p.reason || '—'}</td>
      <td style="padding:7px 12px;font-size:12px;color:#64748b;text-transform:capitalize">${p.category || '—'}</td>
      <td style="padding:7px 12px;font-size:13px;text-align:right;color:#dc2626">-${fmt(p.amount || 0)}</td>
    </tr>`).join('')

  // ── Rooms ──
  const roomRows = d.roomStays.map((r, i) => `
    <tr style="background:${i % 2 === 0 ? '#f8fafc' : 'white'}">
      <td style="padding:7px 12px;font-size:13px">${(r.rooms as any)?.name || '—'}</td>
      <td style="padding:7px 12px;font-size:13px">${r.guest_name || '—'}</td>
      <td style="padding:7px 12px;font-size:13px;text-align:center">${r.nights || 1} night(s)</td>
      <td style="padding:7px 12px;font-size:13px;text-align:right;font-weight:600">${fmt(r.total_amount || 0)}</td>
      <td style="padding:7px 12px;font-size:12px;color:#64748b">${r.payment_method || '—'}</td>
    </tr>`).join('')

  // ── Low stock ──
  const lowStockRows = d.inventory.map((item, i) => `
    <tr style="background:${i % 2 === 0 ? '#fff7ed' : '#fef3c7'}">
      <td style="padding:7px 12px;font-size:13px">${(item.menu_items as any)?.name || '—'}</td>
      <td style="padding:7px 12px;font-size:13px;text-align:center;color:#dc2626;font-weight:700">${item.current_stock}</td>
      <td style="padding:7px 12px;font-size:13px;text-align:center;color:#64748b">${item.minimum_stock}</td>
    </tr>`).join('')

  // ── Section helper ──
  const section = (title: string, colour: string, content: string) => `
    <div style="margin-bottom:28px">
      <h3 style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;
                 color:${colour};margin:0 0 10px;padding-bottom:6px;
                 border-bottom:2px solid ${colour}">${title}</h3>
      ${content}
    </div>`

  const table = (headers: string[], rows: string, alignments: string[] = []) => `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#0f172a">
          ${headers.map((h, i) => `<th style="padding:8px 12px;color:white;font-size:11px;text-transform:uppercase;
            letter-spacing:.5px;font-weight:600;text-align:${alignments[i] || 'left'}">${h}</th>`).join('')}
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="${headers.length}" style="padding:12px;color:#94a3b8;text-align:center;font-size:13px">No data</td></tr>'}</tbody>
    </table>`

  const kpi = (label: string, value: string, sub?: string, colour = '#0f172a') => `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;flex:1;min-width:140px">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">${label}</div>
      <div style="font-size:20px;font-weight:800;color:${colour}">${value}</div>
      ${sub ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px">${sub}</div>` : ''}
    </div>`

  // ── Assemble email ──────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:680px;margin:24px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:28px 32px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
      <span style="font-size:22px;font-weight:900;color:#f59e0b;letter-spacing:-0.5px">Beeshop's Place</span>
    </div>
    <div style="font-size:13px;color:#94a3b8">Daily Trading Summary &nbsp;·&nbsp; ${dateStr}</div>
  </div>

  <div style="padding:28px 32px">

    <!-- KPI strip -->
    ${section('At a Glance', '#f59e0b', `
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        ${kpi('Total Revenue', fmt(totalRevenue), `${orderCount} orders`, '#f59e0b')}
        ${kpi('Net Revenue', fmt(netRevenue), `after ${fmt(totalPayouts)} payouts`, '#16a34a')}
        ${kpi('Avg Order', fmt(avgOrder), '')}
        ${kpi('Voided', fmt(totalVoided), `${d.voids.length} void(s)`, totalVoided > 0 ? '#dc2626' : '#64748b')}
        ${kpi('Peak Hour', peakLabel, '', '#6366f1')}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px">
        ${kpi('Cash', fmt(cash), pct(cash, totalRevenue))}
        ${kpi('Bank Transfer', fmt(transfer), pct(transfer, totalRevenue))}
        ${kpi('Bank POS', fmt(card), pct(card, totalRevenue))}
        ${credit > 0 ? kpi('Credit/Tab', fmt(credit), pct(credit, totalRevenue), '#d97706') : ''}
        ${totalRooms > 0 ? kpi('Rooms', fmt(totalRooms), `${d.roomStays.length} check-in(s)`, '#8b5cf6') : ''}
        ${totalDebtorRecovered > 0 ? kpi('Debts Recovered', fmt(totalDebtorRecovered), '', '#16a34a') : ''}
      </div>
    `)}

    <!-- Order types summary -->
    ${section('Orders by Type', '#3b82f6', `
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 18px;min-width:120px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#2563eb">${tableOrders.length}</div>
          <div style="font-size:12px;color:#3b82f6">Table Orders</div>
          <div style="font-size:11px;color:#94a3b8">${fmt(tableOrders.reduce((s, o) => s + (o.total_amount || 0), 0))}</div>
        </div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 18px;min-width:120px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#16a34a">${cashSales.length}</div>
          <div style="font-size:12px;color:#16a34a">Cash Sales</div>
          <div style="font-size:11px;color:#94a3b8">${fmt(cashSales.reduce((s, o) => s + (o.total_amount || 0), 0))}</div>
        </div>
        <div style="background:#fdf4ff;border:1px solid #e9d5ff;border-radius:8px;padding:12px 18px;min-width:120px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#9333ea">${takeaways.length}</div>
          <div style="font-size:12px;color:#9333ea">Takeaways</div>
          <div style="font-size:11px;color:#94a3b8">${fmt(takeaways.reduce((s, o) => s + (o.total_amount || 0), 0))}</div>
        </div>
      </div>
    `)}

    <!-- Waitron performance -->
    ${waitronRows ? section('Waitron Performance', '#6366f1', table(
      ['Staff', 'Orders', 'Revenue', 'Avg Order'],
      waitronRows,
      ['left', 'center', 'right', 'right']
    )) : ''}

    <!-- Zone revenue -->
    ${zoneRows ? section('Revenue by Zone', '#0891b2', table(
      ['Zone', 'Revenue', 'Share'],
      zoneRows,
      ['left', 'right', 'right']
    )) : ''}

    <!-- Top selling items -->
    ${topItems ? section('Top 10 Items', '#10b981', table(
      ['Item', 'Category', 'Qty', 'Revenue'],
      topItems,
      ['left', 'left', 'center', 'right']
    )) : ''}

    <!-- Rooms -->
    ${roomRows ? section('Room Check-ins', '#8b5cf6', table(
      ['Room', 'Guest', 'Duration', 'Amount', 'Payment'],
      roomRows,
      ['left', 'left', 'center', 'right', 'left']
    )) : ''}

    <!-- Till sessions -->
    ${tillRows ? section('Till Sessions', '#0369a1', table(
      ['Opened', 'Closed', 'Float', 'Closing Cash', '+/- Variance'],
      tillRows,
      ['left', 'center', 'right', 'right', 'right']
    )) : ''}

    <!-- Payouts -->
    ${payoutRows ? section('Cash Payouts', '#dc2626', table(
      ['Reason', 'Category', 'Amount'],
      payoutRows,
      ['left', 'left', 'right']
    )) : ''}

    <!-- Voids -->
    ${voidRows ? section('Voids', '#ef4444', table(
      ['Item', 'Qty', 'Value Lost', 'Reason', 'Approved By'],
      voidRows,
      ['left', 'center', 'right', 'left', 'left']
    )) : ''}

    <!-- Staff attendance -->
    ${attendanceRows ? section('Staff Attendance', '#0284c7', table(
      ['Name', 'Role', 'Clock In', 'Clock Out', 'Hours', 'POS'],
      attendanceRows,
      ['left', 'left', 'center', 'center', 'center', 'center']
    )) : ''}

    <!-- Low stock alert -->
    ${lowStockRows ? section('⚠️ Low Stock Alert', '#f59e0b', `
      <p style="font-size:13px;color:#92400e;background:#fef3c7;padding:8px 12px;border-radius:6px;margin:0 0 10px">
        The following items are at or below their minimum stock threshold. Restock before trading opens.
      </p>
      ${table(
        ['Item', 'Current Stock', 'Minimum'],
        lowStockRows,
        ['left', 'center', 'center']
      )}
    `) : `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;font-size:13px;color:#15803d">
        ✅ All inventory items are above minimum stock thresholds.
      </div>
    `}

    <!-- Footer -->
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0">
      <p style="font-size:12px;color:#94a3b8;margin:0">
        Generated automatically by RestaurantOS at 4:30am WAT.
        <a href="https://beeshop.place" style="color:#f59e0b;text-decoration:none">beeshop.place</a>
        &nbsp;·&nbsp; For full drill-down go to Accounting → Reports.
      </p>
    </div>

  </div>
</div>
</body>
</html>`
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async () => {
  try {
    const { start, end } = watBounds(1)   // yesterday WAT
    const label = dateLabel(start)

    // Fetch all report data
    const data = await fetchData(start, end)

    // Determine recipients — owner email from env + any active owners/managers in DB
    const ownerEmail = Deno.env.get('OWNER_EMAIL')
    const { data: dbStaff } = await supabase
      .from('profiles')
      .select('email')
      .in('role', ['owner'])
      .eq('is_active', true)
      .not('email', 'is', null)

    const recipients = [...new Set([
      ownerEmail,
      ...((dbStaff || []).map((s: any) => s.email as string))
    ].filter(Boolean))] as string[]

    if (recipients.length === 0) {
      console.warn('No recipients configured — set OWNER_EMAIL secret or add owner profiles with emails')
      return new Response(JSON.stringify({ ok: true, message: 'No recipients' }), { status: 200 })
    }

    const html = buildEmail(label, data)

    const totalRevenue = data.orders.reduce((s, o) => s + (o.total_amount || 0), 0)
    const subject = `📊 Daily Report — ${label} — ₦${Math.round(totalRevenue).toLocaleString('en-NG')}`

    // Send via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      console.error('RESEND_API_KEY not set')
      return new Response(JSON.stringify({ ok: false, error: 'RESEND_API_KEY not configured' }), { status: 500 })
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Beeshop\'s Place <reports@beeshopsplace.com>',
        to: recipients,
        subject,
        html,
      }),
    })

    if (!emailRes.ok) {
      const err = await emailRes.text()
      console.error('Resend error:', err)
      return new Response(JSON.stringify({ ok: false, error: err }), { status: 500 })
    }

    console.log(`✅ Daily report sent to ${recipients.join(', ')} — ${label}`)

    return new Response(
      JSON.stringify({
        ok: true,
        date: label,
        recipients,
        orders: data.orders.length,
        revenue: totalRevenue,
        voids: data.voids.length,
        staff: data.attendance.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    console.error('Daily report error:', e)
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 })
  }
})
