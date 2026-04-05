import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import DailySummaryTab from './DailySummaryTab'
import { useToast } from '../../context/ToastContext'
import { RefreshCw, CheckCircle, X, BarChart2, History, LogOut } from 'lucide-react'
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

function MixologistKDSInner() {
  const { profile, signOut } = useAuth()
  const toast = useToast()
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence('main')
  const [orders, setOrders] = useState<KdsOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [, setTick] = useState(0)
  const [activeTab, setActiveTab] = useState<'orders' | 'summary' | 'history'>('orders')
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

  const updateItemStatus = async (orderId: string, itemId: string, status: 'pending' | 'ready') => {
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
    toast.success('Return Accepted', 'Item tentatively removed — awaiting manager approval')
    if (staffId)
      await sendPushToStaff(
        staffId,
        '↩ Return Accepted by Mixologist',
        `Return accepted for ${tableName ?? 'table'} — pending manager approval`
      )
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
      const dayStart = new Date(targetDate)
      dayStart.setHours(8, 0, 0, 0)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)

      const { data } = await supabase
        .from('returns_log')
        .select('*')
        .eq('status', 'accepted')
        .gte('requested_at', dayStart.toISOString())
        .lte('requested_at', dayEnd.toISOString())
        .order('requested_at', { ascending: false })
      setReturnHistory(((data || []) as any[]).filter((r) => r.barman_name))
    },
    [historyDate, profile]
  )

  useEffect(() => {
    fetchOrders()
    fetchReturnHistory()
    const sub = supabase
      .channel('mixologist-kds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, fetchOrders)
      .subscribe()
    return () => {
      supabase.removeChannel(sub)
    }
  }, [fetchOrders, fetchReturnHistory])

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
                        order.order_items.forEach((i) => updateItemStatus(order.id, i.id, 'ready'))
                      }
                      className="px-3 py-1.5 text-xs rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    >
                      All Ready
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
                        <button
                          onClick={() => updateItemStatus(order.id, item.id, 'ready')}
                          className="px-2 py-1 text-xs rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        >
                          Ready
                        </button>
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
