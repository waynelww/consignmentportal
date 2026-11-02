import { createClient } from '@/lib/supabase/server'
import { isHrAdminEmail } from './admins'

type AuthResult =
  | { ok: true; userId: string; label: string }
  | { ok: false; status: number; error: string }

/**
 * HR Admin (/admin/hr/manage and /api/hr/*): approvals, penalties,
 * entitlements, holidays, PIN resets, settings and the activity log.
 * The XCMS login must be super_admin AND be on the HR admin list
 * (lib/hr/admins.ts, by email). Staff never sign in to XCMS for HR; they use
 * the /hr link (lib/hr/portal-session.ts).
 */
export async function authoriseHrAdmin(): Promise<AuthResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'super_admin' || !isHrAdminEmail(user.email)) {
    return { ok: false, status: 403, error: 'Forbidden: HR admin only' }
  }
  return { ok: true, userId: user.id, label: `Admin (${profile.full_name || user.email || 'owner'})` }
}

export const HR_BUCKET = 'hr-documents'

export const HR_FILE_TYPES: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/heic': 'image/heic',
  'application/pdf': 'application/pdf',
}
