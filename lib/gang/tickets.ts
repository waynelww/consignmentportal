import type { SupabaseClient } from '@supabase/supabase-js'

export interface AssignedTicket {
  submission_id: string
  ticket_no: number
  draw_month: string
}

// Draw months follow Malaysia time — a customer verified at 11:50pm on the
// 31st MYT belongs to that month's draw, not next month's (which is what
// plain UTC would say for the 8 hours around midnight).
export function currentDrawMonth(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7)
}

/**
 * Assigns sequential lucky-draw ticket numbers (within the current draw
 * month) to verified submissions that don't have one yet. Ticket number =
 * position in the month: first verified order of September is #1, and so
 * on. The (draw_month, ticket_no) unique index backstops the read-max race:
 * on a collision we re-read the max and retry.
 */
export async function assignTickets(
  supabase: SupabaseClient,
  submissionIds: string[],
): Promise<AssignedTicket[]> {
  if (submissionIds.length === 0) return []
  const drawMonth = currentDrawMonth()

  const { data: maxRow } = await supabase
    .from('gang_order_submissions')
    .select('ticket_no')
    .eq('draw_month', drawMonth)
    .not('ticket_no', 'is', null)
    .order('ticket_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  let next = (maxRow?.ticket_no ?? 0) + 1
  const assigned: AssignedTicket[] = []

  for (const id of submissionIds) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { error } = await supabase
        .from('gang_order_submissions')
        .update({ ticket_no: next, draw_month: drawMonth })
        .eq('id', id)
        .is('ticket_no', null) // never renumber a ticket that already exists

      if (!error) {
        assigned.push({ submission_id: id, ticket_no: next, draw_month: drawMonth })
        next++
        break
      }
      if (error.code !== '23505') break // not a number collision — give up on this row
      // Someone else took this number concurrently — re-read the max and retry
      const { data: retryMax } = await supabase
        .from('gang_order_submissions')
        .select('ticket_no')
        .eq('draw_month', drawMonth)
        .not('ticket_no', 'is', null)
        .order('ticket_no', { ascending: false })
        .limit(1)
        .maybeSingle()
      next = (retryMax?.ticket_no ?? next) + 1
    }
  }

  return assigned
}
