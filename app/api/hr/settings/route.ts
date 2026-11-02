import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { authoriseHrAdmin } from '@/lib/hr/access'
import { logHr } from '@/lib/hr/audit'
import { HR_SETTING_KEYS } from '@/lib/hr/settings'
import { hashSecret } from '@/lib/hr/portal-session'
import { HR_SECRET_KEYS, setHrSecret } from '@/lib/hr/secrets'

const SettingsSchema = z.object({
  email: z.string().trim().email('Enter a valid email').optional(),
  late_penalty: z.number().min(0).max(100000).optional(),
  work_days: z.array(z.number().int().min(1).max(7)).min(1, 'Pick at least one working day').optional(),
  // Changing it signs every device out of the /hr link.
  portal_password: z.string().min(6, 'Link password must be at least 6 characters').max(100).optional(),
})

/** PUT /api/hr/settings { email?, late_penalty?, work_days?, portal_password? } — HR admin only. */
export async function PUT(request: NextRequest) {
  const auth = await authoriseHrAdmin()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = SettingsSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  const s = parsed.data

  const upserts: { key: string; value: string }[] = []
  if (s.email !== undefined) upserts.push({ key: HR_SETTING_KEYS.email, value: s.email })
  if (s.late_penalty !== undefined) upserts.push({ key: HR_SETTING_KEYS.latePenalty, value: String(s.late_penalty) })
  if (s.work_days !== undefined) upserts.push({ key: HR_SETTING_KEYS.workDays, value: [...new Set(s.work_days)].sort().join(',') })
  if (upserts.length === 0 && s.portal_password === undefined) return Response.json({ error: 'Nothing to update' }, { status: 400 })

  const svc = await createServiceClient()
  try {
    for (const u of upserts) await setHrSecret(svc, u.key, u.value)
  } catch (err) {
    return Response.json({ error: 'Save failed', details: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  if (s.portal_password !== undefined) {
    // Server-only table: the hash never sits where store accounts could read it.
    await setHrSecret(svc, HR_SECRET_KEYS.portalPasswordHash, hashSecret(s.portal_password))
  }

  const actor = { type: 'admin' as const, label: auth.label }
  if (s.portal_password !== undefined) await logHr(svc, request, actor, 'link_password.changed')
  const { portal_password: _omit, ...logged } = s
  if (Object.keys(logged).length > 0) await logHr(svc, request, actor, 'settings.changed', null, logged)
  return Response.json({ ok: true })
}
