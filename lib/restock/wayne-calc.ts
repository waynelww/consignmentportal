// Restock Calculator (Wayne's consignment restock method) — pure maths,
// single source of truth for the admin API, the bot API and the test in
// scripts/test-wayne-calc.ts. No I/O here: callers load sales/inventory and
// pass them in. The separate Predictions page has its own logic and is not
// affected by this file.
//
// Method, per store:
//  - Period = 3 complete calendar months ending at `endMonth` (Malaysia time).
//  - Monthly pairs = Σ sales.total_amount ÷ price per pair, where a product
//    with selling_price ≥ special_min_selling_price is "Special Patches"
//    (price_special) and everything else is Plain (price_plain).
//  - Pairs/month = average of the 3 months.
//  - Target = pairs/month × target_multiplier; trigger = × trigger_multiplier.
//  - "Restock now" if total on hand < trigger, else "Stock OK".
//  - No sale in (or before) the first month of the period → not enough
//    history, no calculation.
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
  endMonth: string // YYYY-MM, last month of the period
  settings: WayneSettings
  store: { id: string; store_code: string; store_name: string }
  products: Record<string, CalcProduct>
  sales: CalcSale[] // may include sales outside the period; they are ignored
  firstSaleDate: string | null // earliest sale ever for this store
  lastSaleDate: string | null // latest sale ever for this store
  inventory: CalcInventory[]
}

export type StoreStatus = 'restock_now' | 'stock_ok' | 'not_enough_history'

export interface MonthResult {
  month: string // YYYY-MM
  sales_amount: number
  pairs: number // unrounded
  deviation_pct: number | null // vs average, null when average is 0
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
  period: { end_month: string; months: string[]; start: string; end: string }
  status: StoreStatus
  months: MonthResult[]
  pairs_per_month: number | null // 1 dp
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

export function isValidMonth(m: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(m)
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** Today's date (YYYY-MM-DD) in Malaysia time. */
export function malaysiaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** Default end month = the last complete month (e.g. 27 Oct → Sep). */
export function defaultEndMonth(today: string): string {
  return addMonths(today.slice(0, 7), -1)
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(d).padStart(2, '0')}`
}

export function periodFor(endMonth: string) {
  const months = [addMonths(endMonth, -2), addMonths(endMonth, -1), endMonth]
  return { end_month: endMonth, months, start: `${months[0]}-01`, end: lastDayOfMonth(endMonth) }
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export function isSpecial(p: CalcProduct | undefined, s: WayneSettings): boolean {
  return (p?.selling_price ?? 0) >= s.special_min_selling_price
}

export function calcStore(input: WayneInput): WayneResult {
  const { settings: s, store, products } = input
  const period = periodFor(input.endMonth)
  const inPeriod = input.sales.filter((x) => x.sale_date >= period.start && x.sale_date <= period.end)

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
    period,
    on_hand: onHand,
    first_sale_date: input.firstSaleDate,
    last_sale_date: input.lastSaleDate,
    days_since_last_sale: daysSince,
    stale_sales: daysSince === null || daysSince > s.stale_sale_days,
  }

  // Month-level history check: the store needs a sale in (or before) the
  // first month of the period.
  const secondMonthStart = `${period.months[1]}-01`
  if (!input.firstSaleDate || input.firstSaleDate >= secondMonthStart) {
    return {
      ...base,
      status: 'not_enough_history',
      months: [],
      pairs_per_month: null,
      target_stock: null,
      restock_trigger: null,
      pairs_to_send: null,
      consistency_flag: false,
      skus: [],
      sold_not_in_inventory: [],
    }
  }

  // Monthly pairs from sales amount ÷ price per pair
  const amountByMonth = new Map<string, number>()
  const pairsByMonth = new Map<string, number>()
  const soldByProduct = new Map<string, number>()
  for (const x of inPeriod) {
    const m = x.sale_date.slice(0, 7)
    const amt = Number(x.total_amount) || 0
    const price = isSpecial(products[x.product_id], s) ? s.price_special : s.price_plain
    amountByMonth.set(m, (amountByMonth.get(m) ?? 0) + amt)
    pairsByMonth.set(m, (pairsByMonth.get(m) ?? 0) + amt / price)
    soldByProduct.set(x.product_id, (soldByProduct.get(x.product_id) ?? 0) + (x.quantity ?? 0))
  }

  const rawMonths = period.months.map((m) => ({ month: m, sales_amount: round2(amountByMonth.get(m) ?? 0), pairs: pairsByMonth.get(m) ?? 0 }))
  const avg = rawMonths.reduce((a, b) => a + b.pairs, 0) / rawMonths.length
  const months: MonthResult[] = rawMonths.map((m) => {
    const dev = avg > 0 ? ((m.pairs - avg) / avg) * 100 : null
    return { ...m, pairs: round2(m.pairs), deviation_pct: dev === null ? null : round1(dev), flagged: dev !== null && Math.abs(dev) > s.consistency_pct }
  })

  const targetExact = avg * s.target_multiplier
  const target = round(targetExact)
  const trigger = round(avg * s.trigger_multiplier)

  // Per SKU: only products already in this store's inventory; shares are
  // taken over the pairs sold of those SKUs so the split covers the target.
  const invIds = [...onHandBySku.keys()]
  const soldInInv = invIds.reduce((a, id) => a + (soldByProduct.get(id) ?? 0), 0)
  const skus: SkuResult[] = invIds.map((id) => {
    const p = products[id]
    const sold = soldByProduct.get(id) ?? 0
    const share = soldInInv > 0 ? sold / soldInInv : 0
    const skuTarget = round(targetExact * share)
    const qoh = onHandBySku.get(id) ?? 0
    return {
      product_id: id,
      sku: p?.sku ?? null,
      name: p?.name ?? 'Unknown product',
      is_special: isSpecial(p, s),
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
    status: onHand < trigger ? 'restock_now' : 'stock_ok',
    months,
    pairs_per_month: round1(avg),
    target_stock: target,
    restock_trigger: trigger,
    pairs_to_send: skus.reduce((a, b) => a + b.send, 0),
    consistency_flag: months.some((m) => m.flagged),
    skus,
    sold_not_in_inventory,
  }
}

/** Parse settings rows ({key, value}) into WayneSettings, falling back to defaults. */
export function parseWayneSettings(rows: { key: string; value: string | null }[]): WayneSettings {
  const out = { ...DEFAULT_WAYNE_SETTINGS }
  const byKey = new Map(rows.map((r) => [r.key, r.value]))
  for (const k of Object.keys(WAYNE_SETTING_KEYS) as (keyof WayneSettings)[]) {
    const raw = byKey.get(WAYNE_SETTING_KEYS[k])
    const n = raw === undefined || raw === null || raw === '' ? NaN : Number(raw)
    if (Number.isFinite(n) && n >= 0) out[k] = n
  }
  // a zero price would divide by zero
  if (out.price_plain <= 0) out.price_plain = DEFAULT_WAYNE_SETTINGS.price_plain
  if (out.price_special <= 0) out.price_special = DEFAULT_WAYNE_SETTINGS.price_special
  return out
}
