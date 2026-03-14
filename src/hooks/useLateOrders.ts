import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export interface LateOrder {
  id: string
  order_number?: string
  order_type: string
  customer_name?: string | null
  created_at: string
  tables?: { name: string } | null
  order_items?: Array<{ id: string; status: string; destination: string }>
}

export function useLateOrders() {
  const [lateOrders, setLateOrders] = useState<LateOrder[]>([])
  const [threshold, setThreshold] = useState(15)

  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('id', 'order_alert_threshold')
      .single()
      .then(({ data }) => {
        if (data) setThreshold(parseInt(data.value) || 15)
      })
  }, [])

  useEffect(() => {
    let active = true
    const check = async () => {
      try {
        const cutoff = new Date(Date.now() - threshold * 60 * 1000).toISOString()
        const { data, error } = await supabase
          .from('orders')
          .select(
            'id, order_number, order_type, customer_name, created_at, tables(name), order_items(id, status, destination)'
          )
          .eq('status', 'open')
          .lte('created_at', cutoff)
        if (!active || error || !data) return
        const late = (data as unknown as LateOrder[]).filter((o) =>
          o.order_items?.some((i) => i.status === 'pending')
        )
        setLateOrders(late)
      } catch {
        // Network error — silently skip this poll cycle
      }
    }
    check()
    const interval = setInterval(check, 90_000) // 90s — less noisy than 30s
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [threshold])

  const markDelivered = async (orderId: string): Promise<void> => {
    await supabase
      .from('order_items')
      .update({ status: 'delivered' })
      .eq('order_id', orderId)
      .eq('status', 'pending')
    setLateOrders((prev) => prev.filter((o) => o.id !== orderId))
  }

  return { lateOrders, threshold, setThreshold, markDelivered }
}
