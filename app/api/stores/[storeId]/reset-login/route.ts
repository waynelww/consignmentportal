/**
 * GET  /api/stores/[storeId]/reset-login → the store owner's login email (never the password).
 * POST /api/stores/[storeId]/reset-login → replaces the store owner's password with a new
 *   temporary one and returns it ONCE, to the admin's browser. The password is not stored,
 *   logged or emailed.
 *
 * Admin only (super_admin, ops_manager). The store owner is the profiles row with
 * role 'store_owner' and this store_id; the login email is the auth user's email.
 *
 * Not recorded anywhere yet: the store has no activity/history log. See the handbook.
 */
import { type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { generateTempPassword } from '@/lib/stores/temp-password'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase.from('profiles').select('id, role').eq('id', user.id).single()
  if (!profile) return { error: Response.json({ error: 'Profile not found' }, { status: 403 }) }
  if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return { error: Response.json({ error: 'Forbidden: admin only' }, { status: 403 }) }
  }
  return { ok: true as const }
}

type OwnerLookup =
  | { ok: true; profileId: string | null }
  | { ok: false; response: Response }

// One store owner per store. Zero is reported as null (the GET shows "no login");
// a reset with zero owners is an error in the POST.
async function findStoreOwner(db: Awaited<ReturnType<typeof createServiceClient>>, storeId: string): Promise<OwnerLookup> {
  const { data, error } = await db
    .from('profiles')
    .select('id')
    .eq('store_id', storeId)
    .eq('role', 'store_owner')
  if (error) {
    return { ok: false, response: Response.json({ error: 'Could not load the store login', details: error.message }, { status: 500 }) }
  }
  if (!data || data.length === 0) return { ok: true, profileId: null }
  if (data.length > 1) {
    return {
      ok: false,
      response: Response.json({ error: 'This store has more than one store owner login, so the reset cannot pick one. Check the profiles for this store.' }, { status: 409 }),
    }
  }
  return { ok: true, profileId: data[0].id }
}

async function storeExists(db: Awaited<ReturnType<typeof createServiceClient>>, storeId: string) {
  const { data } = await db.from('stores').select('id, store_name').eq('id', storeId).maybeSingle()
  return data
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { storeId } = await params

  const db = await createServiceClient()
  if (!(await storeExists(db, storeId))) return Response.json({ error: 'Store not found' }, { status: 404 })

  const owner = await findStoreOwner(db, storeId)
  if (!owner.ok) return owner.response
  if (!owner.profileId) return Response.json({ has_login: false, email: null })

  const { data, error } = await db.auth.admin.getUserById(owner.profileId)
  if (error || !data.user?.email) {
    return Response.json({ error: 'Could not read the store owner login email', details: error?.message }, { status: 500 })
  }
  return Response.json({ has_login: true, email: data.user.email })
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { storeId } = await params

  const db = await createServiceClient()
  const store = await storeExists(db, storeId)
  if (!store) return Response.json({ error: 'Store not found' }, { status: 404 })

  const owner = await findStoreOwner(db, storeId)
  if (!owner.ok) return owner.response
  if (!owner.profileId) {
    return Response.json({ error: 'This store has no store owner login to reset.' }, { status: 404 })
  }

  const { data: found, error: findErr } = await db.auth.admin.getUserById(owner.profileId)
  const email = found.user?.email
  if (findErr || !email) {
    return Response.json({ error: 'Could not read the store owner login email', details: findErr?.message }, { status: 500 })
  }

  const temporaryPassword = generateTempPassword()
  const { error: updateErr } = await db.auth.admin.updateUserById(owner.profileId, { password: temporaryPassword })
  if (updateErr) {
    // The error message from Supabase never contains the password, so it is safe to return.
    return Response.json({ error: 'Could not reset the password', details: updateErr.message }, { status: 500 })
  }

  return Response.json(
    { success: true, store_name: store.store_name, email, temporary_password: temporaryPassword },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
