import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEventsAccess } from '@/lib/events/target-api'
import { loadBonusSettings, loadEventTarget } from '@/lib/pos/server'
import { tierHit, tiersForDay } from '@/lib/pos/bonus'

const r2 = (n: number) => Math.round(n * 100) / 100

// GET — admin view of the event's POS sales: summary (incl. event profit and
// when bonuses unlocked), per part-timer per day with tier + bonus, payment
// split, top seller and the full sales list.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error
  const { eventId } = await params
  const db = await createServiceClient()

  const { data: event } = await db.from('events').select('id, name, start_date, end_date, status').eq('id', eventId).maybeSingle()
  if (!event) return Response.json({ error: 'Event not found' }, { status: 404 })

  const [{ data: rows, error }, target, settings, { data: staffRows }] = await Promise.all([
    db.from('pos_sales')
      .select('id, sale_no, staff_id, event_day, payment_method, subtotal, discount_label, discount_amount, total, cash_received, change, bonus_eligible_amount, voided_at, void_reason, created_at, pos_sale_items(name, sku, qty, stock_qty, unit_price, is_pair)')
      .eq('event_id', eventId).order('created_at', { ascending: true }),
    loadEventTarget(db, eventId),
    loadBonusSettings(db),
    db.from('event_staff').select('pos_staff(id, name)').eq('event_id', eventId),
  ])
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const names = new Map<string, string>()
  for (const s of (staffRows ?? []) as unknown as { pos_staff: { id: string; name: string } | null }[]) if (s.pos_staff) names.set(s.pos_staff.id, s.pos_staff.name)

  type Item = { name: string; sku: string; qty: number; stock_qty: number; unit_price: number; is_pair: boolean }
  const sales = (rows ?? []).map((r) => {
    const items = ((r.pos_sale_items ?? []) as Item[]).map((i) => ({ ...i, unit_price: Number(i.unit_price) }))
    return {
      id: r.id, sale_no: r.sale_no, staff_id: r.staff_id, staff_name: names.get(r.staff_id) ?? '—', event_day: r.event_day,
      payment_method: r.payment_method as 'cash' | 'card' | 'qr', subtotal: Number(r.subtotal), discount_label: r.discount_label,
      discount_amount: Number(r.discount_amount), total: Number(r.total),
      cash_received: r.cash_received == null ? null : Number(r.cash_received), change: r.change == null ? null : Number(r.change),
      bonus_eligible_amount: Number(r.bonus_eligible_amount), voided_at: r.voided_at, void_reason: r.void_reason, created_at: r.created_at,
      pairs: items.reduce((a, i) => a + (i.is_pair ? i.qty : 0), 0), items,
    }
  })
  const live = sales.filter((s) => !s.voided_at)

  const total = r2(live.reduce((a, s) => a + s.total, 0))
  const costs = target ? target.fixed_cost : null
  const unlockedSale = live.find((s) => s.bonus_eligible_amount > 0)

  const groups = new Map<string, { staff_id: string; name: string; day: string; sales: number; pairs: number; total: number; discounts: number; eligible: number }>()
  for (const s of live) {
    const k = `${s.staff_id}|${s.event_day}`
    const g = groups.get(k) ?? { staff_id: s.staff_id, name: s.staff_name, day: s.event_day, sales: 0, pairs: 0, total: 0, discounts: 0, eligible: 0 }
    g.sales++; g.pairs += s.pairs; g.total += s.total; g.discounts += s.discount_amount; g.eligible += s.bonus_eligible_amount
    groups.set(k, g)
  }
  const by_person_day = [...groups.values()]
    .map((g) => {
      const tiers = target ? tiersForDay(event.start_date, g.day, target.days) : null
      const hit = tierHit(g.eligible, tiers, settings)
      return { ...g, total: r2(g.total), discounts: r2(g.discounts), eligible: r2(g.eligible), day_label: tiers?.label ?? null, tiers: tiers?.tiers ?? null, tier: hit.tier, bonus: hit.bonus }
    })
    .sort((a, b) => a.day.localeCompare(b.day) || b.total - a.total)

  const perPerson = new Map<string, { staff_id: string; name: string; total: number; bonus: number }>()
  for (const g of by_person_day) {
    const p = perPerson.get(g.staff_id) ?? { staff_id: g.staff_id, name: g.name, total: 0, bonus: 0 }
    p.total += g.total; p.bonus += g.bonus
    perPerson.set(g.staff_id, p)
  }
  const people = [...perPerson.values()].map((p) => ({ ...p, total: r2(p.total) })).sort((a, b) => b.total - a.total)

  const pay = { cash: 0, card: 0, qr: 0 }
  for (const s of live) pay[s.payment_method] += s.total

  return Response.json({
    summary: {
      has_target: !!target,
      total_sales: total,
      event_costs: costs,
      event_profit: costs == null ? null : r2(total - costs),
      profit_unlock_amount: settings.profit_unlock_amount,
      bonuses_unlocked_at: unlockedSale?.created_at ?? null,
      sales_count: live.length,
      pairs: live.reduce((a, s) => a + s.pairs, 0),
      discounts: r2(live.reduce((a, s) => a + s.discount_amount, 0)),
      bonus_total: r2(by_person_day.reduce((a, g) => a + g.bonus, 0)),
      payments: { cash: r2(pay.cash), card: r2(pay.card), qr: r2(pay.qr) },
      top_seller: people[0] ?? null,
    },
    by_person_day,
    people,
    sales: sales.reverse(),
  })
}
