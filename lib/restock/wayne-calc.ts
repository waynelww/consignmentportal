// Restock Calculator (Wayne's consignment restock method) — pure maths,
// single source of truth for the admin API, the bot API and the test in
// scripts/test-wayne-calc.ts. No I/O here: callers load sales/inventory and
// pass them in. The separate Predictions page has its own logic and is not
// affected by this file.
//
// Method, per store:
//  - Period = the 2 or 3 months (user's choice) ending on the store's LAST
//    RECORDED SALE: end = last sale date, start = end minus N months + 1 day
//    (e.g. last sale 26 Oct, 3 months → 27 Jul – 26 Oct).
//  - Short history: if the first sale is after that start, the period starts
//    at the first sale and months covered = (last − first sale days) ÷ 30.4,
//    minimum 1. Under 1 month of sales → no calculation ("start with 30–50").
//  - Pairs = Σ sales.total_amount ÷ price per pair, where a product with
//    selling_price ≥ special_min_selling_price is "Special Patches"
//    (price_special) and everything else is Plain (price_plain).
//  - Pairs/month = total pairs in the period ÷ months covered.
//  - The period is split into N consecutive one-month blocks ending on the
//    last sale; full blocks feed the consistency check.
//  - Target = pairs/month × target_multiplier; trigger = × trigger_multiplier.
//  - "Restock now" if total on hand < trigger, else "Stock OK".
//  - Per SKU (only products already in store_inventory): split the target by
//    each SKU's share of pairs sold in the period; send = max(0, SKU target −
//    on hand). Everything rounded to the nearest pair.

export interface WayneSettings {
  price_plain: number
  price_special: number
  special_min_selling_price: number
  target_multiplier: number
  trigger_multiplier: number
  consistency_pct: number
  stale_sale_days: number
}

export const DEFAULT_WAYNE_SETTINGS: WayneSettings = {
  price_plain: 13,
  price_special: 19,
  special_min_selling_price: 19,
  target_multiplier: 4,
  trigger_multiplier: 2,
  consistency_pct: 20,
  stale_sale_days: 7,
}

// settings.key for each field (values stored as text in public.settings)
export const WAYNE_SETTING_KEYS: Record<keyof WayneSettings, string> = {
  price_plain: 'restock_calc_price_plain',
  price_special: 'restock_calc_price_special',
  special_min_selling_price: 'restock_calc_special_min_selling_price',
  target_multiplier: 'restock_calc_target_multiplier',
  trigger_multiplier: 'restock_calc_trigger_multiplier',
  consistency_pct: 'restock_calc_consistency_pct',
  stale_sale_days: 'restock_calc_stale_sale_days',
}

export type PeriodMonths = 2 | 3
export const PERIOD_MONTH_OPTIONS: PeriodMonths[] = [2, 3]
export const DEFAULT_PERIOD_MONTHS: PeriodMonths = 3
export const DAYS_PER_MONTH = 30.4

export interface CalcProduct {
  id: string
  sku: string | null
  name: string
  selling_price: number | null
}

export interface CalcSale {
  product_id: string
  sale_date: string // YYYY-MM-DD
  quantity: number
  total_amount: number
}

export interface CalcInventory {
  product_id: string
  quantity_on_hand: number
}

export interface WayneInput {
  today: string // YYYY-MM-DD in Malaysia time
  months: PeriodMonths
  settings: WayneSettings
  store: { id: string; store_code: string; store_name: string }
  products: Record<string, CalcProduct>
  sales: CalcSale[] // may include sales outside the period; they are ignored
  firstSaleDate: string | null // earliest sale ever for this store
  lastSaleDate: string | null // latest sale ever for this store
  inventory: CalcInventory[]
}

export type StoreStatus = 'restock_now' | 'stock_ok' | 'not_enough_history'

export interface PeriodInfo {
  months_chosen: PeriodMonths
  nominal_start: string | null // last sale − N months + 1 day
  start: string | null // actual start (later of nominal start and first sale)
  end: string | null // last recorded sale
  months_covered: number | null // N, or (last − first sale days) ÷ 30.4 for short history
  short_history: boolean
}

export interface BlockResult {
  start: string // block start (may be before the period start when partial)
  end: string
  sales_amount: number
  pairs: number
  partial: boolean // starts before the first sale — shown, not checked
  deviation_pct: number | null // vs pairs/month; null when partial or average 0
  flagged: boolean
}

export interface SkuResult {
  product_id: string
  sku: string | null
  name: string
  is_special: boolean
  pairs_sold: number // Σ sales.quantity in the period
  share: number // 0..1
  sku_target: number
  on_hand: number
  send: number
}

export interface SoldNotInInventory {
  product_id: string
  sku: string | null
  name: string
  pairs_sold: number
}

export interface WayneResult {
  store_id: string
  store_code: string
  store_name: string
  period: PeriodInfo
  status: StoreStatus
  history_months: number | null // (last − first sale days) ÷ 30.4, 1 dp
  months: BlockResult[]
  pairs_per_month: number | null // 1 dp
  avg_monthly_sales: number | null // RM per month over the period (total_amount ÷ months covered), 2 dp
  target_stock: number | null
  restock_trigger: number | null
  on_hand: number
  pairs_to_send: number | null
  consistency_flag: boolean
  first_sale_date: string | null
  last_sale_date: string | null
  days_since_last_sale: number | null
  stale_sales: boolean
  skus: SkuResult[]
  sold_not_in_inventory: SoldNotInInventory[]
}

const round = (n: number) => Math.round(n)
const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

export function isPeriodMonths(n: unknown): n is PeriodMonths {
  return n === 2 || n === 3
}

/** Today's date (YYYY-MM-DD) in Malaysia time. */
export function malaysiaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

/** Same day of month n months earlier, clamped to that month's last day. */
export function subMonths(date: string, n: number): string {
  const [y, m, day] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) - n
  const ty = Math.floor(idx / 12)
  const tm = idx % 12
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  return iso(new Date(Date.UTC(ty, tm, Math.min(day, last))))
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** N consecutive one-month blocks ending on `end` (oldest first). */
export function monthBlocks(end: string, months: PeriodMonths): { start: string; end: string }[] {
  return Array.from({ length: months }, (_, i) => {
    const k = months - 1 - i // months back from `end` for this block's end
    return { start: addDays(subMonths(end, k + 1), 1), end: subMonths(end, k) }
  })
}

/** Period for a store, counted back from its last recorded sale. */
export function resolvePeriod(firstSale: string | null, lastSale: string | null, months: PeriodMonths) {
  if (!lastSale || !firstSale) {
    return { nominal_start: null, start: null, end: null, short_history: false, history_months: null as number | null }
  }
  const nominal = addDays(subMonths(lastSale, months), 1)
  const short = firstSale > nominal
  return {
    nominal_start: nominal,
    start: short ? firstSale : nominal,
    end: lastSale,
    short_history: short,
    history_months: daysBetween(firstSale, lastSale) / DAYS_PER_MONTH,
  }
}

export function isSpecial(p: CalcProduct | undefined, s: WayneSettings): boolean {
  return (p?.selling_price ?? 0) >= s.special_min_selling_price
}

export function calcStore(input: WayneInput): WayneResult {
  const { settings: s, store, products, months: n } = input
  const p = resolvePeriod(input.firstSaleDate, input.lastSaleDate, n)

  const onHandBySku = new Map<string, number>()
  for (const i of input.inventory) {
    onHandBySku.set(i.product_id, (onHandBySku.get(i.product_id) ?? 0) + (i.quantity_on_hand ?? 0))
  }
  const onHand = [...onHandBySku.values()].reduce((a, b) => a + b, 0)

  const daysSince = input.lastSaleDate ? daysBetween(input.lastSaleDate, input.today) : null
  const base = {
    store_id: store.id,
    store_code: store.store_code,
    store_name: store.store_name,
    on_hand: onHand,
    history_months: p.history_months === null ? null : round1(p.history_months),
    first_sale_date: input.firstSaleDate,
    last_sale_date: input.lastSaleDate,
    days_since_last_sale: daysSince,
    stale_sales: daysSince === null || daysSince > s.stale_sale_days,
  }

  // Under 1 month of sales (or none): no calculation.
  if (!p.start || !p.end || p.history_months === null || p.history_months < 1) {
    return {
      ...base,
      period: { months_chosen: n, nominal_start: p.nominal_start, start: p.start, end: p.end, months_covered: null, short_history: p.short_history },
      status: 'not_enough_history',
      months: [],
      pairs_per_month: null,
      avg_monthly_sales: null,
      target_stock: null,
      restock_trigger: null,
      pairs_to_send: null,
      consistency_flag: false,
      skus: [],
      sold_not_in_inventory: [],
    }
  }

  const start = p.start
  const end = p.end
  const monthsCovered = p.short_history ? Math.min(n, Math.max(1, p.history_months)) : n
  const pairsOf = (x: CalcSale) => (Number(x.total_amount) || 0) / (isSpecial(products[x.product_id], s) ? s.price_special : s.price_plain)

  const inPeriod = input.sales.filter((x) => x.sale_date >= start && x.sale_date <= end)
  const totalPairs = inPeriod.reduce((a, x) => a + pairsOf(x), 0)
  const avg = totalPairs / monthsCovered
  const totalRm = inPeriod.reduce((a, x) => a + (Number(x.total_amount) || 0), 0)

  // One-month blocks ending on the last sale; blocks wholly before the
  // first sale are dropped, the one containing it is shown as partial.
  const blocks: BlockResult[] = monthBlocks(end, n)
    .filter((b) => b.end >= start)
    .map((b) => {
      const rows = inPeriod.filter((x) => x.sale_date >= b.start && x.sale_date <= b.end)
      const pairs = rows.reduce((a, x) => a + pairsOf(x), 0)
      const partial = b.start < start
      const dev = !partial && avg > 0 ? ((pairs - avg) / avg) * 100 : null
      return {
        start: b.start,
        end: b.end,
        sales_amount: round2(rows.reduce((a, x) => a + (Number(x.total_amount) || 0), 0)),
        pairs: round2(pairs),
        partial,
        deviation_pct: dev === null ? null : round1(dev),
        flagged: dev !== null && Math.abs(dev) > s.consistency_pct,
      }
    })

  const soldByProduct = new Map<string, number>()
  for (const x of inPeriod) soldByProduct.set(x.product_id, (soldByProduct.get(x.product_id) ?? 0) + (x.quantity ?? 0))

  const targetExact = avg * s.target_multiplier
  const target = round(targetExact)
  const trigger = round(avg * s.trigger_multiplier)

  // Per SKU: only products already in this store's inventory; shares are
  // taken over the pairs sold of those SKUs so the split covers the target.
  const invIds = [...onHandBySku.keys()]
  const soldInInv = invIds.reduce((a, id) => a + (soldByProduct.get(id) ?? 0), 0)
  const skus: SkuResult[] = invIds.map((id) => {
    const prod = products[id]
    const sold = soldByProduct.get(id) ?? 0
    const share = soldInInv > 0 ? sold / soldInInv : 0
    const skuTarget = round(targetExact * share)
    const qoh = onHandBySku.get(id) ?? 0
    return {
      product_id: id,
      sku: prod?.sku ?? null,
      name: prod?.name ?? 'Unknown product',
      is_special: isSpecial(prod, s),
      pairs_sold: sold,
      share: Math.round(share * 10000) / 10000,
      sku_target: skuTarget,
      on_hand: qoh,
      send: Math.max(0, skuTarget - qoh),
    }
  })
  skus.sort((a, b) => b.pairs_sold - a.pairs_sold || b.send - a.send || a.name.localeCompare(b.name))

  const sold_not_in_inventory: SoldNotInInventory[] = [...soldByProduct.entries()]
    .filter(([id, q]) => !onHandBySku.has(id) && q > 0)
    .map(([id, q]) => ({ product_id: id, sku: products[id]?.sku ?? null, name: products[id]?.name ?? 'Unknown product', pairs_sold: q }))
    .sort((a, b) => b.pairs_sold - a.pairs_sold)

  return {
    ...base,
    period: { months_chosen: n, nominal_start: p.nominal_start, start, end, months_covered: round2(monthsCovered), short_history: p.short_history },
    status: onHand < trigger ? 'restock_now' : 'stock_ok',
    months: blocks,
    pairs_per_month: round1(avg),
    avg_monthly_sales: round2(totalRm / monthsCovered),
    target_stock: target,
    restock_trigger: trigger,
    pairs_to_send: skus.reduce((a, b) => a + b.send, 0),
    consistency_flag: blocks.some((m) => m.flagged),
    skus,
    sold_not_in_inventory,
  }
}

/**
 * Split a total (e.g. a store's 4-month stocked level) across the given ids in
 * proportion to their weights, using largest remainder so the parts add up to
 * exactly `total`. With no weight at all the split is equal.
 */
export function allocateByShare(total: number, weights: Map<string, number>, ids: string[]): Map<string, number> {
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  const weightSum = ids.reduce((a, id) => a + (weights.get(id) ?? 0), 0)
  const w = (id: string) => (weightSum > 0 ? (weights.get(id) ?? 0) : 1)
  const wTotal = weightSum > 0 ? weightSum : ids.length
  const exact = ids.map((id) => ({ id, base: Math.floor((total * w(id)) / wTotal), frac: ((total * w(id)) / wTotal) % 1 }))
  let left = total - exact.reduce((a, x) => a + x.base, 0)
  for (const x of [...exact].sort((a, b) => b.frac - a.frac || a.id.localeCompare(b.id))) {
    if (left > 0) { x.base += 1; left -= 1 }
  }
  for (const x of exact) out.set(x.id, x.base)
  return out
}

/** Parse settings rows ({key, value}) into WayneSettings, falling back to defaults. */
export function parseWayneSettings(rows: { key: string; value: string | null }[]): WayneSettings {
  const out = { ...DEFAULT_WAYNE_SETTINGS }
  const byKey = new Map(rows.map((r) => [r.key, r.value]))
  for (const k of Object.keys(WAYNE_SETTING_KEYS) as (keyof WayneSettings)[]) {
    const raw = byKey.get(WAYNE_SETTING_KEYS[k])
    const v = raw === undefined || raw === null || raw === '' ? NaN : Number(raw)
    if (Number.isFinite(v) && v >= 0) out[k] = v
  }
  // a zero price would divide by zero
  if (out.price_plain <= 0) out.price_plain = DEFAULT_WAYNE_SETTINGS.price_plain
  if (out.price_special <= 0) out.price_special = DEFAULT_WAYNE_SETTINGS.price_special
  return out
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`

/** "27 Jul – 26 Oct 2026" (year shown on both sides when it differs). */
export function formatDateRange(start: string, end: string): string {
  return start.slice(0, 4) === end.slice(0, 4)
    ? `${dm(start)} – ${dm(end)} ${end.slice(0, 4)}`
    : `${dm(start)} ${start.slice(0, 4)} – ${dm(end)} ${end.slice(0, 4)}`
}

/** "27 Jul – 26 Oct 2026 (3 months, ending on last recorded sale)" */
export function describePeriod(p: PeriodInfo): string | null {
  if (!p.start || !p.end) return null
  const span = p.short_history
    ? `${round1(p.months_covered ?? 0)} months of history`
    : `${p.months_chosen} months`
  return `${formatDateRange(p.start, p.end)} (${span}, ending on last recorded sale)`
}
