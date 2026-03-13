import { useState, useEffect, useCallback } from 'react'
import { ShoppingBag } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

export default function OpenOrdersTab() {
  const [orders, setOrders] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*, tables(name), profiles(full_name), order_items(*, menu_items(name))')
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
              <div className="text-right">
                <p className="text-amber-400 font-bold">₦{order.total_amount?.toLocaleString()}</p>
                <p className="text-gray-500 text-xs">
                  {new Date(order.created_at).toLocaleTimeString()}
                </p>
              </div>
            </div>
            <div className="space-y-1">
              {order.order_items?.map((item: Record<string, unknown>) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-gray-300">
                    {item.quantity as number}x{' '}
                    {(item.menu_items as Record<string, unknown>)?.name as string}
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
