import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { offlineInsert } from '../../lib/offlineWrite'
import { useAuth } from '../../context/AuthContext'
import { audit } from '../../lib/audit'
import {
  X,
  Plus,
  Minus,
  Trash2,
  Search,
  CheckCircle,
  Banknote,
  CreditCard,
  Smartphone,
  ShoppingBag,
  Phone,
  Printer,
} from 'lucide-react'
import type { MenuItem } from '../../types'
import { useToast } from '../../context/ToastContext'

interface OrderItemLocal {
  id: string
  name: string
  price: number
  quantity: number
  total: number
  menu_categories?: { name?: string; destination?: string } | null
}

interface CompletedOrder {
  order: { id: string }
  items: OrderItemLocal[]
  total: number
  change: number
  customerName: string
  paymentMethod: string
}

interface Props {
  type: 'cash' | 'takeaway'
  menuItems: MenuItem[]
  staffId: string
  onSuccess: () => void
  onClose: () => void
}

export default function CashSaleModal({ type, menuItems, staffId, onSuccess, onClose }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [orderItems, setOrderItems] = useState<OrderItemLocal[]>([])
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer'>('cash')
  const [cashTendered, setCashTendered] = useState('')
  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState(false)
  const [completedOrder, setCompletedOrder] = useState<CompletedOrder | null>(null)
  const [notes, setNotes] = useState('')
  const [activeTab, setActiveTab] = useState<'menu' | 'order'>('menu')

  const isTakeaway = type === 'takeaway'
  const categories = [
    'All',
    ...new Set(
      menuItems
        .map((i) => (i as unknown as { menu_categories?: { name?: string } }).menu_categories?.name)
        .filter(Boolean) as string[]
    ),
  ]

  const filtered = menuItems.filter((item) => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase())
    const matchCat =
      activeCategory === 'All' ||
      (item as unknown as { menu_categories?: { name?: string } }).menu_categories?.name ===
        activeCategory
    return matchSearch && matchCat
  })

  const addItem = (item: MenuItem) => {
    setOrderItems((prev) => {
      const existing = prev.find((i) => i.id === item.id)
      if (existing)
        return prev.map((i) =>
          i.id === item.id
            ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.price }
            : i
        )
      return [
        ...prev,
        {
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
          total: item.price,
          menu_categories: (
            item as unknown as { menu_categories?: { name?: string; destination?: string } }
          ).menu_categories,
        },
      ]
    })
  }

  const removeItem = (itemId: string) => {
    setOrderItems((prev) => {
      const existing = prev.find((i) => i.id === itemId)
      if (!existing) return prev
      if (existing.quantity === 1) return prev.filter((i) => i.id !== itemId)
      return prev.map((i) =>
        i.id === itemId ? { ...i, quantity: i.quantity - 1, total: (i.quantity - 1) * i.price } : i
      )
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

  const depleteInventory = async (items: OrderItemLocal[]) => {
    for (const item of items) {
      if (!item.id) continue
      const { data: inv } = await supabase
        .from('inventory')
        .select('id, current_stock')
        .eq('menu_item_id', item.id)
        .eq('is_active', true)
        .maybeSingle()
      if (!inv) continue
      const newStock = Math.max(0, (inv as { current_stock: number }).current_stock - item.quantity)
      await supabase
        .from('inventory')
        .update({ current_stock: newStock, updated_at: new Date().toISOString() })
        .eq('id', (inv as { id: string }).id)
    }
  }

  const processOrder = async () => {
    if (orderItems.length === 0) return toast.warning('Required', 'Add at least one item')
    if (isTakeaway && !customerName)
      return toast.warning('Required', 'Customer name is required for takeaway')
    setProcessing(true)
    try {
      const orderId = crypto.randomUUID()
      const { data: order, error: orderError } = await offlineInsert('orders', {
        id: orderId,
        staff_id: staffId,
        order_type: type,
        status: 'paid',
        payment_method: paymentMethod,
        total_amount: total,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        notes,
        closed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })
      if (orderError) throw orderError
      const itemsWithIds = orderItems.map((item) => ({
        id: crypto.randomUUID(),
        order_id: (order as { id: string }).id,
        menu_item_id: item.id,
        quantity: item.quantity,
        unit_price: item.price,
        total_price: item.total,
        status: 'pending',
        destination: item.menu_categories?.destination || 'bar',
        created_at: new Date().toISOString(),
      }))
      for (const item of itemsWithIds) {
        const { error } = await offlineInsert('order_items', item)
        if (error) throw error
      }
      await depleteInventory(orderItems)
      await audit({
        action: 'ORDER_CREATED',
        entity: 'order',
        entityId: (order as { id: string }).id,
        entityName: type === 'takeaway' ? `Takeaway — ${customerName}` : 'Cash Sale',
        newValue: { total, items: orderItems.length, type },
        performer: profile,
      })
      setCompletedOrder({
        order: order as { id: string },
        items: orderItems,
        total,
        change,
        customerName,
        paymentMethod,
      })
      setSuccess(true)
    } catch (err) {
      toast.error('Error', 'Error processing order: ' + (err as Error).message)
      setProcessing(false)
    }
  }

  const printCashReceipt = () => {
    if (!completedOrder) return
    const o = completedOrder
    const now = new Date().toLocaleString('en-NG')
    const html = `<html><head><style>* { margin:0; padding:0; box-sizing:border-box; } body { font-family:'Courier New',monospace; font-size:12px; color:#000; width:80mm; padding:4mm; }
      .center { text-align:center; } .bold { font-weight:bold; } .row { display:flex; justify-content:space-between; margin:3px 0; } .divider { border-top:1px dashed #000; margin:6px 0; }
      @media print { body{width:80mm;} @page{margin:0;size:80mm auto;} }</style></head><body>
      <div class="center bold" style="font-size:15px">Beeshop's Place</div>
      <div class="center" style="font-size:10px">Restaurant & Bar</div>
      <div class="divider"></div>
      <div class="center" style="font-size:10px">${now}</div>
      <div class="center" style="font-size:10px">${isTakeaway ? 'TAKEAWAY — ' + o.customerName : 'CASH SALE'}</div>
      <div class="divider"></div>
      ${o.items.map((i) => `<div class="row"><span>${i.quantity}x ${i.name}</span><span>₦${(i.total || i.price * i.quantity).toLocaleString()}</span></div>`).join('')}
      <div class="divider"></div>
      <div class="row bold"><span>TOTAL</span><span>₦${o.total.toLocaleString()}</span></div>
      ${o.paymentMethod === 'cash' && o.change > 0 ? `<div class="row"><span>Change</span><span>₦${o.change.toLocaleString()}</span></div>` : ''}
      <div class="divider"></div>
      <div class="center" style="font-size:10px">Thank you!</div>
    </body></html>`
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:0'
    document.body.appendChild(iframe)
    iframe.contentDocument!.write(html)
    iframe.contentDocument!.close()
    iframe.contentWindow!.focus()
    setTimeout(() => {
      iframe.contentWindow!.print()
      setTimeout(() => document.body.removeChild(iframe), 1000)
    }, 300)
  }

  if (success)
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
        <div className="bg-gray-900 rounded-2xl p-6 text-center max-w-sm w-full border border-gray-800 space-y-4">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle size={32} className="text-green-400" />
          </div>
          <div>
            <h3 className="text-white text-xl font-bold mb-1">Order Complete!</h3>
            <p className="text-gray-400 text-sm">
              {isTakeaway ? `Takeaway for ${customerName}` : 'Cash sale processed'}
            </p>
          </div>
          {paymentMethod === 'cash' && change > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
              <p className="text-amber-400 text-xs mb-1">Change to return</p>
              <p className="text-white text-3xl font-bold">₦{change.toLocaleString()}</p>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={printCashReceipt}
              className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2.5 rounded-xl text-sm"
            >
              <Printer size={15} /> Print Receipt
            </button>
            <button
              onClick={onSuccess}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-2xl border border-gray-800 flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${isTakeaway ? 'bg-blue-600' : 'bg-green-600'}`}
            >
              {isTakeaway ? (
                <Phone size={16} className="text-white" />
              ) : (
                <ShoppingBag size={16} className="text-white" />
              )}
            </div>
            <div>
              <h3 className="text-white font-bold">
                {isTakeaway ? 'Takeaway Order' : 'Cash Sale'}
              </h3>
              <p className="text-gray-400 text-xs">
                {isTakeaway ? 'Phone-in or walk-in takeaway' : 'Counter sale — pay immediately'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex md:hidden border-b border-gray-800 bg-gray-900 shrink-0">
          <button
            onClick={() => setActiveTab('menu')}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${activeTab === 'menu' ? 'text-white border-b-2 border-amber-500' : 'text-gray-500'}`}
          >
            Menu
          </button>
          <button
            onClick={() => setActiveTab('order')}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${activeTab === 'order' ? 'text-white border-b-2 border-amber-500' : 'text-gray-500'}`}
          >
            Order {orderItems.length > 0 && `(${orderItems.length})`}
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div
            className={`${activeTab === 'menu' ? 'flex' : 'hidden'} md:flex flex-1 flex-col overflow-hidden border-r border-gray-800`}
          >
            <div className="p-3 border-b border-gray-800 shrink-0">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search items..."
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
            <div className="flex gap-2 px-3 py-2 overflow-x-auto border-b border-gray-800 shrink-0">
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
            {orderItems.length > 0 && (
              <div className="md:hidden shrink-0 p-2 border-t border-gray-800 bg-gray-900">
                <button
                  onClick={() => setActiveTab('order')}
                  className="w-full bg-amber-500 text-black font-bold rounded-xl py-2.5 text-sm"
                >
                  View Order ({orderItems.length} items) — ₦{total.toLocaleString()} →
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="grid grid-cols-2 gap-2">
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addItem(item)}
                    className="bg-gray-800 hover:bg-gray-700 rounded-xl p-3 text-left border border-gray-700 hover:border-amber-500/50 transition-colors"
                  >
                    <p className="text-white text-sm font-medium leading-tight">{item.name}</p>
                    <p className="text-amber-400 text-sm font-bold mt-1">
                      ₦{item.price.toLocaleString()}
                    </p>
                    <p className="text-gray-500 text-xs mt-0.5">
                      {
                        (item as unknown as { menu_categories?: { name?: string } }).menu_categories
                          ?.name
                      }
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div
            className={`${activeTab === 'order' ? 'flex' : 'hidden'} md:flex w-full md:w-72 flex-col overflow-hidden shrink-0`}
          >
            {isTakeaway && (
              <div className="p-3 border-b border-gray-800 space-y-2 shrink-0">
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer name *"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                />
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {orderItems.length === 0 ? (
                <div className="text-center py-8 text-gray-600 text-sm">Tap items to add</div>
              ) : (
                orderItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2"
                  >
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => removeItem(item.id)}
                        className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-white"
                      >
                        <Minus size={10} />
                      </button>
                      <span className="text-white text-sm w-5 text-center">{item.quantity}</span>
                      <button
                        onClick={() => addItem(item as unknown as MenuItem)}
                        className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-white"
                      >
                        <Plus size={10} />
                      </button>
                    </div>
                    <span className="text-gray-300 text-xs flex-1 truncate">{item.name}</span>
                    <span className="text-white text-xs font-bold">
                      ₦{item.total.toLocaleString()}
                    </span>
                    <button
                      onClick={() => setOrderItems((prev) => prev.filter((i) => i.id !== item.id))}
                      className="text-red-400"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="px-3 pb-2 shrink-0">
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes..."
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500"
              />
            </div>
            {orderItems.length > 0 && (
              <div className="p-3 border-t border-gray-800 space-y-3 shrink-0">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Total</span>
                  <span className="text-amber-400 font-bold text-xl">
                    ₦{total.toLocaleString()}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      ['cash', 'Cash', Banknote],
                      ['card', 'POS', CreditCard],
                      ['transfer', 'Transfer', Smartphone],
                    ] as const
                  ).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      onClick={() => setPaymentMethod(id)}
                      className={`flex flex-col items-center gap-1 py-2 rounded-xl border-2 transition-all text-xs font-medium ${paymentMethod === id ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-gray-700 bg-gray-800 text-gray-500'}`}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                </div>
                {paymentMethod === 'cash' && (
                  <div className="space-y-2">
                    <input
                      type="number"
                      value={cashTendered}
                      onChange={(e) => setCashTendered(e.target.value)}
                      placeholder="Amount tendered"
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:border-amber-500"
                    />
                    <div className="grid grid-cols-4 gap-1">
                      {[2000, 5000, 10000, 20000].map((a) => (
                        <button
                          key={a}
                          onClick={() => setCashTendered(a.toString())}
                          className="bg-gray-800 border border-gray-700 text-gray-400 text-xs rounded-lg py-1.5 hover:text-white transition-colors"
                        >
                          ₦{(a / 1000).toFixed(0)}k
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
                <button
                  onClick={processOrder}
                  disabled={!canPay()}
                  className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold rounded-xl py-3 text-sm transition-colors"
                >
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
