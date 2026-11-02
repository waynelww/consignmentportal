// Unit test for the HR rules: work-day parsing, leave-day counting, month
// splitting and leave balances.
// Run: npx tsx scripts/test-hr-rules.ts
import assert from 'node:assert/strict'
import {
  parseWorkDays, countLeaveDays, leaveDaysWithin, leaveBalance, isoWeekday, isYmd, entitlementFor, daysLabel,
  completedYears, statutoryEntitlements, entitlementsFor, replacementBalance,
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

// ── Employment Act minimums from the join date ───────────────────────────
assert.equal(completedYears('2024-03-15', '2026-03-14'), 1)
assert.equal(completedYears('2024-03-15', '2026-03-15'), 2)
assert.equal(completedYears('2026-05-01', '2026-01-01'), 0, 'not joined yet')

// Full year, same tier: exactly 8 / 12 / 16 and 14 / 18 / 22.
assert.deepEqual(statutoryEntitlements('2025-01-01', 2026), { annual: 8, mc: 14 })
assert.deepEqual(statutoryEntitlements('2022-06-01', 2026), { annual: 12, mc: 18 }, '4 years')
assert.deepEqual(statutoryEntitlements('2015-06-01', 2026), { annual: 16, mc: 22 }, '11 years')

// Joining year, pro-rated by completed months: 15 Mar join → Apr..Dec = 9 months × 8/12 = 6.
assert.deepEqual(statutoryEntitlements('2026-03-15', 2026), { annual: 6, mc: 14 })
// 1 Mar join → Mar..Dec = 10 months × 8/12 = 6.67 → 7 (≥ half a day rounds up).
assert.equal(statutoryEntitlements('2026-03-01', 2026).annual, 7)
// 20 Nov join → Dec only = 0.67 → 1. 2 Dec join → no completed month = 0.
assert.equal(statutoryEntitlements('2026-11-20', 2026).annual, 1)
assert.equal(statutoryEntitlements('2026-12-02', 2026).annual, 0)
// Joined after the year: nothing.
assert.deepEqual(statutoryEntitlements('2027-01-05', 2026), { annual: 0, mc: 0 })

// Crossing 2 years mid-year (joined 1 Jul 2024): 2 years are completed on
// 1 Jul 2026, so Jan–Jun are at 8/yr and Jul–Dec at 12/yr:
// 6 × 8/12 + 6 × 12/12 = 4 + 6 = 10. MC is the higher tier reached: 18.
assert.deepEqual(statutoryEntitlements('2024-07-01', 2026), { annual: 10, mc: 18 })
// Crossing 5 years (joined 1 Oct 2021): 9 × 12/12 + 3 × 16/12 = 9 + 4 = 13; MC 22.
assert.deepEqual(statutoryEntitlements('2021-10-01', 2026), { annual: 13, mc: 22 })

// Statutory vs custom.
const base = { annual_leave_days: 20, mc_days: 30 }
assert.deepEqual(entitlementsFor({ ...base, join_date: '2025-01-01', custom_entitlement: false }, 2026), { annual: 8, mc: 14, source: 'statutory' })
assert.deepEqual(entitlementsFor({ ...base, join_date: '2025-01-01', custom_entitlement: true }, 2026), { annual: 20, mc: 30, source: 'custom' })
assert.deepEqual(entitlementsFor({ ...base, join_date: null, custom_entitlement: false }, 2026), { annual: 20, mc: 30, source: 'custom' }, 'no join date yet')

// ── Replacement leave ────────────────────────────────────────────────────
assert.equal(entitlementFor('replacement'), 'replacement')
assert.deepEqual(
  replacementBalance(
    [{ status: 'approved', days_earned: 1 }, { status: 'approved', days_earned: 0.5 }, { status: 'pending', days_earned: 1 }, { status: 'rejected', days_earned: 1 }],
    [
      { leave_type: 'replacement', status: 'approved', days: 1 },
      { leave_type: 'replacement', status: 'pending', days: 0.5 },
      { leave_type: 'replacement', status: 'rejected', days: 1 },
      { leave_type: 'annual', status: 'approved', days: 3 },
    ],
  ),
  { entitled: 1.5, taken: 1, pending: 0.5, remaining: 0 },
)
// Replacement leave does not touch annual or MC balances.
assert.deepEqual(
  leaveBalance('annual', 8, [{ leave_type: 'replacement', status: 'approved', start_date: '2026-03-02', end_date: '2026-03-02', half_day: false }], 2026),
  { entitled: 8, taken: 0, pending: 0, remaining: 8 },
)

console.log('✓ HR rules: all assertions passed')
