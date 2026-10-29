/**
 * "Sales by staff": per store, who keyed in each sale.
 * A sale with a store staff member is grouped under that name. A sale with
 * no staff member (keyed in by an admin) is grouped under the login that
 * recorded it. Used by the admin API and the admin reports page.
 */

export interface SaleForStaffReport {
  store_id: string
  store_code: string
  store_name: string
  quantity: number
  total_amount: number
  store_staff_id: string | null
  staff_name: string | null
  recorded_by: string | null
  recorder_name: string | null
}

export interface StaffReportRow {
  label: string
  source: 'staff' | 'admin' | 'unknown'
  sales: number
  pairs: number
  revenue: number
}

export interface StoreStaffReport {
  store_id: string
  store_code: string
  store_name: string
  rows: StaffReportRow[]
  total: { sales: number; pairs: number; revenue: number }
}

const round2 = (n: number) => Number(n.toFixed(2))

export function buildSalesByStaff(sales: SaleForStaffReport[]): StoreStaffReport[] {
  const stores = new Map<string, StoreStaffReport & { byKey: Map<string, StaffReportRow> }>()

  for (const s of sales) {
    let store = stores.get(s.store_id)
    if (!store) {
      store = {
        store_id: s.store_id,
        store_code: s.store_code,
        store_name: s.store_name,
        rows: [],
        total: { sales: 0, pairs: 0, revenue: 0 },
        byKey: new Map(),
      }
      stores.set(s.store_id, store)
    }

    let key: string
    let label: string
    let source: StaffReportRow['source']
    if (s.store_staff_id && s.staff_name) {
      key = `staff:${s.store_staff_id}`
      label = s.staff_name
      source = 'staff'
    } else if (s.recorded_by) {
      key = `admin:${s.recorded_by}`
      label = s.recorder_name ?? 'Unknown login'
      source = 'admin'
    } else {
      key = 'unknown'
      label = '-'
      source = 'unknown'
    }

    let row = store.byKey.get(key)
    if (!row) {
      row = { label, source, sales: 0, pairs: 0, revenue: 0 }
      store.byKey.set(key, row)
    }
    row.sales += 1
    row.pairs += s.quantity
    row.revenue = round2(row.revenue + s.total_amount)
    store.total.sales += 1
    store.total.pairs += s.quantity
    store.total.revenue = round2(store.total.revenue + s.total_amount)
  }

  return Array.from(stores.values())
    .map(({ byKey, ...store }) => ({
      ...store,
      rows: Array.from(byKey.values()).sort((a, b) => b.pairs - a.pairs || a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.store_code.localeCompare(b.store_code))
}
