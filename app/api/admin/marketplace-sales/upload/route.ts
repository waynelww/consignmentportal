/**
 * POST /api/admin/marketplace-sales/upload
 * Ingests rows parsed in the browser from a Shopee / TikTok Shop order
 * export (performance dashboard channel data). Replace-not-append: existing
 * marketplace_sales rows for the uploaded (platform, order_id) set are
 * deleted first, so re-uploading the same export is harmless.
 *
 * Deliberately separate from the Gang order upload — that flow has
 * verification side effects (tickets, first-timer perks) and keeps no money.
 */
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 60

const RowSchema = z.object({
  order_id: z.string().min(1).max(100),
  order_date_myt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sku: z.string().max(100).nullable().optional(),
  product_name: z.string().max(500).nullable().optional(),
  quantity: z.number().int().min(0).max(100000),
  line_revenue: z.number().min(0).max(10_000_000),
  settlement_amount: z.number().min(-10_000_000).max(10_000_000).nullable().optional(),
  status: z.string().max(100).nullable().optional(),
})

const BodySchema = z.object({
  platform: z.enum(['shopee', 'tiktok']),
  filename: z.string().max(300).nullable().optional(),
  rows: z.array(RowSchema).min(1).max(20000),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || (profile.role !== 'super_admin' && profile.role !== 'ops_manager')) {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await request.json())
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? 'Invalid payload' : 'Invalid JSON'
    return Response.json({ error: message }, { status: 400 })
  }

  // marketplace tables have RLS with no policies — service role only.
  const service = await createServiceClient()

  const dates = body.rows.map((r) => r.order_date_myt).sort()
  const { data: batch, error: batchErr } = await service
    .from('marketplace_upload_batches')
    .insert({
      platform: body.platform,
      filename: body.filename ?? null,
      rows_ingested: body.rows.length,
      date_min: dates[0],
      date_max: dates[dates.length - 1],
      uploaded_by: user.id,
    })
    .select('id')
    .single()
  if (batchErr || !batch) {
    return Response.json({ error: `Batch insert failed: ${batchErr?.message ?? 'unknown'}` }, { status: 500 })
  }

  // Replace existing rows for these orders (chunked — .in() with thousands
  // of ids makes an oversized query string).
  const orderIds = [...new Set(body.rows.map((r) => r.order_id))]
  const CHUNK = 200
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const { error: delErr } = await service
      .from('marketplace_sales')
      .delete()
      .eq('platform', body.platform)
      .in('order_id', orderIds.slice(i, i + CHUNK))
    if (delErr) {
      return Response.json({ error: `Replace step failed: ${delErr.message}` }, { status: 500 })
    }
  }

  const inserts = body.rows.map((r) => ({
    platform: body.platform,
    order_id: r.order_id,
    order_date_myt: r.order_date_myt,
    sku: r.sku ? r.sku.trim().toUpperCase() : null,
    product_name: r.product_name ?? null,
    quantity: r.quantity,
    line_revenue: r.line_revenue,
    settlement_amount: r.settlement_amount ?? null,
    status: r.status ?? null,
    upload_batch_id: batch.id,
  }))
  for (let i = 0; i < inserts.length; i += 500) {
    const { error: insErr } = await service.from('marketplace_sales').insert(inserts.slice(i, i + 500))
    if (insErr) {
      return Response.json({ error: `Insert failed: ${insErr.message}` }, { status: 500 })
    }
  }

  return Response.json({
    ok: true,
    batch_id: batch.id,
    rows_ingested: inserts.length,
    orders: orderIds.length,
    date_min: dates[0],
    date_max: dates[dates.length - 1],
  })
}
