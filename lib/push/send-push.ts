import webpush from 'web-push'

const VAPID_PUBLIC  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY!
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:hello@xocks.co'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

export interface PushSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Send a push notification to a single subscription.
 * Returns true on success, false if the subscription is expired/invalid (should be deleted).
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload
): Promise<{ ok: boolean; expired: boolean }> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload),
      { urgency: 'normal', TTL: 86400 }  // 24h TTL
    )
    return { ok: true, expired: false }
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode
    // 410 Gone / 404 Not Found → subscription has been revoked, delete it
    if (status === 410 || status === 404) {
      return { ok: false, expired: true }
    }
    console.error('[sendPushNotification] error:', (err as Error).message)
    return { ok: false, expired: false }
  }
}

/**
 * Send a push to all subscriptions for a store.
 * Automatically cleans up expired subscriptions.
 */
export async function sendPushToStore(
  subscriptions: PushSubscription[],
  payload: PushPayload
): Promise<{ sent: number; expired: string[] }> {
  let sent = 0
  const expired: string[] = []

  await Promise.all(
    subscriptions.map(async (sub) => {
      const result = await sendPushNotification(sub, payload)
      if (result.ok) sent++
      if (result.expired) expired.push(sub.endpoint)
    })
  )

  return { sent, expired }
}
