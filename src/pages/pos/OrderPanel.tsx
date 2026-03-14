import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import VoidPinModal from '../../components/VoidPinModal'
import { Plus, Minus, Trash2, Send, X, CheckCircle2, Circle, Search } from 'lucide-react'
import type { Table, MenuItem, Order, OrderItem, Profile } from '../../types'
import { useToast } from '../../context/ToastContext'

interface OrderItemLocal {
  id: string
  order_id?: string
  menu_item_id?: string
  quantity: number
  unit_price?: number
  total_price?: number
  status?: string
  destination?: string
  created_at?: string
  modifier_notes?: string | null
  extra_charge?: number
  _dbId?: string
  _newId?: string
  _existing?: boolean
  name: string
  price: number
  total: number
  menu_categories?: { name?: string; destination?: string } | null
  menu_items?: { name: string } | null
}

interface VoidRequest {
  itemId: string
  itemName: string
  quantity: number
  value: number
}

interface Props {
  table: Table
  menuItems: MenuItem[]
  onPlaceOrder: (payload: {
    table: Table
    items: OrderItemLocal[]
    notes: string
    total: number
  }) => Promise<void>
  onClose: () => void
  paymentInProgress?: boolean
  activeOrder?:
    | (Order & {
        order_items?: (OrderItem & {
          menu_items?: {
            name: string
            menu_categories?: { name?: string; destination?: string } | null
          } | null
        })[]
      })
    | null
  profile?: Profile | null
}

export default function OrderPanel({
  table,
  menuItems,
  onPlaceOrder,
  onClose,
  paymentInProgress = false,
  activeOrder,
  profile,
}: Props) {
  const toast = useToast()
  const [servedItems, setServedItems] = useState<Record<string, boolean>>(() => {
    if (!activeOrder?.order_items) return {}
    return activeOrder.order_items.reduce((acc: Record<string, boolean>, i) => {
      if (i.status === 'delivered') acc[i.id] = true
      return acc
    }, {})
  })

  const dbIdMap = (activeOrder?.order_items || []).reduce((acc: Record<string, string>, i) => {
    acc[i.menu_item_id] = i.id
    return acc
  }, {})

  const markServed = async (item: OrderItemLocal) => {
    if (!activeOrder) return
    const dbId = item._dbId || dbIdMap[item.id]
    if (!dbId) return
    setServedItems((prev) => ({ ...prev, [dbId]: true }))
    const { error } = await supabase
      .from('order_items')
      .update({ status: 'delivered' })
      .eq('id', dbId)
    if (error) {
      setServedItems((prev) => ({ ...prev, [dbId]: false }))
      toast.error('Error', 'Failed to mark item served: ' + error.message)
      return
    }
    // service_log is best-effort — don't block on failure
    await supabase.from('service_log').insert({
      order_id: activeOrder.id,
      order_item_id: dbId,
      table_id: activeOrder.table_id,
      item_name: item.name,
      table_name: table?.name || null,
      served_by: profile?.id || null,
      served_by_name: profile?.full_name || null,
      served_at: new Date().toISOString(),
    })
  }

  const [orderItems, setOrderItems] = useState<OrderItemLocal[]>(() => {
    if (!activeOrder?.order_items) return []
    return activeOrder.order_items.map((i) => ({
      id: i.menu_item_id,
      _dbId: i.id,
      status: i.status,
      name: i.menu_items?.name || i.menu_item_id,
      quantity: i.quantity,
      price: i.unit_price,
      total: i.total_price,
      menu_categories: i.menu_items?.menu_categories || null,
      modifier_notes: (i as unknown as { modifier_notes?: string }).modifier_notes || '',
      extra_charge: (i as unknown as { extra_charge?: number }).extra_charge || 0,
      _existing: true,
      menu_item_id: i.menu_item_id,
      unit_price: i.unit_price,
      total_price: i.total_price,
      order_id: activeOrder.id,
    }))
  })

  const [activeCategory, setActiveCategory] = useState('All')
  const [menuSearch, setMenuSearch] = useState('')
  const [notes, setNotes] = useState('')
  const [voidRequest, setVoidRequest] = useState<VoidRequest | null>(null)
  const [modifierItem, setModifierItem] = useState<OrderItemLocal | null>(null)
  const [modifierNotes, setModifierNotes] = useState('')
  const [modifierCharge, setModifierCharge] = useState('')

  const categories = [
    'All',
    ...new Set(
      menuItems
        .map(
          (item) =>
            (item as unknown as { menu_categories?: { name?: string } }).menu_categories?.name
        )
        .filter(Boolean) as string[]
    ),
  ]
  const filteredMenu = menuItems
    .filter(
      (item) =>
        activeCategory === 'All' ||
        (item as unknown as { menu_categories?: { name?: string } }).menu_categories?.name ===
          activeCategory
    )
    .filter((item) => !menuSearch || item.name.toLowerCase().includes(menuSearch.toLowerCase()))

  const addItem = (item: MenuItem | OrderItemLocal) => {
    const stock = (item as unknown as { current_stock?: number | null }).current_stock
    if (stock !== null && stock !== undefined && stock <= 0) {
      toast.warning('Out of Stock', item.name + ' is out of stock')
      return
    }
    setOrderItems((prev) => {
      const newEntry = prev.find((i) => i.id === item.id && !i._existing)
      if (newEntry)
        return prev.map((i) =>
          i.id === item.id && !i._existing
            ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.price }
            : i
        )
      return [
        ...prev,
        {
          id: item.id,
          name: item.name,
          price: (item as MenuItem).price || (item as OrderItemLocal).price,
          quantity: 1,
          total: (item as MenuItem).price || (item as OrderItemLocal).price,
          menu_categories: (
            item as unknown as { menu_categories?: { name?: string; destination?: string } | null }
          ).menu_categories,
          _existing: false,
          _newId: crypto.randomUUID(),
          menu_item_id: item.id,
          unit_price: (item as MenuItem).price,
          total_price: (item as MenuItem).price,
          order_id: '',
        },
      ]
    })
  }

  const removeItem = (itemKey: string) => {
    setOrderItems((prev) => {
      const existing = prev.find((i) => (i._newId || i.id) === itemKey)
      if (!existing) return prev
      if (existing.quantity === 1) return prev.filter((i) => (i._newId || i.id) !== itemKey)
      return prev.map((i) =>
        (i._newId || i.id) === itemKey
          ? { ...i, quantity: i.quantity - 1, total: (i.quantity - 1) * i.price }
          : i
      )
    })
  }

  const deleteItem = (item: OrderItemLocal) => {
    if (paymentInProgress) {
      toast.warning('Payment In Progress', 'Close the payment screen before voiding items')
      return
    }
    if (!activeOrder || !item._existing) {
      setOrderItems((prev) => prev.filter((i) => (i._newId || i.id) !== (item._newId || item.id)))
      return
    }
    setVoidRequest({
      itemId: item.id,
      itemName: item.name,
      quantity: item.quantity,
      value: item.total,
    })
  }

  const confirmVoid = async (approver: { name: string; id: string }) => {
    if (!voidRequest || !activeOrder) return
    const item = orderItems.find((i) => i.id === voidRequest.itemId)
    const dbId = item?._dbId

    // 1. Delete the order_item row from Supabase
    if (dbId) {
      const { error: delErr } = await supabase.from('order_items').delete().eq('id', dbId)
      if (delErr) {
        toast.error('Error', 'Failed to void item: ' + delErr.message)
        return
      }
    }

    // 2. Reduce the order total in Supabase
    const newTotal = Math.max(0, (activeOrder.total_amount || 0) - voidRequest.value)
    await supabase.from('orders').update({ total_amount: newTotal }).eq('id', activeOrder.id)

    // 3. Log to void_log (best-effort audit trail)
    const { error: voidErr } = await supabase.from('void_log').insert({
      menu_item_name: voidRequest.itemName,
      quantity: voidRequest.quantity,
      unit_price: item?.price || 0,
      total_value: voidRequest.value,
      void_type: 'item',
      approved_by_name: approver.name,
      approved_by: approver.id,
    })
    if (voidErr) toast.error('Void log failed', voidErr.message)

    // 4. Update local state
    setOrderItems((prev) => prev.filter((i) => i.id !== voidRequest.itemId))
    setVoidRequest(null)
  }

  const openModifier = (item: OrderItemLocal) => {
    setModifierItem(item)
    setModifierNotes(item.modifier_notes || '')
    setModifierCharge(item.extra_charge ? String(item.extra_charge) : '')
  }

  const saveModifier = () => {
    const charge = parseFloat(modifierCharge) || 0
    setOrderItems((prev) =>
      prev.map((i) =>
        i.id === modifierItem!.id
          ? {
              ...i,
              modifier_notes: modifierNotes,
              extra_charge: charge,
              total: i.quantity * i.price + charge,
            }
          : i
      )
    )
    setModifierItem(null)
    setModifierNotes('')
    setModifierCharge('')
  }

  const total = orderItems.reduce(
    (sum, item) => sum + item.quantity * item.price + (item.extra_charge || 0),
    0
  )

  const handlePlaceOrder = async () => {
    if (orderItems.length === 0) return
    const newItems = orderItems.filter((i) => !i._existing)
    if (newItems.length === 0 && activeOrder) {
      await onPlaceOrder({ table, items: [], notes, total: 0 })
      return
    }
    const newTotal = newItems.reduce((sum, i) => sum + (i.total || 0), 0)
    await onPlaceOrder({ table, items: newItems, notes, total: newTotal })
  }

  return (
    <>
      <div className="flex flex-col h-full bg-gray-900">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div>
            <h2 className="text-white font-bold">{table.name}</h2>
            <p className="text-gray-400 text-xs">
              {
                (table as unknown as { table_categories?: { name?: string } }).table_categories
                  ?.name
              }
            </p>
            {(() => {
              const hireFee = (
                table as unknown as { table_categories?: { hire_fee?: number | null } }
              ).table_categories?.hire_fee
              return hireFee ? (
                <p className="text-amber-400 text-xs font-semibold mt-0.5">
                  🏷 Hire fee: ₦{hireFee.toLocaleString()} — add to bill manually
                </p>
              ) : null
            })()}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex gap-2 p-3 overflow-x-auto border-b border-gray-800">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${activeCategory === cat ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex px-3 pt-3 pb-0">
          <div className="flex items-center gap-2 flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 focus-within:border-amber-500 transition-colors">
            <Search size={14} className="text-gray-500 shrink-0" />
            <input
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              placeholder="Search menu…"
              className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none"
            />
            {menuSearch && (
              <button onClick={() => setMenuSearch('')} className="text-gray-500 hover:text-white">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Unified order panel — existing + new items, sticky above menu */}
        {orderItems.length > 0 && (
          <div className="border-b border-gray-800 bg-gray-900 px-3 py-2 max-h-56 overflow-y-auto space-y-1">
            {/* Existing on-table items */}
            {orderItems.filter((i) => i._existing).map((item) => {
              const dbId = item._dbId || dbIdMap[item.id]
              return (
                <div key={item._newId || item.id} className="flex items-center gap-2 py-0.5">
                  <span className="text-gray-500 text-xs w-5 text-center">{item.quantity}×</span>
                  <span className="flex-1 text-gray-400 text-sm truncate">{item.name}</span>
                  <span className="text-gray-500 text-xs">₦{item.total.toFixed(0)}</span>
                  <button
                    onClick={() => { if (dbId && !servedItems[dbId]) markServed(item) }}
                    className={`transition-colors ${dbId && servedItems[dbId] ? 'text-green-400' : 'text-gray-600 hover:text-green-400'}`}
                    title={dbId && servedItems[dbId] ? 'Served' : 'Mark as served'}
                  >
                    {dbId && servedItems[dbId] ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                  </button>
                  <button onClick={() => deleteItem(item)} className="text-red-400 hover:text-red-300" title="Void">
                    <Trash2 size={12} />
                  </button>
                </div>
              )
            })}
            {/* Divider between existing and new items */}
            {orderItems.some((i) => i._existing) && orderItems.some((i) => !i._existing) && (
              <div className="border-t border-amber-500/20 my-1" />
            )}
            {/* New items being added */}
            {orderItems.filter((i) => !i._existing).map((item) => {
              return (
                <div key={item._newId || item.id} className="flex items-center gap-2 py-0.5">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => removeItem(item._newId || item.id)}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white bg-gray-700 hover:bg-gray-600"
                    >
                      <Minus size={10} />
                    </button>
                    <span className="text-white text-sm w-5 text-center">{item.quantity}</span>
                    <button
                      onClick={() => addItem(item)}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white bg-gray-700 hover:bg-gray-600"
                    >
                      <Plus size={10} />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <button onClick={() => openModifier(item)} className="text-left w-full">
                      <p className="text-sm text-white truncate">{item.name}</p>
                      {item.modifier_notes && (
                        <p className="text-amber-400 text-xs truncate">{item.modifier_notes}</p>
                      )}
                      {(item.extra_charge || 0) > 0 && (
                        <p className="text-green-400 text-xs">+₦{item.extra_charge!.toLocaleString()}</p>
                      )}
                    </button>
                  </div>
                  <span className="text-white text-sm">₦{item.total.toFixed(0)}</span>
                  <button onClick={() => deleteItem(item)} className="text-red-400 hover:text-red-300">
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="p-3">
            {filteredMenu.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No menu items yet</p>
                <p className="text-xs mt-1">Add items in the Back Office</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {filteredMenu.map((item) => {
                  const stock = (item as unknown as { current_stock?: number | null }).current_stock
                  const outOfStock = stock !== null && stock !== undefined && stock <= 0
                  return (
                    <button
                      key={item.id}
                      onClick={() => addItem(item)}
                      disabled={outOfStock}
                      className={`rounded-xl p-3 text-left transition-colors border ${outOfStock ? 'bg-gray-900 border-gray-800 opacity-50 cursor-not-allowed' : 'bg-gray-800 hover:bg-gray-700 border-gray-700 hover:border-amber-500/50'}`}
                    >
                      <p className="text-white text-sm font-medium">{item.name}</p>
                      <p className="text-amber-400 text-sm font-bold mt-1">
                        ₦{item.price.toFixed(2)}
                      </p>
                      {outOfStock && (
                        <p className="text-red-400 text-xs mt-1 font-bold">Out of Stock</p>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>



          <div className="px-3 pb-3">
            <input
              type="text"
              placeholder="Order notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        <div className="p-3 border-t border-gray-800 bg-gray-900 shrink-0">
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-400">Total</span>
            <span className="text-white font-bold text-lg">₦{total.toFixed(2)}</span>
          </div>
          <button
            onClick={handlePlaceOrder}
            disabled={orderItems.length === 0}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors"
          >
            <Send size={16} /> Confirm Order
          </button>
        </div>
      </div>

      {modifierItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold">Modify Item</h3>
              <button
                onClick={() => setModifierItem(null)}
                className="text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-amber-400 font-medium">{modifierItem.name}</p>
            <div>
              <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                Special Instructions
              </label>
              <textarea
                value={modifierNotes}
                onChange={(e) => setModifierNotes(e.target.value)}
                placeholder="e.g. no onions, well done, extra spicy..."
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500 resize-none"
              />
            </div>
            <div>
              <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                Extra Charge (₦)
              </label>
              <input
                type="number"
                value={modifierCharge}
                onChange={(e) => setModifierCharge(e.target.value)}
                placeholder="0"
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500"
              />
              <p className="text-gray-500 text-xs mt-1">Leave blank if no extra charge</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setModifierItem(null)}
                className="py-3 rounded-xl bg-gray-800 text-gray-300 hover:bg-gray-700 font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveModifier}
                className="py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm"
              >
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
