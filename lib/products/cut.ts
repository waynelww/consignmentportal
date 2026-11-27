// Sock cuts (types) shared by every screen that groups or sorts socks.
// Pure: no React, no I/O, safe on client and server.
//
// Plain Series codes are a cut letter + a number:
//   A = Ankle, H = Half, C = Crew, V = No Show, K = Kids.
// The SKU code decides the cut. A product with no such code (patches, design
// socks, …) falls back to its category when that is one of the five cuts.
// Only a whole code counts: "K1" is Kids, "KHAKIDURIANC31" is not.

export type CutKey = 'ankle' | 'half' | 'crew' | 'no_show' | 'kids'
export type CutLetter = 'A' | 'H' | 'C' | 'V' | 'K'

/** Display and picking order: Ankle, Half, Crew, No Show, Kids. */
export const CUT_ORDER: CutKey[] = ['ankle', 'half', 'crew', 'no_show', 'kids']

export const CUT_LABELS: Record<CutKey, string> = {
  ankle: 'Ankle',
  half: 'Half',
  crew: 'Crew',
  no_show: 'No Show',
  kids: 'Kids',
}

export const CUT_BY_LETTER: Record<CutLetter, CutKey> = { A: 'ankle', H: 'half', C: 'crew', V: 'no_show', K: 'kids' }
export const LETTER_BY_CUT: Record<CutKey, CutLetter> = { ankle: 'A', half: 'H', crew: 'C', no_show: 'V', kids: 'K' }

/** Label for anything that is not one of the five cuts. */
export const OTHER_GROUP_LABEL = 'Other'

export interface CutCode {
  letter: CutLetter
  no: number
}

/** "A19" → { letter: 'A', no: 19 }; "k 3" is not a code (no spaces). Anything else → null. */
export function parseCutCode(sku: string | null | undefined): CutCode | null {
  const m = /^([AHCVK])(\d+)$/.exec((sku ?? '').trim().toUpperCase())
  if (!m) return null
  return { letter: m[1] as CutLetter, no: Number(m[2]) }
}

function isCutKey(v: string): v is CutKey {
  return (CUT_ORDER as string[]).includes(v)
}

/** The product's cut: from its SKU code first, else its category. Null for non-cut products. */
export function cutOfProduct(p: { sku?: string | null; category?: string | null }): CutKey | null {
  const code = parseCutCode(p.sku)
  if (code) return CUT_BY_LETTER[code.letter]
  const cat = (p.category ?? '').trim().toLowerCase()
  return isCutKey(cat) ? cat : null
}

export interface CutGroup<T> {
  key: CutKey | 'other'
  label: string
  items: T[]
}

/**
 * Splits items into Ankle, Half, Crew, No Show, Kids, then Other, in that
 * order. Items keep their order inside a group; empty groups are left out.
 */
export function groupByCut<T>(items: T[], productOf: (item: T) => { sku?: string | null; category?: string | null } | null | undefined): CutGroup<T>[] {
  const buckets = new Map<CutKey | 'other', T[]>()
  for (const item of items) {
    const p = productOf(item)
    const key = (p ? cutOfProduct(p) : null) ?? 'other'
    const list = buckets.get(key)
    if (list) list.push(item)
    else buckets.set(key, [item])
  }
  const out: CutGroup<T>[] = []
  for (const key of [...CUT_ORDER, 'other' as const]) {
    const list = buckets.get(key)
    if (list?.length) out.push({ key, label: key === 'other' ? OTHER_GROUP_LABEL : CUT_LABELS[key], items: list })
  }
  return out
}

/** Cuts that get their own section in pickers and item lists (Ankle/Half/Crew lists stay as they were). */
export const OWN_SECTION_CUTS: CutKey[] = ['no_show', 'kids']

/**
 * For item lists that already show Ankle/Half/Crew in their own order: keeps
 * every item that is not No Show or Kids in `main` (order unchanged), and puts
 * No Show then Kids in their own labelled sections after it.
 */
export function splitOwnSections<T>(
  items: T[],
  productOf: (item: T) => { sku?: string | null; category?: string | null } | null | undefined,
): { main: T[]; sections: CutGroup<T>[] } {
  const main: T[] = []
  const buckets = new Map<CutKey, T[]>()
  for (const item of items) {
    const p = productOf(item)
    const cut = p ? cutOfProduct(p) : null
    if (cut && OWN_SECTION_CUTS.includes(cut)) {
      const list = buckets.get(cut)
      if (list) list.push(item)
      else buckets.set(cut, [item])
    } else {
      main.push(item)
    }
  }
  const sections = OWN_SECTION_CUTS
    .filter((k) => buckets.get(k)?.length)
    .map((k) => ({ key: k, label: CUT_LABELS[k], items: buckets.get(k)! }))
  return { main, sections }
}
