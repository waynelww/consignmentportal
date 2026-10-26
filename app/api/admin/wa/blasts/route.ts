import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireWaAdmin } from '@/lib/wa/require-admin'
import { normalizePhone } from '@/lib/gang/phone'
import { pageAll } from '@/lib/performance/channels'
import { tierLimit, tierUsedLast24h, resolveParams, chunk } from '@/lib/wa/blast'

// /api/admin/wa/blasts
// GET            — blast list + per-blast status rollup + tier usage
// GET ?id=…      — one blast with its per-recipient rows
// POST           — create a blast (dry_run: true just previews the counts)
// PATCH          — cancel a blast (stops anything still queued)

export async function GET(request: NextRequest) {
  const { denied } = await requireWaAdmin()
  if (denied) return denied
  const db = await createServiceClient()

  const id = request.nextUrl.searchParams.get('id')
  if (id) {
    const { data: blast, error } = await db.from('wa_blasts').select('*').eq('id', id).single()
    if (error || !blast) return Response.json({ error: 'Blast not found' }, { status: 404 })
    const messages = await pageAll<Record<string, unknown>>((from, to) =>
      db
        .from('wa_messages')
        .select('id, phone, status, error_code, error_message, sent_at, delivered_at, read_at, params, wa_contacts(name)')
        .eq('blast_id', id)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )
    return Response.json({ blast, messages })
  }

  const [{ data: blasts }, { data: stats }, used] = await Promise.all([
    db.from('wa_blasts').select('*').order('created_at', { ascending: false }).limit(30),
    db.from('wa_blast_stats').select('blast_id, status, n'),
    tierUsedLast24h(db),
  ])

  const statsByBlast: Record<string, Record<string, number>> = {}
  for (const row of stats ?? []) {
    const s = (statsByBlast[row.blast_id] ??= {})
    s[row.status] = row.n
  }

  const limit = tierLimit()
  return Response.json({
    blasts: (blasts ?? []).map((b) => ({ ...b, counts: statsByBlast[b.id] ?? {} })),
    tier: { limit, used, remaining: Math.max(0, limit - used) },
  })
}

const AudienceSchema = z.object({
  store_types: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
})

const CreateSchema = z.object({
  template_name: z.string().min(1),
  template_language: z.string().min(1),
  params: z.array(z.string().max(500)).max(10).default([]),
  audience: AudienceSchema.default({}),
  // Trim the audience to what the current messaging tier still allows in
  // this 24h window instead of refusing outright.
  cap_to_tier: z.boolean().default(true),
  dry_run: z.boolean().default(false),
})

interface StoreRow {
  id: string
  store_name: string
  pic_name: string
  pic_phone: string
}

export async function POST(request: NextRequest) {
  const { denied, userId } = await requireWaAdmin()
  if (denied) return denied

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }
  const input = parsed.data

  const db = await createServiceClient()

  // Resolve the audience: active consignment stores, optional type/state
  // filters, PIC phone normalized and deduped (two stores sharing a PIC
  // phone get one message).
  const stores = await pageAll<StoreRow>((from, to) => {
    let q = db
      .from('stores')
      .select('id, store_name, pic_name, pic_phone')
      .eq('status', 'active')
    if (input.audience.store_types?.length) q = q.in('store_type', input.audience.store_types)
    if (input.audience.states?.length) q = q.in('state', input.audience.states)
    return q.order('id', { ascending: true }).range(from, to)
  })

  const byPhone = new Map<string, StoreRow>()
  let invalidPhones = 0
  for (const s of stores) {
    const phone = normalizePhone(s.pic_phone)
    if (!phone) { invalidPhones++; continue }
    if (!byPhone.has(phone)) byPhone.set(phone, s)
  }

  // Sync contacts (updates name/store link, never touches opt_in_status).
  const now = new Date().toISOString()
  const contactRows = [...byPhone.entries()].map(([phone, s]) => ({
    phone,
    name: s.store_name,
    store_id: s.id,
    source: 'stores',
    updated_at: now,
  }))
  for (const batch of chunk(contactRows, 500)) {
    const { error } = await db.from('wa_contacts').upsert(batch, { onConflict: 'phone' })
    if (error) return Response.json({ error: `Contact sync failed: ${error.message}` }, { status: 500 })
  }

  // Read back ids + opt status, drop opt-outs.
  const contacts: { id: string; phone: string; opt_in_status: string }[] = []
  for (const batch of chunk([...byPhone.keys()], 200)) {
    const { data, error } = await db
      .from('wa_contacts')
      .select('id, phone, opt_in_status')
      .in('phone', batch)
    if (error) return Response.json({ error: `Contact lookup failed: ${error.message}` }, { status: 500 })
    contacts.push(...(data ?? []))
  }
  const optedOut = contacts.filter((c) => c.opt_in_status === 'opted_out').length
  let eligible = contacts.filter((c) => c.opt_in_status !== 'opted_out')

  // Tier awareness: unique recipients in the rolling 24h window.
  const limit = tierLimit()
  const used = await tierUsedLast24h(db)
  const remaining = Math.max(0, limit - used)
  let cappedOff = 0
  if (eligible.length > remaining) {
    if (!input.cap_to_tier) {
      return Response.json(
        {
          error: `Audience (${eligible.length}) exceeds the remaining 24h tier allowance (${remaining} of ${limit}). Narrow the audience, enable capping, or wait for the window to roll over.`,
          tier: { limit, used, remaining },
        },
        { status: 400 },
      )
    }
    cappedOff = eligible.length - remaining
    eligible = eligible.slice(0, remaining)
  }

  const preview = {
    matched_stores: stores.length,
    unique_phones: byPhone.size,
    invalid_phones: invalidPhones,
    opted_out: optedOut,
    capped_off: cappedOff,
    will_send: eligible.length,
    tier: { limit, used, remaining },
  }
  if (input.dry_run) return Response.json({ dry_run: true, ...preview })

  if (!eligible.length) {
    return Response.json({ error: 'No eligible recipients for this audience right now.', ...preview }, { status: 400 })
  }

  const { data: blast, error: blastErr } = await db
    .from('wa_blasts')
    .insert({
      template_name: input.template_name,
      template_language: input.template_language,
      params: input.params,
      audience: input.audience,
      status: 'sending',
      total_recipients: eligible.length,
      created_by: userId,
    })
    .select('id')
    .single()
  if (blastErr || !blast) {
    return Response.json({ error: `Blast create failed: ${blastErr?.message}` }, { status: 500 })
  }

  const storeByPhone = byPhone
  const messageRows = eligible.map((c) => ({
    contact_id: c.id,
    phone: c.phone,
    direction: 'outbound',
    conversation_key: c.phone,
    message_type: 'template',
    template_name: input.template_name,
    params: resolveParams(input.params, storeByPhone.get(c.phone) ?? null),
    blast_id: blast.id,
    status: 'queued',
  }))
  for (const batch of chunk(messageRows, 500)) {
    const { error } = await db.from('wa_messages').insert(batch)
    if (error) {
      // Leave what queued; the blast can still be processed/cancelled.
      return Response.json({ error: `Queueing failed partway: ${error.message}`, blast_id: blast.id }, { status: 500 })
    }
  }

  return Response.json({ blast_id: blast.id, queued: eligible.length, ...preview })
}

const CancelSchema = z.object({ id: z.string().uuid(), action: z.literal('cancel') })

export async function PATCH(request: NextRequest) {
  const { denied } = await requireWaAdmin()
  if (denied) return denied

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const parsed = CancelSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Validation error' }, { status: 400 })

  const db = await createServiceClient()
  const { data: cancelled } = await db
    .from('wa_messages')
    .update({ status: 'failed', failed_at: new Date().toISOString(), error_code: 'cancelled', error_message: 'Blast cancelled' })
    .eq('blast_id', parsed.data.id)
    .eq('status', 'queued')
    .select('id')
  await db
    .from('wa_blasts')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .eq('status', 'sending')

  return Response.json({ ok: true, cancelled: cancelled?.length ?? 0 })
}
