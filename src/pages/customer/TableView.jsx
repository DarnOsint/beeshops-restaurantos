import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { sendPushToStaff } from '../../hooks/usePushNotifications'
import { HelpTooltip } from '../../components/HelpTooltip'
import {
  ShoppingCart, X, Plus, Minus, Info, Bell, ChefHat,
  Clock, CheckCircle, Truck, UtensilsCrossed, Search,
  AlertCircle, RefreshCw, Loader, ArrowLeft
} from 'lucide-react'

const ORDER_STATUS = {
  pending:   { label: 'Awaiting approval',  color: 'text-amber-400',  bg: 'bg-amber-400/10',  dot: 'bg-amber-400' },
  accepted:  { label: 'Order confirmed',    color: 'text-blue-400',   bg: 'bg-blue-400/10',   dot: 'bg-blue-400'  },
  declined:  { label: 'Order declined',     color: 'text-red-400',    bg: 'bg-red-400/10',    dot: 'bg-red-400'   },
  cancelled: { label: 'Order cancelled',    color: 'text-gray-400',   bg: 'bg-gray-400/10',   dot: 'bg-gray-400'  },
}

const ITEM_STATUS = {
  pending:   { label: 'Waiting',   icon: Clock,       color: 'text-gray-400'  },
  preparing: { label: 'Preparing', icon: ChefHat,     color: 'text-amber-400' },
  ready:     { label: 'Ready!',    icon: CheckCircle, color: 'text-green-400' },
  delivered: { label: 'Served',    icon: Truck,       color: 'text-blue-400'  },
}

function useElapsed(since) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!since) return
    const tick = () => setElapsed(Math.floor((Date.now() - new Date(since)) / 1000))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [since])
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function ElapsedTimer({ since }) {
  const t = useElapsed(since)
  return <span>{t}</span>
}

function ItemInfoSheet({ item, onClose, onAdd }) {
  if (!item) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full bg-gray-900 rounded-t-3xl p-6 max-h-[80vh] overflow-y-auto">
        <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-5" />
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-white font-bold text-xl">{item.name}</h2>
            <p className="text-amber-400 font-bold text-lg mt-1">₦{item.price?.toLocaleString()}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white mt-1"><X size={22} /></button>
        </div>
        {item.description
          ? <p className="text-gray-300 text-sm leading-relaxed mb-4">{item.description}</p>
          : <p className="text-gray-600 text-sm italic mb-4">No description available.</p>
        }
        <div className="flex items-center gap-2 mb-6">
          <span className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 text-gray-400">{item.menu_categories?.name}</span>
          {!item.is_available && <span className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400">Unavailable</span>}
        </div>
        <button onClick={() => { onAdd(item); onClose() }} disabled={!item.is_available}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 transition-colors">
          <Plus size={18} /> Add to Order
        </button>
      </div>
    </div>
  )
}

export default function TableView() {
  const { tableId } = useParams()
  const [table, setTable]           = useState(null)
  const [menu, setMenu]             = useState([])
  const [categories, setCategories] = useState([])
  const [cart, setCart]             = useState([])
  const [view, setView]             = useState('menu')
  const [activeCategory, setActiveCategory] = useState('All')
  const [search, setSearch]         = useState('')
  const [infoItem, setInfoItem]     = useState(null)
  const [loading, setLoading]       = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [customerOrder, setCustomerOrder] = useState(null)
  const [liveOrder, setLiveOrder]   = useState(null)
  const [waiterCalled, setWaiterCalled]   = useState(false)
  const [callingWaiter, setCallingWaiter] = useState(false)
  const [addedItemId, setAddedItemId]     = useState(null)
  const [error, setError]           = useState(null)

  const fetchAll = async () => {
    try {
      const today = new Date(); today.setHours(0,0,0,0)
      const [tableRes, menuRes, catRes, custOrderRes, liveOrderRes] = await Promise.all([
        supabase.from('tables').select('*, table_categories(name), profiles(id, full_name)').eq('id', tableId).single(),
        supabase.from('menu_items').select('*, menu_categories(name, destination)').eq('is_available', true).order('name'),
        supabase.from('menu_categories').select('*').order('name'),
        supabase.from('customer_orders').select('*').eq('table_id', tableId).in('status', ['pending','accepted']).gte('created_at', today.toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('orders').select('*, order_items(*, menu_items(name))').eq('table_id', tableId).eq('status', 'open').gte('created_at', today.toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (tableRes.data)     setTable(tableRes.data)
      if (menuRes.data)      setMenu(menuRes.data)
      if (catRes.data)       setCategories(catRes.data)
      setCustomerOrder(custOrderRes.data || null)
      setLiveOrder(liveOrderRes.data || null)
      setFetchError(null)
    } catch (e) {
      setFetchError('Could not load menu. Please check your connection and refresh.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAll()
    const channel = supabase.channel(`tableview-${tableId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_orders', filter: `table_id=eq.${tableId}` }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `table_id=eq.${tableId}` }, fetchAll)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'order_items' }, fetchAll)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [tableId])

  const [initialLoadDone, setInitialLoadDone] = useState(false)
  useEffect(() => {
    if (!loading && !initialLoadDone) {
      if (customerOrder) setView('tracking')
      setInitialLoadDone(true)
    }
  }, [loading, customerOrder, initialLoadDone])

  const addToCart = (item) => {
    if (!item.is_available) return
    setCart(prev => {
      const ex = prev.find(i => i.id === item.id)
      if (ex) return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { ...item, quantity: 1 }]
    })
    setAddedItemId(item.id)
    setTimeout(() => setAddedItemId(null), 800)
  }

  const removeFromCart = (itemId) => {
    setCart(prev => {
      const ex = prev.find(i => i.id === itemId)
      if (!ex) return prev
      if (ex.quantity === 1) return prev.filter(i => i.id !== itemId)
      return prev.map(i => i.id === itemId ? { ...i, quantity: i.quantity - 1 } : i)
    })
  }

  const deleteFromCart = (itemId) => setCart(prev => prev.filter(i => i.id !== itemId))
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0)
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0)

  const submitOrder = async () => {
    if (!cart.length || !table) return
    setSubmitting(true); setError(null)
    try {
      const items = cart.map(i => ({
        menu_item_id: i.id, name: i.name, price: i.price,
        quantity: i.quantity, total: i.price * i.quantity,
        destination: i.menu_categories?.destination || 'kitchen',
        category: i.menu_categories?.name || '',
      }))
      const { data, error: err } = await supabase.from('customer_orders').insert({
        table_id: tableId, table_name: table.name,
        status: 'pending', items, total_amount: cartTotal,
      }).select().single()
      if (err) { setError('Failed to place order. Please try again.'); return }
      setCustomerOrder(data); setCart([]); setView('tracking')
    } catch (e) {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const cancelOrder = async () => {
    if (!customerOrder) return
    await supabase.from('customer_orders').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', customerOrder.id)
    setCustomerOrder(null); setView('menu')
  }

  const callWaiter = async () => {
    if (waiterCalled || callingWaiter || !table) return
    setCallingWaiter(true)
    const waitronId = table.assigned_staff || table.profiles?.id || null
    await supabase.from('waiter_calls').insert({
      table_id: tableId, table_name: table.name,
      waitron_id: waitronId,
      waitron_name: table.profiles?.full_name || null, status: 'pending'
    })
    if (waitronId) {
      await sendPushToStaff(waitronId, '🔔 Waiter Called', `${table.name} is calling for assistance`)
    }
    setCallingWaiter(false); setWaiterCalled(true)
    setTimeout(() => setWaiterCalled(false), 30000)
  }

  const filtered = menu.filter(item => {
    const matchCat = activeCategory === 'All' || item.menu_categories?.name === activeCategory
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })
  const allCategories = ['All', ...categories.map(c => c.name)]

  if (loading) return (
    <div className="min-h-full bg-gray-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader size={24} className="text-amber-500 animate-spin" />
        <p className="text-gray-500 text-sm">Loading menu...</p>
      </div>
    </div>
  )

  if (fetchError) return (
    <div className="min-h-full bg-gray-950 flex items-center justify-center p-6">
      <div className="text-center">
        <AlertCircle size={40} className="text-red-400 mx-auto mb-3" />
        <p className="text-white font-bold mb-2">Could not load menu</p>
        <p className="text-gray-500 text-sm mb-4">{fetchError}</p>
        <button onClick={fetchAll} className="bg-amber-500 text-black font-bold px-5 py-2.5 rounded-xl flex items-center gap-2 mx-auto">
          <RefreshCw size={15} /> Try Again
        </button>
      </div>
    </div>
  )

  if (!table) return (
    <div className="min-h-full bg-gray-950 flex items-center justify-center p-6">
      <div className="text-center">
        <p className="text-white font-bold text-lg mb-2">Table not found</p>
        <p className="text-gray-500 text-sm">Please ask your waiter for assistance.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-full bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shrink-0">
              <UtensilsCrossed size={17} className="text-black" />
            </div>
            <div>
              <h1 className="text-white font-bold text-sm leading-tight">Beeshop's Place</h1>
              <p className="text-amber-400 text-xs font-medium">{table.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <HelpTooltip storageKey="customer-tableview" tips={[
              { id: 'tv-browse', title: 'Browsing the Menu', description: 'Scroll through available items and tap any item to add it to your order. Use the category filters at the top to find what you want faster. Tap the ℹ️ icon on any item for more details.' },
              { id: 'tv-cart', title: 'Your Cart', description: 'Tap the amber basket button in the top right to view your cart at any time. You can adjust quantities or remove items before placing your order.' },
              { id: 'tv-order', title: 'Placing Your Order', description: 'When you are ready, tap Place Order from your cart. Your order goes to the waiter for approval before the kitchen or bar starts preparing it. You will see the status update in real time.' },
              { id: 'tv-tracking', title: 'Tracking Your Order', description: 'Switch to the My Order tab to see the live status of your items — Waiting, Preparing, Ready, or Served. The progress bar shows how much of your order has been completed.' },
              { id: 'tv-waiter', title: 'Calling the Waiter', description: 'Tap Call Waiter at any time to alert your assigned waiter. They will receive a notification on their device. Use this if you need assistance, want to add more items, or are ready to pay.' },
            ]} />
            <button onClick={callWaiter} disabled={callingWaiter || waiterCalled}
              className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl transition-all ${waiterCalled ? 'bg-green-500/15 text-green-400 border border-green-500/30' : 'bg-gray-800 text-white hover:bg-gray-700 border border-gray-700'}`}>
              <Bell size={13} />
              {waiterCalled ? 'Called!' : callingWaiter ? '...' : 'Call Waiter'}
            </button>
            {view !== 'tracking' && (
              <button onClick={() => setView('cart')} className="relative w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center">
                <ShoppingCart size={16} className="text-black" />
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white text-[10px] font-bold flex items-center justify-center">{cartCount}</span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="bg-gray-900 border-b border-gray-800 sticky top-[57px] z-20">
        <div className="max-w-lg mx-auto flex">
          {[{ id: 'menu', label: 'Menu' }, { id: 'tracking', label: customerOrder ? 'My Order ●' : 'My Order' }].map(tab => (
            <button key={tab.id} onClick={() => setView(tab.id)}
              className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${view === tab.id ? 'border-amber-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* MENU VIEW */}
      {view === 'menu' && (
        <div className="flex-1 flex flex-col max-w-lg mx-auto w-full">
          <div className="px-4 pt-4 pb-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search menu..."
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-amber-500" />
            </div>
          </div>
          <div className="flex gap-2 px-4 py-2 overflow-x-auto">
            {allCategories.map(cat => (
              <button key={cat} onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${activeCategory === cat ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                {cat}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {filtered.length === 0 && <div className="py-16 text-center text-gray-600">No items found</div>}
            <div className="grid grid-cols-2 gap-3 pt-2">
              {filtered.map(item => {
                const inCart = cart.find(i => i.id === item.id)
                const isAdded = addedItemId === item.id
                return (
                  <div key={item.id} className={`relative bg-gray-900 border rounded-2xl overflow-hidden transition-all ${!item.is_available ? 'border-gray-800 opacity-50' : isAdded ? 'border-green-500 scale-[0.98]' : 'border-gray-800 hover:border-amber-500/40'}`}>
                    <button onClick={e => { e.stopPropagation(); setInfoItem(item) }}
                      className="absolute top-2 right-2 z-10 w-6 h-6 bg-gray-800/90 rounded-lg flex items-center justify-center text-gray-400 hover:text-white">
                      <Info size={11} />
                    </button>
                    {isAdded && (
                      <div className="absolute inset-0 flex items-center justify-center bg-green-500/10 z-10 rounded-2xl">
                        <CheckCircle size={32} className="text-green-400" />
                      </div>
                    )}
                    <button onClick={() => item.is_available && addToCart(item)} disabled={!item.is_available} className="w-full p-3 text-left">
                      <div className="w-full h-20 bg-gray-800 rounded-xl overflow-hidden mb-2 flex items-center justify-center">
                        {item.image_url
                          ? <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                          : <UtensilsCrossed size={24} className="text-gray-700" />}
                      </div>
                      <p className="text-white text-sm font-semibold leading-tight">{item.name}</p>
                      <p className="text-amber-400 font-bold text-sm mt-1">₦{item.price?.toLocaleString()}</p>
                      {!item.is_available && <p className="text-red-400 text-xs mt-1">Unavailable</p>}
                    </button>
                    {inCart && item.is_available && (
                      <div className="absolute bottom-2 right-2 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center">
                        <span className="text-black text-[10px] font-bold">{inCart.quantity}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          {cartCount > 0 && (
            <div className="sticky bottom-0 bg-gray-950 px-4 pb-4 pt-2 border-t border-gray-800">
              <button onClick={() => setView('cart')}
                className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-4 rounded-2xl flex items-center justify-between px-5 shadow-xl transition-colors">
                <span className="bg-black/20 text-black text-sm font-bold px-2.5 py-1 rounded-lg">{cartCount}</span>
                <span>View Order</span>
                <span className="font-bold">₦{cartTotal.toLocaleString()}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* CART VIEW */}
      {view === 'cart' && (
        <div className="flex-1 flex flex-col max-w-lg mx-auto w-full">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
            <button onClick={() => setView('menu')} className="text-gray-400 hover:text-white"><ArrowLeft size={20} /></button>
            <h2 className="text-white font-bold">Your Order</h2>
          </div>
          {cart.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
              <ShoppingCart size={48} className="text-gray-700" />
              <p className="text-gray-500 text-sm text-center">Your cart is empty.</p>
              <button onClick={() => setView('menu')} className="bg-amber-500 text-black font-bold px-6 py-2.5 rounded-xl">Browse Menu</button>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-4">
                {cart.map(item => (
                  <div key={item.id} className="flex items-center gap-3 py-3 border-b border-gray-800 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{item.name}</p>
                      <p className="text-gray-500 text-xs">₦{item.price?.toLocaleString()} each</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => removeFromCart(item.id)} className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-white"><Minus size={12} /></button>
                      <span className="text-white font-bold text-sm w-5 text-center">{item.quantity}</span>
                      <button onClick={() => addToCart(item)} className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-white"><Plus size={12} /></button>
                    </div>
                    <div className="text-right min-w-[60px]">
                      <p className="text-white text-sm font-bold">₦{(item.price * item.quantity).toLocaleString()}</p>
                      <button onClick={() => deleteFromCart(item.id)} className="text-red-400 text-xs hover:text-red-300">Remove</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="sticky bottom-0 bg-gray-950 border-t border-gray-800 px-4 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Total</span>
                  <span className="text-white font-bold text-xl">₦{cartTotal.toLocaleString()}</span>
                </div>
                <p className="text-gray-600 text-xs text-center">Your order will be sent to your waiter for approval before preparation begins.</p>
                {error && (
                  <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                    <AlertCircle size={14} className="text-red-400" />
                    <p className="text-red-400 text-xs">{error}</p>
                  </div>
                )}
                <button onClick={submitOrder} disabled={submitting}
                  className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-colors">
                  {submitting ? <><Loader size={16} className="animate-spin" /> Sending...</> : 'Place Order'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* TRACKING VIEW */}
      {view === 'tracking' && (
        <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-4 py-4 space-y-4 pb-24">
          {customerOrder && (
            <div className={`rounded-2xl border p-4 ${customerOrder.status === 'pending' ? 'bg-amber-500/5 border-amber-500/20' : customerOrder.status === 'accepted' ? 'bg-blue-500/5 border-blue-500/20' : customerOrder.status === 'declined' ? 'bg-red-500/5 border-red-500/20' : 'bg-gray-800 border-gray-700'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full animate-pulse ${ORDER_STATUS[customerOrder.status]?.dot}`} />
                  <span className={`text-sm font-bold ${ORDER_STATUS[customerOrder.status]?.color}`}>{ORDER_STATUS[customerOrder.status]?.label}</span>
                </div>
                <span className="text-gray-500 text-xs"><ElapsedTimer since={customerOrder.created_at} /> ago</span>
              </div>
              {customerOrder.status === 'pending' && (
                <>
                  <p className="text-gray-400 text-xs mb-1">{table.profiles?.full_name ? `${table.profiles.full_name} will review your order shortly.` : 'Your waiter will review your order shortly.'}</p>
                  <p className="text-gray-600 text-xs">Usually confirmed within 2 minutes.</p>
                  <button onClick={cancelOrder} className="mt-3 w-full border border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-500/30 text-sm font-medium py-2.5 rounded-xl transition-colors">Cancel Order</button>
                </>
              )}
              {customerOrder.status === 'accepted' && <p className="text-gray-400 text-xs">Confirmed by {customerOrder.accepted_by_name || 'your waiter'}. Your items are being prepared.</p>}
              {customerOrder.status === 'declined' && (
                <>
                  <p className="text-gray-400 text-xs mb-1">{customerOrder.decline_reason || 'Your order could not be accepted at this time.'}</p>
                  <button onClick={() => { setCustomerOrder(null); setView('menu') }} className="mt-2 text-amber-400 text-xs font-medium underline">Order again</button>
                </>
              )}
              <div className="mt-3 space-y-1.5">
                {customerOrder.items?.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">{item.quantity}x {item.name}</span>
                    <span className="text-gray-500">₦{item.total?.toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-gray-800 mt-2">
                  <span className="text-gray-400 font-medium">Total</span>
                  <span className="text-amber-400 font-bold">₦{customerOrder.total_amount?.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          {liveOrder && liveOrder.order_items?.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                <p className="text-white font-bold text-sm">Order Progress</p>
                <button onClick={fetchAll} className="text-gray-600 hover:text-gray-400"><RefreshCw size={13} /></button>
              </div>
              {(() => {
                const items = liveOrder.order_items
                const total = items.length
                const served = items.filter(i => i.status === 'delivered').length
                const ready  = items.filter(i => i.status === 'ready').length
                const pct = Math.round(((served + ready * 0.5) / total) * 100)
                return (
                  <div className="px-4 pt-3 pb-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-gray-500 text-xs">{served} of {total} served</span>
                      <span className="text-amber-400 text-xs font-bold">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })()}
              <div className="divide-y divide-gray-800">
                {liveOrder.order_items.map(item => {
                  const cfg = ITEM_STATUS[item.status] || ITEM_STATUS.pending
                  const Icon = cfg.icon
                  return (
                    <div key={item.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="flex-1">
                        <p className="text-white text-sm font-medium">{item.menu_items?.name}</p>
                        <p className="text-gray-600 text-xs">Qty: {item.quantity}</p>
                      </div>
                      <div className={`flex items-center gap-1.5 text-xs font-medium ${cfg.color}`}>
                        <Icon size={13} />{cfg.label}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
                <span className="text-gray-500 text-sm">Total</span>
                <span className="text-amber-400 font-bold">₦{liveOrder.total_amount?.toLocaleString()}</span>
              </div>
            </div>
          )}

          {!customerOrder && !liveOrder && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <UtensilsCrossed size={48} className="text-gray-700" />
              <div className="text-center">
                <p className="text-white font-bold mb-1">No active order</p>
                <p className="text-gray-500 text-sm">Browse the menu and place your order.</p>
              </div>
              <button onClick={() => setView('menu')} className="bg-amber-500 text-black font-bold px-6 py-2.5 rounded-xl">Browse Menu</button>
            </div>
          )}

          {(customerOrder?.status === 'accepted' || liveOrder) && (
            <button onClick={() => setView('menu')}
              className="w-full border border-amber-500/30 text-amber-400 hover:bg-amber-500/5 font-medium py-3 rounded-2xl flex items-center justify-center gap-2 transition-colors text-sm">
              <Plus size={16} /> Add More Items
            </button>
          )}

          <button onClick={callWaiter} disabled={waiterCalled || callingWaiter}
            className={`w-full font-medium py-3 rounded-2xl flex items-center justify-center gap-2 text-sm border transition-colors ${waiterCalled ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-gray-900 text-white border-gray-700 hover:border-gray-600'}`}>
            <Bell size={16} />
            {waiterCalled ? 'Waiter is on the way!' : 'Call Waiter'}
          </button>
        </div>
      )}

      <ItemInfoSheet item={infoItem} onClose={() => setInfoItem(null)} onAdd={addToCart} />
    </div>
  )
}
