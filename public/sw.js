// Xocks XCMS — Service Worker
// Handles Web Push notifications for PWA home-screen installs

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// ── Push handler ─────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = { title: 'Xocks', body: 'You have a new notification.', url: '/store/dashboard' }

  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {}

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag || 'xocks-notification',
      renotify: true,
      data: { url: payload.url },
      vibrate: [200, 100, 200],
    })
  )
})

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/store/dashboard'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      // Otherwise open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
    })
  )
})
