import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useLateOrders() {
  const [lateOrders, setLateOrders] = useState([])
  const [threshold, setThreshold] = useState(15)

  useEffect(() => {
    // Fetch threshold setting
    supabase.from('settings').select('value').eq('id', 'order_alert_threshold').single()
      .then(({ data }) => { if (data) setThreshold(parseInt(data.value) || 15) })
  }, [])

  useEffect(() => {
    const check = async () => {
      const cutoff = new Date(Date.now() - threshold * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('order_items')
        .select('id, destination, created_at, status, orders(id, order_number, tables(name), customer_name, order_type)')
        .eq('status', 'pending')
        .lte('created_at', cutoff)
      setLateOrders(data || [])
    }
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [threshold])

  return { lateOrders, threshold, setThreshold }
}
