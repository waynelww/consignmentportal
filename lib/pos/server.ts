// Server-side loaders for the Event POS (service role only).
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPosProducts, isPatchSku, PATCH_SKU, type PosProduct, type RawProduct } from './catalog'
import type { PosDiscount } from './discounts'
import type { TargetDay, BonusAmounts } from './bonus'

/** Product ids with the patch SKU ("Patches"), active or not. Patches never count as event stock. */
export async function loadPatchProductIds(db: SupabaseClient): Promise<Set<string>> {
  const { data } = await db.from('products').select('id, sku').ilike('sku', PATCH_SKU)
  return new Set((data ?? []).filter((p) => isPatchSku(p.sku)).map((p) => p.id as string))
}

/**
 * Everything checked out to the event's XCMS stock location (never Shopify);
 * qty 0 = sold out. Plus the RM4 patch product and its FREE 6 / 10 tiles,
 * always, with no stock (see isPatchSku).
 */
export async function loadPosCatalog(db: SupabaseClient, stockLocationId: string): Promise<PosProduct[]> {
  const [stock, patch] = await Promise.all([
    db.from('location_stock')
      .select('quantity, products(id, sku, name, selling_price, image_url, barcode, category)')
      .eq('location_id', stockLocationId), // sold-out rows stay (greyed tile)
    db.from('products')
      .select('id, sku, name, selling_price, image_url, barcode, category')
      .ilike('sku', PATCH_SKU)
      .eq('is_active', true),
  ])
  if (stock.error) throw new Error(stock.error.message)
  const rows = ((stock.data ?? []) as unknown as { quantity: number; products: RawProduct | null }[])
    .filter((r) => r.products)
    .map((r) => ({ product: r.products as RawProduct, qty: r.quantity }))
  const patchProduct = ((patch.data ?? []) as RawProduct[]).find((p) => isPatchSku(p.sku)) ?? null
  return buildPosProducts(rows, patchProduct)
}

/** Active global discounts + this event's own, in sort order. */
export async function loadPosDiscounts(db: SupabaseClient, eventId: string): Promise<PosDiscount[]> {
  const { data, error } = await db.from('pos_discounts')
    .select('id, label, type, params, sort, event_id')
    .eq('active', true)
    .or(`event_id.is.null,event_id.eq.${eventId}`)
    .order('sort').order('label')
  if (error) throw new Error(error.message)
  return (data ?? []).map((d) => ({ id: d.id, label: d.label, type: d.type, params: d.params ?? {}, sort: d.sort }))
}

export interface EventTargetInfo { id: string; fixed_cost: number; days: TargetDay[] }

export async function loadEventTarget(db: SupabaseClient, eventId: string): Promise<EventTargetInfo | null> {
  const { data } = await db.from('event_targets')
    .select('id, fixed_cost, event_target_days(position, label, per_person_tier1, per_person_tier2, per_person_tier3)')
    .eq('event_id', eventId).maybeSingle()
  if (!data) return null
  return {
    id: data.id,
    fixed_cost: Number(data.fixed_cost) || 0,
    days: ((data.event_target_days ?? []) as TargetDay[]).map((d) => ({
      position: d.position, label: d.label,
      per_person_tier1: Number(d.per_person_tier1), per_person_tier2: Number(d.per_person_tier2), per_person_tier3: Number(d.per_person_tier3),
    })),
  }
}

export async function loadBonusSettings(db: SupabaseClient): Promise<BonusAmounts & { profit_unlock_amount: number }> {
  const { data } = await db.from('event_target_settings').select('*').eq('id', 1).maybeSingle()
  const row = (data ?? {}) as Record<string, unknown>
  const n = (k: string, d: number) => (row[k] == null || row[k] === '' ? d : Number(row[k]))
  return {
    bonus_tier1: n('bonus_tier1', 20),
    bonus_tier2: n('bonus_tier2', 50),
    bonus_tier3: n('bonus_tier3', 100),
    profit_unlock_amount: n('profit_unlock_amount', 1000),
  }
}

/** Every calendar day from start to end (end missing → start), max 31. */
export function eventDays(start: string, end: string | null): string[] {
  const last = end && end > start ? end : start
  const out: string[] = []
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`) && out.length < 31; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/** Translate "POS:<CODE>:<detail>" errors raised by the SQL functions. */
export function posDbError(message: string): { status: number; error: string } {
  const m = /POS:([A-Z_]+):([^\s]*)/.exec(message)
  if (!m) return { status: 500, error: message }
  const [, code, detail] = m
  switch (code) {
    case 'EVENT_CLOSED': return { status: 409, error: 'This event is closed' }
    case 'EVENT_NOT_FOUND': return { status: 404, error: 'Event not found' }
    case 'STAFF_NOT_ON_EVENT': return { status: 403, error: 'You are not on this event any more' }
    case 'EMPTY_CART': return { status: 400, error: 'Cart is empty' }
    case 'INSUFFICIENT_STOCK': {
      const [sku, have] = detail.split(':')
      return { status: 409, error: `Not enough stock for ${sku} (only ${have ?? 0} left)` }
    }
    case 'SALE_NOT_FOUND': return { status: 404, error: 'Sale not found' }
    case 'ALREADY_VOIDED': return { status: 409, error: 'Sale is already voided' }
    default: return { status: 500, error: message }
  }
}
