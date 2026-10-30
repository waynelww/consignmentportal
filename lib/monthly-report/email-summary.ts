// The short summary printed in the monthly email body. Built from the same
// MonthlyReport as the attachments.

import { fmtRM } from './pdf'
import type { MonthlyReport } from './compute'

export function summaryForEmail(r: MonthlyReport): { summary: Array<[string, string]>; actionCounts: Array<[string, number]> } {
  const h = r.headline
  return {
    summary: [
      ['Active stores', `${h.activeStores.value} (${h.activeStores.prev} in ${r.prevMonthShort})`],
      ['Total sales', `${fmtRM(h.sales.value)} (${fmtRM(h.sales.prev)} in ${r.prevMonthShort})`],
      ['Pairs sold', `${h.pairs.value} (${h.pairs.prev} in ${r.prevMonthShort})`],
      ['Xocks revenue', `${fmtRM(h.xocksRevenue.value)} (${fmtRM(h.xocksRevenue.prev)} in ${r.prevMonthShort})`],
      ['Invoices', `${h.invoicesPaid} paid · ${h.invoicesPending} pending (${fmtRM(h.pendingRm)} to collect by ${r.paymentDueLabel})`],
    ],
    actionCounts: r.actions.map((a) => [`${a.badge} — ${a.title}`, a.rows.length]),
  }
}
