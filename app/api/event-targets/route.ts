import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEventsAccess, loadTargetSettings, EventTargetSchema, saveEventTarget } from '@/lib/events/target-api'

export async function GET() {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error

  const svc = await createServiceClient()
  const { data, error } = await svc
    .from('event_targets')
    .select('*, event_target_days(*)')
    .order('created_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  for (const ev of data ?? []) {
    ;(ev.event_target_days as { position: number }[] | null)?.sort((a, b) => a.position - b.position)
  }
  const settings = await loadTargetSettings()
  return Response.json({ events: data ?? [], settings })
}

export async function POST(request: NextRequest) {
  const ctx = await requireEventsAccess()
  if (ctx.error) return ctx.error

  const parsed = EventTargetSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const saved = await saveEventTarget(parsed.data, { createdBy: ctx.user.id })
  if ('error' in saved) return Response.json({ error: saved.error }, { status: 500 })
  return Response.json({ id: saved.id, calc: saved.result })
}
