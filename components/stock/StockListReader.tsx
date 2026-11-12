'use client'

// "Paste list / photo" reader for SKU selection. One component shared by the
// Create DO and Edit DO modals and the Add Store stock step.
// The parent owns the item list and the open/closed state. Nothing saves here:
// results only fill the parent's list, which is saved by the usual button.
// Parsing rules: lib/stock-list/parse.ts. AI reading: POST /api/stock-list/ai-read.

import { useState } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { parseStockList, type StockListProduct, type StockListResult } from '@/lib/stock-list/parse'

export interface StockListLineIn {
  product_id: string
  quantity: number
}

const MAX_PHOTOS = 4
// Keep in step with MAX_IMAGE_B64_CHARS in app/api/stock-list/ai-read/route.ts
const MAX_PHOTO_B64 = 1_600_000

interface Photo {
  id: string
  dataUrl: string // thumbnail and the resized JPEG; never stored
  data: string // base64 without the data: prefix, sent to the AI route
}

export function StockListToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 h-10 px-3 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap',
        open ? 'bg-[#0A0A0A] text-[#FFD700] border-[#0A0A0A]' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
      )}
    >
      {open ? 'Hide list' : 'Paste list / photo'}
    </button>
  )
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not open that photo'))
    img.src = src
  })
}

// Resize to a JPEG small enough for the AI route. Photos are never stored.
async function shrinkPhoto(file: File): Promise<{ dataUrl: string; data: string }> {
  const src = URL.createObjectURL(file)
  try {
    const img = await loadImage(src)
    for (const [maxEdge, quality] of [[1600, 0.85], [1200, 0.7]] as const) {
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.max(1, Math.round(img.naturalWidth * scale))
      const h = Math.max(1, Math.round(img.naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not read that photo')
      ctx.fillStyle = '#ffffff' // PNG transparency becomes white
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      const data = dataUrl.slice(dataUrl.indexOf(',') + 1)
      if (data.length <= MAX_PHOTO_B64) return { dataUrl, data }
    }
    throw new Error('That photo is too large. Try a closer, smaller photo.')
  } finally {
    URL.revokeObjectURL(src)
  }
}

interface Note {
  read: number
  noQuantity: string[]
  notFound: string[]
  unread: string[]
}

// Merge a read into the current list. Replace = the read becomes the list.
// Add = the read is added to the list, summing repeated SKUs.
function mergeLines(current: StockListLineIn[], read: StockListLineIn[], replace: boolean): StockListLineIn[] {
  const base = replace ? [] : current
  const sums = new Map<string, number>()
  for (const l of [...base, ...read]) sums.set(l.product_id, (sums.get(l.product_id) ?? 0) + l.quantity)
  return [...sums.entries()].map(([product_id, quantity]) => ({ product_id, quantity }))
}

export function StockListPanel({
  products,
  items,
  onApply,
}: {
  products: StockListProduct[]
  items: StockListLineIn[]
  onApply: (next: StockListLineIn[]) => void
}) {
  const [text, setText] = useState('')
  const [replace, setReplace] = useState(true)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [busy, setBusy] = useState<'ai' | 'photo' | 'add' | null>(null)
  const [note, setNote] = useState<Note | null>(null)

  // Every read line goes into Items. A line with no quantity comes in with an
  // empty pairs box, highlighted, and the parent blocks saving until it has pairs.
  function apply(read: StockListLineIn[], result: Omit<Note, 'read'>) {
    onApply(mergeLines(items, read, replace))
    setNote({ read: read.length, ...result })
  }

  function readList() {
    const r: StockListResult = parseStockList(text, products)
    apply(r.items, { noQuantity: r.noQuantity, notFound: r.notFound, unread: r.unread })
  }

  async function readAI(mode: 'text' | 'photo') {
    const useText = mode === 'text' ? text.trim() : ''
    if (!useText && photos.length === 0) {
      toast.error(mode === 'photo' ? 'Add a photo first' : 'Paste the list first')
      return
    }
    setBusy(mode === 'photo' ? 'photo' : 'ai')
    try {
      const res = await fetch('/api/stock-list/ai-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: useText,
          images: photos.map((p) => ({ media_type: 'image/jpeg', data: p.data })),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        items?: StockListLineIn[]
        unread?: string[]
        error?: string
      }
      if (!res.ok) {
        toast.error(body.error ?? 'The AI read failed')
        return
      }
      apply(body.items ?? [], { noQuantity: [], notFound: [], unread: body.unread ?? [] })
    } catch {
      toast.error('The AI read failed. Check the connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return
    const room = MAX_PHOTOS - photos.length
    if (room <= 0) {
      toast.error(`Up to ${MAX_PHOTOS} photos`)
      return
    }
    setBusy('add')
    try {
      const added: Photo[] = []
      for (const f of Array.from(files).slice(0, room)) {
        if (!['image/jpeg', 'image/png'].includes(f.type)) {
          toast.error('Photos must be JPG or PNG')
          continue
        }
        try {
          const { dataUrl, data } = await shrinkPhoto(f)
          added.push({ id: `${f.name}-${Date.now()}-${added.length}`, dataUrl, data })
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Could not add that photo')
        }
      }
      if (added.length) setPhotos((prev) => [...prev, ...added])
    } finally {
      setBusy(null)
    }
  }

  const busyAny = busy !== null

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-3">
      <div>
        <label className="text-xs font-medium text-gray-600 block mb-1">
          Paste the store&apos;s restock list, or add a photo of it
        </label>
        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'A21 x3 / A18 - 2 pairs / C5 = 4 / Teddy Brown 5 (one per line)'}
          className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-y"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={readList}
          disabled={busyAny || !text.trim()}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0A0A0A] text-white hover:bg-gray-800 disabled:opacity-40 transition-colors"
        >
          Read list
        </button>
        <button
          type="button"
          onClick={() => readAI('text')}
          disabled={busyAny || (!text.trim() && photos.length === 0)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-100 disabled:opacity-40 transition-colors"
        >
          {busy === 'ai' && <Loader2 size={12} className="animate-spin" />}
          Read with AI
        </button>
        <label
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 bg-white text-gray-800 transition-colors',
            photos.length >= MAX_PHOTOS || busyAny ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-100'
          )}
        >
          {busy === 'add' ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={13} />}
          Add photo
          <input
            type="file"
            accept="image/jpeg,image/png"
            multiple
            className="sr-only"
            disabled={photos.length >= MAX_PHOTOS || busyAny}
            onChange={(e) => {
              void addPhotos(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
        {photos.length > 0 && (
          <button
            type="button"
            onClick={() => readAI('photo')}
            disabled={busyAny}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#FFD700] text-[#0A0A0A] hover:opacity-90 disabled:opacity-40 transition-colors"
          >
            {busy === 'photo' && <Loader2 size={12} className="animate-spin" />}
            Read photo
          </button>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-700 select-none">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
            className="accent-[#0A0A0A]"
          />
          Replace current items
        </label>
      </div>

      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <div key={p.id} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.dataUrl} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                disabled={busyAny}
                title="Remove photo"
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {note && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
          <p className="font-semibold">
            Read {note.read} item{note.read === 1 ? '' : 's'}. Check the quantities before saving.
          </p>
          {note.noQuantity.length > 0 && (
            <p>
              No quantity on {note.noQuantity.join(', ')}. Added with the pairs box empty (highlighted). Enter the pairs before saving.
            </p>
          )}
          {note.notFound.length > 0 && <p>Not an active SKU: {note.notFound.join(', ')}.</p>}
          {note.unread.length > 0 && (
            <div>
              <p className="font-semibold">Could not read:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {note.unread.map((u, i) => (
                  <li key={`${i}-${u}`}>{u}</li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" onClick={() => setNote(null)} className="text-[11px] underline text-amber-800">
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
