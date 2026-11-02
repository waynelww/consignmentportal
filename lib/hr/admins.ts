// Who can open HR Admin (/admin/hr/manage and every /api/hr/* route).
// By email, not by role: being made super_admin does not grant HR access.
// Client-safe (the sidebar uses it to show the link). To add someone, add
// their XCMS login email here and push; the change is in git history.

export const HR_ADMIN_EMAILS = ['wayne@xocks.co'] as const

export function isHrAdminEmail(email: string | null | undefined): boolean {
  return !!email && (HR_ADMIN_EMAILS as readonly string[]).includes(email.trim().toLowerCase())
}
