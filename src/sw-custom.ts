/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
precacheAndRoute((self as any).__WB_MANIFEST || [])

self.skipWaiting()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(self as any).clients?.claim()

// ── Push notifications ─────────────────────────────────────────────────────
self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return

  let payload: { title?: string; body?: string; data?: Record<string, unknown> }
  try {
    payload = event.data.json() as typeof payload
  } catch {
    payload = { title: "Beeshop's Place", body: event.data.text() }
  }

  const title = payload.title || "Beeshop's Place"
  const options: NotificationOptions = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'restaurantos',
    renotify: true,
    data: payload.data || {},
    vibrate: [200, 100, 200],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  event.waitUntil(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((clients: any[]) => {
        if (clients.length > 0) {
          return clients[0].focus()
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (self as any).clients.openWindow('/')
      })
  )
})
