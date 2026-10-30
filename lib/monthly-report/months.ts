// Calendar helpers for the monthly report. Pure: no database or server imports,
// so the test script can run them. Months are YYYY-MM strings; days are
// YYYY-MM-DD in Malaysia time, the same day the store owners work in.

const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface MonthRange {
  /** First day, YYYY-MM-DD. */
  start: string
  /** Last day, YYYY-MM-DD. */
  end: string
  /** First day of the following month, YYYY-MM-DD. */
  nextStart: string
}

export function parseYearMonth(ym: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  return month >= 1 && month <= 12 ? { year, month } : null
}

/** Moves a YYYY-MM month by whole months (negative goes back). */
export function shiftMonth(ym: string, delta: number): string {
  const parsed = parseYearMonth(ym)
  if (!parsed) throw new Error(`Invalid month: ${ym}`)
  const d = new Date(Date.UTC(parsed.year, parsed.month - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The month before the Malaysia-time day, e.g. 2026-10-30 → "2026-09". */
export function previousMonthOf(todayYmd: string): string {
  return shiftMonth(todayYmd.slice(0, 7), -1)
}

export function monthRange(ym: string): MonthRange {
  const parsed = parseYearMonth(ym)
  if (!parsed) throw new Error(`Invalid month: ${ym}`)
  const lastDay = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate()
  return {
    start: `${ym}-01`,
    end: `${ym}-${String(lastDay).padStart(2, '0')}`,
    nextStart: `${shiftMonth(ym, 1)}-01`,
  }
}

/** "September 2026" */
export function monthLabel(ym: string): string {
  const { year, month } = parseYearMonth(ym)!
  return `${MONTH_LONG[month - 1]} ${year}`
}

/** "Sep" — for column headers and comparisons. */
export function monthShort(ym: string): string {
  return MONTH_SHORT[parseYearMonth(ym)!.month - 1]
}

/** "Sep2026" — used in file names. */
export function monthFileTag(ym: string): string {
  const { year } = parseYearMonth(ym)!
  return `${monthShort(ym)}${year}`
}

/** "7 Oct 2026" for a YYYY-MM-DD day. */
export function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`
}
