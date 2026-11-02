// Unit test for the HR rules: work-day parsing, leave-day counting, month
// splitting and leave balances.
// Run: npx tsx scripts/test-hr-rules.ts
import assert from 'node:assert/strict'
import {
  parseWorkDays, countLeaveDays, leaveDaysWithin, leaveBalance, isoWeekday, isYmd, entitlementFor, daysLabel,
} from '../lib/hr/rules'

// ── Work days setting ────────────────────────────────────────────────────
assert.deepEqual(parseWorkDays('1,2,3,4,5'), [1, 2, 3, 4, 5])
assert.deepEqual(parseWorkDays('6, 1,2,3,4,5,5'), [1, 2, 3, 4, 5, 6], 'sorted, de-duplicated')
assert.deepEqual(parseWorkDays(''), [1, 2, 3, 4, 5], 'blank → Mon–Fri')
assert.deepEqual(parseWorkDays('x,9'), [1, 2, 3, 4, 5], 'invalid → Mon–Fri')

// ── Dates ────────────────────────────────────────────────────────────────
assert.equal(isoWeekday('2026-11-02'), 1, '2 Nov 2026 is a Monday')
assert.equal(isoWeekday('2026-11-08'), 7, '8 Nov 2026 is a Sunday')
assert.ok(isYmd('2026-02-28'))
assert.ok(!isYmd('2026-02-30'))
assert.ok(!isYmd('2026-2-3'))

// ── Counting ─────────────────────────────────────────────────────────────
// Mon 2 Nov – Sun 8 Nov: 5 working days.
assert.equal(countLeaveDays('2026-11-02', '2026-11-08'), 5)
// Saturday is a working day for a 6-day week.
assert.equal(countLeaveDays('2026-11-02', '2026-11-08', { workDays: [1, 2, 3, 4, 5, 6] }), 6)
// A holiday inside the range is skipped.
assert.equal(countLeaveDays('2026-12-21', '2026-12-25', { holidays: new Set(['2026-12-25']) }), 4)
// Weekend-only range = 0.
assert.equal(countLeaveDays('2026-11-07', '2026-11-08'), 0)
// Half day on a working day = 0.5; on a weekend = 0.
assert.equal(countLeaveDays('2026-11-03', '2026-11-03', { halfDay: true }), 0.5)
assert.equal(countLeaveDays('2026-11-07', '2026-11-07', { halfDay: true }), 0)
// End before start = 0.
assert.equal(countLeaveDays('2026-11-05', '2026-11-03'), 0)

// ── Month splitting ──────────────────────────────────────────────────────
// Thu 29 Oct – Tue 3 Nov: 2 days in October (Thu, Fri), 2 in November (Mon, Tue).
const cross = { start_date: '2026-10-29', end_date: '2026-11-03', half_day: false }
assert.equal(leaveDaysWithin(cross, '2026-10-01', '2026-10-31'), 2)
assert.equal(leaveDaysWithin(cross, '2026-11-01', '2026-11-30'), 2)
assert.equal(leaveDaysWithin(cross, '2026-12-01', '2026-12-31'), 0)

// ── Balances ─────────────────────────────────────────────────────────────
assert.equal(entitlementFor('emergency'), 'annual')
assert.equal(entitlementFor('unpaid'), null)
const leaves = [
  { leave_type: 'annual' as const, status: 'approved' as const, start_date: '2026-03-02', end_date: '2026-03-04', half_day: false }, // 3
  { leave_type: 'emergency' as const, status: 'approved' as const, start_date: '2026-04-06', end_date: '2026-04-06', half_day: true }, // 0.5
  { leave_type: 'annual' as const, status: 'pending' as const, start_date: '2026-12-14', end_date: '2026-12-15', half_day: false }, // 2 pending
  { leave_type: 'annual' as const, status: 'rejected' as const, start_date: '2026-05-04', end_date: '2026-05-08', half_day: false }, // ignored
  { leave_type: 'unpaid' as const, status: 'approved' as const, start_date: '2026-06-01', end_date: '2026-06-05', half_day: false }, // no entitlement
  { leave_type: 'mc' as const, status: 'approved' as const, start_date: '2026-07-06', end_date: '2026-07-07', half_day: false }, // 2 MC
  // Crosses into 2027: only the 2026 days count against 2026.
  { leave_type: 'annual' as const, status: 'approved' as const, start_date: '2026-12-31', end_date: '2027-01-01', half_day: false }, // 1 in 2026
]
assert.deepEqual(leaveBalance('annual', 12, leaves, 2026), { entitled: 12, taken: 4.5, pending: 2, remaining: 5.5 })
assert.deepEqual(leaveBalance('mc', 14, leaves, 2026), { entitled: 14, taken: 2, pending: 0, remaining: 12 })
assert.deepEqual(leaveBalance('annual', 12, leaves, 2027), { entitled: 12, taken: 1, pending: 0, remaining: 11 })

assert.equal(daysLabel(1), '1 day')
assert.equal(daysLabel(2.5), '2.5 days')

console.log('✓ HR rules: all assertions passed')
