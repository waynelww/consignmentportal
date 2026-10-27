import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  calcStore, malaysiaToday, parseWayneSettings, resolvePeriod,
  WAYNE_SETTING_KEYS, type CalcProduct, type CalcSale, type PeriodMonths, type WayneResult, type WayneSettings,
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

export async function listActiveStores(db?: SupabaseClient) {
  const client = db ?? (await createServiceClient())
  const { data, error } = await client.from('stores').select('id, store_code, store_name').eq('status', 'active').order('store_name')
  if (error) throw new Error(error.message)
  return (data ?? []) as { id: string; store_code: string; store_name: string }[]
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
  months: PeriodMonths
  settings: WayneSettings
  stores: WayneResult[]
}

/**
 * Calculate the given active stores (by id or code; all active stores when
 * neither is given). Each store's period is counted back from its own last
 * recorded sale.
 */
export async function runWayneCalc(opts: { months: PeriodMonths; storeIds?: string[]; storeCodes?: string[]; db?: SupabaseClient }): Promise<CalcRun> {
  const db = opts.db ?? (await createServiceClient())
  const today = malaysiaToday()
  const settings = await loadWayneSettings(db)

  let storeQ = db.from('stores').select('id, store_code, store_name').eq('status', 'active').order('store_code')
  if (opts.storeIds?.length) storeQ = storeQ.in('id', opts.storeIds)
  if (opts.storeCodes?.length) storeQ = storeQ.in('store_code', opts.storeCodes)
  const { data: stores, error: storeErr } = await storeQ
  if (storeErr) throw new Error(storeErr.message)
  const storeList = (stores ?? []) as { id: string; store_code: string; store_name: string }[]

  const perStore = await Promise.all(storeList.map(async (store) => {
    const [first, last, inventory] = await Promise.all([
      db.from('sales').select('sale_date').eq('store_id', store.id).order('sale_date', { ascending: true }).limit(1).maybeSingle(),
      db.from('sales').select('sale_date').eq('store_id', store.id).order('sale_date', { ascending: false }).limit(1).maybeSingle(),
      fetchAll<{ product_id: string; quantity_on_hand: number }>((from, to) =>
        db.from('store_inventory').select('product_id, quantity_on_hand').eq('store_id', store.id).order('id').range(from, to)),
    ])
    const firstSale = (first.data?.sale_date as string | undefined) ?? null
    const lastSale = (last.data?.sale_date as string | undefined) ?? null
    const p = resolvePeriod(firstSale, lastSale, opts.months)
    const sales = p.start && p.end
      ? await fetchAll<CalcSale>((from, to) =>
          db.from('sales')
            .select('product_id, sale_date, quantity, total_amount')
            .eq('store_id', store.id)
            .gte('sale_date', p.start!)
            .lte('sale_date', p.end!)
            .order('id')
            .range(from, to))
      : []
    return { store, firstSale, lastSale, inventory, sales: sales.map((x) => ({ ...x, total_amount: Number(x.total_amount) })) }
  }))

  const productIds = [...new Set(perStore.flatMap((x) => [...x.sales.map((s) => s.product_id), ...x.inventory.map((i) => i.product_id)]))]
  const products: Record<string, CalcProduct> = {}
  for (let i = 0; i < productIds.length; i += 200) {
    const { data, error } = await db.from('products').select('id, sku, name, selling_price').in('id', productIds.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const p of data ?? []) {
      products[p.id] = { id: p.id, sku: p.sku, name: p.name, selling_price: p.selling_price === null ? null : Number(p.selling_price) }
    }
  }

  const results = perStore.map((x) => calcStore({
    today,
    months: opts.months,
    settings,
    store: x.store,
    products,
    sales: x.sales,
    firstSaleDate: x.firstSale,
    lastSaleDate: x.lastSale,
    inventory: x.inventory,
  }))

  return { today, months: opts.months, settings, stores: results }
}

/**
 * Row shape for public.restock_calculations built from a result. No schema
 * change: end_month = month of the last recorded sale, period_start/end =
 * the actual dates used, and the period choice (2/3 months), months covered
 * and short-history flag go into the settings JSONB under `period`.
 */
export function toCalcRow(r: WayneResult, settings: WayneSettings, user: { id: string; name: string | null }, today: string) {
  const start = r.period.start ?? r.last_sale_date ?? today
  const end = r.period.end ?? r.last_sale_date ?? today
  return {
    store_id: r.store_id,
    store_code: r.store_code,
    store_name: r.store_name,
    end_month: end.slice(0, 7),
    period_start: start,
    period_end: end,
    settings: {
      ...settings,
      period: {
        basis: 'last_recorded_sale',
        months_chosen: r.period.months_chosen,
        months_covered: r.period.months_covered,
        nominal_start: r.period.nominal_start,
        short_history: r.period.short_history,
        history_months: r.history_months,
      },
    },
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
