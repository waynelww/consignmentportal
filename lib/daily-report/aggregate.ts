// Pure maths for the daily sales report: the sale lines the PDF shows, the
// totals, and how stores are grouped by recipient. No database or email code
// here, so scripts/test-daily-report.ts can pin it.

/** One sale as read from the sales table, with the product and keyed-in staff joined. */
export interface DailySaleRow {
  quantity: number
  unit_price: number
  total_amount: number
  commission_amount: number
  products: { name: string; sku: string } | null
  staff: { name: string } | null
}

/** One PDF line: a product sold by one staff member (or '-' when none recorded). */
export interface DailySaleLine {
  productName: string
  sku: string
  keyedInBy: string
  unitsSold: number
  unitPrice: number
  revenue: number
  commission: number
}

export interface DailyReportTotals {
  totalUnits: number
  totalRevenue: number
  totalCommission: number
  /** What the store transfers to Xocks: revenue minus commission. */
  xocksRevenue: number
}

const money = (n: number) => Math.round(n * 100) / 100

/**
 * Groups sales the same way the monthly invoice does: one line per SKU and
 * keyed-in staff member, in the order each is first seen.
 */
export function aggregateSaleLines(sales: DailySaleRow[]): DailySaleLine[] {
  const lines = new Map<string, DailySaleLine>()
  for (const sale of sales) {
    const sku = sale.products?.sku ?? 'UNKNOWN'
    const keyedInBy = sale.staff?.name ?? '-'
    const key = `${sku}|${keyedInBy}`
    const existing = lines.get(key)
    if (existing) {
      existing.unitsSold += sale.quantity
      existing.revenue = money(existing.revenue + sale.total_amount)
      existing.commission = money(existing.commission + sale.commission_amount)
    } else {
      lines.set(key, {
        productName: sale.products?.name ?? 'Unknown Product',
        sku,
        keyedInBy,
        unitsSold: sale.quantity,
        unitPrice: sale.unit_price,
        revenue: money(sale.total_amount),
        commission: money(sale.commission_amount),
      })
    }
  }
  return [...lines.values()]
}

export function sumTotals(lines: DailySaleLine[]): DailyReportTotals {
  const totalUnits = lines.reduce((sum, l) => sum + l.unitsSold, 0)
  const totalRevenue = money(lines.reduce((sum, l) => sum + l.revenue, 0))
  const totalCommission = money(lines.reduce((sum, l) => sum + l.commission, 0))
  return {
    totalUnits,
    totalRevenue,
    totalCommission,
    xocksRevenue: money(totalRevenue - totalCommission),
  }
}

export interface ReportStoreRef {
  id: string
  store_code: string
  store_name: string
  daily_report_recipients: string[]
}

export interface RecipientGroup<T extends ReportStoreRef> {
  to: string
  stores: T[]
}

/**
 * One group per recipient address, holding every store that sends to it, so
 * an address gets one email with one PDF per store. Addresses are sorted, and
 * stores within an address are sorted by store code, so batches are stable.
 */
export function groupStoresByRecipient<T extends ReportStoreRef>(stores: T[]): RecipientGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const store of stores) {
    for (const raw of store.daily_report_recipients) {
      const to = raw.trim().toLowerCase()
      const list = groups.get(to) ?? []
      if (!list.includes(store)) list.push(store)
      groups.set(to, list)
    }
  }
  return [...groups.keys()]
    .sort()
    .map((to) => ({
      to,
      stores: [...(groups.get(to) ?? [])].sort((a, b) => a.store_code.localeCompare(b.store_code)),
    }))
}
