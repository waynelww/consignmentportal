import { type NextRequest } from 'next/server'
import { moveEventStock } from '@/lib/events/move-event-stock'

// "Remove stock from event" (corrections / miscounts): takes quantities out of
// the event's stock location only — never below 0 and never into Office.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params
  return moveEventStock(request, eventId, 'remove')
}
