/**
 * The one place barcode codes are normalised for comparison.
 *
 * products.barcode is stored inconsistently: the same retail code can be saved
 * as a 12-digit UPC-A (726529949100) or as a 13-digit EAN-13 with a leading
 * zero (0726529949100). A UPC-A read by a camera is often reported as the
 * 13-digit EAN form. So a 13-digit all-numeric code that starts with 0 is
 * treated as the 12-digit code after that zero.
 *
 * Code 128 can carry letters and symbols, so non-numeric codes are only
 * trimmed and upper-cased. Nothing else is changed.
 *
 * Use normalizeBarcode for every comparison (matching a scan, duplicate
 * checks). Store what was scanned or typed, not the normalised form.
 */

export function normalizeBarcode(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.replace(/\s+/g, '')
  if (trimmed === '') return null

  if (/^\d+$/.test(trimmed)) {
    if (trimmed.length === 13 && trimmed.startsWith('0')) return trimmed.slice(1)
    return trimmed
  }

  return trimmed.toUpperCase()
}

/** True when two codes refer to the same product code under normalisation. */
export function barcodesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeBarcode(a)
  const nb = normalizeBarcode(b)
  return na !== null && na === nb
}

/**
 * Find the first item whose barcode matches the scanned code.
 * Items without a barcode never match.
 */
export function findByBarcode<T extends { barcode: string | null | undefined }>(
  items: readonly T[],
  code: string,
): T | undefined {
  const target = normalizeBarcode(code)
  if (target === null) return undefined
  return items.find((item) => normalizeBarcode(item.barcode) === target)
}
