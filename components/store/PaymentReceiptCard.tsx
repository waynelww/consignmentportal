'use client'

import { useRef, useState } from 'react'
import { Upload, Loader2, Clock3, CheckCircle2, XCircle, Receipt } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, cn } from '@/lib/utils'
import type { CommissionPeriod } from '@/types'

const MAX_BYTES = 4 * 1024 * 1024   // 4 MB — matches server limit
const ACCEPT = 'image/*,.pdf'        // image/* allows any photo including HEIC

interface Props {
  period: CommissionPeriod
  storeCode: string
  onChanged: () => void
}

export default function PaymentReceiptCard({ period, storeCode, onChanged }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [bankRef, setBankRef] = useState('')
  const [showForm, setShowForm] = useState(false)

  const receipt = period.receipt ?? null

  // Nothing to do once the invoice is settled
  if (period.status === 'paid') {
    return receipt?.status === 'confirmed' ? (
      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-1.5 text-xs text-green-600">
        <CheckCircle2 size={13} />
        <span>Payment receipt verified by Xocks</span>
      </div>
    ) : null
  }

  // Zero balance — nothing for the store to transfer
  if (Number(period.xocks_revenue) <= 0) return null

  async function handleFile(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error('File too large — max 4 MB. Try a screenshot or compressed photo.')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('period_id', period.id)
      if (bankRef.trim()) fd.append('bank_reference', bankRef.trim())

      const res = await fetch('/api/payments/receipts', { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error ?? 'Upload failed — please try again')
        return
      }
      toast.success('Receipt submitted — Xocks will verify your payment shortly.')
      setShowForm(false)
      setBankRef('')
      onChanged()
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
      {/* The number that matters: what this store owes Xocks */}
      <div className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
        <span className="text-xs font-medium text-amber-800">To transfer to Xocks</span>
        <span className="text-sm font-bold text-amber-900">{formatCurrency(period.xocks_revenue)}</span>
      </div>

      {/* Review state */}
      {receipt?.status === 'submitted' && (
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1.5 text-blue-700 bg-blue-50 px-2 py-1 rounded-full font-semibold">
            <Clock3 size={12} />
            Receipt under review
          </span>
          <a
            href={`/api/payments/receipts/${receipt.id}/file`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 underline"
          >
            View receipt
          </a>
        </div>
      )}

      {receipt?.status === 'rejected' && (
        <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 space-y-1">
          <p className="inline-flex items-center gap-1.5 text-xs font-bold text-red-700">
            <XCircle size={12} />
            Receipt rejected — please re-upload
          </p>
          {receipt.admin_notes && (
            <p className="text-xs text-red-600">{receipt.admin_notes}</p>
          )}
        </div>
      )}

      {/* Upload (initial, replace, or re-submit after rejection) */}
      {(!receipt || receipt.status === 'rejected' || (receipt.status === 'submitted' && showForm)) && (
        <div className="space-y-2">
          {!receipt || receipt.status === 'rejected' ? (
            <input
              type="text"
              value={bankRef}
              onChange={(e) => setBankRef(e.target.value)}
              placeholder="Bank reference no. (optional)"
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
            />
          ) : null}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className={cn(
              'w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-opacity',
              'bg-[#0A0A0A] text-[#FFD700] hover:opacity-90 disabled:opacity-50',
            )}
          >
            {uploading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Upload size={14} />
                {receipt ? 'Upload New Receipt' : 'Upload Payment Receipt'}
              </>
            )}
          </button>
        </div>
      )}

      {/* Replace link while under review */}
      {receipt?.status === 'submitted' && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="text-[11px] text-gray-400 underline flex items-center gap-1"
        >
          <Receipt size={11} />
          Wrong file? Replace receipt
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
      />
    </div>
  )
}
