import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import { shipmentLines, type ShipmentDetails } from './shipment'

// 4 x 6 inch packing slip for a restock DO (label-printer friendly).
// Generated on the fly from the DO's existing data — nothing is stored.
// Served by GET /api/delivery-orders/[doId]/pdf?slip, the same route (and
// pdf-lib approach) as the full DO PDF in lib/pdf/generate-do.ts.

export const SLIP_WIDTH = 288 // 4 in
export const SLIP_HEIGHT = 432 // 6 in
const M = 14
const CW = SLIP_WIDTH - M * 2
const ROW_MAX = 13
const ROW_MIN = 8.5
const COL_GAP = 10
const BLACK = rgb(0, 0, 0)
const DARK_GREY = rgb(0.3, 0.3, 0.3)

const FOOTER_LINE_1 = 'XOCKS.CO · info@xocks.co · xocks.co'
const FOOTER_LINE_2 = 'Wisma Aman Elite, Persiaran Desa Aman, Taman Desa Aman, 56100 Kuala Lumpur, Federal Territory of Kuala Lumpur'

export interface SlipItem {
  sku: string
  name: string
  category?: string | null
  quantity: number
}

export interface SlipParams {
  doNumber: string
  createdAt: string // ISO timestamp
  storeName: string
  address?: string | null
  postcode?: string | null
  city?: string | null
  state?: string | null
  picName?: string | null
  picPhone?: string | null
  // Shipment details, printed as a SHIP TO block when filled
  shipment?: ShipmentDetails | null
  items: SlipItem[]
}

// Layout facts per label, returned for tests (overlap checks)
export interface SlipPageLayout {
  label: number
  columns: 1 | 2
  rowHeight: number
  fontSize: number
  rows: number
  codes: string[] // SKU codes in printed order (column 1 top→bottom, then column 2)
  rowLines: number
  rowsTop: number
  rowsBottom: number
  totalsTop: number | null
  packedByBottom: number | null
  footerTop: number | null
  continuedNote: boolean
}

const CUTS = ['Ankle', 'Crew', 'Half', 'No Show', 'Kids', 'Muslimah']
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const stripLeadingNumber = (s: string) => s.replace(/^\s*\d+[\s.)\-:]*/, '').trim()

/**
 * "Plain Series - Ankle - Charcoal Blue" → "Charcoal Blue · Ankle"
 * "Special Patches Series - White Kuih"  → "White Kuih · Patches"
 */
export function slipItemText(name: string, category?: string | null): string {
  const parts = name.split(' - ').map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2 && /special patches/i.test(parts[0])) {
    return `${stripLeadingNumber(parts.slice(1).join(' - '))} · Patches`
  }
  if (parts.length >= 2) {
    const colour = stripLeadingNumber(parts[parts.length - 1]) || parts[parts.length - 1]
    const cutPart = parts.slice(0, -1).map((p) => p.replace(/\(.*?\)/g, '').trim())
      .reverse().find((p) => CUTS.some((c) => c.toLowerCase() === p.toLowerCase()))
    const cut = cutPart ? titleCase(cutPart.toLowerCase()) : category ? titleCase(category) : null
    return cut ? `${colour} · ${cut}` : colour
  }
  return name.trim()
}

// Picking order: Ankle (A1, A2 … A56), then Half (H…), then Crew (C…), each
// by number; everything else (patches etc.) after, alphabetically.
const CUT_ORDER: Record<string, number> = { A: 0, H: 1, C: 2 }
export function compareSlipSku(a: string, b: string): number {
  const ma = /^([AHC])(\d+)$/i.exec(a.trim())
  const mb = /^([AHC])(\d+)$/i.exec(b.trim())
  if (ma && mb) {
    return CUT_ORDER[ma[1].toUpperCase()] - CUT_ORDER[mb[1].toUpperCase()] || Number(ma[2]) - Number(mb[2])
  }
  if (ma) return -1
  if (mb) return 1
  return a.localeCompare(b, 'en', { sensitivity: 'base' })
}

/** "27 October 2026" in Malaysia time */
export function slipDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
}

export async function buildPackingSlip(p: SlipParams): Promise<{ bytes: Uint8Array; pages: SlipPageLayout[] }> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Packing slip ${p.doNumber}`)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const reg = await pdf.embedFont(StandardFonts.Helvetica)
  const mono = await pdf.embedFont(StandardFonts.CourierBold)

  // Standard fonts are WinAnsi-only: replace anything else so odd
  // characters in a store name can never break the slip.
  const charset = new Set(reg.getCharacterSet())
  // Invisible marks (e.g. the bidi marks phones pasted from WhatsApp carry)
  // are dropped and dash/space variants normalised before that.
  const safe = (s: string) => Array.from(
    s.normalize('NFKC')
      .replace(/\p{Cf}/gu, '')
      .replace(/[\u2010-\u2012\u2212]/g, '-')
      .replace(/[\r\t\u00A0\u2000-\u200A\u202F]/g, ' '),
  ).map((c) => (charset.has(c.codePointAt(0)!) ? c : '?')).join('')

  const width = (t: string, f: PDFFont, size: number) => f.widthOfTextAtSize(t, size)
  const fit = (t: string, f: PDFFont, size: number, max: number) => {
    if (width(t, f, size) <= max) return t
    let s = t
    while (s.length > 0 && width(`${s}…`, f, size) > max) s = s.slice(0, -1)
    return `${s.trimEnd()}…`
  }
  const wrap = (t: string, f: PDFFont, size: number, max: number) => {
    const lines: string[] = []
    let cur = ''
    for (const word of t.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word
      if (width(next, f, size) <= max) cur = next
      else {
        if (cur) lines.push(cur)
        cur = width(word, f, size) <= max ? word : fit(word, f, size, max)
      }
    }
    if (cur) lines.push(cur)
    return lines
  }
  const text = (page: PDFPage, t: string, x: number, y: number, f: PDFFont, size: number, color = BLACK) =>
    page.drawText(t, { x, y, size, font: f, color })
  const right = (page: PDFPage, t: string, xr: number, y: number, f: PDFFont, size: number) =>
    text(page, t, xr - width(t, f, size), y, f, size)
  const hline = (page: PDFPage, x1: number, x2: number, y: number, thickness: number, color = BLACK) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color })

  // ── Pre-computed text blocks ──────────────────────────────────────────
  const items = [...p.items].sort((a, b) => compareSlipSku(a.sku, b.sku)).map((i) => ({ code: safe(i.sku || '-'), label: safe(slipItemText(i.name, i.category)), qty: i.quantity }))
  const totalPairs = items.reduce((a, i) => a + i.qty, 0)
  const addrLines: string[] = []
  for (const raw of (p.address ?? '').split(/\n+/).map((s) => s.trim()).filter(Boolean)) addrLines.push(...wrap(safe(raw), reg, 7.5, CW))
  const cityLine = [[p.postcode, p.city].filter(Boolean).join(' '), p.state].filter(Boolean).join(', ')
  if (cityLine) addrLines.push(...wrap(safe(cityLine), reg, 7.5, CW))
  const contact = [p.picName, p.picPhone].map((s) => (s ?? '').trim()).filter(Boolean).join(' · ')
  const shipLines = shipmentLines(p.shipment).flatMap((line) => wrap(safe(line), reg, 7.5, CW))
  const footer2 = wrap(FOOTER_LINE_2, reg, 6, CW)

  // Header + deliver-to block, ending in the thick rule above the table
  const drawTop = (page: PDFPage, continued: boolean) => {
    let y = SLIP_HEIGHT - M
    text(page, 'XOCKS.CO', M, y - 13, bold, 16)
    right(page, 'CONSIGNMENT RESTOCK', M + CW, y - 6, bold, 6.5)
    right(page, safe(p.doNumber), M + CW, y - 16, bold, 9)
    right(page, slipDate(p.createdAt), M + CW, y - 25, reg, 7.5)
    y -= 36
    text(page, continued ? 'DELIVER TO (continued)' : 'DELIVER TO', M, y - 6, bold, 6.5)
    y -= 9
    for (const line of wrap(safe(p.storeName), bold, 9, CW)) { text(page, line, M, y - 8, bold, 9); y -= 11 }
    for (const line of addrLines) { text(page, line, M, y - 7, reg, 7.5); y -= 9 }
    if (contact) {
      for (const line of wrap(safe(`Contact: ${contact}`), reg, 7.5, CW)) { text(page, line, M, y - 7, reg, 7.5); y -= 9 }
    }
    if (shipLines.length > 0) {
      text(page, 'SHIP TO', M, y - 6, bold, 6.5)
      y -= 9
      for (const line of shipLines) { text(page, line, M, y - 7, reg, 7.5); y -= 9 }
    }
    y -= 4
    hline(page, M, M + CW, y, 1.5)
  }

  // Heights of the fixed blocks
  const HEAD_ROW = 11 // column header row under the thick rule
  const footerH = (1 + footer2.length) * 7.5
  const PACKED_H = 34 // gap + signature line + "Packed by:" label
  const TOTALS_H = 22 // thick rule + totals line
  const lastBottom = M + footerH + PACKED_H + TOTALS_H // rows must end above this
  const contBottom = M + 22 // "Continued on next label" + "Label X of Y"

  // Where the item table starts — the top block is the same height on every
  // label (mirrors drawTop's arithmetic)
  const topY = (() => {
    let y = SLIP_HEIGHT - M - 36 - 9
    y -= wrap(safe(p.storeName), bold, 9, CW).length * 11
    y -= addrLines.length * 9
    if (contact) y -= wrap(safe(`Contact: ${contact}`), reg, 7.5, CW).length * 9
    if (shipLines.length > 0) y -= 9 + shipLines.length * 9
    return y - 4
  })()
  const rowsTop = topY - HEAD_ROW
  const areaLast = rowsTop - lastBottom
  const areaCont = rowsTop - contBottom
  const fitsRows = (area: number) => Math.max(1, Math.floor(area / ROW_MIN))

  // Plan: 1 column → 2 columns → extra labels
  type Plan = { columns: 1 | 2; count: number; area: number; last: boolean }
  const plans: Plan[] = []
  const n = items.length
  if (n <= fitsRows(areaLast)) plans.push({ columns: 1, count: n, area: areaLast, last: true })
  else if (n <= 2 * fitsRows(areaLast)) plans.push({ columns: 2, count: n, area: areaLast, last: true })
  else {
    // Fewest labels that fit, then spread the items evenly across them
    // (the last label has less room because it also carries the totals).
    const capCont = 2 * fitsRows(areaCont)
    const capLast = 2 * fitsRows(areaLast)
    const labels = 1 + Math.ceil((n - capLast) / capCont)
    const last = Math.min(capLast, Math.ceil(n / labels))
    let rest = n - last
    for (let i = 0; i < labels - 1; i++) {
      const take = Math.min(capCont, Math.ceil(rest / (labels - 1 - i)))
      plans.push({ columns: 2, count: take, area: areaCont, last: false })
      rest -= take
    }
    plans.push({ columns: last <= fitsRows(areaLast) ? 1 : 2, count: last + rest, area: areaLast, last: true })
  }

  const layouts: SlipPageLayout[] = []
  const multi = plans.length > 1
  let idx = 0
  plans.forEach((plan, pi) => {
    const page = pdf.addPage([SLIP_WIDTH, SLIP_HEIGHT])
    drawTop(page, pi > 0)
    const perCol = plan.columns === 1 ? plan.count : Math.ceil(plan.count / 2)
    const h = Math.min(ROW_MAX, Math.max(ROW_MIN, plan.area / Math.max(1, perCol)))
    const fs = Math.min(9, Math.max(6.5, h * 0.74))
    const colW = plan.columns === 1 ? CW : (CW - COL_GAP) / 2
    const pageItems = items.slice(idx, idx + plan.count)
    idx += plan.count
    let rowLines = 0
    let lowest = rowsTop

    for (let c = 0; c < plan.columns; c++) {
      const x0 = M + c * (colW + COL_GAP)
      const x1 = x0 + colW
      const codeW = width('WWWWW', mono, fs) + 4 // 5 monospace chars + gap
      // column headers
      text(page, 'CODE', x0, topY - 8, bold, 6.5)
      text(page, 'ITEM', x0 + codeW, topY - 8, bold, 6.5)
      right(page, 'PAIRS', x1, topY - 8, bold, 6.5)
      const colItems = pageItems.slice(c * perCol, (c + 1) * perCol)
      colItems.forEach((it, r) => {
        const top = rowsTop - r * h
        const bottom = top - h
        const base = bottom + (h - fs * 0.72) / 2
        const qty = String(it.qty)
        const qtyW = width(qty, bold, fs)
        const longCode = it.code.length > 5
        const labelX = longCode ? x0 : x0 + codeW
        if (!longCode) text(page, it.code, x0, base, mono, fs)
        text(page, fit(it.label, reg, fs, x1 - qtyW - 6 - labelX), labelX, base, reg, fs)
        text(page, qty, x1 - qtyW, base, bold, fs)
        hline(page, x0, x1, bottom, 0.5, DARK_GREY)
        rowLines++
        lowest = Math.min(lowest, bottom)
      })
    }
    if (plan.columns === 2) {
      const xm = M + colW + COL_GAP / 2
      page.drawLine({ start: { x: xm, y: topY - 2 }, end: { x: xm, y: rowsTop - perCol * h }, thickness: 0.5, color: DARK_GREY })
    }

    const layout: SlipPageLayout = {
      label: pi + 1, columns: plan.columns, rowHeight: Math.round(h * 100) / 100, fontSize: Math.round(fs * 100) / 100,
      rows: pageItems.length, codes: pageItems.map((i) => i.code), rowLines, rowsTop, rowsBottom: lowest,
      totalsTop: null, packedByBottom: null, footerTop: null, continuedNote: false,
    }

    if (plan.last) {
      // Totals directly under the rows
      let y = lowest - 5
      layout.totalsTop = y
      hline(page, M, M + CW, y, 1.5)
      y -= 11
      text(page, `TOTAL: ${items.length} items`, M, y, bold, 9)
      right(page, `${totalPairs} pairs`, M + CW, y, bold, 9)
      // Footer pinned to the bottom margin
      let fy = M
      for (let i = footer2.length - 1; i >= 0; i--) {
        text(page, footer2[i], M + (CW - width(footer2[i], reg, 6)) / 2, fy, reg, 6)
        fy += 7.5
      }
      text(page, FOOTER_LINE_1, M + (CW - width(FOOTER_LINE_1, reg, 6)) / 2, fy, reg, 6)
      layout.footerTop = fy + 6
      // Packed by: signature line on the left half, well above the footer
      const labelY = layout.footerTop + 10
      text(page, 'Packed by:', M, labelY, reg, 7)
      hline(page, M, M + CW / 2 - 6, labelY + 18, 0.75)
      layout.packedByBottom = labelY
    } else {
      layout.continuedNote = true
      text(page, 'Continued on next label', M + (CW - width('Continued on next label', bold, 7.5)) / 2, M + 10, bold, 7.5)
    }
    if (multi) {
      const lbl = `Label ${pi + 1} of ${plans.length}`
      if (plan.last) right(page, lbl, M + CW, (layout.footerTop ?? M) + 10, reg, 7)
      else text(page, lbl, M + (CW - width(lbl, reg, 7)) / 2, M, reg, 7)
    }
    layouts.push(layout)
  })

  return { bytes: await pdf.save(), pages: layouts }
}

export async function generatePackingSlipPdf(p: SlipParams): Promise<Uint8Array> {
  return (await buildPackingSlip(p)).bytes
}
