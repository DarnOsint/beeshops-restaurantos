import { useState, useEffect, useCallback } from 'react'
import { Beer, ChefHat, Printer, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const todayStr = () => new Date().toISOString().slice(0, 10)

interface StockEntry {
  id: string
  item_name: string
  unit: string
  opening_qty: number
  received_qty: number
  sold_qty: number
  void_qty: number
  closing_qty: number
  note?: string
}

interface Props {
  type: 'bar' | 'kitchen'
}

export default function StockSummaryTab({ type }: Props) {
  const [date, setDate] = useState(todayStr())
  const [entries, setEntries] = useState<StockEntry[]>([])
  const [soldMap, setSoldMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const tableName = type === 'bar' ? 'bar_chiller_stock' : 'kitchen_stock'
  const destination = type === 'bar' ? 'bar' : 'kitchen'
  const label = type === 'bar' ? 'Bar Chiller' : 'Kitchen'
  const Icon = type === 'bar' ? Beer : ChefHat

  const fetchData = useCallback(
    async (d: string) => {
      setLoading(true)
      const dayStart = new Date(d)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(d)
      dayEnd.setHours(23, 59, 59, 999)

      const [entriesRes, soldRes] = await Promise.all([
        supabase.from(tableName).select('*').eq('date', d).order('item_name'),
        supabase
          .from('order_items')
          .select('quantity, menu_items(name)')
          .eq('destination', destination)
          .eq('status', 'delivered')
          .gte('created_at', dayStart.toISOString())
          .lte('created_at', dayEnd.toISOString()),
      ])

      setEntries((entriesRes.data || []) as StockEntry[])

      const map: Record<string, number> = {}
      if (soldRes.data) {
        for (const item of soldRes.data as unknown as Array<{
          quantity: number
          menu_items: { name: string } | null
        }>) {
          const name = item.menu_items?.name
          if (name) map[name] = (map[name] || 0) + item.quantity
        }
      }
      setSoldMap(map)
      setLoading(false)
    },
    [tableName, destination]
  )

  useEffect(() => {
    fetchData(date)
  }, [date, fetchData])

  const totalOpening = entries.reduce((s, e) => s + e.opening_qty, 0)
  const totalReceived = entries.reduce((s, e) => s + e.received_qty, 0)
  const totalSold = entries.reduce((s, e) => s + (soldMap[e.item_name] || e.sold_qty || 0), 0)
  const totalVoid = entries.reduce((s, e) => s + e.void_qty, 0)
  const totalClosing = entries.reduce((s, e) => s + e.closing_qty, 0)
  const totalExpected = totalOpening + totalReceived - totalSold - totalVoid
  const totalVariance = totalExpected - totalClosing

  const printReport = () => {
    const W = 40
    const div = '-'.repeat(W)
    const sol = '='.repeat(W)
    const row = (l: string, r: string) => {
      const left = l.substring(0, W - r.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const fmtDate = new Date(date).toLocaleDateString('en-NG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    const lines = [
      '',
      ctr("BEESHOP'S PLACE"),
      ctr(`${label.toUpperCase()} STOCK REPORT`),
      div,
      row('Date:', fmtDate),
      row('Items:', String(entries.length)),
      div,
      row('Opening:', String(totalOpening)),
      row('Received:', String(totalReceived)),
      row('Sold (POS):', String(totalSold)),
      row('Void:', String(totalVoid)),
      row('Closing:', String(totalClosing)),
      sol,
      row('Expected:', String(totalExpected)),
      row('Variance:', String(totalVariance)),
      sol,
      div,
      ctr('ITEM BREAKDOWN'),
      div,
      ...entries.map((e) => {
        const sold = soldMap[e.item_name] || e.sold_qty || 0
        const expected = e.opening_qty + e.received_qty - sold - e.void_qty
        const variance = expected - e.closing_qty
        return [
          row(e.item_name, `(${e.unit})`),
          row(`  O:${e.opening_qty} R:${e.received_qty}`, `S:${sold} V:${e.void_qty}`),
          row(`  Exp:${expected} Act:${e.closing_qty}`, `Var:${variance}`),
          e.note ? `  ${e.note}` : '',
          '',
        ]
          .filter(Boolean)
          .join('\n')
      }),
      div,
      '',
      ctr('*** END OF REPORT ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${label} Stock — ${fmtDate}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
    const w = window.open('', '_blank', 'width=500,height=700,toolbar=no,menubar=no')
    if (!w) return
    w.document.open('text/html', 'replace')
    w.document.write(html)
    w.document.close()
    w.onafterprint = () => w.close()
    w.onload = () =>
      setTimeout(() => {
        try {
          w.print()
        } catch {
          /* closed */
        }
      }, 200)
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="date"
          value={date}
          max={todayStr()}
          onChange={(e) => setDate(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={() => setDate(todayStr())}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${date === todayStr() ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
        >
          Today
        </button>
        <button
          onClick={() => {
            const d = new Date(date)
            d.setDate(d.getDate() - 1)
            setDate(d.toISOString().slice(0, 10))
          }}
          className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white transition-colors"
        >
          Prev Day
        </button>
        <button onClick={() => fetchData(date)} className="text-gray-400 hover:text-white p-2">
          <RefreshCw size={14} />
        </button>
        {entries.length > 0 && (
          <button
            onClick={printReport}
            className="flex items-center gap-1 px-3 py-2 bg-gray-800 text-gray-400 hover:text-white rounded-xl text-xs transition-colors ml-auto"
          >
            <Printer size={12} /> Print
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-amber-500">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12">
          <Icon size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">
            No {label.toLowerCase()} stock data for {date}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
            {[
              { label: 'Opening', value: totalOpening, color: 'text-white' },
              { label: 'Received', value: totalReceived, color: 'text-green-400' },
              { label: 'Sold', value: totalSold, color: 'text-blue-400' },
              { label: 'Void', value: totalVoid, color: 'text-red-400' },
              { label: 'Closing', value: totalClosing, color: 'text-cyan-400' },
              {
                label: 'Variance',
                value: totalVariance,
                color:
                  totalVariance > 0
                    ? 'text-red-400'
                    : totalVariance < 0
                      ? 'text-blue-400'
                      : 'text-green-400',
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="bg-gray-900 border border-gray-800 rounded-xl p-2 text-center"
              >
                <p className={`text-lg font-bold ${color}`}>{value}</p>
                <p className="text-gray-500 text-[9px] uppercase tracking-wider">{label}</p>
              </div>
            ))}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Item</th>
                  <th className="text-right px-2 py-2">Open</th>
                  <th className="text-right px-2 py-2">Rcvd</th>
                  <th className="text-right px-2 py-2">Sold</th>
                  <th className="text-right px-2 py-2">Void</th>
                  <th className="text-right px-2 py-2">Close</th>
                  <th className="text-right px-2 py-2">Var</th>
                  <th className="text-left px-2 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const sold = soldMap[e.item_name] || e.sold_qty || 0
                  const expected = e.opening_qty + e.received_qty - sold - e.void_qty
                  const variance = expected - e.closing_qty
                  return (
                    <tr key={e.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                      <td className="text-white px-3 py-2 font-medium">{e.item_name}</td>
                      <td className="text-gray-300 text-right px-2 py-2">{e.opening_qty}</td>
                      <td className="text-green-400 text-right px-2 py-2">
                        {e.received_qty || '–'}
                      </td>
                      <td className="text-blue-400 text-right px-2 py-2">{sold || '–'}</td>
                      <td className="text-red-400 text-right px-2 py-2">{e.void_qty || '–'}</td>
                      <td className="text-cyan-400 text-right px-2 py-2 font-bold">
                        {e.closing_qty}
                      </td>
                      <td
                        className={`text-right px-2 py-2 font-bold ${variance > 0 ? 'text-red-400' : variance < 0 ? 'text-blue-400' : 'text-green-400'}`}
                      >
                        {variance === 0
                          ? '✓'
                          : variance > 0
                            ? `−${variance}`
                            : `+${Math.abs(variance)}`}
                      </td>
                      <td
                        className="text-gray-500 px-2 py-2 max-w-[120px] truncate"
                        title={e.note || ''}
                      >
                        {e.note || '–'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-700 bg-gray-800/50 font-bold text-sm">
                  <td className="text-white px-3 py-2">TOTAL</td>
                  <td className="text-white text-right px-2 py-2">{totalOpening}</td>
                  <td className="text-green-400 text-right px-2 py-2">{totalReceived}</td>
                  <td className="text-blue-400 text-right px-2 py-2">{totalSold}</td>
                  <td className="text-red-400 text-right px-2 py-2">{totalVoid}</td>
                  <td className="text-cyan-400 text-right px-2 py-2">{totalClosing}</td>
                  <td
                    className={`text-right px-2 py-2 ${totalVariance > 0 ? 'text-red-400' : totalVariance < 0 ? 'text-blue-400' : 'text-green-400'}`}
                  >
                    {totalVariance === 0
                      ? '✓'
                      : totalVariance > 0
                        ? `−${totalVariance}`
                        : `+${Math.abs(totalVariance)}`}
                  </td>
                  <td className="px-2 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
