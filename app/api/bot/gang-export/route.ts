import { type NextRequest } from 'next/server'
import { verifyBotAuth } from '@/lib/bot-auth'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/bot/gang-export?status=valid&from=2026-07-01&to=2026-07-21
// Bot-authenticated. Returns the customer list (phone/name/email) for the
// team to paste into WhatsApp Business app or a bulk-broadcast tool. No
// programmatic WhatsApp sending exists yet — this is the manual-export MVP.
export async function GET(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') ?? 'valid'
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const supabase = createAdminClient()
  let query = supabase
    .from('gang_order_submissions')
    .select('order_number, platform, status, submitted_date, ticket_no, draw_month, gang_members:member_id ( phone, name, email )')
    .eq('status', status)

  if (from) query = query.gte('submitted_date', from)
  if (to) query = query.lte('submitted_date', to)

  const { data, error } = await query.order('submitted_date', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const customers = (data ?? []).map((row) => {
    const member = row.gang_members as unknown as { phone: string; name: string; email: string } | null
    return {
      phone: member?.phone ?? null,
      name: member?.name ?? null,
      email: member?.email ?? null,
      platform: row.platform,
      order_number: row.order_number,
      submitted_date: row.submitted_date,
    }
  })

  return Response.json({ count: customers.length, customers })
}
