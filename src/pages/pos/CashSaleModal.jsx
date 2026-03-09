import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { X, Plus, Minus, Trash2, Search, CheckCircle, Banknote, CreditCard, Smartphone, ShoppingBag, Phone } from 'lucide-react'

export default function CashSaleModal({ type, menuItems, staffId, onSuccess, onClose }) {
  const [orderItems, setOrderItems] = useState([])
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [cashTendered, setCashTendered] = useState('')
  const [step, setStep] = useState('order') // 'order' | 'payment'
  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState(false)
  const [notes, setNotes] = useState('')

  const isTakeaway = type === 'takeaway'

  const categories = ['All', ...new Set(menuItems.map(i => i.menu_categories?.name).filter(Boolean))]

  const filtered = menuItems.filter(item => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase())
    const matchCat = activeCategory === 'All' || item.menu_categories?.name === activeCategory
    return matchSearch && matchCat
  })

  const addItem = (item) => {
    setOrderItems(prev => {
      const existing = prev.find(i => i.id === item.id)
      if (existing) return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.price } : i)
      return [...prev, { ...item, quantity: 1, total: item.price }]
    })
  }

  const removeItem = (itemId) => {
    setOrderItems(prev => {
      const existing = prev.find(i => i.id === itemId)
      if (existing.quantity === 1) return prev.filter(i => i.id !== itemId)
      return prev.map(i => i.id === itemId ? { ...i, quantity: i.quantity - 1, total: (i.quantity - 1) * i.price } : i)
    })
  }

  const total = orderItems.reduce((sum, i) => sum + i.total, 0)
  const change = paymentMethod === 'cash' && cashTendered ? parseFloat(cashTendered) - total : 0

  const canPay = () => {
    if (processing) return false
    if (isTakeaway && !customerName) return false
    if (paymentMethod === 'cash') return parseFloat(cashTendered) >= total
    return true
  }

  const processOrder = async () => {
    if (orderItems.length === 0) return alert('Add at least one item')
    if (isTakeaway && !customerName) return alert('Customer name is required for takeaway')
    setProcessing(true)

    try {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          staff_id: staffId,
          order_type: type,
          status: 'paid',
          payment_method: paymentMethod,
          total_amount: total,
          customer_name: customerName || null,
          customer_phone: customerPhone || null,
          notes,
          closed_at: new Date().toISOString()
        })
        .select()
        .single()

      if (orderError) throw orderError

      const items = orderItems.map(item => ({
        order_id: order.id,
        menu_item_id: item.id,
        quantity: item.quantity,
        unit_price: item.price,
        total_price: item.total,
        status: 'pending',
        destination: item.menu_categories?.destination || 'bar'
      }))

      const { error: itemsError } = await supabase.from('order_items').insert(items)
      if (itemsError) throw itemsError

      setSuccess(true)
      setTimeout(() => { onSuccess() }, 2500)
    } catch (err) {
      alert('Error processing order: ' + err.message)
      setProcessing(false)
    }
  }

  if (success) return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl p-8 text-center max-w-sm w-full border border-gray-800">
        <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={32} className="text-green-400" />
        </div>
        <h3 className="text-white text-xl font-bold mb-1">Order Complete!</h3>
        <p className="text-gray-400 text-sm">{isTakeaway ? `Takeaway for ${customerName}` : 'Cash sale processed'}</p>
        <p className="text-gray-500 text-xs mt-1">Sent to {orderItems.some(i => i.menu_categories?.destination === 'kitchen') ? 'Kitchen' : ''}{orderItems.some(i => i.menu_categories?.destination === 'kitchen') && orderItems.some(i => i.menu_categories?.destination === 'bar') ? ' & ' : ''}{orderItems.some(i => i.menu_categories?.destination === 'bar') ? 'Bar' : ''}</p>
        {paymentMethod === 'cash' && change > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mt-4">
            <p className="text-amber-400 text-xs mb-1">Change to return</p>
            <p className="text-white text-3xl font-bold">₦{change.toLocaleString()}</p>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-2xl border border-gray-800 flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isTakeaway ? 'bg-blue-600' : 'bg-green-600'}`}>
              {isTakeaway ? <Phone size={16} className="text-white" /> : <ShoppingBag size={16} className="text-white" />}
            </div>
            <div>
              <h3 className="text-white font-bold">{isTakeaway ? 'Takeaway Order' : 'Cash Sale'}</h3>
              <p className="text-gray-400 text-xs">{isTakeaway ? 'Phone-in or walk-in takeaway' : 'Counter sale — pay immediately'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={20} /></button>
        </div>

        <div className="flex flex-1 overflow-hidden">

          {/* Left — Menu */}
          <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-800">

            {/* Search */}
            <div className="p-3 border-b border-gray-800 shrink-0">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search items..."
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
              </div>
            </div>

            {/* Categories */}
            <div className="flex gap-2 px-3 py-2 overflow-x-auto border-b border-gray-800 shrink-0">
              {categories.map(cat => (
                <button key={cat} onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${activeCategory === cat ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
                  {cat}
                </button>
              ))}
            </div>

            {/* Items grid */}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="grid grid-cols-2 gap-2">
                {filtered.map(item => (
                  <button key={item.id} onClick={() => addItem(item)}
                    className="bg-gray-800 hover:bg-gray-700 rounded-xl p-3 text-left border border-gray-700 hover:border-amber-500/50 transition-colors">
                    <p className="text-white text-sm font-medium leading-tight">{item.name}</p>
                    <p className="text-amber-400 text-sm font-bold mt-1">₦{item.price.toLocaleString()}</p>
                    <p className="text-gray-500 text-xs mt-0.5">{item.menu_categories?.name}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right — Order + Payment */}
          <div className="w-72 flex flex-col overflow-hidden shrink-0">

            {/* Takeaway customer info */}
            {isTakeaway && (
              <div className="p-3 border-b border-gray-800 space-y-2 shrink-0">
                <input value={customerName} onChange={e => setCustomerName(e.target.value)}
                  placeholder="Customer name *"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
                <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
              </div>
            )}

            {/* Order items */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {orderItems.length === 0 ? (
                <div className="text-center py-8 text-gray-600 text-sm">Tap items to add</div>
              ) : orderItems.map(item => (
                <div key={item.id} className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-1">
                    <button onClick={() => removeItem(item.id)} className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-white">
                      <Minus size={10} />
                    </button>
                    <span className="text-white text-sm w-5 text-center">{item.quantity}</span>
                    <button onClick={() => addItem(item)} className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-white">
                      <Plus size={10} />
                    </button>
                  </div>
                  <span className="text-gray-300 text-xs flex-1 truncate">{item.name}</span>
                  <span className="text-white text-xs font-bold">₦{item.total.toLocaleString()}</span>
                  <button onClick={() => setOrderItems(prev => prev.filter(i => i.id !== item.id))} className="text-red-400">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>

            {/* Notes */}
            <div className="px-3 pb-2 shrink-0">
              <input value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Notes..."
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500" />
            </div>

            {/* Total */}
            {orderItems.length > 0 && (
              <div className="p-3 border-t border-gray-800 space-y-3 shrink-0">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Total</span>
                  <span className="text-amber-400 font-bold text-xl">₦{total.toLocaleString()}</span>
                </div>

                {/* Payment method */}
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { id: 'cash', label: 'Cash', icon: Banknote },
                    { id: 'card', label: 'POS', icon: CreditCard },
                    { id: 'transfer', label: 'Transfer', icon: Smartphone },
                  ].map(m => (
                    <button key={m.id} onClick={() => setPaymentMethod(m.id)}
                      className={`flex flex-col items-center gap-1 py-2 rounded-xl border-2 transition-all text-xs font-medium ${paymentMethod === m.id ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-gray-700 bg-gray-800 text-gray-500'}`}>
                      <m.icon size={14} />
                      {m.label}
                    </button>
                  ))}
                </div>

                {/* Cash tendered */}
                {paymentMethod === 'cash' && (
                  <div className="space-y-2">
                    <input type="number" value={cashTendered} onChange={e => setCashTendered(e.target.value)}
                      placeholder="Amount tendered"
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:border-amber-500" />
                    <div className="grid grid-cols-4 gap-1">
                      {[2000, 5000, 10000, 20000].map(a => (
                        <button key={a} onClick={() => setCashTendered(a.toString())}
                          className="bg-gray-800 border border-gray-700 text-gray-400 text-xs rounded-lg py-1.5 hover:text-white transition-colors">
                          ₦{(a/1000).toFixed(0)}k
                        </button>
                      ))}
                    </div>
                    {cashTendered && parseFloat(cashTendered) >= total && (
                      <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-2 text-center">
                        <p className="text-green-400 text-xs">Change</p>
                        <p className="text-white font-bold">₦{change.toLocaleString()}</p>
                      </div>
                    )}
                  </div>
                )}

                <button onClick={processOrder} disabled={!canPay()}
                  className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold rounded-xl py-3 text-sm transition-colors">
                  {processing ? 'Processing...' : `Confirm ₦${total.toLocaleString()}`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}