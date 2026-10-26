import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireWaAdmin } from '@/lib/wa/require-admin'
import { sendTemplate, waConfigured } from '@/lib/wa/client'
import { normalizePhone } from '@/lib/gang/phone'

// POST /api/admin/wa/test — send one template message to one number (the
// end-to-end smoke test, and handy for previewing a template on your own
// phone before blasting it). Logged in wa_messages like any other send, so
// delivery/read receipts flow in via the webhook.

const Schema = z.object({
  phone: z.string().min(8),
  template_name: z.string().min(1),
  template_language: z.string().min(1),
  params: z.array(z.string().max(500)).max(10).default([]),
})

export async function POST(request: NextRequest) {
  const { denied } = await requireWaAdmin()
  if (denied) return denied

  if (!waConfigured()) {
    return Response.json({ error: 'WhatsApp is not configured (see docs/WHATSAPP_SETUP.md)' }, { status: 503 })
  }

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const phone = normalizePhone(parsed.data.phone)
  if (!phone) return Response.json({ error: 'That does not look like a valid Malaysian number' }, { status: 400 })

  const db = await createServiceClient()

  // Find-or-create the contact without touching an existing one's name/link.
  let contactId: string | null = null
  const { data: existing } = await db.from('wa_contacts').select('id').eq('phone', phone).maybeSingle()
  if (existing) {
    contactId = existing.id
  } else {
    const { data: created } = await db
      .from('wa_contacts')
      .insert({ phone, source: 'test' })
      .select('id')
      .single()
    contactId = created?.id ?? null
  }

  const result = await sendTemplate(phone, parsed.data.template_name, parsed.data.template_language, parsed.data.params)

  await db.from('wa_messages').insert({
    contact_id: contactId,
    phone,
    direction: 'outbound',
    conversation_key: phone,
    message_type: 'template',
    template_name: parsed.data.template_name,
    params: parsed.data.params,
    body: 'test send',
    status: result.ok ? 'sent' : 'failed',
    wa_message_id: result.ok ? result.waMessageId : null,
    sent_at: result.ok ? new Date().toISOString() : null,
    failed_at: result.ok ? null : new Date().toISOString(),
    error_code: result.ok ? null : result.errorCode,
    error_message: result.ok ? null : result.errorMessage,
  })

  if (!result.ok) {
    return Response.json({ error: `Send failed: ${result.errorMessage} (code ${result.errorCode})` }, { status: 502 })
  }
  return Response.json({ ok: true, wa_message_id: result.waMessageId, to: phone })
}
