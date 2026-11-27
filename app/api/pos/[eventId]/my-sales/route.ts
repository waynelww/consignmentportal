import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { posSession } from '@/lib/pos/session'
import { eventDays } from '@/lib/pos/server'
import { todayMYT } from '@/lib/sales/last-sale'

// GET ?day=YYYY-MM-DD | ?day=all — ONLY the signed-in part-timer's own sales
// (filtered by the session's staff id, never a request parameter).
export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const db = await createServiceClient()
  const s = await posSession(request, db, eventId)
  if (!s) return Response.json({ error: 'Signed out' }, { status: 401 })

  const today = todayMYT()
  const dayParam = request.nextUrl.searchParams.get('day') || today
  let q = db.from('pos_sales')
    .select('id, sale_no, event_day, payment_method, subtotal, discount_label, discount_amount, total, cash_received, change, voided_at, created_at, pos_sale_items(name, sku, qty, unit_price, is_pair)')
    .eq('event_id', eventId)
    .eq('staff_id', s.staff.id)
    .order('created_at', { ascending: false })
  if (dayParam !== 'all') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayParam)) return Response.json({ error: 'Bad day' }, { status: 400 })
    q = q.eq('event_day', dayParam)
  }
  const { data, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const sales = (data ?? []).map((r) => ({
    id: r.id, sale_no: r.sale_no, event_day: r.event_day, payment_method: r.payment_method,
    subtotal: Number(r.subtotal), discount_label: r.discount_label, discount_amount: Number(r.discount_amount),
    total: Number(r.total), voided: !!r.voided_at, created_at: r.created_at,
    items: ((r.pos_sale_items ?? []) as { name: string; sku: string; qty: number; unit_price: number; is_pair: boolean }[])
      .map((i) => ({ name: i.name, sku: i.sku, qty: i.qty, unit_price: Number(i.unit_price), is_pair: i.is_pair })),
  }))
  const live = sales.filter((x) => !x.voided)
  const totals = {
    count: live.length,
    pairs: live.reduce((a, x) => a + x.items.reduce((b, i) => b + (i.is_pair ? i.qty : 0), 0), 0),
    total: Math.round(live.reduce((a, x) => a + x.total, 0) * 100) / 100,
    discounts: Math.round(live.reduce((a, x) => a + x.discount_amount, 0) * 100) / 100,
  }
  const days = eventDays(s.event.start_date, s.event.end_date)
  if (!days.includes(today) && today >= s.event.start_date) days.push(today)
  return Response.json({ today, day: dayParam, days, totals, sales })
}
