'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, CheckCircle, AlertCircle, ArrowLeft, X } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import type { ImportRow } from '@/app/api/products/import/route'

// Handle slug → XCMS category
const HANDLE_CATEGORY_MAP: Record<string, string> = {
  'ankle': 'ankle',
  'crew': 'crew',
  'half': 'half',
  'kids': 'kids',
  'no-show': 'no_show', 'no_show': 'no_show', 'noshow': 'no_show',
  'muslimah': 'muslimah',
  'design': 'design',
}

// Type field → XCMS category
const TYPE_CATEGORY_MAP: Record<string, string> = {
  'ankle': 'ankle', 'ankle socks': 'ankle',
  'crew': 'crew', 'crew socks': 'crew',
  'no show': 'no_show', 'no-show': 'no_show', 'no_show': 'no_show', 'invisible': 'no_show',
  'half': 'half', 'half toe': 'half',
  'kids': 'kids', 'children': 'kids',
  'muslimah': 'muslimah',
  'design': 'design', 'printed': 'design', 'patterned': 'design',
}

const VALID_CATEGORIES = ['ankle', 'crew', 'no_show', 'half', 'kids', 'muslimah', 'design']

function categoryFromHandle(handle: string): string {
  const lower = handle.toLowerCase()
  for (const [key, val] of Object.entries(HANDLE_CATEGORY_MAP)) {
    if (lower.includes(key)) return val
  }
  return 'ankle'
}

function parseCSV(text: string): Record<string, string>[] {
  // Full RFC-4180 parser that handles multi-line quoted fields (e.g. Shopify HTML descriptions)
  const records: string[][] = []
  let cur = '', inQ = false, row: string[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (inQ) {
      if (ch === '"' && next === '"') { cur += '"'; i++ } // escaped quote
      else if (ch === '"') { inQ = false }
      else { cur += ch }
    } else {
      if (ch === '"') { inQ = true }
      else if (ch === ',') { row.push(cur); cur = '' }
      else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        if (ch === '\r') i++
        row.push(cur); cur = ''
        records.push(row); row = []
      } else { cur += ch }
    }
  }
  if (cur || row.length) { row.push(cur); records.push(row) }

  if (records.length < 2) return []
  const headers = records[0].map(h => h.trim())
  const dataRows = records.slice(1).filter(r => r.some(v => v.trim()))

  // Carry forward Handle/Title/Type/Body/Image per product group (Shopify only writes them on first variant row)
  let lastHandle = '', lastTitle = '', lastType = '', lastBody = '', lastImage = ''
  return dataRows.map(vals => {
    const row = Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim()]))
    if (row['Handle']) lastHandle = row['Handle']; else row['Handle'] = lastHandle
    if (row['Title']) lastTitle = row['Title']; else row['Title'] = lastTitle
    if (row['Type']) lastType = row['Type']; else row['Type'] = lastType
    if (row['Body (HTML)']) lastBody = row['Body (HTML)']; else row['Body (HTML)'] = lastBody
    // Only carry the FIRST image per Handle (ignore additional image rows for same product)
    if (row['Image Src'] && row['Image Src'] !== lastImage) { lastImage = row['Image Src'] }
    row['Image Src'] = lastImage
    return row
  })
}

function shopifyRowToProduct(row: Record<string, string>): ImportRow | null {
  // Normalise SKU to uppercase to match Shopify standard
  const sku = (row['Variant SKU'] || row['sku'] || '').trim().toUpperCase()
  if (!sku) return null

  const title = (row['Title'] || row['title'] || row['name'] || '').trim()
  if (!title) return null

  // Derive category from Type field first, then fall back to Handle
  const rawType = (row['Type'] || row['Product Type'] || '').toLowerCase().trim()
  const category = TYPE_CATEGORY_MAP[rawType]
    ?? categoryFromHandle(row['Handle'] || '')
    ?? 'ankle'

  // Strip leading number prefix from color: "1 Purple Blue" → "Purple Blue"
  const rawColor = (row['Option1 Value'] || row['Option2 Value'] || row['color'] || row['Color'] || '').trim()
  const color = rawColor.replace(/^\d+\s+/, '').trim() || 'Standard'

  // Build product name: "Ankle - Purple Blue" (more descriptive than just "Ankle (Offline)")
  const cleanTitle = title.replace(/\s*\(Offline\)/i, '').trim()
  const name = color && color !== 'Standard' ? `${cleanTitle} - ${color}` : cleanTitle

  const selling_price = parseFloat(row['Variant Price'] || row['Price'] || row['selling_price'] || '0') || 0
  const cost_price = parseFloat(row['Cost per item'] || row['Cost'] || row['cost_price'] || '0') || 0

  // Strip leading apostrophe Shopify adds to barcodes to prevent Excel number conversion
  const rawBarcode = (row['Variant Barcode'] || row['Barcode'] || row['barcode'] || '').trim()
  const barcode = rawBarcode.replace(/^'/, '') || undefined

  const description = (row['Body (HTML)'] || row['Description'] || row['description'] || '')
    .replace(/<[^>]+>/g, '').trim().slice(0, 500) || undefined

  // Prefer variant-specific image (Variant Image column), fall back to product thumbnail (Image Src)
  const image_url = (row['Variant Image'] || row['Image Src'] || '').trim() || undefined

  return { sku, name, category, color, selling_price, cost_price, barcode, description, image_url, is_core_sku: false }
}

type Status = 'idle' | 'parsed' | 'importing' | 'done'

export default function ImportProductsPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [importedCount, setImportedCount] = useState(0)
  const [dragging, setDragging] = useState(false)

  function processFile(file: File) {
    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload a CSV file')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsed = parseCSV(text)
      const products: ImportRow[] = []
      const errs: string[] = []
      const seen = new Set<string>()

      parsed.forEach((row, i) => {
        const product = shopifyRowToProduct(row)
        if (!product) {
          if (Object.values(row).some(v => v)) errs.push(`Row ${i + 2}: missing SKU or title`)
          return
        }
        if (seen.has(product.sku)) return // deduplicate
        seen.add(product.sku)
        products.push(product)
      })

      setRows(products)
      setErrors(errs)
      setStatus('parsed')
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    setStatus('importing')
    try {
      const res = await fetch('/api/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: rows }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setImportedCount(data.imported)
      setStatus('done')
      toast.success(`${data.imported} products imported successfully`)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Import failed')
      setStatus('parsed')
    }
  }

  const categoryColors: Record<string, string> = {
    ankle: 'bg-blue-100 text-blue-700',
    crew: 'bg-purple-100 text-purple-700',
    no_show: 'bg-green-100 text-green-700',
    half: 'bg-yellow-100 text-yellow-700',
    kids: 'bg-pink-100 text-pink-700',
    muslimah: 'bg-orange-100 text-orange-700',
    design: 'bg-indigo-100 text-indigo-700',
  }

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/products" className="text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Import from Shopify</h2>
          <p className="text-sm text-gray-500">Upload your Shopify product export CSV</p>
        </div>
      </div>

      {status === 'idle' && (
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
              dragging ? 'border-[#FFD700] bg-yellow-50' : 'border-gray-200 hover:border-gray-300 bg-white'
            }`}
          >
            <Upload size={36} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-medium text-gray-700">Drop your Shopify CSV here or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">From Shopify Admin → Products → Export → All products</p>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f) }} />
          </div>

          {/* How to export guide */}
          <div className="bg-[#0A0A0A] rounded-xl p-5 text-white text-sm space-y-2">
            <p className="font-semibold text-[#FFD700]">How to export from Shopify</p>
            <ol className="list-decimal list-inside space-y-1 text-white/70">
              <li>Go to <strong className="text-white">Shopify Admin → Products</strong></li>
              <li>Click <strong className="text-white">Export</strong> (top right)</li>
              <li>Select <strong className="text-white">"All products"</strong> and <strong className="text-white">"CSV for Excel, Numbers, or other spreadsheet programs"</strong></li>
              <li>Click <strong className="text-white">Export products</strong> — Shopify emails you the file</li>
              <li>Upload that CSV here</li>
            </ol>
          </div>
        </div>
      )}

      {(status === 'parsed' || status === 'importing') && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <FileText size={20} className="text-gray-400" />
              <div>
                <p className="text-sm font-semibold text-gray-900">{rows.length} products ready to import</p>
                {errors.length > 0 && (
                  <p className="text-xs text-amber-600">{errors.length} rows skipped (missing SKU or title)</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { setStatus('idle'); setRows([]); setErrors([]) }} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg">
                <X size={14} /> Change file
              </button>
              <button
                onClick={handleImport}
                disabled={status === 'importing' || rows.length === 0}
                className="px-5 py-1.5 bg-[#0A0A0A] text-[#FFD700] text-sm font-semibold rounded-lg hover:opacity-80 disabled:opacity-50 transition-opacity"
              >
                {status === 'importing' ? 'Importing…' : `Import ${rows.length} Products`}
              </button>
            </div>
          </div>

          {/* Preview table */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['SKU', 'Name', 'Category', 'Color', 'Selling Price', 'Cost Price', 'Barcode'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((r) => (
                    <tr key={r.sku} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{r.sku}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate">{r.name}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${categoryColors[r.category] ?? 'bg-gray-100 text-gray-600'}`}>
                          {r.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{r.color}</td>
                      <td className="px-4 py-3 text-gray-900">RM {r.selling_price.toFixed(2)}</td>
                      <td className="px-4 py-3 text-gray-500">RM {r.cost_price.toFixed(2)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{r.barcode || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {status === 'done' && (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center space-y-4">
          <CheckCircle size={48} className="mx-auto text-green-500" />
          <div>
            <p className="text-xl font-semibold text-gray-900">{importedCount} products imported</p>
            <p className="text-sm text-gray-500 mt-1">All products are now available in your catalog. Existing SKUs were updated.</p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => { setStatus('idle'); setRows([]); setErrors([]) }} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              Import another file
            </button>
            <button onClick={() => router.push('/admin/products')} className="px-4 py-2 bg-[#0A0A0A] text-[#FFD700] text-sm font-semibold rounded-lg hover:opacity-80">
              View Products
            </button>
          </div>
        </div>
      )}

      {errors.length > 0 && status === 'parsed' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={16} className="text-amber-600" />
            <p className="text-sm font-semibold text-amber-800">Skipped rows</p>
          </div>
          <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
            {errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
            {errors.length > 10 && <li>…and {errors.length - 10} more</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
