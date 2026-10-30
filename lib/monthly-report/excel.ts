// The monthly report workbook: Summary, Existing Stores, New Stores, Stores by
// Sales (the three lists with store category) and Watch List. Built from the
// same MonthlyReport as the PDF, so the two files cannot disagree.

import * as XLSX from 'xlsx'
import { dayLabel } from './months'
import type { MonthlyReport } from './compute'

type Cell = string | number | null

function sheet(rows: Cell[][], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = widths.map((wch) => ({ wch }))
  return ws
}

function summarySheet(r: MonthlyReport): XLSX.WorkSheet {
  const h = r.headline
  const rows: Cell[][] = [
    [`XCMS Monthly Report — ${r.monthLabel}`],
    [`Sales = ${r.periodLabel}. Compared with ${r.prevMonthLabel}. Generated ${dayLabel(r.today)}.`],
    [],
    ['Headline numbers', 'This month', `${r.prevMonthShort} (prior month)`, 'Change'],
    ['Active stores', h.activeStores.value, h.activeStores.prev, h.activeStores.value - h.activeStores.prev],
    ['New stores', h.newStores.value, h.newStores.prev, h.newStores.value - h.newStores.prev],
    ['Total sales (RM)', h.sales.value, h.sales.prev, Number((h.sales.value - h.sales.prev).toFixed(2))],
    ['Pairs sold', h.pairs.value, h.pairs.prev, h.pairs.value - h.pairs.prev],
    ['Xocks revenue (RM)', h.xocksRevenue.value, h.xocksRevenue.prev, Number((h.xocksRevenue.value - h.xocksRevenue.prev).toFixed(2))],
    [],
    ['Invoices', 'Count'],
    ['Paid', h.invoicesPaid],
    ['Pending', h.invoicesPending],
    [`Still to collect by ${r.paymentDueLabel} (RM)`, h.pendingRm],
    [],
    ['Stores by sales', 'Stores', 'Total sales (RM)'],
    ...r.bands.map((b) => [b.label, b.stores.length, b.total]),
    [],
    ['Sales by store category', 'Stores', 'Total sales (RM)', 'Average per store (RM)'],
    ...r.categories.map((c) => [c.label, c.stores, c.total, c.average]),
    [],
    ['Action plan', 'Stores'],
    ...r.actions.map((a) => [`${a.badge} — ${a.title}`, a.rows.length]),
  ]
  return sheet(rows, [58, 16, 22, 26])
}

function existingStoresSheet(r: MonthlyReport): XLSX.WorkSheet {
  const header = [
    'Code', 'Store', 'Category', 'City', 'Sales band', 'Sales (RM)', 'Pairs sold', '4-month plan',
    'Stock on hand', 'Stock stocked', 'Stock %', 'Needs restock', 'Last sale entered', 'Days since last sale',
  ]
  const band = (key: string) => r.bands.find((b) => b.key === key)!.label
  const rows: Cell[][] = r.stores.map((s) => [
    s.code, s.name, s.category, s.city, band(s.band), s.sales, s.pairs, s.onPlan ? 'Yes' : 'No',
    s.stock?.onHand ?? null, s.stock?.stocked ?? null, s.stock?.pct ?? null, s.stock?.needsRestock ? 'Yes' : 'No',
    s.lastSaleDate ?? 'Never', s.daysSinceSale,
  ])
  return sheet([header, ...rows], [11, 30, 18, 15, 18, 12, 11, 12, 13, 13, 9, 13, 16, 18])
}

function newStoresSheet(r: MonthlyReport): XLSX.WorkSheet {
  const header = ['Code', 'Store', 'Category', 'City', 'Date opened', 'Opened by', 'Starter stock (pairs)', 'First sale', 'Sales this month (RM)']
  const rows: Cell[][] = r.newStores.map((n) => [
    n.code, n.name, n.category, n.city, n.openedOn, n.openedBy ?? 'Not recorded', n.starterStock,
    n.firstSaleDate ?? 'No sale yet', n.sales,
  ])
  return sheet(rows.length ? [header, ...rows] : [header, ['No new stores this month']], [11, 30, 18, 15, 13, 20, 20, 16, 20])
}

function storesBySalesSheet(r: MonthlyReport): XLSX.WorkSheet {
  const rows: Cell[][] = []
  for (const b of r.bands) {
    rows.push([b.label, `${b.stores.length} stores`, null, null, null, null])
    rows.push(['Code', 'Store', 'Category', 'City', 'Sales (RM)', '4-month plan'])
    for (const s of b.stores) rows.push([s.code, s.name, s.category, s.city, s.sales, s.onPlan ? 'Yes' : ''])
    if (b.stores.length === 0) rows.push(['No stores in this list.'])
    rows.push([])
  }
  return sheet(rows, [26, 30, 18, 15, 13, 14])
}

function watchSheet(r: MonthlyReport): XLSX.WorkSheet {
  const header = ['Code', 'Store', 'Category', 'City', 'Sales (RM)', 'Sales band', 'Why it is on the watch list']
  const band = (key: string) => r.bands.find((b) => b.key === key)!.label
  const rows: Cell[][] = r.watch.map((w) => [w.code, w.name, w.category, w.city, w.sales, band(w.band), w.reasons.join('; ')])
  return sheet(rows.length ? [header, ...rows] : [header, ['No stores on the watch list this month']], [11, 30, 18, 15, 12, 18, 80])
}

export function buildMonthlyReportWorkbook(r: MonthlyReport): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, summarySheet(r), 'Summary')
  XLSX.utils.book_append_sheet(wb, existingStoresSheet(r), 'Existing Stores')
  XLSX.utils.book_append_sheet(wb, newStoresSheet(r), 'New Stores')
  XLSX.utils.book_append_sheet(wb, storesBySalesSheet(r), 'Stores by Sales')
  XLSX.utils.book_append_sheet(wb, watchSheet(r), 'Watch List')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
