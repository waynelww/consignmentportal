import { type NextRequest } from 'next/server'
import { moveEventStock } from '@/lib/events/move-event-stock'

// "Add stock to event": puts quantities straight into the event's own stock
// location. Nothing is taken from Office and Office quantities are not checked.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params
  return moveEventStock(request, eventId, 'add')
}
