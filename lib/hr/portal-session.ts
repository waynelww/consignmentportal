// Sessions for the staff HR link (/hr). No Supabase account involved:
//   1. Link password (shared, hash in settings.hr_portal_password_hash) →
//      cookie xcms_hr_gate, 30 days.
//   2. Name + personal PIN (hash in xocks_team_members.hr_pin_hash) →
//      cookie xcms_hr_member, 12 hours.
// Cookies are HMAC-signed and carry a short fingerprint of the hash they were
// issued against, so changing the link password or resetting a PIN signs out
// every device that used the old one.

import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

export const GATE_COOKIE = 'xcms_hr_gate'
export const MEMBER_COOKIE = 'xcms_hr_member'
export const GATE_MAX_AGE = 60 * 60 * 24 * 30
export const MEMBER_MAX_AGE = 60 * 60 * 12
export const PORTAL_PASSWORD_KEY = 'hr_portal_password_hash'

/** PINs are 4–6 digits. */
export const PIN_PATTERN = /^\d{4,6}$/

function signingKey(): Buffer {
  const base = process.env.HR_PORTAL_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base) throw new Error('No signing secret for HR link sessions')
  return createHash('sha256').update(`xcms-hr-portal:${base}`).digest()
}

// ── Hashing (scrypt, random salt) ─────────────────────────────────────────

export function hashSecret(secret: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(secret, salt, 32)
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export function verifySecret(secret: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = scryptSync(secret, Buffer.from(salt, 'base64url'), expected.length)
  return timingSafeEqual(expected, actual)
}

/** Short fingerprint of a stored hash, embedded in cookies issued against it. */
function fingerprint(stored: string): string {
  return createHash('sha256').update(stored).digest('base64url').slice(0, 12)
}

// ── Signed tokens ─────────────────────────────────────────────────────────

interface GateToken { t: 'gate'; v: string; exp: number }
interface MemberToken { t: 'member'; m: string; v: string; exp: number }

function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const mac = createHmac('sha256', signingKey()).update(body).digest('base64url')
  return `${body}.${mac}`
}

function unsign<T>(token: string | undefined): T | null {
  if (!token) return null
  const [body, mac] = token.split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', signingKey()).update(body).digest()
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp: number }
    return payload.exp > Date.now() / 1000 ? payload : null
  } catch {
    return null
  }
}

export function gateToken(passwordHash: string): string {
  return sign({ t: 'gate', v: fingerprint(passwordHash), exp: Math.floor(Date.now() / 1000) + GATE_MAX_AGE } satisfies GateToken)
}

export function memberToken(memberId: string, pinHash: string): string {
  return sign({ t: 'member', m: memberId, v: fingerprint(pinHash), exp: Math.floor(Date.now() / 1000) + MEMBER_MAX_AGE } satisfies MemberToken)
}

export function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge }
}

// ── Checks used by every /api/hr-portal route ─────────────────────────────

export async function loadPortalPasswordHash(db: SupabaseClient): Promise<string | null> {
  const { data } = await db.from('settings').select('value').eq('key', PORTAL_PASSWORD_KEY).maybeSingle()
  return data?.value?.trim() || null
}

/** True when the request carries a gate cookie issued against the current link password. */
export async function hasGate(req: NextRequest, db: SupabaseClient): Promise<boolean> {
  const token = unsign<GateToken>(req.cookies.get(GATE_COOKIE)?.value)
  if (token?.t !== 'gate') return false
  const hash = await loadPortalPasswordHash(db)
  return !!hash && token.v === fingerprint(hash)
}

export interface PortalMember {
  id: string
  name: string
}

/**
 * The signed-in person, or null. Requires the gate as well, and a PIN that
 * has not been reset since the cookie was issued, and an active name.
 */
export async function portalMember(req: NextRequest, db: SupabaseClient): Promise<PortalMember | null> {
  if (!(await hasGate(req, db))) return null
  const token = unsign<MemberToken>(req.cookies.get(MEMBER_COOKIE)?.value)
  if (token?.t !== 'member') return null
  const { data } = await db.from('xocks_team_members').select('id, name, active, hr_pin_hash').eq('id', token.m).maybeSingle()
  if (!data?.active || !data.hr_pin_hash || token.v !== fingerprint(data.hr_pin_hash)) return null
  return { id: data.id, name: data.name }
}
