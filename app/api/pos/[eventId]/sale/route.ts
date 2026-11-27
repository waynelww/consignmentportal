import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { posSession } from '@/lib/pos/session'
import { loadPosCatalog, loadPosDiscounts, posDbError } from '@/lib/pos/server'
import { cartTotals, evaluateDiscount, type DiscountLine } from '@/lib/pos/discounts'

const SaleSchema = z.object({
  idempotency_key: z.string().min(8).max(100),
  items: z.array(z.object({ id: z.string().min(1).max(64), qty: z.number().int().positive().max(500) })).min(1).max(200),
  discount_id: z.string().uuid().nullable(),
  payment_method: z.enum(['cash', 'card', 'qr']),
  cash_received: z.number().min(0).max(100000).nullable().optional(),
})

// POST — record a sale. Prices + discount are recalculated here from the
// database (the phone's numbers are never trusted); pos_record_sale then
// checks stock and writes everything in one transaction.
export async function POST(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const db = await createServiceClient()
  const s = await posSession(request, db, eventId)
  if (!s) return Response.json({ error: 'Signed out — sign in again' }, { status: 401 })

  const parsed = SaleSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Invalid sale' }, { status: 400 })
  const body = parsed.data

  const [catalog, discounts] = await Promise.all([
    loadPosCatalog(db, s.event.stock_location_id!),
    loadPosDiscounts(db, eventId),
  ])
  const byId = new Map(catalog.map((p) => [p.id, p]))

  const merged = new Map<string, number>()
  for (const it of body.items) merged.set(it.id, (merged.get(it.id) ?? 0) + it.qty)

  const items: { product_id: string; sku: string; name: string; qty: number; stock_qty: number; unit_price: number; is_pair: boolean }[] = []
  const lines: DiscountLine[] = []
  for (const [id, qty] of merged) {
    const p = byId.get(id)
    if (!p) return Response.json({ error: 'An item in the cart is out of stock — refresh', code: 'stock' }, { status: 409 })
    items.push({ product_id: p.product_id, sku: p.sku, name: p.name, qty, stock_qty: qty * p.stock_per_unit, unit_price: p.price, is_pair: p.is_pair })
    lines.push({ unit_price: p.price, qty, is_pair: p.is_pair, is_patch: p.is_patch, design: p.design })
  }

  const discount = body.discount_id ? discounts.find((d) => d.id === body.discount_id) ?? null : null
  if (body.discount_id && !discount) return Response.json({ error: 'That discount is no longer available', code: 'discount' }, { status: 409 })
  if (discount && !evaluateDiscount(discount, lines).qualifies) {
    return Response.json({ error: `${discount.label} no longer applies to this cart`, code: 'discount' }, { status: 409 })
  }
  const totals = cartTotals(lines, discount)

  let cash: number | null = null
  let change: number | null = null
  if (body.payment_method === 'cash') {
    cash = body.cash_received ?? null
    if (cash == null || cash + 0.0001 < totals.total) return Response.json({ error: 'Cash received is less than the total' }, { status: 400 })
    change = Math.round((cash - totals.total) * 100) / 100
  }

  const { data, error } = await db.rpc('pos_record_sale', {
    p_event_id: eventId,
    p_staff_id: s.staff.id,
    p_idempotency_key: `${eventId}:${body.idempotency_key}`,
    p_payment_method: body.payment_method,
    p_subtotal: totals.subtotal,
    p_discount_id: discount?.id ?? null,
    p_discount_label: discount?.label ?? null,
    p_discount_amount: totals.discount_amount,
    p_total: totals.total,
    p_cash_received: cash,
    p_change: change,
    p_items: items,
  })
  if (error) {
    const e = posDbError(error.message)
    return Response.json({ error: e.error }, { status: e.status })
  }
  const r = data as { sale_id: string; sale_no: number; total: number; duplicate: boolean }
  return Response.json({ sale_no: r.sale_no, total: Number(r.total), change, duplicate: r.duplicate })
}
