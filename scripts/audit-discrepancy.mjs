// READ-ONLY audit: kitchen-delivered vs waitress-dashboard sales (remittance basis).
// Uses Supabase REST API directly (no npm deps).
// Usage: node scripts/audit-discrepancy.mjs [startDate] [endDate]  (YYYY-MM-DD, default last 14 days)
const URL = 'https://qdibeyhdrcrddckouqmc.supabase.co'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var')
  process.exit(1)
}

const fmtN = (n) => '₦' + Math.round(n).toLocaleString('en-NG')

const today = new Date()
const endDefault = new Date(today)
endDefault.setDate(endDefault.getDate() + 1)
const startDefault = new Date(today)
startDefault.setDate(startDefault.getDate() - 13)

const argStart = process.argv[2] ? new Date(process.argv[2] + 'T00:00:00') : startDefault
const argEnd = process.argv[3] ? new Date(process.argv[3] + 'T00:00:00') : endDefault

const start = new Date(argStart)
start.setHours(8, 0, 0, 0)
const end = new Date(argEnd)
end.setHours(8, 0, 0, 0)

async function rest(path, params = {}) {
  const q = new URLSearchParams(params)
  const res = await fetch(`${URL}/rest/v1/${path}?${q}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json()
}

const normalizeDestination = (dest, name, catName) => {
  const d = (dest || '').trim().toLowerCase()
  const lowerName = (name || '').toLowerCase()
  const lowerCat = (catName || '').toLowerCase()
  const looksMixo = ['cocktail','mocktail','chapman','sunrise','colada','mojito','milkshake','shake','smoothie','fruit punch','punch']
    .some((k) => lowerName.includes(k) || lowerCat.includes(k))
  if (d === 'kitchen' || lowerCat.includes('kitchen') || lowerName.includes('kitchen')) return 'kitchen'
  if (d === 'griller' || d === 'grill' || d === 'grilling' || lowerCat.includes('grill') || lowerName.includes('grill')) return 'griller'
  if (d === 'shisha' || d === 'hookah' || lowerCat.includes('shisha') || lowerName.includes('shisha')) return 'shisha'
  if (d === 'games' || d === 'game' || d === 'games_master' || lowerCat.includes('game')) return 'games'
  if (d === 'mixologist' || d === 'cocktail' || d === 'cocktails' || looksMixo) return 'mixologist'
  return 'bar'
}

const getRemittance = (pm, amount) => {
  const p = (pm || '').toLowerCase()
  if (p === 'cash') return { cash: amount, transfer: 0 }
  if (p === 'card' || p === 'bank_pos') return { cash: 0, transfer: amount }
  if (p.startsWith('transfer') || p === 'transfer') return { cash: 0, transfer: amount }
  if (p.startsWith('cash+transfer')) {
    const [c, t] = (p.split(':')[1] || '').split('+')
    return { cash: parseFloat(c || '0') || 0, transfer: parseFloat(t || '0') || 0 }
  }
  if (p.startsWith('cash+card')) {
    const [c, t] = (p.split(':')[1] || '').split('+')
    return { cash: parseFloat(c || '0') || 0, transfer: parseFloat(t || '0') || 0 }
  }
  return { cash: 0, transfer: 0 }
}

const validItem = (i) =>
  i && !i.return_requested && !i.return_accepted && (i.status || '').toLowerCase() !== 'cancelled'

const netAmount = (items) =>
  (items || []).filter(validItem).reduce((s, i) => s + (i.total_price || 0) + (i.extra_charge || 0), 0)

const sel =
  `id,status,total_amount,payment_method,order_type,created_at,closed_at,staff_id,notes,` +
  `profiles(full_name),` +
  `order_items(id,quantity,unit_price,total_price,extra_charge,status,destination,return_requested,return_accepted,return_reason,created_at,` +
  `menu_items(name,menu_categories(name,destination)))`

const orFilter =
  `and(status.eq.paid,closed_at.gte.${start.toISOString()},closed_at.lt.${end.toISOString()}),` +
  `and(status.neq.paid,created_at.gte.${start.toISOString()},created_at.lt.${end.toISOString()})`

console.log('Fetching orders...')
let orders = []
let from = 0
const PAGE = 1000
for (;;) {
  const page = await rest('orders', { select: sel, or: `(${orFilter})`, order: 'created_at.asc', limit: String(PAGE), offset: String(from) })
  orders = orders.concat(page)
  if (page.length < PAGE) break
  from += PAGE
}
console.log(`Orders fetched: ${orders.length}\n`)

const W = new Map()
const perOrder = []
for (const o of orders) {
  const name = o.profiles?.full_name || 'Unknown'
  const id = o.staff_id || name
  if (!W.has(id)) {
    W.set(id, {
      name,
      paidOrders: 0, paidSales: 0, cashExpected: 0, transferExpected: 0,
      kitchenDelivered: 0, kitchenDeliveredValue: 0,
      openOrders: 0, openValue: 0, openKitchenQty: 0, openKitchenValue: 0,
      returnedValue: 0, cancelledValue: 0,
      splitOrders: 0, splitValue: 0, creditValue: 0, creditOrders: 0,
      extraChargeValue: 0, itemCount: 0,
    })
  }
  const st = W.get(id)
  const items = o.order_items || []
  const isPaid = (o.status || '').toLowerCase() === 'paid'
  const isOpen = !isPaid
  const pm = (o.payment_method || '').toLowerCase()

  for (const i of items) {
    const dest = normalizeDestination(
      i.destination || i.menu_items?.menu_categories?.destination,
      i.menu_items?.name,
      i.menu_items?.menu_categories?.name
    )
    const qty = i.quantity || 0
    const val = (i.total_price || 0) + (i.extra_charge || 0)
    const cancelled = (i.status || '').toLowerCase() === 'cancelled'
    const returned = i.return_requested || i.return_accepted
    if ((dest === 'kitchen' || dest === 'griller') && !cancelled && !returned) {
      st.kitchenDelivered += qty
      st.kitchenDeliveredValue += val
      if (isOpen) { st.openKitchenQty += qty; st.openKitchenValue += val }
    }
    if (returned) st.returnedValue += val
    if (cancelled) st.cancelledValue += val
    st.extraChargeValue += i.extra_charge || 0
    st.itemCount += qty
  }

  if (isPaid) {
    const net = netAmount(items)
    const rem = getRemittance(o.payment_method, net)
    st.paidOrders++
    st.paidSales += net
    st.cashExpected += rem.cash
    st.transferExpected += rem.transfer
    if (pm.startsWith('split')) { st.splitOrders++; st.splitValue += net }
    if (pm === 'credit') { st.creditOrders++; st.creditValue += net }
  } else {
    st.openOrders++
    st.openValue += netAmount(items)
  }

  perOrder.push({
    id: o.id.slice(0, 8),
    waitron: name,
    status: o.status,
    pm: o.payment_method || '',
    net: Math.round(netAmount(items)),
    kitchenQty: items.filter((i) => {
      const dest = normalizeDestination(
        i.destination || i.menu_items?.menu_categories?.destination,
        i.menu_items?.name,
        i.menu_items?.menu_categories?.name
      )
      return (dest === 'kitchen' || dest === 'griller') && validItem(i)
    }).reduce((s, i) => s + (i.quantity || 0), 0),
  })
}

const rows = Array.from(W.values()).sort((a, b) => b.kitchenDeliveredValue - a.kitchenDeliveredValue)

console.log('═'.repeat(150))
console.log('PER-WAITRON: KITCHEN/GRILL DELIVERED  vs  DASHBOARD SALES (remittance basis)')
console.log('═'.repeat(150))
const hdr = ['Waitron','Kitchen qty','Kitchen val','Paid sales','Cash exp','Transf exp','Open ord','Open val','Open kit','Ret val','Canc val']
console.log(hdr.map((h) => h.padEnd(14)).join(''))
console.log('-'.repeat(150))
const T = { kitchenQty:0, kitchenValue:0, paidSales:0, cashExp:0, transExp:0, openOrders:0, openValue:0, openKitchenQty:0, retVal:0, cancVal:0 }
for (const r of rows) {
  console.log([r.name.slice(0,12).padEnd(14), String(r.kitchenDelivered).padEnd(14), String(Math.round(r.kitchenDeliveredValue)).padEnd(14), String(Math.round(r.paidSales)).padEnd(14), String(Math.round(r.cashExpected)).padEnd(14), String(Math.round(r.transferExpected)).padEnd(14), String(r.openOrders).padEnd(14), String(Math.round(r.openValue)).padEnd(14), String(r.openKitchenQty).padEnd(14), String(Math.round(r.returnedValue)).padEnd(14), String(Math.round(r.cancelledValue)).padEnd(14)].join(''))
  T.kitchenQty+=r.kitchenDelivered; T.kitchenValue+=r.kitchenDeliveredValue; T.paidSales+=r.paidSales; T.cashExp+=r.cashExpected; T.transExp+=r.transferExpected; T.openOrders+=r.openOrders; T.openValue+=r.openValue; T.openKitchenQty+=r.openKitchenQty; T.retVal+=r.returnedValue; T.cancVal+=r.cancelledValue
}
console.log('-'.repeat(150))
console.log(['TOTAL'.padEnd(14), String(T.kitchenQty).padEnd(14), String(Math.round(T.kitchenValue)).padEnd(14), String(Math.round(T.paidSales)).padEnd(14), String(Math.round(T.cashExp)).padEnd(14), String(Math.round(T.transExp)).padEnd(14), String(T.openOrders).padEnd(14), String(Math.round(T.openValue)).padEnd(14), String(T.openKitchenQty).padEnd(14), String(Math.round(T.retVal)).padEnd(14), String(Math.round(T.cancVal)).padEnd(14)].join(''))
console.log('')

console.log('═'.repeat(150))
console.log('KEY GAP:  Kitchen delivered value vs dashboard paid sales')
console.log('═'.repeat(150))
console.log(`Kitchen+grill value delivered  : ${fmtN(T.kitchenValue)}`)
console.log(`Paid sales on dashboards       : ${fmtN(T.paidSales)}`)
console.log(`  → Unaccounted (kitchen made, not on paid dashboards): ${fmtN(T.kitchenValue - T.paidSales)}`)
console.log(`  → still-OPEN orders (food made, cash may be taken, order never closed): ${fmtN(T.openValue)}  (${T.openOrders} orders, ${T.openKitchenQty} kitchen items)`)
console.log(`  → return_requested/accepted value (dropped from totals): ${fmtN(T.retVal)}`)
console.log(`  → cancelled value: ${fmtN(T.cancVal)}`)
console.log(`  → split payments (non-first-person cash portions not tracked): ${fmtN(rows.reduce((s,r)=>s+r.splitValue,0))}`)
console.log(`  → credit orders recorded as debt (not remitted): ${fmtN(rows.reduce((s,r)=>s+r.creditValue,0))}`)
console.log('')

console.log('═'.repeat(150))
console.log('OPEN ORDERS (never paid — food/drink served without a recorded sale)')
console.log('═'.repeat(150))
const opens = perOrder.filter((o) => o.status !== 'paid')
for (const o of opens) console.log(`  ${o.id}  ${o.waitron.slice(0,16).padEnd(18)} ${o.status.padEnd(8)} ${o.pm.padEnd(14)} net=${fmtN(o.net)} kitchenQty=${o.kitchenQty}`)
console.log(`Total open orders in window: ${opens.length}\n`)

console.log('═'.repeat(150))
console.log('RETURN / VOID / CANCEL ACTIVITY (value excluded from totals)')
console.log('═'.repeat(150))
for (const o of orders) {
  const bad = (o.order_items || []).filter((i) => i.return_requested || i.return_accepted || (i.status || '').toLowerCase() === 'cancelled')
  if (bad.length === 0) continue
  const name = o.profiles?.full_name || 'Unknown'
  const val = bad.reduce((s, i) => s + (i.total_price || 0) + (i.extra_charge || 0), 0)
  const why = bad.map((i) => `${i.quantity}x ${i.menu_items?.name || '?'}(${i.return_requested ? 'req' : ''}${i.return_accepted ? 'acc' : ''}${(i.status || '').toLowerCase() === 'cancelled' ? 'canc' : ''})`).join(', ')
  console.log(`  ${o.id.slice(0,8)}  ${name.slice(0,16).padEnd(18)} ${o.status.padEnd(8)} ${fmtN(val).padEnd(12)} ${why}`)
}
console.log('')
