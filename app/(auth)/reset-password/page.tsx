'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [sessionReady, setSessionReady] = useState<'loading' | 'ok' | 'no_session'>('loading')

  // When the user lands here from the email link, Supabase has already
  // set a recovery session via the URL fragment. supabase-js picks it up
  // automatically. We just need to confirm there's a session before
  // allowing the password update.
  useEffect(() => {
    const supabase = createClient()

    // First check if there's already a recovery session
    supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => {
      if (data.session) {
        setSessionReady('ok')
      } else {
        // Wait for the auth event triggered by the URL hash
        const { data: listener } = supabase.auth.onAuthStateChange((event: string, session: unknown) => {
          if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
            setSessionReady('ok')
          }
        })
        // If nothing arrives after a moment, the link is invalid/expired
        const t = setTimeout(() => {
          if (sessionReady === 'loading') setSessionReady('no_session')
        }, 2500)
        return () => {
          listener?.subscription?.unsubscribe()
          clearTimeout(t)
        }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    setSubmitting(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setSubmitting(false)

    if (error) {
      toast.error(error.message || 'Could not update password')
      return
    }

    toast.success('Password updated. Redirecting…')
    // Send them to dashboard — they're already signed in via the recovery session
    setTimeout(() => {
      const { data: { user } } = supabase.auth.getUser() as unknown as { data: { user: { id: string } | null } }
      // We don't know their role yet — push to a router-side decision
      router.push('/login')
    }, 1500)
  }

  return (
    <div className="w-full max-w-[400px]">
      <div className="bg-white rounded-xl shadow-sm px-8 py-10">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-[#0A0A0A]">XOCKS</h1>
          <p className="mt-2 text-sm text-gray-500">Set a new password</p>
        </div>

        {sessionReady === 'loading' && (
          <div className="text-center py-8 text-sm text-gray-500">
            <Loader2 className="animate-spin mx-auto mb-2" size={20} />
            Verifying reset link…
          </div>
        )}

        {sessionReady === 'no_session' && (
          <div className="text-center py-6">
            <AlertCircle size={32} className="mx-auto text-amber-500 mb-3" />
            <p className="text-sm font-semibold text-gray-800">Reset link expired or invalid</p>
            <p className="text-xs text-gray-500 mt-1.5 mb-5">
              Password reset links expire after 1 hour. Request a new one to continue.
            </p>
            <Link
              href="/login"
              className="inline-block px-5 py-2.5 bg-[#0A0A0A] text-[#FFD700] rounded-xl font-semibold text-sm hover:opacity-90"
            >
              Back to login
            </Link>
          </div>
        )}

        {sessionReady === 'ok' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                New Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className="w-full h-12 px-4 pr-12 rounded-xl border border-gray-200 bg-white text-[#0A0A0A] text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700] focus:border-transparent"
                  placeholder="At least 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-gray-400">
                Use at least 8 characters with a mix of letters and numbers
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirm New Password
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                className={cn(
                  'w-full h-12 px-4 rounded-xl border bg-white text-[#0A0A0A] text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700] focus:border-transparent',
                  confirmPassword && password !== confirmPassword ? 'border-red-300' : 'border-gray-200',
                )}
                placeholder="Re-enter password"
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="mt-1 text-xs text-red-500">Passwords do not match</p>
              )}
              {confirmPassword && password === confirmPassword && password.length >= 8 && (
                <p className="mt-1 text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle size={11} /> Passwords match
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting || password.length < 8 || password !== confirmPassword}
              className={cn(
                'w-full h-14 rounded-xl bg-[#0A0A0A] text-[#FFD700] font-semibold text-base flex items-center justify-center gap-2',
                (submitting || password.length < 8 || password !== confirmPassword)
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:opacity-90 active:opacity-80',
              )}
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Updating…
                </>
              ) : (
                'Update Password'
              )}
            </button>

            <div className="text-center pt-2">
              <Link href="/login" className="text-sm text-gray-500 hover:text-gray-800 underline">
                Back to login
              </Link>
            </div>
          </form>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-gray-400">
        © Xocks by Wayne Group Holding
      </p>
    </div>
  )
}

export default function ResetPasswordPageWrapper() {
  return (
    <Suspense fallback={<div className="text-center text-sm text-gray-400">Loading…</div>}>
      <ResetPasswordPage />
    </Suspense>
  )
}
