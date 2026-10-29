// Low-stock rule: the single source of truth for the dashboard card, the
// post-sale alert, the store inventory page, the restock queue, the daily
// summary email and the bot API. Pure functions only; loaders live in
// low-stock-data.ts and the 4-month plan maths in wayne-calc.ts.
//
// Stocked level of a code:
//   - store on the 4-month plan (avg monthly sales >= plan minimum):
//       store_inventory.plan_level (read-only for admins)
//   - otherwise: store_inventory.stocked_level (admin override, source 'manual')
//       if set, else stores.pairs_per_code
// Code is low when 0 < on hand <= max(1, stocked × low_stock_pct / 100); out at 0.
// Store needs restock when total on hand < low_stock_pct% of total stocked.

import { isPeriodMonths, type PeriodMonths } from './wayne-calc'

export const LOW_STOCK_SETTING_KEYS = {
  pct: 'low_stock_pct',
  planMinMonthlySales: 'restock_plan_min_monthly_sales',
  planAvgMonths: 'restock_plan_avg_months',
  alertEmail: 'low_stock_alert_email',
} as const

export interface LowStockSettings {
  pct: number // 0–100
  planMinMonthlySales: number // RM
  planAvgMonths: PeriodMonths
  alertEmail: string
}

export const DEFAULT_LOW_STOCK_SETTINGS: LowStockSettings = {
  pct: 50,
  planMinMonthlySales: 250,
  planAvgMonths: 3,
  alertEmail: 'vaernandbk@gmail.com',
}

export const DEFAULT_PAIRS_PER_CODE = 3

export function parseLowStockSettings(rows: { key: string; value: string | null }[]): LowStockSettings {
  const byKey = new Map(rows.map((r) => [r.key, r.value]))
  const num = (key: string, fallback: number) => {
    const raw = byKey.get(key)
    const v = raw === undefined || raw === null || raw === '' ? NaN : Number(raw)
    return Number.isFinite(v) && v >= 0 ? v : fallback
  }
  const months = num(LOW_STOCK_SETTING_KEYS.planAvgMonths, DEFAULT_LOW_STOCK_SETTINGS.planAvgMonths)
  const email = byKey.get(LOW_STOCK_SETTING_KEYS.alertEmail)?.trim()
  return {
    pct: Math.min(100, num(LOW_STOCK_SETTING_KEYS.pct, DEFAULT_LOW_STOCK_SETTINGS.pct)),
    planMinMonthlySales: num(LOW_STOCK_SETTING_KEYS.planMinMonthlySales, DEFAULT_LOW_STOCK_SETTINGS.planMinMonthlySales),
    planAvgMonths: isPeriodMonths(months) ? months : DEFAULT_LOW_STOCK_SETTINGS.planAvgMonths,
    alertEmail: email || DEFAULT_LOW_STOCK_SETTINGS.alertEmail,
  }
}

export interface StockStoreFields {
  pairs_per_code: number
  on_stock_plan: boolean
}

export interface StockRowFields {
  quantity_on_hand: number
  stocked_level: number | null
  plan_level: number | null
}

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock'

/** PostgREST returns many-to-one embeds as an object (or occasionally a one-item array). */
export function embedded<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

export function stockedLevel(row: StockRowFields, store: StockStoreFields): number {
  if (store.on_stock_plan) return row.plan_level ?? 0
  return row.stocked_level ?? store.pairs_per_code
}

export function lowThreshold(stocked: number, pct: number): number {
  return Math.max(1, (stocked * pct) / 100)
}

export function codeStatus(onHand: number, stocked: number, pct: number): StockStatus {
  if (onHand <= 0) return 'out_of_stock'
  return onHand <= lowThreshold(stocked, pct) ? 'low_stock' : 'in_stock'
}

export interface StoreStockSummary {
  on_hand: number
  stocked: number
  pct_of_stocked: number | null // null when nothing is stocked
  needs_restock: boolean
  low_codes: number
  out_codes: number
}

export function storeStockSummary(rows: StockRowFields[], store: StockStoreFields, pct: number): StoreStockSummary {
  let on_hand = 0
  let stocked = 0
  let low_codes = 0
  let out_codes = 0
  for (const r of rows) {
    const level = stockedLevel(r, store)
    on_hand += r.quantity_on_hand
    stocked += level
    const st = codeStatus(r.quantity_on_hand, level, pct)
    if (st === 'low_stock') low_codes += 1
    if (st === 'out_of_stock') out_codes += 1
  }
  return {
    on_hand,
    stocked,
    pct_of_stocked: stocked > 0 ? Math.round((on_hand / stocked) * 100) : null,
    needs_restock: stocked > 0 && on_hand < (stocked * pct) / 100,
    low_codes,
    out_codes,
  }
}

/** "X of Y pairs (Z%)" */
export function formatStoreStock(s: Pick<StoreStockSummary, 'on_hand' | 'stocked' | 'pct_of_stocked'>): string {
  return `${s.on_hand} of ${s.stocked} pairs (${s.pct_of_stocked ?? 0}%)`
}

/** Stocked level, low threshold and status of one code, in one call. */
export function describeCode(row: StockRowFields, store: StockStoreFields, pct: number): {
  stocked: number
  threshold: number
  status: StockStatus
} {
  const stocked = stockedLevel(row, store)
  return { stocked, threshold: lowThreshold(stocked, pct), status: codeStatus(row.quantity_on_hand, stocked, pct) }
}
