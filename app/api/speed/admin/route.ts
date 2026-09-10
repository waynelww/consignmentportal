import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, recordAttempt } from '@/lib/rate-limit'

// POST /api/speed/admin
// Game-master actions for the Beat The Speed board, gated by a shared
// access code (SPEED_ADMIN_CODE env) rather than an XCMS account, so Wayne
// can hand access to whoever runs the event by sending them the code.
// Wrong-code attempts are rate-limited like the other public endpoints.

const Schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), code: z.string() }),
  z.object({
    action: z.literal('submit'),
    code: z.string(),
    name: z.string().trim().min(1).max(30),
    phone: z.string().trim().max(20).default(''),
    gender: z.enum(['M', 'F']),
    speed: z.number().gt(0).lte(35),
  }),
  z.object({ action: z.literal('delete'), code: z.string(), id: z.number().int() }),
  z.object({ action: z.literal('clear'), code: z.string() }),
])

function adminCode() {
  return process.env.SPEED_ADMIN_CODE || 'xocks2026'
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const limit = await checkRateLimit(request, {
    endpoint: 'speed-admin',
    maxFailures: 10,
    windowSeconds: 3600,
  })
  if (!limit.ok) {
    return Response.json({ error: limit.reason }, { status: 429 })
  }

  if (parsed.data.code !== adminCode()) {
    await recordAttempt(request, { endpoint: 'speed-admin', succeeded: false })
    return Response.json({ error: 'Wrong access code.' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const input = parsed.data

  if (input.action === 'submit') {
    const digits = input.phone.replace(/\D/g, '')
    if (input.phone && digits.length < 4) {
      return Response.json({ error: 'Phone number needs at least 4 digits.' }, { status: 400 })
    }
    const { error } = await supabase.from('speed_entries').insert({
      name: input.name.toUpperCase(),
      phone: input.phone,
      gender: input.gender,
      speed: Math.round(input.speed * 10) / 10,
    })
    if (error) {
      return Response.json({ error: 'Could not save the result. Try again.' }, { status: 500 })
    }
  } else if (input.action === 'delete') {
    const { error } = await supabase.from('speed_entries').delete().eq('id', input.id)
    if (error) {
      return Response.json({ error: 'Could not delete the entry. Try again.' }, { status: 500 })
    }
  } else if (input.action === 'clear') {
    const { error } = await supabase.from('speed_entries').delete().gte('id', 0)
    if (error) {
      return Response.json({ error: 'Could not clear the board. Try again.' }, { status: 500 })
    }
  }

  // Every action responds with the full entry list (phones included —
  // the admin needs them to contact winners), so the admin page always
  // renders fresh data without a second round-trip.
  const { data, error } = await supabase
    .from('speed_entries')
    .select('id, name, phone, gender, speed, created_at')
    .order('speed', { ascending: false })
    .order('id', { ascending: true })
  if (error) {
    return Response.json({ error: 'Saved, but could not reload the list.' }, { status: 500 })
  }

  return Response.json({
    entries: (data ?? []).map((e) => ({ ...e, speed: Number(e.speed) })),
  })
}
