// Where each saved PDF goes in the Shared Drive. Pure: no I/O, so it is pinned
// by scripts/test-drive-layout.ts.
//
//   <GOOGLE_DRIVE_FOLDER_ID>/<store_code> <store_name>/Delivery Orders/<DO number>.pdf
//   <GOOGLE_DRIVE_FOLDER_ID>/<store_code> <store_name>/Invoices/<XCSM-###> (<Mon YYYY>).pdf
//
// The invoice month is the period the invoice covers (generated on the 1st for
// the previous month), e.g. "XCSM-121 (Oct 2026).pdf".

export type DriveKind = 'delivery_order' | 'invoice'

export const DO_SUBFOLDER = 'Delivery Orders'
export const INVOICE_SUBFOLDER = 'Invoices'

const MONTH_ABBRS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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
  return kind === 'delivery_order' ? DO_SUBFOLDER : INVOICE_SUBFOLDER
}

export function doFileName(doNumber: string): string {
  return `${safeName(doNumber)}.pdf`
}

export function invoiceFileName(invoiceNo: string, periodMonth: number, periodYear: number): string {
  const month = MONTH_ABBRS[periodMonth - 1]
  if (!month) throw new Error(`Invalid invoice period month: ${periodMonth}`)
  return `${safeName(invoiceNo)} (${month} ${periodYear}).pdf`
}

/** Malaysia-time start of the Drive backfill window: 1 Nov 2026 00:00 MYT (UTC+8). */
export const BACKFILL_FROM_ISO = '2026-10-31T16:00:00.000Z'
