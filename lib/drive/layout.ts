// Where each saved PDF goes in the Shared Drive. Pure: no I/O, so it is pinned
// by scripts/test-drive-layout.ts.
//
//   <GOOGLE_DRIVE_FOLDER_ID>/<store_code> <store_name>/Delivery Orders/<DO number>.pdf
//   <GOOGLE_DRIVE_FOLDER_ID>/<store_code> <store_name>/Invoices/<XCSM-###> (<Mon YYYY>).pdf
//   <GOOGLE_DRIVE_FOLDER_ID>/<store_code> <store_name>/Payment Receipts/<store_name> – <Month YYYY>.<ext>
//
// The invoice month is the period the invoice covers (generated on the 1st for
// the previous month), e.g. "XCSM-121 (Oct 2026).pdf". A payment receipt uses the
// same period: "HYPRGROUND HOLDING SDN BHD – October 2026.jpg".

export type DriveKind = 'delivery_order' | 'invoice' | 'payment_receipt'

export const DO_SUBFOLDER = 'Delivery Orders'
export const INVOICE_SUBFOLDER = 'Invoices'
export const RECEIPT_SUBFOLDER = 'Payment Receipts'

const MONTH_ABBRS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Drive names may hold most characters, but "/" would read as a path. Also collapses spaces and trims. */
export function safeName(value: string): string {
  return value
    .replace(/[\/\\]/g, '-')
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

export function doFileName(doNumber: string): string {
  return `${safeName(doNumber)}.pdf`
}

export function invoiceFileName(invoiceNo: string, periodMonth: number, periodYear: number): string {
  const month = MONTH_ABBRS[periodMonth - 1]
  if (!month) throw new Error(`Invalid invoice period month: ${periodMonth}`)
  return `${safeName(invoiceNo)} (${month} ${periodYear}).pdf`
}

/** Characters Windows and Drive reject in file names are removed (not replaced). */
export function stripFileNameChars(value: string): string {
  return value
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

/** "HYPRGROUND HOLDING SDN BHD – October 2026.jpg" (period = the invoice's month). */
export function receiptFileName(storeName: string, periodMonth: number, periodYear: number, mimeType: string): string {
  const month = MONTH_NAMES[periodMonth - 1]
  if (!month) throw new Error(`Invalid receipt period month: ${periodMonth}`)
  return `${stripFileNameChars(storeName)} – ${month} ${periodYear}.${receiptExtension(mimeType)}`
}

/** Malaysia-time start of the Drive backfill window: 1 Nov 2026 00:00 MYT (UTC+8). */
export const BACKFILL_FROM_ISO = '2026-10-31T16:00:00.000Z'
