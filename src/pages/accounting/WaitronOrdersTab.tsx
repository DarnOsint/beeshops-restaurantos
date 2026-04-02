import { useState, useEffect, useCallback } from 'react'
import { Users, ChevronDown, ChevronUp, Printer, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const todayStr = () => new Date().toISOString().slice(0, 10)

interface WaitronShift {
  staff_id: string
  staff_name: string
  role: string
  zone?: string
  clock_in: string
  clock_out?: string
}

interface WaitronOrder {
  id: string
  total_amount: number
  payment_method: string
  order_type: string
  created_at: string
  closed_at?: string
  tables?: { name: string; table_categories?: { name: string } } | null
  order_items?: Array<{
    quantity: number
    total_price: number
    menu_items?: { name: string } | null
    modifier_notes?: string
  }>
}

export default function WaitronOrdersTab() {
  const [date, setDate] = useState(todayStr())
  const [shifts, setShifts] = useState<WaitronShift[]>([])
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null)
  const [orders, setOrders] = useState<WaitronOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [ordersLoading, setOrdersLoading] = useState(false)

  const fetchShifts = useCallback(async (d: string) => {
    setLoading(true)
    const { data } = await supabase
      .from('attendance')
      .select('staff_id, staff_name, role, clock_in, clock_out')
      .eq('date', d)
      .order('clock_in', { ascending: true })
    if (data) {
      // Deduplicate by staff_id, keep the one with the latest clock_in
      const unique = new Map<string, WaitronShift>()
      for (const s of data as WaitronShift[]) {
        unique.set(s.staff_id, s)
      }
      setShifts(Array.from(unique.values()))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchShifts(date)
    setSelectedStaff(null)
    setOrders([])
  }, [date, fetchShifts])

  const fetchOrders = async (staffId: string) => {
    setSelectedStaff(staffId)
    setOrdersLoading(true)
    const dayStart = new Date(date)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(date)
    dayEnd.setHours(23, 59, 59, 999)
    const { data } = await supabase
      .from('orders')
      .select(
        'id, total_amount, payment_method, order_type, created_at, closed_at, tables(name, table_categories(name)), order_items(quantity, total_price, modifier_notes, menu_items(name))'
      )
      .eq('staff_id', staffId)
      .eq('status', 'paid')
      .gte('closed_at', dayStart.toISOString())
      .lte('closed_at', dayEnd.toISOString())
      .order('closed_at', { ascending: true })
    setOrders((data || []) as unknown as WaitronOrder[])
    setOrdersLoading(false)
  }

  const selectedShift = shifts.find((s) => s.staff_id === selectedStaff)
  const totalSales = orders.reduce((s, o) => s + (o.total_amount || 0), 0)
  const totalItems = orders.reduce(
    (s, o) => s + (o.order_items || []).reduce((ss, i) => ss + i.quantity, 0),
    0
  )

  const printWaitronReport = () => {
    if (!selectedShift || orders.length === 0) return
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
      ctr('WAITRON ORDER REPORT'),
      div,
      row('Waitron:', selectedShift.staff_name),
      row('Date:', fmtDate),
      row('Orders:', String(orders.length)),
      row('Total Sales:', `N${totalSales.toLocaleString()}`),
      row('Total Items:', String(totalItems)),
      div,
      ...orders.map((o, idx) => {
        const zone =
          (o.tables as unknown as { table_categories?: { name: string } })?.table_categories
            ?.name || ''
        const pm = (o.payment_method || '').replace('_', ' ').toUpperCase()
        const time = new Date(o.closed_at || o.created_at).toLocaleTimeString('en-NG', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
        const itemLines = (o.order_items || [])
          .map((i) =>
            row(
              `  ${i.quantity}x ${i.menu_items?.name || i.modifier_notes || 'Item'}`,
              `N${(i.total_price || 0).toLocaleString()}`
            )
          )
          .join('\n')
        return [
          row(
            `${idx + 1}. ${o.tables?.name || o.order_type}${zone ? ` (${zone})` : ''}`,
            `N${o.total_amount.toLocaleString()}`
          ),
          row(`   ${time}`, pm),
          itemLines,
          '',
        ].join('\n')
      }),
      sol,
      row('TOTAL:', `N${totalSales.toLocaleString()}`),
      sol,
      '',
      ctr('*** END OF REPORT ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Waitron Report — ${selectedShift.staff_name}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
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
      </div>

      {loading ? (
        <div className="text-center py-12 text-amber-500">Loading...</div>
      ) : shifts.length === 0 ? (
        <div className="text-center py-12">
          <Users size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">No staff worked on {date}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Staff list */}
          <div className="space-y-2">
            <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">
              {shifts.length} staff on {date}
            </p>
            {shifts.map((s) => (
              <button
                key={s.staff_id}
                onClick={() => fetchOrders(s.staff_id)}
                className={`w-full text-left bg-gray-900 border rounded-xl p-3 transition-colors ${selectedStaff === s.staff_id ? 'border-amber-500 bg-amber-500/5' : 'border-gray-800 hover:border-gray-700'}`}
              >
                <p className="text-white text-sm font-semibold">{s.staff_name}</p>
                <p className="text-gray-500 text-xs capitalize">{s.role}</p>
                <p className="text-gray-600 text-[10px]">
                  {new Date(s.clock_in).toLocaleTimeString('en-NG', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  })}
                  {s.clock_out
                    ? ` — ${new Date(s.clock_out).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true })}`
                    : ' (active)'}
                </p>
              </button>
            ))}
          </div>

          {/* Orders detail */}
          <div className="md:col-span-2">
            {!selectedStaff ? (
              <div className="text-center py-12">
                <p className="text-gray-500 text-sm">Select a staff member to view their orders</p>
              </div>
            ) : ordersLoading ? (
              <div className="text-center py-12 text-amber-500">Loading orders...</div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-white font-bold">{selectedShift?.staff_name}</p>
                    <p className="text-gray-400 text-xs">
                      {orders.length} orders · ₦{totalSales.toLocaleString()} · {totalItems} items
                    </p>
                  </div>
                  {orders.length > 0 && (
                    <button
                      onClick={printWaitronReport}
                      className="flex items-center gap-1 px-3 py-2 bg-gray-800 text-gray-400 hover:text-white rounded-xl text-xs transition-colors"
                    >
                      <Printer size={12} /> Print Report
                    </button>
                  )}
                </div>
                {orders.length === 0 ? (
                  <p className="text-gray-600 text-sm text-center py-8">
                    No paid orders for this staff member on {date}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {orders.map((o, idx) => {
                      const zone = (o.tables as unknown as { table_categories?: { name: string } })
                        ?.table_categories?.name
                      const pm =
                        o.payment_method === 'cash'
                          ? 'Cash'
                          : o.payment_method === 'card'
                            ? 'Bank POS'
                            : o.payment_method === 'credit'
                              ? 'Credit'
                              : o.payment_method?.startsWith('transfer')
                                ? 'Transfer'
                                : o.payment_method || '—'
                      return (
                        <div
                          key={o.id}
                          className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden"
                        >
                          <div className="px-4 py-2.5 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-600 text-xs">{idx + 1}.</span>
                              <span className="text-white text-sm font-semibold">
                                {o.tables?.name || o.order_type}
                              </span>
                              {zone && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                                  {zone}
                                </span>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-amber-400 font-bold text-sm">
                                ₦{o.total_amount.toLocaleString()}
                              </p>
                              <p className="text-gray-500 text-[10px]">
                                {new Date(o.closed_at || o.created_at).toLocaleTimeString('en-NG', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: true,
                                })}{' '}
                                · {pm}
                              </p>
                            </div>
                          </div>
                          <div className="px-4 py-2 bg-gray-950 border-t border-gray-800">
                            <table className="w-full text-xs">
                              <tbody>
                                {(o.order_items || []).map((item, i) => (
                                  <tr key={i}>
                                    <td className="text-gray-500 py-0.5 pr-2 w-8 text-right">
                                      {item.quantity}x
                                    </td>
                                    <td className="text-gray-300 py-0.5">
                                      {item.menu_items?.name || item.modifier_notes || 'Item'}
                                    </td>
                                    <td className="text-gray-400 py-0.5 text-right pl-2">
                                      ₦{(item.total_price || 0).toLocaleString()}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
