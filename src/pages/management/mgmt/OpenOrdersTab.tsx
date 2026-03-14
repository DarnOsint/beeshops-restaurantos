import { useState, useEffect, useCallback } from 'react'
import { ShoppingBag, XCircle } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useToast } from '../../../context/ToastContext'

export default function OpenOrdersTab() {
  const [orders, setOrders] = useState<
    Array<{
      id: string
      table_id?: string
      total_amount?: number
      created_at: string
      order_type?: string
      tables?: { name: string } | null
      profiles?: { full_name: string } | null
      order_items?: Array<{
        id: string
        quantity: number
        total_price: number
        status: string
        menu_items?: { name: string } | null
      }>
    }>
  >([])
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*, table_id, tables(name), profiles(full_name), order_items(*, menu_items(name))')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
    if (!error) setOrders(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchOrders()
    const ch = supabase
      .channel('open-orders-ch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchOrders)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [fetchOrders])

  if (loading)
    return <div className="flex items-center justify-center p-8 text-amber-500">Loading...</div>

  return (
    <div className="space-y-3">
      {orders.length === 0 ? (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center">
          <ShoppingBag size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No open orders right now</p>
        </div>
      ) : (
        orders.map((order) => (
          <div key={order.id} className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-white font-bold">{order.tables?.name || 'Unknown Table'}</p>
                <p className="text-gray-400 text-xs">{order.profiles?.full_name}</p>
              </div>
              <div className="text-right flex flex-col items-end gap-1.5">
                <p className="text-amber-400 font-bold">₦{order.total_amount?.toLocaleString()}</p>
                <p className="text-gray-500 text-xs">
                  {new Date(order.created_at).toLocaleTimeString()}
                </p>
                <button
                  onClick={async () => {
                    if (
                      !confirm(
                        'Force-close this order? Use this only for stuck orders that were already paid.'
                      )
                    )
                      return
                    const { error } = await supabase
                      .from('orders')
                      .update({ status: 'paid', closed_at: new Date().toISOString() })
                      .eq('id', order.id)
                    if (error) {
                      toast.error('Error', 'Failed: ' + error.message)
                      return
                    }
                    // Mark all items delivered so KDS clears and shift summary is accurate
                    await supabase
                      .from('order_items')
                      .update({ status: 'delivered' })
                      .eq('order_id', order.id)
                    await supabase
                      .from('tables')
                      .update({ status: 'available', assigned_staff: null })
                      .eq('id', order.table_id)
                    fetchOrders()
                  }}
                  className="flex items-center gap-1 text-[10px] bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg px-2 py-1 transition-colors"
                >
                  <XCircle size={10} /> Force Close
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {order.order_items?.map((item) => (
                <div key={String(item.id)} className="flex justify-between text-sm">
                  <span className="text-gray-300">
                    {item.quantity}x {item.menu_items?.name}
                  </span>
                  <span className="text-gray-400">
                    ₦{(item.total_price as number)?.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
