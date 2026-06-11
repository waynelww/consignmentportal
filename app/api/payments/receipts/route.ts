/**
 * POST /api/payments/receipts
 * Store owner registers a payment receipt for a commission period AFTER the
 * file has been uploaded directly to the private 'payment-receipts' storage
 * bucket from the browser (storage RLS limits uploads to the caller's own
 * {store_code}/ folder, and uploading client-side avoids serverless body
 * limits on photo-sized files).
 *
 * Re-submitting for the same period replaces the previous metadata row and
 * resets it to 'submitted' (e.g. after a rejection). Old files stay in the
 * bucket for audit.
 */
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const Schema = z.object({
  commission_period_id: z.string().uuid(),
  file_path: z.string().min(3).max(500),
  file_name: z.string().max(255).optional().nullable(),
  mime_type: z.string().max(100).optional().nullable(),
  file_size: z.number().int().positive().max(10 * 1024 * 1024).optional().nullable(),
  bank_reference: z.string().max(120).optional().nullable(),
  transfer_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  store_notes: z.string().max(500).optional().nullable(),
})

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
    return Response.json({ error: 'Forbidden: store owners only' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const svc = await createServiceClient()

  // The period must belong to the caller's store and must not already be paid
  const { data: period } = await svc
    .from('commission_periods')
    .select('id, store_id, status, period_month, period_year, xocks_revenue')
    .eq('id', parsed.data.commission_period_id)
    .single()

  if (!period) return Response.json({ error: 'Invoice not found' }, { status: 404 })
  if (period.store_id !== profile.store_id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (period.status === 'paid') {
    return Response.json({ error: 'This invoice is already marked paid' }, { status: 400 })
  }

  // The uploaded path must live in the caller's own store_code folder
  const { data: store } = await svc
    .from('stores')
    .select('store_code, store_name')
    .eq('id', profile.store_id)
    .single()

  if (!store) return Response.json({ error: 'Store not found' }, { status: 404 })
  if (!parsed.data.file_path.startsWith(`${store.store_code}/`)) {
    return Response.json({ error: 'Invalid file path' }, { status: 400 })
  }

  // Cheap existence check — the metadata row must point at a real object
  const folder = parsed.data.file_path.split('/').slice(0, -1).join('/')
  const fileName = parsed.data.file_path.split('/').pop() ?? ''
  const { data: objects } = await svc.storage
    .from('payment-receipts')
    .list(folder, { search: fileName, limit: 1 })
  if (!objects || objects.length === 0) {
    return Response.json({ error: 'Uploaded file not found — please try again' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { data: receipt, error: upsertErr } = await svc
    .from('payment_receipts')
    .upsert(
      {
        commission_period_id: period.id,
        store_id: profile.store_id,
        file_path: parsed.data.file_path,
        file_name: parsed.data.file_name ?? fileName,
        mime_type: parsed.data.mime_type ?? null,
        file_size: parsed.data.file_size ?? null,
        bank_reference: parsed.data.bank_reference ?? null,
        transfer_date: parsed.data.transfer_date ?? null,
        store_notes: parsed.data.store_notes ?? null,
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

  // Notify both admin roles so whoever handles collections sees it
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
