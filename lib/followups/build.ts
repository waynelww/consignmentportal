// Follow-up checklist rules. Pure: no database or server imports, so the page
// and scripts/test-followups.ts can both run them.
//
// XCMS stores: every box is automatic, worked out from XCMS data for the month.
// Extra stores: every box is ticked by hand. Either way, each manual tick,
// untick and note comes from the append-only followup_log (newest row wins).

import { formatInvoiceNo } from '../invoice-number'

export const FOLLOWUP_ITEMS = ['sales_report', 'invoice', 'payment', 'restock'] as const
export type FollowupItem = (typeof FOLLOWUP_ITEMS)[number]

export const FOLLOWUP_ITEM_LABELS: Record<FollowupItem, string> = {
  sales_report: 'Sales Report',
  invoice: 'Invoice',
  payment: 'Payment',
  restock: 'Restock',
}

const MYT_TIME_ZONE = 'Asia/Kuala_Lumpur'

/** YYYY-MM-DD in Malaysia time for an ISO timestamp. */
export function mytDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MYT_TIME_ZONE }).format(new Date(iso))
}

/** "3 Nov 2026, 14:05" in Malaysia time, for history lines. */
export function mytStamp(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: MYT_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}

// ── Inputs (shapes of the rows the loader reads) ─────────────────────────

export interface StoreInput {
  id: string
  store_code: string
  store_name: string
  pic_name: string | null
  pic_phone: string | null
}

export interface ExtraStoreInput {
  id: string
  name: string
  pic_name: string | null
  pic_phone: string | null
  active: boolean
}

export interface SaleInput {
  store_id: string
  /** YYYY-MM-DD */
  sale_date: string
}

export interface PeriodInput {
  id: string
  store_id: string
  status: 'pending' | 'approved' | 'paid' | 'disputed'
  invoice_no: number | null
  /** ISO timestamp the invoice was generated. */
  created_at: string
  /** ISO timestamp it was marked paid, if it was. */
  paid_at: string | null
}

export interface ReceiptInput {
  commission_period_id: string
  status: 'submitted' | 'confirmed' | 'rejected'
}

export interface LogInput {
  id: string
  created_at: string
  store_id: string | null
  extra_store_id: string | null
  item: FollowupItem
  action: 'tick' | 'untick' | 'note'
  ticked: boolean | null
  note: string | null
  by_member_id: string
  by_name: string | null
}

// ── Outputs ──────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string
  action: 'tick' | 'untick' | 'note'
  ticked: boolean | null
  note: string | null
  by_name: string | null
  at: string
}

export interface CellView {
  item: FollowupItem
  /** XCMS store: the box is automatic and cannot be ticked by hand. */
  auto: boolean
  /** Ticked (manual) or the XCMS condition is met (auto). */
  done: boolean
  /** Auto only: MYT date the condition was first met. */
  auto_date: string | null
  /** Auto only: short detail, e.g. the invoice number or "receipt uploaded, awaiting review". */
  auto_detail: string | null
  note: string | null
  /** Who made the newest change to this cell, and when. Null if never changed by hand. */
  last_by: string | null
  last_at: string | null
  /** Every manual change to this cell, oldest first. */
  history: HistoryEntry[]
}

export interface RowView {
  key: string
  kind: 'store' | 'extra'
  id: string
  store_code: string | null
  name: string
  pic_name: string | null
  pic_phone: string | null
  cells: Record<FollowupItem, CellView>
  /** How many of the four boxes are not ticked. */
  missing: number
}

export interface FollowupMonthView {
  month: string
  rows: RowView[]
  /** Hidden extra stores, so they can be restored. */
  hidden: { id: string; name: string; pic_name: string | null; pic_phone: string | null }[]
  /** Per column: how many rows still have that box not ticked. */
  outstanding: Record<FollowupItem, number>
}

export interface BuildInput {
  month: string
  stores: StoreInput[]
  extraStores: ExtraStoreInput[]
  sales: SaleInput[]
  periods: PeriodInput[]
  receipts: ReceiptInput[]
  log: LogInput[]
}

// ── Auto rules (one per XCMS box) ────────────────────────────────────────

function earliest(dates: string[]): string | null {
  return dates.length === 0 ? null : [...dates].sort()[0]
}

/** Sales Report: at least one sale keyed in for the month. */
export function autoSalesReport(saleDates: string[]): Pick<CellView, 'done' | 'auto_date' | 'auto_detail'> {
  return { done: saleDates.length > 0, auto_date: earliest(saleDates), auto_detail: null }
}

/** Invoice: a commission invoice exists for the store and month. */
export function autoInvoice(period: PeriodInput | undefined): Pick<CellView, 'done' | 'auto_date' | 'auto_detail'> {
  if (!period) return { done: false, auto_date: null, auto_detail: 'No invoice yet' }
  return {
    done: true,
    auto_date: mytDate(period.created_at),
    auto_detail: formatInvoiceNo(period.invoice_no) ?? 'Invoice created',
  }
}

/**
 * Payment: the invoice is marked paid. A receipt that is uploaded but not yet
 * paid is shown as waiting for review (or as rejected, so it is not mistaken
 * for a pending review).
 */
export function autoPayment(
  period: PeriodInput | undefined,
  receipt: ReceiptInput | undefined,
): Pick<CellView, 'done' | 'auto_date' | 'auto_detail'> {
  if (!period) return { done: false, auto_date: null, auto_detail: 'No invoice yet' }
  if (period.status === 'paid') {
    return { done: true, auto_date: mytDate(period.paid_at ?? period.created_at), auto_detail: 'Paid' }
  }
  if (receipt?.status === 'submitted') {
    return { done: false, auto_date: null, auto_detail: 'receipt uploaded, awaiting review' }
  }
  if (receipt?.status === 'rejected') {
    return { done: false, auto_date: null, auto_detail: 'receipt rejected, store to re-upload' }
  }
  if (receipt?.status === 'confirmed') {
    return { done: false, auto_date: null, auto_detail: 'receipt confirmed, invoice not marked paid' }
  }
  return { done: false, auto_date: null, auto_detail: 'Not paid' }
}

// ── Manual cells ─────────────────────────────────────────────────────────

/** Current state of a manual box: the newest log row for it (ticked false if none). */
export function latestManualState(rows: LogInput[]): { ticked: boolean; note: string | null } {
  const last = rows[rows.length - 1]
  return { ticked: last?.ticked === true, note: last?.note ?? null }
}

function historyOf(rows: LogInput[]): HistoryEntry[] {
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    ticked: r.ticked,
    note: r.note,
    by_name: r.by_name,
    at: r.created_at,
  }))
}

// ── Assembly ─────────────────────────────────────────────────────────────

function logKey(storeId: string | null, extraId: string | null): string {
  return storeId ? `store:${storeId}` : `extra:${extraId}`
}

/** Groups log rows by cell, oldest first. Callers pass rows sorted by created_at. */
export function groupLog(log: LogInput[]): Map<string, LogInput[]> {
  const map = new Map<string, LogInput[]>()
  for (const r of log) {
    const k = `${logKey(r.store_id, r.extra_store_id)}|${r.item}`
    const list = map.get(k)
    if (list) list.push(r)
    else map.set(k, [r])
  }
  return map
}

function manualCell(item: FollowupItem, rows: LogInput[]): CellView {
  const state = latestManualState(rows)
  const last = rows[rows.length - 1]
  return {
    item,
    auto: false,
    done: state.ticked,
    auto_date: null,
    auto_detail: null,
    note: state.note,
    last_by: last?.by_name ?? null,
    last_at: last?.created_at ?? null,
    history: historyOf(rows),
  }
}

/** XCMS box: the box state comes from XCMS data; the log only holds the note. */
function autoCell(item: FollowupItem, auto: Pick<CellView, 'done' | 'auto_date' | 'auto_detail'>, rows: LogInput[]): CellView {
  const last = rows[rows.length - 1]
  return {
    item,
    auto: true,
    done: auto.done,
    auto_date: auto.auto_date,
    auto_detail: auto.auto_detail,
    note: last?.note ?? null,
    last_by: last?.by_name ?? null,
    last_at: last?.created_at ?? null,
    history: historyOf(rows),
  }
}

function finishRow(row: Omit<RowView, 'missing'>): RowView {
  const missing = FOLLOWUP_ITEMS.filter((i) => !row.cells[i].done).length
  return { ...row, missing }
}

/** Builds the whole checklist for one month. Pure. */
export function buildFollowupMonth(input: BuildInput): FollowupMonthView {
  const logs = groupLog(input.log)
  const cellLog = (key: string, item: FollowupItem) => logs.get(`${key}|${item}`) ?? []

  const salesByStore = groupBy(input.sales, (s) => s.store_id, (s) => s.sale_date)
  const periodByStore = new Map(input.periods.map((p) => [p.store_id, p]))
  const receiptByPeriod = new Map(input.receipts.map((r) => [r.commission_period_id, r]))

  const storeRows: RowView[] = [...input.stores]
    .sort((a, b) => a.store_code.localeCompare(b.store_code))
    .map((s) => {
      const key = `store:${s.id}`
      const period = periodByStore.get(s.id)
      const receipt = period ? receiptByPeriod.get(period.id) : undefined
      return finishRow({
        key,
        kind: 'store',
        id: s.id,
        store_code: s.store_code,
        name: s.store_name,
        pic_name: s.pic_name,
        pic_phone: s.pic_phone,
        cells: {
          sales_report: autoCell('sales_report', autoSalesReport(salesByStore.get(s.id) ?? []), cellLog(key, 'sales_report')),
          invoice: autoCell('invoice', autoInvoice(period), cellLog(key, 'invoice')),
          payment: autoCell('payment', autoPayment(period, receipt), cellLog(key, 'payment')),
          // Restock is hand-ticked for XCMS stores too (see manualCell).
          restock: manualCell('restock', cellLog(key, 'restock')),
        },
      })
    })

  const activeExtras = input.extraStores.filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name))
  const extraRows: RowView[] = activeExtras.map((e) => {
    const key = `extra:${e.id}`
    return finishRow({
      key,
      kind: 'extra',
      id: e.id,
      store_code: null,
      name: e.name,
      pic_name: e.pic_name,
      pic_phone: e.pic_phone,
      cells: {
        sales_report: manualCell('sales_report', cellLog(key, 'sales_report')),
        invoice: manualCell('invoice', cellLog(key, 'invoice')),
        payment: manualCell('payment', cellLog(key, 'payment')),
        restock: manualCell('restock', cellLog(key, 'restock')),
      },
    })
  })

  const rows = [...storeRows, ...extraRows]
  const outstanding = Object.fromEntries(
    FOLLOWUP_ITEMS.map((i) => [i, rows.filter((r) => !r.cells[i].done).length]),
  ) as Record<FollowupItem, number>

  const hidden = input.extraStores
    .filter((e) => !e.active)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({ id: e.id, name: e.name, pic_name: e.pic_name, pic_phone: e.pic_phone }))

  return { month: input.month, rows, hidden, outstanding }
}

function groupBy<T>(items: T[], key: (t: T) => string, value: (t: T) => string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const it of items) {
    const k = key(it)
    const v = value(it)
    const list = map.get(k)
    if (list) list.push(v)
    else map.set(k, [v])
  }
  return map
}

/** Rows still needing follow-up: any box not ticked. */
export function stillToFollowUp(rows: RowView[]): RowView[] {
  return rows.filter((r) => r.missing > 0)
}
