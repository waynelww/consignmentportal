import type { SupabaseClient } from '@supabase/supabase-js'
import { HR_BUCKET, HR_FILE_TYPES } from './access'

/**
 * Streams a claim receipt or MC slip from the private bucket. Pass ownerId to
 * only serve that person's own file (the /hr link); omit it for the admin.
 * The content type comes from a fixed allowlist, never from the stored value.
 */
export async function streamHrFile(db: SupabaseClient, kind: string, id: string, ownerId?: string): Promise<Response> {
  let row: { member_id: string; path: string | null; type: string | null; name: string | null } | null = null
  if (kind === 'claim') {
    const { data } = await db.from('hr_claims').select('member_id, receipt_path, receipt_type, receipt_name').eq('id', id).maybeSingle()
    if (data) row = { member_id: data.member_id, path: data.receipt_path, type: data.receipt_type, name: data.receipt_name }
  } else if (kind === 'leave') {
    const { data } = await db.from('hr_leaves').select('member_id, attachment_path, attachment_type, attachment_name').eq('id', id).maybeSingle()
    if (data) row = { member_id: data.member_id, path: data.attachment_path, type: data.attachment_type, name: data.attachment_name }
  }
  if (!row?.path || (ownerId && row.member_id !== ownerId)) return Response.json({ error: 'No file' }, { status: 404 })

  const { data: blob, error } = await db.storage.from(HR_BUCKET).download(row.path)
  if (error || !blob) return Response.json({ error: 'File not found in storage' }, { status: 404 })

  const safeType = (row.type && HR_FILE_TYPES[row.type]) || 'application/octet-stream'
  const disposition = safeType === 'application/octet-stream' ? 'attachment' : 'inline'
  const filename = (row.name ?? row.path.split('/').pop() ?? 'file').replace(/[^a-zA-Z0-9._-]/g, '_')
  return new Response(blob, {
    headers: {
      'Content-Type': safeType,
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
