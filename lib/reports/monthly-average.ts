/**
 * "Monthly Average" report: per store, average monthly sales over the last
 * N full calendar months (the current, unfinished month is never counted).
 * Pure maths only; the admin API loads the rows and calls buildMonthlyAverage.
 *
 * A store is averaged only over the months from the month of its first
 * recorded sale onward. The store record has no opening date, and
 * stores.created_at is often weeks before the first sale, so the first sale
 * is the opening marker. The opening month counts as one full month even
 * when the store opened part-way through it.
 */

export const MONTHLY_AVERAGE_OPTIONS = [1, 2, 3, 6, 12] as const
export type MonthlyAverageMonths = (typeof MONTHLY_AVERAGE_OPTIONS)[number]
export const DEFAULT_MONTHLY_AVERAGE_MONTHS: MonthlyAverageMonths = 3

export function isMonthlyAverageMonths(n: unknown): n is MonthlyAverageMonths {
  return (MONTHLY_AVERAGE_OPTIONS as readonly unknown[]).includes(n)
}

export interface MonthlyAverageStore {
  id: string
  store_code: string
  store_name: string
  store_type: string
  state: string
  status: string
}

export interface MonthlyAverageSale {
  store_id: string
  sale_date: string // YYYY-MM-DD
  quantity: number
  total_amount: number
}

export interface MonthlyAverageRow {
  store_id: string
  store_code: string
  store_name: string
  store_type: string
  state: string
  status: string
  open_month: string | null // YYYY-MM of the first recorded sale
  months_counted: number
  avg_rm: number | null // total RM ÷ months counted, 2 dp
  avg_pairs: number | null // pairs ÷ months counted, 1 dp
  total_rm: number // RM over the counted months, 2 dp
  total_pairs: number
  last_month_rm: number // RM in the last full month, 2 dp
  baseline_months: number // months the change is compared against (0 = no comparison)
  baseline_avg_rm: number | null // average RM over those baseline months, 2 dp
  change_pct: number | null // last full month vs baseline_avg_rm, 1 dp; null when there is no baseline or it is 0
}

export interface MonthlyAverageResult {
  window: MonthlyAverageWindow
  rows: MonthlyAverageRow[]
}

export interface MonthlyAverageWindow {
  months: MonthlyAverageMonths
  from: string // first day of the oldest month in the window, YYYY-MM-DD
  to: string // last day of the last full month, YYYY-MM-DD
  month_keys: string[] // YYYY-MM, oldest first
  last_month: string // YYYY-MM
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

/** YYYY-MM for a month offset from another YYYY-MM (negative = earlier). */
export function shiftMonthKey(key: string, offset: number): string {
  const [y, m] = key.split('-').map(Number)
  const idx = y * 12 + (m - 1) + offset
  const ty = Math.floor(idx / 12)
  const tm = idx % 12
  return `${ty}-${String(tm + 1).padStart(2, '0')}`
}

/** The N full calendar months ending the month before `asOf` (YYYY-MM-DD). */
export function monthlyAverageWindow(asOf: string, months: MonthlyAverageMonths): MonthlyAverageWindow {
  const currentKey = asOf.slice(0, 7)
  const lastMonth = shiftMonthKey(currentKey, -1)
  const keys = Array.from({ length: months }, (_, i) => shiftMonthKey(lastMonth, i - (months - 1)))
  const [ly, lm] = lastMonth.split('-').map(Number)
  const lastDay = new Date(Date.UTC(ly, lm, 0)).getUTCDate()
  return {
    months,
    from: `${keys[0]}-01`,
    to: `${lastMonth}-${String(lastDay).padStart(2, '0')}`,
    month_keys: keys,
    last_month: lastMonth,
  }
}

/**
 * One row per store. `includeInactive` is not applied here: every store
 * passed in gets a row, and the page filters by status, so toggling it does
 * not need a new request.
 */
export function buildMonthlyAverage(input: {
  asOf: string
  months: MonthlyAverageMonths
  stores: MonthlyAverageStore[]
  sales: MonthlyAverageSale[]
}): MonthlyAverageResult {
  const win = monthlyAverageWindow(input.asOf, input.months)
  // The window plus the month before it: a 1-month change compares against that month.
  const inWindow = new Set([shiftMonthKey(win.month_keys[0], -1), ...win.month_keys])

  // Earliest sale month for each store, across all sales (not only the window).
  const openMonth = new Map<string, string>()
  for (const s of input.sales) {
    const key = s.sale_date.slice(0, 7)
    const cur = openMonth.get(s.store_id)
    if (!cur || key < cur) openMonth.set(s.store_id, key)
  }

  // Per store: RM and pairs by YYYY-MM, for months in the window only.
  const byStoreMonth = new Map<string, Map<string, { rm: number; pairs: number }>>()
  for (const s of input.sales) {
    const key = s.sale_date.slice(0, 7)
    if (!inWindow.has(key)) continue
    let months = byStoreMonth.get(s.store_id)
    if (!months) {
      months = new Map()
      byStoreMonth.set(s.store_id, months)
    }
    const cell = months.get(key) ?? { rm: 0, pairs: 0 }
    cell.rm += Number(s.total_amount) || 0
    cell.pairs += Number(s.quantity) || 0
    months.set(key, cell)
  }

  const rows: MonthlyAverageRow[] = input.stores.map((store) => {
    const open = openMonth.get(store.id) ?? null
    const counted = open ? win.month_keys.filter((k) => k >= open) : []
    const months = byStoreMonth.get(store.id) ?? new Map<string, { rm: number; pairs: number }>()

    let totalRm = 0
    let totalPairs = 0
    for (const k of counted) {
      const cell = months.get(k)
      if (!cell) continue
      totalRm += cell.rm
      totalPairs += cell.pairs
    }

    const n = counted.length
    const avgRm = n > 0 ? totalRm / n : null
    const lastRm = months.get(win.last_month)?.rm ?? 0

    // Baseline for the change: with 2+ months, the earlier counted months of
    // the period (last month excluded); with 1 month, the month before it.
    // Either way only months the store was open count.
    const earlier = n >= 2
      ? counted.slice(0, -1)
      : (open && shiftMonthKey(win.last_month, -1) >= open ? [shiftMonthKey(win.last_month, -1)] : [])
    const baselineRm = earlier.reduce((a, k) => a + (months.get(k)?.rm ?? 0), 0)
    const baselineAvg = earlier.length > 0 ? baselineRm / earlier.length : null
    const changePct = baselineAvg && baselineAvg > 0 ? ((lastRm - baselineAvg) / baselineAvg) * 100 : null

    return {
      store_id: store.id,
      store_code: store.store_code,
      store_name: store.store_name,
      store_type: store.store_type,
      state: store.state,
      status: store.status,
      open_month: open,
      months_counted: n,
      avg_rm: avgRm === null ? null : round2(avgRm),
      avg_pairs: n > 0 ? round1(totalPairs / n) : null,
      total_rm: round2(totalRm),
      total_pairs: totalPairs,
      last_month_rm: round2(lastRm),
      baseline_months: earlier.length,
      baseline_avg_rm: baselineAvg === null ? null : round2(baselineAvg),
      change_pct: changePct === null ? null : round1(changePct),
    }
  })

  return { window: win, rows }
}
