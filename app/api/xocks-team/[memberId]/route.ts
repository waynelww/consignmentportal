import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { authoriseXocksTeam, TEAM_NAME_DUPLICATE } from '@/lib/xocks-team/access'

const UpdateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name must be 60 characters or fewer').optional(),
  active: z.boolean().optional(),
}).refine((v) => v.name !== undefined || v.active !== undefined, { message: 'Nothing to update' })

/**
 * PATCH /api/xocks-team/:memberId  { name?, active? }
 * Rename a team member, or hide them (active: false) / bring them back (active: true).
 * Hiding never deletes: stores opened by them keep the name.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const auth = await authoriseXocksTeam()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { memberId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }

  const { data, error } = await createAdminClient()
    .from('xocks_team_members')
    .update(parsed.data)
    .eq('id', memberId)
    .select('id, name, active, created_at')
    .maybeSingle()

  if (error?.code === '23505') return Response.json({ error: TEAM_NAME_DUPLICATE }, { status: 409 })
  if (error) return Response.json({ error: 'Failed to update team member', details: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'Team member not found' }, { status: 404 })

  return Response.json({ member: data })
}
