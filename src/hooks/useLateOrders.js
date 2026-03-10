import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useLateOrders() {
  const [lateOrders, setLateOrders] = useState([])
  const [threshold, setThreshold] = useState(15)

  useEffect(() => {
    supabase.from('settings').select('value').eq('id', 'order_alert_threshold').single()
      .then(({ data }) => { if (data) setThreshold(parseInt(data.value) || 15) })
  }, [])

  useEffect(() => {
    const check = async () => {
      const cutoff = new Date(Date.now() - threshold * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('orders')
        .select('id, order_number, order_type, customer_name, created_at, tables(name), order_items(id, status, destination)')
        .eq('status', 'open')
        .lte('created_at', cutoff)
      
      if (!data) return

      // Only include orders that still have pending items
      const late = data.filter(o => o.order_items?.some(i => i.status === 'pending'))
      setLateOrders(late)
    }
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [threshold])

  const markDelivered = async (orderId) => {
    await supabase.from('order_items')
      .update({ status: 'delivered' })
      .eq('order_id', orderId)
      .eq('status', 'pending')
    setLateOrders(prev => prev.filter(o => o.id !== orderId))
  }

  return { lateOrders, threshold, setThreshold, markDelivered }
}
