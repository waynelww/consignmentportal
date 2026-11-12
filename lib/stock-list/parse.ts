// Pure parser for a pasted restock list (the "paste or photo" reader).
// Used by the Create DO and Edit DO modals and the Add Store stock step.
// No React, no I/O. Rules are pinned by scripts/test-stock-list-parse.ts.
// Keep the two in step: change a rule here, change its test there.

export interface StockListProduct {
  id: string
  sku: string
  name: string
  is_active?: boolean
}

export interface StockListItem {
  product_id: string
  sku: string
  quantity: number // 0 when no quantity was found (see noQuantity)
}

export interface StockListResult {
  items: StockListItem[]
  noQuantity: string[] // SKUs with no quantity on at least one line; set to 0
  notFound: string[] // codes read that are not active products
  unread: string[] // lines or parts of lines that could not be read
}

const CUT_WORDS: Record<string, string> = { ankle: 'A', ankles: 'A', half: 'H', crew: 'C' }
const CUT_NAMES: Record<string, string> = { A: 'Ankle', H: 'Half', C: 'Crew' }

// "A21", "a-21", "A 21", "a021" -> "A21"; "MX5" -> "MX5". Anything else -> null.
export function codeKey(raw: string): string | null {
  const m = /^(mx|[ahc])\s*-?\s*0*(\d{1,4})$/i.exec(raw.trim())
  return m ? m[1].toUpperCase() + String(Number(m[2])) : null
}

// Key used to match a catalogue SKU or a typed code. Special Patches SKUs
// (words such as WHITEKUIHC26) are their own key.
export function skuKey(raw: string): string {
  return codeKey(raw) ?? raw.replace(/\s+/g, '').toUpperCase()
}

// Cut letter of a code SKU (A/H/C). MX and word SKUs have no cut.
function cutOf(sku: string): string | null {
  const m = /^([ahc])\s*-?\s*\d/i.exec(sku.trim())
  return m ? m[1].toUpperCase() : null
}

const HEADER_RE = /^(ankles?|half|crew)\s*[:-]?$/i
const LEAD_CUT_RE = /^(ankles?|half|crew)\b\s*[:-]?\s*(?=\d|(?:mx|[ahc])\s*-?\s*\d)/i
const INLINE_CUT_RE = /\b(ankles?|half|crew)\b/i
const SEP_RE = /\s*[,;/&+]\s*|\s+(?:and|dan)\s+/i
// Each pattern takes the quantity in group 1. Checked for every segment.
const QTY_PATTERNS: RegExp[] = [
  /(?<![a-z0-9])(\d{1,4})\s*(?:pairs?|pcs|pasang|psg|helai|units?)(?![a-z])/gi,
  /(?<![a-z])[x*]\s*(\d{1,4})(?!\d)/gi,
  /[=:]\s*(\d{1,4})(?!\d)/g,
  /(?:^|\s)-\s*(\d{1,4})(?!\d)/g,
]
const CODE_RE = /(?<![a-z0-9])(mx|[ahcv])\s*-?\s*(\d{1,4})(?!\d)/gi
const BARE_NUM_RE = /(?<![a-z0-9])\d{1,4}(?![a-z0-9])/gi

function clean(raw: string): string {
  return raw
    .replace(/[×✕]/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/[ \t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface CatalogIndex {
  byKey: Map<string, StockListProduct[]> // "A21" / "WHITEKUIHC26" -> products
  names: Map<string, StockListProduct[]> // lower-case colour/product name -> products
}

function pushUnique<T extends { id: string }>(map: Map<string, T[]>, key: string, p: T) {
  const list = map.get(key) ?? []
  if (!list.some((x) => x.id === p.id)) list.push(p)
  map.set(key, list)
}

function buildIndex(products: StockListProduct[]): CatalogIndex {
  const byKey = new Map<string, StockListProduct[]>()
  const names = new Map<string, StockListProduct[]>()
  for (const p of products) {
    if (p.is_active === false) continue
    pushUnique(byKey, skuKey(p.sku), p)
    const n = norm(p.name ?? '')
    if (n) pushUnique(names, n, p)
    if (codeKey(p.sku) === null) {
      const s = norm(p.sku)
      if (s) pushUnique(names, s, p)
    }
  }
  return { byKey, names }
}

interface SegmentParse {
  raw: string
  cut: string | null
  qty: number | null
  ambiguous: boolean // more than one quantity marker in one part
  keys: string[] // SKU keys from explicit codes and bare numbers under a cut
  bare: boolean // only bare numbers, no codes or names
  anyCode: boolean // an explicit code (including V) was present
  names: { label: string; candidates: StockListProduct[] }[]
  unread: string[]
}

function parseSegment(raw: string, lineCut: string | null, idx: CatalogIndex): SegmentParse {
  let s = raw
  let cut = lineCut
  const cw = INLINE_CUT_RE.exec(s)
  if (cw) {
    cut = CUT_WORDS[cw[1].toLowerCase()]
    s = s.replace(INLINE_CUT_RE, ' ')
  }
  s = s.replace(/\s+/g, ' ').trim()

  // 1. Quantity: explicit markers first, else a trailing bare number.
  const found: { start: number; end: number; value: number }[] = []
  for (const re of QTY_PATTERNS) {
    for (const m of s.matchAll(re)) {
      found.push({ start: m.index!, end: m.index! + m[0].length, value: Number(m[1]) })
    }
  }
  // One quantity can match two patterns ("- 2 pairs" is a dash and a pairs
  // marker). Keep the longest of any overlapping pair so it counts once.
  const hits: typeof found = []
  for (const h of found.sort((a, b) => b.end - b.start - (a.end - a.start))) {
    if (!hits.some((k) => h.start < k.end && k.start < h.end)) hits.push(h)
  }
  const base = { raw, cut }
  if (hits.length > 1) {
    return { ...base, qty: null, ambiguous: true, keys: [], bare: false, anyCode: false, names: [], unread: [] }
  }
  let qty: number | null = null
  let rem = s
  if (hits.length === 1) {
    qty = hits[0].value
    rem = s.slice(0, hits[0].start) + ' ' + s.slice(hits[0].end)
  } else {
    const tm = /\s(\d{1,4})\s*$/.exec(s)
    // "Teddy Brown 5" -> qty 5. "A 21" and "A21" stay codes (the letter sits
    // right before the number). Numbers with no letters (a bare cut list)
    // never take a quantity.
    if (tm && /[a-z]/i.test(s) && !/(^|[^a-z0-9])(mx|[ahcv])$/i.test(s.slice(0, tm.index))) {
      qty = Number(tm[1])
      rem = s.slice(0, tm.index)
    }
  }
  rem = rem.replace(/\s+/g, ' ').trim()

  // 2. Codes (A/H/C/MX + number). V = No Show, never sold on consignment.
  const keys: string[] = []
  const unread: string[] = []
  let anyCode = false
  for (const m of rem.matchAll(CODE_RE)) {
    anyCode = true
    const letter = m[1].toUpperCase()
    if (letter === 'V') {
      unread.push(`${m[0].trim()} (No Show, not sold to consignment)`)
      continue
    }
    keys.push(letter + String(Number(m[2])))
  }
  rem = rem.replace(CODE_RE, ' ')

  // 3. Bare numbers take the cut from a header or the line (e.g. "Ankle 06").
  const bareNums = [...rem.matchAll(BARE_NUM_RE)].map((m) => m[0])
  for (const n of bareNums) {
    if (cut) keys.push(cut + String(Number(n)))
    else unread.push(`${n} (no Ankle, Half or Crew given)`)
  }
  rem = rem.replace(BARE_NUM_RE, ' ')

  // 4. Colour or special-patch names. Skipped when an explicit code is present.
  const names: { label: string; candidates: StockListProduct[] }[] = []
  if (keys.length === 0 && !anyCode) {
    let t = ' ' + norm(rem) + ' '
    const sorted = [...idx.names.keys()].sort((a, b) => b.length - a.length)
    for (const key of sorted) {
      const re = new RegExp(`(?<![a-z0-9])${escapeRe(key)}(?![a-z0-9])`, 'g')
      if (re.test(t)) {
        names.push({ label: key, candidates: idx.names.get(key)! })
        t = t.replace(re, (m) => ' '.repeat(m.length)) // longer names win
      }
    }
  }

  const bare = bareNums.length > 0 && !anyCode && names.length === 0
  return { raw, cut, qty, ambiguous: false, keys, bare, anyCode, names, unread }
}

export function parseStockList(text: string, products: StockListProduct[]): StockListResult {
  const idx = buildIndex(products)
  const acc = new Map<string, { sku: string; quantity: number; flagged: boolean }>()
  const order: string[] = []
  const notFound: string[] = []
  const unread: string[] = []

  function add(p: StockListProduct, qty: number | null) {
    let row = acc.get(p.id)
    if (!row) {
      row = { sku: p.sku, quantity: 0, flagged: false }
      acc.set(p.id, row)
      order.push(p.id)
    }
    if (qty === null) row.flagged = true
    else row.quantity += qty
  }

  let ctxCut: string | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = clean(rawLine)
    if (!line) continue

    // A cut word alone on a line sets the cut for the lines below it.
    const header = HEADER_RE.exec(line)
    if (header) {
      ctxCut = CUT_WORDS[header[1].toLowerCase()]
      continue
    }

    // A cut word at the start ("Ankle 06, 15, 21 x3") applies to this line.
    let lineCut = ctxCut
    let body = line
    const lead = LEAD_CUT_RE.exec(line)
    if (lead) {
      lineCut = CUT_WORDS[lead[1].toLowerCase()]
      body = line.slice(lead[0].length)
    }

    const segs = body
      .split(SEP_RE)
      .map(clean)
      .filter(Boolean)
      .map((seg) => parseSegment(seg, lineCut, idx))

    // A quantity only on the last number of a cut list applies to all of
    // its bare numbers ("Ankle 06, 15, 21 x3").
    const groupQty = lineCut && segs.length > 0 ? segs[segs.length - 1].qty : null

    for (const seg of segs) {
      if (seg.ambiguous) {
        unread.push(`${seg.raw} (more than one quantity in one part)`)
        continue
      }
      const qty = seg.qty ?? (seg.bare && groupQty !== null ? groupQty : null)
      let handled = 0 // items added, or a specific reason reported

      unread.push(...seg.unread)
      handled += seg.unread.length
      for (const key of seg.keys) {
        const ps = idx.byKey.get(key)
        if (!ps || ps.length === 0) {
          if (!notFound.includes(key)) notFound.push(key)
          handled++
          continue
        }
        if (ps.length > 1) {
          unread.push(`${key} (more than one active product, check the SKU)`)
          handled++
          continue
        }
        add(ps[0], qty)
        handled++
      }
      for (const nm of seg.names) {
        const cut = seg.cut
        const cands = cut
          ? nm.candidates.filter((p) => cutOf(p.sku) === cut || cutOf(p.sku) === null)
          : nm.candidates
        const display = nm.candidates[0]?.name ?? nm.label
        handled++
        if (cands.length === 1) {
          add(cands[0], qty)
        } else if (cands.length === 0) {
          unread.push(`${display} (no ${CUT_NAMES[cut ?? ''] ?? ''} SKU with this colour)`)
        } else {
          const list = cands.map((p) => p.sku).join(', ')
          unread.push(`${display} (several SKUs: ${list}; write Ankle, Half or Crew)`)
        }
      }
      if (handled === 0) unread.push(seg.raw)
    }
  }

  const items: StockListItem[] = order.map((id) => {
    const row = acc.get(id)!
    return { product_id: id, sku: row.sku, quantity: row.quantity }
  })
  const noQuantity = order.filter((id) => acc.get(id)!.flagged).map((id) => acc.get(id)!.sku)
  return { items, noQuantity, notFound, unread }
}
