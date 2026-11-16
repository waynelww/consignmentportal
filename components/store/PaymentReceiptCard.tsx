'use client'

import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock, Loader2, MessageCircle, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'
import { prepareReceiptFile, RECEIPT_ACCEPT } from '@/lib/receipts/prepare-file'
import type { CommissionPeriod } from '@/types'

interface Props {
  period: CommissionPeriod
  storeCode: string
  onChanged: () => void
}

/** The Upload receipt button is only for unpaid invoices that have an amount to transfer. */
export function canUploadReceipt(period: CommissionPeriod): boolean {
  return period.status !== 'paid' && Number(period.xocks_revenue) > 0
}

/**
 * "Upload receipt" (or "Upload again" after a rejection). Goes in the invoice
 * card's header row, to the left of the Invoice button. Outline style so the
 * Invoice button stays the main one. English only.
 */
export function ReceiptUploadButton({ period, onChanged }: { period: CommissionPeriod; onChanged: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const label = period.receipt?.status === 'rejected' ? 'Upload again' : 'Upload receipt'

  async function handlePicked(file: File) {
    setBusy(true)
    try {
      const ready = await prepareReceiptFile(file)
      const form = new FormData()
      form.append('file', ready)
      form.append('period_id', period.id)
      const res = await fetch('/api/payments/receipts', { method: 'POST', body: form })
      const body = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) {
        toast.error(body.error ?? `Upload failed (HTTP ${res.status})`)
        return
      }
      toast.success('Receipt sent. Xocks will check it shortly.')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={RECEIPT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Clear the input so picking the same file again still fires onChange.
          e.target.value = ''
          if (file) handlePicked(file)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="flex items-center gap-1.5 text-xs border border-[#0A0A0A] text-[#0A0A0A] bg-white font-medium px-3 py-1.5 rounded-lg disabled:opacity-60"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
        {busy ? 'Uploading…' : label}
      </button>
    </>
  )
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

  const receipt = period.receipt ?? null

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
      <div className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
        <span className="text-xs font-medium text-amber-800">To transfer to Xocks</span>
        <span className="text-sm font-bold text-amber-900">{formatCurrency(period.xocks_revenue)}</span>
      </div>

      {receipt?.status === 'submitted' && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
          <Clock size={14} className="text-blue-600 mt-0.5 shrink-0" />
          <div className="min-w-0 text-xs text-blue-800">
            <p className="font-semibold">Receipt sent · Xocks will check it shortly</p>
            {receipt.file_name && <p className="mt-0.5 truncate text-blue-700">{receipt.file_name}</p>}
          </div>
        </div>
      )}

      {receipt?.status === 'rejected' && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
          <AlertCircle size={14} className="text-red-600 mt-0.5 shrink-0" />
          <div className="min-w-0 text-xs text-red-800">
            <p className="font-semibold">Receipt rejected</p>
            {receipt.admin_notes && <p className="mt-0.5">{receipt.admin_notes}</p>}
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
        <MessageCircle size={14} className="text-green-600 mt-0.5 shrink-0" />
        <p className="text-xs text-green-800">
          Once payment is done, tap Upload receipt above. You can still send it to the WhatsApp group if that&apos;s easier.
        </p>
      </div>
    </div>
  )
}
