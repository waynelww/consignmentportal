import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireWaAdmin } from '@/lib/wa/require-admin'
import { sendTemplate, waConfigured } from '@/lib/wa/client'

// POST /api/admin/wa/blasts/process { blast_id }
// Sends ONE batch of queued messages and returns how many remain — the
// admin page loops this until done. Batched because of the Vercel Hobby
// 60s function ceiling: ~25 sequential Graph calls stay well under it
// (and well under the 20 msg/s coexistence rate limit).

const BATCH_SIZE = 25

const Schema = z.object({ blast_id: z.string().uuid() })

export async function POST(request: NextRequest) {
  const { denied } = await requireWaAdmin()
  if (denied) return denied

  if (!waConfigured()) {
    return Response.json({ error: 'WhatsApp is not configured (see docs/WHATSAPP_SETUP.md)' }, { status: 503 })
  }

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const parsed = Schema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Validation error' }, { status: 400 })
  const blastId = parsed.data.blast_id

  const db = await createServiceClient()
  const { data: blast } = await db
    .from('wa_blasts')
    .select('id, status, template_name, template_language')
    .eq('id', blastId)
    .single()
  if (!blast) return Response.json({ error: 'Blast not found' }, { status: 404 })
  if (blast.status !== 'sending') {
    return Response.json({ done: true, remaining: 0, status: blast.status, sent: 0, failed: 0 })
  }

  // Claim a batch: the status='queued' filter on the UPDATE means two
  // concurrent processors can't send the same row twice.
  const { data: candidates } = await db
    .from('wa_messages')
    .select('id')
    .eq('blast_id', blastId)
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  let claimed: { id: string; phone: string; params: string[] | null }[] = []
  if (candidates?.length) {
    const { data } = await db
      .from('wa_messages')
      .update({ status: 'sending' })
      .in('id', candidates.map((c) => c.id))
      .eq('status', 'queued')
      .select('id, phone, params')
    claimed = (data ?? []) as typeof claimed
  }

  let sent = 0
  let failed = 0
  for (const msg of claimed) {
    const result = await sendTemplate(msg.phone, blast.template_name, blast.template_language, msg.params ?? [])
    if (result.ok) {
      sent++
      await db
        .from('wa_messages')
        .update({ status: 'sent', wa_message_id: result.waMessageId, sent_at: new Date().toISOString() })
        .eq('id', msg.id)
    } else {
      failed++
      await db
        .from('wa_messages')
        .update({
          status: 'failed',
          failed_at: new Date().toISOString(),
          error_code: result.errorCode ?? 'unknown',
          error_message: result.errorMessage ?? 'send failed',
        })
        .eq('id', msg.id)
    }
  }

  const { count } = await db
    .from('wa_messages')
    .select('id', { count: 'exact', head: true })
    .eq('blast_id', blastId)
    .eq('status', 'queued')
  const remaining = count ?? 0

  if (remaining === 0) {
    await db
      .from('wa_blasts')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', blastId)
      .eq('status', 'sending')
  }

  return Response.json({ done: remaining === 0, remaining, sent, failed })
}
