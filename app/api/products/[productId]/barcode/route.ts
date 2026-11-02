/**
 * POST /api/products/[productId]/barcode  → set a product's barcode
 *   body: { barcode: string, force?: boolean }
 *
 * Admin only (super_admin, ops_manager). Used by "Scan to set barcode" and by
 * the barcode field on the product form.
 *
 * - If another product already has the same code (compared with
 *   normalizeBarcode, so UPC-A and EAN-13 with a leading 0 match), returns 409
 *   with the conflicting product. The admin confirms, then sends force: true.
 * - Saving the same code again (in either form) changes nothing and is not logged.
 * - Otherwise products.barcode and product_barcode_log are written in one
 *   transaction (set_product_barcode), recording who set it, when, and any
 *   conflicting product that was overridden.
 */
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { normalizeBarcode, findByBarcode } from '@/lib/barcode/normalize'

const SetBarcodeSchema = z.object({
  barcode: z.string().max(64),
  force: z.boolean().optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, full_name')
    .eq('id', user.id)
    .single()
  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })
  if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  const { productId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = SetBarcodeSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const raw = parsed.data.barcode.trim()
  if (normalizeBarcode(raw) === null) {
    return Response.json({ error: 'Barcode is empty' }, { status: 400 })
  }

  const db = await createServiceClient()

  const { data: product, error: productErr } = await db
    .from('products')
    .select('id, name, sku, barcode')
    .eq('id', productId)
    .maybeSingle()
  if (productErr) return Response.json({ error: 'Failed to load product' }, { status: 500 })
  if (!product) return Response.json({ error: 'Product not found' }, { status: 404 })

  // Same code as already saved (in any format): nothing to change, nothing to log
  if (normalizeBarcode(product.barcode) === normalizeBarcode(raw)) {
    return Response.json({ ok: true, unchanged: true, product })
  }

  // Duplicate check against every other product that has a barcode
  const { data: others, error: othersErr } = await db
    .from('products')
    .select('id, name, sku, barcode')
    .not('barcode', 'is', null)
    .neq('id', productId)
  if (othersErr) return Response.json({ error: 'Failed to check for duplicates' }, { status: 500 })

  const conflict = findByBarcode(others ?? [], raw) ?? null
  if (conflict && !parsed.data.force) {
    return Response.json(
      {
        error: `Another product already uses this barcode: ${conflict.name} (${conflict.sku})`,
        conflict: { id: conflict.id, name: conflict.name, sku: conflict.sku },
      },
      { status: 409 },
    )
  }

  const { error: setErr } = await db.rpc('set_product_barcode', {
    p_product_id: productId,
    p_barcode: raw,
    p_set_by: profile.id,
    p_set_by_name: profile.full_name,
    p_conflict_product_id: conflict?.id ?? null,
  })
  if (setErr) {
    return Response.json({ error: `Failed to save barcode: ${setErr.message}` }, { status: 500 })
  }

  return Response.json({
    ok: true,
    unchanged: false,
    product: { ...product, barcode: raw },
    previous_barcode: product.barcode,
    overrode: conflict ? { id: conflict.id, name: conflict.name, sku: conflict.sku } : null,
  })
}
