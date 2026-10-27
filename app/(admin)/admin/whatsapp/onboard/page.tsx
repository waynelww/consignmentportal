'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Link2, Smartphone } from 'lucide-react'

// Coexistence onboarding for the CS number via Meta's Embedded Signup.
// The flow: admin clicks Connect → Meta dialog → enter the CS number →
// choose "already using the WhatsApp Business app" → Meta drops a QR code
// INSIDE the WhatsApp Business app on the CS phone → CS scans it → number
// is registered for the Cloud API while the app keeps working.
//
// Requires (set in Vercel + .env.local):
//   NEXT_PUBLIC_FB_APP_ID        — the Meta app id
//   NEXT_PUBLIC_WA_ES_CONFIG_ID  — a "Facebook Login for Business"
//     configuration id of type WhatsApp Embedded Signup.

declare global {
  interface Window {
    FB?: {
      init: (opts: Record<string, unknown>) => void
      login: (cb: (response: unknown) => void, opts: Record<string, unknown>) => void
    }
    fbAsyncInit?: () => void
  }
}

interface SessionInfo {
  type?: string
  event?: string
  data?: Record<string, unknown>
}

export default function WaOnboardPage() {
  const appId = process.env.NEXT_PUBLIC_FB_APP_ID
  const configId = process.env.NEXT_PUBLIC_WA_ES_CONFIG_ID
  const [sdkReady, setSdkReady] = useState(false)
  const [events, setEvents] = useState<string[]>([])
  const [finished, setFinished] = useState(false)
  const loaded = useRef(false)

  useEffect(() => {
    if (!appId || loaded.current) return
    loaded.current = true

    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: true, version: 'v24.0' })
      setSdkReady(true)
    }
    const script = document.createElement('script')
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.async = true
    script.defer = true
    document.body.appendChild(script)

    // Embedded Signup reports progress via postMessage from facebook.com.
    const onMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith('facebook.com')) return
      try {
        const info: SessionInfo = JSON.parse(event.data)
        if (info.type === 'WA_EMBEDDED_SIGNUP') {
          setEvents((prev) => [...prev, `${info.event}: ${JSON.stringify(info.data ?? {})}`])
          if (info.event === 'FINISH' || info.event === 'FINISH_ONLY_WABA') setFinished(true)
        }
      } catch {
        // Non-JSON messages from other frames — ignore.
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [appId])

  function launch() {
    window.FB?.login(
      () => {
        // The auth code response isn't needed: XCMS already holds a
        // system-user token for this WABA. The postMessage events above
        // carry the onboarding outcome.
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          // The coexistence flow — onboard a number that stays on the
          // WhatsApp Business app.
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      },
    )
  }

  const missing = !appId || !configId

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Connect the CS number (coexistence)</h2>
        <p className="text-sm text-gray-500">
          Links the customer-service WhatsApp number to the Cloud API while the WhatsApp Business app keeps
          working on the CS phone.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4 text-sm text-gray-700">
        <div className="flex gap-3">
          <Smartphone size={18} className="text-gray-400 flex-none mt-0.5" />
          <div>
            <p className="font-semibold text-gray-900">Before you start</p>
            <ul className="list-disc ml-4 mt-1 space-y-1 text-gray-600">
              <li>The CS phone is nearby and its WhatsApp Business app is updated to the latest version.</li>
              <li>You are logged into Facebook in this browser as the Xocks business admin.</li>
            </ul>
          </div>
        </div>
        <div className="flex gap-3">
          <Link2 size={18} className="text-gray-400 flex-none mt-0.5" />
          <div>
            <p className="font-semibold text-gray-900">What happens</p>
            <ol className="list-decimal ml-4 mt-1 space-y-1 text-gray-600">
              <li>A Meta dialog opens. Choose the Xocks business and WhatsApp account when asked.</li>
              <li>Enter the CS number and pick the option for a number already using the WhatsApp Business app.</li>
              <li>A QR code appears as a message inside the WhatsApp Business app on the CS phone — scan it there.</li>
              <li>Done: the app keeps working, and XCMS can send from this number.</li>
            </ol>
          </div>
        </div>

        {missing ? (
          <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            NEXT_PUBLIC_FB_APP_ID / NEXT_PUBLIC_WA_ES_CONFIG_ID are not configured — set them in Vercel and
            redeploy first.
          </p>
        ) : (
          <button
            onClick={launch}
            disabled={!sdkReady}
            className="w-full px-5 py-2.5 bg-[#0A0A0A] text-[#FFD700] text-sm font-semibold rounded-lg hover:opacity-80 disabled:opacity-40"
          >
            {sdkReady ? 'Connect WhatsApp number' : 'Loading Meta SDK…'}
          </button>
        )}
      </div>

      {(events.length > 0 || finished) && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            {finished && <CheckCircle2 size={16} className="text-green-600" />}
            {finished ? 'Onboarding finished' : 'Progress'}
          </div>
          <ul className="text-xs font-mono text-gray-600 space-y-1">
            {events.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          {finished && (
            <p className="text-xs text-gray-500">
              Tell Claude it finished — the phone number id gets wired into the env vars next.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
