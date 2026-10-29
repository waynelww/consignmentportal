// "Last sale entered" rules, shared by the admin stores list, the admin
// dashboard and the store-app reminder banner. Pure helpers first, then the
// database readers. No server-only imports, so client pages can use it.
//
// Days are counted in Malaysia time (UTC+8, no DST) because that is the day
// the store owner and Xocks staff are working in.

import type { SupabaseClient } from '@supabase/supabase-js'

export const SALES_REMINDER_SETTING_KEY = 'sales_reminder_days'
export const SALES_REMINDER_DEFAULT_DAYS = 7

// Colour bands for "last sale entered" age. Fixed by the ops rule; the
// store reminder threshold is the editable setting above.
export const SALE_AMBER_FROM_DAYS = 7 // 7–14 days → amber
export const SALE_RED_AFTER_DAYS = 14 // over 14 days → red

export type SaleAgeTone = 'green' | 'amber' | 'red'

/** Today's date in Malaysia time as YYYY-MM-DD. */
export function todayMYT(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(now)
}

/** First day of the Malaysia-time month containing `today`, as YYYY-MM-DD. */
export function monthStartMYT(today: string = todayMYT()): string {
  return `${today.slice(0, 8)}01`
}

/** Whole calendar days from one YYYY-MM-DD date to another (to − from). */
export function daysBetween(fromDate: string, toDate: string): number {
  const ms = Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

export function saleAgeTone(days: number): SaleAgeTone {
  if (days < SALE_AMBER_FROM_DAYS) return 'green'
  if (days <= SALE_RED_AFTER_DAYS) return 'amber'
  return 'red'
}

/**
 * Reads the reminder threshold from the settings rows. Missing or invalid
 * values fall back to the default, so the banner still works before the
 * setting has ever been saved.
 */
export function parseReminderDays(rows: { key: string; value: string }[]): number {
  const raw = rows.find((r) => r.key === SALES_REMINDER_SETTING_KEY)?.value?.trim() ?? ''
  if (!/^\d+$/.test(raw)) return SALES_REMINDER_DEFAULT_DAYS
  const n = Number(raw)
  return n >= 1 && n <= 365 ? n : SALES_REMINDER_DEFAULT_DAYS
}

export async function loadSalesReminderDays(db: SupabaseClient): Promise<number> {
  const { data } = await db.from('settings').select('key, value').eq('key', SALES_REMINDER_SETTING_KEY)
  return parseReminderDays(data ?? [])
}

/**
 * Latest sale_date for each store, keyed by store id (YYYY-MM-DD).
 * One index-backed query per store: a single query over all sales would be
 * cut off at PostgREST's 1,000-row limit and silently show old stores as
 * having no sales.
 */
export async function fetchLastSaleDates(db: SupabaseClient, storeIds: string[]): Promise<Map<string, string>> {
  const results = await Promise.all(
    storeIds.map(async (id) => {
      const { data } = await db
        .from('sales')
        .select('sale_date')
        .eq('store_id', id)
        .order('sale_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      return [id, (data?.sale_date as string | undefined) ?? null] as const
    })
  )
  const map = new Map<string, string>()
  for (const [id, date] of results) if (date) map.set(id, date)
  return map
}

export interface SaleAge {
  /** Days since the last sale, or since the store was opened if it has never sold. */
  days: number
  tone: SaleAgeTone
  /** True when the store has no recorded sale yet; `days` then counts from opening. */
  neverSold: boolean
}

/**
 * Age of a store's sales record. A store with no sales yet is measured from
 * the day it was opened, so a brand-new store is not flagged on day one.
 */
export function storeSaleAge(
  lastSaleDate: string | null | undefined,
  openedAt: string | null | undefined,
  today: string = todayMYT()
): SaleAge | null {
  const reference = lastSaleDate ?? (openedAt ? todayMYT(new Date(openedAt)) : null)
  if (!reference) return null
  const days = Math.max(0, daysBetween(reference, today))
  return { days, tone: saleAgeTone(days), neverSold: !lastSaleDate }
}
