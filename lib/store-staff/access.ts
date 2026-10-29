import { createClient } from '@/lib/supabase/server'

/**
 * Admins (super_admin, ops_manager) can manage any store's staff list.
 * A store_owner can manage only their own store's list.
 */
export async function authoriseStoreStaff(
  storeId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()
  if (!profile) return { ok: false, status: 403, error: 'Profile not found' }

  if (profile.role === 'super_admin' || profile.role === 'ops_manager') return { ok: true }
  if (profile.role === 'store_owner' && profile.store_id === storeId) return { ok: true }
  return { ok: false, status: 403, error: 'Forbidden' }
}

export const STAFF_NAME_DUPLICATE = 'That name is already on this store\'s staff list'
