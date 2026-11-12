import { PDFDocument, PageSizes, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib'
import { sanitizePdfDeep } from './text'
import { BANK_DEFAULTS, type BankDetails } from './bank-details'
import { generateLegacyStatementPdf } from './generate-statement-legacy'

// ── Daily sales report page (A5-ish sheet, unchanged layout) ────────────────────
const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN = 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

// ── Commission invoice page (A4, plain layout) ──────────────────────────────────
const A4_W = PageSizes.A4[0]
const A4_H = PageSizes.A4[1]
const INV_MARGIN = 50
const INV_RIGHT = A4_W - INV_MARGIN
const ROW_H = 16
const TABLE_FLOOR = 64        // lowest y a table row may use (page number sits below)
const BOTTOM_BLOCK_H = 200    // bank + totals + footer, measured from the top of the block
const DEFAULT_COMPANY = 'Wayne Group Holding Sdn Bhd'

const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.35, 0.35, 0.35)
const GREY = rgb(0.5, 0.5, 0.5)
const RULE = rgb(0.6, 0.6, 0.6)
const LIGHT_RULE = rgb(0.8, 0.8, 0.8)
const GREEN = rgb(0, 0.5, 0.1)

// Column anchors for the invoice table. Left-aligned columns use their left edge,
// number columns their right edge.
const COL = {
  prodX: INV_MARGIN,
  skuX: INV_MARGIN + 145,
  staffX: INV_MARGIN + 208,
  unitsR: 362,
  priceR: 425,
  revR: 487,
  commR: INV_RIGHT,
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

type Color = ReturnType<typeof rgb>

function fmt(amount: number): string {
  return `RM ${amount.toFixed(2)}`
}

// Right-align text at a given x (right edge)
function drawRight(
  page: ReturnType<PDFDocument['addPage']>,
  text: string,
  rightX: number,
  y: number,
  size: number,
  font: PDFFont,
  color: Color
) {
  const w = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: rightX - w, y, size, font, color })
}

// Truncate text to fit within maxWidth pts at the given font size
function fitText(text: string, maxWidth: number, size: number, font: PDFFont): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > maxWidth) {
    t = t.slice(0, -1)
  }
  return t + '…'
}

// Split text into lines that fit maxWidth. Never truncates; breaks a single
// word only if it is wider than the column.
function wrapText(text: string, maxWidth: number, size: number, font: PDFFont): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    let rest = word
    while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--
      lines.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    line = rest
  }
  if (line) lines.push(line)
  return lines.length > 0 ? lines : ['']
}

export interface StatementParams {
  storeName: string
  storeCode: string
  picName: string
  storeAddress?: string
  invoiceNo?: string                // e.g. "XCSM-001"
  periodMonth: number
  periodYear: number
  generatedDate: string
  commissionRate: number
  paymentTermsDays?: number        // no longer printed; kept so callers need no change
  companyName?: string
  companyAddress?: string
  companyContact?: string
  // Invoice only: bank account for the transfer. Empty fields use BANK_DEFAULTS.
  bank?: BankDetails
  items: Array<{
    productName: string
    sku: string
    keyedInBy: string                // staff name, or "-" when none was recorded
    unitsSold: number
    unitPrice: number
    revenue: number
    commission: number
  }>
  totalUnits: number
  totalRevenue: number
  totalCommission: number
  xocksRevenue: number             // = totalRevenue - totalCommission
  status?: string                  // invoices only
  paymentReference?: string
  paidAt?: string
  // Daily sales report (lib/daily-report): same layout, but titled by the
  // sales date, with no invoice number, status or bank-transfer reminder.
  daily?: { salesDate: string }    // e.g. "30 October 2026"
}

// Invoices for October 2026 and earlier keep the layout they were issued with.
export function usesLegacyInvoiceLayout(periodYear: number, periodMonth: number): boolean {
  return periodYear < 2026 || (periodYear === 2026 && periodMonth <= 10)
}

export async function generateStatementPdf(params: StatementParams): Promise<Uint8Array> {
  if (params.daily) return buildDailyReportPdf(sanitizePdfDeep(params))
  if (usesLegacyInvoiceLayout(params.periodYear, params.periodMonth)) {
    return generateLegacyStatementPdf(params)
  }
  return buildInvoicePdf(sanitizePdfDeep(params))
}

// ── Daily sales report ──────────────────────────────────────────────────────────

async function buildDailyReportPdf(params: StatementParams): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])

  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica)

  let y = PAGE_HEIGHT - MARGIN

  const salesDate = params.daily?.salesDate ?? ''
  const companyName = params.companyName ?? DEFAULT_COMPANY

  // ── Header bar ───────────────────────────────────────────────────────────────
  const headerBarH = 50
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - headerBarH,
    width: PAGE_WIDTH,
    height: headerBarH,
    color: rgb(0.05, 0.05, 0.05),
  })

  page.drawText('XOCKS', {
    x: MARGIN,
    y: PAGE_HEIGHT - headerBarH + 16,
    size: 22,
    font: boldFont,
    color: rgb(1, 0.85, 0.1),
  })

  drawRight(page, 'DAILY SALES REPORT', PAGE_WIDTH - MARGIN, PAGE_HEIGHT - headerBarH + 20, 9, boldFont, rgb(1, 1, 1))

  y = PAGE_HEIGHT - headerBarH - 14

  page.drawText(companyName, {
    x: MARGIN,
    y,
    size: 9,
    font: boldFont,
    color: rgb(0.2, 0.2, 0.2),
  })

  y -= 13

  page.drawText(`Sales Date: ${salesDate}`, {
    x: MARGIN,
    y,
    size: 8,
    font: regularFont,
    color: rgb(0.35, 0.35, 0.35),
  })

  const genText = `Generated: ${params.generatedDate}`
  drawRight(page, genText, PAGE_WIDTH - MARGIN, y, 8, regularFont, rgb(0.35, 0.35, 0.35))

  y -= 8

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.8,
    color: rgb(0.2, 0.2, 0.2),
  })

  y -= 14

  // ── Store Information ────────────────────────────────────────────────────────
  page.drawText('STORE INFORMATION', {
    x: MARGIN,
    y,
    size: 8,
    font: boldFont,
    color: rgb(0, 0, 0),
  })

  y -= 4

  const storeInfoLines: Array<[string, string]> = [
    ['Store Name', `${params.storeName}  (${params.storeCode})`],
    ['PIC', params.picName],
  ]
  if (params.storeAddress) {
    const addr = params.storeAddress
    storeInfoLines.push(['Address', addr.length > 60 ? addr.slice(0, 59) + '…' : addr])
  }

  const infoBoxH = storeInfoLines.length * 13 + 10

  page.drawRectangle({
    x: MARGIN,
    y: y - infoBoxH,
    width: CONTENT_WIDTH,
    height: infoBoxH,
    color: rgb(0.97, 0.97, 0.97),
    borderColor: rgb(0.85, 0.85, 0.85),
    borderWidth: 0.5,
  })

  y -= 8

  for (const [label, value] of storeInfoLines) {
    page.drawText(label, {
      x: MARGIN + 6,
      y,
      size: 8,
      font: boldFont,
      color: rgb(0.4, 0.4, 0.4),
    })
    page.drawText(value, {
      x: MARGIN + 90,
      y,
      size: 8,
      font: regularFont,
      color: rgb(0.1, 0.1, 0.1),
    })
    y -= 13
  }

  y -= 14

  // ── Sales Summary Table ──────────────────────────────────────────────────────
  page.drawText('SALES SUMMARY', {
    x: MARGIN,
    y,
    size: 8,
    font: boldFont,
    color: rgb(0, 0, 0),
  })

  y -= 4

  // Column positions — all relative to MARGIN (50). Content width = 495.
  // Left-edge constants (for left-aligned cols) / right-edge constants (for right-aligned number cols)
  const C_PROD_L   = MARGIN           // Product name — left-aligned, 135pt wide
  const C_SKU_L    = MARGIN + 135     // SKU — left-aligned, 55pt wide
  const C_STAFF_L  = MARGIN + 190     // Keyed in by — left-aligned, 85pt wide
  const C_UNITS_R  = MARGIN + 310     // Units — right-aligned (35pt column)
  const C_PRICE_R  = MARGIN + 380     // Unit Price — right-aligned (70pt column)
  const C_COMM_R   = MARGIN + 495     // Right edge of the page content (50pt)
  // Daily report: no commission column, so Amount sits at the page edge
  const AMOUNT_R   = C_COMM_R

  // Vertical separator x positions (drawn between columns)
  const SEP_AFTER_PROD  = MARGIN + 135
  const SEP_AFTER_SKU   = MARGIN + 190
  const SEP_AFTER_STAFF = MARGIN + 275
  const SEP_AFTER_UNITS = MARGIN + 310
  const SEP_AFTER_PRICE = MARGIN + 380
  const ROW_SEPS = [SEP_AFTER_PROD, SEP_AFTER_SKU, SEP_AFTER_STAFF, SEP_AFTER_UNITS, SEP_AFTER_PRICE]

  const ROW_H = 18
  const CELL_PAD = 4
  const SEP_COLOR = rgb(0.75, 0.75, 0.75)
  const prodMaxW = SEP_AFTER_PROD - C_PROD_L - CELL_PAD * 2
  const skuMaxW  = SEP_AFTER_SKU  - C_SKU_L  - CELL_PAD * 2
  const staffMaxW = SEP_AFTER_STAFF - C_STAFF_L - CELL_PAD * 2

  // Header row
  page.drawRectangle({
    x: MARGIN,
    y: y - ROW_H + 4,
    width: CONTENT_WIDTH,
    height: ROW_H,
    color: rgb(0.1, 0.1, 0.1),
  })

  const headerY = y - 11
  const hc = rgb(1, 1, 1)
  page.drawText('Product',      { x: C_PROD_L  + CELL_PAD, y: headerY, size: 7.5, font: boldFont, color: hc })
  page.drawText('SKU',          { x: C_SKU_L   + CELL_PAD, y: headerY, size: 7.5, font: boldFont, color: hc })
  page.drawText('Keyed in by',  { x: C_STAFF_L + CELL_PAD, y: headerY, size: 7.5, font: boldFont, color: hc })
  drawRight(page, 'Units',      C_UNITS_R - CELL_PAD, headerY, 7.5, boldFont, hc)
  drawRight(page, 'Unit Price', C_PRICE_R - CELL_PAD, headerY, 7.5, boldFont, hc)
  drawRight(page, 'Amount', AMOUNT_R - CELL_PAD, headerY, 7.5, boldFont, hc)

  y -= ROW_H

  for (let i = 0; i < params.items.length; i++) {
    const item = params.items[i]

    if (i % 2 === 1) {
      page.drawRectangle({
        x: MARGIN,
        y: y - ROW_H + 4,
        width: CONTENT_WIDTH,
        height: ROW_H,
        color: rgb(0.95, 0.95, 0.95),
      })
    }

    // Column separator lines — drawn on the current page directly
    const rowTop = y + 4
    for (const sx of ROW_SEPS) {
      page.drawLine({ start: { x: sx, y: rowTop }, end: { x: sx, y: rowTop - ROW_H }, thickness: 0.4, color: SEP_COLOR })
    }

    const rc = rgb(0.1, 0.1, 0.1)
    const skuColor = rgb(0.35, 0.35, 0.35)
    const rowY = y - 11

    page.drawText(fitText(item.productName, prodMaxW, 7.5, regularFont), { x: C_PROD_L + CELL_PAD, y: rowY, size: 7.5, font: regularFont, color: rc })
    page.drawText(fitText(item.sku,         skuMaxW,  7.5, regularFont), { x: C_SKU_L  + CELL_PAD, y: rowY, size: 7.5, font: regularFont, color: skuColor })
    page.drawText(fitText(item.keyedInBy,   staffMaxW, 7.5, regularFont), { x: C_STAFF_L + CELL_PAD, y: rowY, size: 7.5, font: regularFont, color: rc })
    drawRight(page, String(item.unitsSold), C_UNITS_R - CELL_PAD, rowY, 7.5, regularFont, rc)
    drawRight(page, fmt(item.unitPrice),    C_PRICE_R - CELL_PAD, rowY, 7.5, regularFont, rc)
    drawRight(page, fmt(item.revenue),      AMOUNT_R  - CELL_PAD, rowY, 7.5, regularFont, rc)

    y -= ROW_H

    // Page break if running low
    if (y < MARGIN + 200 && i < params.items.length - 1) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      y = PAGE_HEIGHT - MARGIN
    }
  }

  // Totals row
  page.drawRectangle({
    x: MARGIN,
    y: y - ROW_H + 4,
    width: CONTENT_WIDTH,
    height: ROW_H,
    color: rgb(0.85, 0.85, 0.85),
  })

  const tc = rgb(0, 0, 0)
  const totY = y - 11
  page.drawText('TOTAL', { x: C_PROD_L + CELL_PAD, y: totY, size: 7.5, font: boldFont, color: tc })
  drawRight(page, String(params.totalUnits),   C_UNITS_R - CELL_PAD, totY, 7.5, boldFont, tc)
  drawRight(page, fmt(params.totalRevenue),    AMOUNT_R  - CELL_PAD, totY, 7.5, boldFont, tc)

  y -= ROW_H + 18

  // ── Footer ───────────────────────────────────────────────────────────────────
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.75, 0.75, 0.75),
  })

  y -= 13

  page.drawText('Thank you for your partnership with Xocks!', {
    x: MARGIN, y, size: 8.5, font: boldFont, color: rgb(0.2, 0.2, 0.2),
  })

  y -= 11

  const contactLine = params.companyContact
    ? `For enquiries, contact us at ${params.companyContact} or WhatsApp your account manager.`
    : 'For enquiries, contact us at hello@xocks.co or WhatsApp your account manager.'
  page.drawText(contactLine, {
    x: MARGIN, y, size: 7.5, font: regularFont, color: rgb(0.4, 0.4, 0.4),
  })

  y -= 10

  page.drawText(
    `This is a system-generated document issued by ${companyName}.`,
    { x: MARGIN, y, size: 7, font: regularFont, color: rgb(0.6, 0.6, 0.6) }
  )

  return pdfDoc.save()
}

// ── Commission invoice ──────────────────────────────────────────────────────────

async function buildInvoicePdf(params: StatementParams): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const pages: PDFPage[] = []
  let page: PDFPage = pdfDoc.addPage([A4_W, A4_H])
  pages.push(page)
  let y = A4_H - INV_MARGIN

  const text = (s: string, x: number, yy: number, size: number, font: PDFFont, color: Color = INK) =>
    page.drawText(s, { x, y: yy, size, font, color })
  const textRight = (s: string, rightX: number, yy: number, size: number, font: PDFFont, color: Color = INK) =>
    page.drawText(s, { x: rightX - font.widthOfTextAtSize(s, size), y: yy, size, font, color })
  const textCentre = (s: string, yy: number, size: number, font: PDFFont, color: Color) =>
    page.drawText(s, { x: (A4_W - font.widthOfTextAtSize(s, size)) / 2, y: yy, size, font, color })
  const rule = (x1: number, x2: number, yy: number, color: Color, thickness: number, dash?: number[]) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color, dashArray: dash })

  const drawTableHeader = () => {
    text('PRODUCT', COL.prodX, y, 7, bold, GREY)
    text('SKU', COL.skuX, y, 7, bold, GREY)
    text('KEYED IN BY', COL.staffX, y, 7, bold, GREY)
    textRight('UNITS', COL.unitsR, y, 7, bold, GREY)
    textRight('UNIT PRICE', COL.priceR, y, 7, bold, GREY)
    textRight('REVENUE', COL.revR, y, 7, bold, GREY)
    textRight('COMMISSION', COL.commR, y, 7, bold, GREY)
    y -= 14
  }

  // Continuation pages start at the top margin and repeat the table header.
  const startPage = (withTableHeader: boolean) => {
    page = pdfDoc.addPage([A4_W, A4_H])
    pages.push(page)
    y = A4_H - INV_MARGIN
    if (withTableHeader) drawTableHeader()
  }

  const companyName = params.companyName ?? DEFAULT_COMPANY
  const monthYear = `${MONTH_NAMES[params.periodMonth - 1]} ${params.periodYear}`
  const periodLabel = monthYear

  // ── Company (top left) ───────────────────────────────────────────────────────
  text(companyName.toUpperCase(), INV_MARGIN, y, 11, bold, INK)
  y -= 14

  const companyLines: string[] = []
  if (params.companyAddress?.trim()) companyLines.push(...wrapText(params.companyAddress.trim(), 300, 8, regular))
  if (params.companyContact?.trim()) companyLines.push(params.companyContact.trim())
  for (const line of companyLines) {
    text(line, INV_MARGIN, y, 8, regular, MUTED)
    y -= 11
  }

  y -= 22

  // ── Title ────────────────────────────────────────────────────────────────────
  text('CONSIGNMENT COMMISSION STATEMENT', INV_MARGIN, y, 20, regular, INK)
  y -= 30

  // ── Store information (left) and invoice details (right) ─────────────────────
  const blockTop = y
  const LEFT_LABEL_X = INV_MARGIN
  const LEFT_VALUE_X = INV_MARGIN + 62
  const LEFT_VALUE_W = 200
  let ly = blockTop
  text('STORE INFORMATION', LEFT_LABEL_X, ly, 7, bold, GREY)
  ly -= 16

  const leftRow = (label: string, value: string) => {
    text(label, LEFT_LABEL_X, ly, 7, bold, GREY)
    const lines = wrapText(value, LEFT_VALUE_W, 9, regular)
    lines.forEach((line, i) => text(line, LEFT_VALUE_X, ly - i * 11, 9, regular, INK))
    ly -= lines.length * 11 + 6
  }
  leftRow('STORE', `${params.storeName}  (${params.storeCode})`)
  leftRow('PIC', params.picName)
  if (params.storeAddress?.trim()) leftRow('ADDRESS', params.storeAddress.trim())

  const RIGHT_LABEL_X = 340
  let ry = blockTop

  const rightRow = (label: string, value: string, color: Color = INK) => {
    text(label, RIGHT_LABEL_X, ry, 7, bold, GREY)
    textRight(value, INV_RIGHT, ry, 9, regular, color)
    ry -= 15
  }
  if (params.invoiceNo) rightRow('INVOICE NO', params.invoiceNo)
  rightRow('STATEMENT PERIOD', periodLabel)
  rightRow('GENERATED', params.generatedDate)
  const status = params.status ?? ''
  rightRow('STATUS', status.toUpperCase(), status === 'paid' ? GREEN : INK)
  if (params.paymentReference) rightRow('PAYMENT REFERENCE', params.paymentReference)
  if (params.paidAt) rightRow('PAID ON', params.paidAt)

  y = Math.min(ly, ry) - 12

  // ── Sales table (no borders) ─────────────────────────────────────────────────
  y -= 4
  drawTableHeader()

  for (const item of params.items) {
    if (y - ROW_H < TABLE_FLOOR) {
      startPage(true)
    }
    const by = y - 11
    text(fitText(item.productName, 135, 8, regular), COL.prodX, by, 8, regular, INK)
    text(fitText(item.sku, 52, 8, regular), COL.skuX, by, 8, regular, MUTED)
    text(fitText(item.keyedInBy, 72, 8, regular), COL.staffX, by, 8, regular, INK)
    textRight(String(item.unitsSold), COL.unitsR, by, 8, regular)
    textRight(fmt(item.unitPrice), COL.priceR, by, 8, regular)
    textRight(fmt(item.revenue), COL.revR, by, 8, regular)
    textRight(fmt(item.commission), COL.commR, by, 8, regular)
    y -= ROW_H
  }

  // Total row: dashed rule, then bold totals
  if (y - 44 < TABLE_FLOOR) startPage(true)
  y -= 4
  rule(INV_MARGIN, INV_RIGHT, y, RULE, 0.6, [3, 2])
  y -= 14
  text('TOTAL', COL.prodX, y, 8, bold, INK)
  textRight(String(params.totalUnits), COL.unitsR, y, 8, bold, INK)
  textRight(fmt(params.totalRevenue), COL.revR, y, 8, bold, INK)
  textRight(fmt(params.totalCommission), COL.commR, y, 8, bold, INK)
  y -= 16

  // ── Bottom block: bank details (left), amount to transfer (right) ────────────
  if (y - BOTTOM_BLOCK_H < TABLE_FLOOR) startPage(false)
  y -= 26
  const bottomTop = y

  const bank = {
    bankName: params.bank?.bankName?.trim() || BANK_DEFAULTS.bankName,
    accountName: params.bank?.accountName?.trim() || BANK_DEFAULTS.accountName,
    accountNo: params.bank?.accountNo?.trim() || BANK_DEFAULTS.accountNo,
  }
  const paymentRef = params.invoiceNo
    ? `${params.invoiceNo} / ${params.storeCode} – ${monthYear}`
    : `${params.storeCode} – ${monthYear}`

  let by = bottomTop
  text('BANK ACCOUNT', INV_MARGIN, by, 7, bold, GREY)
  by -= 14
  for (const line of [
    `Account No: ${bank.accountNo}`,
    `Account Name: ${bank.accountName}`,
    `Bank: ${bank.bankName}`,
  ]) {
    for (const wrapped of wrapText(line, 230, 8, regular)) {
      text(wrapped, INV_MARGIN, by, 8, regular, MUTED)
      by -= 11
    }
  }
  by -= 10
  text('PAYMENT REFERENCE', INV_MARGIN, by, 7, bold, GREY)
  by -= 14
  text(paymentRef, INV_MARGIN, by, 8, regular, MUTED)

  const SUM_LABEL_X = 330
  let sy = bottomTop
  text('TOTAL SALES REVENUE', SUM_LABEL_X, sy, 7, bold, GREY)
  textRight(fmt(params.totalRevenue), INV_RIGHT, sy, 9, regular, INK)
  sy -= 16
  text(`STORE COMMISSION (${params.commissionRate.toFixed(0)}%)`, SUM_LABEL_X, sy, 7, bold, GREY)
  textRight(`– ${fmt(params.totalCommission)}`, INV_RIGHT, sy, 9, regular, INK)
  sy -= 10
  rule(SUM_LABEL_X, INV_RIGHT, sy, RULE, 0.6, [3, 2])
  sy -= 16
  text('AMOUNT TO TRANSFER TO XOCKS', SUM_LABEL_X, sy, 7, bold, GREY)
  sy -= 24
  textRight(fmt(params.xocksRevenue), INV_RIGHT, sy, 20, bold, INK)

  // ── Footer (centred) ─────────────────────────────────────────────────────────
  let fy = Math.min(by, sy) - 26
  rule(INV_MARGIN, INV_RIGHT, fy, LIGHT_RULE, 0.5)
  fy -= 16
  textCentre('Thank you for your partnership with Xocks!', fy, 8.5, bold, INK)
  fy -= 12
  const contactLine = params.companyContact
    ? `For enquiries, contact us at ${params.companyContact} or WhatsApp your account manager.`
    : 'For enquiries, contact us at hello@xocks.co or WhatsApp your account manager.'
  textCentre(contactLine, fy, 7.5, regular, MUTED)
  fy -= 11
  textCentre(`This is a system-generated document issued by ${companyName}.`, fy, 7, regular, GREY)

  // ── Page X of Y (every page) ─────────────────────────────────────────────────
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`
    p.drawText(label, {
      x: (A4_W - regular.widthOfTextAtSize(label, 7.5)) / 2,
      y: 28,
      size: 7.5,
      font: regular,
      color: MUTED,
    })
  })

  return pdfDoc.save()
}
