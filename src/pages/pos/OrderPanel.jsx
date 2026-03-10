import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import VoidPinModal from '../../components/VoidPinModal'
import { Plus, Minus, Trash2, Send, X, StickyNote } from 'lucide-react'

export default function OrderPanel({ table, menuItems, onPlaceOrder, onClose, activeOrder }) {
  const [orderItems, setOrderItems] = useState(() => {
    if (!activeOrder?.order_items) return []
    return activeOrder.order_items.map(i => ({
      id: i.menu_item_id,
      name: i.menu_items?.name || i.menu_item_id,
      quantity: i.quantity,
      price: i.unit_price,
      total: i.total_price,
      menu_categories: i.menu_items?.menu_categories || null,
      modifier_notes: i.modifier_notes || '',
      extra_charge: i.extra_charge || 0,
      _existing: true // flag so we know it's already in DB
    }))
  })
  const [activeCategory, setActiveCategory] = useState('All')
  const [notes, setNotes] = useState('')
  const [voidRequest, setVoidRequest] = useState(null) // { itemId, itemName, quantity, value }
  const [modifierItem, setModifierItem] = useState(null) // item being edited
  const [modifierNotes, setModifierNotes] = useState('')
  const [modifierCharge, setModifierCharge] = useState('')

  const categories = ['All', ...new Set(menuItems.map(item => item.menu_categories?.name).filter(Boolean))]

  const filteredMenu = activeCategory === 'All'
    ? menuItems
    : menuItems.filter(item => item.menu_categories?.name === activeCategory)

  const addItem = (item) => {
    if (item.current_stock !== null && item.current_stock !== undefined && item.current_stock <= 0) {
      alert(item.name + ' is out of stock')
      return
    }
    setOrderItems(prev => {
      // Only merge into a new (non-existing) entry — never touch locked _existing items
      const newEntry = prev.find(i => i.id === item.id && !i._existing)
      if (newEntry) {
        return prev.map(i => (i.id === item.id && !i._existing)
          ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.price }
          : i
        )
      }
      return [...prev, { ...item, quantity: 1, total: item.price, _existing: false, _newId: crypto.randomUUID() }]
    })
  }

  const removeItem = (itemKey) => {
    setOrderItems(prev => {
      const existing = prev.find(i => (i._newId || i.id) === itemKey)
      if (!existing) return prev
      if (existing.quantity === 1) return prev.filter(i => (i._newId || i.id) !== itemKey)
      return prev.map(i => (i._newId || i.id) === itemKey
        ? { ...i, quantity: i.quantity - 1, total: (i.quantity - 1) * i.price }
        : i
      )
    })
  }

  const deleteItem = (item) => {
    // If order not yet placed (still in cart), just remove directly — no PIN needed
    if (!activeOrder || !item._existing) {
      setOrderItems(prev => prev.filter(i => (i._newId || i.id) !== (item._newId || item.id)))
      return
    }
    // Order already sent to kitchen/bar — require manager void PIN
    setVoidRequest({
      itemId: item.id,
      itemName: item.name,
      quantity: item.quantity,
      value: item.total
    })
  }

  const confirmVoid = async (approver) => {
    const item = orderItems.find(i => i.id === voidRequest.itemId)
    // Log the void
    await supabase.from('void_log').insert({
      menu_item_name: voidRequest.itemName,
      quantity: voidRequest.quantity,
      unit_price: item?.price || 0,
      total_value: voidRequest.value,
      void_type: 'item',
      approved_by_name: approver.name,
      approved_by: approver.id
    })
    setOrderItems(prev => prev.filter(i => i.id !== voidRequest.itemId))
    setVoidRequest(null)
  }

  const openModifier = (item) => {
    setModifierItem(item)
    setModifierNotes(item.modifier_notes || '')
    setModifierCharge(item.extra_charge ? String(item.extra_charge) : '')
  }

  const saveModifier = () => {
    const charge = parseFloat(modifierCharge) || 0
    setOrderItems(prev => prev.map(i => i.id === modifierItem.id
      ? {
          ...i,
          modifier_notes: modifierNotes,
          extra_charge: charge,
          total: (i.quantity * i.price) + charge
        }
      : i
    ))
    setModifierItem(null)
    setModifierNotes('')
    setModifierCharge('')
  }

  const depleteInventory = async (items, action = 'deduct') => {
    for (const item of items) {
      if (!item.menu_item_id) continue
      const { data: inv } = await supabase
        .from('inventory')
        .select('id, current_stock')
        .eq('menu_item_id', item.menu_item_id)
        .single()
      if (!inv) continue
      const newStock = action === 'deduct'
        ? Math.max(0, inv.current_stock - item.quantity)
        : inv.current_stock + item.quantity
      await supabase.from('inventory').update({
        current_stock: newStock,
        updated_at: new Date().toISOString()
      }).eq('id', inv.id)
      // Log to restock_log for audit trail
      await supabase.from('restock_log').insert({
        inventory_id: inv.id,
        change_amount: action === 'deduct' ? -item.quantity : item.quantity,
        reason: action === 'deduct' ? 'sold' : 'void_refund',
        recorded_by: null,
        notes: `Order item: ${item.menu_items?.name || item.menu_item_id}`
      })
    }
  }

  const getSendLabel = () => {
    if (!orderItems.length) return "Confirm Order"
    const destinations = [...new Set(orderItems.map(i => i.menu_categories?.destination || "kitchen"))]
    if (destinations.length === 1) {
      if (destinations[0] === "bar") return "Confirm Order"
      if (destinations[0] === "griller") return "Confirm Order"
      return "Confirm Order"
    }
    return "Confirm Order"
  }

  const total = orderItems.reduce((sum, item) => sum + (item.quantity * item.price) + (item.extra_charge || 0), 0)

  const handlePlaceOrder = async () => {
    if (orderItems.length === 0) return
    const newItems = orderItems.filter(i => !i._existing)
    if (newItems.length === 0 && activeOrder) {
      // no new items added — just go to payment
      await onPlaceOrder({ table, items: [], notes, total: 0 })
      return
    }
    const newTotal = newItems.reduce((sum, i) => sum + (i.total || 0), 0)
    await onPlaceOrder({ table, items: newItems, notes, total: newTotal })
  }

  return (
    <>
    <div className="flex flex-col h-full bg-gray-900">

      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div>
          <h2 className="text-white font-bold">{table.name}</h2>
          <p className="text-gray-400 text-xs">{table.table_categories?.name}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X size={20} />
        </button>
      </div>

      {/* Menu Categories */}
      <div className="flex gap-2 p-3 overflow-x-auto border-b border-gray-800">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              activeCategory === cat
                ? 'bg-amber-500 text-black'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Menu Items */}
      <div className="flex-1 overflow-y-auto p-3">
        {filteredMenu.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No menu items yet</p>
            <p className="text-xs mt-1">Add items in the Back Office</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredMenu.map(item => (
              <button
                key={item.id}
                onClick={() => addItem(item)}
                disabled={item.current_stock !== null && item.current_stock !== undefined && item.current_stock <= 0}
                className={`rounded-xl p-3 text-left transition-colors border ${item.current_stock !== null && item.current_stock !== undefined && item.current_stock <= 0 ? 'bg-gray-900 border-gray-800 opacity-50 cursor-not-allowed' : 'bg-gray-800 hover:bg-gray-700 border-gray-700 hover:border-amber-500/50'}`}
              >
                <p className="text-white text-sm font-medium">{item.name}</p>
                <p className="text-amber-400 text-sm font-bold mt-1">₦{item.price.toFixed(2)}</p>
                {item.current_stock !== null && item.current_stock !== undefined && item.current_stock <= 0 && (
                  <p className="text-red-400 text-xs mt-1 font-bold">Out of Stock</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Order Summary */}
      {orderItems.length > 0 && (
        <div className="border-t border-gray-800 p-3 space-y-2 max-h-48 overflow-y-auto">
          {orderItems.map(item => (
            <div key={item._newId || item.id} className={`flex items-center gap-2 ${item._existing ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => !item._existing && removeItem(item._newId || item.id)}
                  disabled={item._existing}
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${item._existing ? 'bg-gray-800 cursor-not-allowed' : 'bg-gray-700'}`}
                >
                  <Minus size={10} />
                </button>
                <span className="text-white text-sm w-5 text-center">{item.quantity}</span>
                <button
                  onClick={() => !item._existing && addItem(item)}
                  disabled={item._existing}
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${item._existing ? 'bg-gray-800 cursor-not-allowed' : 'bg-gray-700'}`}
                >
                  <Plus size={10} />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <button onClick={() => !item._existing && openModifier(item)} className="text-left w-full" disabled={item._existing}>
                  <p className={`text-sm ${item._existing ? 'text-gray-500' : 'text-gray-300'}`}>{item.name}</p>
                  {item.modifier_notes && (
                    <p className="text-amber-400 text-xs truncate">{item.modifier_notes}</p>
                  )}
                  {item.extra_charge > 0 && (
                    <p className="text-green-400 text-xs">+₦{item.extra_charge.toLocaleString()}</p>
                  )}
                </button>
              </div>
              <span className={`text-sm ${item._existing ? 'text-gray-500' : 'text-white'}`}>₦{item.total.toFixed(2)}</span>
              {!item._existing && (
                <button onClick={() => deleteItem(item)} className="text-red-400">
                  <Trash2 size={14} />
                </button>
              )}
              {item._existing && <div className="w-[14px]" />}
            </div>
          ))}
        </div>
      )}

      {/* Notes */}
      <div className="px-3 pb-2">
        <input
          type="text"
          placeholder="Order notes..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
      </div>

      {/* Place Order Button */}
      <div className="p-3 border-t border-gray-800">
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-400">Total</span>
          <span className="text-white font-bold text-lg">₦{total.toFixed(2)}</span>
        </div>
        <button
          onClick={handlePlaceOrder}
          disabled={orderItems.length === 0}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors"
        >
          <Send size={16} />
          {getSendLabel()}
        </button>
      </div>
    </div>
    {modifierItem && (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end justify-center p-4">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-bold">Modify Item</h3>
            <button onClick={() => setModifierItem(null)} className="text-gray-400 hover:text-white">
              <X size={18} />
            </button>
          </div>
          <p className="text-amber-400 font-medium">{modifierItem.name}</p>
          <div>
            <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Special Instructions</label>
            <textarea
              value={modifierNotes}
              onChange={e => setModifierNotes(e.target.value)}
              placeholder="e.g. no onions, well done, extra spicy..."
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500 resize-none"
            />
          </div>
          <div>
            <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Extra Charge (₦)</label>
            <input
              type="number"
              value={modifierCharge}
              onChange={e => setModifierCharge(e.target.value)}
              placeholder="0"
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500"
            />
            <p className="text-gray-500 text-xs mt-1">Leave blank if no extra charge</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setModifierItem(null)}
              className="py-3 rounded-xl bg-gray-800 text-gray-300 hover:bg-gray-700 font-medium text-sm">
              Cancel
            </button>
            <button onClick={saveModifier}
              className="py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm">
              Save
            </button>
          </div>
        </div>
      </div>
    )}

    {voidRequest && (
      <VoidPinModal
        voidDescription={`Void ${voidRequest.quantity}x ${voidRequest.itemName} (₦${voidRequest.value.toLocaleString()})`}
        onApproved={confirmVoid}
        onCancel={() => setVoidRequest(null)}
      />
    )}
    </>
  )
}