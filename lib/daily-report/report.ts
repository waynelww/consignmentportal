// Reads one store's sales for one day and turns them into the daily PDF.
// Server only (database reads and the PDF). The maths is in aggregate.ts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateStatementPdf } from '@/lib/pdf/generate-statement'
import { todayMYT } from '@/lib/sales/last-sale'
import { aggregateSaleLines, sumTotals, type DailyReportTotals, type DailySaleLine, type DailySaleRow } from './aggregate'
import { reportDateLabel } from './settings'

/** The store fields the report needs: identity, address and commission rate. */
export interface DailyStoreFields {
  id: string
  store_code: string
  store_name: string
  pic_name: string
  address: string | null
  city: string | null
  state: string | null
  commission_rate: number | null
}

export interface DailyStoreReport {
  store: DailyStoreFields
  date: string
  lines: DailySaleLine[]
  totals: DailyReportTotals
}

export interface CompanyFields {
  companyName?: string
  companyAddress?: string
  companyContact?: string
}

/**
 * The store's sales for one day, keyed in before `cutoffIso`. Null when there
 * are no sales, so the caller can skip the store.
 */
export async function loadDailyStoreReport(
  db: SupabaseClient,
  store: DailyStoreFields,
  date: string,
  cutoffIso: string,
): Promise<DailyStoreReport | null> {
  const { data, error } = await db
    .from('sales')
    .select('quantity, unit_price, total_amount, commission_amount, products:product_id(name, sku), staff:store_staff_id(name)')
    .eq('store_id', store.id)
    .eq('sale_date', date)
    .lt('created_at', cutoffIso)
  if (error) throw new Error(`Could not read sales for ${store.store_code}: ${error.message}`)

  const rows = (data ?? []) as unknown as DailySaleRow[]
  if (rows.length === 0) return null

  const lines = aggregateSaleLines(rows)
  return { store, date, lines, totals: sumTotals(lines) }
}

/** Company name, address and contact from the settings table (the invoice header). */
export async function loadCompanyFields(db: SupabaseClient): Promise<CompanyFields> {
  const { data } = await db
    .from('settings')
    .select('key, value')
    .in('key', ['company_name', 'company_address', 'company_contact'])
  const map: Record<string, string> = {}
  for (const row of data ?? []) map[row.key] = row.value
  return {
    companyName: map['company_name'],
    companyAddress: map['company_address'],
    companyContact: map['company_contact'],
  }
}

/** The daily PDF: the commission invoice layout, without invoice number, status or bank details. */
export function buildDailyReportPdf(report: DailyStoreReport, company: CompanyFields): Promise<Uint8Array> {
  const { store, date, lines, totals } = report
  const [year, month] = date.split('-').map(Number)
  const addressParts = [store.address, store.city, store.state].filter(Boolean)

  return generateStatementPdf({
    storeName: store.store_name,
    storeCode: store.store_code,
    picName: store.pic_name,
    storeAddress: addressParts.length > 0 ? addressParts.join(', ') : undefined,
    periodMonth: month,
    periodYear: year,
    generatedDate: reportDateLabel(todayMYT()),
    commissionRate: store.commission_rate ?? 30,
    ...company,
    items: lines,
    totalUnits: totals.totalUnits,
    totalRevenue: totals.totalRevenue,
    totalCommission: totals.totalCommission,
    xocksRevenue: totals.xocksRevenue,
    daily: { salesDate: reportDateLabel(date) },
  })
}
