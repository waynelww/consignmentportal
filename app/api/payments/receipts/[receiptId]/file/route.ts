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

  // Never trust the stored mime_type — map to a hardcoded allowlist so an
  // attacker who uploads HTML bytes and registers mime_type:'text/html' can't
  // get same-origin script execution when an admin opens the review modal.
  const SAFE_TYPES: Record<string, string> = {
    'image/jpeg': 'image/jpeg',
    'image/png': 'image/png',
    'image/webp': 'image/webp',
    'image/heic': 'image/heic',
    'application/pdf': 'application/pdf',
  }
  const safeType = (receipt.mime_type && SAFE_TYPES[receipt.mime_type]) || 'application/octet-stream'
  const disposition = safeType === 'application/octet-stream' ? 'attachment' : 'inline'
  const safeName = (receipt.file_name ?? 'receipt').replace(/[^a-zA-Z0-9._-]/g, '_')

  const bytes = await blob.arrayBuffer()
  return new Response(bytes, {
    headers: {
      'Content-Type': safeType,
      'Content-Disposition': `${disposition}; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
    },
  })
}
