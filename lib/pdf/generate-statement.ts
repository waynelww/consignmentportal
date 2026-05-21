import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN = 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatCurrency(amount: number): string {
  return `RM ${amount.toFixed(2)}`
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '…'
}

export async function generateStatementPdf(params: {
  storeName: string
  storeCode: string
  picName: string
  bankName?: string
  bankAccount?: string
  bankAccountName?: string
  periodMonth: number
  periodYear: number
  generatedDate: string
  commissionRate: number
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
  xocksRevenue: number
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

  // ── Header ──────────────────────────────────────────────────────────────────
  // Black header bar
  const headerBarH = 50
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - headerBarH,
    width: PAGE_WIDTH,
    height: headerBarH,
    color: rgb(0, 0, 0),
  })

  // XOCKS in gold
  page.drawText('XOCKS', {
    x: MARGIN,
    y: PAGE_HEIGHT - headerBarH + 16,
    size: 22,
    font: boldFont,
    color: rgb(0.82, 0.67, 0.23),
  })

  const statTitle = 'CONSIGNMENT COMMISSION STATEMENT'
  const statTitleWidth = boldFont.widthOfTextAtSize(statTitle, 10)
  page.drawText(statTitle, {
    x: PAGE_WIDTH - MARGIN - statTitleWidth,
    y: PAGE_HEIGHT - headerBarH + 20,
    size: 10,
    font: boldFont,
    color: rgb(1, 1, 1),
  })

  y = PAGE_HEIGHT - headerBarH - 16

  // Company name
  page.drawText(params.companyName ?? 'Wayne Group Holding Sdn Bhd', {
    x: MARGIN,
    y,
    size: 10,
    font: boldFont,
    color: rgb(0.2, 0.2, 0.2),
  })

  y -= 14

  // Period + Generated
  page.drawText(`Statement Period: ${periodLabel}`, {
    x: MARGIN,
    y,
    size: 9,
    font: regularFont,
    color: rgb(0.3, 0.3, 0.3),
  })

  const genText = `Generated: ${params.generatedDate}`
  const genTextWidth = regularFont.widthOfTextAtSize(genText, 9)
  page.drawText(genText, {
    x: PAGE_WIDTH - MARGIN - genTextWidth,
    y,
    size: 9,
    font: regularFont,
    color: rgb(0.3, 0.3, 0.3),
  })

  y -= 6

  // Horizontal rule
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1,
    color: rgb(0.2, 0.2, 0.2),
  })

  y -= 16

  // ── Store Information ────────────────────────────────────────────────────────
  page.drawText('STORE INFORMATION', {
    x: MARGIN,
    y,
    size: 9,
    font: boldFont,
    color: rgb(0, 0, 0),
  })

  y -= 4

  // Info box background
  const infoBoxTop = y
  const storeInfoLines = [
    ['Store Name:', `${params.storeName} (${params.storeCode})`],
    ['PIC:', params.picName],
    ['Bank:', params.bankName ?? '-'],
    ['Account No.:', params.bankAccount ?? '-'],
    ['Account Name:', params.bankAccountName ?? '-'],
  ]
  const infoBoxH = storeInfoLines.length * 13 + 8

  page.drawRectangle({
    x: MARGIN,
    y: infoBoxTop - infoBoxH,
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
      color: rgb(0.3, 0.3, 0.3),
    })
    page.drawText(value, {
      x: MARGIN + 100,
      y,
      size: 8,
      font: regularFont,
      color: rgb(0.1, 0.1, 0.1),
    })
    y -= 13
  }

  y -= 16

  // ── Sales Summary Table ──────────────────────────────────────────────────────
  page.drawText('SALES SUMMARY', {
    x: MARGIN,
    y,
    size: 9,
    font: boldFont,
    color: rgb(0, 0, 0),
  })

  y -= 4

  const COL_PRODUCT = MARGIN
  const COL_SKU = MARGIN + 170
  const COL_UNITS = MARGIN + 250
  const COL_PRICE = MARGIN + 300
  const COL_REV = MARGIN + 365
  const COL_COMM = MARGIN + 435
  const ROW_H = 18

  // Header row
  page.drawRectangle({
    x: MARGIN,
    y: y - ROW_H + 4,
    width: CONTENT_WIDTH,
    height: ROW_H,
    color: rgb(0.15, 0.15, 0.15),
  })

  const tableHeaders: Array<[string, number]> = [
    ['Product', COL_PRODUCT],
    ['SKU', COL_SKU],
    ['Units Sold', COL_UNITS],
    ['Unit Price', COL_PRICE],
    ['Revenue', COL_REV],
    ['Commission', COL_COMM],
  ]

  for (const [label, x] of tableHeaders) {
    page.drawText(label, {
      x: x + 3,
      y: y - 10,
      size: 8,
      font: boldFont,
      color: rgb(1, 1, 1),
    })
  }

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

    const rowColor = rgb(0.1, 0.1, 0.1)
    page.drawText(truncate(item.productName, 22), { x: COL_PRODUCT + 3, y: y - 10, size: 8, font: regularFont, color: rowColor })
    page.drawText(item.sku, { x: COL_SKU + 3, y: y - 10, size: 8, font: regularFont, color: rowColor })
    page.drawText(String(item.unitsSold), { x: COL_UNITS + 3, y: y - 10, size: 8, font: regularFont, color: rowColor })
    page.drawText(formatCurrency(item.unitPrice), { x: COL_PRICE + 3, y: y - 10, size: 8, font: regularFont, color: rowColor })
    page.drawText(formatCurrency(item.revenue), { x: COL_REV + 3, y: y - 10, size: 8, font: regularFont, color: rowColor })
    page.drawText(formatCurrency(item.commission), { x: COL_COMM + 3, y: y - 10, size: 8, font: regularFont, color: rowColor })

    y -= ROW_H

    if (y < MARGIN + 160 && i < params.items.length - 1) {
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
    color: rgb(0.88, 0.88, 0.88),
  })

  page.drawText('TOTAL', { x: COL_PRODUCT + 3, y: y - 10, size: 8, font: boldFont, color: rgb(0, 0, 0) })
  page.drawText(String(params.totalUnits), { x: COL_UNITS + 3, y: y - 10, size: 8, font: boldFont, color: rgb(0, 0, 0) })
  page.drawText(formatCurrency(params.totalRevenue), { x: COL_REV + 3, y: y - 10, size: 8, font: boldFont, color: rgb(0, 0, 0) })
  page.drawText(formatCurrency(params.totalCommission), { x: COL_COMM + 3, y: y - 10, size: 8, font: boldFont, color: rgb(0, 0, 0) })

  y -= ROW_H + 20

  // ── Payout Summary ───────────────────────────────────────────────────────────
  page.drawText('PAYOUT SUMMARY', {
    x: MARGIN,
    y,
    size: 9,
    font: boldFont,
    color: rgb(0, 0, 0),
  })

  y -= 4

  const payoutLines: Array<[string, string]> = [
    ['Total Revenue:', formatCurrency(params.totalRevenue)],
    ['Commission Rate:', `${params.commissionRate.toFixed(0)}%`],
    ['Commission Due:', formatCurrency(params.totalCommission)],
    ['Xocks Revenue:', formatCurrency(params.xocksRevenue)],
  ]

  if (params.bankAccountName) {
    payoutLines.push(['Payable To:', params.bankAccountName])
  }
  if (params.bankName) {
    payoutLines.push(['Bank:', params.bankName])
  }
  if (params.bankAccount) {
    payoutLines.push(['Account No.:', params.bankAccount])
  }

  const payoutBoxH = payoutLines.length * 14 + 8

  page.drawRectangle({
    x: MARGIN,
    y: y - payoutBoxH,
    width: CONTENT_WIDTH,
    height: payoutBoxH,
    color: rgb(0.97, 0.97, 1.0),
    borderColor: rgb(0.7, 0.7, 0.9),
    borderWidth: 0.5,
  })

  y -= 8

  for (const [label, value] of payoutLines) {
    page.drawText(label, { x: MARGIN + 6, y, size: 8, font: boldFont, color: rgb(0.2, 0.2, 0.4) })
    page.drawText(value, { x: MARGIN + 120, y, size: 8, font: regularFont, color: rgb(0.1, 0.1, 0.1) })
    y -= 14
  }

  y -= 16

  // ── Status + Payment Reference ───────────────────────────────────────────────
  const statusColor = params.status === 'paid'
    ? rgb(0, 0.5, 0.1)
    : params.status === 'approved'
      ? rgb(0, 0.3, 0.7)
      : rgb(0.5, 0.3, 0)

  page.drawText(`Status: ${params.status.toUpperCase()}`, {
    x: MARGIN,
    y,
    size: 10,
    font: boldFont,
    color: statusColor,
  })

  y -= 14

  if (params.paymentReference) {
    page.drawText(`Payment Reference: ${params.paymentReference}`, {
      x: MARGIN,
      y,
      size: 9,
      font: regularFont,
      color: rgb(0.2, 0.2, 0.2),
    })
    y -= 12
  }

  if (params.paidAt) {
    page.drawText(`Paid On: ${params.paidAt}`, {
      x: MARGIN,
      y,
      size: 9,
      font: regularFont,
      color: rgb(0.2, 0.2, 0.2),
    })
    y -= 12
  }

  y -= 20

  // ── Footer ───────────────────────────────────────────────────────────────────
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  })

  y -= 14

  page.drawText('Thank you for your partnership with Xocks!', {
    x: MARGIN,
    y,
    size: 9,
    font: boldFont,
    color: rgb(0.2, 0.2, 0.2),
  })

  y -= 12

  const contactLine = params.companyContact
    ? `For enquiries, contact us at ${params.companyContact} or WhatsApp your account manager.`
    : 'For enquiries, contact us at hello@xocks.co or WhatsApp your account manager.'
  page.drawText(contactLine, {
    x: MARGIN,
    y,
    size: 8,
    font: regularFont,
    color: rgb(0.4, 0.4, 0.4),
  })

  y -= 12

  const companyDisclaimer = `This is a computer-generated document. ${params.companyName ?? 'Wayne Group Holding Sdn Bhd'}.`
  page.drawText(companyDisclaimer, {
    x: MARGIN,
    y,
    size: 7,
    font: regularFont,
    color: rgb(0.6, 0.6, 0.6),
  })

  return pdfDoc.save()
}
