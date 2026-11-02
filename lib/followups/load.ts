// Database reads for the Follow-ups checklist. Server only: callers must have
// checked the admin role first. Test accounts are left out with the single
// rule in lib/stores/test-accounts.ts.

import { createAdminClient } from '@/lib/supabase/admin'
import { isTestStore, loadTestStoreIds } from '@/lib/stores/test-accounts'
import { monthRange, parseYearMonth } from '@/lib/monthly-report/months'
import {
  buildFollowupMonth, RESTOCK_DISPATCHED_STATUSES,
  type FollowupItem, type FollowupMonthView, type LogInput, type ExtraStoreInput,
  type PeriodInput, type ReceiptInput, type RestockInput, type SaleInput, type StoreInput,
} from './build'
import type { CellPrevious } from './entry'

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

// PostgREST caps each response (1000 rows by default), so page through.
async function fetchAll<T>(build: (from: number, to: number) => Page<T>): Promise<T[]> {
  const size = 1000
  const out: T[] = []
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < size) return out
  }
}

interface RawPeriod {
  id: string
  store_id: string
  status: PeriodInput['status']
  invoice_no: number | null
  created_at: string
  paid_at: string | null
}

interface RawLog {
  id: string
  created_at: string
  store_id: string | null
  extra_store_id: string | null
  item: FollowupItem
  action: LogInput['action']
  ticked: boolean | null
  note: string | null
  by_member_id: string
  // Embedded join. PostgREST returns an object for this foreign key; the
  // generated types can say array, so both shapes are accepted.
  mover: { name: string } | { name: string }[] | null
}

function nameOf(mover: RawLog['mover']): string | null {
  if (Array.isArray(mover)) return mover[0]?.name ?? null
  return mover?.name ?? null
}

/** Everything the checklist shows for one month (YYYY-MM). */
export async function loadFollowupMonth(month: string): Promise<FollowupMonthView> {
  const ym = parseYearMonth(month)
  if (!ym) throw new Error(`Invalid month: ${month}`)
  const range = monthRange(month)
  const db = createAdminClient()

  const testIds = await loadTestStoreIds(db)
  const stores = (await fetchAll<StoreInput & { status: string }>((from, to) =>
    db.from('stores')
      .select('id, store_code, store_name, pic_name, pic_phone, status')
      .eq('status', 'active')
      .order('id')
      .range(from, to)))
    .filter((s) => !isTestStore(testIds, s.id))

  const extraStores = await fetchAll<ExtraStoreInput>((from, to) =>
    db.from('followup_extra_stores')
      .select('id, name, pic_name, pic_phone, active')
      .order('id')
      .range(from, to))

  const sales = await fetchAll<SaleInput>((from, to) =>
    db.from('sales')
      .select('store_id, sale_date')
      .gte('sale_date', range.start)
      .lte('sale_date', range.end)
      .order('id')
      .range(from, to))

  const periods = await fetchAll<RawPeriod>((from, to) =>
    db.from('commission_periods')
      .select('id, store_id, status, invoice_no, created_at, paid_at')
      .eq('period_year', ym.year)
      .eq('period_month', ym.month)
      .order('id')
      .range(from, to))

  const periodIds = periods.map((p) => p.id)
  const receipts = periodIds.length === 0 ? [] : await fetchAll<ReceiptInput>((from, to) =>
    db.from('payment_receipts')
      .select('commission_period_id, status')
      .in('commission_period_id', periodIds)
      .order('id')
      .range(from, to))

  const restocks = await fetchAll<RestockInput>((from, to) =>
    db.from('delivery_orders')
      .select('store_id, dispatch_date')
      .eq('do_type', 'restock')
      .in('status', [...RESTOCK_DISPATCHED_STATUSES])
      .gte('dispatch_date', range.start)
      .lte('dispatch_date', range.end)
      .order('id')
      .range(from, to))

  const rawLog = await fetchAll<RawLog>((from, to) =>
    db.from('followup_log')
      .select('id, created_at, store_id, extra_store_id, item, action, ticked, note, by_member_id, mover:xocks_team_members!by_member_id(name)')
      .eq('period_month', month)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to))

  return buildFollowupMonth({
    month,
    stores,
    extraStores,
    sales,
    periods,
    receipts,
    restocks,
    log: rawLog.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      store_id: r.store_id,
      extra_store_id: r.extra_store_id,
      item: r.item,
      action: r.action,
      ticked: r.ticked,
      note: r.note,
      by_member_id: r.by_member_id,
      by_name: nameOf(r.mover),
    })),
  })
}

export interface WriteTarget {
  kind: 'store' | 'extra'
  id: string
}

/**
 * Checks that a checklist cell can be written: an XCMS store must be active
 * and not a test account; an extra store must exist and be active.
 * Returns null when it can be written, otherwise the reason.
 */
export async function checkWriteTarget(target: WriteTarget): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const db = createAdminClient()
  if (target.kind === 'store') {
    const { data: store } = await db.from('stores').select('id, status').eq('id', target.id).maybeSingle()
    if (!store) return { ok: false, error: 'Store not found', status: 404 }
    if (store.status !== 'active') return { ok: false, error: 'Store is not active, so it is not on the checklist', status: 400 }
    const testIds = await loadTestStoreIds(db)
    if (isTestStore(testIds, target.id)) return { ok: false, error: 'Test accounts are not on the checklist', status: 400 }
    return { ok: true }
  }
  const { data: extra } = await db.from('followup_extra_stores').select('id, active').eq('id', target.id).maybeSingle()
  if (!extra) return { ok: false, error: 'Store not found', status: 404 }
  if (!extra.active) return { ok: false, error: 'This store is hidden. Restore it before changing its boxes.', status: 400 }
  return { ok: true }
}

/** The newest log row for one cell in one month, or null if it has none. */
export async function loadCellPrevious(month: string, target: WriteTarget, item: FollowupItem): Promise<CellPrevious | null> {
  const db = createAdminClient()
  let query = db.from('followup_log')
    .select('ticked, note')
    .eq('period_month', month)
    .eq('item', item)
  query = target.kind === 'store' ? query.eq('store_id', target.id) : query.eq('extra_store_id', target.id)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return { ticked: data.ticked === true, note: (data.note as string | null) ?? null }
}
