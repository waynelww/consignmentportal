import { type NextRequest, NextResponse } from 'next/server'
import { posCookieName, posCookieOptions } from '@/lib/pos/session'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  const res = NextResponse.json({ ok: true })
  res.cookies.set(posCookieName(eventId), '', posCookieOptions(0))
  return res
}
