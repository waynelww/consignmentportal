// Copies approved claim receipts and MC slips to Google Drive.
//
// One-time setup: GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET (an
// OAuth "Web application" client) in Vercel, then HR Admin → Report &
// settings → Connect Google Drive. The refresh token is stored in hr_secrets.
// Scope is drive.file: the app can only see files and folders it created
// itself, nothing else in the Drive.
//
// Layout: Xocks HR Receipts / 2026-11 / Aisyah / 2026-11-02 RM32.50 Transport.jpg
// The app keeps its own copy in Supabase storage; Drive is an extra copy.

import type { SupabaseClient } from '@supabase/supabase-js'
import { HR_BUCKET } from './access'
import { CLAIM_CATEGORIES, LEAVE_TYPES, type ClaimCategory, type LeaveType } from './rules'
import { HR_SECRET_KEYS, deleteHrSecrets, getHrSecret, setHrSecret } from './secrets'

export const DRIVE_ROOT_FOLDER_NAME = 'Xocks HR Receipts'
const SCOPES = 'openid email https://www.googleapis.com/auth/drive.file'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export function driveConfigured(): boolean {
  return !!process.env.GOOGLE_DRIVE_CLIENT_ID && !!process.env.GOOGLE_DRIVE_CLIENT_SECRET
}

export function driveAuthUrl(redirectUri: string, state: string): string {
  const qs = new URLSearchParams({
    client_id: process.env.GOOGLE_DRIVE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent', // always return a refresh token
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${qs}`
}

async function tokenRequest(params: Record<string, string>): Promise<Record<string, string>> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_DRIVE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET!,
      ...params,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Google token error: ${body.error_description ?? body.error ?? res.status}`)
  return body
}

/** Finishes the Connect flow: stores the refresh token and which Google account it is. */
export async function connectDrive(db: SupabaseClient, code: string, redirectUri: string): Promise<string> {
  const t = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' })
  if (!t.refresh_token) throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.')
  let account = 'Google account'
  try {
    const payload = JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url').toString())
    if (payload.email) account = payload.email
  } catch {
    // Email is only for display.
  }
  await setHrSecret(db, HR_SECRET_KEYS.driveRefreshToken, t.refresh_token)
  await setHrSecret(db, HR_SECRET_KEYS.driveAccount, account)
  return account
}

export async function disconnectDrive(db: SupabaseClient): Promise<void> {
  await deleteHrSecrets(db, [HR_SECRET_KEYS.driveRefreshToken, HR_SECRET_KEYS.driveAccount, HR_SECRET_KEYS.driveRootFolderId])
}

export async function driveStatus(db: SupabaseClient): Promise<{ configured: boolean; connected: boolean; account: string | null }> {
  const [token, account] = await Promise.all([
    getHrSecret(db, HR_SECRET_KEYS.driveRefreshToken),
    getHrSecret(db, HR_SECRET_KEYS.driveAccount),
  ])
  return { configured: driveConfigured(), connected: driveConfigured() && !!token, account }
}

async function accessToken(db: SupabaseClient): Promise<string> {
  const refresh = await getHrSecret(db, HR_SECRET_KEYS.driveRefreshToken)
  if (!driveConfigured() || !refresh) throw new Error('Google Drive is not connected')
  const t = await tokenRequest({ refresh_token: refresh, grant_type: 'refresh_token' })
  return t.access_token
}

async function driveFetch(token: string, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Google Drive error ${res.status}: ${(body as { error?: { message?: string } }).error?.message ?? 'unknown'}`)
  return body as Record<string, unknown>
}

async function findOrCreateFolder(token: string, name: string, parentId: string | null): Promise<string> {
  const esc = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const q = [`name = '${esc}'`, `mimeType = '${FOLDER_MIME}'`, 'trashed = false', parentId ? `'${parentId}' in parents` : `'root' in parents`].join(' and ')
  const found = await driveFetch(token, `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' })}`)
  const files = found.files as { id: string }[] | undefined
  if (files?.[0]) return files[0].id
  const created = await driveFetch(token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  })
  return created.id as string
}

async function rootFolder(db: SupabaseClient, token: string): Promise<string> {
  const cached = await getHrSecret(db, HR_SECRET_KEYS.driveRootFolderId)
  if (cached) {
    // Still there and not in the bin? (The owner may have deleted it.)
    try {
      const f = await driveFetch(token, `https://www.googleapis.com/drive/v3/files/${cached}?fields=id,trashed`)
      if (!f.trashed) return cached
    } catch {
      // Gone: make a new one below.
    }
  }
  const id = await findOrCreateFolder(token, DRIVE_ROOT_FOLDER_NAME, null)
  await setHrSecret(db, HR_SECRET_KEYS.driveRootFolderId, id)
  return id
}

export type DriveKind = 'claim' | 'leave'

interface FileRow {
  id: string
  member_id: string
  path: string
  type: string | null
  /** YYYY-MM-DD the file is filed under. */
  date: string
  label: string
}

async function loadRow(db: SupabaseClient, kind: DriveKind, id: string): Promise<FileRow | null> {
  if (kind === 'claim') {
    const { data } = await db.from('hr_claims').select('id, member_id, receipt_path, receipt_type, claim_date, amount, category').eq('id', id).maybeSingle()
    if (!data?.receipt_path) return null
    return {
      id: data.id, member_id: data.member_id, path: data.receipt_path, type: data.receipt_type, date: data.claim_date,
      label: `RM${Number(data.amount).toFixed(2)} ${CLAIM_CATEGORIES[data.category as ClaimCategory] ?? data.category}`,
    }
  }
  const { data } = await db.from('hr_leaves').select('id, member_id, attachment_path, attachment_type, start_date, end_date, leave_type').eq('id', id).maybeSingle()
  if (!data?.attachment_path) return null
  const range = data.start_date === data.end_date ? '' : ` to ${data.end_date}`
  return {
    id: data.id, member_id: data.member_id, path: data.attachment_path, type: data.attachment_type, date: data.start_date,
    label: `${LEAVE_TYPES[data.leave_type as LeaveType] ?? data.leave_type}${range}`,
  }
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '-').trim()
}

/**
 * Copies one approved claim receipt / leave attachment to Drive and saves the
 * link on the row. Returns the Drive link, or null when there is no file.
 */
export async function copyToDrive(db: SupabaseClient, kind: DriveKind, id: string): Promise<string | null> {
  const row = await loadRow(db, kind, id)
  if (!row) return null
  const token = await accessToken(db)

  const { data: member } = await db.from('xocks_team_members').select('name').eq('id', row.member_id).single()
  const root = await rootFolder(db, token)
  const monthFolder = await findOrCreateFolder(token, row.date.slice(0, 7), root)
  const personFolder = await findOrCreateFolder(token, safeName(member?.name ?? 'Unknown'), monthFolder)

  const { data: blob, error } = await db.storage.from(HR_BUCKET).download(row.path)
  if (error || !blob) throw new Error(`File missing in storage: ${row.path}`)
  const ext = row.path.includes('.') ? row.path.split('.').pop() : 'jpg'
  const name = safeName(`${row.date} ${row.label}.${ext}`)
  const mime = row.type ?? 'application/octet-stream'

  const boundary = `xcms${Math.random().toString(36).slice(2)}`
  const meta = JSON.stringify({ name, parents: [personFolder] })
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ])
  const uploaded = await driveFetch(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })

  const table = kind === 'claim' ? 'hr_claims' : 'hr_leaves'
  await db.from(table).update({ drive_file_id: uploaded.id, drive_url: uploaded.webViewLink }).eq('id', id)
  return uploaded.webViewLink as string
}

/** Approved rows with a file that are not in Drive yet (claims approved or paid). */
export async function pendingDriveCopies(db: SupabaseClient, limit = 50): Promise<{ kind: DriveKind; id: string }[]> {
  const [claims, leaves] = await Promise.all([
    db.from('hr_claims').select('id').in('status', ['approved', 'paid']).not('receipt_path', 'is', null).is('drive_file_id', null).limit(limit),
    db.from('hr_leaves').select('id').eq('status', 'approved').not('attachment_path', 'is', null).is('drive_file_id', null).limit(limit),
  ])
  return [
    ...(claims.data ?? []).map((r) => ({ kind: 'claim' as const, id: r.id })),
    ...(leaves.data ?? []).map((r) => ({ kind: 'leave' as const, id: r.id })),
  ]
}
