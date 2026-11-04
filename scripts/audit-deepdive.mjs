// READ-ONLY deep-dive on the return/void anomaly + kitchen-vs-paid comparison.
const URL = 'https://qdibeyhdrcrddckouqmc.supabase.co'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var')
  process.exit(1)
}

const fmtN = (n) => '₦' + Math.round(n).toLocaleString('en-NG')

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

// 1) returns_log in window
console.log('═'.repeat(120))
console.log('1) returns_log in window  (who approved the returns)')
console.log('═'.repeat(120))
try {
  const log = await allRows('returns_log', { select: 'id,item_name,quantity,item_total,status,waitron_name,barman_name,requested_at,resolved_at', or: `(requested_at.gte.${start.toISOString()},requested_at.lt.${end.toISOString()})` })
  const byStatus = {}
  for (const r of log) byStatus[r.status] = (byStatus[r.status] || 0) + 1
  console.log('total returns_log rows:', log.length, JSON.stringify(byStatus))
  const byAcceptor = {}
  for (const r of log) {
    const who = r.barman_name || '(none)'
    if (!byAcceptor[who]) byAcceptor[who] = { n: 0, val: 0 }
    byAcceptor[who].n++
    byAcceptor[who].val += r.item_total || 0
  }
  for (const [who, v] of Object.entries(byAcceptor).sort((a, b) => b[1].val - a[1].val))
    console.log(`  accepted/resolved by ${who.padEnd(20)} count=${String(v.n).padEnd(5)} value=${fmtN(v.val)}`)
  console.log('\nFirst 30 log rows:')
  for (const r of log.slice(0, 30))
    console.log(`  ${new Date(r.requested_at).toISOString().slice(11,16)}  ${(r.item_name||'').padEnd(22)} qty=${r.quantity}  ${fmtN(r.item_total||0).padEnd(10)} status=${r.status.padEnd(14)} reqBy=${(r.waitron_name||'').slice(0,14)} accBy=${(r.barman_name||r.kitchen_name||'-').slice(0,14)}`)
} catch (e) { console.log('ERR', e.message) }

// 2) order_items with return flags in window
console.log('\n' + '═'.repeat(120))
console.log('2) order_items with return_requested or return_accepted (window)')
console.log('═'.repeat(120))
try {
  const items = await allRows('order_items', { select: 'id,order_id,quantity,unit_price,total_price,extra_charge,status,destination,return_requested,return_accepted,return_reason,created_at,menu_items(name,menu_categories(destination))', and: `(created_at.gte.${start.toISOString()},created_at.lt.${end.toISOString()})` })
  const ret = items.filter((i) => i.return_requested || i.return_accepted)
  const cancelled = items.filter((i) => (i.status||'').toLowerCase() === 'cancelled')
  const retVal = ret.reduce((s, i) => s + (i.total_price || 0) + (i.extra_charge || 0), 0)
  const cancVal = cancelled.reduce((s, i) => s + (i.total_price || 0) + (i.extra_charge || 0), 0)
  const totalVal = items.reduce((s, i) => s + (i.total_price || 0) + (i.extra_charge || 0), 0)
  console.log(`total order_items: ${items.length}  value=${fmtN(totalVal)}`)
  console.log(`returned: ${ret.length} rows  value=${fmtN(retVal)}  (${(retVal/totalVal*100).toFixed(1)}% of item value)`)
  console.log(`cancelled: ${cancelled.length} rows  value=${fmtN(cancVal)}`)
  const reqOnly = ret.filter((i) => i.return_requested && !i.return_accepted).length
  const accOnly = ret.filter((i) => i.return_accepted && !i.return_requested).length
  const both = ret.filter((i) => i.return_requested && i.return_accepted).length
  console.log(`  requested-only: ${reqOnly}, accepted-only: ${accOnly}, both(req+acc): ${both}`)
  const reasons = {}
  for (const i of ret) reasons[i.return_reason || '(none)'] = (reasons[i.return_reason || '(none)'] || 0) + 1
  console.log('return reasons:', JSON.stringify(reasons, null, 0))
  const byDest = {}
  for (const i of ret) {
    const d = i.menu_items?.menu_categories?.destination || i.destination || '?'
    byDest[d] = (byDest[d] || 0) + (i.total_price || 0) + (i.extra_charge || 0)
  }
  console.log('returned value by destination:', JSON.stringify(byDest))
  // per-waitron via orders
  const orderIds = [...new Set(ret.map((i) => i.order_id))]
  console.log(`distinct orders with returns: ${orderIds.length}`)
} catch (e) { console.log('ERR', e.message) }

// 3) extra_charge double-count check
console.log('\n' + '═'.repeat(120))
console.log('3) extra_charge rows — check if total_price already includes extra_charge')
console.log('═'.repeat(120))
try {
  const rows = await allRows('order_items', { select: 'id,quantity,unit_price,total_price,extra_charge,order_id,created_at', or: `(and(extra_charge.gt.0,created_at.gte.${start.toISOString()},created_at.lt.${end.toISOString()}))` })
  const withCharge = rows.filter((i) => (i.extra_charge || 0) > 0)
  console.log(`rows with extra_charge>0 in window: ${withCharge.length}`)
  for (const i of withCharge.slice(0, 15))
    console.log(`  qty=${i.quantity} unit=${i.unit_price} total_price=${i.total_price} extra_charge=${i.extra_charge}  qty*unit+extra=${i.quantity * (i.unit_price || 0) + (i.extra_charge || 0)}`)
  // sample orders.total_amount vs sum items
  if (withCharge.length > 0) {
    const oid = withCharge[0].order_id
    const ord = await rest(`orders?id=eq.${oid}`, { select: 'id,total_amount,status,payment_method' })
    console.log(`sample order total_amount=${ord[0]?.total_amount}`)
  }
} catch (e) { console.log('ERR', e.message) }

// 4) Kitchen items: delivered vs paid (owner's exact question)
console.log('\n' + '═'.repeat(120))
console.log('4) KITCHEN/GRILL items: printed(delivered) vs paid — the owner comparison')
console.log('═'.repeat(120))
try {
  const orders = await allRows('orders', { select: `id,status,total_amount,payment_method,closed_at,created_at,staff_id,profiles(full_name),order_items(id,quantity,total_price,extra_charge,status,destination,return_requested,return_accepted,menu_items(name,menu_categories(destination)))`, or: `(and(status.eq.paid,closed_at.gte.${start.toISOString()},closed_at.lt.${end.toISOString()}),and(status.neq.paid,created_at.gte.${start.toISOString()},created_at.lt.${end.toISOString()}))` })
  const norm = (dest, catDest) => {
    const d = ((dest || catDest) || '').toLowerCase()
    return d === 'kitchen' ? 'kitchen' : d === 'griller' || d === 'grill' || d === 'grilling' ? 'griller' : d === 'bar' ? 'bar' : 'other'
  }
  const W = new Map()
  for (const o of orders) {
    const name = o.profiles?.full_name || 'Unknown'
    if (!W.has(name)) W.set(name, { kitchenPrintedQty: 0, kitchenPrintedVal: 0, kitchenPaidQty: 0, kitchenPaidVal: 0, barVal: 0, otherVal: 0, paid: 0, open: 0, retBarVal: 0 })
    const st = W.get(name)
    for (const i of o.order_items || []) {
      const d = norm(i.destination, i.menu_items?.menu_categories?.destination)
      const val = (i.total_price || 0) + (i.extra_charge || 0)
      const qty = i.quantity || 0
      const bad = i.return_requested || i.return_accepted || (i.status || '').toLowerCase() === 'cancelled'
      if (d === 'kitchen' || d === 'griller') {
        st.kitchenPrintedQty += qty
        st.kitchenPrintedVal += val
        if ((o.status || '').toLowerCase() === 'paid' && !bad) { st.kitchenPaidQty += qty; st.kitchenPaidVal += val }
      } else if (d === 'bar') {
        st.barVal += val
        if (bad) st.retBarVal += val
      } else st.otherVal += val
    }
    if ((o.status || '').toLowerCase() === 'paid') st.paid++; else st.open++
  }
  console.log(['Waitron','Kitchen printed qty','Kitchen printed val','Kitchen paid val','Δ kitchen (printed-paid)','Bar val','Bar returned val','Total paid sales'].map(h=>h.padEnd(22)).join(''))
  console.log('-'.repeat(176))
  let T = { kpq:0, kpv:0, kpav:0, bv:0, brv:0, ps:0 }
  for (const [name, st] of W) {
    const ps = st.kitchenPaidVal + st.barVal + st.otherVal
    T.kpq += st.kitchenPrintedQty; T.kpv += st.kitchenPrintedVal; T.kpav += st.kitchenPaidVal; T.bv += st.barVal; T.brv += st.retBarVal; T.ps += ps
    console.log([name.slice(0,18).padEnd(22), String(st.kitchenPrintedQty).padEnd(22), fmtN(st.kitchenPrintedVal).padEnd(22), fmtN(st.kitchenPaidVal).padEnd(22), fmtN(st.kitchenPrintedVal - st.kitchenPaidVal).padEnd(22), fmtN(st.barVal).padEnd(22), fmtN(st.retBarVal).padEnd(22), fmtN(ps).padEnd(22)].join(''))
  }
  console.log('-'.repeat(176))
  console.log(['TOTAL'.padEnd(22), String(T.kpq).padEnd(22), fmtN(T.kpv).padEnd(22), fmtN(T.kpav).padEnd(22), fmtN(T.kpv-T.kpav).padEnd(22), fmtN(T.bv).padEnd(22), fmtN(T.brv).padEnd(22), fmtN(T.ps).padEnd(22)].join(''))
  console.log(`\nKitchen printed value  : ${fmtN(T.kpv)}`)
  console.log(`Kitchen value on paid : ${fmtN(T.kpav)}`)
  console.log(`Kitchen Δ (printed vs paid) : ${fmtN(T.kpv - T.kpav)}  (should be ~0 if every printed item was paid)`)
  console.log(`Bar value returned/written off : ${fmtN(T.brv)}  ← main anomaly`)
} catch (e) { console.log('ERR', e.message) }
