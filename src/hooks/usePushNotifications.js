import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

export function usePushNotifications(staffId) {
  useEffect(() => {
    if (!staffId || !('serviceWorker' in navigator) || !('PushManager' in window)) return

    async function register() {
      try {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') return

        const reg = await navigator.serviceWorker.ready
        const existing = await reg.pushManager.getSubscription()
        const sub = existing || await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        })

        await supabase.from('push_subscriptions').upsert({
          staff_id: staffId,
          subscription: sub.toJSON(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'staff_id,subscription' })
      } catch (e) {
        console.error('Push registration failed:', e)
      }
    }

    register()
  }, [staffId])
}

export async function sendPushToStaff(staffId, title, body, data = {}) {
  try {
    await fetch('/api/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': import.meta.env.VITE_INTERNAL_API_SECRET || ''
      },
      body: JSON.stringify({ staff_id: staffId, title, body, data })
    })
  } catch (e) {
    console.error('Push send failed:', e)
  }
}
