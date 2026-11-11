'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Loader2, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { buildWelcomeMessage, whatsappUrl } from '@/lib/stores/welcome-message'

interface StoreLoginCardProps {
  storeId: string
  storeName: string
  picName: string
  picPhone: string
}

interface IssuedLogin {
  email: string
  temporary_password: string
}

/**
 * "Store login" box on the store Overview tab. Shows the store owner's login email
 * and resets their password. The new password is shown ONCE, in this component's
 * state only: it is not stored, logged or sent anywhere except the welcome message
 * the admin copies or sends. Leaving the tab clears it.
 */
export function StoreLoginCard({ storeId, storeName, picName, picPhone }: StoreLoginCardProps) {
  const [loading, setLoading] = useState(true)
  const [hidden, setHidden] = useState(false) // not an admin: the API said 403
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasLogin, setHasLogin] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [issued, setIssued] = useState<IssuedLogin | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/stores/${storeId}/reset-login`)
      .then(async (res) => {
        if (res.status === 403) {
          if (!cancelled) setHidden(true)
          return
        }
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? 'Could not load the store login')
        if (!cancelled) {
          setHasLogin(Boolean(body.has_login))
          setEmail(body.email ?? null)
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [storeId])

  if (hidden) return null

  async function resetLogin() {
    if (!email) return
    if (!window.confirm(`This will replace ${email}'s current password. Continue?`)) return
    setResetting(true)
    try {
      const res = await fetch(`/api/stores/${storeId}/reset-login`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error ?? 'Could not reset the password')
        return
      }
      setIssued({ email: body.email, temporary_password: body.temporary_password })
      toast.success('New temporary password created')
    } catch {
      toast.error('Could not reset the password')
    } finally {
      setResetting(false)
    }
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    toast.success(`${field} copied`)
    setTimeout(() => setCopiedField(null), 2000)
  }

  // Same message as Add Store: built by the shared lib, not copied here.
  const welcome = issued
    ? buildWelcomeMessage({
        picName,
        storeName,
        loginUrl: typeof window !== 'undefined' ? `${window.location.origin}/login` : '',
        email: issued.email,
        password: issued.temporary_password,
      })
    : ''

  return (
    <div className="bg-gray-50 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Store login</h3>

      {loading ? (
        <div className="h-16 bg-gray-200 animate-pulse rounded-lg" />
      ) : loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : (
        <>
          <dl className="space-y-2 mb-4">
            <div className="flex gap-2">
              <dt className="text-xs text-gray-500 w-32 flex-shrink-0">Login email</dt>
              <dd className="text-sm text-gray-800 font-medium break-all">
                {hasLogin && email ? email : 'No store owner login found'}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            onClick={resetLogin}
            disabled={!hasLogin || resetting}
            className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-[#0A0A0A] text-white hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {resetting && <Loader2 size={14} className="animate-spin" />}
            {resetting ? 'Resetting...' : 'Reset password & resend login'}
          </button>
          <p className="text-xs text-gray-500 mt-2">
            Creates a new temporary password. The owner&apos;s current password stops working.
          </p>

          {issued && (
            <div className="mt-4 border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-amber-900">
                New temporary password. Shown once: copy or send it before you leave this tab.
              </p>
              <pre className="text-[11px] text-gray-600 bg-white/70 rounded-lg p-3 max-h-60 overflow-y-auto whitespace-pre-wrap font-sans border border-amber-100">
                {welcome}
              </pre>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => copyToClipboard(welcome, 'Welcome message')}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-[#0A0A0A] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-all"
                >
                  {copiedField === 'Welcome message' ? <Check size={14} /> : <Copy size={14} />}
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => window.open(whatsappUrl(picPhone, welcome), '_blank')}
                  disabled={!picPhone}
                  title={picPhone ? `Send to ${picPhone}` : 'This store has no PIC phone'}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 transition-all"
                >
                  <MessageCircle size={14} />
                  Send on WhatsApp
                </button>
              </div>
              <button
                type="button"
                onClick={() => setIssued(null)}
                className="w-full px-3 py-2 text-xs font-medium text-gray-600 hover:text-gray-900"
              >
                Done (clears the password from this screen)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
