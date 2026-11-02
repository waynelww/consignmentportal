// HR rules: labels, leave-day counting and balances. Pure: no database or
// server imports, so scripts/test-hr-rules.ts can run them. Dates are
// YYYY-MM-DD strings in Malaysia time.

export const CLAIM_CATEGORIES = {
  transport: 'Transport / mileage',
  parking_toll: 'Parking & toll',
  meals: 'Meals',
  supplies: 'Office supplies',
  event: 'Event expenses',
  other: 'Other',
} as const
export type ClaimCategory = keyof typeof CLAIM_CATEGORIES

export const LEAVE_TYPES = {
  annual: 'Annual leave',
  emergency: 'Emergency leave',
  unpaid: 'Unpaid leave',
  mc: 'MC (sick leave)',
} as const
export type LeaveType = keyof typeof LEAVE_TYPES

export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'paid'
export type LeaveStatus = 'pending' | 'approved' | 'rejected'

/** Which yearly entitlement a leave type uses. Emergency leave comes out of annual leave. */
export function entitlementFor(type: LeaveType): 'annual' | 'mc' | null {
  if (type === 'annual' || type === 'emergency') return 'annual'
  if (type === 'mc') return 'mc'
  return null
}

export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]

/** "1,2,3,4,5" → [1,2,3,4,5] (ISO weekdays, Mon = 1). Blank or invalid → Mon–Fri. */
export function parseWorkDays(raw: string | null | undefined): number[] {
  const days = (raw ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
  const unique = [...new Set(days)].sort()
  return unique.length > 0 ? unique : DEFAULT_WORK_DAYS
}

export function isYmd(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** ISO weekday of a YYYY-MM-DD date: Mon = 1 … Sun = 7. */
export function isoWeekday(ymd: string): number {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay()
  return dow === 0 ? 7 : dow
}

/**
 * Working days from start to end inclusive: days that are work days and not
 * public holidays. A half day counts 0.5 (only when it falls on a working day).
 */
export function countLeaveDays(
  start: string,
  end: string,
  opts: { halfDay?: boolean; workDays?: number[]; holidays?: Set<string> } = {},
): number {
  if (end < start) return 0
  const workDays = new Set(opts.workDays ?? DEFAULT_WORK_DAYS)
  const holidays = opts.holidays ?? new Set<string>()
  let n = 0
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (workDays.has(isoWeekday(d)) && !holidays.has(d)) n++
  }
  return opts.halfDay ? Math.min(n, 0.5) : n
}

/**
 * The days of a leave that fall inside [from, to]. Recounted from the dates
 * so a leave crossing a month end is split between the two months.
 */
export function leaveDaysWithin(
  leave: { start_date: string; end_date: string; half_day: boolean },
  from: string,
  to: string,
  opts: { workDays?: number[]; holidays?: Set<string> } = {},
): number {
  const s = leave.start_date > from ? leave.start_date : from
  const e = leave.end_date < to ? leave.end_date : to
  if (e < s) return 0
  return countLeaveDays(s, e, { ...opts, halfDay: leave.half_day })
}

export interface LeaveBalance {
  entitled: number
  taken: number
  pending: number
  /** entitled − taken − pending: what is left if every pending request is approved. */
  remaining: number
}

/**
 * Balance of one entitlement for the calendar year of `year`, from the
 * person's leaves. Approved leaves count as taken, pending as pending;
 * rejected leaves are ignored. Only days inside that year count.
 */
export function leaveBalance(
  kind: 'annual' | 'mc',
  entitled: number,
  leaves: { leave_type: LeaveType; status: LeaveStatus; start_date: string; end_date: string; half_day: boolean }[],
  year: number,
  opts: { workDays?: number[]; holidays?: Set<string> } = {},
): LeaveBalance {
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  let taken = 0
  let pending = 0
  for (const l of leaves) {
    if (entitlementFor(l.leave_type) !== kind || l.status === 'rejected') continue
    const days = leaveDaysWithin(l, from, to, opts)
    if (l.status === 'approved') taken += days
    else pending += days
  }
  return { entitled, taken, pending, remaining: entitled - taken - pending }
}

/** RM with two decimals: "RM 12.50". */
export function rm(n: number): string {
  return `RM ${n.toFixed(2)}`
}

/** Days for display: 1 → "1 day", 2.5 → "2.5 days". */
export function daysLabel(n: number): string {
  const v = Number.isInteger(n) ? String(n) : n.toFixed(1)
  return `${v} day${n === 1 ? '' : 's'}`
}
