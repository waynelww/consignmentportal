/**
 * GET /api/payments/receipts/[receiptId]/file
 * Streams the receipt file from the private bucket. Mirrors the commission
 * PDF proxy pattern: session auth, then store owners can only fetch their own
 * store's receipts; admins can fetch any.
 */
import { type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ receiptId: string }> },
) {
  const { receiptId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()
  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })

  const svc = await createServiceClient()
  const { data: receipt } = await svc
    .from('payment_receipts')
    .select('id, store_id, file_path, file_name, mime_type')
    .eq('id', receiptId)
    .single()

  if (!receipt) return Response.json({ error: 'Receipt not found' }, { status: 404 })

  const isAdmin = profile.role === 'super_admin' || profile.role === 'ops_manager'
  if (!isAdmin && profile.store_id !== receipt.store_id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: blob, error } = await svc.storage
    .from('payment-receipts')
    .download(receipt.file_path)

  if (error || !blob) {
    return Response.json({ error: 'File not found in storage' }, { status: 404 })
  }

  const bytes = await blob.arrayBuffer()
  return new Response(bytes, {
    headers: {
      'Content-Type': receipt.mime_type ?? 'application/octet-stream',
      'Content-Disposition': `inline; filename="${(receipt.file_name ?? 'receipt').replace(/"/g, '')}"`,
      'Cache-Control': 'private, max-age=300',
    },
  })
}
