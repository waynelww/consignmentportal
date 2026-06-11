/**
 * GET /api/payments/receipts/upload-url
 *   ?period_id=UUID&filename=receipt.jpg&content_type=image/jpeg
 *
 * Returns a short-lived signed upload URL so the browser can PUT the file
 * directly to Supabase Storage without relying on storage RLS policies.
 * The service-role client generates the URL, so no RLS is involved.
 */
import { type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
])

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id, stores:stores(store_code)')
    .eq('id', user.id)
    .single()
  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })
  if (profile.role !== 'store_owner') {
    return Response.json({ error: 'Store owners only' }, { status: 403 })
  }

  const storeArr = profile.stores as { store_code: string }[] | { store_code: string } | null
  const storeCode = (Array.isArray(storeArr) ? storeArr[0] : storeArr)?.store_code
  if (!storeCode) return Response.json({ error: 'Store not found' }, { status: 403 })

  const { searchParams } = request.nextUrl
  const periodId = searchParams.get('period_id')
  const filename = (searchParams.get('filename') ?? 'receipt').replace(/[^a-zA-Z0-9._-]/g, '_')
  const contentType = searchParams.get('content_type') ?? ''

  if (!periodId) return Response.json({ error: 'period_id required' }, { status: 400 })
  if (!ALLOWED_TYPES.has(contentType)) {
    return Response.json({ error: 'File type not allowed' }, { status: 400 })
  }

  // Verify the period belongs to this store
  const { data: period } = await supabase
    .from('commission_periods')
    .select('id, store_id, period_year, period_month')
    .eq('id', periodId)
    .single()
  if (!period || period.store_id !== profile.store_id) {
    return Response.json({ error: 'Period not found' }, { status: 403 })
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg'
  const path = `${storeCode}/${period.period_year}-${String(period.period_month).padStart(2, '0')}-${user.id.slice(0, 8)}-${Date.now()}.${ext}`

  const svc = await createServiceClient()
  const { data, error } = await svc.storage
    .from('payment-receipts')
    .createSignedUploadUrl(path)

  if (error || !data) {
    return Response.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 })
  }

  return Response.json({ signedUrl: data.signedUrl, token: data.token, path })
}
