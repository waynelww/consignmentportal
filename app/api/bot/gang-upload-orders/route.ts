import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { verifyBotAuth } from '@/lib/bot-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { grantShopifyPerk } from '@/lib/gang/grant-perk'

const UploadSchema = z.object({
  type: z.literal('upload'),
  orderNumbers: z
    .array(z.object({ order_number: z.string().min(1), platform: z.string().optional() }))
    .min(1),
  batchDate: z.string().optional(),
})

// Deliberately separate from 'upload' — flipping remaining pending orders to
// invalid is a one-way call the bot should only make after the team confirms
// the day's uploads are complete (partial/staggered uploads, e.g. Shopee
// list now + TikTok list later, shouldn't wrongly invalidate anything).
const CloseOutSchema = z.object({
  type: z.literal('close_out'),
  beforeDate: z.string().optional(),
})

const Schema = z.discriminatedUnion('type', [UploadSchema, CloseOutSchema])

// POST /api/bot/gang-upload-orders
// Bot-authenticated. { type: 'upload', orderNumbers: [...] } records the
// day's confirmed order numbers and flips matching pending submissions to
// valid. { type: 'close_out' } flips remaining pre-cutoff pending
// submissions to invalid — called separately, on request.
export async function POST(request: NextRequest) {
  const auth = verifyBotAuth(request)
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const supabase = createAdminClient()

  if (parsed.data.type === 'upload') {
    const batchDate = parsed.data.batchDate ?? new Date().toISOString().slice(0, 10)
    const rows = parsed.data.orderNumbers.map((o) => ({
      order_number: o.order_number.trim(),
      platform: o.platform ?? null,
      batch_date: batchDate,
    }))

    const { error: upsertErr } = await supabase
      .from('gang_valid_orders')
      .upsert(rows, { onConflict: 'order_number' })
    if (upsertErr) return Response.json({ error: upsertErr.message }, { status: 500 })

    const orderNumbers = rows.map((r) => r.order_number)
    const { data: matched, error: matchErr } = await supabase
      .from('gang_order_submissions')
      .update({ status: 'valid', verified_at: new Date().toISOString() })
      .eq('status', 'pending')
      .in('order_number', orderNumbers)
      .select('id')
    if (matchErr) return Response.json({ error: matchErr.message }, { status: 500 })

    const { count: stillPending } = await supabase
      .from('gang_order_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')

    // Grant the Shopify perk for every member with a valid order who
    // doesn't have one yet — covers members matched just now AND anyone
    // whose grant attempt failed on a previous run (self-healing retry).
    const { data: allValid } = await supabase
      .from('gang_order_submissions')
      .select('member_id')
      .eq('status', 'valid')
    const candidateMemberIds = [...new Set((allValid ?? []).map((r) => r.member_id))]

    let perksGranted = 0
    if (candidateMemberIds.length) {
      const { data: ungranted } = await supabase
        .from('gang_members')
        .select('id')
        .in('id', candidateMemberIds)
        .is('perk_granted_at', null)

      for (const m of ungranted ?? []) {
        const perk = await grantShopifyPerk(supabase, m.id)
        if (perk) perksGranted++
      }
    }

    return Response.json({
      uploaded: rows.length,
      matched: matched?.length ?? 0,
      stillPending: stillPending ?? 0,
      perksGranted,
    })
  }

  // type === 'close_out'
  const beforeDate = parsed.data.beforeDate ?? new Date().toISOString().slice(0, 10)
  const { data: invalidated, error: invErr } = await supabase
    .from('gang_order_submissions')
    .update({ status: 'invalid' })
    .eq('status', 'pending')
    .lte('submitted_date', beforeDate)
    .select('id')
  if (invErr) return Response.json({ error: invErr.message }, { status: 500 })

  return Response.json({ invalidated: invalidated?.length ?? 0 })
}
