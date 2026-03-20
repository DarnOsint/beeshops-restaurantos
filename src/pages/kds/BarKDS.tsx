import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { sendPushToStaff } from '../../hooks/usePushNotifications'
import { HelpTooltip } from '../../components/HelpTooltip'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'
import { useAuth } from '../../context/AuthContext'
import ErrorBoundary from '../../components/ErrorBoundary'
import { Beer, Clock, LogOut, RefreshCw, CheckCircle, BarChart2 } from 'lucide-react'
import type { KdsOrder } from './types'
import DailySummaryTab from './DailySummaryTab'
import { useToast } from '../../context/ToastContext'

const HELP_TIPS = [
  {
    id: 'bar-incoming',
    title: 'Incoming Orders',
    description:
      'Drink orders from all tables arrive the moment a waitron confirms on the POS. Sorted oldest first — always work top to bottom. Only bar-destined items appear here.',
  },
  {
    id: 'bar-status',
    title: 'Item Status',
    description:
      'Pending → tap to mark Preparing → tap again to mark Ready. Use All Ready to mark the full order at once when all drinks are poured. Items move one way only.',
  },
  {
    id: 'bar-notify',
    title: 'Waitron Notification',
    description:
      'Marking an item or full order ready sends an automatic push notification to the assigned waitron. No shouting across the floor — the system handles it.',
  },
  {
    id: 'bar-urgency',
    title: 'Urgency Colours',
    description:
      'Grey = normal (under 7 min). Amber = getting late (7–15 min). Red = critically overdue (15+ min). Prioritise red cards immediately.',
  },
  {
    id: 'bar-realtime',
    title: 'Live Updates',
    description:
      'The screen updates automatically via Supabase realtime — new tickets appear instantly and disappear when all items are marked ready. No need to refresh.',
  },
]

function getElapsed(createdAt: string): string {
  const total = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
  if (total < 60) return `${total}s`
  return `${Math.floor(total / 60)}m ${total % 60}s`
}
function getUrgencyColor(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  if (mins >= 15) return 'border-red-500 bg-red-500/5'
  if (mins >= 7) return 'border-amber-500 bg-amber-500/5'
  return 'border-gray-700 bg-gray-900'
}
function getTimerColor(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  if (mins >= 15) return 'text-red-400 font-bold'
  if (mins >= 7) return 'text-amber-400 font-bold'
  return 'text-gray-400'
}
function getStatusColor(status: string): string {
  if (status === 'ready') return 'bg-green-500/20 text-green-400 cursor-default'
  return 'bg-gray-700 text-gray-400'
}
function getNextStatus(status: string): string | null {
  if (status === 'pending') return 'ready'
  return null
}

function BarKDSInner() {
  const { profile, signOut } = useAuth()
  const toast = useToast()
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence('main')
  const [orders, setOrders] = useState<KdsOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [, setTick] = useState(0)
  const [activeTab, setActiveTab] = useState<'orders' | 'summary'>('orders')

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(
        `id, created_at, notes, staff_id,
        tables(name),
        order_items(id, quantity, status, destination, notes,
          menu_items(name, menu_categories(name, destination)))`
      )
      .eq('status', 'open')
      .order('created_at', { ascending: true })

    if (!error && data) {
      const bar = (data as unknown as KdsOrder[])
        .map((o) => ({
          ...o,
          order_items: o.order_items.filter(
            (i) =>
              i.menu_items?.menu_categories?.destination === 'bar' &&
              i.status !== 'delivered' &&
              i.status !== 'ready'
          ),
        }))
        .filter((o) => o.order_items.length > 0)
      setOrders(bar)
    }
    setLoading(false)
  }, [])

  const updateItemStatus = async (itemId: string, currentStatus: string, orderId: string) => {
    const nextStatus = getNextStatus(currentStatus)
    if (!nextStatus) return
    const { error } = await supabase
      .from('order_items')
      .update({ status: nextStatus })
      .eq('id', itemId)
    if (error) {
      toast.error('Error', 'Failed to update item: ' + error.message)
      return
    }
    if (nextStatus === 'ready') {
      const order = orders.find((o) => o.id === orderId)
      if (order?.staff_id) {
        const item = order.order_items.find((i) => i.id === itemId)
        await sendPushToStaff(
          order.staff_id,
          '✅ Item Ready',
          `${item?.menu_items?.name || 'Item'} ready for ${order.tables?.name || 'a table'}`
        )
      }
    }
    fetchOrders()
  }

  const markAllReady = async (order: KdsOrder) => {
    // Only mark bar-destined items ready
    const barItemIds = order.order_items
      .filter((i) => i.menu_items?.menu_categories?.destination === 'bar' && i.status !== 'ready')
      .map((i) => i.id)
    if (!barItemIds.length) return
    const { error: baErr } = await supabase
      .from('order_items')
      .update({ status: 'ready' })
      .in('id', barItemIds)
    if (baErr) {
      toast.error('Error', 'Failed to mark all ready: ' + baErr.message)
      return
    }
    if (order.staff_id)
      await sendPushToStaff(
        order.staff_id,
        '✅ Order Ready',
        `Bar order for ${order.tables?.name || 'a table'} is ready to collect`
      )
    fetchOrders()
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchOrders()
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    const channel = supabase
      .channel('bar-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, fetchOrders)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchOrders)
      .subscribe()
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchOrders()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchOrders])

  if (geoStatus === 'outside')
    return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />
  if (loading)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading Bar Display...</div>
      </div>
    )

  return (
    <div className="min-h-full bg-gray-950 flex flex-col">
      <nav className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center">
            <Beer size={18} className="text-black" />
          </div>
          <div>
            <h1 className="text-white font-bold">Bar Display</h1>
            <p className="text-gray-400 text-xs">
              {orders.length} active order{orders.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchOrders} className="text-gray-400 hover:text-white">
            <RefreshCw size={16} />
          </button>
          <p className="text-gray-400 text-sm">{profile?.full_name}</p>
          <HelpTooltip storageKey="bar-kds" tips={HELP_TIPS} />
          <button onClick={signOut} className="text-gray-400 hover:text-white">
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900">
        <button
          onClick={() => setActiveTab('orders')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'orders' ? 'border-amber-500 text-amber-500' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          <Beer size={14} /> Orders
          {orders.length > 0 && (
            <span className="bg-amber-500 text-black text-xs font-bold px-1.5 py-0.5 rounded-full">
              {orders.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('summary')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'summary' ? 'border-amber-500 text-amber-500' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          <BarChart2 size={14} /> Today's Summary
        </button>
      </div>

      {/* Summary Tab */}
      {activeTab === 'summary' && (
        <DailySummaryTab
          destination="bar"
          icon={<Beer size={24} className="text-amber-400" />}
          color="text-amber-400"
        />
      )}

      {/* Orders Tab */}
      {activeTab === 'orders' && (
        <div className="flex-1 p-4 overflow-y-auto">
          {orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                <Beer size={32} className="text-gray-600" />
              </div>
              <p className="text-gray-400 text-lg font-medium">No pending bar orders</p>
              <p className="text-gray-600 text-sm mt-1">
                New orders will appear here automatically
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {orders.map((order) => (
                <div
                  key={order.id}
                  className={`rounded-2xl border-2 p-4 flex flex-col gap-3 transition-colors ${getUrgencyColor(order.created_at)}`}
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-white font-bold text-lg">{order.tables?.name}</h2>
                    <div className="flex items-center gap-1 text-gray-400 text-xs">
                      <Clock size={12} />
                      <span className={getTimerColor(order.created_at)}>
                        {getElapsed(order.created_at)}
                      </span>
                    </div>
                  </div>
                  {order.notes && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                      <p className="text-amber-400 text-xs">📝 {order.notes}</p>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 flex-1">
                    {order.order_items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-amber-400 font-bold text-lg w-6">
                            {item.quantity}x
                          </span>
                          <span className="text-white text-sm">{item.menu_items?.name}</span>
                        </div>
                        <button
                          onClick={() => updateItemStatus(item.id, item.status, order.id)}
                          disabled={item.status === 'ready'}
                          className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${getStatusColor(item.status)}`}
                        >
                          {item.status === 'pending' ? 'Mark Ready' : '✓ Served'}
                        </button>
                      </div>
                    ))}
                  </div>
                  {order.order_items.some((i) => i.status !== 'ready') && (
                    <button
                      onClick={() => markAllReady(order)}
                      className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl py-2.5 flex items-center justify-center gap-2 transition-colors"
                    >
                      <CheckCircle size={16} /> All Ready
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function BarKDS() {
  return (
    <ErrorBoundary title="Bar Display Error">
      <BarKDSInner />
    </ErrorBoundary>
  )
}
