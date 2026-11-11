/**
 * GET  /api/stores/[storeId]/reset-login → the store owner's login email (never the
 *   password) and the last few store history entries.
 * POST /api/stores/[storeId]/reset-login → body { by_member_id }. Replaces the store
 *   owner's password with a new temporary one, records a 'login_reset' row in
 *   store_history (who, when), and returns the password ONCE to the admin's browser.
 *   The password is not stored, logged or emailed.
 *
 * Admin only (super_admin, ops_manager). The store owner is the profiles row with
 * role 'store_owner' and this store_id; the login email is the auth user's email.
 * "Working as" (by_member_id) must be an active Xocks team member.
 */
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { generateTempPassword } from '@/lib/stores/temp-password'
import { isActiveTeamMember } from '@/lib/followups/access'

const HISTORY_SHOWN = 5

const ResetSchema = z.object({ by_member_id: z.string().uuid('Choose who you are under "Working as" first') })

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

type ServiceDb = Awaited<ReturnType<typeof createServiceClient>>

type OwnerLookup =
  | { ok: true; profileId: string | null }
  | { ok: false; response: Response }

// One store owner per store. Zero is reported as null; more than one is an error.
async function findStoreOwner(db: ServiceDb, storeId: string): Promise<OwnerLookup> {
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

async function storeExists(db: ServiceDb, storeId: string) {
  const { data } = await db.from('stores').select('id, store_name').eq('id', storeId).maybeSingle()
  return data
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { storeId } = await params

  const db = await createServiceClient()
  if (!(await storeExists(db, storeId))) return Response.json({ error: 'Store not found' }, { status: 404 })

  const { data: historyRows, error: historyErr } = await db
    .from('store_history')
    .select('id, action, created_at, team_member:xocks_team_members(name)')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_SHOWN)
  if (historyErr) {
    return Response.json({ error: 'Could not load store history', details: historyErr.message }, { status: 500 })
  }
  const history = (historyRows ?? []).map((row) => {
    const member = row.team_member as { name: string } | { name: string }[] | null
    const name = Array.isArray(member) ? member[0]?.name : member?.name
    return { id: row.id, action: row.action, created_at: row.created_at, by_name: name ?? null }
  })

  const owner = await findStoreOwner(db, storeId)
  if (!owner.ok) return owner.response
  if (!owner.profileId) return Response.json({ has_login: false, email: null, history })

  const { data, error } = await db.auth.admin.getUserById(owner.profileId)
  if (error || !data.user?.email) {
    return Response.json({ error: 'Could not read the store owner login email', details: error?.message }, { status: 500 })
  }
  return Response.json({ has_login: true, email: data.user.email, history })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error
  const { storeId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = ResetSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }
  const byMemberId = parsed.data.by_member_id
  if (!(await isActiveTeamMember(byMemberId))) {
    return Response.json({ error: 'Choose who you are under "Working as" (an active Xocks team member)' }, { status: 400 })
  }

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
    // Nothing changed, so nothing is recorded. The Supabase message never contains the password.
    return Response.json({ error: 'Could not reset the password', details: updateErr.message }, { status: 500 })
  }

  // The reset has happened. Record it. The history table is append-only, so a failed
  // write cannot be undone here; the admin still gets the password plus a warning.
  const { error: recordErr } = await db.from('store_history').insert({
    store_id: storeId,
    action: 'login_reset',
    team_member_id: byMemberId,
  })

  return Response.json(
    {
      success: true,
      store_name: store.store_name,
      email,
      temporary_password: temporaryPassword,
      ...(recordErr
        ? { warning: `The password was reset, but the reset was NOT recorded in store history: ${recordErr.message}` }
        : {}),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
