import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN = 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

function formatCurrency(amount: number): string {
  return `RM ${amount.toFixed(2)}`
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '…'
}

export async function generateDOPdf(params: {
  doNumber: string
  createdAt: string
  status: string
  storeName: string
  storeCode: string
  picName: string
  address: string
  city: string
  postcode: string
  state: string
  picPhone: string
  courier?: string
  trackingNumber?: string
  dispatchDate?: string
  items: Array<{
    name: string
    sku: string
    quantity: number
    unitCost: number
  }>
  companyName: string
  companyAddress: string
  companyPhone: string
  companyEmail: string
  // false = store-owner copy: quantities only, no internal cost prices
  showCosts?: boolean
}): Promise<Uint8Array> {
  const showCosts = params.showCosts ?? true
  const pdfDoc = await PDFDocument.create()
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])

  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica)

  let y = PAGE_HEIGHT - MARGIN

  // ── Header ──────────────────────────────────────────────────────────────────
  // XOCKS brand name
  boldFont && page.drawText('XOCKS', {
    x: MARGIN,
    y,
    size: 28,
    font: boldFont,
    color: rgb(0, 0, 0),
  })

  // DELIVERY ORDER label (right side)
  const doLabel = 'DELIVERY ORDER'
  const doLabelWidth = boldFont.widthOfTextAtSize(doLabel, 18)
  page.drawText(doLabel, {
    x: PAGE_WIDTH - MARGIN - doLabelWidth,
    y,
    size: 18,
    font: boldFont,
    color: rgb(0.2, 0.2, 0.2),
  })

  y -= 20

  // Company info
  page.drawText(params.companyName, {
    x: MARGIN,
    y,
    size: 9,
    font: boldFont,
    color: rgb(0.2, 0.2, 0.2),
  })
  y -= 12

  const companyLines = [params.companyAddress, params.companyPhone, params.companyEmail]
  for (const line of companyLines) {
    page.drawText(line, {
      x: MARGIN,
      y,
      size: 8,
      font: regularFont,
      color: rgb(0.4, 0.4, 0.4),
    })
    y -= 11
  }

  y -= 6

  // Horizontal rule
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1,
    color: rgb(0.2, 0.2, 0.2),
  })

  y -= 16

  // ── DO Number + Date ────────────────────────────────────────────────────────
  page.drawText('DO Number:', { x: MARGIN, y, size: 9, font: boldFont, color: rgb(0.2, 0.2, 0.2) })
  page.drawText(params.doNumber, { x: MARGIN + 65, y, size: 9, font: regularFont, color: rgb(0, 0, 0) })

  const dateLabel = `Date: ${params.createdAt}`
  const dateLabelWidth = regularFont.widthOfTextAtSize(dateLabel, 9)
  page.drawText(dateLabel, {
    x: PAGE_WIDTH - MARGIN - dateLabelWidth,
    y,
    size: 9,
    font: regularFont,
    color: rgb(0.2, 0.2, 0.2),
  })

  y -= 14

  // Status
  page.drawText('Status:', { x: MARGIN, y, size: 9, font: boldFont, color: rgb(0.2, 0.2, 0.2) })
  page.drawText(params.status.toUpperCase(), { x: MARGIN + 45, y, size: 9, font: regularFont, color: rgb(0, 0, 0) })

  y -= 20

  // Horizontal rule
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  })

  y -= 16

  // ── DELIVER TO ──────────────────────────────────────────────────────────────
  page.drawText('DELIVER TO:', {
    x: MARGIN,
    y,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0),
  })

  y -= 14

  const storeLines = [
    `${params.storeName} (${params.storeCode})`,
    `Attn: ${params.picName}`,
    params.address,
    `${params.city}, ${params.postcode} ${params.state}`,
    `Tel: ${params.picPhone}`,
  ]

  for (const line of storeLines) {
    page.drawText(line, {
      x: MARGIN,
      y,
      size: 9,
      font: regularFont,
      color: rgb(0.2, 0.2, 0.2),
    })
    y -= 12
  }

  y -= 16

  // ── Items Table ─────────────────────────────────────────────────────────────
  // Store-owner copy drops the cost columns and spreads the remaining ones out.
  const COL_NO = MARGIN
  const COL_NAME = MARGIN + 30
  const COL_SKU = showCosts ? MARGIN + 230 : MARGIN + 300
  const COL_QTY = showCosts ? MARGIN + 320 : MARGIN + 430
  const COL_UNIT = MARGIN + 375
  const COL_TOTAL = MARGIN + 450
  const ROW_H = 18

  // Table header background
  page.drawRectangle({
    x: MARGIN,
    y: y - ROW_H + 4,
    width: CONTENT_WIDTH,
    height: ROW_H,
    color: rgb(0.15, 0.15, 0.15),
  })

  const headerColor = rgb(1, 1, 1)
  const headers: Array<[string, number]> = [
    ['No.', COL_NO],
    ['Product Name', COL_NAME],
    ['SKU', COL_SKU],
    ['Qty', COL_QTY],
    ...(showCosts ? ([['Unit Cost', COL_UNIT], ['Total', COL_TOTAL]] as Array<[string, number]>) : []),
  ]

  for (const [label, x] of headers) {
    page.drawText(label, {
      x: x + 3,
      y: y - 10,
      size: 8,
      font: boldFont,
      color: headerColor,
    })
  }

  y -= ROW_H

  // Table rows
  let totalQty = 0
  let totalAmount = 0

  for (let i = 0; i < params.items.length; i++) {
    const item = params.items[i]
    const rowTotal = item.quantity * item.unitCost
    totalQty += item.quantity
    totalAmount += rowTotal

    // Alternate row background
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
    page.drawText(String(i + 1), { x: COL_NO + 3, y: y - 10, size: 8, font: regularFont, color: rowColor })
    page.drawText(truncate(item.name, showCosts ? 28 : 40), { x: COL_NAME + 3, y: y - 10, size: 8, font: regularFont, color: rowColor })
    page.drawText(item.sku, { x: COL_SKU + 3, y: y - 10, size: 8, font: regularFont, color: rowColor })
    page.drawText(String(item.quantity), { x: COL_QTY + 3, y: y - 10, size: 8, font: regularFont, color: rowColor })
    if (showCosts) {
      page.drawText(formatCurrency(item.unitCost), { x: COL_UNIT + 3, y: y - 10, size: 8, font: regularFont, color: rowColor })
      page.drawText(formatCurrency(rowTotal), { x: COL_TOTAL + 3, y: y - 10, size: 8, font: regularFont, color: rowColor })
    }

    y -= ROW_H

    // Add a new page if running out of space
    if (y < MARGIN + 120 && i < params.items.length - 1) {
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

  page.drawText('TOTAL', { x: COL_NO + 3, y: y - 10, size: 8, font: boldFont, color: rgb(0, 0, 0) })
  page.drawText(String(totalQty), { x: COL_QTY + 3, y: y - 10, size: 8, font: boldFont, color: rgb(0, 0, 0) })
  if (showCosts) {
    page.drawText(formatCurrency(totalAmount), { x: COL_TOTAL + 3, y: y - 10, size: 8, font: boldFont, color: rgb(0, 0, 0) })
  }

  y -= ROW_H + 8

  // Table border — no fill (a color here would paint over the rows)
  page.drawRectangle({
    x: MARGIN,
    y: y + 4,
    width: CONTENT_WIDTH,
    height: ROW_H * (params.items.length + 2),
    borderColor: rgb(0.6, 0.6, 0.6),
    borderWidth: 0.5,
  })

  y -= 20

  // ── Footer ───────────────────────────────────────────────────────────────────
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  })

  y -= 14

  // Courier + Tracking
  if (params.courier || params.trackingNumber) {
    const courierText = `Courier: ${params.courier ?? '-'}    Tracking: ${params.trackingNumber ?? '-'}`
    page.drawText(courierText, {
      x: MARGIN,
      y,
      size: 8,
      font: regularFont,
      color: rgb(0.3, 0.3, 0.3),
    })
    y -= 12
  }

  if (params.dispatchDate) {
    page.drawText(`Dispatched Date: ${params.dispatchDate}`, {
      x: MARGIN,
      y,
      size: 8,
      font: regularFont,
      color: rgb(0.3, 0.3, 0.3),
    })
    y -= 14
  }

  y -= 6

  // Signature line
  page.drawText('Received by: _________________________    Date: ___________________', {
    x: MARGIN,
    y,
    size: 9,
    font: regularFont,
    color: rgb(0.2, 0.2, 0.2),
  })

  y -= 20

  // Computer-generated notice
  page.drawText('This is a computer-generated document. Wayne Group Holding Sdn Bhd.', {
    x: MARGIN,
    y,
    size: 7,
    font: regularFont,
    color: rgb(0.6, 0.6, 0.6),
  })

  return pdfDoc.save()
}
