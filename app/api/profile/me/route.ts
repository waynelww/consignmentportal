import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Store owners can edit their own contact details. Commission rate and payment
// terms are intentionally NOT updatable here — those are admin-only.

const UpdateSchema = z.object({
  // Personal (lives on profiles)
  full_name: z.string().min(1).max(120).optional(),
  phone: z.string().min(6).max(40).optional().nullable(),

  // Store contact (lives on stores)
  store_email: z.string().email().optional().nullable(),
  pic_name: z.string().min(1).max(120).optional(),
  pic_phone: z.string().min(6).max(40).optional(),
  address: z.string().min(1).max(300).optional(),
  city: z.string().min(1).max(80).optional(),
  state: z.string().min(1).max(80).optional(),
  postcode: z.string().min(3).max(20).optional(),
})

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 404 })

  let store = null
  if (profile.store_id) {
    const { data } = await supabase
      .from('stores')
      .select(
        'id, store_name, store_code, email, pic_name, pic_phone, address, city, state, postcode, commission_rate, status'
      )
      .eq('id', profile.store_id)
      .single()
    store = data
  }

  return Response.json({
    profile: {
      ...profile,
      email: user.email,
    },
    store,
  })
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation', details: parsed.error.flatten() }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('store_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 404 })

  const adminClient = createAdminClient()

  // Update profile (full_name, phone)
  const profilePatch: Record<string, unknown> = {}
  if (parsed.data.full_name !== undefined) profilePatch.full_name = parsed.data.full_name.trim()
  if (parsed.data.phone !== undefined) profilePatch.phone = parsed.data.phone

  if (Object.keys(profilePatch).length > 0) {
    profilePatch.updated_at = new Date().toISOString()
    const { error: profErr } = await adminClient
      .from('profiles')
      .update(profilePatch)
      .eq('id', user.id)
    if (profErr) {
      return Response.json({ error: 'Failed to update profile', details: profErr.message }, { status: 500 })
    }
  }

  // Update store fields (PIC, address, contact)
  const storePatch: Record<string, unknown> = {}
  if (parsed.data.store_email !== undefined) storePatch.email = parsed.data.store_email
  if (parsed.data.pic_name !== undefined) storePatch.pic_name = parsed.data.pic_name.trim()
  if (parsed.data.pic_phone !== undefined) storePatch.pic_phone = parsed.data.pic_phone
  if (parsed.data.address !== undefined) storePatch.address = parsed.data.address.trim()
  if (parsed.data.city !== undefined) storePatch.city = parsed.data.city.trim()
  if (parsed.data.state !== undefined) storePatch.state = parsed.data.state.trim()
  if (parsed.data.postcode !== undefined) storePatch.postcode = parsed.data.postcode.trim()

  if (Object.keys(storePatch).length > 0) {
    if (!profile.store_id) {
      return Response.json({ error: 'No store linked to this profile' }, { status: 400 })
    }
    storePatch.updated_at = new Date().toISOString()
    const { error: storeErr } = await adminClient
      .from('stores')
      .update(storePatch)
      .eq('id', profile.store_id)
    if (storeErr) {
      return Response.json({ error: 'Failed to update store', details: storeErr.message }, { status: 500 })
    }
  }

  return Response.json({ success: true })
}
