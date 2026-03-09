
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useNotifications(profile) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((toast) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { ...toast, id }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 6000)
  }, [])

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  useEffect(() => {
    if (!profile) return

    const channels = []

    // 1. Order items → ready (notify waitrons + managers)
    if (['owner', 'manager', 'waitron'].includes(profile.role)) {
      const orderCh = supabase
        .channel('notify-order-ready')
        .on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'order_items',
          filter: 'status=eq.ready'
        }, (payload) => {
          const item = payload.new
          addToast({
            type: 'ready',
            title: 'Order Ready',
            message: `${item.quantity}x item is ready for table`,
            color: 'green'
          })
        })
        .subscribe()
      channels.push(orderCh)
    }

    // 2. Inventory low stock (notify managers + owners)
    if (['owner', 'manager'].includes(profile.role)) {
      const invCh = supabase
        .channel('notify-low-stock')
        .on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'inventory'
        }, (payload) => {
          const item = payload.new
          if (item.current_stock <= item.minimum_stock) {
            addToast({
              type: 'stock',
              title: 'Low Stock Alert',
              message: `${item.item_name} is running low (${item.current_stock} ${item.unit} left)`,
              color: 'amber'
            })
          }
        })
        .subscribe()
      channels.push(invCh)
    }

    // 3. Waiter calls (notify assigned waitron)
    if (['owner', 'manager', 'waitron'].includes(profile.role)) {
      const callCh = supabase
        .channel('notify-waiter-calls')
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'waiter_calls'
        }, (payload) => {
          const call = payload.new
          const isMyCall = profile.role !== 'waitron' || call.waitron_id === profile.id
          if (isMyCall) {
            addToast({
              type: 'call',
              title: 'Table Calling',
              message: `${call.table_name || 'A table'} needs attention`,
              color: 'blue'
            })
          }
        })
        .subscribe()
      channels.push(callCh)
    }

    return () => channels.forEach(ch => supabase.removeChannel(ch))
  }, [profile?.id, profile?.role])

  return { toasts, dismiss }
}
