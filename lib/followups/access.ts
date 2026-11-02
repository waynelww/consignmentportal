// Same rule as the onboarding board: admins only (super_admin, ops_manager),
// and every change names an active Xocks team member.
export { authoriseOnboarding as authoriseFollowups, isActiveTeamMember } from '@/lib/onboarding/access'
