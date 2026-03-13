import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { sendPushToStaff } from '../../hooks/usePushNotifications'
import { HelpTooltip } from '../../components/HelpTooltip'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'
import { useAuth } from '../../context/AuthContext'
import ErrorBoundary from '../../components/ErrorBoundary'
import { ChefHat, Clock, LogOut, RefreshCw, CheckCircle } from 'lucide-react'
import type { KdsOrder } from './types'

/* eslint-disable react-hooks/set-state-in-effect */

const HELP_TIPS = [
  {
    id: 'kds-incoming',
    title: 'Incoming Orders',
    description:
      'Food orders routed to the kitchen appear here automatically the moment a waitron confirms an order on the POS. Orders are sorted oldest first — always work from the top of the screen down.',
  },
  {
    id: 'kds-status',
    title: 'Item Status Buttons',
    description:
      'Each item has a Pending button. Tap it to move to Preparing (shown in amber) — then tap again when the dish is plated to mark it Ready (shown in green). Update items individually as they are cooked.',
  },
  {
    id: 'kds-urgency',
    title: 'Urgency Colours',
    description:
      'Order cards change border colour based on wait time — normal (grey, under 10 minutes), getting late (amber, 10–20 minutes), urgent (red, 20+ minutes). Urgency is based on when the order was first placed, not when each item was added.',
  },
  {
    id: 'kds-notify',
    title: 'Waitron Notification',
    description:
      'When you mark an item Ready, the assigned waitron receives a push notification on their device to come and collect it. You do not need to call out — the system handles it.',
  },
  {
    id: 'kds-realtime',
    title: 'Live Updates',
    description:
      'This screen updates automatically whenever a new order is placed or an item status changes. You do not need to refresh manually, but the refresh button in the top bar can be used if the screen ever appears stuck.',
  },
]

function getElapsed(createdAt: string): string {
  const total = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
  if (total < 60) return `${total}s`
  return `${Math.floor(total / 60)}m ${total % 60}s`
}

function getUrgencyColor(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  if (mins >= 20) return 'border-red-500 bg-red-500/10 shadow-red-500/20 shadow-lg'
  if (mins >= 10) return 'border-amber-500 bg-amber-500/5'
  return 'border-gray-700 bg-gray-900'
}

function getTimerColor(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  if (mins >= 20) return 'text-red-400 font-bold'
  if (mins >= 10) return 'text-amber-400 font-bold'
  return 'text-gray-400'
}

function getStatusColor(status: string): string {
  if (status === 'ready') return 'bg-green-500/20 text-green-400'
  if (status === 'preparing') return 'bg-amber-500/20 text-amber-400'
  return 'bg-gray-700 text-gray-400'
}

function KitchenKDSInner() {
  const { profile, signOut } = useAuth()
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence('main')
  const [orders, setOrders] = useState<KdsOrder[]>([])
  const [loading, setLoading] = useState(true)
  // tick forces re-render every second to update elapsed timers
  const [, setTick] = useState(0)

  const fetchOrders = async () => {
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
      const kitchen = (data as KdsOrder[])
        .map((o) => ({
          ...o,
          order_items: o.order_items.filter(
            (i) =>
              i.menu_items?.menu_categories?.destination === 'kitchen' && i.status !== 'delivered'
          ),
        }))
        .filter((o) => o.order_items.length > 0)
      setOrders(kitchen)
    }
    setLoading(false)
  }

  const updateItemStatus = async (itemId: string, newStatus: string, orderId: string) => {
    await supabase.from('order_items').update({ status: newStatus }).eq('id', itemId)
    if (newStatus === 'ready') {
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
    await supabase
      .from('order_items')
      .update({ status: 'ready' })
      .eq('order_id', order.id)
      .eq('destination', 'kitchen')
    if (order.staff_id)
      await sendPushToStaff(
        order.staff_id,
        '✅ Order Ready',
        `Kitchen order for ${order.tables?.name || 'a table'} is ready to serve`
      )
    fetchOrders()
  }

  useEffect(() => {
    fetchOrders()
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    const channel = supabase
      .channel('kitchen-channel')
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
  }, [])

  if (geoStatus !== 'inside')
    return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />
  if (loading)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading Kitchen Display...</div>
      </div>
    )

  return (
    <div className="min-h-full bg-gray-950 flex flex-col">
      <nav className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-red-500 flex items-center justify-center">
            <ChefHat size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold">Kitchen Display</h1>
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
          <HelpTooltip storageKey="kitchen-kds" tips={HELP_TIPS} />
          <button onClick={signOut} className="text-gray-400 hover:text-white">
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      <div className="flex-1 p-4 overflow-y-auto">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mb-4">
              <ChefHat size={32} className="text-gray-600" />
            </div>
            <p className="text-gray-400 text-lg font-medium">No pending kitchen orders</p>
            <p className="text-gray-600 text-sm mt-1">New orders will appear here automatically</p>
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
                        onClick={() =>
                          updateItemStatus(
                            item.id,
                            item.status === 'pending'
                              ? 'preparing'
                              : item.status === 'preparing'
                                ? 'ready'
                                : 'pending',
                            order.id
                          )
                        }
                        className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${getStatusColor(item.status)}`}
                      >
                        {item.status === 'pending'
                          ? 'Pending'
                          : item.status === 'preparing'
                            ? 'Preparing'
                            : '✓ Ready'}
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => markAllReady(order)}
                  className="w-full bg-green-500 hover:bg-green-400 text-white font-bold rounded-xl py-2.5 flex items-center justify-center gap-2 transition-colors"
                >
                  <CheckCircle size={16} /> All Ready
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function KitchenKDS() {
  return (
    <ErrorBoundary title="Kitchen Display Error">
      <KitchenKDSInner />
    </ErrorBoundary>
  )
}
