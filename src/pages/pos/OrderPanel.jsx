import { useState } from 'react'
import { Plus, Minus, Trash2, Send, X } from 'lucide-react'

export default function OrderPanel({ table, menuItems, onPlaceOrder, onClose }) {
  const [orderItems, setOrderItems] = useState([])
  const [activeCategory, setActiveCategory] = useState('All')
  const [notes, setNotes] = useState('')

  const categories = ['All', ...new Set(menuItems.map(item => item.menu_categories?.name).filter(Boolean))]

  const filteredMenu = activeCategory === 'All'
    ? menuItems
    : menuItems.filter(item => item.menu_categories?.name === activeCategory)

  const addItem = (item) => {
    setOrderItems(prev => {
      const existing = prev.find(i => i.id === item.id)
      if (existing) {
        return prev.map(i => i.id === item.id
          ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.price }
          : i
        )
      }
      return [...prev, { ...item, quantity: 1, total: item.price }]
    })
  }

  const removeItem = (itemId) => {
    setOrderItems(prev => {
      const existing = prev.find(i => i.id === itemId)
      if (existing.quantity === 1) return prev.filter(i => i.id !== itemId)
      return prev.map(i => i.id === itemId
        ? { ...i, quantity: i.quantity - 1, total: (i.quantity - 1) * i.price }
        : i
      )
    })
  }

  const deleteItem = (itemId) => {
    setOrderItems(prev => prev.filter(i => i.id !== itemId))
  }

  const total = orderItems.reduce((sum, item) => sum + item.total, 0)

  const handlePlaceOrder = () => {
    if (orderItems.length === 0) return
    onPlaceOrder({ table, items: orderItems, notes, total })
    setOrderItems([])
    setNotes('')
  }

  return (
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
                className="bg-gray-800 hover:bg-gray-700 rounded-xl p-3 text-left transition-colors border border-gray-700 hover:border-amber-500/50"
              >
                <p className="text-white text-sm font-medium">{item.name}</p>
                <p className="text-amber-400 text-sm font-bold mt-1">₦{item.price.toFixed(2)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Order Summary */}
      {orderItems.length > 0 && (
        <div className="border-t border-gray-800 p-3 space-y-2 max-h-48 overflow-y-auto">
          {orderItems.map(item => (
            <div key={item.id} className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => removeItem(item.id)}
                  className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-white"
                >
                  <Minus size={10} />
                </button>
                <span className="text-white text-sm w-5 text-center">{item.quantity}</span>
                <button
                  onClick={() => addItem(item)}
                  className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-white"
                >
                  <Plus size={10} />
                </button>
              </div>
              <span className="text-gray-300 text-sm flex-1">{item.name}</span>
              <span className="text-white text-sm">R{item.total.toFixed(2)}</span>
              <button onClick={() => deleteItem(item.id)} className="text-red-400">
                <Trash2 size={14} />
              </button>
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
          Send to Kitchen
        </button>
      </div>
    </div>
  )
}