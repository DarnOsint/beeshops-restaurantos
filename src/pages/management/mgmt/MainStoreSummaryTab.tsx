import { useState, useEffect, useCallback } from 'react'
import { Package, RefreshCw, Search, Download } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

interface InventoryItem {
  id: string
  item_name: string
  category: string | null
  unit: string
  current_stock: number
  minimum_stock: number
  cost_price: number | null
}

interface StoreRequest {
  id: string
  item_name: string
  quantity: number
  unit: string
  requested_by_name: string | null
  status: string
  approved_by_name: string | null
  reject_reason: string | null
  created_at: string
  resolved_at: string | null
}

const todayWAT = () => {
  const now = new Date()
  const wat = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
  if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
  return wat.toLocaleDateString('en-CA')
}

export default function MainStoreSummaryTab() {
  const [view, setView] = useState<'inventory' | 'requests'>('inventory')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [requests, setRequests] = useState<StoreRequest[]>([])
  const [search, setSearch] = useState('')
  const [date, setDate] = useState(todayWAT())
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const dayStart = new Date(date + 'T08:00:00+01:00')
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const [{ data: inv }, { data: reqs }] = await Promise.all([
      supabase
        .from('inventory')
        .select('id, item_name, category, unit, current_stock, minimum_stock, cost_price')
        .eq('is_active', true)
        .order('item_name'),
      supabase
        .from('store_requests')
        .select('*')
        .gte('created_at', dayStart.toISOString())
        .lt('created_at', dayEnd.toISOString())
        .order('created_at', { ascending: false }),
    ])
    setItems((inv || []) as InventoryItem[])
    setRequests((reqs || []) as StoreRequest[])
    setLoading(false)
  }, [date])

  useEffect(() => {
    fetchData()
    const ch = supabase
      .channel('mgmt-store')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_requests' }, fetchData)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [fetchData])

  const filtered = items.filter(
    (i) =>
      i.item_name.toLowerCase().includes(search.toLowerCase()) ||
      (i.category || '').toLowerCase().includes(search.toLowerCase())
  )

  const outOfStock = items.filter((i) => i.current_stock <= 0).length
  const lowStock = items.filter(
    (i) => i.current_stock > 0 && i.current_stock <= i.minimum_stock
  ).length
  const totalValue = items.reduce(
    (s, i) => s + (i.current_stock || 0) * (i.cost_price || 0),
    0
  )

  const approvedReqs = requests.filter((r) => r.status === 'approved')
  const rejectedReqs = requests.filter((r) => r.status === 'rejected')
  const pendingReqs = requests.filter((r) => r.status === 'pending')
  const totalMoved = approvedReqs.reduce((s, r) => s + r.quantity, 0)

  // Group approved by requester
  const byRequester: Record<string, { count: number; qty: number }> = {}
  approvedReqs.forEach((r) => {
    const name = r.requested_by_name || 'Unknown'
    if (!byRequester[name]) byRequester[name] = { count: 0, qty: 0 }
    byRequester[name].count++
    byRequester[name].qty += r.quantity
  })

  const exportCsv = () => {
    const lines = [
      ['Time', 'Item', 'Qty', 'Unit', 'Requested By', 'Status', 'Approved By', 'Reject Reason'],
      ...requests.map((r) => [
        new Date(r.created_at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }),
        r.item_name,
        String(r.quantity),
        r.unit,
        r.requested_by_name || '',
        r.status,
        r.approved_by_name || '',
        r.reject_reason || '',
      ]),
    ]
    const csv = lines
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `store_requests_${date}.csv`
    a.click()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setView('inventory')}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${view === 'inventory' ? 'bg-amber-500 text-black' : 'bg-gray-900 text-gray-400 border border-gray-800 hover:text-white'}`}
        >
          Inventory
        </button>
        <button
          onClick={() => setView('requests')}
          className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${view === 'requests' ? 'bg-amber-500 text-black' : 'bg-gray-900 text-gray-400 border border-gray-800 hover:text-white'}`}
        >
          Store Requests
        </button>
        <button onClick={fetchData} className="p-2 text-gray-400 hover:text-white">
          <RefreshCw size={14} />
        </button>
      </div>

      {loading ? (
        <div className="text-amber-500 text-center py-8">Loading...</div>
      ) : view === 'inventory' ? (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Total Items', value: items.length, color: 'text-white' },
              {
                label: 'Out of Stock',
                value: outOfStock,
                color: outOfStock > 0 ? 'text-red-400' : 'text-green-400',
              },
              {
                label: 'Low Stock',
                value: lowStock,
                color: lowStock > 0 ? 'text-amber-400' : 'text-green-400',
              },
              {
                label: 'Stock Value',
                value: `₦${totalValue.toLocaleString()}`,
                color: 'text-purple-400',
              },
            ].map((k) => (
              <div
                key={k.label}
                className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center"
              >
                <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                <p className="text-gray-500 text-[10px] uppercase tracking-wider">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Inventory table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Item</th>
                  <th className="text-left px-2 py-2">Category</th>
                  <th className="text-right px-2 py-2">Stock</th>
                  <th className="text-right px-2 py-2">Min</th>
                  <th className="text-left px-2 py-2">Unit</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                    <td className="text-white px-3 py-2 font-medium">{item.item_name}</td>
                    <td className="text-gray-400 px-2 py-2">{item.category || '—'}</td>
                    <td
                      className={`text-right px-2 py-2 font-bold ${item.current_stock <= 0 ? 'text-red-400' : item.current_stock <= item.minimum_stock ? 'text-amber-400' : 'text-green-400'}`}
                    >
                      {item.current_stock}
                    </td>
                    <td className="text-gray-500 text-right px-2 py-2">{item.minimum_stock}</td>
                    <td className="text-gray-500 px-2 py-2">{item.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          {/* Date picker */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={date}
              max={todayWAT()}
              onChange={(e) => setDate(e.target.value)}
              className="bg-gray-900 border border-gray-800 text-white text-xs rounded-lg px-2 py-1.5"
            />
            <button
              onClick={() => setDate(todayWAT())}
              className={`px-2 py-1.5 text-xs rounded-lg ${date === todayWAT() ? 'bg-amber-500 text-black font-bold' : 'bg-gray-900 text-gray-400 border border-gray-800'}`}
            >
              Today
            </button>
            <button
              onClick={() => {
                const d = new Date(date)
                d.setDate(d.getDate() - 1)
                setDate(d.toLocaleDateString('en-CA'))
              }}
              className="px-2 py-1.5 text-xs bg-gray-900 text-gray-400 border border-gray-800 rounded-lg"
            >
              Prev Day
            </button>
            {requests.length > 0 && (
              <button
                onClick={exportCsv}
                className="ml-auto p-1.5 text-gray-400 hover:text-white bg-gray-900 border border-gray-800 rounded-lg"
              >
                <Download size={14} />
              </button>
            )}
          </div>

          {/* Request summary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Total Requests', value: requests.length, color: 'text-white' },
              {
                label: 'Approved',
                value: approvedReqs.length,
                color: 'text-green-400',
              },
              {
                label: 'Rejected',
                value: rejectedReqs.length,
                color: rejectedReqs.length > 0 ? 'text-red-400' : 'text-gray-400',
              },
              { label: 'Items Moved', value: totalMoved, color: 'text-blue-400' },
            ].map((k) => (
              <div
                key={k.label}
                className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center"
              >
                <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                <p className="text-gray-500 text-[10px] uppercase tracking-wider">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Who took what */}
          {Object.keys(byRequester).length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h4 className="text-white text-sm font-bold mb-2">Who took what (approved)</h4>
              <div className="space-y-1.5">
                {Object.entries(byRequester)
                  .sort((a, b) => b[1].qty - a[1].qty)
                  .map(([name, v]) => (
                    <div
                      key={name}
                      className="flex items-center justify-between py-1 border-b border-gray-800 last:border-0"
                    >
                      <span className="text-gray-300 text-sm">{name}</span>
                      <span className="text-amber-400 text-sm font-bold">
                        {v.qty} items ({v.count} request{v.count > 1 ? 's' : ''})
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Requests list */}
          {requests.length === 0 ? (
            <div className="text-center py-8">
              <Package size={32} className="text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No store requests for this date</p>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                    <th className="text-left px-3 py-2">Time</th>
                    <th className="text-left px-2 py-2">Item</th>
                    <th className="text-right px-2 py-2">Qty</th>
                    <th className="text-left px-2 py-2">By</th>
                    <th className="text-left px-2 py-2">Status</th>
                    <th className="text-left px-2 py-2">Approved By</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="border-t border-gray-800 hover:bg-gray-800/50">
                      <td className="text-gray-400 px-3 py-2">
                        {new Date(r.created_at).toLocaleTimeString('en-NG', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'Africa/Lagos',
                        })}
                      </td>
                      <td className="text-white px-2 py-2 font-medium">{r.item_name}</td>
                      <td className="text-blue-400 text-right px-2 py-2 font-bold">
                        {r.quantity}
                      </td>
                      <td className="text-gray-300 px-2 py-2">
                        {r.requested_by_name || '—'}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${r.status === 'approved' ? 'bg-green-500/20 text-green-400' : r.status === 'rejected' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="text-gray-400 px-2 py-2">{r.approved_by_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
