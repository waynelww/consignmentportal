// "Closest available colour" suggestions for out/short Plain Series SKUs.
// Colour distance is CIEDE2000 on the Lab values of each yarn's hex colour.
// Pure: the caller passes the HQ stock map, so the same rule runs anywhere.

import { CATALOGUE_YARN_NOS, parsePlainCode, yarnColourByNo } from '@/lib/stock/yarn-colours'
import { normalizeSku, type HqStockMap } from '@/lib/stock/hq-availability'

/** Minimum HQ pairs a suggested colour must have. */
export const MIN_SUGGESTION_HQ_QTY = 3
export const MAX_SUGGESTIONS = 2

export interface ColourSuggestion {
  sku: string
  name: string
  hqQty: number
  deltaE: number
  enoughStock: boolean // HQ holds at least the needed qty
}

// ── Colour maths ───────────────────────────────────────────────────────────

export interface Lab { L: number; a: number; b: number }

export function hexToLab(hex: string): Lab {
  const h = hex.replace('#', '')
  const lin = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const r = lin(0), g = lin(2), b = lin(4)
  // sRGB → XYZ (D65)
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const Y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / 1.0
  const Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : (903.3 * t + 16) / 116)
  const fx = f(X), fy = f(Y), fz = f(Z)
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const hueDeg = (b: number, a: number) => {
  const h = deg(Math.atan2(b, a))
  return h < 0 ? h + 360 : h
}

/** CIEDE2000 colour difference (Sharma, Wu, Dalal 2005), kL = kC = kH = 1. */
export function deltaE00(p: Lab, q: Lab): number {
  const C1 = Math.hypot(p.a, p.b), C2 = Math.hypot(q.a, q.b)
  const Cbar = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))))
  const a1 = (1 + G) * p.a, a2 = (1 + G) * q.a
  const C1p = Math.hypot(a1, p.b), C2p = Math.hypot(a2, q.b)
  const h1 = C1p === 0 ? 0 : hueDeg(p.b, a1)
  const h2 = C2p === 0 ? 0 : hueDeg(q.b, a2)

  const dLp = q.L - p.L
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2 - h1
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2))

  const Lbarp = (p.L + q.L) / 2
  const Cbarp = (C1p + C2p) / 2
  let hbarp: number
  if (C1p * C2p === 0) hbarp = h1 + h2
  else if (Math.abs(h1 - h2) <= 180) hbarp = (h1 + h2) / 2
  else if (h1 + h2 < 360) hbarp = (h1 + h2 + 360) / 2
  else hbarp = (h1 + h2 - 360) / 2

  const T = 1 - 0.17 * Math.cos(rad(hbarp - 30)) + 0.24 * Math.cos(rad(2 * hbarp))
    + 0.32 * Math.cos(rad(3 * hbarp + 6)) - 0.2 * Math.cos(rad(4 * hbarp - 63))
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2))
  const RC = 2 * Math.sqrt(Math.pow(Cbarp, 7) / (Math.pow(Cbarp, 7) + Math.pow(25, 7)))
  const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2))
  const SC = 1 + 0.045 * Cbarp
  const SH = 1 + 0.015 * Cbarp * T
  const RT = -Math.sin(rad(2 * dTheta)) * RC

  const tL = dLp / SL, tC = dCp / SC, tH = dHp / SH
  return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH)
}

// ── Suggestions ─────────────────────────────────────────────────────────────

/**
 * Up to two similar colours for a Plain Series SKU that HQ is short of.
 * Candidates: same cut letter, catalogue colours only, HQ ≥ 3, not already in
 * this restock/DO (`exclude`, normalized SKUs). Colours with enough HQ stock for
 * `neededQty` come first, then by closeness; if none have enough, the closest
 * still come back. Returns [] for anything that is not a Plain Series code.
 */
export function suggestSimilar(
  sku: string,
  neededQty: number,
  hq: HqStockMap,
  exclude: ReadonlySet<string> = new Set(),
): ColourSuggestion[] {
  const own = parsePlainCode(sku)
  if (!own) return []
  const ownColour = yarnColourByNo(own.no)
  if (!ownColour) return []
  const ownLab = hexToLab(ownColour.hex)
  const ownKey = normalizeSku(sku)

  const candidates: (ColourSuggestion & { no: number })[] = []
  for (const [key, qty] of hq) {
    if (key === ownKey || exclude.has(key)) continue
    if (qty == null || qty < MIN_SUGGESTION_HQ_QTY) continue
    const code = parsePlainCode(key)
    if (!code || code.letter !== own.letter || code.no === own.no) continue
    if (!CATALOGUE_YARN_NOS.has(code.no)) continue
    const colour = yarnColourByNo(code.no)
    if (!colour) continue
    candidates.push({
      sku: key,
      no: code.no,
      name: colour.name,
      hqQty: qty,
      deltaE: deltaE00(ownLab, hexToLab(colour.hex)),
      enoughStock: qty >= neededQty,
    })
  }

  candidates.sort((x, y) => {
    if (x.enoughStock !== y.enoughStock) return x.enoughStock ? -1 : 1
    return x.deltaE - y.deltaE || x.sku.localeCompare(y.sku)
  })
  return candidates.slice(0, MAX_SUGGESTIONS).map(({ no: _no, ...s }) => s)
}

/** "A18 Grey Black" — code and name only, no quantities (safe for stores). */
export function suggestionLabel(s: Pick<ColourSuggestion, 'sku' | 'name'>): string {
  return `${s.sku} ${s.name}`
}
