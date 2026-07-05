'use client'

import { CheckCircle2, MessageCircle } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import type { CommissionPeriod } from '@/types'

interface Props {
  period: CommissionPeriod
  storeCode: string
  onChanged: () => void
}

export default function PaymentReceiptCard({ period }: Props) {
  if (period.status === 'paid') {
    return (
      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-1.5 text-xs text-green-600">
        <CheckCircle2 size={13} />
        <span>Payment receipt verified by Xocks</span>
      </div>
    )
  }

  if (Number(period.xocks_revenue) <= 0) return null

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
      <div className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
        <span className="text-xs font-medium text-amber-800">To transfer to Xocks</span>
        <span className="text-sm font-bold text-amber-900">{formatCurrency(period.xocks_revenue)}</span>
      </div>

      <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
        <MessageCircle size={14} className="text-green-600 mt-0.5 shrink-0" />
        <p className="text-xs text-green-800">
          Once payment is done, please send your receipt to the{' '}
          <span className="font-semibold">related WhatsApp group</span>.
          Our team will verify and update your status shortly.
        </p>
      </div>
    </div>
  )
}
