import { useState, useEffect } from 'react'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import {
  Beer, UtensilsCrossed, Bell, ChevronDown, ChevronUp,
  Clock, CheckCircle, ChefHat, Truck, Search
} from 'lucide-react'

const statusConfig = {
  pending:   { label: 'Waiting', color: 'text-gray-400', bg: 'bg-gray-400/10', icon: Clock },
  preparing: { label: 'Preparing', color: 'text-amber-400', bg: 'bg-amber-400/10', icon: ChefHat },
  ready:     { label: 'Ready!', color: 'text-green-400', bg: 'bg-green-400/10', icon: CheckCircle },
  delivered: { label: 'Delivered', color: 'text-blue-400', bg: 'bg-blue-400/10', icon: Truck },
}

export default function TableView() {
  const { tableId } = useParams()
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence("main")
  if (geoStatus !== "inside") return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />
  const [table, setTable] = useState(null)
  const [order, setOrder] = useState(null)
  const [menu, setMenu] = useState([])
  const [categories, setCategories] = useState([])
  const [view, setView] = useState('order')
  const [loading, setLoading] = useState(true)
  const [callingWaiter, setCallingWaiter] = useState(false)
  const [waiterCalled, setWaiterCalled] = useState(false)
  const [searchMenu, setSearchMenu] = useState('')
  const [expandedCats, setExpandedCats] = useState({})

  useEffect(() => {
    fetchAll()
    const channel = supabase
      .channel(`table-${tableId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, fetchAll)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [tableId])

  const fetchAll = async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [tableRes, orderRes, menuRes, catRes] = await Promise.all([
      supabase.from('tables').select('*, profiles(id, full_name)').eq('id', tableId).single(),
      supabase.from('orders')
        .select('*, order_items(*, menu_items(name, description))')
        .eq('table_id', tableId)
        .eq('status', 'open')
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('menu_items')
        .select('*, menu_categories(name, destination)')
        .eq('is_available', true)
        .order('name'),
      supabase.from('menu_categories').select('*').order('name'),
    ])

    if (tableRes.data) setTable(tableRes.data)
    setOrder(orderRes.data || null)
    setMenu(menuRes.data || [])
    setCategories(catRes.data || [])
    setLoading(false)
  }

  const callWaiter = async () => {
    if (waiterCalled || callingWaiter || !table) return
    setCallingWaiter(true)

    // Get assigned waitron from table
    const waitronId = table.assigned_staff || table.profiles?.id || null
    const waitronName = table.profiles?.full_name || null

    await supabase.from('waiter_calls').insert({
      table_id: tableId,
      table_name: table.name,
      waitron_id: waitronId,
      waitron_name: waitronName,
      status: 'pending'
    })

    setCallingWaiter(false)
    setWaiterCalled(true)
    setTimeout(() => setWaiterCalled(false), 30000)
  }

  const toggleCat = (catId) => {
    setExpandedCats(prev => ({ ...prev, [catId]: !prev[catId] }))
  }

  const filteredMenu = categories.map(cat => ({
    ...cat,
    items: menu.filter(item =>
      item.menu_categories?.name === cat.name &&
      item.name.toLowerCase().includes(searchMenu.toLowerCase())
    )
  })).filter(cat => cat.items.length > 0)

  const overallStatus = (() => {
    if (!order?.order_items?.length) return null
    const statuses = order.order_items.map(i => i.status)
    if (statuses.every(s => s === 'delivered')) return 'delivered'
    if (statuses.some(s => s === 'ready')) return 'ready'
    if (statuses.some(s => s === 'preparing')) return 'preparing'
    return 'pending'
  })()

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-amber-500 text-sm animate-pulse">Loading...</div>
    </div>
  )

  if (!table) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="text-center">
        <p className="text-white font-bold text-lg mb-2">Table not found</p>
        <p className="text-gray-500 text-sm">Please ask your waiter for assistance.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950">

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-5 py-4">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center">
              <Beer size={20} className="text-black" />
            </div>
            <div>
              <h1 className="text-white font-bold">Beeshops Place</h1>
              <p className="text-amber-400 text-xs font-medium">{table.name}</p>
            </div>
          </div>
          <button
            onClick={callWaiter}
            disabled={callingWaiter || waiterCalled}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              waiterCalled
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-amber-500 text-black hover:bg-amber-400 active:scale-95'
            }`}
          >
            <Bell size={15} />
            {waiterCalled ? 'Waiter Called!' : callingWaiter ? 'Calling...' : 'Call Waiter'}
          </button>
        </div>
      </div>

      {/* Tab Toggle */}
      <div className="max-w-lg mx-auto px-5 pt-4">
        <div className="flex bg-gray-900 border border-gray-800 rounded-xl p-1 gap-1">
          <button
            onClick={() => setView('order')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              view === 'order' ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'
            }`}
          >
            <UtensilsCrossed size={15} /> My Order
          </button>
          <button
            onClick={() => setView('menu')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              view === 'menu' ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'
            }`}
          >
            <ChefHat size={15} /> Browse Menu
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-5 py-4 pb-12">

        {/* ORDER VIEW */}
        {view === 'order' && (
          <div className="space-y-4">
            {!order ? (
              <div className="text-center py-12 space-y-5">
                <div className="w-20 h-20 bg-gray-900 rounded-full flex items-center justify-center mx-auto border border-gray-800">
                  <UtensilsCrossed size={32} className="text-gray-600" />
                </div>
                <div>
                  <p className="text-white font-bold text-lg">No order yet</p>
                  <p className="text-gray-500 text-sm mt-1">Your waiter will take your order shortly.</p>
                </div>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => setView('menu')}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors"
                  >
                    <ChefHat size={18} /> Browse Menu
                  </button>
                  <button
                    onClick={callWaiter}
                    disabled={callingWaiter || waiterCalled}
                    className={`w-full font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors border ${
                      waiterCalled
                        ? 'bg-green-500/10 text-green-400 border-green-500/30'
                        : 'bg-gray-900 text-white border-gray-700 hover:border-amber-500/50'
                    }`}
                  >
                    <Bell size={18} />
                    {waiterCalled ? 'Waiter is on the way!' : 'Call Waiter'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {overallStatus && (() => {
                  const cfg = statusConfig[overallStatus]
                  return (
                    <div className={`${cfg.bg} border border-current/20 rounded-xl px-4 py-3 flex items-center gap-3`}>
                      <cfg.icon size={18} className={cfg.color} />
                      <p className={`font-bold text-sm ${cfg.color}`}>
                        {overallStatus === 'pending' && 'Order received — kitchen is being notified'}
                        {overallStatus === 'preparing' && 'Your order is being prepared'}
                        {overallStatus === 'ready' && 'Some items are ready!'}
                        {overallStatus === 'delivered' && 'All items delivered. Enjoy!'}
                      </p>
                    </div>
                  )
                })()}

                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-800">
                    <p className="text-white font-semibold text-sm">Your Order</p>
                    <p className="text-gray-500 text-xs">Order #{order.id.slice(-6).toUpperCase()}</p>
                  </div>
                  <div className="divide-y divide-gray-800">
                    {order.order_items?.map(item => {
                      const cfg = statusConfig[item.status] || statusConfig.pending
                      return (
                        <div key={item.id} className="px-4 py-3 flex items-center justify-between gap-3">
                          <div className="flex-1">
                            <p className="text-white text-sm font-medium">{item.menu_items?.name}</p>
                            <div className={`inline-flex items-center gap-1 mt-1 text-xs px-2 py-0.5 rounded-lg ${cfg.bg} ${cfg.color}`}>
                              <cfg.icon size={10} />
                              {cfg.label}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-gray-400 text-xs">x{item.quantity}</p>
                            <p className="text-white text-sm font-bold">₦{item.total_price?.toLocaleString()}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
                    <p className="text-gray-400 text-sm">Total</p>
                    <p className="text-amber-400 font-bold text-lg">₦{order.total_amount?.toLocaleString()}</p>
                  </div>
                </div>

                <p className="text-gray-600 text-xs text-center">
                  Payment is handled by your waiter. Please do not leave without settling your bill.
                </p>
              </>
            )}
          </div>
        )}

        {/* MENU VIEW */}
        {view === 'menu' && (
          <div className="space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={searchMenu}
                onChange={e => setSearchMenu(e.target.value)}
                placeholder="Search menu..."
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:border-amber-500 text-sm"
              />
            </div>

            <p className="text-gray-500 text-xs text-center">Browse our menu — ask your waiter to place an order</p>

            {filteredMenu.map(cat => (
              <div key={cat.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <button
                  onClick={() => toggleCat(cat.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-white font-semibold text-sm">{cat.name}</span>
                    <span className="text-gray-600 text-xs">{cat.items.length} items</span>
                  </div>
                  {expandedCats[cat.id]
                    ? <ChevronUp size={16} className="text-gray-400" />
                    : <ChevronDown size={16} className="text-gray-400" />
                  }
                </button>

                {expandedCats[cat.id] && (
                  <div className="divide-y divide-gray-800 border-t border-gray-800">
                    {cat.items.map(item => (
                      <div key={item.id} className="px-4 py-3 flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <p className="text-white text-sm font-medium">{item.name}</p>
                          {item.description && (
                            <p className="text-gray-500 text-xs mt-0.5">{item.description}</p>
                          )}
                        </div>
                        <p className="text-amber-400 font-bold text-sm shrink-0">₦{item.price?.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 px-5 py-3 text-center">
        <p className="text-gray-600 text-xs">Beeshops Place · {table.name} · Powered by RestaurantOS</p>
      </div>
    </div>
  )
}