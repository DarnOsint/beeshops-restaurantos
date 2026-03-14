import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { audit } from '../../lib/audit'
import { useAuth } from '../../context/AuthContext'
import { X, Banknote, CreditCard, Smartphone, CheckCircle, Clock, Beer } from 'lucide-react'
import ReceiptModal from './ReceiptModal'
import type { Order, OrderItem, Table, Profile } from '../../types'
import { useToast } from '../../context/ToastContext'

interface OrderItemExtended {
  id: string
  order_id?: string
  menu_item_id?: string
  quantity: number
  unit_price?: number
  total_price: number
  status?: string
  destination?: string
  modifier_notes?: string | null
  extra_charge?: number
  created_at?: string
  menu_items?: { name: string } | null
}
interface OrderExtended {
  id: string
  table_id?: string | null
  total_amount: number
  payment_method?: string | null
  status: string
  order_type: string
  created_at: string
  closed_at?: string | null
  notes?: string | null
  order_items?: OrderItemExtended[]
  customer_name?: string
  customer_phone?: string
  tables?: { name: string } | null
  profiles?: { full_name: string } | null
}
interface SplitPayment {
  person: number
  total: number
  method: string
  items: string[]
  change: number
}
interface BankDetails {
  name: string
  account_number: string
  account_name: string
}

interface Props {
  order: OrderExtended
  table: Table
  onSuccess: () => void
  onClose: () => void
}

export default function PaymentModal({ order, table, onSuccess, onClose }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [paymentMethod, setPaymentMethod] = useState<string>('cash')
  const [cashTendered, setCashTendered] = useState('')
  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState(false)
  const [showReceipt, setShowReceipt] = useState(false)
  const [paidOrder, setPaidOrder] = useState<OrderExtended | null>(null)
  const [debtorName, setDebtorName] = useState(order?.customer_name || '')
  const [debtorPhone, setDebtorPhone] = useState(order?.customer_phone || '')
  const [dueDate, setDueDate] = useState('')
  const [splitMode, setSplitMode] = useState(false)
  const [numPeople, setNumPeople] = useState(2)
  const [itemAssignments, setItemAssignments] = useState<Record<string, number>>({})
  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([])
  const [currentSplitPerson, setCurrentSplitPerson] = useState(0)
  const [splitPayMethod, setSplitPayMethod] = useState('cash')
  const [splitCash, setSplitCash] = useState('')
  const [bankDetails, setBankDetails] = useState<BankDetails>({
    name: 'Moniepoint',
    account_number: '',
    account_name: '',
  })

  useState(() => {
    supabase
      .from('settings')
      .select('id, value')
      .in('id', ['bank_name', 'bank_account_number', 'bank_account_name'])
      .then(({ data }) => {
        if (!data) return
        const map = Object.fromEntries(
          data.map((r: { id: string; value: string }) => [r.id, r.value])
        )
        setBankDetails({
          name: map['bank_name'] || 'Moniepoint',
          account_number: map['bank_account_number'] || '',
          account_name: map['bank_account_name'] || '',
        })
      })
  })

  const subtotal = order?.total_amount || 0
  const vatAmount = subtotal * 0.075
  const total = subtotal + vatAmount
  const change = paymentMethod === 'cash' && cashTendered ? parseFloat(cashTendered) - total : 0

  const canProcess = () => {
    if (processing) return false
    if (paymentMethod === 'cash') return parseFloat(cashTendered) >= total
    if (paymentMethod === 'credit') return debtorName.trim().length > 0
    return true
  }

  const orderItems = order?.order_items || []
  const getPersonItems = (idx: number) =>
    orderItems.filter((item) => itemAssignments[item.id] === idx)
  const getPersonTotal = (idx: number) =>
    getPersonItems(idx).reduce((s, i) => s + (i.total_price || 0) + (i.extra_charge || 0), 0)
  const unassignedItems = orderItems.filter((item) => itemAssignments[item.id] === undefined)
  const allAssigned = unassignedItems.length === 0

  const processSplitPayment = async () => {
    const personTotal = getPersonTotal(currentSplitPerson)
    if (personTotal === 0) {
      toast.warning('No Items', 'No items assigned to this person')
      return
    }
    if (splitPayMethod === 'cash' && parseFloat(splitCash) < personTotal) {
      toast.warning('Insufficient Cash', 'Cash tendered is less than amount due')
      return
    }
    const newPayment: SplitPayment = {
      person: currentSplitPerson + 1,
      total: personTotal,
      method: splitPayMethod,
      items: getPersonItems(currentSplitPerson).map((i) => i.menu_items?.name || 'Item'),
      change: splitPayMethod === 'cash' ? parseFloat(splitCash) - personTotal : 0,
    }
    const updatedPayments = [...splitPayments, newPayment]
    setSplitPayments(updatedPayments)
    setSplitCash('')
    const paidPeople = updatedPayments.map((p) => p.person)
    const allPeople = Array.from({ length: numPeople }, (_, i) => i + 1)
    if (allPeople.every((p) => paidPeople.includes(p))) {
      const primaryMethod = updatedPayments[0].method
      await supabase
        .from('orders')
        .update({
          status: 'paid',
          payment_method: primaryMethod,
          closed_at: new Date().toISOString(),
          notes:
            (order.notes || '') +
            ' [Split: ' +
            updatedPayments.map((p) => 'P' + p.person + '=' + p.method).join(', ') +
            ']',
        })
        .eq('id', order.id)
      await supabase.from('order_items').update({ status: 'delivered' }).eq('order_id', order.id)
      await supabase
        .from('tables')
        .update({ status: 'available', assigned_staff: null })
        .eq('id', table.id)
      await audit({
        action: 'ORDER_PAID',
        entity: 'order',
        entityId: order.id,
        entityName: 'Order #' + (order.id || '').slice(0, 8),
        newValue: {
          total: order.total_amount,
          payment_method: 'split',
          splits: updatedPayments.length,
        },
        performer: profile as Profile,
      })
      await depleteInventory(order.id)
      setPaidOrder({ ...order, payment_method: 'split' })
      setSuccess(true)
    } else {
      const nextPerson = allPeople.find((p) => !paidPeople.includes(p))!
      setCurrentSplitPerson(nextPerson - 1)
      setSplitPayMethod('cash')
    }
  }

  const depleteInventory = async (orderId: string) => {
    try {
      const { data: items } = await supabase
        .from('order_items')
        .select('menu_item_id, quantity')
        .eq('order_id', orderId)
      if (!items?.length) return
      const menuItemIds = items.map((i: { menu_item_id: string }) => i.menu_item_id).filter(Boolean)
      const { data: invRows } = await supabase
        .from('inventory')
        .select('id, menu_item_id, item_name, current_stock')
        .in('menu_item_id', menuItemIds)
        .eq('is_active', true)
      if (!invRows?.length) return
      for (const inv of invRows as {
        id: string
        menu_item_id: string
        item_name: string
        current_stock: number
      }[]) {
        const orderItem = (items as { menu_item_id: string; quantity: number }[]).find(
          (i) => i.menu_item_id === inv.menu_item_id
        )
        if (!orderItem) continue
        const qty = orderItem.quantity,
          before = inv.current_stock,
          after = Math.max(0, before - qty)
        await supabase
          .from('inventory')
          .update({ current_stock: after, updated_at: new Date().toISOString() })
          .eq('id', inv.id)
        await supabase.from('inventory_log').insert({
          inventory_id: inv.id,
          menu_item_id: inv.menu_item_id,
          item_name: inv.item_name,
          order_id: orderId,
          change_type: 'deduction',
          quantity_change: -qty,
          stock_before: before,
          stock_after: after,
          notes: 'Auto-deducted on payment',
          created_by: profile?.id,
        })
      }
    } catch (e) {
      console.error('Inventory depletion error:', e)
    }
  }

  const processPayment = async () => {
    if (paymentMethod === 'run_tab') {
      onClose()
      return
    }
    setProcessing(true)
    try {
      if (paymentMethod === 'credit') {
        const { error: creditOrderErr } = await supabase
          .from('orders')
          .update({
            status: 'paid',
            payment_method: 'credit',
            customer_name: debtorName,
            customer_phone: debtorPhone,
            closed_at: new Date().toISOString(),
          })
          .eq('id', order.id)
        if (creditOrderErr) throw creditOrderErr
        await supabase.from('order_items').update({ status: 'delivered' }).eq('order_id', order.id)
        await supabase
          .from('tables')
          .update({ status: 'available', assigned_staff: null })
          .eq('id', table.id)
        // Deduplicate debtors — match by phone first, then name
        const { data: existingDebtors } = await (debtorPhone
          ? supabase
              .from('debtors')
              .select('id, current_balance')
              .eq('phone', debtorPhone)
              .eq('is_active', true)
              .limit(1)
          : supabase
              .from('debtors')
              .select('id, current_balance')
              .ilike('name', debtorName)
              .eq('is_active', true)
              .limit(1))
        const existing = existingDebtors?.[0] as { id: string; current_balance: number } | undefined
        if (existing) {
          await supabase
            .from('debtors')
            .update({
              current_balance: existing.current_balance + total,
              status: 'outstanding',
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id)
        } else {
          await supabase.from('debtors').insert({
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            name: debtorName,
            phone: debtorPhone,
            debt_type: 'table_order',
            order_id: order.id,
            credit_limit: total,
            current_balance: total,
            amount_paid: 0,
            status: 'outstanding',
            is_active: true,
            due_date: dueDate || null,
            notes: 'Auto-created from POS - ' + (table?.name || ''),
            recorded_by: profile?.id,
            recorded_by_name: profile?.full_name,
          })
        }
        await depleteInventory(order.id)
        await audit({
          action: 'ORDER_PAID',
          entity: 'order',
          entityId: order.id,
          entityName: 'Order #' + (order.id || '').slice(0, 8),
          newValue: { total: order.total_amount, payment_method: paymentMethod },
          performer: profile as Profile,
        })
        setPaidOrder({ ...order, payment_method: 'credit' })
        setSuccess(true)
        setProcessing(false)
        return
      }
      // Use direct Supabase calls for payment — offlineUpdate's .single() can silently
      // fail (PGRST116) causing realtime events to not fire on Management/Executive
      const { error: orderErr } = await supabase
        .from('orders')
        .update({
          status: 'paid',
          payment_method: paymentMethod,
          closed_at: new Date().toISOString(),
        })
        .eq('id', order.id)
      if (orderErr) throw orderErr
      await supabase.from('order_items').update({ status: 'delivered' }).eq('order_id', order.id)
      await supabase
        .from('tables')
        .update({ status: 'available', assigned_staff: null })
        .eq('id', table.id)
      await depleteInventory(order.id)
      setPaidOrder({ ...order, payment_method: paymentMethod } as any)
      setSuccess(true)
    } catch {
      toast.error('Error', 'Payment failed. Try again.')
    } finally {
      setProcessing(false)
    }
  }

  const splitColors = [
    'bg-blue-500/20 border-blue-500/30 text-blue-300',
    'bg-purple-500/20 border-purple-500/30 text-purple-300',
    'bg-green-500/20 border-green-500/30 text-green-300',
    'bg-pink-500/20 border-pink-500/30 text-pink-300',
    'bg-amber-500/20 border-amber-500/30 text-amber-300',
  ]
  const paymentMethods = [
    { id: 'cash', label: 'Cash', icon: Banknote, color: 'text-green-400' },
    { id: 'card', label: 'Bank POS', icon: CreditCard, color: 'text-blue-400' },
    { id: 'transfer', label: 'Bank Transfer', icon: Smartphone, color: 'text-amber-400' },
    { id: 'credit', label: 'Pay Later (Debt)', icon: Clock, color: 'text-red-400' },
    { id: 'run_tab', label: 'Run Tab', icon: Beer, color: 'text-amber-400' },
  ]

  if (splitMode && !success)
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-2">
        <div className="bg-gray-950 rounded-2xl w-full max-w-lg border border-gray-800 flex flex-col max-h-[95vh]">
          <div className="flex items-center justify-between p-4 border-b border-gray-800">
            <div>
              <h3 className="text-white font-bold">Split Bill — {table?.name}</h3>
              <p className="text-gray-400 text-xs">Total: ₦{total.toLocaleString()}</p>
            </div>
            <button onClick={() => setSplitMode(false)} className="text-gray-400 hover:text-white">
              <X size={18} />
            </button>
          </div>
          <div className="p-4 border-b border-gray-800">
            <p className="text-gray-400 text-xs uppercase tracking-wide mb-2">Number of people</p>
            <div className="flex gap-2">
              {[2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setNumPeople(n)
                    setItemAssignments({})
                    setSplitPayments([])
                    setCurrentSplitPerson(0)
                  }}
                  className={`w-10 h-10 rounded-xl font-bold text-sm transition-colors ${numPeople === n ? 'bg-amber-500 text-black' : 'bg-gray-800 text-white hover:bg-gray-700'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <p className="text-gray-400 text-xs uppercase tracking-wide mb-3">
              Assign items to each person
            </p>
            {unassignedItems.length > 0 && (
              <p className="text-amber-400 text-xs mb-3">
                {unassignedItems.length} unassigned item(s)
              </p>
            )}
            <div className="space-y-2">
              {orderItems.map((item) => (
                <div key={item.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-white text-sm font-medium">
                        {item.menu_items?.name || 'Item'}
                      </p>
                      <p className="text-gray-500 text-xs">
                        ₦{((item.total_price || 0) + (item.extra_charge || 0)).toLocaleString()}
                      </p>
                    </div>
                    {itemAssignments[item.id] !== undefined && (
                      <span
                        className={`text-xs px-2 py-1 rounded-lg border ${splitColors[itemAssignments[item.id] % splitColors.length]}`}
                      >
                        Person {itemAssignments[item.id] + 1}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {Array.from({ length: numPeople }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setItemAssignments((prev) => ({ ...prev, [item.id]: i }))}
                        className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${itemAssignments[item.id] === i ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                      >
                        P{i + 1}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {allAssigned && (
              <div className="mt-4 space-y-2">
                <p className="text-gray-400 text-xs uppercase tracking-wide mb-2">Summary</p>
                {Array.from({ length: numPeople }, (_, i) => {
                  const paid = splitPayments.find((p) => p.person === i + 1)
                  return (
                    <div
                      key={i}
                      className={`flex items-center justify-between rounded-xl p-3 border ${paid ? 'bg-green-500/10 border-green-500/20' : currentSplitPerson === i ? 'bg-amber-500/10 border-amber-500/30' : 'bg-gray-900 border-gray-800'}`}
                    >
                      <span className="text-white text-sm font-medium">Person {i + 1}</span>
                      <div className="text-right">
                        <p className="text-white font-bold">
                          ₦{getPersonTotal(i).toLocaleString()}
                        </p>
                        {paid && <p className="text-green-400 text-xs">Paid · {paid.method}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {allAssigned && splitPayments.length < numPeople && (
              <div className="mt-4 bg-gray-900 border border-amber-500/30 rounded-xl p-4 space-y-3">
                <p className="text-amber-400 text-sm font-bold">
                  Collecting from Person {currentSplitPerson + 1} — ₦
                  {getPersonTotal(currentSplitPerson).toLocaleString()}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {paymentMethods
                    .filter((m) => m.id !== 'credit' && m.id !== 'run_tab')
                    .map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setSplitPayMethod(m.id)}
                        className={`py-2 rounded-xl text-sm font-medium border transition-colors ${splitPayMethod === m.id ? 'bg-amber-500 text-black border-amber-500' : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-amber-500/50'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                </div>
                {splitPayMethod === 'cash' && (
                  <input
                    type="number"
                    value={splitCash}
                    onChange={(e) => setSplitCash(e.target.value)}
                    placeholder="Cash tendered"
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                  />
                )}
                <button
                  onClick={processSplitPayment}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl py-3"
                >
                  Confirm Payment
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )

  if (success && !showReceipt)
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
        <div className="bg-gray-900 rounded-2xl p-8 text-center max-w-sm w-full border border-gray-800">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-green-400" />
          </div>
          <h3 className="text-white text-xl font-bold mb-1">Payment Successful!</h3>
          <p className="text-gray-400 text-sm mb-1">{table.name} is now free</p>
          <p className="text-gray-500 text-xs capitalize">
            {paymentMethod === 'credit'
              ? 'Recorded as debt'
              : `Paid via ${paymentMethod === 'card' ? 'Bank POS' : paymentMethod === 'transfer' ? 'Bank Transfer' : 'Cash'}`}
          </p>
          {paymentMethod === 'cash' && change > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mt-4">
              <p className="text-amber-400 text-xs mb-1">Change to return</p>
              <p className="text-white text-3xl font-bold">₦{change.toLocaleString()}</p>
            </div>
          )}
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => setShowReceipt(true)}
              className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl py-3 text-sm"
            >
              🧾 Print Receipt
            </button>
            <button
              onClick={onSuccess}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-xl py-3 text-sm"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )

  if (showReceipt && paidOrder)
    return (
      <ReceiptModal
        order={paidOrder as unknown as import('../../types').Order}
        table={table}
        items={(order.order_items || []) as import('../../types').OrderItem[]}
        staffName={profile?.full_name || 'Staff'}
        onClose={() => {
          setShowReceipt(false)
          onSuccess()
        }}
      />
    )

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-md border border-gray-800 overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div>
            <h3 className="text-white font-bold text-lg">Process Payment</h3>
            <p className="text-gray-400 text-sm">{table.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 space-y-5">
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-3 uppercase tracking-wide">Order Summary</p>
            <div className="space-y-2 mb-3">
              {order?.order_items?.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-gray-300">
                    {item.quantity}x {item.menu_items?.name}
                  </span>
                  <span className="text-gray-400">₦{item.total_price?.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-700 pt-3 flex justify-between items-center">
              <span className="text-white font-bold">Total</span>
              <span className="text-amber-400 font-bold text-2xl">₦{total.toLocaleString()}</span>
            </div>
          </div>

          <div>
            <p className="text-gray-400 text-xs uppercase tracking-wide mb-3">Payment Method</p>
            <div className="grid grid-cols-4 gap-2">
              {paymentMethods.map((method) => (
                <button
                  key={method.id}
                  onClick={() => setPaymentMethod(method.id)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${paymentMethod === method.id ? 'bg-gray-800 border-amber-500' : 'bg-gray-800 border-gray-700 hover:border-gray-600'}`}
                >
                  <method.icon
                    size={22}
                    className={paymentMethod === method.id ? method.color : 'text-gray-500'}
                  />
                  <span
                    className={`text-xs font-medium text-center leading-tight ${paymentMethod === method.id ? 'text-white' : 'text-gray-500'}`}
                  >
                    {method.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {paymentMethod === 'cash' && (
            <div className="space-y-3">
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide mb-2 block">
                  Amount Tendered (₦)
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={cashTendered}
                  onChange={(e) => setCashTendered(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-2xl font-bold focus:outline-none focus:border-amber-500"
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[2000, 5000, 10000, 20000].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setCashTendered(amount.toString())}
                    className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs rounded-lg py-2 transition-colors"
                  >
                    ₦{amount.toLocaleString()}
                  </button>
                ))}
              </div>
              {cashTendered && parseFloat(cashTendered) >= total && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3">
                  <p className="text-green-400 text-xs">Change to return</p>
                  <p className="text-white text-2xl font-bold">₦{change.toLocaleString()}</p>
                </div>
              )}
              {cashTendered && parseFloat(cashTendered) < total && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                  <p className="text-red-400 text-xs">Short by</p>
                  <p className="text-white text-2xl font-bold">
                    ₦{(total - parseFloat(cashTendered)).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          )}
          {paymentMethod === 'card' && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-center">
              <CreditCard size={28} className="text-blue-400 mx-auto mb-2" />
              <p className="text-blue-400 font-medium">Bank POS</p>
              <p className="text-gray-400 text-sm mt-1">
                Process ₦{total.toLocaleString()} on the POS terminal, then confirm below.
              </p>
            </div>
          )}
          {paymentMethod === 'transfer' && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-center">
              <Smartphone size={28} className="text-amber-400 mx-auto mb-2" />
              <p className="text-amber-400 font-medium">Bank Transfer</p>
              <div className="bg-gray-800 rounded-xl p-3 mt-2 space-y-1">
                <p className="text-gray-400 text-xs">Transfer ₦{total.toLocaleString()} to:</p>
                <p className="text-white font-bold text-sm">{bankDetails.name}</p>
                {bankDetails.account_number && (
                  <p className="text-amber-400 font-mono font-bold">{bankDetails.account_number}</p>
                )}
                {bankDetails.account_name && (
                  <p className="text-gray-300 text-sm">{bankDetails.account_name}</p>
                )}
                <p className="text-gray-500 text-xs pt-1">Confirm transfer before proceeding.</p>
              </div>
            </div>
          )}
          {paymentMethod === 'credit' && (
            <div className="space-y-3">
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
                <Clock size={28} className="text-red-400 mx-auto mb-2" />
                <p className="text-red-400 font-medium">Pay Later</p>
                <p className="text-gray-400 text-sm mt-1">
                  Order will be recorded as a debt. Enter customer details below.
                </p>
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide mb-2 block">
                  Customer Name *
                </label>
                <input
                  value={debtorName}
                  onChange={(e) => setDebtorName(e.target.value)}
                  placeholder="Full name"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-red-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide mb-2 block">
                  Phone
                </label>
                <input
                  value={debtorPhone}
                  onChange={(e) => setDebtorPhone(e.target.value)}
                  placeholder="08xxxxxxxxx"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-red-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide mb-2 block">
                  Due Date (optional)
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-red-500"
                />
              </div>
            </div>
          )}

          <button
            onClick={processPayment}
            disabled={!canProcess()}
            className={`w-full ${paymentMethod === 'credit' ? 'bg-red-500 hover:bg-red-400' : 'bg-amber-500 hover:bg-amber-400'} disabled:bg-gray-800 disabled:text-gray-600 text-black font-bold rounded-xl py-4 text-lg transition-colors`}
          >
            {processing
              ? 'Processing...'
              : paymentMethod === 'run_tab'
                ? 'Run Tab — Continue Ordering'
                : paymentMethod === 'credit'
                  ? `Record ₦${total.toLocaleString()} as Debt`
                  : `Confirm ₦${total.toLocaleString()} Payment`}
          </button>
        </div>
      </div>
    </div>
  )
}
