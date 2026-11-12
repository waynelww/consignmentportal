import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { skuKey, type StockListItem } from '@/lib/stock-list/parse'

// Reads a pasted or photographed restock list with Claude and returns SKUs and
// pair quantities that have been checked against the active catalogue.
// Nothing is stored: photos and text live only for the duration of the request.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-haiku-4-5-20251001' // same model as app/api/ai/chat/route.ts
const MAX_TEXT_CHARS = 20_000
const MAX_IMAGES = 4
const MAX_IMAGE_B64_CHARS = 1_600_000 // about 1.2 MB per photo after resize
const MAX_TOTAL_B64_CHARS = 3_500_000 // keeps the whole request under Vercel's 4.5 MB body limit
const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png'])

const SYSTEM_PROMPT = `You read Xocks consignment restock lists. Each list says how many pairs of each SKU a store should receive. The list is English and Malay mixed, written by hand, typed in chat, or photographed.

You are given the active product catalogue as SKU: name, then the list as pasted text and/or photos.

Rules:
- Use only SKUs from the catalogue. Never guess or invent a code, and never invent a quantity.
- Codes: A, H or C followed by a number mean Ankle, Half or Crew. MX + number is also a code. Accept any spelling: "A 21", "a-21", "A021" are all A21.
- Cut headers: a line with only "Ankle", "Half" or "Crew" sets the cut for the lines below it. "Ankle 06, 15, 21 x3" means A6, A15 and A21, 3 pairs each. A quantity written only on the last number applies to all numbers in that list.
- Quantities are pairs. Markers: x3, ×3, *3, = 3, : 3, - 3, "3 pairs", "3 pcs", "3 pasang", "3 psg", "3 helai", "3 units", or a single number on the line.
- Colour names (e.g. "Teddy Brown 5") match catalogue names. If the colour exists in more than one cut and the line does not say Ankle, Half or Crew, put it in unread and name the possible SKUs.
- Special Patches SKUs are words (e.g. WHITEKUIHC26). Match the exact SKU or the product name.
- Several items on one line can be separated by commas, semicolons, slashes, "&", "and" or "dan".
- V codes are No Show. They are not sold to consignment: put them in unread.
- A colour with no cut and no catalogue match goes to unread.
- If an item has no clear quantity, or the handwriting is unclear, put it in unread. Do not guess.
- Ignore chat names, times, prices, phone numbers and greetings. Do not list them as unread.

Return JSON only, with no prose and no code fence:
{"items":[{"sku":"A21","qty":3}],"unread":["a short description of each line or item that could not be read"]}`

interface ModelItem { sku?: unknown; qty?: unknown }
interface ModelOutput { items?: unknown; unread?: unknown }

function extractJson(text: string): ModelOutput | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(text.slice(start, end + 1))
    return v && typeof v === 'object' ? (v as ModelOutput) : null
  } catch {
    return null
  }
}

interface ImageIn { media_type: 'image/jpeg' | 'image/png'; data: string }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { text?: unknown; images?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (text.length > MAX_TEXT_CHARS) return Response.json({ error: 'Text is too long' }, { status: 413 })

  const rawImages = Array.isArray(body.images) ? body.images : []
  if (rawImages.length > MAX_IMAGES) return Response.json({ error: `Up to ${MAX_IMAGES} photos` }, { status: 400 })
  const images: ImageIn[] = []
  let totalChars = 0
  for (const img of rawImages) {
    const i = img as { media_type?: unknown; data?: unknown }
    if (typeof i.media_type !== 'string' || !ALLOWED_MEDIA.has(i.media_type)) {
      return Response.json({ error: 'Photos must be JPG or PNG' }, { status: 400 })
    }
    if (typeof i.data !== 'string' || i.data.length === 0) return Response.json({ error: 'Empty photo' }, { status: 400 })
    if (i.data.length > MAX_IMAGE_B64_CHARS) return Response.json({ error: 'A photo is too large' }, { status: 413 })
    totalChars += i.data.length
    images.push({ media_type: i.media_type as ImageIn['media_type'], data: i.data })
  }
  if (totalChars > MAX_TOTAL_B64_CHARS) return Response.json({ error: 'Photos are too large together' }, { status: 413 })
  if (!text && images.length === 0) return Response.json({ error: 'Paste a list or add a photo' }, { status: 400 })

  // Active catalogue only.
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, sku, name')
    .eq('is_active', true)
    .order('sku')
  if (prodErr) return Response.json({ error: 'Could not load products' }, { status: 500 })

  const byKey = new Map<string, { id: string; sku: string }>()
  for (const p of products ?? []) byKey.set(skuKey(p.sku), { id: p.id, sku: p.sku })

  const catalogue = (products ?? []).map((p) => `${p.sku}: ${p.name}`).join('\n')
  const content: Anthropic.ContentBlockParam[] = [
    { type: 'text', text: `Active catalogue (SKU: name):\n${catalogue}` },
  ]
  images.forEach((img, n) => {
    content.push({ type: 'text', text: `Photo ${n + 1} of the list:` })
    content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } })
  })
  content.push({ type: 'text', text: text ? `Pasted text of the list:\n${text}` : 'No pasted text.' })
  content.push({ type: 'text', text: 'Read the list and return the JSON only.' })

  let raw = ''
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    })
    raw = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  } catch {
    return Response.json({ error: 'The AI read failed. Try again, or use Read list.' }, { status: 502 })
  }

  const parsed = extractJson(raw)
  if (!parsed) return Response.json({ error: 'The AI reply could not be read. Try again, or use Read list.' }, { status: 502 })

  // Validate every item against the catalogue. Anything unchecked is unread.
  const unread: string[] = []
  const merged = new Map<string, StockListItem>()
  const modelItems = Array.isArray(parsed.items) ? (parsed.items as ModelItem[]) : []
  for (const it of modelItems) {
    const sku = typeof it.sku === 'string' ? it.sku.trim() : ''
    const qty = typeof it.qty === 'number' ? it.qty : Number(it.qty)
    if (!sku) continue
    const product = byKey.get(skuKey(sku))
    if (!product) {
      unread.push(`${sku} (not an active SKU)`)
      continue
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      unread.push(`${sku} (no clear quantity)`)
      continue
    }
    const row = merged.get(product.id)
    if (row) row.quantity += qty
    else merged.set(product.id, { product_id: product.id, sku: product.sku, quantity: qty })
  }

  const modelUnread = Array.isArray(parsed.unread) ? parsed.unread : []
  for (const u of modelUnread) {
    if (typeof u === 'string' && u.trim()) unread.push(u.trim().slice(0, 200))
  }

  return Response.json({
    items: [...merged.values()],
    unread: [...new Set(unread)].slice(0, 100),
  })
}
