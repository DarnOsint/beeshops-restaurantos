import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { X, Banknote, CreditCard, Smartphone, CheckCircle } from 'lucide-react'
import ReceiptModal from './ReceiptModal'

export default function PaymentModal({ order, table, onSuccess, onClose }) {
  const { profile } = useAuth()
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [cashTendered, setCashTendered] = useState('')
  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState(false)
  const [showReceipt, setShowReceipt] = useState(false)
  const [paidOrder, setPaidOrder] = useState(null)

  const total = order?.total_amount || 0
  const change = paymentMethod === 'cash' && cashTendered
    ? parseFloat(cashTendered) - total
    : 0

  const canProcess = () => {
    if (processing) return false
    if (paymentMethod === 'cash') return parseFloat(cashTendered) >= total
    return true
  }

  const processPayment = async () => {
    setProcessing(true)
    try {
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

  const paymentMethods = [
    { id: 'cash', label: 'Cash', icon: Banknote, color: 'text-green-400' },
    { id: 'card', label: 'Bank POS', icon: CreditCard, color: 'text-blue-400' },
    { id: 'transfer', label: 'Bank Transfer', icon: Smartphone, color: 'text-amber-400' },
  ]

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
          Paid via {paymentMethod === 'card' ? 'Bank POS' : paymentMethod === 'transfer' ? 'Bank Transfer' : 'Cash'}
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
            <div className="grid grid-cols-3 gap-2">
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

          {/* Confirm Button */}
          <button
            onClick={processPayment}
            disabled={!canProcess()}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-800 disabled:text-gray-600 text-black font-bold rounded-xl py-4 text-lg transition-colors"
          >
            {processing ? 'Processing...' : `Confirm ₦${total.toLocaleString()} Payment`}
          </button>

        </div>
      </div>
    </div>
  )
}