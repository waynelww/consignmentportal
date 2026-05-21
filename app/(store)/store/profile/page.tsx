'use client'

import { useEffect, useState } from 'react'
import { CreditCard, Store, ChevronRight, Building2, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Store as StoreType, Profile } from '@/types'
import Link from 'next/link'

export default function StoreProfilePage() {
  const [store, setStore] = useState<StoreType | null>(null)
  const [loading, setLoading] = useState(true)

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

      const { data: s } = await supabase
        .from('stores')
        .select('*')
        .eq('id', profile.store_id)
        .single<StoreType>()

      if (s) setStore(s)
      setLoading(false)
    }
    load()
  }, [])

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
        {([
          ['Store Name', store?.store_name],
          ['Store Code', store?.store_code],
          ['PIC Name', store?.pic_name],
          ['Phone', store?.pic_phone],
          ['Address', [store?.address, store?.city, store?.state, store?.postcode].filter(Boolean).join(', ')],
          ['Commission Rate', store?.commission_rate ? `${store.commission_rate}%` : null],
        ] as [string, string | null | undefined][]).map(([label, value]) => value ? (
          <div key={label} className="flex items-start justify-between gap-4">
            <span className="text-xs text-gray-400 shrink-0 w-28">{label}</span>
            <span className="text-sm text-gray-800 text-right">{value}</span>
          </div>
        ) : null)}
      </div>

      {/* Pay commission to — company bank details */}
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Building2 size={16} className="text-gray-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pay the Balance To</span>
        </div>
        <div className="bg-[#FFD700]/10 border border-[#FFD700]/30 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertCircle size={14} className="text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700">
            Pay the balance before the <strong>7th of each month</strong>. Use your store code as the payment reference.{' '}
            <strong className="text-red-600">Late payment will incur a 10% surcharge on the outstanding amount.</strong>
          </p>
        </div>
        {([
          ['Bank', 'CIMB Bank'],
          ['Account Name', 'WAYNE GROUP HOLDING SDN BHD'],
          ['Account No.', '8605806682'],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4">
            <span className="text-xs text-gray-400 shrink-0 w-28">{label}</span>
            <span className="text-sm text-gray-800 font-mono font-medium text-right">{value}</span>
          </div>
        ))}
        <div className="border-t border-gray-100 pt-2 mt-1">
          <p className="text-xs text-gray-400">Payment reference: <span className="font-mono font-semibold text-gray-700">{store?.store_code ?? '—'}</span></p>
        </div>
      </div>

      {/* Commission shortcut */}
      <Link
        href="/store/commissions"
        className="bg-white rounded-xl shadow-sm p-4 flex items-center justify-between"
      >
        <div>
          <p className="text-sm font-semibold text-[#0A0A0A]">Commission & Invoices</p>
          <p className="text-xs text-gray-400 mt-0.5">View earnings and monthly statements</p>
        </div>
        <ChevronRight size={18} className="text-gray-400" />
      </Link>
    </div>
  )
}
