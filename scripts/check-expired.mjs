import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://qdibeyhdrcrddckouqmc.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!serviceKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey)

const start = '2026-05-01T00:00:00.000Z'
const end = '2026-05-23T23:59:59.000Z'

const { data: expired, error } = await supabase
  .from('returns_log')
  .select('*')
  .eq('status', 'expired')
  .gte('resolved_at', start)
  .lte('resolved_at', end)
  .order('resolved_at', { ascending: false })

if (error) {
  console.error('Query error:', error)
  process.exit(1)
}

console.log(`Found ${expired.length} expired returns in May 1-23\n`)

let totalValue = 0
for (const r of expired) {
  totalValue += Number(r.item_total || 0)
  const resolved = new Date(r.resolved_at).toLocaleDateString('en-NG')
  console.log(`${resolved} | ${r.quantity}x ${r.item_name} | N${Number(r.item_total).toLocaleString()} | Waitron: ${r.waitron_name || '?'} | Table: ${r.table_name || '?'}`)
}

console.log(`\nTotal value: N${totalValue.toLocaleString()}`)
console.log(`Total items: ${expired.length}`)
