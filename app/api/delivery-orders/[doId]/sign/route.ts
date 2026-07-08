import { type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { generateDOPdf } from '@/lib/pdf/generate-do'

const BUCKET = 'do-documents'
// A drawn signature PNG is typically 5–50 KB; 500 KB is a generous ceiling
const MAX_SIGNATURE_CHARS = 700_000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ doId: string }> }
) {
  const { doId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'store_owner') {
    return Response.json({ error: 'Only store owners can sign delivery orders' }, { status: 403 })
  }

  let body: { signature?: unknown } = {}
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const signature = typeof body.signature === 'string' ? body.signature : ''
  if (!signature.startsWith('data:image/png;base64,')) {
    return Response.json({ error: 'Signature must be a PNG image' }, { status: 400 })
  }
  if (signature.length > MAX_SIGNATURE_CHARS) {
    return Response.json({ error: 'Signature image too large' }, { status: 400 })
  }
  const pngBase64 = signature.slice('data:image/png;base64,'.length)

  // ── Fetch DO with store + items ───────────────────────────────────────────────
  const { data: deliveryOrder, error: doErr } = await supabase
    .from('delivery_orders')
    .select(`
      *,
      stores:store_id (
        store_name, store_code, pic_name, address, city, postcode, state, pic_phone
      ),
      delivery_order_items (
        id, quantity, unit_cost,
        products:product_id ( name, sku )
      )
    `)
    .eq('id', doId)
    .single()

  if (doErr || !deliveryOrder) {
    return Response.json({ error: 'Delivery order not found' }, { status: 404 })
  }
  if (deliveryOrder.store_id !== profile.store_id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (deliveryOrder.status !== 'acknowledged') {
    return Response.json({ error: 'Receive the stock first, then sign' }, { status: 400 })
  }
  if (deliveryOrder.pdf_url) {
    return Response.json({ error: 'This delivery order is already signed' }, { status: 409 })
  }

  const store = deliveryOrder.stores as {
    store_name: string; store_code: string; pic_name: string
    address: string; city: string; postcode: string; state: string; pic_phone: string
  } | null
  if (!store) return Response.json({ error: 'Store data not found' }, { status: 500 })

  // ── Company settings ──────────────────────────────────────────────────────────
  const { data: settings } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['company_name', 'company_address', 'company_phone', 'company_email'])
  const settingsMap: Record<string, string> = {}
  for (const s of settings ?? []) settingsMap[s.key] = s.value

  type DOItemRaw = { id: string; quantity: number; unit_cost: number; products: { name: string; sku: string } | null }
  const items = ((deliveryOrder.delivery_order_items as DOItemRaw[]) ?? []).map((item) => ({
    name: item.products?.name ?? 'Unknown Product',
    sku: item.products?.sku ?? '-',
    quantity: item.quantity,
    unitCost: item.unit_cost,
  }))

  const fmtDate = (d: string | Date) =>
    new Date(d).toLocaleDateString('en-MY', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const signedAt = new Date()

  // ── Generate the signed PDF (store copy — quantities only) ────────────────────
  const pdfBytes = await generateDOPdf({
    doNumber: deliveryOrder.do_number,
    createdAt: fmtDate(deliveryOrder.created_at),
    status: deliveryOrder.status,
    storeName: store.store_name,
    storeCode: store.store_code,
    picName: store.pic_name,
    address: store.address,
    city: store.city,
    postcode: store.postcode,
    state: store.state,
    picPhone: store.pic_phone,
    courier: deliveryOrder.courier ?? undefined,
    trackingNumber: deliveryOrder.tracking_number ?? undefined,
    dispatchDate: deliveryOrder.dispatch_date ? fmtDate(deliveryOrder.dispatch_date) : undefined,
    items,
    companyName: settingsMap['company_name'] ?? 'Wayne Group Holding Sdn Bhd',
    companyAddress: settingsMap['company_address'] ?? '',
    companyPhone: settingsMap['company_phone'] ?? '',
    companyEmail: settingsMap['company_email'] ?? 'info@xocks.co',
    showCosts: false,
    signature: {
      pngBase64,
      signedBy: store.pic_name,
      signedAt: fmtDate(signedAt),
    },
  })

  // ── Store it and mark the DO as signed ────────────────────────────────────────
  const svc = await createServiceClient()
  const storagePath = `${store.store_code}/${doId}.pdf`

  await svc.storage.createBucket(BUCKET, { public: false }).catch(() => {/* already exists */})

  const { error: upErr } = await svc.storage
    .from(BUCKET)
    .upload(storagePath, Buffer.from(pdfBytes), { contentType: 'application/pdf', upsert: false })

  if (upErr && !upErr.message?.includes('already exists')) {
    return Response.json({ error: 'Failed to store signed document', details: upErr.message }, { status: 500 })
  }

  const { error: updateErr } = await svc
    .from('delivery_orders')
    .update({ pdf_url: storagePath })
    .eq('id', doId)
    .is('pdf_url', null) // never overwrite an existing signed doc

  if (updateErr) {
    return Response.json({ error: 'Failed to save signed status' }, { status: 500 })
  }

  // Tell the admins — signing is the store's receipt confirmation
  await svc.from('notifications').insert({
    recipient_role: 'super_admin',
    recipient_store_id: null,
    type: 'do_delivered',
    title: 'DO Signed',
    message: `${store.store_name} (${store.store_code}) signed ${deliveryOrder.do_number} — the signed document is now available.`,
    reference_id: doId,
    reference_type: 'delivery_order',
    is_read: false,
  })

  return Response.json({ success: true })
}
