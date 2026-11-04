// READ-ONLY exploitation-signal analysis on silent write-offs.
// Looks for: per-waitron void counts/values, item-value distribution,
// time-of-day clustering, reuse of same item IDs (double void), and
// reconciliation gaps (till_records vs expected).
const URL = 'https://qdibeyhdrcrddckouqmc.supabase.co'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var')
  process.exit(1)
}

async function rest(path, params = {}) {
  const q = new URLSearchParams(params)
  const res = await fetch(`${URL}/rest/v1/${path}?${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json()
}
async function allRows(path, params = {}, PAGE = 1000) {
  const out = []
  let from = 0
  for (;;) {
    const page = await rest(path, { ...params, limit: String(PAGE), offset: String(from) })
    out.push(...page)
    if (page.length < PAGE) break
    from += PAGE
  }
  return out
}

const start = new Date('2026-07-30T08:00:00+01:00')
const end = new Date('2026-08-12T08:00:00+01:00')

// 1. All returned items in window with parent order + waitron + payment
const items = await allRows('order_items', {
  select: 'id,order_id,quantity,unit_price,total_price,status,destination,return_requested,return_accepted,return_reason,return_requested_at,created_at,menu_items(name),orders(id,status,payment_method,closed_at,profiles(full_name),tables(name))',
  and: `(created_at.gte.${start.toISOString()},created_at.lt.${end.toISOString()})`,
})

// 2. All returns_log rows referencing window items
const logs = await allRows('returns_log', {
  select: 'id,order_item_id,order_id,status,item_name,item_total,quantity,waitron_name,waitron_id,shift_date,barman_name,return_reason,requested_at,resolved_at',
  and: `(requested_at.gte.${start.toISOString()},requested_at.lt.${end.toISOString()})`,
})

// 3. till_records (all time — small table)
let till = []
try { till = await allRows('till_records', { select: '*' }) } catch { /* */ }

// 4. recon settings for window days
const reconDays = []
for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
  const k = `recon_${d.toISOString().slice(0, 10)}`
  try {
    const r = await rest('settings', { select: 'value', id: `eq.${k}` })
    if (r[0]) reconDays.push({ day: k.replace('recon_', ''), ...JSON.parse(r[0].value) })
  } catch { /* */ }
}

// ── Build per-item view ──
const rows = []
const logByItem = {}
for (const l of logs) {
  if (l.order_item_id) (logByItem[l.order_item_id] ||= []).push(l)
}
for (const i of items) {
  if (!i.return_requested && !i.return_accepted) continue
  const order = i.orders || {}
  const waitron = order.profiles?.full_name || 'Unknown'
  const itemLogs = logByItem[i.id] || []
  const acceptedLog = itemLogs.filter((l) =>
    ['accepted', 'bar_accepted', 'kitchen_accepted', 'griller_accepted'].includes(l.status)
  )
  rows.push({
    itemId: i.id,
    orderId: i.order_id,
    waitron,
    name: i.menu_items?.name || '(unknown item)',
    value: i.total_price || 0,
    qty: i.quantity || 0,
    dest: i.destination || '?',
    pm: order.payment_method || '',
    closedAt: order.closed_at || '',
    created: i.created_at || '',
    reqAt: i.return_requested_at || '',
    reason: i.return_reason || '',
    req: !!i.return_requested,
    acc: !!i.return_accepted,
    hasAcceptedLog: acceptedLog.length > 0,
    logStatuses: itemLogs.map((l) => l.status).join(','),
    logBarman: itemLogs.map((l) => l.barman_name || '').filter(Boolean).join(','),
  })
}

// ── 1. Per waitron: voids vs totals ──
const byWaitron = {}
for (const r of rows) {
  byWaitron[r.waitron] ||= { voidCount: 0, voidValue: 0, noTrailCount: 0, noTrailValue: 0, items: [] }
  const w = byWaitron[r.waitron]
  w.voidCount++
  w.voidValue += r.value
  if (!r.hasAcceptedLog) {
    w.noTrailCount++
    w.noTrailValue += r.value
  }
  w.items.push(r)
}

console.log('═'.repeat(90))
console.log('1) SILENT WRITE-OFFS BY WAITRON (14-day window)')
console.log('═'.repeat(90))
console.log(
  'Waitron'.padEnd(24) +
  '  Void#' + 'VoidVal'.padStart(10) + '  NoTrail#' + 'NoTrailVal'.padStart(11) +
  '  %noTrail'.padStart(9)
)
const sorted = Object.entries(byWaitron).sort((a, b) => b[1].voidValue - a[1].voidValue)
for (const [name, w] of sorted) {
  const pct = w.voidCount ? Math.round((w.noTrailCount / w.voidCount) * 100) : 0
  console.log(
    name.slice(0, 23).padEnd(24) +
    `  ${String(w.voidCount).padStart(4)}` +
    `₦${w.voidValue.toLocaleString()}`.padStart(10) +
    `  ${String(w.noTrailCount).padStart(6)}` +
    `₦${w.noTrailValue.toLocaleString()}`.padStart(11) +
    `  ${pct}%`.padStart(8)
  )
}

// ── 2. Value distribution of silent voids ──
console.log('\n' + '═'.repeat(90))
console.log('2) VALUE DISTRIBUTION OF SILENT VOIDS (no accepted returns_log)')
console.log('═'.repeat(90))
const buckets = { '0-2000': 0, '2001-5000': 0, '5001-10000': 0, '10001+': 0 }
const silent = rows.filter((r) => !r.hasAcceptedLog)
for (const r of silent) {
  if (r.value <= 2000) buckets['0-2000']++
  else if (r.value <= 5000) buckets['2001-5000']++
  else if (r.value <= 10000) buckets['5001-10000']++
  else buckets['10001+']++
}
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(10)} ₦: ${String(v).padStart(3)} items`)

// ── 3. Time-of-day clustering ──
console.log('\n' + '═'.repeat(90))
console.log('3) TIME-OF-DAY CLUSTERING (silent voids, WAT)')
console.log('═'.repeat(90))
const hourMap = {}
for (const r of silent) {
  const t = r.reqAt || r.created
  const h = t ? new Date(t).getHours() : -1
  const watH = ((h + 1) % 24 + 24) % 24 // naive +1 for WAT
  hourMap[watH] = (hourMap[watH] || 0) + 1
}
for (let h = 0; h < 24; h++) {
  if (hourMap[h]) {
    const bar = '█'.repeat(Math.min(30, hourMap[h]))
    console.log(`  ${String(h).padStart(2)}:00  ${String(hourMap[h]).padStart(2)}  ${bar}`)
  }
}

// ── 4. Reuse of same order_id / double-void on same order ──
console.log('\n' + '═'.repeat(90))
console.log('4) ORDERS WITH MULTIPLE VOIDS (possible pattern)')
console.log('═'.repeat(90))
const byOrder = {}
for (const r of rows) byOrder[r.orderId] ||= []
for (const r of rows) byOrder[r.orderId].push(r)
const multiVoid = Object.entries(byOrder).filter(([, v]) => v.length >= 3).sort((a, b) => b[1].reduce((s, r) => s + r.value, 0) - a[1].reduce((s, r) => s + r.value, 0))
console.log(`  Orders with >=3 voided items: ${multiVoid.length}`)
for (const [oid, v] of multiVoid.slice(0, 15)) {
  const w = v[0].waitron
  const val = v.reduce((s, r) => s + r.value, 0)
  const names = v.map((r) => `${r.qty}x${r.name}@₦${r.value}`).join(', ')
  console.log(`  ${oid}  ${w}  ₦${val.toLocaleString()}  ${names}`)
}

// ── 5. No reason / unknown items ──
console.log('\n' + '═'.repeat(90))
console.log('5) SILENT VOIDS OF ZERO-VALUE OR NAMELESS ITEMS')
console.log('═'.repeat(90))
const zeroVal = silent.filter((r) => r.value === 0)
const nameless = silent.filter((r) => r.name === '(unknown item)')
console.log(`  zero-value silent voids: ${zeroVal.length}`)
console.log(`  nameless silent voids:   ${nameless.length}`)

// ── 6. till_records vs expected ──
console.log('\n' + '═'.repeat(90))
console.log('6) TILL_RECORDS vs EXPECTED REMITTANCE (window)')
console.log('═'.repeat(90))
console.log(`  till_records rows: ${till.length}`)
const tillByName = {}
for (const t of till) {
  const n = t.waitron_name || t.staff_name || t.name || 'Unknown'
  tillByName[n] ||= { cash: 0, transfer: 0 }
  if (t.cash) tillByName[n].cash += Number(t.cash) || 0
  if (t.transfer || t.transfer_amount) tillByName[n].transfer += Number(t.transfer || t.transfer_amount) || 0
  if (t.amount && t.type) {
    if (String(t.type).toLowerCase().includes('cash')) tillByName[n].cash += Number(t.amount) || 0
    else tillByName[n].transfer += Number(t.amount) || 0
  }
}
for (const [name, v] of Object.entries(tillByName)) {
  console.log(`  ${name}: cash ₦${v.cash.toLocaleString()}  transfer ₦${v.transfer.toLocaleString()}`)
}

// ── 7. recon days saved ──
console.log('\n' + '═'.repeat(90))
console.log('7) RECON SETTINGS SAVED (window)')
console.log('═'.repeat(90))
for (const r of reconDays) {
  const cash = Object.entries(r.cashCollected || {}).map(([k, v]) => `${k}:₦${v}`).join('; ')
  const tr = Object.entries(r.transferReceipts || {}).map(([k, v]) => `${k}:₦${v}`).join('; ')
  console.log(`  ${r.day}  cash:${cash || '—'}  transfer:${tr || '—'}`)
}

// ── 8. Top voided items ──
console.log('\n' + '═'.repeat(90))
console.log('8) MOST VOIDED ITEMS (silent, no trail)')
console.log('═'.repeat(90))
const byName = {}
for (const r of silent) {
  byName[r.name] ||= { count: 0, value: 0 }
  byName[r.name].count++
  byName[r.name].value += r.value
}
Object.entries(byName)
  .sort((a, b) => b[1].value - a[1].value)
  .slice(0, 15)
  .forEach(([name, v]) => console.log(`  ${String(v.count).padStart(3)}x  ₦${v.value.toLocaleString().padStart(8)}  ${name}`))
