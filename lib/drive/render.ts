// Builds the PDF for one DO or invoice, for the Drive worker. Runs with the
// service client (no user session), so it reads the same data the store-facing
// PDF routes read, and produces the same document:
//   - a stored copy (signed DO / downloaded invoice) is uploaded as-is, the same
//     document the store sees; if it cannot be read the job fails and retries,
//     so Drive never gets a different version from the store's;
//   - otherwise the PDF is generated from the data now.
// A DO copy is the signed PDF once the store has signed it, else the normal DO PDF.

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateDOPdf } from '@/lib/pdf/generate-do'
import { generateStatementPdf } from '@/lib/pdf/generate-statement'
import { BANK_SETTING_KEYS } from '@/lib/pdf/bank-details'
import { assignInvoiceNo, formatInvoiceNo } from '@/lib/invoice-number'
import { deliveryOrderCopyWanted, selectAll } from './queue'
import { doFileName, invoiceFileName, storeFolderName, subfolderFor, type DriveKind } from './layout'

export interface RenderedFile {
  bytes: Uint8Array
  fileName: string
  folderName: string   // e.g. "XCSM-..." store folder: "AGK-001 Wayne Store"
  subfolder: string    // "Delivery Orders" | "Invoices"
}

const TZ = 'Asia/Kuala_Lumpur'
function mytDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('en-MY', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ })
}

export async function renderRecord(svc: SupabaseClient, kind: DriveKind, recordId: string): Promise<RenderedFile | null> {
  return kind === 'delivery_order' ? renderDeliveryOrder(svc, recordId) : renderInvoice(svc, recordId)
}

// ── Delivery orders ──────────────────────────────────────────────────────────

/**
 * A received DO (status acknowledged). Uploads the stored signed PDF when the
 * store has signed it; otherwise the normal DO PDF generated from the data now.
 * When the store signs later, the signing step re-queues it and the Drive file
 * is replaced with the signed copy. Returns null when the DO is not acknowledged
 * (the worker leaves the row pending and does not count it as a failure).
 */
export async function renderDeliveryOrder(svc: SupabaseClient, doId: string): Promise<RenderedFile | null> {
  const { data: d, error } = await svc
    .from('delivery_orders')
    .select(`
      *,
      stores:store_id (
        store_name, store_code, pic_name, address, city, postcode, state, pic_phone,
        shipment_address, shipment_contact, shipment_pic
      ),
      delivery_order_items (
        id, quantity, unit_cost,
        products:product_id ( name, sku )
      )
    `)
    .eq('id', doId)
    .single()
  if (error || !d) throw new Error('Delivery order not found')
  if (!deliveryOrderCopyWanted(d.status as string)) return null

  const store = d.stores as unknown as {
    store_name: string; store_code: string; pic_name: string; address: string; city: string
    postcode: string; state: string; pic_phone: string
    shipment_address: string | null; shipment_contact: string | null; shipment_pic: string | null
  } | null
  if (!store) throw new Error('Store data not found')

  const base = {
    fileName: doFileName(d.do_number as string),
    folderName: storeFolderName(store.store_code, store.store_name),
    subfolder: subfolderFor('delivery_order'),
  }

  if (d.pdf_url) {
    const { data: file, error: dlErr } = await svc.storage.from('do-documents').download(d.pdf_url as string)
    if (dlErr || !file) throw new Error('Signed delivery order could not be read from storage')
    return { ...base, bytes: new Uint8Array(await file.arrayBuffer()) }
  }

  const { data: settingsRows } = await svc
    .from('settings')
    .select('key, value')
    .in('key', ['company_name', 'company_address', 'company_phone', 'company_email'])
  const settings: Record<string, string> = {}
  for (const s of settingsRows ?? []) settings[s.key] = s.value

  type ItemRaw = { quantity: number; unit_cost: number; products: { name: string; sku: string } | null }
  const items = ((d.delivery_order_items as ItemRaw[]) ?? []).map((i) => ({
    name: i.products?.name ?? 'Unknown Product',
    sku: i.products?.sku ?? '-',
    quantity: i.quantity,
    unitCost: i.unit_cost,
  }))

  const bytes = await generateDOPdf({
    doNumber: d.do_number as string,
    createdAt: mytDate(d.created_at as string),
    status: d.status as string,
    storeName: store.store_name,
    storeCode: store.store_code,
    picName: store.pic_name,
    address: store.address,
    city: store.city,
    postcode: store.postcode,
    state: store.state,
    picPhone: store.pic_phone,
    shipment: { address: store.shipment_address, contact: store.shipment_contact, pic: store.shipment_pic },
    courier: (d.courier as string | null) ?? undefined,
    trackingNumber: (d.tracking_number as string | null) ?? undefined,
    dispatchDate: d.dispatch_date ? mytDate(d.dispatch_date as string) : undefined,
    items,
    companyName: settings['company_name'] ?? 'Wayne Group Holding Sdn Bhd',
    companyAddress: settings['company_address'] ?? '',
    companyPhone: settings['company_phone'] ?? '',
    companyEmail: settings['company_email'] ?? 'info@xocks.co',
    showCosts: true, // Drive is internal: cost prices shown
  })
  return { ...base, bytes }
}

// ── Monthly invoices ─────────────────────────────────────────────────────────

const COMMISSION_BUCKET = 'commission-pdfs'

export async function renderInvoice(svc: SupabaseClient, periodId: string): Promise<RenderedFile> {
  const { data: p, error } = await svc
    .from('commission_periods')
    .select(`
      *,
      stores:store_id (
        store_name, store_code, pic_name, email, address, city, state, commission_rate
      )
    `)
    .eq('id', periodId)
    .single()
  if (error || !p) throw new Error('Commission period not found')

  const store = p.stores as {
    store_name: string; store_code: string; pic_name: string; email: string | null
    address: string | null; city: string | null; state: string | null; commission_rate: number
  } | null
  if (!store) throw new Error('Store data not found')

  // Invoice numbers are assigned at generation; assign now if that step failed.
  let invoiceNoInt = p.invoice_no as number | null
  if (!invoiceNoInt) invoiceNoInt = await assignInvoiceNo(svc, periodId)
  const invoiceNo = formatInvoiceNo(invoiceNoInt)
  if (!invoiceNo) throw new Error('Invoice number could not be assigned')

  const base = {
    fileName: invoiceFileName(invoiceNo, p.period_month as number, p.period_year as number),
    folderName: storeFolderName(store.store_code, store.store_name),
    subfolder: subfolderFor('invoice'),
  }

  // The store's stored copy (created on first download) is the document they hold.
  if (p.pdf_url) {
    const { data: file, error: dlErr } = await svc.storage.from(COMMISSION_BUCKET).download(p.pdf_url as string)
    if (dlErr || !file) throw new Error('Stored invoice could not be read from storage')
    return { ...base, bytes: new Uint8Array(await file.arrayBuffer()) }
  }

  const { data: settingsRows } = await svc
    .from('settings')
    .select('key, value')
    .in('key', ['company_name', 'company_address', 'company_contact', ...Object.values(BANK_SETTING_KEYS)])
  const settings: Record<string, string> = {}
  for (const row of settingsRows ?? []) settings[row.key] = row.value

  const { data: terms } = await svc.from('stores').select('payment_terms_days').eq('id', p.store_id).single()
  const paymentTermsDays =
    terms && typeof (terms as Record<string, unknown>).payment_terms_days === 'number'
      ? ((terms as Record<string, unknown>).payment_terms_days as number)
      : 7

  const startDate = `${p.period_year}-${String(p.period_month).padStart(2, '0')}-01`
  const endYear = p.period_month === 12 ? p.period_year + 1 : p.period_year
  const endMonth = p.period_month === 12 ? 1 : p.period_month + 1
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`

  type SaleRaw = {
    quantity: number; unit_price: number; total_amount: number; commission_amount: number
    products: { name: string; sku: string } | null
    staff: { name: string } | null
  }
  const sales = await selectAll<SaleRaw>((from, to) =>
    svc
      .from('sales')
      .select('quantity, unit_price, total_amount, commission_amount, products:product_id(name, sku), staff:store_staff_id(name)')
      .eq('store_id', p.store_id)
      .gte('sale_date', startDate)
      .lt('sale_date', endDate)
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: SaleRaw[] | null; error: { message: string } | null }>,
  )

  const lineMap = new Map<string, {
    productName: string; sku: string; keyedInBy: string; unitsSold: number
    unitPrice: number; revenue: number; commission: number
  }>()
  for (const sale of sales) {
    const sku = sale.products?.sku ?? 'UNKNOWN'
    const keyedInBy = sale.staff?.name ?? '-'
    const key = `${sku}|${keyedInBy}`
    const ex = lineMap.get(key)
    if (ex) {
      ex.unitsSold += sale.quantity
      ex.revenue += sale.total_amount
      ex.commission += sale.commission_amount
    } else {
      lineMap.set(key, {
        productName: sale.products?.name ?? 'Unknown Product',
        sku, keyedInBy, unitsSold: sale.quantity, unitPrice: sale.unit_price,
        revenue: sale.total_amount, commission: sale.commission_amount,
      })
    }
  }

  const issueMonth = p.period_month === 12 ? 1 : (p.period_month as number) + 1
  const issueYear = p.period_month === 12 ? (p.period_year as number) + 1 : (p.period_year as number)
  const generatedDate = new Date(issueYear, issueMonth - 1, 1)
    .toLocaleDateString('en-MY', { day: '2-digit', month: 'long', year: 'numeric' })
  const addressParts = [store.address, store.city, store.state].filter(Boolean)

  const bytes = await generateStatementPdf({
    storeName: store.store_name,
    storeCode: store.store_code,
    picName: store.pic_name,
    invoiceNo,
    storeAddress: addressParts.length > 0 ? addressParts.join(', ') : undefined,
    periodMonth: p.period_month,
    periodYear: p.period_year,
    generatedDate,
    commissionRate: store.commission_rate ?? 30,
    paymentTermsDays,
    companyName: settings['company_name'],
    companyAddress: settings['company_address'],
    companyContact: settings['company_contact'],
    bank: {
      bankName: settings[BANK_SETTING_KEYS.bankName],
      accountName: settings[BANK_SETTING_KEYS.accountName],
      accountNo: settings[BANK_SETTING_KEYS.accountNo],
    },
    items: Array.from(lineMap.values()),
    totalUnits: p.total_units_sold,
    totalRevenue: p.total_revenue,
    totalCommission: p.commission_amount,
    xocksRevenue: p.xocks_revenue,
    status: p.status,
    paymentReference: p.payment_reference ?? undefined,
    paidAt: p.paid_at ? mytDate(p.paid_at) : undefined,
  })
  return { ...base, bytes }
}
