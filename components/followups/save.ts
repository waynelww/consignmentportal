import { callOnboardingApi } from '@/components/onboarding/api'
import type { FollowupItem, RowView } from '@/lib/followups/build'

/**
 * Records one tick, untick or note on a checklist cell as the picked team
 * member. Throws the server's message on failure so the caller can toast it.
 */
export async function saveFollowupEntry(args: {
  month: string
  row: RowView
  item: FollowupItem
  byMemberId: string
  ticked?: boolean
  note?: string
}): Promise<void> {
  const target = args.row.kind === 'store'
    ? { store_id: args.row.id }
    : { extra_store_id: args.row.id }
  await callOnboardingApi('/api/followups/entries', 'POST', {
    month: args.month,
    ...target,
    item: args.item,
    by_member_id: args.byMemberId,
    ...(args.ticked !== undefined ? { ticked: args.ticked } : {}),
    ...(args.note !== undefined ? { note: args.note } : {}),
  })
}
