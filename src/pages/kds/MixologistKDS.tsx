import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { audit } from '../../lib/audit'
import DailySummaryTab from './DailySummaryTab'
import { useToast } from '../../context/ToastContext'
import { RefreshCw, CheckCircle, X, BarChart2, History, LogOut, Plus, Send } from 'lucide-react'
import ErrorBoundary from '../../components/ErrorBoundary'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'
import type { KdsOrder } from './types'
import { sendPushToStaff } from '../../hooks/usePushNotifications'

const isMixologistItem = (item: KdsOrder['order_items'][number]): boolean => {
  const dest = (item.destination || '').toLowerCase()
  if (dest === 'mixologist') return true
  const catDest = item.menu_items?.menu_categories?.destination?.toLowerCase()
  return catDest === 'mixologist'
}

const dayWindow = (dateStr: string) => {
  // 8am–8am WAT window
  const base = new Date(`${dateStr}T08:00:00+01:00`)
  const end = new Date(base)
  end.setDate(end.getDate() + 1)
  return { start: base.toISOString(), end: end.toISOString() }
}

function MixologistKDSInner() {
  const { profile, signOut } = useAuth()
  const toast = useToast()
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence('main')
  const [orders, setOrders] = useState<KdsOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [, setTick] = useState(0)
  const [activeTab, setActiveTab] = useState<'orders' | 'summary' | 'history' | 'requests'>(
    'orders'
  )
  const [returnItems, setReturnItems] = useState<
    (KdsOrder['order_items'][0] & { tableName: string; orderId: string; staffId?: string | null })[]
  >([])
  const [historyDate, setHistoryDate] = useState(new Date().toISOString().slice(0, 10))
  const [returnHistory, setReturnHistory] = useState<
    Array<{
      id: string
      item_name: string
      quantity: number
      item_total: number
      table_name: string | null
      waitron_name: string | null
      return_reason: string | null
      status: string
      requested_at: string
      resolved_at: string | null
    }>
  >([])
  const [requestLines, setRequestLines] = useState<
    Array<{ id: string; item: string; qty: number }>
  >([{ id: crypto.randomUUID(), item: '', qty: 1 }])
  const [barItems, setBarItems] = useState<Array<{ id: string; name: string }>>([])
  const [mixoReqDate, setMixoReqDate] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
  )
  const [sentRequests, setSentRequests] = useState<
    Array<{
      id: string
      items: Array<{ item: string; qty: number }>
      status: 'pending' | 'approved' | 'rejected'
      at: string
      requested_by?: string | null
      resolved_by?: string | null
    }>
  >([])
  const addRequestLine = () =>
    setRequestLines((prev) => [...prev, { id: crypto.randomUUID(), item: '', qty: 1 }])
  const updateRequestLine = (id: string, field: 'item' | 'qty', value: string | number) =>
    setRequestLines((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, [field]: field === 'qty' ? Number(value) : value } : l
      )
    )
  const removeRequestLine = (id: string) =>
    setRequestLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.id !== id)))
  const loadRequests = useCallback(async () => {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('id', 'mixologist_requests')
      .single()
    if (data?.value) {
      try {
        setSentRequests(JSON.parse(data.value))
      } catch {
        setSentRequests([])
      }
    } else {
      setSentRequests([])
    }
  }, [])

  const submitRequest = async () => {
    const valid = requestLines.filter((l) => l.item && l.qty > 0)
    if (!valid.length) return toast.warning('Add at least one drink and quantity')
    const record = {
      id: crypto.randomUUID(),
      items: valid.map((l) => ({ item: l.item, qty: l.qty })),
      status: 'pending' as const,
      at: new Date().toISOString(),
      requested_by: profile?.full_name || null,
    }
    const updated = [record, ...(sentRequests || [])].slice(0, 50)
    await supabase.from('settings').upsert({
      id: 'mixologist_requests',
      value: JSON.stringify(updated),
      updated_at: new Date().toISOString(),
    })
    await loadRequests()
    setRequestLines([{ id: crypto.randomUUID(), item: '', qty: 1 }])
    audit({
      action: 'MIXO_REQUEST_SENT',
      entity: 'settings',
      entityName: 'mixologist_requests',
      newValue: {
        items: requestLines.filter((l) => l.item).map((l) => ({ item: l.item, qty: l.qty })),
      },
      performer: profile as any,
    })
    toast.success('Sent to bar', 'Waiting for bar approval to release drinks')
  }

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(interval)
  }, [])

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(
        `id, created_at, notes, staff_id, order_type, customer_name,
        tables(name),
        profiles(full_name),
        order_items(id, quantity, status, destination, notes, return_requested, return_accepted, return_reason,
          menu_items(name, menu_categories(name, destination)))`
      )
      .in('status', ['open', 'paid'])
      .order('created_at', { ascending: true })

    if (!error && data) {
      const allOrders = data as unknown as KdsOrder[]
      const mixo = allOrders
        .map((o) => ({
          ...o,
          order_items: o.order_items.filter(
            (i) =>
              isMixologistItem(i) &&
              i.status !== 'delivered' &&
              i.status !== 'ready' &&
              i.status !== 'cancelled' &&
              !i.return_accepted
          ),
        }))
        .filter((o) => o.order_items.length > 0)
      setOrders(mixo)

      const returns: typeof returnItems = []
      allOrders.forEach((o) => {
        o.order_items.forEach((i) => {
          if (isMixologistItem(i) && i.return_requested && !i.return_accepted) {
            returns.push({
              ...i,
              tableName: (o.tables as { name: string } | null)?.name ?? 'Unknown',
              orderId: o.id,
              staffId: o.staff_id,
            })
          }
        })
      })
      setReturnItems(returns)
    }
    setLoading(false)
  }, [])

  const updateItemStatus = async (
    orderId: string,
    itemId: string,
    status: 'pending' | 'preparing' | 'ready'
  ) => {
    const { error } = await supabase.from('order_items').update({ status }).eq('id', itemId)
    if (error) {
      toast.error('Error', 'Failed to update item: ' + error.message)
      return
    }
    if (status === 'ready') {
      const order = orders.find((o) => o.id === orderId)
      if (order?.staff_id)
        sendPushToStaff(
          order.staff_id,
          '🍸 Drinks Ready',
          `${order.tables?.name || 'Customer'} cocktails are ready`
        ).catch(() => {})
    }
    fetchOrders()
  }

  const acceptOrder = async (order: KdsOrder) => {
    const ids = (order.order_items || [])
      .filter((i) => isMixologistItem(i) && String(i.status || '').toLowerCase() === 'pending')
      .map((i) => i.id)
    if (ids.length === 0) return
    const { error } = await supabase
      .from('order_items')
      .update({ status: 'preparing' })
      .in('id', ids)
    if (error) {
      toast.error('Error', 'Failed to accept order: ' + error.message)
      return
    }
    audit({
      action: 'MIXO_ORDER_ACCEPTED',
      entity: 'order_items',
      entityId: order.id,
      entityName: order.tables?.name || order.customer_name,
      newValue: { items: ids.length },
      performer: profile as any,
    })
    toast.success('Accepted', 'Order accepted and started')
    fetchOrders()
  }

  const acceptReturn = async (itemId: string, staffId?: string | null, tableName?: string) => {
    const { error } = await supabase
      .from('order_items')
      .update({ return_accepted: true, return_accepted_at: new Date().toISOString() })
      .eq('id', itemId)
    if (error) {
      toast.error('Error', 'Failed to accept return')
      return
    }
    await supabase
      .from('returns_log')
      .update({
        status: 'bar_accepted',
        barman_id: profile?.id ?? null,
        barman_name: profile?.full_name ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq('order_item_id', itemId)
      .eq('status', 'pending')
    audit({
      action: 'MIXO_RETURN_ACCEPTED',
      entity: 'order_items',
      entityId: itemId,
      newValue: { table: tableName },
      performer: profile as any,
    })
    toast.success('Return Accepted', 'Item tentatively removed — awaiting manager approval')
    if (staffId)
      await sendPushToStaff(
        staffId,
        '↩ Return Accepted by Mixologist',
        `Return accepted for ${tableName ?? 'table'} — pending manager approval`
      )
    fetchOrders()
  }

  const rejectOrder = async (order: KdsOrder) => {
    // Reject all pending mixologist items on this order
    const mixoItemIds = order.order_items
      .filter((i) => isMixologistItem(i) && i.status !== 'ready' && i.status !== 'delivered')
      .map((i) => i.id)
    if (!mixoItemIds.length) return
    const { error } = await supabase
      .from('order_items')
      .update({ status: 'cancelled' })
      .in('id', mixoItemIds)
    if (error) {
      toast.error('Error', 'Failed to reject order: ' + error.message)
      return
    }
    const { data: remaining } = await supabase
      .from('order_items')
      .select('total_price, status')
      .eq('order_id', order.id)
    const newTotal = (remaining || [])
      .filter((r: { status: string }) => r.status !== 'cancelled')
      .reduce((s: number, r: { total_price: number }) => s + (r.total_price || 0), 0)
    await supabase
      .from('orders')
      .update({ total_amount: newTotal, updated_at: new Date().toISOString() })
      .eq('id', order.id)
    if (order.staff_id)
      await sendPushToStaff(
        order.staff_id,
        '❌ Mixologist Rejected Order',
        `Mixologist rejected drinks for ${order.tables?.name || order.customer_name || 'an order'}`
      ).catch(() => {})
    audit({
      action: 'MIXO_ORDER_REJECTED',
      entity: 'orders',
      entityId: order.id,
      entityName: order.tables?.name,
      performer: profile as any,
    })
    toast.success('Order Rejected', 'Mixologist items cancelled and total updated')
    fetchOrders()
  }

  const rejectReturn = async (itemId: string, staffId?: string | null, tableName?: string) => {
    const { error } = await supabase
      .from('order_items')
      .update({
        return_requested: false,
        return_accepted: false,
        return_reason: null,
        return_requested_at: null,
      })
      .eq('id', itemId)
    if (error) {
      toast.error('Error', 'Failed to reject return')
      return
    }
    await supabase
      .from('returns_log')
      .update({
        status: 'rejected',
        barman_id: profile?.id ?? null,
        barman_name: profile?.full_name ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq('order_item_id', itemId)
      .eq('status', 'pending')
    audit({
      action: 'MIXO_RETURN_REJECTED',
      entity: 'order_items',
      entityId: itemId,
      newValue: { table: tableName },
      performer: profile as any,
    })
    toast.success('Return Rejected', 'Item stays on bill')
    if (staffId)
      await sendPushToStaff(
        staffId,
        '❌ Return Rejected',
        `Return rejected for ${tableName ?? 'table'} — item stays on bill`
      )
    fetchOrders()
  }

  const fetchReturnHistory = useCallback(
    async (d?: string) => {
      if (!profile) return
      const targetDate = d || historyDate
      const { start, end } = dayWindow(targetDate)

      const { data } = await supabase
        .from('returns_log')
        .select('*')
        .eq('status', 'accepted')
        .gte('requested_at', start)
        .lte('requested_at', end)
        .order('requested_at', { ascending: false })
      setReturnHistory(((data || []) as any[]).filter((r) => r.barman_name))
    },
    [historyDate, profile]
  )

  useEffect(() => {
    fetchOrders()
    loadRequests()
    fetchReturnHistory()
    supabase
      .from('menu_items')
      .select('id,name,menu_categories(destination)')
      .then(({ data }) => {
        const barList =
          data?.filter(
            (m: any) => (m.menu_categories?.destination || '').toLowerCase() === 'bar'
          ) || []
        setBarItems(barList.map((b: any) => ({ id: b.id, name: b.name })))
      })
    // Poll as a safety net — realtime can drop silently
    const pollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      fetchOrders()
    }, 10000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchOrders()
    }
    document.addEventListener('visibilitychange', onVisible)

    const sub = supabase
      .channel('mixologist-kds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, fetchOrders)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, loadRequests)
      .subscribe()
    return () => {
      clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(sub)
    }
  }, [fetchOrders, fetchReturnHistory, loadRequests])

  if (geoStatus === 'outside')
    return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />

  if (loading) return <div className="p-6 text-amber-500">Loading...</div>

  return (
    <div className="flex flex-col h-full bg-gray-950">
      <header className="px-4 py-3 border-b border-gray-900 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500">Mixologist KDS</p>
          <h1 className="text-white font-bold text-lg">Cocktails & Mocktails</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchOrders}
            className="p-2 bg-gray-900 border border-gray-800 rounded-xl text-gray-400 hover:text-white"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={signOut}
            className="p-2 bg-gray-900 border border-gray-800 rounded-xl text-red-400 hover:text-white"
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>

      <div className="flex border-b border-gray-900 px-4 gap-2">
        {[
          ['orders', 'Orders', 'Orders awaiting mixologist'],
          ['summary', 'Summary', 'Daily item summary'],
          ['history', 'Returns', 'History of approved returns'],
          ['requests', 'Bar Requests', 'Request drinks from bar'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as typeof activeTab)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === id
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'orders' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {orders.length === 0 ? (
            <div className="text-center text-gray-500">No pending drinks</div>
          ) : (
            orders.map((order) => (
              <div
                key={order.id}
                className="bg-gray-900 border border-gray-800 rounded-2xl p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-semibold">
                      {order.tables?.name || order.customer_name || 'Takeaway'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(order.created_at).toLocaleTimeString('en-NG', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                      })}{' '}
                      · by {order.profiles?.full_name || 'Unknown'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        order.order_items
                          .filter((i) => String(i.status || '').toLowerCase() === 'preparing')
                          .forEach((i) => updateItemStatus(order.id, i.id, 'ready'))
                      }
                      className="px-3 py-1.5 text-xs rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    >
                      All Ready
                    </button>
                    <button
                      onClick={() => acceptOrder(order)}
                      className="px-3 py-1.5 text-xs rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30"
                    >
                      Accept Order
                    </button>
                    <button
                      onClick={() => rejectOrder(order)}
                      className="px-3 py-1.5 text-xs rounded-lg bg-red-500/20 text-red-400 border border-red-500/30"
                    >
                      Reject Order
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  {order.order_items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2"
                    >
                      <div>
                        <p className="text-white text-sm font-medium">{item.menu_items?.name}</p>
                        <p className="text-gray-500 text-xs">
                          {item.quantity}x · {item.status}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {String(item.status || '').toLowerCase() === 'pending' ? (
                          <button
                            onClick={() => updateItemStatus(order.id, item.id, 'preparing')}
                            className="px-2 py-1 text-xs rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30"
                          >
                            Accept
                          </button>
                        ) : (
                          <button
                            onClick={() => updateItemStatus(order.id, item.id, 'ready')}
                            className="px-2 py-1 text-xs rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          >
                            Ready
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}

          {returnItems.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3">
              <div className="flex items-center gap-2 text-amber-400 mb-2">
                <History size={14} /> Pending Returns
              </div>
              <div className="space-y-2">
                {returnItems.map((r) => (
                  <div
                    key={r.id}
                    className="bg-gray-800 rounded-xl p-3 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-white text-sm font-semibold">
                        {r.quantity}x {r.menu_items?.name}
                      </p>
                      <p className="text-gray-500 text-xs">
                        {r.tableName} — by {r.waitron_name || 'Unknown'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => acceptReturn(r.id, r.staffId, r.tableName)}
                        className="px-2 py-1 text-xs rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1"
                      >
                        <CheckCircle size={12} /> Accept
                      </button>
                      <button
                        onClick={() => rejectReturn(r.id, r.staffId, r.tableName)}
                        className="px-2 py-1 text-xs rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 flex items-center gap-1"
                      >
                        <X size={12} /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'summary' && (
        <div className="flex-1 overflow-y-auto">
          <DailySummaryTab
            destination="mixologist"
            icon={<BarChart2 size={16} />}
            color="text-emerald-400"
          />
        </div>
      )}

      {activeTab === 'history' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <input
              type="date"
              value={historyDate}
              onChange={(e) => {
                setHistoryDate(e.target.value)
                fetchReturnHistory(e.target.value)
              }}
              className="bg-gray-900 border border-gray-800 text-white text-xs rounded-lg px-2 py-1"
            />
          </div>
          {returnHistory.length === 0 ? (
            <p className="text-gray-500 text-sm">No returns approved on this day.</p>
          ) : (
            returnHistory.map((r) => (
              <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                <p className="text-white text-sm font-semibold">
                  {r.quantity}x {r.item_name}
                </p>
                <p className="text-gray-500 text-xs">
                  {r.table_name || 'N/A'} — by {r.waitron_name || 'Unknown'}
                </p>
                <p className="text-gray-500 text-xs">
                  Accepted at{' '}
                  {new Date(r.resolved_at || r.requested_at).toLocaleTimeString('en-NG', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  })}
                </p>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'requests' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-semibold text-sm">Request drinks from Bar</p>
                <p className="text-gray-500 text-xs">
                  Sent to bar for approval; released from chiller once approved.
                </p>
              </div>
              <button
                onClick={addRequestLine}
                className="px-3 py-1.5 text-xs rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1"
              >
                <Plus size={12} /> Add line
              </button>
            </div>
            <div className="space-y-2">
              {requestLines.map((line) => (
                <div key={line.id} className="grid grid-cols-7 gap-2 items-center">
                  <select
                    value={line.item}
                    onChange={(e) => updateRequestLine(line.id, 'item', e.target.value)}
                    className="col-span-5 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                  >
                    <option value="">Tap to choose a drink</option>
                    {barItems.map((b) => (
                      <option key={b.id} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <div className="col-span-1 flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1">
                    <button
                      onClick={() =>
                        updateRequestLine(line.id, 'qty', Math.max(1, (line.qty || 1) - 1))
                      }
                      className="text-gray-300 hover:text-white text-sm"
                    >
                      −
                    </button>
                    <span className="text-white text-sm w-6 text-center">{line.qty}</span>
                    <button
                      onClick={() => updateRequestLine(line.id, 'qty', (line.qty || 1) + 1)}
                      className="text-gray-300 hover:text-white text-sm"
                    >
                      +
                    </button>
                  </div>
                  <button
                    onClick={() => removeRequestLine(line.id)}
                    className="text-red-400 hover:text-red-300 text-xs"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={submitRequest}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-sm font-semibold"
            >
              <Send size={14} /> Send to Bar
            </button>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <History size={14} className="text-gray-400" />
              <p className="text-white text-sm font-semibold">My Requests</p>
              <input
                type="date"
                value={mixoReqDate}
                onChange={(e) => setMixoReqDate(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1 text-xs ml-auto"
              />
              <button
                onClick={() =>
                  setMixoReqDate(
                    new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
                  )
                }
                className={`px-2 py-1 rounded-lg text-xs ${mixoReqDate === new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }) ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400'}`}
              >
                Today
              </button>
              <button
                onClick={() => {
                  const d = new Date(mixoReqDate)
                  d.setDate(d.getDate() - 1)
                  setMixoReqDate(d.toLocaleDateString('en-CA'))
                }}
                className="px-2 py-1 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-white"
              >
                Prev
              </button>
            </div>
            {(() => {
              const ds = new Date(mixoReqDate + 'T08:00:00+01:00')
              const de = new Date(ds)
              de.setDate(de.getDate() + 1)
              const dayFiltered = sentRequests.filter((r) => {
                const t = new Date(r.at).getTime()
                return t >= ds.getTime() && t < de.getTime()
              })
              return dayFiltered.length === 0 ? (
                <p className="text-gray-500 text-sm">No requests for this date.</p>
              ) : (
                <div className="space-y-2">
                  {dayFiltered.map((r) => (
                    <div
                      key={r.id}
                      className="bg-gray-800 rounded-xl px-3 py-2 flex items-center justify-between"
                    >
                      <div>
                        <p className="text-white text-sm font-semibold">
                          {r.items.map((it) => `${it.qty}x ${it.item}`).join(', ')}
                        </p>
                        <p className="text-gray-500 text-xs">
                          {new Date(r.at).toLocaleTimeString('en-NG', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true,
                          })}{' '}
                          · {r.requested_by || 'Mixologist'}
                        </p>
                      </div>
                      <span
                        className={`text-[11px] px-2 py-1 rounded-lg border ${
                          r.status === 'approved'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : r.status === 'rejected'
                              ? 'bg-red-500/10 text-red-400 border-red-500/30'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

          {(() => {
            const ds2 = new Date(mixoReqDate + 'T08:00:00+01:00')
            const de2 = new Date(ds2)
            de2.setDate(de2.getDate() + 1)
            const dayFiltered2 = sentRequests.filter((r) => {
              const t = new Date(r.at).getTime()
              return t >= ds2.getTime() && t < de2.getTime()
            })
            return dayFiltered2.length > 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
                <p className="text-white font-semibold text-sm">Summary for {mixoReqDate}</p>
                {Object.entries(
                  dayFiltered2.reduce(
                    (acc, r) => {
                      r.items.forEach((it) => {
                        acc[it.item] = (acc[it.item] || 0) + it.qty
                      })
                      return acc
                    },
                    {} as Record<string, number>
                  )
                ).map(([name, qty]) => (
                  <div
                    key={name}
                    className="flex items-center justify-between text-sm text-gray-300"
                  >
                    <span>{name}</span>
                    <span className="text-amber-400">{qty}</span>
                  </div>
                ))}
              </div>
            ) : null
          })()}
        </div>
      )}
    </div>
  )
}

export default function MixologistKDS() {
  return (
    <ErrorBoundary title="Mixologist display error">
      <MixologistKDSInner />
    </ErrorBoundary>
  )
}
