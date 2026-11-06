// Google Drive over a service account (no user consent, no extra npm package).
//
// Env (set in Vercel, never printed or logged):
//   GOOGLE_SERVICE_ACCOUNT_JSON  full service-account key JSON
//   GOOGLE_DRIVE_FOLDER_ID       the XCMS folder inside the Shared Drive
//
// The service account has no My Drive storage, so every Drive call sends
// supportsAllDrives=true (and includeItemsFromAllDrives=true for listings).
//
// Errors thrown here never include the key, the token or the raw env value.

import { createSign, randomUUID } from 'node:crypto'

const SCOPE = 'https://www.googleapis.com/auth/drive'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

interface ServiceAccount {
  client_email: string
  private_key: string
}

let cachedToken: { token: string; expiresAt: number } | null = null

function loadServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set')
  let parsed: Partial<ServiceAccount>
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Do not include the parser message: it can quote part of the input.
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON')
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key')
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, '\n'),
  }
}

export function driveRootFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID
  if (!id) throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set')
  return id
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/** Access token for the Drive scope, signed JWT exchanged at Google's token endpoint. Cached until near expiry. */
export async function getDriveAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.token

  const sa = loadServiceAccount()
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const signature = base64url(signer.sign(sa.private_key))
  const assertion = `${header}.${claims}.${signature}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string }
  if (!res.ok || !body.access_token) {
    throw new Error(`Google sign-in failed (${body.error ?? res.status})`)
  }
  cachedToken = { token: body.access_token, expiresAt: now + (body.expires_in ?? 3600) }
  return body.access_token
}

async function driveError(res: Response, action: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
  const message = (body.error?.message ?? res.statusText ?? 'unknown error').slice(0, 300)
  return new Error(`Drive ${action} failed (HTTP ${res.status}): ${message}`)
}

/** Escape a value for a Drive files.list `q` string literal. */
function q(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** Find a folder by exact name directly under a parent. */
export async function findFolder(name: string, parentId: string): Promise<string | null> {
  const token = await getDriveAccessToken()
  const query = `name = ${q(name)} and ${q(parentId)} in parents and mimeType = '${FOLDER_MIME}' and trashed = false`
  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name)',
    pageSize: '10',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })
  const res = await fetch(`${DRIVE_API}/files?${params}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw await driveError(res, 'folder search')
  const body = (await res.json()) as { files?: Array<{ id: string; name: string }> }
  return body.files?.[0]?.id ?? null
}

async function createFolder(name: string, parentId: string): Promise<string> {
  const token = await getDriveAccessToken()
  const res = await fetch(`${DRIVE_API}/files?supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  })
  if (!res.ok) throw await driveError(res, 'folder create')
  const body = (await res.json()) as { id: string }
  return body.id
}

/** Find a folder by name under a parent, creating it when missing. */
export async function findOrCreateFolder(name: string, parentId: string): Promise<string> {
  const existing = await findFolder(name, parentId)
  if (existing) return existing
  try {
    return await createFolder(name, parentId)
  } catch (err) {
    // Two runs can race to create the same folder. Look again before giving up.
    const again = await findFolder(name, parentId)
    if (again) return again
    throw err
  }
}

/** Public link for a Drive file id. */
export function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`
}

/** Find a file (not a folder) by exact name in a folder. */
async function findFileByName(name: string, folderId: string): Promise<string | null> {
  const token = await getDriveAccessToken()
  const query = `name = ${q(name)} and ${q(folderId)} in parents and mimeType != '${FOLDER_MIME}' and trashed = false`
  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name)',
    pageSize: '10',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })
  const res = await fetch(`${DRIVE_API}/files?${params}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw await driveError(res, 'file search')
  const body = (await res.json()) as { files?: Array<{ id: string }> }
  return body.files?.[0]?.id ?? null
}

/** Overwrite a file's PDF content. Returns false when Drive says the file no longer exists. */
async function replaceContent(fileId: string, bytes: Uint8Array): Promise<boolean> {
  const token = await getDriveAccessToken()
  const res = await fetch(
    `${UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true&fields=id`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' },
      body: Buffer.from(bytes),
    },
  )
  if (res.status === 404) return false
  if (!res.ok) throw await driveError(res, 'file update')
  return true
}

async function createPdf(name: string, folderId: string, bytes: Uint8Array): Promise<string> {
  const token = await getDriveAccessToken()
  const boundary = `xcms${randomUUID()}`
  const metadata = JSON.stringify({ name, parents: [folderId], mimeType: 'application/pdf' })
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--`),
  ])
  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  if (!res.ok) throw await driveError(res, 'file upload')
  const created = (await res.json()) as { id: string }
  return created.id
}

/**
 * Put a PDF in a folder without making duplicates:
 *  1. known file id (from an earlier upload) → overwrite that file's content;
 *  2. otherwise a file with the same name already in the folder (left behind
 *     by a run that uploaded but did not record it) → overwrite that one;
 *  3. otherwise create it.
 */
export async function uploadOrReplacePdf(params: {
  folderId: string
  name: string
  bytes: Uint8Array
  existingFileId?: string | null
}): Promise<string> {
  const { folderId, name, bytes, existingFileId } = params
  if (existingFileId && (await replaceContent(existingFileId, bytes))) return existingFileId

  const sameName = await findFileByName(name, folderId)
  if (sameName && (await replaceContent(sameName, bytes))) return sameName

  return createPdf(name, folderId, bytes)
}
