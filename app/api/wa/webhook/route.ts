import { createHmac, timingSafeEqual } from 'crypto'
import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/gang/phone'

// WhatsApp Cloud API webhook.
// GET  — Meta's one-time subscription handshake (hub.challenge echo).
// POST — inbound messages + outbound status events (sent/delivered/read/
//        failed). Always returns 200 on processing problems: a non-2xx
//        makes Meta retry for days and can get the subscription disabled.
//        Only a bad signature gets a 401 (forged request).

const OPT_OUT_KEYWORDS = new Set(['STOP', 'UNSUBSCRIBE', 'BERHENTI'])

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  if (
    params.get('hub.mode') === 'subscribe' &&
    params.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new Response(params.get('hub.challenge') ?? '', { status: 200 })
  }
  return new Response('Verification failed', { status: 403 })
}

function signatureValid(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET
  // Without the app secret we can't verify — accept but log, so a missing
  // env var degrades to "works, less safe" rather than silently dropping
  // every event.
  if (!secret) {
    console.warn('[wa webhook] WHATSAPP_APP_SECRET not set — skipping signature check')
    return true
  }
  if (!header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const given = header.slice('sha256='.length)
  if (given.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'))
}

interface StatusEvent {
  id: string
  status: string
  timestamp?: string
  errors?: { code?: number; title?: string; error_data?: { details?: string } }[]
}

interface InboundMessage {
  from: string
  id: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  button?: { text?: string }
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
}

interface WebhookValue {
  contacts?: { wa_id?: string; profile?: { name?: string } }[]
  messages?: InboundMessage[]
  statuses?: StatusEvent[]
}

function tsToIso(timestamp?: string): string {
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date().toISOString()
  return new Date(seconds * 1000).toISOString()
}

// Pull a human-readable body out of the message variants we care about.
function inboundBody(msg: InboundMessage): string | null {
  return (
    msg.text?.body ??
    msg.button?.text ??
    msg.interactive?.button_reply?.title ??
    msg.interactive?.list_reply?.title ??
    null
  )
}

const STATUS_RANK: Record<string, number> = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4, failed: 5 }

async function applyStatus(supabase: ReturnType<typeof createAdminClient>, s: StatusEvent) {
  const { data: row } = await supabase
    .from('wa_messages')
    .select('id, status')
    .eq('wa_message_id', s.id)
    .maybeSingle()
  if (!row) return // status for a message we didn't send (e.g. from the Business app in coexistence)

  const at = tsToIso(s.timestamp)
  const update: Record<string, unknown> = {}
  if (s.status === 'sent') update.sent_at = at
  if (s.status === 'delivered') update.delivered_at = at
  if (s.status === 'read') update.read_at = at
  if (s.status === 'failed') {
    update.failed_at = at
    const err = s.errors?.[0]
    update.error_code = err?.code != null ? String(err.code) : 'unknown'
    update.error_message = err?.error_data?.details || err?.title || 'failed'
  }

  // Events can arrive out of order (read before delivered) — never move the
  // status backwards, but still record the timestamp above.
  const incoming = STATUS_RANK[s.status]
  if (incoming !== undefined && incoming > (STATUS_RANK[row.status] ?? 0)) {
    update.status = s.status
  }
  await supabase.from('wa_messages').update(update).eq('id', row.id)
}

async function applyInbound(
  supabase: ReturnType<typeof createAdminClient>,
  msg: InboundMessage,
  value: WebhookValue,
) {
  const phone = normalizePhone(msg.from) ?? msg.from
  const at = tsToIso(msg.timestamp)
  const body = inboundBody(msg)
  const profileName = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name ?? null
  const optOut = body != null && OPT_OUT_KEYWORDS.has(body.trim().toUpperCase())

  // Find-or-create the contact, then refresh the service-window marker.
  let contactId: string | null = null
  const { data: existing } = await supabase
    .from('wa_contacts')
    .select('id, name')
    .eq('phone', phone)
    .maybeSingle()

  if (existing) {
    contactId = existing.id
    await supabase
      .from('wa_contacts')
      .update({
        last_inbound_at: at,
        updated_at: new Date().toISOString(),
        ...(existing.name ? {} : { name: profileName }),
        ...(optOut ? { opt_in_status: 'opted_out', opted_out_at: at } : {}),
      })
      .eq('id', existing.id)
  } else {
    const { data: created } = await supabase
      .from('wa_contacts')
      .insert({
        phone,
        name: profileName,
        source: 'inbound',
        opt_in_status: optOut ? 'opted_out' : 'unknown',
        ...(optOut ? { opted_out_at: at } : {}),
        last_inbound_at: at,
      })
      .select('id')
      .single()
    contactId = created?.id ?? null
  }

  // ignoreDuplicates on wa_message_id makes Meta's redeliveries idempotent.
  await supabase.from('wa_messages').upsert(
    {
      contact_id: contactId,
      phone,
      direction: 'inbound',
      wa_message_id: msg.id,
      conversation_key: phone,
      message_type: msg.type ?? 'unknown',
      body,
      payload: msg as unknown as Record<string, unknown>,
      status: 'received',
      created_at: at,
      queued_at: at,
    },
    { onConflict: 'wa_message_id', ignoreDuplicates: true },
  )
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  if (!signatureValid(rawBody, request.headers.get('x-hub-signature-256'))) {
    return new Response('Invalid signature', { status: 401 })
  }

  let payload: { entry?: { changes?: { field?: string; value?: WebhookValue }[] }[] } | null = null
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return Response.json({ ok: true, skipped: 'not json' })
  }

  const supabase = createAdminClient()

  try {
    for (const entry of payload?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages' || !change.value) continue
        for (const s of change.value.statuses ?? []) {
          await applyStatus(supabase, s)
        }
        for (const msg of change.value.messages ?? []) {
          await applyInbound(supabase, msg, change.value)
        }
      }
    }
  } catch (err) {
    // Never bounce the webhook over our own processing bug.
    console.error('[wa webhook] processing failed', err)
  }

  return Response.json({ ok: true })
}
