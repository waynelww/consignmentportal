'use client'

import { useEffect, useState } from 'react'
import { QrCode, CreditCard, Store, ChevronRight, CheckCircle, ExternalLink } from 'lucide-react'
import QRCode from 'react-qr-code'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import type { Store as StoreType, Profile } from '@/types'
import Link from 'next/link'

export default function StoreProfilePage() {
  const [store, setStore] = useState<StoreType | null>(null)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [paymentUrl, setPaymentUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [previewUrl, setPreviewUrl] = useState('')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('store_id')
        .eq('id', user.id)
        .single<Profile>()

      if (!profile?.store_id) { setLoading(false); return }
      setStoreId(profile.store_id)

      const { data: s } = await supabase
        .from('stores')
        .select('*')
        .eq('id', profile.store_id)
        .single<StoreType>()

      if (s) {
        setStore(s)
        setPaymentUrl(s.payment_qr_url ?? '')
        setPreviewUrl(s.payment_qr_url ?? '')
      }
      setLoading(false)
    }
    load()
  }, [])

  async function savePaymentQr() {
    if (!storeId) return
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('stores')
      .update({ payment_qr_url: paymentUrl.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', storeId)

    setSaving(false)
    if (error) {
      toast.error('Failed to save. Try again.')
    } else {
      setPreviewUrl(paymentUrl.trim())
      setStore((prev) => prev ? { ...prev, payment_qr_url: paymentUrl.trim() || null } : prev)
      toast.success('Payment QR saved!')
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-5 max-w-lg mx-auto space-y-4">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      <h1 className="text-xl font-bold text-[#0A0A0A]">My Profile</h1>

      {/* Store info */}
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Store size={16} className="text-gray-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Store Info</span>
        </div>
        {[
          ['Store Name', store?.store_name],
          ['Store Code', store?.store_code],
          ['PIC Name', store?.pic_name],
          ['Phone', store?.pic_phone],
          ['Address', [store?.address, store?.city, store?.state, store?.postcode].filter(Boolean).join(', ')],
        ].map(([label, value]) => value ? (
          <div key={label as string} className="flex items-start justify-between gap-4">
            <span className="text-xs text-gray-400 shrink-0 w-24">{label}</span>
            <span className="text-sm text-gray-800 text-right">{value}</span>
          </div>
        ) : null)}
      </div>

      {/* Bank info */}
      {(store?.bank_name || store?.bank_account_number) && (
        <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard size={16} className="text-gray-400" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Bank Details (for commission payout)</span>
          </div>
          {[
            ['Bank', store?.bank_name],
            ['Account No.', store?.bank_account_number],
            ['Account Name', store?.bank_account_name],
          ].map(([label, value]) => value ? (
            <div key={label as string} className="flex items-start justify-between gap-4">
              <span className="text-xs text-gray-400 shrink-0 w-28">{label}</span>
              <span className="text-sm text-gray-800 font-mono text-right">{value}</span>
            </div>
          ) : null)}
        </div>
      )}

      {/* Commission shortcut */}
      <Link
        href="/store/commissions"
        className="bg-white rounded-xl shadow-sm p-4 flex items-center justify-between"
      >
        <div>
          <p className="text-sm font-semibold text-[#0A0A0A]">Commission & Invoices</p>
          <p className="text-xs text-gray-400 mt-0.5">View earnings and monthly invoices</p>
        </div>
        <ChevronRight size={18} className="text-gray-400" />
      </Link>

      {/* Payment QR setup */}
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-4">
        <div className="flex items-center gap-2">
          <QrCode size={16} className="text-gray-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">My Payment QR</span>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 space-y-1">
          <p className="font-semibold">How to get your payment link:</p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>Open your TNG, Maybank, CIMB, or any bank app</li>
            <li>Go to "Receive" / "Collect Money" / "My QR"</li>
            <li>Tap "Share" and copy the payment link</li>
            <li>Paste it below</li>
          </ol>
          <p className="text-blue-500 mt-1">Works with TNG, DuitNow, Boost, MAE, and all Malaysian banks.</p>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1.5">Payment link (DuitNow / TNG / Bank)</label>
          <input
            type="url"
            value={paymentUrl}
            onChange={(e) => setPaymentUrl(e.target.value)}
            placeholder="https://pay.tngd.my/... or https://..."
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
          />
        </div>

        {/* Preview */}
        {previewUrl && (
          <div className="flex flex-col items-center gap-3 py-4 border border-gray-100 rounded-xl bg-gray-50">
            <p className="text-xs text-gray-400">Preview — this is what customers will see</p>
            <div className="p-3 bg-white border border-gray-200 rounded-xl shadow-sm">
              <QRCode value={previewUrl} size={180} />
            </div>
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-blue-500 underline"
            >
              Test the link <ExternalLink size={11} />
            </a>
          </div>
        )}

        <button
          onClick={savePaymentQr}
          disabled={saving}
          className="w-full h-12 rounded-xl bg-[#0A0A0A] text-[#FFD700] font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving ? 'Saving…' : (
            <>
              <CheckCircle size={16} />
              Save Payment QR
            </>
          )}
        </button>
      </div>
    </div>
  )
}
