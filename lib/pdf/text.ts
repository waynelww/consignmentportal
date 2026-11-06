// Makes any store-supplied text safe for the PDF standard fonts (WinAnsi /
// Windows-1252). pdf-lib throws "WinAnsi cannot encode" on anything outside it.
// Applied to every string in a generator's input at entry, so measuring and
// drawing both see the cleaned text.

import { stripInvisible } from '@/lib/text/invisible'

// Windows-1252 characters above U+007E that WinAnsi can encode.
const WINANSI_EXTRA = new Set([
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
  0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178,
])

// Close ASCII equivalents for characters WinAnsi cannot encode. Anything not
// listed becomes "?".
const ASCII_EQUIVALENTS: Record<string, string> = {
  '‐': '-', '‑': '-', '‒': '-', '−': '-', '﹣': '-', '－': '-',
  '∕': '/', '⁄': '/', '／': '/',
  '′': "'", '‵': "'", 'ʼ': "'",
  '″': '"', '‶': '"', '＂': '"',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '　': ' ',
  ' ': ' ', ' ': ' ', ' ': ' ',
  ' ': ' ', ' ': ' ', '\u0085': ' ',
}

function encodable(cp: number): boolean {
  return (cp >= 0x20 && cp <= 0x7E) || (cp >= 0xA0 && cp <= 0xFF) || WINANSI_EXTRA.has(cp)
}

export function sanitizePdfText(input: string): string {
  const cleaned = stripInvisible(input).normalize('NFC')
  let out = ''
  for (const ch of cleaned) {
    const cp = ch.codePointAt(0)!
    if (cp === 0x09 || cp === 0x0A || cp === 0x0D) { out += ' '; continue }
    if (cp < 0x20 || (cp >= 0x7F && cp <= 0x9F)) continue // control characters
    if (encodable(cp)) { out += ch; continue }
    out += ASCII_EQUIVALENTS[ch] ?? '?'
  }
  return out
}

/** Sanitise every string in a generator's input (objects, arrays, nested). */
export function sanitizePdfDeep<T>(value: T): T {
  if (typeof value === 'string') return sanitizePdfText(value) as T
  if (Array.isArray(value)) return value.map((v) => sanitizePdfDeep(v)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizePdfDeep(v)
    return out as T
  }
  return value
}
