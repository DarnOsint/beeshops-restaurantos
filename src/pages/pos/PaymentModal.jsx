import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { audit } from '../../lib/audit'
import { useAuth } from '../../context/AuthContext'
import { X, Banknote, CreditCard, Smartphone, CheckCircle, Clock, User, Phone, Users } from 'lucide-react'
import ReceiptModal from './ReceiptModal'

export default function PaymentModal({ order, table, onSuccess, onClose }) {
  const { profile } = useAuth()
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [cashTendered, setCashTendered] = useState('')
  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState(false)
  const [showReceipt, setShowReceipt] = useState(false)
  const [paidOrder, setPaidOrder] = useState(null)
  const [debtorName, setDebtorName] = useState(order?.customer_name || '')
  const [debtorPhone, setDebtorPhone] = useState(order?.customer_phone || '')
  const [dueDate, setDueDate] = useState('')
  const [splitMode, setSplitMode] = useState(false)
  const [numPeople, setNumPeople] = useState(2)
  const [itemAssignments, setItemAssignments] = useState({}) // { order_item_id: personIndex }
  const [splitPayments, setSplitPayments] = useState([]) // paid splits
  const [currentSplitPerson, setCurrentSplitPerson] = useState(0)
  const [splitPayMethod, setSplitPayMethod] = useState('cash')
  const [splitCash, setSplitCash] = useState('')

  const total = order?.total_amount || 0
  const change = paymentMethod === 'cash' && cashTendered
    ? parseFloat(cashTendered) - total
    : 0

  const canProcess = () => {
    if (processing) return false
    if (paymentMethod === 'cash') return parseFloat(cashTendered) >= total
    if (paymentMethod === 'credit') return debtorName.trim().length > 0
    return true
  }

  const orderItems = order?.order_items || []

  const getPersonItems = (personIdx) =>
    orderItems.filter(item => itemAssignments[item.id] === personIdx)

  const getPersonTotal = (personIdx) =>
    getPersonItems(personIdx).reduce((s, i) => s + (i.total_price || 0) + (i.extra_charge || 0), 0)

  const unassignedItems = orderItems.filter(item => itemAssignments[item.id] === undefined)

  const allAssigned = unassignedItems.length === 0

  const processSplitPayment = async () => {
    const personTotal = getPersonTotal(currentSplitPerson)
    if (personTotal === 0) {
      alert('No items assigned to this person')
      return
    }
    if (splitPayMethod === 'cash' && parseFloat(splitCash) < personTotal) {
      alert('Cash tendered is less than amount due')
      return
    }
    const newPayment = {
      person: currentSplitPerson + 1,
      total: personTotal,
      method: splitPayMethod,
      items: getPersonItems(currentSplitPerson).map(i => i.menu_items?.name || 'Item'),
      change: splitPayMethod === 'cash' ? parseFloat(splitCash) - personTotal : 0
    }
    const updatedPayments = [...splitPayments, newPayment]
    setSplitPayments(updatedPayments)
    setSplitCash('')

    // Check if all people have paid
    const paidPeople = updatedPayments.map(p => p.person)
    const allPeople = Array.from({ length: numPeople }, (_, i) => i + 1)
    const allPaid = allPeople.every(p => paidPeople.includes(p))

    if (allPaid) {
      // Mark order as paid
      const primaryMethod = updatedPayments[0].method
      await supabase.from('orders').update({
        status: 'paid',
        payment_method: primaryMethod,
        closed_at: new Date().toISOString(),
        notes: (order.notes || '') + ' [Split: ' + updatedPayments.map(p => 'P' + p.person + '=' + p.method).join(', ') + ']'
      }).eq('id', order.id)
      await supabase.from('order_items').update({ status: 'delivered' }).eq('order_id', order.id)
      await supabase.from('tables').update({ status: 'available' }).eq('id', table.id)
      await audit({
        action: 'ORDER_PAID',
        entity: 'order',
        entityId: order.id,
        entityName: 'Order #' + (order.id || '').slice(0, 8),
        newValue: { total: order.total_amount, payment_method: 'split', splits: updatedPayments.length },
        performer: profile
      })
      setPaidOrder({ ...order, payment_method: 'split' })
      setSuccess(true)
    } else {
      // Move to next unpaid person
      const nextPerson = allPeople.find(p => !paidPeople.includes(p))
      setCurrentSplitPerson(nextPerson - 1)
      setSplitPayMethod('cash')
    }
  }

  const processPayment = async () => {
    setProcessing(true)
    try {
      if (paymentMethod === 'credit') {
        await supabase.from('orders').update({
          status: 'paid', payment_method: 'credit',
          customer_name: debtorName, customer_phone: debtorPhone,
          closed_at: new Date().toISOString()
        }).eq('id', order.id)
        await supabase.from('order_items').update({ status: 'delivered' }).eq('order_id', order.id)
        await supabase.from('tables').update({ status: 'available' }).eq('id', table.id)
        await supabase.from('debtors').insert({
          name: debtorName, phone: debtorPhone,
          debt_type: 'table_order', order_id: order.id,
          credit_limit: total, current_balance: total,
          amount_paid: 0, status: 'outstanding', is_active: true,
          due_date: dueDate || null,
          notes: 'Auto-created from POS - ' + (table?.name || ''),
          recorded_by: profile?.id, recorded_by_name: profile?.full_name,
        })
        setPaidOrder({ ...order, payment_method: 'credit' })
        await audit({
        action: 'ORDER_PAID',
        entity: 'order',
        entityId: order.id,
        entityName: 'Order #' + (order.id || '').slice(0,8),
        newValue: { total: order.total_amount, payment_method: paymentMethod },
        performer: profile
      })
      setSuccess(true)
        return
      }

      await supabase
        .from('orders')
        .update({
          status: 'paid',
          payment_method: paymentMethod,
          closed_at: new Date().toISOString()
        })
        .eq('id', order.id)

      await supabase
        .from('order_items')
        .update({ status: 'delivered' })
        .eq('order_id', order.id)

      await supabase
        .from('tables')
        .update({ status: 'available' })
        .eq('id', table.id)

      setPaidOrder({ ...order, payment_method: paymentMethod })
      setSuccess(true)
    } catch (err) {
      alert('Payment failed. Try again.')
      setProcessing(false)
    }
  }

  const splitColors = ['bg-blue-500/20 border-blue-500/30 text-blue-300', 'bg-purple-500/20 border-purple-500/30 text-purple-300', 'bg-green-500/20 border-green-500/30 text-green-300', 'bg-pink-500/20 border-pink-500/30 text-pink-300', 'bg-amber-500/20 border-amber-500/30 text-amber-300']

  const paymentMethods = [
    { id: 'cash', label: 'Cash', icon: Banknote, color: 'text-green-400' },
    { id: 'card', label: 'Bank POS', icon: CreditCard, color: 'text-blue-400' },
    { id: 'transfer', label: 'Bank Transfer', icon: Smartphone, color: 'text-amber-400' },
    { id: 'credit', label: 'Pay Later', icon: Clock, color: 'text-red-400' },
  ]

  // Split Bill Mode
  if (splitMode && !success) return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-2">
      <div className="bg-gray-950 rounded-2xl w-full max-w-lg border border-gray-800 flex flex-col max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div>
            <h3 className="text-white font-bold">Split Bill — {table?.name}</h3>
            <p className="text-gray-400 text-xs">Total: ₦{total.toLocaleString()}</p>
          </div>
          <button onClick={() => setSplitMode(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
        </div>

        {/* Number of people */}
        <div className="p-4 border-b border-gray-800">
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-2">Number of people</p>
          <div className="flex gap-2">
            {[2,3,4,5].map(n => (
              <button key={n} onClick={() => { setNumPeople(n); setItemAssignments({}); setSplitPayments([]); setCurrentSplitPerson(0) }}
                className={`w-10 h-10 rounded-xl font-bold text-sm transition-colors ${numPeople === n ? 'bg-amber-500 text-black' : 'bg-gray-800 text-white hover:bg-gray-700'}`}>
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Item assignment */}
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-gray-400 text-xs uppercase tracking-wide mb-3">Assign items to each person</p>
          {unassignedItems.length > 0 && (
            <p className="text-amber-400 text-xs mb-3">{unassignedItems.length} unassigned item(s)</p>
          )}
          <div className="space-y-2">
            {orderItems.map(item => (
              <div key={item.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-white text-sm font-medium">{item.menu_items?.name || 'Item'}</p>
                    <p className="text-gray-500 text-xs">₦{((item.total_price || 0) + (item.extra_charge || 0)).toLocaleString()}</p>
                  </div>
                  {itemAssignments[item.id] !== undefined && (
                    <span className={`text-xs px-2 py-1 rounded-lg border ${splitColors[itemAssignments[item.id] % splitColors.length]}`}>
                      Person {itemAssignments[item.id] + 1}
                    </span>
                  )}
                </div>
                <div className="flex gap-1 flex-wrap">
                  {Array.from({ length: numPeople }, (_, i) => (
                    <button key={i} onClick={() => setItemAssignments(prev => ({ ...prev, [item.id]: i }))}
                      className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                        itemAssignments[item.id] === i
                          ? 'bg-amber-500 text-black'
                          : 'bg-gray-800 text-gray-400 hover:text-white'
                      }`}>
                      P{i + 1}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Per-person totals */}
          {allAssigned && (
            <div className="mt-4 space-y-2">
              <p className="text-gray-400 text-xs uppercase tracking-wide mb-2">Summary</p>
              {Array.from({ length: numPeople }, (_, i) => {
                const paid = splitPayments.find(p => p.person === i + 1)
                return (
                  <div key={i} className={`flex items-center justify-between rounded-xl p-3 border ${
                    paid ? 'bg-green-500/10 border-green-500/20' :
                    currentSplitPerson === i ? 'bg-amber-500/10 border-amber-500/30' :
                    'bg-gray-900 border-gray-800'
                  }`}>
                    <span className="text-white text-sm font-medium">Person {i + 1}</span>
                    <div className="text-right">
                      <p className="text-white font-bold">₦{getPersonTotal(i).toLocaleString()}</p>
                      {paid && <p className="text-green-400 text-xs">Paid · {paid.method}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Payment for current person */}
          {allAssigned && splitPayments.length < numPeople && (
            <div className="mt-4 bg-gray-900 border border-amber-500/30 rounded-xl p-4 space-y-3">
              <p className="text-amber-400 text-sm font-bold">
                Collecting from Person {currentSplitPerson + 1} — ₦{getPersonTotal(currentSplitPerson).toLocaleString()}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {paymentMethods.filter(m => m.id !== 'credit').map(m => (
                  <button key={m.id} onClick={() => setSplitPayMethod(m.id)}
                    className={`py-2 rounded-xl text-sm font-medium border transition-colors ${
                      splitPayMethod === m.id ? 'bg-amber-500 text-black border-amber-500' : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-amber-500/50'
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>
              {splitPayMethod === 'cash' && (
                <input type="number" value={splitCash} onChange={e => setSplitCash(e.target.value)}
                  placeholder="Cash tendered"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500" />
              )}
              <button onClick={processSplitPayment}
                className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl py-3">
                Confirm Payment
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  // Step 2 — Success screen with receipt trigger
  if (success && !showReceipt) return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl p-8 text-center max-w-sm w-full border border-gray-800">
        <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={32} className="text-green-400" />
        </div>
        <h3 className="text-white text-xl font-bold mb-1">Payment Successful!</h3>
        <p className="text-gray-400 text-sm mb-1">{table.name} is now free</p>
        <p className="text-gray-500 text-xs capitalize">
          {paymentMethod === 'credit' ? 'Recorded as debt' : `Paid via ${paymentMethod === 'card' ? 'Bank POS' : paymentMethod === 'transfer' ? 'Bank Transfer' : 'Cash'}`}
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
            className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl py-3 text-sm transition-colors"
          >
            🧾 Print Receipt
          </button>
          <button
            onClick={onSuccess}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-medium rounded-xl py-3 text-sm transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )

  // Step 3 — Receipt modal
  if (showReceipt && paidOrder) return (
    <ReceiptModal
      order={paidOrder}
      table={table}
      items={order.order_items || []}
      staffName={profile?.full_name || 'Staff'}
      onClose={() => {
        setShowReceipt(false)
        onSuccess()
      }}
    />
  )

  // Step 1 — Payment form
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

          {/* Order Summary */}
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-3 uppercase tracking-wide">Order Summary</p>
            <div className="space-y-2 mb-3">
              {order?.order_items?.map(item => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-gray-300">{item.quantity}x {item.menu_items?.name}</span>
                  <span className="text-gray-400">₦{item.total_price?.toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-700 pt-3 flex justify-between items-center">
              <span className="text-white font-bold">Total</span>
              <span className="text-amber-400 font-bold text-2xl">₦{total.toLocaleString()}</span>
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <p className="text-gray-400 text-xs uppercase tracking-wide mb-3">Payment Method</p>
            <div className="grid grid-cols-4 gap-2">
              {paymentMethods.map(method => (
                <button
                  key={method.id}
                  onClick={() => setPaymentMethod(method.id)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                    paymentMethod === method.id
                      ? 'bg-gray-800 border-amber-500'
                      : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <method.icon size={22} className={paymentMethod === method.id ? method.color : 'text-gray-500'} />
                  <span className={`text-xs font-medium text-center leading-tight ${paymentMethod === method.id ? 'text-white' : 'text-gray-500'}`}>
                    {method.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Cash Input */}
          {paymentMethod === 'cash' && (
            <div className="space-y-3">
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide mb-2 block">Amount Tendered (₦)</label>
                <input
                  type="number"
                  placeholder="0"
                  value={cashTendered}
                  onChange={e => setCashTendered(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-2xl font-bold focus:outline-none focus:border-amber-500"
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[2000, 5000, 10000, 20000].map(amount => (
                  <button key={amount} onClick={() => setCashTendered(amount.toString())}
                    className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs rounded-lg py-2 transition-colors">
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
                  <p className="text-white text-2xl font-bold">₦{(total - parseFloat(cashTendered)).toLocaleString()}</p>
                </div>
              )}
            </div>
          )}

          {/* Bank POS */}
          {paymentMethod === 'card' && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-center">
              <CreditCard size={28} className="text-blue-400 mx-auto mb-2" />
              <p className="text-blue-400 font-medium">Bank POS</p>
              <p className="text-gray-400 text-sm mt-1">Process ₦{total.toLocaleString()} on the POS terminal, then confirm below.</p>
            </div>
          )}

          {/* Bank Transfer */}
          {paymentMethod === 'transfer' && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-center">
              <Smartphone size={28} className="text-amber-400 mx-auto mb-2" />
              <p className="text-amber-400 font-medium">Bank Transfer</p>
              <p className="text-gray-400 text-sm mt-1">Confirm customer has transferred ₦{total.toLocaleString()} to Moniepoint before proceeding.</p>
            </div>
          )}

          {/* Pay Later Form */}
          {paymentMethod === 'credit' && (
            <div className="space-y-3">
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
                <Clock size={28} className="text-red-400 mx-auto mb-2" />
                <p className="text-red-400 font-medium">Pay Later</p>
                <p className="text-gray-400 text-sm mt-1">Order will be recorded as a debt. Enter customer details below.</p>
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide mb-2 block">Customer Name *</label>
                <input value={debtorName} onChange={e => setDebtorName(e.target.value)}
                  placeholder="Full name"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-red-500" />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide mb-2 block">Phone</label>
                <input value={debtorPhone} onChange={e => setDebtorPhone(e.target.value)}
                  placeholder="08xxxxxxxxx"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-red-500" />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide mb-2 block">Due Date (optional)</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-red-500" />
              </div>
            </div>
          )}

          {/* Confirm Button */}
          <button
            onClick={processPayment}
            disabled={!canProcess()}
            className={`w-full ${paymentMethod === 'credit' ? 'bg-red-500 hover:bg-red-400' : 'bg-amber-500 hover:bg-amber-400'} disabled:bg-gray-800 disabled:text-gray-600 text-black font-bold rounded-xl py-4 text-lg transition-colors`}
          >
            {processing ? 'Processing...' : paymentMethod === 'credit' ? `Record ₦${total.toLocaleString()} as Debt` : `Confirm ₦${total.toLocaleString()} Payment`}
          </button>

        </div>
      </div>
    </div>
  )
}