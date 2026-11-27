import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { posSession } from '@/lib/pos/session'
import { loadBonusSettings, loadEventTarget } from '@/lib/pos/server'
import { tierHit, tiersForDay, nextTier } from '@/lib/pos/bonus'
import { todayMYT } from '@/lib/sales/last-sale'

// GET — today's shift for the signed-in part-timer. Tier progress is measured
// on bonus_eligible_amount. Deliberately returns NO event profit, unlock
// threshold or locked/unlocked status.
export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const db = await createServiceClient()
  const s = await posSession(request, db, eventId)
  if (!s) return Response.json({ error: 'Signed out' }, { status: 401 })

  const today = todayMYT()
  const [{ data, error }, target, settings] = await Promise.all([
    db.from('pos_sales')
      .select('payment_method, discount_amount, total, bonus_eligible_amount, pos_sale_items(qty, is_pair)')
      .eq('event_id', eventId).eq('staff_id', s.staff.id).eq('event_day', today).is('voided_at', null),
    loadEventTarget(db, eventId),
    loadBonusSettings(db),
  ])
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const rows = data ?? []
  const r2 = (n: number) => Math.round(n * 100) / 100
  const split = { cash: 0, card: 0, qr: 0 } as Record<'cash' | 'card' | 'qr', number>
  let pairs = 0, total = 0, discounts = 0, eligible = 0
  for (const r of rows) {
    split[r.payment_method as 'cash' | 'card' | 'qr'] += Number(r.total)
    total += Number(r.total)
    discounts += Number(r.discount_amount)
    eligible += Number(r.bonus_eligible_amount)
    for (const i of (r.pos_sale_items ?? []) as { qty: number; is_pair: boolean }[]) if (i.is_pair) pairs += i.qty
  }
  const tiers = target ? tiersForDay(s.event.start_date, today, target.days) : null
  const hit = tierHit(eligible, tiers, settings)
  return Response.json({
    today,
    sales_count: rows.length,
    pairs,
    total: r2(total),
    discounts: r2(discounts),
    split: { cash: r2(split.cash), card: r2(split.card), qr: r2(split.qr) },
    bonus: tiers ? {
      day_label: tiers.label,
      progress: r2(eligible),
      tiers: tiers.tiers.map((mark, i) => ({ tier: i + 1, mark, bonus: [settings.bonus_tier1, settings.bonus_tier2, settings.bonus_tier3][i], hit: mark > 0 && eligible >= mark })),
      earned: hit.bonus,
      tier_hit: hit.tier,
      next: nextTier(eligible, tiers),
    } : null,
  })
}
