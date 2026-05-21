'use client'

/**
 * PushSubscriber
 * Mounts in the store layout. On first visit after the user is logged in:
 *  1. Registers the service worker
 *  2. Asks for notification permission (browser prompt)
 *  3. Subscribes to Web Push and saves to /api/push/subscribe
 *
 * Re-runs if the subscription is missing (e.g. cleared by browser).
 * Silent on iOS Safari < 16.4 (no Web Push support).
 */

import { useEffect } from 'react'

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!

// Convert base64url → Uint8Array for applicationServerKey
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const buffer = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return view
}

export default function PushSubscriber() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (!VAPID_PUBLIC) return

    async function setup() {
      try {
        // Register SW
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        await navigator.serviceWorker.ready

        // Ask permission if not already decided
        let perm = Notification.permission
        if (perm === 'default') {
          perm = await Notification.requestPermission()
        }
        if (perm !== 'granted') return

        // Check if we already have a valid subscription
        const existing = await reg.pushManager.getSubscription()
        if (existing) {
          // Already subscribed — ensure it's saved server-side (idempotent upsert)
          await saveSubscription(existing)
          return
        }

        // Subscribe
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
        })

        await saveSubscription(sub)
      } catch (err) {
        // Non-fatal — silently fail (user may have blocked notifications)
        console.warn('[PushSubscriber]', err)
      }
    }

    setup()
  }, [])

  // No UI — purely side-effect
  return null
}

async function saveSubscription(sub: PushSubscription) {
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys) return
  try {
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: json.keys,
      }),
    })
  } catch {
    // Server unreachable — subscription will be saved on next visit
  }
}
