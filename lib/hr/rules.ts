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
  replacement: 'Replacement leave',
} as const
export type LeaveType = keyof typeof LEAVE_TYPES

export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'paid'
export type LeaveStatus = 'pending' | 'approved' | 'rejected'

/**
 * Which balance a leave type uses. Emergency leave comes out of annual leave;
 * replacement leave out of days earned working rest days / public holidays.
 */
export function entitlementFor(type: LeaveType): 'annual' | 'mc' | 'replacement' | null {
  if (type === 'annual' || type === 'emergency') return 'annual'
  if (type === 'mc') return 'mc'
  if (type === 'replacement') return 'replacement'
  return null
}

// ── Employment Act 1955 minimums ─────────────────────────────────────────
// s.60E annual leave and s.60F paid sick leave (not hospitalisation), by
// completed years of service with the employer.

export const EA_TIERS = [
  { minYears: 5, annual: 16, mc: 22 },
  { minYears: 2, annual: 12, mc: 18 },
  { minYears: 0, annual: 8, mc: 14 },
] as const

function tierFor(years: number) {
  return EA_TIERS.find((t) => years >= t.minYears)!
}

/** A join date staff can enter: a real date, not before 1990, not in the future. */
export function isValidJoinDate(d: unknown, today: string): d is string {
  return isYmd(d) && d >= '1990-01-01' && d <= today
}

/** Completed years of service from joinDate up to and including onDate. */
export function completedYears(joinDate: string, onDate: string): number {
  if (onDate < joinDate) return 0
  const [jy, jm, jd] = joinDate.split('-').map(Number)
  const [oy, om, od] = onDate.split('-').map(Number)
  let years = oy - jy
  if (om < jm || (om === jm && od < jd)) years--
  return Math.max(0, years)
}

/** Last day of a month, YYYY-MM-DD. */
function monthEnd(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0))
  return d.toISOString().slice(0, 10)
}

export interface Entitlements {
  annual: number
  mc: number
  /** Where the numbers came from. */
  source: 'statutory' | 'custom'
}

/**
 * Statutory minimums for a calendar year from the join date.
 *
 * Annual leave: each month of the year counts once it is a completed month of
 * service (a 15 Mar join completes its first month on 14 Apr, so April is the
 * first month counted), at 1/12 of the tier rate for the service completed by
 * the end of that month. The total is rounded as s.60E(1A) says: a fraction
 * of half a day or more counts as a day, less is dropped. A full year in one
 * tier is exactly 8 / 12 / 16.
 *
 * MC: not pro-rated by the Act. The tier is the highest reached in the year.
 */
export function statutoryEntitlements(joinDate: string, year: number): { annual: number; mc: number } {
  const yearEnd = `${year}-12-31`
  if (joinDate > yearEnd) return { annual: 0, mc: 0 }
  const [jy, jm, jd] = joinDate.split('-').map(Number)
  // First month that is a completed month of service.
  let firstY = jy
  let firstM = jd === 1 ? jm : jm + 1
  if (firstM > 12) { firstM = 1; firstY++ }

  let annual = 0
  for (let m = 1; m <= 12; m++) {
    if (year < firstY || (year === firstY && m < firstM)) continue
    annual += tierFor(completedYears(joinDate, monthEnd(year, m))).annual / 12
  }
  const whole = Math.floor(annual + 1e-9)
  const rounded = annual - whole >= 0.5 - 1e-9 ? whole + 1 : whole
  return { annual: rounded, mc: tierFor(completedYears(joinDate, yearEnd)).mc }
}

/** The entitlements that apply to a person for a year: statutory from the join date, unless set by hand. */
export function entitlementsFor(
  member: { join_date: string | null; custom_entitlement: boolean; annual_leave_days: number; mc_days: number },
  year: number,
): Entitlements {
  if (member.join_date && !member.custom_entitlement) {
    return { ...statutoryEntitlements(member.join_date, year), source: 'statutory' }
  }
  return { annual: member.annual_leave_days, mc: member.mc_days, source: 'custom' }
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
 * Replacement leave balance: approved days earned (rest-day / public holiday
 * work) minus replacement leave taken. Not tied to a calendar year.
 */
export function replacementBalance(
  work: { status: LeaveStatus; days_earned: number }[],
  leaves: { leave_type: LeaveType; status: LeaveStatus; days: number }[],
): LeaveBalance {
  const earned = work.filter((w) => w.status === 'approved').reduce((s, w) => s + w.days_earned, 0)
  const mine = leaves.filter((l) => l.leave_type === 'replacement' && l.status !== 'rejected')
  const taken = mine.filter((l) => l.status === 'approved').reduce((s, l) => s + l.days, 0)
  const pending = mine.filter((l) => l.status === 'pending').reduce((s, l) => s + l.days, 0)
  return { entitled: earned, taken, pending, remaining: earned - taken - pending }
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
