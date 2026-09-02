import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, recordAttempt } from '@/lib/rate-limit'
import { normalizePhone } from '@/lib/gang/phone'
import { currentDrawMonth } from '@/lib/gang/tickets'

const Schema = z.object({ phone: z.string().min(6) })

// POST /api/gang/tickets
// Public. Returns a member's lucky-draw tickets for the CURRENT draw month
// only — last month's tickets expire from view automatically the moment a
// new month starts (they stay in the DB for the team's records).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Enter a valid phone number.' }, { status: 400 })
  }

  const phone = normalizePhone(parsed.data.phone)
  if (!phone) {
    return Response.json({ error: 'Enter a valid phone number.' }, { status: 400 })
  }

  const limit = await checkRateLimit(request, {
    endpoint: 'gang-tickets',
    maxFailures: 20,
    windowSeconds: 3600,
  })
  if (!limit.ok) {
    return Response.json({ error: limit.reason }, { status: 429 })
  }

  const supabase = createAdminClient()

  const { data: member, error: memberErr } = await supabase
    .from('gang_members')
    .select('id, name')
    .eq('phone', phone)
    .maybeSingle()

  if (memberErr) {
    await recordAttempt(request, { endpoint: 'gang-tickets', succeeded: false })
    return Response.json({ error: 'Could not look up your tickets. Try again.' }, { status: 500 })
  }
  if (!member) {
    await recordAttempt(request, { endpoint: 'gang-tickets', succeeded: false })
    return Response.json({ error: "We couldn't find a membership for this number." }, { status: 404 })
  }

  const drawMonth = currentDrawMonth()

  const [{ data: tickets }, { count: pendingCount }] = await Promise.all([
    supabase
      .from('gang_order_submissions')
      .select('ticket_no, order_number, platform')
      .eq('member_id', member.id)
      .eq('status', 'valid')
      .eq('draw_month', drawMonth)
      .not('ticket_no', 'is', null)
      .order('ticket_no'),
    supabase
      .from('gang_order_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', member.id)
      .eq('status', 'pending'),
  ])

  await recordAttempt(request, { endpoint: 'gang-tickets', succeeded: true })

  return Response.json({
    member: { name: member.name },
    draw_month: drawMonth,
    tickets: tickets ?? [],
    pending_count: pendingCount ?? 0,
  })
}
