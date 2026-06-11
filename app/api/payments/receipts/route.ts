/**
 * POST /api/payments/receipts  (multipart/form-data)
 *
 * Accepts the file directly — the server uploads it to Supabase Storage using
 * the service-role client (no RLS involved) then registers the metadata row.
 * All in one request; no signed-URL dance needed.
 *
 * FormData fields:
 *   file            — the image/PDF blob
 *   period_id       — UUID of commission_periods row
 *   bank_reference  — optional string
 */
import { type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const MAX_BYTES = 4 * 1024 * 1024   // 4 MB — safe within Vercel's 4.5 MB limit
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
])
const EXT_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png',  webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heic',
  pdf: 'application/pdf',
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()
  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })
  if (profile.role !== 'store_owner' || !profile.store_id) {
    return Response.json({ error: 'Store owners only' }, { status: 403 })
  }

  // Parse multipart
  let formData: FormData
  try { formData = await request.formData() }
  catch { return Response.json({ error: 'Invalid form data' }, { status: 400 }) }

  const file = formData.get('file') as File | null
  const periodId = formData.get('period_id') as string | null
  const bankReference = (formData.get('bank_reference') as string | null)?.trim() || null

  if (!file || typeof file === 'string') {
    return Response.json({ error: 'No file uploaded' }, { status: 400 })
  }
  if (!periodId) {
    return Response.json({ error: 'period_id required' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `File too large — max ${MAX_BYTES / 1024 / 1024} MB` }, { status: 400 })
  }

  // Resolve content-type (extension beats file.type — HEIC often reports empty)
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  const contentType = EXT_MAP[ext] ?? (ALLOWED_TYPES.has(file.type) ? file.type : null)
  if (!contentType) {
    return Response.json({ error: 'File type not allowed — use JPG, PNG, WEBP, HEIC, or PDF' }, { status: 400 })
  }

  const svc = await createServiceClient()

  // Verify the period belongs to this store and is not already paid
  const { data: period } = await svc
    .from('commission_periods')
    .select('id, store_id, status, period_month, period_year, xocks_revenue')
    .eq('id', periodId)
    .single()
  if (!period) return Response.json({ error: 'Invoice not found' }, { status: 404 })
  if (period.store_id !== profile.store_id) return Response.json({ error: 'Forbidden' }, { status: 403 })
  if (period.status === 'paid') return Response.json({ error: 'Invoice already paid' }, { status: 400 })

  const { data: store } = await svc
    .from('stores')
    .select('store_code, store_name')
    .eq('id', profile.store_id)
    .single()
  if (!store) return Response.json({ error: 'Store not found' }, { status: 404 })

  const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${store.store_code}/${period.period_year}-${String(period.period_month).padStart(2, '0')}-${user.id.slice(0, 8)}-${Date.now()}.${ext || 'jpg'}`

  // Upload via service role — bypasses all storage RLS
  const bytes = await file.arrayBuffer()
  const { error: uploadErr } = await svc.storage
    .from('payment-receipts')
    .upload(path, bytes, { contentType, upsert: true })
  if (uploadErr) {
    return Response.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 })
  }

  // Register metadata row (upsert so re-submission replaces the previous one)
  const now = new Date().toISOString()
  const { data: receipt, error: upsertErr } = await svc
    .from('payment_receipts')
    .upsert(
      {
        commission_period_id: period.id,
        store_id: profile.store_id,
        file_path: path,
        file_name: safeFilename,
        mime_type: contentType,
        file_size: file.size,
        bank_reference: bankReference,
        transfer_date: null,
        store_notes: null,
        status: 'submitted',
        admin_notes: null,
        reviewed_by: null,
        reviewed_at: null,
        uploaded_by: user.id,
        updated_at: now,
      },
      { onConflict: 'commission_period_id' },
    )
    .select('*')
    .single()

  if (upsertErr || !receipt) {
    return Response.json({ error: 'Failed to save receipt', details: upsertErr?.message }, { status: 500 })
  }

  // Notify admin roles
  const periodLabel = `${period.period_month}/${period.period_year}`
  const amountStr = `RM ${Number(period.xocks_revenue).toFixed(2)}`
  await Promise.all(
    (['super_admin', 'ops_manager'] as const).map((role) =>
      svc.from('notifications').insert({
        recipient_role: role,
        recipient_store_id: null,
        type: 'payment_receipt_submitted',
        title: 'Payment Receipt Submitted',
        message: `${store.store_name} (${store.store_code}) submitted a receipt for ${periodLabel} — expected ${amountStr}. Review it in Payments.`,
        reference_id: receipt.id,
        reference_type: 'payment_receipt',
        is_read: false,
      }),
    ),
  )

  return Response.json({ success: true, receipt })
}
