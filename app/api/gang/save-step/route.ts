import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, recordAttempt } from '@/lib/rate-limit'
import { normalizePhone } from '@/lib/gang/phone'
import { getMemberStats } from '@/lib/gang/member-stats'

const Schema = z.object({
  phone: z.string().min(6),
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
})

// POST /api/gang/save-step
// Public. Upserts a Gang member profile incrementally — called after the
// phone+name step, and again after the email step. This means the profile
// is saved as soon as each step is completed, not only at final
// submission, so a customer who drops off partway through is still
// captured for remarketing.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const phone = normalizePhone(parsed.data.phone)
  if (!phone) {
    return Response.json({ error: 'Enter a valid phone number.' }, { status: 400 })
  }

  const limit = await checkRateLimit(request, {
    endpoint: 'gang-save-step',
    maxFailures: 20,
    windowSeconds: 3600,
  })
  if (!limit.ok) {
    return Response.json({ error: limit.reason }, { status: 429 })
  }

  const supabase = createAdminClient()

  const { data: existing, error: lookupErr } = await supabase
    .from('gang_members')
    .select('id, name, email, created_at')
    .eq('phone', phone)
    .maybeSingle()
  if (lookupErr) {
    await recordAttempt(request, { endpoint: 'gang-save-step', succeeded: false })
    return Response.json({ error: 'Could not look up your membership. Try again.' }, { status: 500 })
  }

  let member = existing

  if (!member) {
    if (!parsed.data.name) {
      await recordAttempt(request, { endpoint: 'gang-save-step', succeeded: false })
      return Response.json({ error: 'Name is required for a new member.' }, { status: 400 })
    }
    const { data: created, error: createErr } = await supabase
      .from('gang_members')
      .insert({ phone, name: parsed.data.name, email: parsed.data.email ?? null })
      .select('id, name, email, created_at')
      .single()
    if (createErr) {
      await recordAttempt(request, { endpoint: 'gang-save-step', succeeded: false })
      return Response.json({ error: 'Could not save your details. Try again.' }, { status: 500 })
    }
    member = created
  } else {
    const updates: Record<string, string> = {}
    if (parsed.data.name) updates.name = parsed.data.name
    if (parsed.data.email) updates.email = parsed.data.email
    if (Object.keys(updates).length) {
      const { data: updated, error: updateErr } = await supabase
        .from('gang_members')
        .update(updates)
        .eq('id', member.id)
        .select('id, name, email, created_at')
        .single()
      if (updateErr) {
        await recordAttempt(request, { endpoint: 'gang-save-step', succeeded: false })
        return Response.json({ error: 'Could not save your details. Try again.' }, { status: 500 })
      }
      member = updated
    }
  }

  const stats = await getMemberStats(supabase, member.id).catch(() => null)

  await recordAttempt(request, { endpoint: 'gang-save-step', succeeded: true })

  return Response.json({ member, stats })
}
