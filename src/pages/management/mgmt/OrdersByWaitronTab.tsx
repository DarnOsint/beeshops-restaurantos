import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { RefreshCw, Download } from 'lucide-react'

type Dest = 'bar' | 'kitchen' | 'griller' | 'shisha' | 'games'

interface Row {
  waitron: string
  count: number
  total: number
}

const sessionWindow = () => {
  const now = new Date()
  const lagos = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  const start = new Date(lagos)
  start.setHours(8, 0, 0, 0)
  if (lagos.getHours() < 8) start.setDate(start.getDate() - 1)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

export default function OrdersByWaitronTab({
  destinations,
  title,
}: {
  destinations: Dest[]
  title: string
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const { start, end } = useMemo(() => sessionWindow(), [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('order_items')
      .select(
        'quantity, total_price, destination, orders(profiles(full_name)), menu_items(menu_categories(destination))'
      )
      .gte('created_at', start)
      .lte('created_at', end)

    const map: Record<string, Row> = {}
    ;(data || []).forEach(
      (oi: {
        quantity?: number
        total_price?: number
        destination?: string | null
        orders?: { profiles?: { full_name?: string | null } | null } | null
        menu_items?: { menu_categories?: { destination?: string | null } | null } | null
      }) => {
        const dest = (
          oi.destination ||
          oi.menu_items?.menu_categories?.destination ||
          ''
        ).toLowerCase()
        if (!destinations.includes(dest as Dest)) return
        const name = oi.orders?.profiles?.full_name || 'Unknown'
        if (!map[name]) map[name] = { waitron: name, count: 0, total: 0 }
        map[name].count += oi.quantity || 0
        map[name].total += oi.total_price || 0
      }
    )
    setRows(Object.values(map).sort((a, b) => b.total - a.total))
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [load])

  const exportCsv = () => {
    const lines = [
      ['Waitron', 'Items', 'Value'],
      ...rows.map((r) => [r.waitron, String(r.count), String(r.total)]),
    ]
    const csv = lines
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/\s+/g, '_').toLowerCase()}_${start.slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-white font-bold text-lg">{title}</h3>
        <button
          onClick={load}
          className="p-2 text-gray-400 hover:text-white bg-gray-900 rounded-xl border border-gray-800"
        >
          <RefreshCw size={15} />
        </button>
        <button
          onClick={exportCsv}
          className="p-2 text-gray-400 hover:text-white bg-gray-900 rounded-xl border border-gray-800"
        >
          <Download size={15} />
        </button>
      </div>
      {loading ? (
        <div className="text-amber-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500">No orders in this session.</div>
      ) : (
        <div className="overflow-x-auto bg-gray-900 border border-gray-800 rounded-xl">
          <table className="min-w-full text-sm text-white">
            <thead className="bg-gray-800 text-gray-300">
              <tr>
                <th className="px-3 py-2 text-left">Waitron</th>
                <th className="px-3 py-2 text-right">Items</th>
                <th className="px-3 py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.waitron} className="border-t border-gray-800">
                  <td className="px-3 py-2">{r.waitron}</td>
                  <td className="px-3 py-2 text-right">{r.count}</td>
                  <td className="px-3 py-2 text-right">₦{r.total.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
