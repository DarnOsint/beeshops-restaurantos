import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'
import { useAuth } from '../../context/AuthContext'
import { Beer, Clock, LogOut, RefreshCw, CheckCircle } from 'lucide-react'

export default function BarKDS() {
  const { profile, signOut } = useAuth()
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence("main")
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    fetchOrders()
    const timer = setInterval(() => setTick(t => t + 1), 1000)

    const channel = supabase
      .channel('bar-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, fetchOrders)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchOrders)
      .subscribe()

    clearInterval(timer)
    clearInterval(timer)
    clearInterval(timer)
    return () => supabase.removeChannel(channel)
  }, [])

  const fetchOrders = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        id, created_at, notes,
        tables(name),
        order_items(
          id, quantity, status, destination, notes,
          menu_items(name, menu_categories(name, destination))
        )
      `)
      .eq('status', 'open')
      .order('created_at', { ascending: true })

    if (!error && data) {
      const barOrders = data
        .map(order => ({
          ...order,
          order_items: order.order_items.filter(
            item => item.menu_items?.menu_categories?.destination === 'bar'
              && item.status !== 'delivered'
          )
        }))
        .filter(order => order.order_items.length > 0)

      setOrders(barOrders)
    }
    setLoading(false)
  }

  const updateItemStatus = async (itemId, newStatus) => {
    await supabase
      .from('order_items')
      .update({ status: newStatus })
      .eq('id', itemId)
    fetchOrders()
  }

  const markAllReady = async (orderId) => {
    await supabase
      .from('order_items')
      .update({ status: 'ready' })
      .eq('order_id', orderId)
    fetchOrders()
  }

  const getElapsedTime = (createdAt) => {
    const totalSeconds = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
    if (totalSeconds < 60) return `${totalSeconds}s`
    const mins = Math.floor(totalSeconds / 60)
    const secs = totalSeconds % 60
    return `${mins}m ${secs}s`
  }

  const getUrgencyColor = (createdAt) => {
    const diff = Math.floor((new Date() - new Date(createdAt)) / 1000 / 60)
    if (diff >= 15) return 'border-red-500 bg-red-500/5'
    if (diff >= 7) return 'border-amber-500 bg-amber-500/5'
    return 'border-gray-700 bg-gray-900'
  }

  const getStatusColor = (status) => {
    if (status === 'ready') return 'bg-green-500/20 text-green-400'
    if (status === 'preparing') return 'bg-amber-500/20 text-amber-400'
    return 'bg-gray-700 text-gray-400'
  }

  if (geoStatus !== "inside") return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-amber-500">Loading Bar Display...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">

      <nav className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center">
            <Beer size={18} className="text-black" />
          </div>
          <div>
            <h1 className="text-white font-bold">Bar Display</h1>
            <p className="text-gray-400 text-xs">{orders.length} active order{orders.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchOrders} className="text-gray-400 hover:text-white">
            <RefreshCw size={16} />
          </button>
          <p className="text-gray-400 text-sm">{profile?.full_name}</p>
          <button onClick={signOut} className="text-gray-400 hover:text-white">
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      <div className="flex-1 p-4 overflow-y-auto">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mb-4">
              <Beer size={32} className="text-gray-600" />
            </div>
            <p className="text-gray-400 text-lg font-medium">No pending bar orders</p>
            <p className="text-gray-600 text-sm mt-1">New orders will appear here automatically</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {orders.map(order => (
              <div key={order.id} className={`rounded-2xl border-2 p-4 flex flex-col gap-3 transition-colors ${getUrgencyColor(order.created_at)}`}>

                <div className="flex items-center justify-between">
                  <h2 className="text-white font-bold text-lg">{order.tables?.name}</h2>
                  <div className="flex items-center gap-1 text-gray-400 text-xs">
                    <Clock size={12} />
                    <span className={getTimerColor(order.created_at)}>{getElapsedTime(order.created_at)}</span>
                  </div>
                </div>

                {order.notes && (
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    <p className="text-amber-400 text-xs">📝 {order.notes}</p>
                  </div>
                )}

                <div className="flex flex-col gap-2 flex-1">
                  {order.order_items.map(item => (
                    <div key={item.id} className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-400 font-bold text-lg w-6">{item.quantity}x</span>
                        <span className="text-white text-sm">{item.menu_items?.name}</span>
                      </div>
                      <button
                        onClick={() => updateItemStatus(
                          item.id,
                          item.status === 'pending' ? 'preparing' :
                          item.status === 'preparing' ? 'ready' : 'pending'
                        )}
                        className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${getStatusColor(item.status)}`}
                      >
                        {item.status === 'pending' ? 'Pending' :
                         item.status === 'preparing' ? 'Preparing' : '✓ Ready'}
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => markAllReady(order.id)}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl py-2.5 flex items-center justify-center gap-2 transition-colors"
                >
                  <CheckCircle size={16} />
                  All Ready
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}