'use client'

import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Upload, FileSpreadsheet, X } from 'lucide-react'
import { toast } from 'sonner'

// Shopee / TikTok Shop order-export uploader for the performance dashboard.
// Parses the file in the browser (same approach as the Gang uploader, but
// this one keeps the money columns), auto-detects columns, and shows a
// mapping preview before anything is sent — export headers vary by
// platform version/locale, and money columns must never be silently guessed.

type Platform = 'shopee' | 'tiktok'

type FieldKey = 'order_id' | 'order_date' | 'sku' | 'product_name' | 'quantity' | 'line_revenue' | 'settlement_amount' | 'status'

const FIELDS: { key: FieldKey; label: string; required: boolean }[] = [
  { key: 'order_id', label: 'Order ID', required: true },
  { key: 'order_date', label: 'Order date', required: true },
  { key: 'quantity', label: 'Quantity', required: true },
  { key: 'line_revenue', label: 'Line amount (RM)', required: true },
  { key: 'sku', label: 'SKU', required: false },
  { key: 'product_name', label: 'Product name', required: false },
  { key: 'settlement_amount', label: 'Settlement amount', required: false },
  { key: 'status', label: 'Order status', required: false },
]

// Candidate headers per field, normalized to lowercase letters only —
// priority order matters (first hit wins).
const CANDIDATES: Record<FieldKey, string[]> = {
  order_id: ['orderid', 'orderno', 'ordernumber', 'orderidmain'],
  order_date: ['ordercreationtime', 'ordercreationdate', 'createdtime', 'createtime', 'orderdate', 'orderpaidtime', 'paidtime'],
  sku: ['skureferenceno', 'sellersku', 'sku', 'variationsku'],
  product_name: ['productname', 'itemname'],
  quantity: ['quantity', 'qty'],
  line_revenue: ['skusubtotalafterdiscount', 'skusubtotalafterdiscounts', 'ordertotalamount', 'dealprice', 'totalamount', 'skusubtotal', 'subtotal'],
  settlement_amount: ['totalsettlementamount', 'settlementamount', 'totalreleasedamount'],
  status: ['orderstatus', 'status', 'orderssubstatus'],
}

const CANCELLED_PATTERN = /cancel|refund|return|unpaid|failed/i

function normalize(h: string): string {
  return h.toLowerCase().replace(/[^a-z]/g, '')
}

function autoDetect(headers: string[]): Record<FieldKey, number> {
  const normalized = headers.map(normalize)
  const mapping = {} as Record<FieldKey, number>
  for (const field of FIELDS) {
    mapping[field.key] = -1
    for (const candidate of CANDIDATES[field.key]) {
      const idx = normalized.indexOf(candidate)
      if (idx !== -1) {
        mapping[field.key] = idx
        break
      }
    }
  }
  return mapping
}

// Shopee gives "2026-10-14 18:32", TikTok "14/10/2026 18:32:05" — take the
// date part and normalize to YYYY-MM-DD (export timestamps are local MYT).
function parseExportDate(raw: string): string | null {
  const s = raw.trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return null
}

function parseMoney(raw: string): number {
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

interface ParsedFile {
  headers: string[]
  rows: string[][]
}

async function readFile(file: File): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
  const [headers, ...dataRows] = rows
  return { headers: (headers ?? []).map(String), rows: dataRows.filter((r) => r.some((c) => String(c).trim())) }
}

export default function MarketplaceUploadCard({ onUploaded }: { onUploaded?: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [platform, setPlatform] = useState<Platform>('shopee')
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [mapping, setMapping] = useState<Record<FieldKey, number> | null>(null)
  const [excludeCancelled, setExcludeCancelled] = useState(true)
  const [uploading, setUploading] = useState(false)

  const reset = () => {
    setFileName(null)
    setParsed(null)
    setMapping(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  const handleFile = async (file: File) => {
    try {
      const data = await readFile(file)
      if (!data.headers.length || !data.rows.length) {
        toast.error('Could not read any rows from that file')
        return
      }
      setFileName(file.name)
      setParsed(data)
      setMapping(autoDetect(data.headers))
    } catch {
      toast.error('Failed to parse the file — is it a Shopee/TikTok order export (.xlsx/.csv)?')
    }
  }

  const missingRequired = mapping
    ? FIELDS.filter((f) => f.required && mapping[f.key] === -1).map((f) => f.label)
    : []

  const buildRows = () => {
    if (!parsed || !mapping) return []
    const out: {
      order_id: string
      order_date_myt: string
      sku: string | null
      product_name: string | null
      quantity: number
      line_revenue: number
      settlement_amount: number | null
      status: string | null
    }[] = []
    for (const row of parsed.rows) {
      const cell = (k: FieldKey) => (mapping[k] === -1 ? '' : String(row[mapping[k]] ?? '').trim())
      const orderId = cell('order_id')
      const date = parseExportDate(cell('order_date'))
      if (!orderId || !date) continue
      const status = cell('status') || null
      if (excludeCancelled && status && CANCELLED_PATTERN.test(status)) continue
      out.push({
        order_id: orderId,
        order_date_myt: date,
        sku: cell('sku') || null,
        product_name: cell('product_name') || null,
        quantity: parseInt(cell('quantity').replace(/[^0-9]/g, ''), 10) || 0,
        line_revenue: parseMoney(cell('line_revenue')),
        settlement_amount: cell('settlement_amount') ? parseMoney(cell('settlement_amount')) : null,
        status,
      })
    }
    return out
  }

  const confirmRows = buildRows()
  const confirmTotal = confirmRows.reduce((s, r) => s + r.line_revenue, 0)

  const submit = async () => {
    if (!confirmRows.length) {
      toast.error('No usable rows — check the column mapping')
      return
    }
    setUploading(true)
    try {
      const res = await fetch('/api/admin/marketplace-sales/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, filename: fileName, rows: confirmRows }),
      })
      let json: { ok?: boolean; error?: string; rows_ingested?: number; date_min?: string; date_max?: string } = {}
      try {
        json = await res.json()
      } catch {
        // killed function → empty body (handbook rule 4)
      }
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? `Upload failed (HTTP ${res.status})`)
        return
      }
      toast.success(`Ingested ${json.rows_ingested} ${platform} rows (${json.date_min} → ${json.date_max})`)
      reset()
      onUploaded?.()
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-gray-900">Shopee / TikTok sales upload</h3>
        {parsed && (
          <button onClick={reset} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {!parsed ? (
        <div>
          <p className="text-sm text-gray-500 mb-3">
            Upload the platform&apos;s order export (.xlsx / .csv). Re-uploading the same file is safe —
            existing rows for those orders are replaced.
          </p>
          <div className="flex items-center gap-3">
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="shopee">Shopee</option>
              <option value="tiktok">TikTok Shop</option>
            </select>
            <button
              onClick={() => fileInput.current?.click()}
              className="inline-flex items-center gap-2 bg-[#0A0A0A] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-800"
            >
              <Upload className="w-4 h-4" /> Choose file
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-3">
            <FileSpreadsheet className="w-4 h-4" />
            <span className="font-medium">{fileName}</span>
            <span className="text-gray-400">· {parsed.rows.length} rows · {platform}</span>
          </div>

          <p className="text-xs text-gray-500 mb-2">
            Check the column mapping — money columns are never guessed silently.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {FIELDS.map((f) => (
              <label key={f.key} className="text-xs text-gray-600">
                {f.label}
                {f.required && <span className="text-red-500">*</span>}
                <select
                  value={mapping?.[f.key] ?? -1}
                  onChange={(e) => setMapping((m) => (m ? { ...m, [f.key]: Number(e.target.value) } : m))}
                  className="mt-1 w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs"
                >
                  <option value={-1}>— none —</option>
                  {parsed.headers.map((h, i) => (
                    <option key={i} value={i}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {missingRequired.length > 0 && (
            <p className="text-xs text-red-600 mb-3">Missing required columns: {missingRequired.join(', ')}</p>
          )}

          <div className="overflow-x-auto border border-gray-100 rounded-lg mb-3">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  {FIELDS.map((f) => (
                    <th key={f.key} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {confirmRows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t border-gray-50">
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.order_id}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.order_date_myt}</td>
                    <td className="px-2 py-1.5">{r.quantity}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">RM {r.line_revenue.toFixed(2)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.sku ?? '—'}</td>
                    <td className="px-2 py-1.5 max-w-[160px] truncate">{r.product_name ?? '—'}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.settlement_amount != null ? `RM ${r.settlement_amount.toFixed(2)}` : '—'}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.status ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={excludeCancelled}
                onChange={(e) => setExcludeCancelled(e.target.checked)}
              />
              Exclude cancelled / refunded / unpaid rows
            </label>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">
                {confirmRows.length} rows · RM {confirmTotal.toFixed(2)}
              </span>
              <button
                onClick={submit}
                disabled={uploading || missingRequired.length > 0 || confirmRows.length === 0}
                className="bg-[#0A0A0A] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-800 disabled:opacity-40"
              >
                {uploading ? 'Uploading…' : 'Confirm upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
