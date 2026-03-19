import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { RefreshCw, Printer } from 'lucide-react'

interface SummaryItem {
  name: string
  quantity: number
  waitrons: { name: string; quantity: number }[]
}

interface Props {
  destination: 'bar' | 'kitchen' | 'griller'
  icon: React.ReactNode
  color: string
}

export default function DailySummaryTab({ destination, icon, color }: Props) {
  const [summary, setSummary] = useState<SummaryItem[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [loading, setLoading] = useState(true)
  const printRef = useRef<HTMLDivElement>(null)

  const fetchSummary = useCallback(async () => {
    setLoading(true)
    const todayWAT = new Date()
    todayWAT.setHours(0, 0, 0, 0)
    const startUTC = new Date(todayWAT.getTime() - 60 * 60 * 1000).toISOString()

    const { data } = await supabase
      .from('order_items')
      .select(
        `
        quantity,
        status,
        menu_items(name, menu_categories(destination)),
        orders(created_at, profiles(full_name))
      `
      )
      .gte('orders.created_at', startUTC)
      .eq('status', 'ready')

    if (data) {
      const filtered = (
        data as unknown as {
          quantity: number
          status: string
          menu_items: { name: string; menu_categories: { destination: string } } | null
          orders: { created_at: string; profiles: { full_name: string } | null } | null
        }[]
      ).filter((i) => i.menu_items?.menu_categories?.destination === destination && i.orders)

      const itemMap = new Map<string, Map<string, number>>()
      for (const item of filtered) {
        const itemName = item.menu_items?.name || 'Unknown'
        const waitronName = item.orders?.profiles?.full_name || 'Unknown'
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
  }, [destination])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  const handlePrint = () => {
    const label = destination === 'bar' ? 'Drinks' : destination === 'kitchen' ? 'Kitchen' : 'Grill'
    const date = new Date().toLocaleDateString('en-NG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    const time = new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })

    const rows = summary
      .map(
        (item, i) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${i + 1}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:600;">${item.name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">
          ${item.waitrons.map((w) => `${w.name} (${w.quantity})`).join(', ')}
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:bold;text-align:center;">${item.quantity}</td>
      </tr>
    `
      )
      .join('')

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${label} Daily Summary — ${date}</title>
          <style>
            body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; color: #000; }
            h1 { font-size: 16px; margin: 0 0 4px; }
            p { margin: 0 0 12px; color: #555; }
            table { width: 100%; border-collapse: collapse; }
            th { background: #f5f5f5; padding: 8px; text-align: left; border-bottom: 2px solid #ddd; }
            td { vertical-align: top; }
            .total { margin-top: 12px; font-weight: bold; font-size: 14px; text-align: right; }
            .footer { margin-top: 20px; font-size: 10px; color: #999; text-align: center; }
          </style>
        </head>
        <body>
          <h1>Beeshop's Place — ${label} Daily Summary</h1>
          <p>${date} &nbsp;|&nbsp; Printed at ${time} &nbsp;|&nbsp; Total: ${totalItems} items</p>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Item</th>
                <th>Served To (Waitron)</th>
                <th style="text-align:center;">Qty</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="total">Total ${label.toLowerCase()} served: ${totalItems}</div>
          <div class="footer">RestaurantOS — Beeshop's Place Lounge</div>
        </body>
      </html>
    `

    const win = window.open('', '_blank', 'width=700,height=600')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => {
      win.print()
      win.close()
    }, 300)
  }

  const label = destination === 'bar' ? 'drinks' : destination === 'kitchen' ? 'dishes' : 'grills'

  return (
    <div ref={printRef} className="flex-1 p-4 overflow-y-auto">
      {/* Header */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4 flex items-center justify-between">
        <div>
          <p className="text-gray-400 text-xs capitalize">Total {label} served today</p>
          <p className={`text-2xl font-bold ${color}`}>{totalItems}</p>
        </div>
        <div className="flex items-center gap-2">
          {icon}
          <button
            onClick={fetchSummary}
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
