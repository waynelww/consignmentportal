// Sends the daily sales report for a set of recipient groups (one group per
// address, from groupStoresByRecipient). Used by the 22:00 cron, in batches,
// and by the store page's test send.
//
// Per group: read each store's sales for the day, skip stores with none, build
// one PDF per store, send one email with those PDFs, then log every store
// outcome for that address before moving on to the next.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendDailySalesReportEmail } from '@/lib/email/send-email'
import type { RecipientGroup, ReportStoreRef } from './aggregate'
import { buildDailyReportPdf, loadCompanyFields, loadDailyStoreReport, type CompanyFields, type DailyStoreFields, type DailyStoreReport } from './report'
import { recordDailySends, errorText, type DailyReportKind, type DailySendEntry } from './send-log'
import { reportDateLabel } from './settings'

export type DeliveryStatus = 'sent' | 'failed' | 'skipped'

export interface DeliveryResult {
  to: string
  /** Store codes that had sales and were part of this address's email. */
  stores: string[]
  status: DeliveryStatus
  error?: string
}

export async function deliverDailyReports(
  db: SupabaseClient,
  params: {
    date: string
    cutoffIso: string
    groups: RecipientGroup<DailyStoreFields & ReportStoreRef>[]
    kind: DailyReportKind
    createdBy?: string | null
  },
): Promise<DeliveryResult[]> {
  const company: CompanyFields = await loadCompanyFields(db)
  const reports = new Map<string, DailyStoreReport | null>()
  const results: DeliveryResult[] = []

  for (const group of params.groups) {
    const withSales: Array<{ store: DailyStoreFields; report: DailyStoreReport; pdf: Uint8Array }> = []
    let loadError: string | null = null

    try {
      for (const store of group.stores) {
        if (!reports.has(store.id)) {
          reports.set(store.id, await loadDailyStoreReport(db, store, params.date, params.cutoffIso))
        }
        const report = reports.get(store.id)
        if (!report) continue
        withSales.push({ store, report, pdf: await buildDailyReportPdf(report, company) })
      }
    } catch (err) {
      loadError = errorText(err)
    }

    if (loadError) {
      // Could not read the sales, so we cannot tell which stores had any. Log
      // every store in the group as failed so the failure is visible.
      results.push({ to: group.to, stores: group.stores.map((s) => s.store_code), status: 'failed', error: loadError })
      await recordDailySends(db, group.stores.map((s) => entry(s, group.to, params, 'failed', loadError)))
      continue
    }

    if (withSales.length === 0) {
      results.push({ to: group.to, stores: [], status: 'skipped' })
      continue
    }

    let status: 'sent' | 'failed' = 'sent'
    let error: string | null = null
    try {
      await sendDailySalesReportEmail({
        to: group.to,
        reportDateLabel: reportDateLabel(params.date),
        isTest: params.kind === 'test',
        stores: withSales.map(({ store, report }) => ({
          storeName: store.store_name,
          storeCode: store.store_code,
          totalUnits: report.totals.totalUnits,
          totalRevenue: report.totals.totalRevenue,
        })),
        attachments: withSales.map(({ store, pdf }) => ({
          filename: `Daily-Sales-${params.date}-${store.store_code}.pdf`,
          content: pdf,
        })),
      })
    } catch (err) {
      status = 'failed'
      error = errorText(err)
    }

    results.push({
      to: group.to,
      stores: withSales.map((w) => w.store.store_code),
      status,
      ...(error ? { error } : {}),
    })
    await recordDailySends(db, withSales.map(({ store }) => entry(store, group.to, params, status, error)))
  }

  return results
}

function entry(
  store: DailyStoreFields,
  to: string,
  params: { date: string; kind: DailyReportKind; createdBy?: string | null },
  status: 'sent' | 'failed',
  error: string | null,
): DailySendEntry {
  return {
    store_id: store.id,
    store_code: store.store_code,
    store_name: store.store_name,
    report_date: params.date,
    kind: params.kind,
    recipient: to,
    status,
    error,
    created_by: params.createdBy ?? null,
  }
}
