import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateDOPdf } from '@/lib/pdf/generate-do'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ doId: string }> }
) {
  const inline = _request.nextUrl.searchParams.has('inline')
  const { doId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })

  // ── Fetch delivery order with items and store ────────────────────────────────
  const { data: deliveryOrder, error: doErr } = await supabase
    .from('delivery_orders')
    .select(`
      *,
      stores:store_id (
        store_name,
        store_code,
        pic_name,
        address,
        city,
        postcode,
        state,
        pic_phone
      ),
      delivery_order_items (
        id,
        quantity,
        unit_cost,
        products:product_id (
          name,
          sku
        )
      )
    `)
    .eq('id', doId)
    .single()

  if (doErr || !deliveryOrder) {
    return Response.json({ error: 'Delivery order not found' }, { status: 404 })
  }

  // ── Authorization ────────────────────────────────────────────────────────────
  if (profile.role === 'store_owner') {
    if (deliveryOrder.store_id !== profile.store_id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Fetch company settings ────────────────────────────────────────────────────
  const { data: settings } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['company_name', 'company_address', 'company_phone', 'company_email'])

  const settingsMap: Record<string, string> = {}
  for (const s of settings ?? []) {
    settingsMap[s.key] = s.value
  }

  // ── Build PDF params ──────────────────────────────────────────────────────────
  const store = deliveryOrder.stores as {
    store_name: string
    store_code: string
    pic_name: string
    address: string
    city: string
    postcode: string
    state: string
    pic_phone: string
  } | null

  if (!store) {
    return Response.json({ error: 'Store data not found' }, { status: 500 })
  }

  type DOItemRaw = {
    id: string
    quantity: number
    unit_cost: number
    products: { name: string; sku: string } | null
  }

  const rawItems = (deliveryOrder.delivery_order_items as DOItemRaw[]) ?? []

  const items = rawItems.map((item) => ({
    name: item.products?.name ?? 'Unknown Product',
    sku: item.products?.sku ?? '-',
    quantity: item.quantity,
    unitCost: item.unit_cost,
  }))

  const createdAt = new Date(deliveryOrder.created_at).toLocaleDateString('en-MY', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

  const dispatchDate = deliveryOrder.dispatch_date
    ? new Date(deliveryOrder.dispatch_date).toLocaleDateString('en-MY', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : undefined

  const pdfBytes = await generateDOPdf({
    doNumber: deliveryOrder.do_number,
    createdAt,
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
    dispatchDate,
    items,
    companyName: settingsMap['company_name'] ?? 'Wayne Group Holding Sdn Bhd',
    companyAddress: settingsMap['company_address'] ?? '',
    companyPhone: settingsMap['company_phone'] ?? '',
    companyEmail: settingsMap['company_email'] ?? 'info@xocks.co',
    // Store owners get the quantities-only copy — internal cost prices stay internal
    showCosts: profile.role !== 'store_owner',
  })

  const disposition = inline ? 'inline' : 'attachment'
  return new Response(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="DO-${deliveryOrder.do_number}.pdf"`,
      'Content-Length': String(pdfBytes.length),
    },
  })
}
