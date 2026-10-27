import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  calcStore, defaultEndMonth, malaysiaToday, parseWayneSettings, periodFor,
  WAYNE_SETTING_KEYS, type CalcProduct, type CalcSale, type WayneResult, type WayneSettings,
} from '@/lib/restock/wayne-calc'

// Shared loaders for the Restock Calculator routes (admin + bot). All maths
// lives in lib/restock/wayne-calc.ts; this file only fetches inputs.

/** super_admin + ops_manager only, checked server-side. */
export async function requireRestockCalcAccess() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { supabase, user, profile: profile as { role: string; full_name: string | null } }
}

export async function loadWayneSettings(db: SupabaseClient): Promise<WayneSettings> {
  const { data } = await db.from('settings').select('key, value').in('key', Object.values(WAYNE_SETTING_KEYS))
  return parseWayneSettings(data ?? [])
}

// PostgREST caps responses (1000 rows by default) — page through.
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const size = 1000
  const out: T[] = []
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < size) return out
  }
}

export interface CalcRun {
  today: string
  end_month: string
  period: ReturnType<typeof periodFor>
  settings: WayneSettings
  stores: WayneResult[]
}

/**
 * Calculate for every active store (or just the given ones).
 * `endMonth` defaults to the last complete month in Malaysia time.
 */
export async function runWayneCalc(opts: { endMonth?: string | null; storeIds?: string[]; storeCodes?: string[]; db?: SupabaseClient } = {}): Promise<CalcRun> {
  const db = opts.db ?? (await createServiceClient())
  const today = malaysiaToday()
  const endMonth = opts.endMonth || defaultEndMonth(today)
  const period = periodFor(endMonth)
  const settings = await loadWayneSettings(db)

  let storeQ = db.from('stores').select('id, store_code, store_name').eq('status', 'active').order('store_code')
  if (opts.storeIds?.length) storeQ = storeQ.in('id', opts.storeIds)
  if (opts.storeCodes?.length) storeQ = storeQ.in('store_code', opts.storeCodes)
  const { data: stores, error: storeErr } = await storeQ
  if (storeErr) throw new Error(storeErr.message)
  const storeList = (stores ?? []) as { id: string; store_code: string; store_name: string }[]
  if (storeList.length === 0) return { today, end_month: endMonth, period, settings, stores: [] }
  const ids = storeList.map((s) => s.id)

  const [sales, inventory, bounds] = await Promise.all([
    fetchAll<CalcSale & { store_id: string }>((from, to) =>
      db.from('sales')
        .select('store_id, product_id, sale_date, quantity, total_amount')
        .in('store_id', ids)
        .gte('sale_date', period.start)
        .lte('sale_date', period.end)
        .order('id')
        .range(from, to)),
    fetchAll<{ store_id: string; product_id: string; quantity_on_hand: number }>((from, to) =>
      db.from('store_inventory')
        .select('store_id, product_id, quantity_on_hand')
        .in('store_id', ids)
        .order('id')
        .range(from, to)),
    // first / last recorded sale per store (one tiny query each)
    Promise.all(ids.map(async (id) => {
      const [first, last] = await Promise.all([
        db.from('sales').select('sale_date').eq('store_id', id).order('sale_date', { ascending: true }).limit(1).maybeSingle(),
        db.from('sales').select('sale_date').eq('store_id', id).order('sale_date', { ascending: false }).limit(1).maybeSingle(),
      ])
      return [id, { first: (first.data?.sale_date as string | undefined) ?? null, last: (last.data?.sale_date as string | undefined) ?? null }] as const
    })),
  ])

  const productIds = [...new Set([...sales.map((s) => s.product_id), ...inventory.map((i) => i.product_id)])]
  const products: Record<string, CalcProduct> = {}
  for (let i = 0; i < productIds.length; i += 200) {
    const { data, error } = await db.from('products').select('id, sku, name, selling_price').in('id', productIds.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const p of data ?? []) {
      products[p.id] = { id: p.id, sku: p.sku, name: p.name, selling_price: p.selling_price === null ? null : Number(p.selling_price) }
    }
  }

  const boundMap = new Map(bounds)
  const results = storeList.map((store) => calcStore({
    today,
    endMonth,
    settings,
    store,
    products,
    sales: sales.filter((s) => s.store_id === store.id).map((s) => ({ ...s, total_amount: Number(s.total_amount) })),
    firstSaleDate: boundMap.get(store.id)?.first ?? null,
    lastSaleDate: boundMap.get(store.id)?.last ?? null,
    inventory: inventory.filter((i) => i.store_id === store.id),
  }))

  return { today, end_month: endMonth, period, settings, stores: results }
}

/** Row shape for public.restock_calculations built from a result. */
export function toCalcRow(r: WayneResult, settings: WayneSettings, user: { id: string; name: string | null }) {
  return {
    store_id: r.store_id,
    store_code: r.store_code,
    store_name: r.store_name,
    end_month: r.period.end_month,
    period_start: r.period.start,
    period_end: r.period.end,
    settings,
    status: r.status,
    months: r.months,
    pairs_per_month: r.pairs_per_month,
    target_stock: r.target_stock,
    restock_trigger: r.restock_trigger,
    on_hand: r.on_hand,
    pairs_to_send: r.pairs_to_send,
    consistency_flag: r.consistency_flag,
    first_sale_date: r.first_sale_date,
    last_sale_date: r.last_sale_date,
    stale_sales: r.stale_sales,
    sku_results: r.skus,
    sold_not_in_inventory: r.sold_not_in_inventory,
    final_total: r.pairs_to_send,
    calculated_by: user.id,
    calculated_by_name: user.name,
  }
}
