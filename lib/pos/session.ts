// Sessions for the Event POS link (/pos/[eventId]). No XCMS account:
// part-timer picks their tile + 4-digit PIN (hash in pos_staff_pins,
// server-only) → HMAC-signed cookie scoped to that event + person.
// The cookie carries a fingerprint of the PIN hash, so an admin PIN reset
// signs that person out everywhere. 5 wrong PINs → that person is locked
// for 5 minutes (counted in rate_limit_attempts by person, not by IP, so a
// shared booth Wi-Fi never locks everyone).

import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hashSecret, verifySecret } from '@/lib/hr/portal-session'

export { hashSecret, verifySecret }

export const POS_PIN_PATTERN = /^\d{4}$/
export const POS_SESSION_MAX_AGE = 60 * 60 * 16
const LOCK_ENDPOINT = 'pos-pin'
const LOCK_MAX_FAILS = 5
const LOCK_SECONDS = 300

export const posCookieName = (eventId: string) => `xcms_pos_${eventId.replace(/-/g, '')}`

function signingKey(): Buffer {
  const base = process.env.POS_SESSION_SECRET || process.env.HR_PORTAL_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base) throw new Error('No signing secret for POS sessions')
  return createHash('sha256').update(`xcms-event-pos:${base}`).digest()
}
const fingerprint = (stored: string) => createHash('sha256').update(stored).digest('base64url').slice(0, 12)

interface PosToken { t: 'pos'; e: string; s: string; v: string; exp: number }

export function posToken(eventId: string, staffId: string, pinHash: string): string {
  const payload: PosToken = { t: 'pos', e: eventId, s: staffId, v: fingerprint(pinHash), exp: Math.floor(Date.now() / 1000) + POS_SESSION_MAX_AGE }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${createHmac('sha256', signingKey()).update(body).digest('base64url')}`
}

function unsign(token: string | undefined): PosToken | null {
  if (!token) return null
  const [body, mac] = token.split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', signingKey()).update(body).digest()
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as PosToken
    return p.t === 'pos' && p.exp > Date.now() / 1000 ? p : null
  } catch { return null }
}

export function posCookieOptions(maxAge = POS_SESSION_MAX_AGE) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge }
}

export function generatePin(): string {
  return String(randomInt(0, 10000)).padStart(4, '0')
}

export async function getPosPinHash(db: SupabaseClient, staffId: string): Promise<string | null> {
  const { data } = await db.from('pos_staff_pins').select('pin_hash').eq('staff_id', staffId).maybeSingle()
  return data?.pin_hash ?? null
}

export async function setPosPin(db: SupabaseClient, staffId: string, pin: string): Promise<void> {
  const { error } = await db.from('pos_staff_pins')
    .upsert({ staff_id: staffId, pin_hash: hashSecret(pin), updated_at: new Date().toISOString() })
  if (error) throw new Error(`Could not save PIN: ${error.message}`)
}

export interface PosEvent { id: string; name: string; status: 'active' | 'closed'; start_date: string; end_date: string | null; stock_location_id: string | null }

export async function loadPosEvent(db: SupabaseClient, eventId: string): Promise<PosEvent | null> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null
  const { data } = await db.from('events').select('id, name, status, start_date, end_date, stock_location_id').eq('id', eventId).maybeSingle()
  return (data as PosEvent) ?? null
}

export interface PosSession { event: PosEvent; staff: { id: string; name: string } }

/**
 * The signed-in part-timer for this event, or null. Requires: valid cookie
 * for THIS event, PIN not reset since, person still on the event and not
 * hidden, event active.
 */
export async function posSession(req: NextRequest, db: SupabaseClient, eventId: string): Promise<PosSession | null> {
  const token = unsign(req.cookies.get(posCookieName(eventId))?.value)
  if (!token || token.e !== eventId) return null
  const [event, pinHash, { data: link }] = await Promise.all([
    loadPosEvent(db, eventId),
    getPosPinHash(db, token.s),
    db.from('event_staff').select('hidden, pos_staff(id, name)').eq('event_id', eventId).eq('staff_id', token.s).maybeSingle(),
  ])
  if (!event || event.status !== 'active') return null
  if (!pinHash || fingerprint(pinHash) !== token.v) return null
  const staff = (link as unknown as { hidden: boolean; pos_staff: { id: string; name: string } | null } | null)
  if (!staff || staff.hidden || !staff.pos_staff) return null
  return { event, staff: { id: staff.pos_staff.id, name: staff.pos_staff.name } }
}

// ── Lockout ──────────────────────────────────────────────────────────────
// Locked when the last 5 PIN attempts for this person (within 5 minutes)
// were all wrong. Every attempt is kept as a record (rate_limit_attempts).
export async function pinLockedSeconds(db: SupabaseClient, staffId: string): Promise<number> {
  const since = new Date(Date.now() - LOCK_SECONDS * 1000).toISOString()
  const { data } = await db.from('rate_limit_attempts').select('created_at, succeeded')
    .eq('email', `pos-staff:${staffId}`).eq('endpoint', LOCK_ENDPOINT)
    .gte('created_at', since).order('created_at', { ascending: false }).limit(LOCK_MAX_FAILS)
  if (!data || data.length < LOCK_MAX_FAILS || data.some((r) => r.succeeded)) return 0
  const latest = Date.parse(data[0].created_at)
  return Math.max(1, Math.ceil((latest + LOCK_SECONDS * 1000 - Date.now()) / 1000))
}

export async function recordPinAttempt(db: SupabaseClient, req: NextRequest, staffId: string, ok: boolean) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  await db.from('rate_limit_attempts').insert({ ip, endpoint: LOCK_ENDPOINT, email: `pos-staff:${staffId}`, succeeded: ok })
}
