// Tests for the daily sales report rules: recipients, the switch rule, the
// 22:00 MYT cutoff, sale-line maths and grouping by recipient, plus a PDF
// smoke test (daily layout and the unchanged invoice layout).
// Run: npx tsx scripts/test-daily-report.ts [outDir]
// With outDir, the generated PDFs are written there for a visual check.
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseRecipient,
  normalizeRecipients,
  validateDailyReportSettings,
  isDateString,
  reportCutoffIso,
  reportDateLabel,
  DAILY_REPORT_MAX_RECIPIENTS,
} from '../lib/daily-report/settings'
import {
  aggregateSaleLines,
  sumTotals,
  groupStoresByRecipient,
  type DailySaleRow,
  type ReportStoreRef,
} from '../lib/daily-report/aggregate'
import { generateStatementPdf } from '../lib/pdf/generate-statement'

const outDir = process.argv[2]
if (outDir) mkdirSync(outDir, { recursive: true })

// ── Recipients ───────────────────────────────────────────────────────────
assert.equal(parseRecipient('  Ops@Xocks.CO '), 'ops@xocks.co')
assert.equal(parseRecipient('not an email'), null)
assert.equal(parseRecipient(''), null)
assert.deepEqual(
  normalizeRecipients(['a@x.co', ' A@x.co ', 'bad', 'b@x.co']),
  ['a@x.co', 'b@x.co'],
  'trimmed, lower-cased, de-duplicated, invalid dropped',
)

// ── Switch rule ──────────────────────────────────────────────────────────
assert.equal(validateDailyReportSettings(false, []), null, 'off with no recipients is fine')
assert.equal(validateDailyReportSettings(true, ['a@x.co']), null, 'on with one recipient is fine')
assert.match(validateDailyReportSettings(true, []) ?? '', /at least one recipient/, 'on with none is refused')
const tooMany = Array.from({ length: DAILY_REPORT_MAX_RECIPIENTS + 1 }, (_, i) => `u${i}@x.co`)
assert.match(validateDailyReportSettings(false, tooMany) ?? '', /Too many/, 'more than the cap is refused')

// ── Dates and the 22:00 MYT cutoff ───────────────────────────────────────
assert.equal(isDateString('2026-10-30'), true)
assert.equal(isDateString('2026-02-30'), false, 'not a real date')
assert.equal(isDateString('30-10-2026'), false)
assert.equal(reportDateLabel('2026-10-30'), '30 October 2026')

// Before 22:00 MYT the cutoff is "now" (test send during the day).
assert.equal(
  reportCutoffIso('2026-10-30', new Date('2026-10-30T10:00:00+08:00')),
  '2026-10-30T02:00:00.000Z',
)
// After 22:00 MYT the cutoff is 22:00 that day, however late the run is.
assert.equal(
  reportCutoffIso('2026-10-30', new Date('2026-10-30T23:40:00+08:00')),
  '2026-10-30T14:00:00.000Z',
)
// Re-running a past day always cuts off at 22:00 that day.
assert.equal(
  reportCutoffIso('2026-10-29', new Date('2026-10-30T09:00:00+08:00')),
  '2026-10-29T14:00:00.000Z',
)

// ── Sale lines and totals ────────────────────────────────────────────────
const sales: DailySaleRow[] = [
  { quantity: 2, unit_price: 25, total_amount: 50, commission_amount: 15, products: { name: 'Plain Crew', sku: 'C1' }, staff: { name: 'Mei' } },
  { quantity: 1, unit_price: 25, total_amount: 25, commission_amount: 7.5, products: { name: 'Plain Crew', sku: 'C1' }, staff: { name: 'Mei' } },
  { quantity: 1, unit_price: 25, total_amount: 25, commission_amount: 7.5, products: { name: 'Plain Crew', sku: 'C1' }, staff: { name: 'Ali' } },
  { quantity: 3, unit_price: 10, total_amount: 30, commission_amount: 9, products: null, staff: null },
]
const lines = aggregateSaleLines(sales)
assert.equal(lines.length, 3, 'one line per SKU and keyed-in staff')
assert.deepEqual(lines[0], {
  productName: 'Plain Crew', sku: 'C1', keyedInBy: 'Mei', unitsSold: 3,
  unitPrice: 25, revenue: 75, commission: 22.5,
})
assert.deepEqual(lines[2], {
  productName: 'Unknown Product', sku: 'UNKNOWN', keyedInBy: '-', unitsSold: 3,
  unitPrice: 10, revenue: 30, commission: 9,
})
const totals = sumTotals(lines)
assert.deepEqual(totals, {
  totalUnits: 7, totalRevenue: 130, totalCommission: 39, xocksRevenue: 91,
}, 'xocks revenue = revenue - commission')
assert.equal(sumTotals(aggregateSaleLines([
  { quantity: 1, unit_price: 0.1, total_amount: 0.1, commission_amount: 0.1, products: null, staff: null },
  { quantity: 1, unit_price: 0.2, total_amount: 0.2, commission_amount: 0.2, products: null, staff: null },
])).totalRevenue, 0.3, 'money sums do not drift')

// ── Grouping by recipient ────────────────────────────────────────────────
const stores: ReportStoreRef[] = [
  { id: 's2', store_code: 'STR-002', store_name: 'Two', daily_report_recipients: ['ops@xocks.co', 'wayne@xocks.co'] },
  { id: 's1', store_code: 'STR-001', store_name: 'One', daily_report_recipients: ['Ops@Xocks.co'] },
  { id: 's3', store_code: 'STR-003', store_name: 'Three', daily_report_recipients: ['ops@xocks.co', 'ops@xocks.co'] },
]
const groups = groupStoresByRecipient(stores)
assert.deepEqual(groups.map((g) => g.to), ['ops@xocks.co', 'wayne@xocks.co'], 'addresses sorted')
assert.deepEqual(
  groups[0].stores.map((s) => s.store_code),
  ['STR-001', 'STR-002', 'STR-003'],
  'one address gets every store that sends to it, sorted by code, each once',
)
assert.deepEqual(groups[1].stores.map((s) => s.store_code), ['STR-002'])
assert.deepEqual(groupStoresByRecipient([]), [])

// ── PDF smoke test: daily layout and the unchanged invoice layout ────────
async function pdfChecks() {
  const commonItems = lines.map((l) => ({ ...l }))
  const dailyPdf = await generateStatementPdf({
    storeName: 'Test Store', storeCode: 'STR-900', picName: 'Pic', periodMonth: 10, periodYear: 2026,
    generatedDate: '30 October 2026', commissionRate: 30, items: commonItems,
    totalUnits: totals.totalUnits, totalRevenue: totals.totalRevenue,
    totalCommission: totals.totalCommission, xocksRevenue: totals.xocksRevenue,
    daily: { salesDate: '30 October 2026' },
  })
  const invoicePdf = await generateStatementPdf({
    storeName: 'Test Store', storeCode: 'STR-900', picName: 'Pic', invoiceNo: 'XCSM-001', periodMonth: 10, periodYear: 2026,
    generatedDate: '01 November 2026', commissionRate: 30, items: commonItems,
    totalUnits: totals.totalUnits, totalRevenue: totals.totalRevenue,
    totalCommission: totals.totalCommission, xocksRevenue: totals.xocksRevenue,
    status: 'pending',
  })
  for (const bytes of [dailyPdf, invoicePdf]) {
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-')
  }
  assert.ok(dailyPdf.length > 1000 && invoicePdf.length > 1000)
  if (outDir) {
    writeFileSync(join(outDir, 'daily-report.pdf'), dailyPdf)
    writeFileSync(join(outDir, 'invoice-check.pdf'), invoicePdf)
  }
}

pdfChecks().then(() => console.log('daily-report: all checks passed'))
