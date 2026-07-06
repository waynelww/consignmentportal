import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN = 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

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
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  color: ReturnType<typeof rgb>
) {
  const w = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: rightX - w, y, size, font, color })
}

// Truncate text to fit within maxWidth pts at the given font size
function fitText(
  text: string,
  maxWidth: number,
  size: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > maxWidth) {
    t = t.slice(0, -1)
  }
  return t + '…'
}

export async function generateStatementPdf(params: {
  storeName: string
  storeCode: string
  picName: string
  storeAddress?: string
  periodMonth: number
  periodYear: number
  generatedDate: string
  commissionRate: number
  paymentTermsDays?: number        // e.g. 7, 14, 30
  companyName?: string
  companyAddress?: string
  companyContact?: string
  items: Array<{
    productName: string
    sku: string
    unitsSold: number
    unitPrice: number
    revenue: number
    commission: number
  }>
  totalUnits: number
  totalRevenue: number
  totalCommission: number
  xocksRevenue: number             // = totalRevenue - totalCommission
  status: string
  paymentReference?: string
  paidAt?: string
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])

  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica)

  let y = PAGE_HEIGHT - MARGIN

  const periodLabel = `${MONTH_NAMES[params.periodMonth - 1]} ${params.periodYear}`
  const companyName = params.companyName ?? 'Wayne Group Holding Sdn Bhd'
  const paymentDays = params.paymentTermsDays ?? 7

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

  const statTitle = 'CONSIGNMENT COMMISSION STATEMENT'
  drawRight(page, statTitle, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - headerBarH + 20, 9, boldFont, rgb(1, 1, 1))

  y = PAGE_HEIGHT - headerBarH - 14

  page.drawText(companyName, {
    x: MARGIN,
    y,
    size: 9,
    font: boldFont,
    color: rgb(0.2, 0.2, 0.2),
  })

  y -= 13

  page.drawText(`Statement Period: ${periodLabel}`, {
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
  const C_PROD_L   = MARGIN           // Product name — left-aligned, 185pt wide
  const C_SKU_L    = MARGIN + 190     // SKU — left-aligned, 65pt wide
  const C_UNITS_R  = MARGIN + 285     // Units — right-aligned (30pt column)
  const C_PRICE_R  = MARGIN + 365     // Unit Price — right-aligned (80pt column)
  const C_REV_R    = MARGIN + 430     // Revenue — right-aligned (65pt column)
  const C_COMM_R   = MARGIN + 495     // Commission — right-aligned (65pt, = page right edge)

  // Vertical separator x positions (drawn between columns)
  const SEP_AFTER_PROD  = MARGIN + 187
  const SEP_AFTER_SKU   = MARGIN + 257
  const SEP_AFTER_UNITS = MARGIN + 290
  const SEP_AFTER_PRICE = MARGIN + 370
  const SEP_AFTER_REV   = MARGIN + 435

  const ROW_H = 18
  const CELL_PAD = 4
  const SEP_COLOR = rgb(0.75, 0.75, 0.75)
  const prodMaxW = SEP_AFTER_PROD - C_PROD_L - CELL_PAD * 2
  const skuMaxW  = SEP_AFTER_SKU  - C_SKU_L  - CELL_PAD * 2

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
  drawRight(page, 'Units',      C_UNITS_R - CELL_PAD, headerY, 7.5, boldFont, hc)
  drawRight(page, 'Unit Price', C_PRICE_R - CELL_PAD, headerY, 7.5, boldFont, hc)
  drawRight(page, 'Revenue',    C_REV_R   - CELL_PAD, headerY, 7.5, boldFont, hc)
  drawRight(page, 'Commission', C_COMM_R  - CELL_PAD, headerY, 7.5, boldFont, hc)

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
    for (const sx of [SEP_AFTER_PROD, SEP_AFTER_SKU, SEP_AFTER_UNITS, SEP_AFTER_PRICE, SEP_AFTER_REV]) {
      page.drawLine({ start: { x: sx, y: rowTop }, end: { x: sx, y: rowTop - ROW_H }, thickness: 0.4, color: SEP_COLOR })
    }

    const rc = rgb(0.1, 0.1, 0.1)
    const skuColor = rgb(0.35, 0.35, 0.35)
    const rowY = y - 11

    page.drawText(fitText(item.productName, prodMaxW, 7.5, regularFont), { x: C_PROD_L + CELL_PAD, y: rowY, size: 7.5, font: regularFont, color: rc })
    page.drawText(fitText(item.sku,         skuMaxW,  7.5, regularFont), { x: C_SKU_L  + CELL_PAD, y: rowY, size: 7.5, font: regularFont, color: skuColor })
    drawRight(page, String(item.unitsSold), C_UNITS_R - CELL_PAD, rowY, 7.5, regularFont, rc)
    drawRight(page, fmt(item.unitPrice),    C_PRICE_R - CELL_PAD, rowY, 7.5, regularFont, rc)
    drawRight(page, fmt(item.revenue),      C_REV_R   - CELL_PAD, rowY, 7.5, regularFont, rc)
    drawRight(page, fmt(item.commission),   C_COMM_R  - CELL_PAD, rowY, 7.5, regularFont, rc)

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
  drawRight(page, fmt(params.totalRevenue),    C_REV_R   - CELL_PAD, totY, 7.5, boldFont, tc)
  drawRight(page, fmt(params.totalCommission), C_COMM_R  - CELL_PAD, totY, 7.5, boldFont, tc)

  y -= ROW_H + 18

  // ── Payout Calculation ───────────────────────────────────────────────────────
  page.drawText('PAYOUT CALCULATION', {
    x: MARGIN,
    y,
    size: 8,
    font: boldFont,
    color: rgb(0, 0, 0),
  })

  y -= 5

  const amountDue = params.xocksRevenue  // totalRevenue - totalCommission

  const payoutRows: Array<{ label: string; value: string; isTotal?: boolean; isMinus?: boolean }> = [
    { label: 'Total Sales Revenue',                                       value: fmt(params.totalRevenue) },
    { label: `Store Commission (${params.commissionRate.toFixed(0)}%)`,   value: `– ${fmt(params.totalCommission)}`, isMinus: true },
  ]

  const payoutBoxH = payoutRows.length * 16 + 10 + 4 + 22  // rows + divider + total line

  page.drawRectangle({
    x: MARGIN,
    y: y - payoutBoxH,
    width: CONTENT_WIDTH,
    height: payoutBoxH,
    color: rgb(0.97, 0.98, 1.0),
    borderColor: rgb(0.72, 0.75, 0.95),
    borderWidth: 0.8,
  })

  y -= 8

  const labelX = MARGIN + 8
  const valueRX = PAGE_WIDTH - MARGIN - 8  // right edge for numbers

  for (const row of payoutRows) {
    const fc = row.isMinus ? rgb(0.7, 0.1, 0.1) : rgb(0.15, 0.15, 0.35)
    page.drawText(row.label, { x: labelX, y, size: 8.5, font: regularFont, color: fc })
    drawRight(page, row.value, valueRX, y, 8.5, row.isMinus ? regularFont : regularFont, fc)
    y -= 16
  }

  // Divider line
  page.drawLine({
    start: { x: MARGIN + 8, y: y + 10 },
    end: { x: PAGE_WIDTH - MARGIN - 8, y: y + 10 },
    thickness: 0.6,
    color: rgb(0.6, 0.6, 0.8),
  })

  y -= 4

  // Total row — highlighted
  page.drawRectangle({
    x: MARGIN + 4,
    y: y - 18,
    width: CONTENT_WIDTH - 8,
    height: 20,
    color: rgb(0.08, 0.08, 0.15),
    borderWidth: 0,
  })

  page.drawText('Amount to Transfer to Xocks', { x: labelX, y: y - 12, size: 9, font: boldFont, color: rgb(1, 1, 1) })
  drawRight(page, fmt(amountDue), valueRX, y - 12, 10, boldFont, rgb(1, 0.85, 0.1))

  y -= 32

  // ── Payment Terms Remark ─────────────────────────────────────────────────────
  const remarkBoxH = 54

  page.drawRectangle({
    x: MARGIN,
    y: y - remarkBoxH,
    width: CONTENT_WIDTH,
    height: remarkBoxH,
    color: rgb(1.0, 0.97, 0.92),
    borderColor: rgb(0.95, 0.6, 0.1),
    borderWidth: 0.8,
  })

  const remarkHeaderY = y - 12
  page.drawText('PAYMENT REMINDER', {
    x: MARGIN + 8,
    y: remarkHeaderY,
    size: 8,
    font: boldFont,
    color: rgb(0.7, 0.3, 0),
  })

  page.drawText(
    `Please transfer ${fmt(amountDue)} within ${paymentDays} working day${paymentDays > 1 ? 's' : ''} from the date of this statement.`,
    { x: MARGIN + 8, y: remarkHeaderY - 14, size: 8, font: regularFont, color: rgb(0.2, 0.15, 0) }
  )

  page.drawText(
    'Late payment will incur a 10% surcharge on the outstanding amount due.',
    { x: MARGIN + 8, y: remarkHeaderY - 26, size: 8, font: regularFont, color: rgb(0.5, 0.1, 0) }
  )

  const payRef = `Payment Reference: ${params.storeCode} – ${MONTH_NAMES[params.periodMonth - 1]} ${params.periodYear}`
  page.drawText(payRef, {
    x: MARGIN + 8,
    y: remarkHeaderY - 38,
    size: 7.5,
    font: boldFont,
    color: rgb(0.2, 0.2, 0.2),
  })

  y -= remarkBoxH + 14

  // ── Status ───────────────────────────────────────────────────────────────────
  const statusColor = params.status === 'paid'
    ? rgb(0, 0.5, 0.1)
    : params.status === 'approved'
      ? rgb(0, 0.3, 0.7)
      : rgb(0.5, 0.3, 0)

  page.drawText(`Status: ${params.status.toUpperCase()}`, {
    x: MARGIN,
    y,
    size: 9,
    font: boldFont,
    color: statusColor,
  })

  y -= 13

  if (params.paymentReference) {
    page.drawText(`Payment Reference: ${params.paymentReference}`, {
      x: MARGIN, y, size: 8, font: regularFont, color: rgb(0.2, 0.2, 0.2),
    })
    y -= 11
  }

  if (params.paidAt) {
    page.drawText(`Paid On: ${params.paidAt}`, {
      x: MARGIN, y, size: 8, font: regularFont, color: rgb(0.2, 0.2, 0.2),
    })
    y -= 11
  }

  y -= 12

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
