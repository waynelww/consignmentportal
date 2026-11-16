// Where each saved file goes in the Shared Drive, and what it is called. Pure: no
// I/O, so it is pinned by scripts/test-drive-layout.ts.
//
//   <GOOGLE_DRIVE_FOLDER_ID>/<store_code> <store_name>/Delivery Orders/<store_name> – <Month YYYY> (<DO number>).pdf
//   <GOOGLE_DRIVE_FOLDER_ID>/<store_code> <store_name>/Invoices/<store_name> – <Month YYYY>.pdf
//   <GOOGLE_DRIVE_FOLDER_ID>/<store_code> <store_name>/Payment Receipts/<store_name> – <Month YYYY>.<ext>
//
// One naming style for every file, with "–" (en dash):
//   - Invoice: Month YYYY is the period the invoice is for (the October invoice is
//     made on 1 November but is named October 2026).
//   - Delivery order: Month YYYY is the month the DO was created, in Malaysia time.
//     The DO number keeps names unique when a store has several DOs in one month.
//   - Payment receipt: the invoice's period, same as the invoice.
// Characters Windows and Drive do not allow in names are removed (not replaced).
// Folder names are unchanged.

export type DriveKind = 'delivery_order' | 'invoice' | 'payment_receipt'

export const DO_SUBFOLDER = 'Delivery Orders'
export const INVOICE_SUBFOLDER = 'Invoices'
export const RECEIPT_SUBFOLDER = 'Payment Receipts'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MALAYSIA_TZ = 'Asia/Kuala_Lumpur'

/** Drive names may hold most characters, but "/" would read as a path. Also collapses spaces and trims. Used for folders. */
export function safeName(value: string): string {
  return value
    .replace(/[\/\\]/g, '-')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Characters not allowed in file names (/ \ : * ? " < > |) are removed; spaces collapsed. Used for every file name. */
export function stripFileNameChars(value: string): string {
  return value
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function storeFolderName(storeCode: string, storeName: string): string {
  return safeName(`${storeCode} ${storeName}`)
}

export function subfolderFor(kind: DriveKind): string {
  if (kind === 'delivery_order') return DO_SUBFOLDER
  if (kind === 'payment_receipt') return RECEIPT_SUBFOLDER
  return INVOICE_SUBFOLDER
}

/** "<Month> <YYYY>" for a 1-12 month. Throws on a bad month. */
export function monthYearLabel(month: number, year: number): string {
  const name = MONTH_NAMES[month - 1]
  if (!name) throw new Error(`Invalid month: ${month}`)
  return `${name} ${year}`
}

/** Year and month (1-12) of an instant, in Malaysia time. */
export function malaysiaYearMonth(value: string | Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: MALAYSIA_TZ, year: 'numeric', month: 'numeric' })
    .formatToParts(new Date(value))
  const year = Number(parts.find((p) => p.type === 'year')?.value)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  if (!year || !month) throw new Error('Could not read the Malaysia date')
  return { year, month }
}

/** "<store_name> – <Month YYYY>.pdf" for an invoice (Month YYYY = the period the invoice is for). */
export function invoiceFileName(storeName: string, periodMonth: number, periodYear: number): string {
  return `${stripFileNameChars(storeName)} – ${monthYearLabel(periodMonth, periodYear)}.pdf`
}

/** "<store_name> – <Month YYYY> (<DO number>).pdf"; Month YYYY = the month the DO was created (Malaysia time). */
export function doFileName(storeName: string, doNumber: string, createdAt: string | Date): string {
  const { year, month } = malaysiaYearMonth(createdAt)
  return `${stripFileNameChars(storeName)} – ${monthYearLabel(month, year)} (${stripFileNameChars(doNumber)}).pdf`
}

/** Extension for a stored receipt, from its MIME type (what the store uploaded). */
export function receiptExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg': return 'jpg'
    case 'image/png': return 'png'
    case 'image/webp': return 'webp'
    case 'image/heic': return 'heic'
    case 'application/pdf': return 'pdf'
    default: throw new Error(`Unsupported receipt type: ${mimeType}`)
  }
}

/** "<store_name> – <Month YYYY>.<ext>" for a payment receipt (period = the invoice month). */
export function receiptFileName(storeName: string, periodMonth: number, periodYear: number, mimeType: string): string {
  return `${stripFileNameChars(storeName)} – ${monthYearLabel(periodMonth, periodYear)}.${receiptExtension(mimeType)}`
}

/** Malaysia-time start of the Drive backfill window: 1 Nov 2026 00:00 MYT (UTC+8). */
export const BACKFILL_FROM_ISO = '2026-10-31T16:00:00.000Z'
