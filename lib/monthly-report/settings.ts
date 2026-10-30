// Settings the monthly report reads. Rows live in public.settings; missing or
// invalid values fall back to the defaults below, so the report still renders
// before the rows are seeded. The recipient has no default on purpose: the
// cron refuses to send without it.

import { LOW_STOCK_SETTING_KEYS, parseLowStockSettings } from '../restock/low-stock'
import { SALES_REMINDER_SETTING_KEY, parseReminderDays } from '../sales/last-sale'

export const MONTHLY_REPORT_SETTING_KEYS = {
  email: 'monthly_report_email',
  bandHigh: 'monthly_report_band_high',
  bandMid: 'monthly_report_band_mid',
} as const

export const MONTHLY_REPORT_DEFAULT_BANDS = { high: 250, mid: 100 } as const

/** Recipient of "Send test report" in admin Settings. The monthly cron uses the settings row. */
export const TEST_REPORT_RECIPIENT = 'info@xocks.co'

export interface MonthlyReportSettings {
  /** Recipient of the monthly email, or null when the setting is blank. */
  email: string | null
  /** RM at or above this is the green band ("RM250 and above"). */
  bandHigh: number
  /** RM at or above this (and below bandHigh) is the amber band. Below it is red. */
  bandMid: number
  /** Restock threshold, shared with the low-stock rule. */
  lowStockPct: number
  /** Days without a sale entered before a store is flagged "chase them". */
  reminderDays: number
}

export function monthlyReportSettingKeys(): string[] {
  return [
    ...Object.values(MONTHLY_REPORT_SETTING_KEYS),
    ...Object.values(LOW_STOCK_SETTING_KEYS),
    SALES_REMINDER_SETTING_KEY,
  ]
}

export function parseMonthlyReportSettings(rows: { key: string; value: string | null }[]): MonthlyReportSettings {
  const byKey = new Map(rows.map((r) => [r.key, r.value]))
  const money = (key: string): number | null => {
    const raw = byKey.get(key)?.trim()
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  let bandHigh = money(MONTHLY_REPORT_SETTING_KEYS.bandHigh) ?? MONTHLY_REPORT_DEFAULT_BANDS.high
  let bandMid = money(MONTHLY_REPORT_SETTING_KEYS.bandMid) ?? MONTHLY_REPORT_DEFAULT_BANDS.mid
  // The amber band needs room between the two edges; otherwise use the defaults.
  if (bandMid >= bandHigh) {
    bandHigh = MONTHLY_REPORT_DEFAULT_BANDS.high
    bandMid = MONTHLY_REPORT_DEFAULT_BANDS.mid
  }

  return {
    email: byKey.get(MONTHLY_REPORT_SETTING_KEYS.email)?.trim() || null,
    bandHigh,
    bandMid,
    lowStockPct: parseLowStockSettings(rows).pct,
    reminderDays: parseReminderDays(rows.map((r) => ({ key: r.key, value: r.value ?? '' }))),
  }
}

/** Band names as shown in the report, e.g. "RM250 and above", "RM100 – RM249", "Below RM100". */
export function bandLabels(s: Pick<MonthlyReportSettings, 'bandHigh' | 'bandMid'>) {
  return {
    high: `RM${s.bandHigh} and above`,
    mid: `RM${s.bandMid} – RM${s.bandHigh - 1}`,
    low: `Below RM${s.bandMid}`,
  }
}
