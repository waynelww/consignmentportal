// Unit test for the "last sale entered" rules: colour bands, Malaysia-time
// day counting, reminder setting parsing and never-sold stores.
// Run: npx tsx scripts/test-last-sale.ts
import assert from 'node:assert/strict'
import {
  todayMYT, monthStartMYT, daysBetween, saleAgeTone, parseReminderDays, storeSaleAge,
  SALES_REMINDER_DEFAULT_DAYS,
} from '../lib/sales/last-sale'

// ── Malaysia-time day ────────────────────────────────────────────────────
// 17:00 UTC on 28 Oct is 01:00 on 29 Oct in KL.
assert.equal(todayMYT(new Date('2026-10-28T17:00:00Z')), '2026-10-29')
assert.equal(todayMYT(new Date('2026-10-28T15:59:00Z')), '2026-10-28')

// The month is the Malaysia month: 30 Sep 17:00 UTC is already 1 Oct in KL.
assert.equal(monthStartMYT('2026-10-29'), '2026-10-01')
assert.equal(monthStartMYT('2026-10-01'), '2026-10-01')
assert.equal(monthStartMYT(todayMYT(new Date('2026-09-30T17:00:00Z'))), '2026-10-01', 'KL midnight rolls the month')

// ── Day counting ─────────────────────────────────────────────────────────
assert.equal(daysBetween('2026-10-22', '2026-10-29'), 7)
assert.equal(daysBetween('2026-10-29', '2026-10-29'), 0)
assert.equal(daysBetween('2026-02-27', '2026-03-01'), 2, 'crosses a short month')

// ── Colour bands: green under 7, amber 7–14, red over 14 ─────────────────
assert.equal(saleAgeTone(0), 'green')
assert.equal(saleAgeTone(6), 'green')
assert.equal(saleAgeTone(7), 'amber')
assert.equal(saleAgeTone(14), 'amber')
assert.equal(saleAgeTone(15), 'red')

// ── Reminder setting ─────────────────────────────────────────────────────
assert.equal(SALES_REMINDER_DEFAULT_DAYS, 7)
assert.equal(parseReminderDays([]), 7, 'missing row falls back to 7')
assert.equal(parseReminderDays([{ key: 'sales_reminder_days', value: '10' }]), 10)
assert.equal(parseReminderDays([{ key: 'sales_reminder_days', value: ' 5 ' }]), 5)
assert.equal(parseReminderDays([{ key: 'sales_reminder_days', value: '' }]), 7, 'blank falls back')
assert.equal(parseReminderDays([{ key: 'sales_reminder_days', value: '0' }]), 7, 'zero falls back')
assert.equal(parseReminderDays([{ key: 'sales_reminder_days', value: '400' }]), 7, 'above 365 falls back')
assert.equal(parseReminderDays([{ key: 'sales_reminder_days', value: '3.5' }]), 7, 'non-integer falls back')
assert.equal(parseReminderDays([{ key: 'low_stock_pct', value: '10' }]), 7, 'other keys ignored')

// ── Store age ────────────────────────────────────────────────────────────
const today = '2026-10-29'
assert.deepEqual(storeSaleAge('2026-10-26', null, today), { days: 3, tone: 'green', neverSold: false })
assert.deepEqual(storeSaleAge('2026-10-15', null, today), { days: 14, tone: 'amber', neverSold: false })
assert.deepEqual(storeSaleAge('2026-10-14', null, today), { days: 15, tone: 'red', neverSold: false })
// Never sold: counted from the opening day in Malaysia time.
// 27 Oct 20:00 UTC is 28 Oct 04:00 in KL.
assert.deepEqual(storeSaleAge(null, '2026-10-27T20:00:00Z', today), { days: 1, tone: 'green', neverSold: true })
assert.deepEqual(storeSaleAge(null, '2026-10-01T00:00:00Z', today), { days: 28, tone: 'red', neverSold: true })
assert.equal(storeSaleAge(null, null, today), null, 'no sale and no opening date gives no age')

console.log('test-last-sale: all assertions passed')
