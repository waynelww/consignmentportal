// Server-only: reads the database into the ReportInput that compute.ts turns
// into the report. Test stores are dropped with the shared helper, and every
// store-level read goes through the same in-scope rule the report uses.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '../restock/wayne-api'
import { loadStockSnapshot } from '../restock/low-stock-data'
import { parseLowStockSettings } from '../restock/low-stock'
import { fetchLastSaleDates } from '../sales/last-sale'
import { loadTestStoreIds, isTestStore } from '../stores/test-accounts'
import { monthRange, shiftMonth, parseYearMonth } from './months'
import { monthlyReportSettingKeys, parseMonthlyReportSettings } from './settings'
import {
  createdOnMYT, type RawPeriod, type RawSale, type RawStore, type ReportInput, type StockFigures,
} from './compute'

async function fetchFirstSaleDates(db: SupabaseClient, storeIds: string[]): Promise<Map<string, string>> {
  const results = await Promise.all(storeIds.map(async (id) => {
    const { data } = await db
      .from('sales')
      .select('sale_date')
      .eq('store_id', id)
      .order('sale_date', { ascending: true })
      .limit(1)
      .maybeSingle()
    return [id, (data?.sale_date as string | undefined) ?? null] as const
  }))
  const map = new Map<string, string>()
  for (const [id, date] of results) if (date) map.set(id, date)
  return map
}

export async function loadMonthlyReportInput(db: SupabaseClient, ym: string, today: string): Promise<ReportInput> {
  const cur = monthRange(ym)
  const prev = monthRange(shiftMonth(ym, -1))
  const { year: prevYear } = parseYearMonth(shiftMonth(ym, -1))!

  const { data: settingRows, error: settingsErr } = await db
    .from('settings')
    .select('key, value')
    .in('key', monthlyReportSettingKeys())
  if (settingsErr) throw new Error(settingsErr.message)
  const settings = parseMonthlyReportSettings(settingRows ?? [])

  const stores = await fetchAll<RawStore>((from, to) =>
    db.from('stores')
      .select('id, store_code, store_name, city, store_type, status, created_at, on_stock_plan, opened_by_member_id')
      .order('id')
      .range(from, to))
  const testStoreIds = await loadTestStoreIds(db)

  const types = await fetchAll<{ id: string; value: string; label: string }>((from, to) =>
    db.from('store_types').select('id, value, label').order('id').range(from, to))
  const team = await fetchAll<{ id: string; name: string }>((from, to) =>
    db.from('xocks_team_members').select('id, name').order('id').range(from, to))

  const inScope = stores.filter((s) => s.status === 'active' && !isTestStore(testStoreIds, s.id))
  const inScopeIds = inScope.map((s) => s.id)
  const newIds = inScope
    .filter((s) => {
      const d = createdOnMYT(s.created_at)
      return d >= cur.start && d <= cur.end
    })
    .map((s) => s.id)

  const sales = await fetchAll<RawSale>((from, to) =>
    db.from('sales')
      .select('id, store_id, quantity, total_amount, sale_date')
      .gte('sale_date', prev.start)
      .lte('sale_date', cur.end)
      .order('id')
      .range(from, to))

  const periods = await fetchAll<RawPeriod>((from, to) =>
    db.from('commission_periods')
      .select('id, store_id, period_year, period_month, status, xocks_revenue')
      .gte('period_year', prevYear)
      .order('id')
      .range(from, to))

  // Same stock rule as the daily low-stock email and the restock queue.
  const snapshot = await loadStockSnapshot(db, parseLowStockSettings(settingRows ?? []))
  const stock = new Map<string, StockFigures>()
  for (const s of snapshot) {
    stock.set(s.store_id, {
      onHand: s.summary.on_hand,
      stocked: s.summary.stocked,
      pct: s.summary.pct_of_stocked,
      needsRestock: s.summary.needs_restock,
    })
  }

  const lastSaleDate = await fetchLastSaleDates(db, inScopeIds)
  const firstSaleDate = await fetchFirstSaleDates(db, newIds)

  let starterStock = new Map<string, number>()
  if (newIds.length > 0) {
    const rows = await fetchAll<{ id: string; store_id: string; quantity: number }>((from, to) =>
      db.from('stock_movements')
        .select('id, store_id, quantity')
        .eq('movement_type', 'inbound_initial')
        .in('store_id', newIds)
        .order('id')
        .range(from, to))
    starterStock = new Map()
    for (const r of rows) starterStock.set(r.store_id, (starterStock.get(r.store_id) ?? 0) + Number(r.quantity))
  }

  return {
    ym,
    today,
    settings,
    stores,
    testStoreIds,
    storeTypeLabels: new Map(types.map((t) => [t.value, t.label])),
    teamNames: new Map(team.map((t) => [t.id, t.name])),
    sales,
    periods,
    stock,
    lastSaleDate,
    firstSaleDate,
    starterStock,
  }
}
