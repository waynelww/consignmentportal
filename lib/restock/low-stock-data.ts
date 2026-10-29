// Server-side loaders for the low-stock rule (see low-stock.ts for the rule).
// Used by the daily summary cron, the plan recalculation and the admin routes.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { allocateByShare } from './wayne-calc'
import { fetchAll, runWayneCalc } from './wayne-api'
import { loadLowStockSettings } from './low-stock-settings'
import {
  storeStockSummary, codeStatus, stockedLevel, lowThreshold,
  type LowStockSettings, type StockRowFields, type StockStatus, type StockStoreFields, type StoreStockSummary,
} from './low-stock'

const CHUNK = 25

async function inChunks<T>(items: T[], fn: (item: T) => PromiseLike<unknown>) {
  for (let i = 0; i < items.length; i += CHUNK) {
    await Promise.all(items.slice(i, i + CHUNK).map(fn))
  }
}

export interface PlanRecalcResult {
  stores_calculated: number
  plan_stores: number
  codes_written: number
}

/**
 * Recalculate the 4-month plan for active stores (all, or the given ids).
 * Each store's average monthly RM sales over the plan window decides whether
 * it is on the plan. Plan stores get plan_level per carried code: the
 * 4-month quantity from wayne-calc split by sales share, minimum 1 pair per
 * code so a carried code never drops out of the low-stock check.
 */
export async function recalcStockPlan(opts: { storeIds?: string[]; db?: SupabaseClient } = {}): Promise<PlanRecalcResult> {
  const db = opts.db ?? (await createServiceClient())
  const settings = await loadLowStockSettings(db)
  const run = await runWayneCalc({ months: settings.planAvgMonths, storeIds: opts.storeIds, db })
  const now = new Date().toISOString()
  let planStores = 0
  let codesWritten = 0

  for (const r of run.stores) {
    const onPlan = r.avg_monthly_sales !== null
      && r.avg_monthly_sales >= settings.planMinMonthlySales
      && r.target_stock !== null
    const rows = await fetchAll<{ id: string; product_id: string }>((from, to) =>
      db.from('store_inventory').select('id, product_id').eq('store_id', r.store_id).order('id').range(from, to))

    const levels = onPlan
      ? allocateByShare(r.target_stock ?? 0, new Map(r.skus.map((s) => [s.product_id, s.pairs_sold])), rows.map((x) => x.product_id))
      : new Map<string, number>()

    const { error: storeErr } = await db.from('stores').update({
      on_stock_plan: onPlan,
      avg_monthly_sales: r.avg_monthly_sales,
      plan_updated_at: now,
    }).eq('id', r.store_id)
    if (storeErr) throw new Error(`plan update failed for ${r.store_code}: ${storeErr.message}`)

    await inChunks(rows, async (row) => {
      const { error } = await db.from('store_inventory').update({
        plan_level: onPlan ? Math.max(1, levels.get(row.product_id) ?? 0) : null,
        plan_level_updated_at: now,
      }).eq('id', row.id)
      if (error) throw new Error(`plan level update failed: ${error.message}`)
    })

    if (onPlan) planStores += 1
    codesWritten += rows.length
  }

  return { stores_calculated: run.stores.length, plan_stores: planStores, codes_written: codesWritten }
}

export interface SnapshotCode {
  product_id: string
  sku: string | null
  name: string | null
  on_hand: number
  stocked: number
  threshold: number
  status: StockStatus
}

export interface SnapshotStore {
  store_id: string
  store_code: string
  store_name: string
  on_stock_plan: boolean
  summary: StoreStockSummary
  codes: SnapshotCode[] // low and out codes only, worst first
}

/** Every active store with its low and out codes, worst stores first. */
export async function loadStockSnapshot(db: SupabaseClient, settings: LowStockSettings): Promise<SnapshotStore[]> {
  const { data: stores, error } = await db
    .from('stores')
    .select('id, store_code, store_name, pairs_per_code, on_stock_plan')
    .eq('status', 'active')
  if (error) throw new Error(error.message)

  const storeById = new Map((stores ?? []).map((s) => [s.id as string, s as { id: string; store_code: string; store_name: string } & StockStoreFields]))

  const inv = await fetchAll<{
    store_id: string; product_id: string; quantity_on_hand: number; stocked_level: number | null; plan_level: number | null
    products: { sku: string | null; name: string | null } | { sku: string | null; name: string | null }[] | null
  }>((from, to) =>
    db.from('store_inventory')
      .select('id, store_id, product_id, quantity_on_hand, stocked_level, plan_level, products:product_id(sku, name)')
      .order('id')
      .range(from, to))

  const byStore = new Map<string, typeof inv>()
  for (const row of inv) {
    if (!storeById.has(row.store_id)) continue
    byStore.set(row.store_id, [...(byStore.get(row.store_id) ?? []), row])
  }

  const out: SnapshotStore[] = []
  for (const [storeId, rows] of byStore) {
    const store = storeById.get(storeId)!
    const summary = storeStockSummary(rows, store, settings.pct)
    const codes: SnapshotCode[] = []
    for (const r of rows) {
      const level = stockedLevel(r as StockRowFields, store)
      const status = codeStatus(r.quantity_on_hand, level, settings.pct)
      if (status === 'in_stock') continue
      const p = Array.isArray(r.products) ? r.products[0] : r.products
      codes.push({
        product_id: r.product_id,
        sku: p?.sku ?? null,
        name: p?.name ?? null,
        on_hand: r.quantity_on_hand,
        stocked: level,
        threshold: lowThreshold(level, settings.pct),
        status,
      })
    }
    codes.sort((a, b) => a.on_hand - b.on_hand || (a.sku ?? '').localeCompare(b.sku ?? ''))
    out.push({
      store_id: store.id,
      store_code: store.store_code,
      store_name: store.store_name,
      on_stock_plan: store.on_stock_plan,
      summary,
      codes,
    })
  }

  out.sort((a, b) => {
    const pa = a.summary.pct_of_stocked ?? 100
    const pb = b.summary.pct_of_stocked ?? 100
    return pa - pb || a.store_code.localeCompare(b.store_code)
  })
  return out
}
