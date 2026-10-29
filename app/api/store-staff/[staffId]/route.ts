import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { authoriseStoreStaff, STAFF_NAME_DUPLICATE } from '@/lib/store-staff/access'

const UpdateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name must be 60 characters or fewer').optional(),
  active: z.boolean().optional(),
}).refine((v) => v.name !== undefined || v.active !== undefined, { message: 'Nothing to update' })

/**
 * PATCH /api/store-staff/:staffId  { name?, active? }
 * Rename a staff member, or hide them (active: false) / bring them back (active: true).
 * Hiding never deletes: past sales keep their staff link.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ staffId: string }> },
) {
  const { staffId } = await params

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

  const adminClient = createAdminClient()
  const { data: existing } = await adminClient
    .from('store_staff')
    .select('id, store_id')
    .eq('id', staffId)
    .maybeSingle()
  if (!existing) return Response.json({ error: 'Staff member not found' }, { status: 404 })

  const auth = await authoriseStoreStaff(existing.store_id)
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const { data, error } = await adminClient
    .from('store_staff')
    .update(parsed.data)
    .eq('id', staffId)
    .select('id, store_id, name, active, created_at')
    .single()

  if (error?.code === '23505') return Response.json({ error: STAFF_NAME_DUPLICATE }, { status: 409 })
  if (error || !data) return Response.json({ error: 'Failed to update staff member', details: error?.message }, { status: 500 })

  return Response.json({ staff: data })
}
