'use client'

import { useRef, useState } from 'react'
import { Upload, FileText, CheckCircle2, X, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

type Platform = 'shopee' | 'tiktok' | 'website' | 'instagram' | 'instore' | ''

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'shopee', label: 'Shopee' },
  { value: 'tiktok', label: 'TikTok Shop' },
  { value: 'website', label: 'Website' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'instore', label: 'In-store' },
  { value: '', label: 'Mixed / not sure' },
]

interface UploadResult {
  uploaded: number
  matched: number
  stillPending: number
  perksGranted: number
}

function parseOrderNumbersFromText(text: string): string[] {
  return [...new Set(text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean))]
}

function parseOrderNumbersFromCSV(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const splitLine = (line: string) => line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
  const headers = splitLine(lines[0])
  const col = headers.find((h) => h.toLowerCase().replace(/[^a-z]/g, '').includes('order')) || headers[0]
  const colIndex = headers.indexOf(col)
  const values = lines.slice(1).map((l) => splitLine(l)[colIndex]?.trim() ?? '')
  return [...new Set(values.filter(Boolean))]
}

export default function GangOrdersPage() {
  const [platform, setPlatform] = useState<Platform>('shopee')
  const [pasted, setPasted] = useState('')
  const [orderNumbers, setOrderNumbers] = useState<string[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [closingOut, setClosingOut] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function handlePasteChange(value: string) {
    setPasted(value)
    setFileName(null)
    setOrderNumbers(parseOrderNumbersFromText(value))
  }

  function handleFile(file: File) {
    file.text().then((text) => {
      const numbers = parseOrderNumbersFromCSV(text)
      if (!numbers.length) {
        toast.error("Couldn't find an order-number column in that file — try pasting the numbers instead.")
        return
      }
      setFileName(file.name)
      setPasted('')
      setOrderNumbers(numbers)
    })
  }

  async function handleUpload() {
    if (!orderNumbers.length) return
    setUploading(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/gang/upload-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'upload',
          orderNumbers: orderNumbers.map((n) => ({ order_number: n, platform: platform || undefined })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Upload failed')
        return
      }
      setResult(data)
      toast.success(`Uploaded ${data.uploaded} order number(s)`)
      setOrderNumbers([])
      setPasted('')
      setFileName(null)
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setUploading(false)
    }
  }

  async function handleCloseOut() {
    if (!confirm("Mark all remaining pending Gang orders from today or earlier as \"not found\"? Only do this once all of today's platform lists are uploaded.")) {
      return
    }
    setClosingOut(true)
    try {
      const res = await fetch('/api/admin/gang/upload-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'close_out' }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Failed')
        return
      }
      toast.success(`Marked ${data.invalidated} stale pending order(s) as not found`)
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setClosingOut(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Xocks Gang — Verify Orders</h2>
        <p className="text-sm text-gray-500">
          Upload today&apos;s confirmed Shopee/TikTok order numbers to verify Gang registrations. Shopify orders sync
          automatically and don&apos;t need this step.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Platform</p>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.value || 'mixed'}
                onClick={() => setPlatform(p.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  platform === p.value
                    ? 'bg-[#0A0A0A] text-[#FFD700] border-[#0A0A0A]'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Order numbers</p>
          <textarea
            value={pasted}
            onChange={(e) => handlePasteChange(e.target.value)}
            placeholder={'Paste order numbers, one per line (or comma-separated)\ne.g.\nSPX1029384756\nSPX1029384757'}
            rows={6}
            className="w-full rounded-lg border border-gray-200 p-3 text-sm font-mono focus:outline-none focus:border-gray-400"
          />
          <div className="flex items-center gap-3 mt-2">
            <div className="h-px flex-1 bg-gray-100" />
            <span className="text-xs text-gray-400">or</span>
            <div className="h-px flex-1 bg-gray-100" />
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-2 w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 hover:border-gray-300 rounded-lg py-4 text-sm text-gray-500"
          >
            <Upload size={16} />
            {fileName ? `${fileName} — click to replace` : 'Upload a CSV export (auto-detects the order-number column)'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
        </div>

        {orderNumbers.length > 0 && (
          <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <FileText size={16} className="text-gray-400" />
              <span className="font-medium">{orderNumbers.length} order number(s) ready</span>
            </div>
            <button
              onClick={() => {
                setOrderNumbers([])
                setPasted('')
                setFileName(null)
              }}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
            >
              <X size={12} /> Clear
            </button>
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={!orderNumbers.length || uploading}
          className="w-full px-5 py-2.5 bg-[#0A0A0A] text-[#FFD700] text-sm font-semibold rounded-lg hover:opacity-80 disabled:opacity-40 transition-opacity"
        >
          {uploading ? 'Uploading…' : `Upload ${orderNumbers.length || ''} Order Number${orderNumbers.length === 1 ? '' : 's'}`.trim()}
        </button>
      </div>

      {result && (
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-3">
            <CheckCircle2 size={16} className="text-green-600" /> Upload complete
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-lg font-semibold text-gray-900">{result.uploaded}</p>
              <p className="text-xs text-gray-500">Uploaded</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-lg font-semibold text-gray-900">{result.matched}</p>
              <p className="text-xs text-gray-500">Newly verified</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-lg font-semibold text-gray-900">{result.stillPending}</p>
              <p className="text-xs text-gray-500">Still pending</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-lg font-semibold text-gray-900">{result.perksGranted}</p>
              <p className="text-xs text-gray-500">Perks granted</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-500 flex-none mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">Close out today</p>
            <p className="text-xs text-gray-500 mt-1">
              Once every platform&apos;s list is uploaded for the day, mark any order still pending as &quot;not
              found&quot; so those customers get a clear WhatsApp escalation prompt. Only do this after all of
              today&apos;s lists are in — it&apos;s a one-way action.
            </p>
            <button
              onClick={handleCloseOut}
              disabled={closingOut}
              className="mt-3 px-4 py-1.5 text-sm font-medium text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 disabled:opacity-40"
            >
              {closingOut ? 'Closing out…' : 'Close out today’s pending orders'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
