import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { RefreshCw, Printer } from 'lucide-react'

interface SummaryItem {
  name: string
  quantity: number
  waitrons: { name: string; quantity: number }[]
}

interface Props {
  destination: 'bar' | 'kitchen' | 'griller' | 'mixologist'
  icon: React.ReactNode
  color: string
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const todayWAT = () =>
  new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' })).toLocaleDateString(
    'en-CA'
  )

const inferDestination = (row: {
  destination?: string | null
  menu_items?: {
    name?: string
    menu_categories?: { destination?: string | null; name?: string } | null
  } | null
}): string => {
  const raw =
    (row.destination || row.menu_items?.menu_categories?.destination || '')
      ?.toString()
      ?.toLowerCase() || ''
  if (raw) return raw
  const name = (row.menu_items?.name || '').toLowerCase()
  const catName = (row.menu_items?.menu_categories?.name || '').toLowerCase()
  const looksMixo =
    name.includes('cocktail') ||
    name.includes('mocktail') ||
    name.includes('milkshake') ||
    name.includes('shake') ||
    name.includes('smoothie') ||
    name.includes('fruit punch') ||
    name.includes('punch') ||
    catName.includes('cocktail') ||
    catName.includes('mocktail')
  if (looksMixo) return 'mixologist'
  return 'bar'
}

export default function DailySummaryTab({ destination, icon, color }: Props) {
  const [summary, setSummary] = useState<SummaryItem[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState(todayWAT())
  const printRef = useRef<HTMLDivElement>(null)

  const fetchSummary = useCallback(
    async (d?: string) => {
      setLoading(true)
      const lagosNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
      const selected = d || date
      let effective = selected
      // If user is viewing "today" before 8am WAT, the business day is yesterday.
      if (selected === todayWAT() && lagosNow.getHours() < 8) {
        const prev = new Date(lagosNow)
        prev.setDate(prev.getDate() - 1)
        effective = prev.toLocaleDateString('en-CA')
      }
      const start = new Date(`${effective}T08:00:00+01:00`)
      const end = new Date(start)
      end.setDate(end.getDate() + 1)

      const { data } = await supabase
        .from('order_items')
        .select(
          `
        quantity,
        status,
        return_accepted,
        destination,
        menu_items(name, menu_categories(name, destination)),
        orders(created_at, order_type, profiles(full_name), tables(table_categories(name)))
      `
        )
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())
      // Summary is sales/served visibility:
      // - Mixologist: include all mixologist items recorded for the day (even if auto-accepted historically).
      // - Other stations: keep the broader summary behavior.

      if (data) {
        const filtered = (
          data as unknown as {
            quantity: number
            status: string
            return_accepted?: boolean
            menu_items: { name: string; menu_categories: { destination: string } } | null
            orders: {
              created_at: string
              order_type?: string
              profiles: { full_name: string } | null
              tables: { table_categories: { name: string } | null } | null
            } | null
          }[]
        ).filter((i) => {
          const itemDest = inferDestination(i as any)
          const cancelled = (i.status || '').toLowerCase() === 'cancelled'
          const acceptedByStation = true
          const hasReturn = i.return_accepted || (i as any).return_requested
          return (
            itemDest === destination && i.orders && !cancelled && !hasReturn && acceptedByStation
          )
        })

        const itemMap = new Map<string, Map<string, number>>()
        for (const item of filtered) {
          const itemName = item.menu_items?.name || 'Unknown'
          const zone = item.orders?.tables?.table_categories?.name
          const staffName = item.orders?.profiles?.full_name || 'Unknown'
          const waitronName = zone ? `${staffName} (${zone})` : staffName
          if (!itemMap.has(itemName)) itemMap.set(itemName, new Map())
          const wm = itemMap.get(itemName)!
          wm.set(waitronName, (wm.get(waitronName) || 0) + item.quantity)
        }

        const result: SummaryItem[] = Array.from(itemMap.entries())
          .map(([name, wm]) => {
            const waitrons = Array.from(wm.entries())
              .map(([wName, qty]) => ({ name: wName, quantity: qty }))
              .sort((a, b) => b.quantity - a.quantity)
            return { name, quantity: waitrons.reduce((s, w) => s + w.quantity, 0), waitrons }
          })
          .sort((a, b) => b.quantity - a.quantity)

        setSummary(result)
        setTotalItems(result.reduce((s, i) => s + i.quantity, 0))
      }
      setLoading(false)
    },
    [destination, date]
  )

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  const handleDateChange = (d: string) => {
    setDate(d)
    fetchSummary(d)
  }

  const handlePrint = () => {
    const label = destination === 'bar' ? 'DRINKS' : destination === 'kitchen' ? 'KITCHEN' : 'GRILL'
    const fmtDate = new Date(date).toLocaleDateString('en-NG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    const fmtTime = new Date().toLocaleTimeString('en-NG', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    const W = 40
    const div = '-'.repeat(W)
    const sol = '='.repeat(W)
    const row = (l: string, r: string) => {
      const left = l.substring(0, W - r.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s

    const lines = [
      '',
      ctr("BEESHOP'S PLACE"),
      ctr(`${label} DAILY SUMMARY`),
      div,
      row('Date:', fmtDate),
      row('Printed:', fmtTime),
      row('Total Items:', String(totalItems)),
      div,
      row('ITEM', 'QTY'),
      div,
      ...summary.map((item, i) => {
        const itemLine = row(`${i + 1}. ${item.name}`, String(item.quantity))
        const waitronLines = item.waitrons.map((w) => `   ${w.name}: ${w.quantity}`).join('\n')
        return itemLine + '\n' + waitronLines
      }),
      sol,
      row('TOTAL:', String(totalItems)),
      sol,
      '',
      ctr('*** END OF SUMMARY ***'),
      '',
    ].join('\n')

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${label} Summary — ${fmtDate}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
    const win = window.open('', '_blank', 'width=500,height=700,toolbar=no,menubar=no')
    if (!win) return
    win.document.open('text/html', 'replace')
    win.document.write(html)
    win.document.close()
    win.onafterprint = () => win.close()
    win.onload = () =>
      setTimeout(() => {
        try {
          win.print()
        } catch {
          /* closed */
        }
      }, 200)
  }

  const label =
    destination === 'bar'
      ? 'drinks'
      : destination === 'kitchen'
        ? 'dishes'
        : destination === 'griller'
          ? 'grills'
          : 'mixologist items'

  return (
    <div ref={printRef} className="flex-1 p-4 overflow-y-auto">
      {/* Header */}
      {/* Date controls */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input
          type="date"
          value={date}
          max={todayWAT()}
          onChange={(e) => handleDateChange(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={() => handleDateChange(todayWAT())}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${date === todayWAT() ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
        >
          Today
        </button>
        <button
          onClick={() => {
            const d = new Date(date)
            d.setDate(d.getDate() - 1)
            handleDateChange(d.toISOString().slice(0, 10))
          }}
          className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white transition-colors"
        >
          Prev Day
        </button>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4 flex items-center justify-between">
        <div>
          <p className="text-gray-400 text-xs capitalize">
            Total {label}{' '}
            {date === todayStr()
              ? 'today'
              : `on ${new Date(date).toLocaleDateString('en-NG', { day: '2-digit', month: 'short' })}`}
          </p>
          <p className={`text-2xl font-bold ${color}`}>{totalItems}</p>
        </div>
        <div className="flex items-center gap-2">
          {icon}
          <button
            onClick={() => fetchSummary()}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-800"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={handlePrint}
            disabled={summary.length === 0}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5 rounded-xl transition-colors"
            title="Print summary"
          >
            <Printer size={13} /> Print
          </button>
        </div>
      </div>

      {loading ? (
        <div className={`text-center py-8 ${color}`}>Loading...</div>
      ) : summary.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">No {label} served yet today</p>
        </div>
      ) : (
        <div className="space-y-3">
          {summary.map((item, i) => (
            <div
              key={item.name}
              className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden"
            >
              {/* Item header */}
              <div className="flex items-center gap-3 p-3">
                <div
                  className={`w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center font-bold text-sm ${color}`}
                >
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{item.name}</p>
                  <p className="text-gray-500 text-xs">
                    {item.waitrons.length} waitron{item.waitrons.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`font-bold text-lg ${color}`}>{item.quantity}</p>
                  <p className="text-gray-500 text-xs">total</p>
                </div>
              </div>
              {/* Waitron breakdown */}
              <div className="border-t border-gray-800 px-3 py-2 space-y-1.5">
                {item.waitrons.map((w) => (
                  <div key={w.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                      <p className="text-gray-300 text-xs">{w.name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 rounded-full bg-gray-700 w-16">
                        <div
                          className={`h-full rounded-full ${color.replace('text-', 'bg-')}`}
                          style={{ width: `${(w.quantity / item.quantity) * 100}%` }}
                        />
                      </div>
                      <p className="text-gray-400 text-xs font-medium w-4 text-right">
                        {w.quantity}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
