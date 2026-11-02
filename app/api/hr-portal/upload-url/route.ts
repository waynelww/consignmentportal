/**
 * GET /api/hr-portal/upload-url?filename=receipt.jpg&content_type=image/jpeg
 *
 * Signed upload URL for a claim receipt or MC slip, into the signed-in
 * person's own folder of the private 'hr-documents' bucket, so the phone
 * uploads directly (no serverless body limit). The returned path is then
 * sent with the claim / leave submission.
 */
import { type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { HR_BUCKET, HR_FILE_TYPES } from '@/lib/hr/access'
import { portalMember } from '@/lib/hr/portal-session'

export async function GET(request: NextRequest) {
  const db = await createServiceClient()
  const me = await portalMember(request, db)
  if (!me) return Response.json({ error: 'Signed out' }, { status: 401 })

  const { searchParams } = request.nextUrl
  const filename = (searchParams.get('filename') ?? 'file').replace(/[^a-zA-Z0-9._-]/g, '_')
  const contentType = searchParams.get('content_type') ?? ''
  if (!HR_FILE_TYPES[contentType]) return Response.json({ error: 'Only photos (JPG, PNG, WEBP, HEIC) or PDF' }, { status: 400 })

  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : 'jpg'
  const path = `${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { data, error } = await db.storage.from(HR_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return Response.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 })
  return Response.json({ signedUrl: data.signedUrl, token: data.token, path })
}
