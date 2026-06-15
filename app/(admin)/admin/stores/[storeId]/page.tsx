'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
import Link from 'next/link'
import {
  Download,
  X,
  ArrowLeft,
  Save,
  TrendingUp,
  ArrowUpDown,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  formatCurrency,
  formatMYDate,
  cn,
  MALAYSIAN_STATES,
} from '@/lib/utils'
import type {
  Store,
  StoreInventory,
  Sale,
  DeliveryOrder,
  CommissionPeriod,
  Product,
  CommissionStatus,
  StoreTypeRow,
} from '@/types'
import { toast } from 'sonner'

const TABS = ['overview', 'inventory', 'sales', 'delivery-orders', 'commissions'] as const
type Tab = (typeof TABS)[number]

type InventoryPeriod = '7d' | '14d' | '30d' | 'this-month' | 'last-month' | 'ytd' | 'max'
type InvSort = 'sold-desc' | 'sold-asc' | 'on-hand-desc' | 'on-hand-asc' | 'velocity-desc' | 'sku'

const PERIOD_LABELS: Record<InventoryPeriod, string> = {
  '7d': '7 Days', '14d': '14 Days', '30d': '30 Days',
  'this-month': 'This Month', 'last-month': 'Last Month',
  'ytd': 'Year to Date', 'max': 'All Time',
}

function getPeriodRange(period: InventoryPeriod): { from: string; to: string; days: number } {
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  switch (period) {
    case '7d':  { const f = new Date(now); f.setDate(f.getDate() - 6);  return { from: f.toISOString().slice(0,10), to: todayStr, days: 7 } }
    case '14d': { const f = new Date(now); f.setDate(f.getDate() - 13); return { from: f.toISOString().slice(0,10), to: todayStr, days: 14 } }
    case '30d': { const f = new Date(now); f.setDate(f.getDate() - 29); return { from: f.toISOString().slice(0,10), to: todayStr, days: 30 } }
    case 'this-month': {
      const f = new Date(now.getFullYear(), now.getMonth(), 1)
      const days = Math.max(1, Math.ceil((now.getTime() - f.getTime()) / 86400000) + 1)
      return { from: f.toISOString().slice(0,10), to: todayStr, days }
    }
    case 'last-month': {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const t = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: f.toISOString().slice(0,10), to: t.toISOString().slice(0,10), days: t.getDate() }
    }
    case 'ytd': {
      const f = new Date(now.getFullYear(), 0, 1)
      const days = Math.max(1, Math.ceil((now.getTime() - f.getTime()) / 86400000) + 1)
      return { from: f.toISOString().slice(0,10), to: todayStr, days }
    }
    default: return { from: '2020-01-01', to: todayStr, days: 365 * 5 }
  }
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
        active
          ? 'border-[#FFD700] text-[#0A0A0A]'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      )}
    >
      {children}
    </button>
  )
}

function CommissionStatusBadge({ status }: { status: CommissionStatus }) {
  const map: Record<CommissionStatus, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-blue-100 text-blue-700',
    paid: 'bg-green-100 text-green-700',
    disputed: 'bg-red-100 text-red-700',
  }
  return (
    <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-medium capitalize', map[status])}>
      {status}
    </span>
  )
}

interface AdjustModalState {
  open: boolean
  inventory: StoreInventory | null
}

function EditField({ label, value, onChange, type = 'text', options }: {
  label: string
  value: string | number
  onChange: (v: string) => void
  type?: string
  options?: { value: string; label: string }[]
}) {
  if (options) {
    return (
      <div>
        <label className="text-xs text-gray-500 block mb-1">{label}</label>
        <select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
        >
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    )
  }
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <input
        type={type}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
      />
    </div>
  )
}

export default function StoreDetailPage() {
  const params = useParams<{ storeId: string }>()
  const storeId = params.storeId
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab: Tab = (searchParams.get('tab') as Tab) || 'overview'

  const [store, setStore] = useState<Store | null>(null)
  const [inventory, setInventory] = useState<StoreInventory[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [dos, setDos] = useState<DeliveryOrder[]>([])
  const [commissions, setCommissions] = useState<CommissionPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [salesFrom, setSalesFrom] = useState('')
  const [salesTo, setSalesTo] = useState('')
  const [adjustModal, setAdjustModal] = useState<AdjustModalState>({ open: false, inventory: null })
  const [adjustQty, setAdjustQty] = useState(0)
  const [adjustType, setAdjustType] = useState<'adjustment_add' | 'adjustment_remove'>('adjustment_add')
  const [adjustNotes, setAdjustNotes] = useState('')
  const [storeTypes, setStoreTypes] = useState<StoreTypeRow[]>([])

  // Inventory analytics
  const [invPeriod, setInvPeriod] = useState<InventoryPeriod>('30d')
  const [invSoldMap, setInvSoldMap] = useState<Record<string, number>>({})
  const [invInboundMap, setInvInboundMap] = useState<Record<string, number>>({})
  const [invAnalyticsLoading, setInvAnalyticsLoading] = useState(false)
  const [invSort, setInvSort] = useState<InvSort>('sold-desc')

  // Fetch active store types for the dropdown + label lookups
  useEffect(() => {
    fetch('/api/store-types')
      .then((r) => r.json())
      .then((d) => setStoreTypes((d.store_types ?? []) as StoreTypeRow[]))
      .catch(() => {})
  }, [])

  const storeTypeLabelMap: Record<string, string> = Object.fromEntries(
    storeTypes.map((t) => [t.value, t.label]),
  )
  const labelForType = (value: string | null | undefined): string =>
    (value && storeTypeLabelMap[value]) || value || '—'
  const [paidModal, setPaidModal] = useState<{ open: boolean; periodId: string | null }>({ open: false, periodId: null })
  const [paidRef, setPaidRef] = useState('')
  // Edit store mode
  const [editMode, setEditMode] = useState(false)
  const [editFields, setEditFields] = useState<Partial<Store>>({})
  const [savingEdit, setSavingEdit] = useState(false)
  const supabase = createClient()

  function setTab(tab: Tab) {
    const p = new URLSearchParams(searchParams.toString())
    p.set('tab', tab)
    router.replace(`?${p.toString()}`, { scroll: false })
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase.from('stores').select('*').eq('id', storeId).single()
      if (data) {
        setStore(data as Store)
        setNotes(data.notes || '')
      }
      setLoading(false)
    }
    load()
  }, [storeId])

  useEffect(() => {
    if (activeTab === 'inventory') { loadInventory(); loadInventoryAnalytics(invPeriod) }
    if (activeTab === 'sales') loadSales()
    if (activeTab === 'delivery-orders') loadDOs()
    if (activeTab === 'commissions') loadCommissions()
  }, [activeTab, storeId])

  useEffect(() => {
    if (activeTab === 'inventory') loadInventoryAnalytics(invPeriod)
  }, [invPeriod])

  async function loadInventory() {
    const { data } = await supabase
      .from('store_inventory')
      .select('*, product:products(*)')
      .eq('store_id', storeId)
      .order('created_at')
    setInventory((data || []) as StoreInventory[])
  }

  async function loadInventoryAnalytics(period: InventoryPeriod) {
    setInvAnalyticsLoading(true)
    const { from, to } = getPeriodRange(period)

    // Sales in period → group by product_id
    const { data: salesData } = await supabase
      .from('sales')
      .select('product_id, quantity')
      .eq('store_id', storeId)
      .gte('sale_date', from)
      .lte('sale_date', to)

    const soldMap: Record<string, number> = {}
    for (const s of (salesData || [])) {
      soldMap[s.product_id] = (soldMap[s.product_id] ?? 0) + (s.quantity ?? 0)
    }
    setInvSoldMap(soldMap)

    // Currently inbound: DOs in confirmed/dispatched status (not period-filtered — always current snapshot)
    const { data: inTransitDos } = await supabase
      .from('delivery_orders')
      .select('id')
      .eq('store_id', storeId)
      .in('status', ['confirmed', 'dispatched'])

    const doIds = (inTransitDos || []).map((d: { id: string }) => d.id)
    const inboundMap: Record<string, number> = {}
    if (doIds.length > 0) {
      const { data: items } = await supabase
        .from('delivery_order_items')
        .select('product_id, quantity')
        .in('delivery_order_id', doIds)
      for (const it of (items || [])) {
        inboundMap[it.product_id] = (inboundMap[it.product_id] ?? 0) + (it.quantity ?? 0)
      }
    }
    setInvInboundMap(inboundMap)
    setInvAnalyticsLoading(false)
  }

  async function loadSales() {
    let query = supabase
      .from('sales')
      .select('*, product:products(name, sku)')
      .eq('store_id', storeId)
      .order('sale_date', { ascending: false })
      .limit(200)
    if (salesFrom) query = query.gte('sale_date', salesFrom)
    if (salesTo) query = query.lte('sale_date', salesTo)
    const { data } = await query
    setSales((data || []) as Sale[])
  }

  async function loadDOs() {
    const { data } = await supabase
      .from('delivery_orders')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
    setDos((data || []) as DeliveryOrder[])
  }

  async function loadCommissions() {
    const { data } = await supabase
      .from('commission_periods')
      .select('*')
      .eq('store_id', storeId)
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false })
    setCommissions((data || []) as CommissionPeriod[])
  }

  async function saveNotes() {
    setSavingNotes(true)
    const { error } = await supabase
      .from('stores')
      .update({ notes, updated_at: new Date().toISOString() })
      .eq('id', storeId)
    setSavingNotes(false)
    if (error) toast.error('Failed to save notes')
    else toast.success('Notes saved')
  }

  function startEdit() {
    if (!store) return
    setEditFields({
      store_name: store.store_name,
      store_type: store.store_type,
      pic_name: store.pic_name,
      pic_phone: store.pic_phone,
      email: store.email ?? '',
      address: store.address,
      city: store.city,
      state: store.state,
      postcode: store.postcode,
      commission_rate: store.commission_rate,
      payment_terms_days: store.payment_terms_days ?? 7,
    })
    setEditMode(true)
    setTab('overview')
  }

  async function saveEdit() {
    setSavingEdit(true)
    const { error } = await supabase
      .from('stores')
      .update({ ...editFields, updated_at: new Date().toISOString() })
      .eq('id', storeId)
    setSavingEdit(false)
    if (error) {
      toast.error('Failed to save changes')
    } else {
      toast.success('Store updated!')
      setEditMode(false)
      const { data } = await supabase.from('stores').select('*').eq('id', storeId).single()
      if (data) { setStore(data as Store); setNotes(data.notes || '') }
    }
  }

  async function adjustStock() {
    if (!adjustModal.inventory) return
    const inv = adjustModal.inventory
    const { error } = await supabase.from('stock_movements').insert({
      store_id: storeId,
      product_id: inv.product_id,
      movement_type: adjustType,
      quantity: Math.abs(adjustQty),
      notes: adjustNotes,
      created_by: null,
    })
    if (error) {
      toast.error('Failed to adjust stock')
      return
    }
    const newQty =
      adjustType === 'adjustment_add'
        ? inv.quantity_on_hand + adjustQty
        : Math.max(0, inv.quantity_on_hand - adjustQty)
    await supabase
      .from('store_inventory')
      .update({ quantity_on_hand: newQty, updated_at: new Date().toISOString() })
      .eq('id', inv.id)
    toast.success('Stock adjusted')
    setAdjustModal({ open: false, inventory: null })
    loadInventory()
  }

  async function approveCommission(id: string) {
    const { error } = await supabase
      .from('commission_periods')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', id)
    if (error) toast.error('Failed to approve')
    else { toast.success('Commission approved'); loadCommissions() }
  }

  async function markPaidCommission() {
    if (!paidModal.periodId) return
    if (!paidRef.trim()) {
      toast.error('Enter payment reference')
      return
    }
    const { error } = await supabase
      .from('commission_periods')
      .update({ status: 'paid', paid_at: new Date().toISOString(), payment_reference: paidRef })
      .eq('id', paidModal.periodId)
    if (error) toast.error('Failed to mark paid')
    else {
      toast.success('Marked as paid')
      setPaidModal({ open: false, periodId: null })
      setPaidRef('')
      loadCommissions()
    }
  }

  function exportSalesCSV() {
    if (sales.length === 0) { toast.error('No sales data'); return }
    const headers = ['Date', 'Product', 'Qty', 'Unit Price', 'Total', 'Payment']
    const rows = sales.map((s) => [
      s.sale_date,
      (s.product as any)?.name || s.product_id,
      s.quantity,
      s.unit_price,
      s.total_amount,
      s.payment_method,
    ])
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sales-${store?.store_code || storeId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 bg-gray-200 animate-pulse rounded-xl w-64" />
        <div className="h-64 bg-gray-200 animate-pulse rounded-xl" />
      </div>
    )
  }

  if (!store) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400 mb-4">Store not found</p>
        <Link href="/admin/stores" className="text-sm text-blue-600 hover:underline">
          ← Back to Stores
        </Link>
      </div>
    )
  }

  const scoreColor =
    store.performance_score >= 50
      ? 'text-green-600'
      : store.performance_score >= 20
      ? 'text-amber-600'
      : 'text-red-600'

  // Build dropdown options from the dynamic store_types table.
  // Include the store's current value (even if inactive/missing) so it doesn't
  // disappear from the dropdown after a type is deactivated.
  const storeTypeOptions = (() => {
    const opts = storeTypes
      .filter((t) => t.is_active)
      .map((t) => ({ value: t.value, label: t.label }))
    const current = store?.store_type
    if (current && !opts.some((o) => o.value === current)) {
      opts.unshift({ value: current, label: storeTypeLabelMap[current] || current })
    }
    return opts
  })()
  const stateOptions = MALAYSIAN_STATES.map((s) => ({ value: s, label: s }))

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin/stores" className="flex items-center gap-1 hover:text-gray-800 transition-colors">
          <ArrowLeft size={16} />
          Stores
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{store.store_name}</span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-500">
                {store.store_code}
              </span>
              <span
                className={cn(
                  'px-2.5 py-0.5 rounded-full text-xs font-medium capitalize',
                  store.status === 'active'
                    ? 'bg-green-100 text-green-700'
                    : store.status === 'suspended'
                    ? 'bg-red-100 text-red-700'
                    : store.status === 'pending'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-gray-100 text-gray-600'
                )}
              >
                {store.status}
              </span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">{store.store_name}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {labelForType(store.store_type)} · {store.city}, {store.state}
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="text-right">
              <p className="text-xs text-gray-400">Performance Score</p>
              <p className={cn('text-3xl font-black', scoreColor)}>{store.performance_score}</p>
            </div>
            {editMode ? (
              <div className="flex gap-2">
                <button
                  onClick={() => setEditMode(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-[#FFD700] text-[#0A0A0A] hover:bg-yellow-400 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  <Save size={15} />
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            ) : (
              <button
                onClick={startEdit}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[#0A0A0A] text-white hover:bg-gray-800 transition-colors mt-1"
              >
                Edit Store
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex overflow-x-auto border-b border-gray-100 px-4">
          {TABS.map((tab) => (
            <TabButton key={tab} active={activeTab === tab} onClick={() => setTab(tab)}>
              {tab.charAt(0).toUpperCase() + tab.slice(1).replace('-', ' ')}
            </TabButton>
          ))}
        </div>

        <div className="p-6">
          {/* ── Overview Tab ── */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Store Info */}
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Store Information</h3>
                  {editMode ? (
                    <div className="space-y-3">
                      <EditField label="Store Name" value={editFields.store_name ?? ''} onChange={(v) => setEditFields(f => ({ ...f, store_name: v }))} />
                      <EditField label="Store Type" value={editFields.store_type ?? ''} onChange={(v) => setEditFields(f => ({ ...f, store_type: v as Store['store_type'] }))} options={storeTypeOptions} />
                      <div className="grid grid-cols-2 gap-3">
                        <EditField label="PIC Name" value={editFields.pic_name ?? ''} onChange={(v) => setEditFields(f => ({ ...f, pic_name: v }))} />
                        <EditField label="PIC Phone" value={editFields.pic_phone ?? ''} onChange={(v) => setEditFields(f => ({ ...f, pic_phone: v }))} />
                      </div>
                      <EditField label="Email" value={editFields.email ?? ''} onChange={(v) => setEditFields(f => ({ ...f, email: v }))} type="email" />
                      <EditField label="Address" value={editFields.address ?? ''} onChange={(v) => setEditFields(f => ({ ...f, address: v }))} />
                      <div className="grid grid-cols-2 gap-3">
                        <EditField label="City" value={editFields.city ?? ''} onChange={(v) => setEditFields(f => ({ ...f, city: v }))} />
                        <EditField label="Postcode" value={editFields.postcode ?? ''} onChange={(v) => setEditFields(f => ({ ...f, postcode: v }))} />
                      </div>
                      <EditField label="State" value={editFields.state ?? ''} onChange={(v) => setEditFields(f => ({ ...f, state: v }))} options={stateOptions} />
                      <EditField label="Commission Rate (%)" value={editFields.commission_rate ?? 30} onChange={(v) => setEditFields(f => ({ ...f, commission_rate: Number(v) }))} type="number" />
                      <EditField
                        label="Payment Terms (days)"
                        value={editFields.payment_terms_days ?? 7}
                        onChange={(v) => setEditFields(f => ({ ...f, payment_terms_days: Number(v) }))}
                        options={[
                          { value: '7', label: '7 working days' },
                          { value: '14', label: '14 working days' },
                          { value: '30', label: '30 working days' },
                          { value: '0', label: 'No payment terms' },
                        ]}
                      />
                    </div>
                  ) : (
                    <dl className="space-y-2">
                      {[
                        ['PIC Name', store.pic_name],
                        ['PIC Phone', store.pic_phone],
                        ['Email', store.email || '—'],
                        ['Address', store.address],
                        ['City', store.city],
                        ['State', store.state],
                        ['Postcode', store.postcode],
                        ['Commission Rate', `${store.commission_rate}%`],
                        ['Payment Terms', store.payment_terms_days ? `${store.payment_terms_days} working days` : '7 working days (default)'],
                      ].map(([label, value]) => (
                        <div key={label} className="flex gap-2">
                          <dt className="text-xs text-gray-500 w-32 flex-shrink-0">{label}</dt>
                          <dd className="text-sm text-gray-800 font-medium">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>

                {/* Notes */}
                <div className="bg-gray-50 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Notes</h3>
                  <textarea
                    rows={4}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none"
                    placeholder="Add notes about this store..."
                  />
                  <button
                    onClick={saveNotes}
                    disabled={savingNotes}
                    className="mt-2 px-4 py-2 bg-[#0A0A0A] text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
                  >
                    {savingNotes ? 'Saving...' : 'Save Notes'}
                  </button>
                </div>
              </div>

              {/* Performance + QR */}
              <div className="space-y-4">
                <div className="bg-gray-50 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Performance</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <p className={cn('text-3xl font-black', scoreColor)}>{store.performance_score}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Score</p>
                    </div>
                    <div className="text-center">
                      <p className={cn('text-3xl font-black', store.consecutive_low_months >= 2 ? 'text-red-600' : 'text-green-600')}>
                        {store.consecutive_low_months}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">Low Months</p>
                    </div>
                  </div>
                </div>

                {/* Quick actions */}
                <div className="bg-gray-50 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Quick Actions</h3>
                  <div className="space-y-2">
                    <Link
                      href={`/admin/delivery-orders?store_id=${storeId}`}
                      className="flex items-center justify-between w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-100 transition-colors"
                    >
                      <span>Create Delivery Order</span>
                      <span className="text-gray-400">→</span>
                    </Link>
                    <button
                      onClick={() => setTab('commissions')}
                      className="flex items-center justify-between w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-100 transition-colors"
                    >
                      <span>View Commissions</span>
                      <span className="text-gray-400">→</span>
                    </button>
                    <button
                      onClick={() => setTab('sales')}
                      className="flex items-center justify-between w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-100 transition-colors"
                    >
                      <span>View Sales Report</span>
                      <span className="text-gray-400">→</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Inventory Tab ── */}
          {activeTab === 'inventory' && (() => {
            const { days } = getPeriodRange(invPeriod)
            const sortedInv = [...inventory].sort((a, b) => {
              const soldA = invSoldMap[a.product_id] ?? 0
              const soldB = invSoldMap[b.product_id] ?? 0
              const velA = soldA / days
              const velB = soldB / days
              switch (invSort) {
                case 'sold-asc':     return soldA - soldB
                case 'on-hand-desc': return b.quantity_on_hand - a.quantity_on_hand
                case 'on-hand-asc':  return a.quantity_on_hand - b.quantity_on_hand
                case 'velocity-desc': return velB - velA
                case 'sku':          return ((a.product as Product)?.sku ?? '').localeCompare((b.product as Product)?.sku ?? '')
                default:             return soldB - soldA  // sold-desc
              }
            })

            const totalSold = sortedInv.reduce((s, i) => s + (invSoldMap[i.product_id] ?? 0), 0)
            const totalInbound = sortedInv.reduce((s, i) => s + (invInboundMap[i.product_id] ?? 0), 0)
            const totalOnHand = sortedInv.reduce((s, i) => s + i.quantity_on_hand, 0)

            return (
              <div className="space-y-4">
                {/* Period chips */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500 mr-1">Period:</span>
                  {(Object.keys(PERIOD_LABELS) as InventoryPeriod[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setInvPeriod(p)}
                      className={cn(
                        'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
                        invPeriod === p
                          ? 'bg-[#0A0A0A] text-[#FFD700]'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      )}
                    >
                      {PERIOD_LABELS[p]}
                    </button>
                  ))}
                  <div className="ml-auto flex items-center gap-1.5">
                    <ArrowUpDown size={12} className="text-gray-400" />
                    <select
                      value={invSort}
                      onChange={(e) => setInvSort(e.target.value as InvSort)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                    >
                      <option value="sold-desc">Sold (High → Low)</option>
                      <option value="sold-asc">Sold (Low → High)</option>
                      <option value="velocity-desc">Velocity (Fast → Slow)</option>
                      <option value="on-hand-desc">On Hand (High → Low)</option>
                      <option value="on-hand-asc">On Hand (Low → High)</option>
                      <option value="sku">SKU A → Z</option>
                    </select>
                  </div>
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-500">Total On Hand</p>
                    <p className="text-xl font-bold text-gray-900">{totalOnHand}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">pairs in stock now</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-3">
                    <p className="text-xs text-amber-700">Inbound (In Transit)</p>
                    <p className="text-xl font-bold text-amber-900">{totalInbound}</p>
                    <p className="text-[10px] text-amber-600 mt-0.5">confirmed + dispatched DOs</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-3">
                    <div className="flex items-center gap-1">
                      <TrendingUp size={11} className="text-blue-600" />
                      <p className="text-xs text-blue-700">Sold ({PERIOD_LABELS[invPeriod]})</p>
                    </div>
                    <p className="text-xl font-bold text-blue-900">
                      {invAnalyticsLoading ? '…' : totalSold}
                    </p>
                    <p className="text-[10px] text-blue-500 mt-0.5">
                      {invAnalyticsLoading ? '' : `~${(totalSold / days).toFixed(1)} pairs/day`}
                    </p>
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Product</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">SKU</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">On Hand</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 bg-blue-50/60">
                          Sold ({PERIOD_LABELS[invPeriod]})
                        </th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 bg-blue-50/60">
                          /day
                        </th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 bg-amber-50/60">Inbound</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Status</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedInv.map((inv) => {
                        const qty = inv.quantity_on_hand
                        const thr = inv.restock_threshold
                        const sold = invSoldMap[inv.product_id] ?? 0
                        const inbound = invInboundMap[inv.product_id] ?? 0
                        const velocity = sold / days
                        const status = qty === 0 ? 'Out' : qty <= thr ? 'Low' : 'OK'
                        const statusColor =
                          status === 'Out' ? 'bg-red-100 text-red-700' :
                          status === 'Low' ? 'bg-amber-100 text-amber-700' :
                          'bg-green-100 text-green-700'
                        const daysLeft = velocity > 0 ? Math.floor(qty / velocity) : null
                        return (
                          <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="py-2.5 px-3 font-medium text-gray-800">
                              {(inv.product as Product)?.name || '—'}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-xs text-gray-500">
                              {(inv.product as Product)?.sku || '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold">
                              {qty}
                              {daysLeft !== null && (
                                <div className={cn(
                                  'text-[10px] font-normal',
                                  daysLeft <= 7 ? 'text-red-500' : daysLeft <= 14 ? 'text-amber-500' : 'text-gray-400'
                                )}>
                                  ~{daysLeft}d left
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right bg-blue-50/30">
                              {invAnalyticsLoading ? (
                                <span className="text-gray-300">…</span>
                              ) : (
                                <span className={cn('font-semibold', sold > 0 ? 'text-blue-700' : 'text-gray-300')}>
                                  {sold}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right text-xs text-gray-400 bg-blue-50/30">
                              {!invAnalyticsLoading && sold > 0 ? velocity.toFixed(2) : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right bg-amber-50/30">
                              {inbound > 0 ? (
                                <span className="font-semibold text-amber-700">{inbound}</span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', statusColor)}>
                                {status}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                onClick={() => {
                                  setAdjustModal({ open: true, inventory: inv })
                                  setAdjustQty(0)
                                  setAdjustNotes('')
                                }}
                                className="text-xs px-2.5 py-1 bg-[#0A0A0A] text-white rounded-lg hover:bg-gray-800 transition-colors"
                              >
                                Adjust
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                      {inventory.length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-10 text-center text-gray-400 text-sm">
                            No inventory records
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}

          {/* ── Sales Tab ── */}
          {activeTab === 'sales' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">From</label>
                  <input
                    type="date"
                    value={salesFrom}
                    onChange={(e) => setSalesFrom(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">To</label>
                  <input
                    type="date"
                    value={salesTo}
                    onChange={(e) => setSalesTo(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                </div>
                <button
                  onClick={loadSales}
                  className="px-4 py-2 bg-[#0A0A0A] text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
                >
                  Apply
                </button>
                <button
                  onClick={exportSalesCSV}
                  className="px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
                >
                  <Download size={14} />
                  Export CSV
                </button>
              </div>

              {sales.length > 0 && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-gray-50 rounded-xl p-4">
                    <p className="text-xs text-gray-500">Total Pairs</p>
                    <p className="text-xl font-bold text-gray-900">
                      {sales.reduce((a, s) => a + s.quantity, 0)}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4">
                    <p className="text-xs text-gray-500">Total Revenue</p>
                    <p className="text-xl font-bold text-gray-900">
                      {formatCurrency(sales.reduce((a, s) => a + s.total_amount, 0))}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4">
                    <p className="text-xs text-gray-500">Commission</p>
                    <p className="text-xl font-bold text-gray-900">
                      {formatCurrency(sales.reduce((a, s) => a + s.commission_amount, 0))}
                    </p>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Date</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Product</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Qty</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Unit</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Total</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="py-2.5 px-3 text-gray-600">{formatMYDate(s.sale_date)}</td>
                        <td className="py-2.5 px-3 text-gray-800">{(s.product as any)?.name || '—'}</td>
                        <td className="py-2.5 px-3 text-right">{s.quantity}</td>
                        <td className="py-2.5 px-3 text-right text-gray-500">{formatCurrency(s.unit_price)}</td>
                        <td className="py-2.5 px-3 text-right font-medium">{formatCurrency(s.total_amount)}</td>
                        <td className="py-2.5 px-3">
                          <span className={cn(
                            'px-2 py-0.5 rounded-full text-xs font-medium uppercase',
                            s.payment_method === 'qr' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                          )}>
                            {s.payment_method}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {sales.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-gray-400 text-sm">
                          No sales data
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Delivery Orders Tab ── */}
          {activeTab === 'delivery-orders' && (
            <div className="overflow-x-auto">
              <div className="flex justify-end mb-4">
                <Link
                  href={`/admin/delivery-orders?store_id=${storeId}`}
                  className="px-4 py-2 bg-[#0A0A0A] text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
                >
                  + New Delivery Order
                </Link>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">DO Number</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Type</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Status</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Dispatch Date</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Pairs</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {dos.map((d) => (
                    <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2.5 px-3 font-mono text-xs text-gray-700">{d.do_number}</td>
                      <td className="py-2.5 px-3 capitalize text-gray-600">{d.do_type}</td>
                      <td className="py-2.5 px-3">
                        <span className={cn(
                          'px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                          d.status === 'delivered' || d.status === 'acknowledged' ? 'bg-green-100 text-green-700' :
                          d.status === 'dispatched' ? 'bg-blue-100 text-blue-700' :
                          d.status === 'confirmed' ? 'bg-purple-100 text-purple-700' :
                          'bg-gray-100 text-gray-600'
                        )}>
                          {d.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-gray-500 text-xs">
                        {d.dispatch_date ? formatMYDate(d.dispatch_date) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium">{d.total_pairs}</td>
                      <td className="py-2.5 px-3 text-right">
                        {d.pdf_url ? (
                          <a href={d.pdf_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                            Download
                          </a>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {dos.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-gray-400 text-sm">
                        No delivery orders
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Commissions Tab ── */}
          {activeTab === 'commissions' && (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Period</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Units</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Revenue</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Commission</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Status</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commissions.map((c) => (
                      <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="py-2.5 px-3 text-gray-800 font-medium">
                          {String(c.period_month).padStart(2, '0')}/{c.period_year}
                        </td>
                        <td className="py-2.5 px-3 text-right">{c.total_units_sold}</td>
                        <td className="py-2.5 px-3 text-right">{formatCurrency(c.total_revenue)}</td>
                        <td className="py-2.5 px-3 text-right font-semibold">{formatCurrency(c.commission_amount)}</td>
                        <td className="py-2.5 px-3">
                          <CommissionStatusBadge status={c.status} />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center justify-end gap-2">
                            <a
                              href={`/api/commissions/${c.id}/pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                            >
                              Invoice PDF
                            </a>
                            {c.status === 'pending' && (
                              <button
                                onClick={() => approveCommission(c.id)}
                                className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                              >
                                Approve
                              </button>
                            )}
                            {c.status === 'approved' && (
                              <button
                                onClick={() => { setPaidModal({ open: true, periodId: c.id }); setPaidRef('') }}
                                className="text-xs px-2.5 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                              >
                                Mark Paid
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {commissions.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-gray-400 text-sm">
                          No commission periods
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mark as Paid Modal */}
      {paidModal.open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">Mark Commission as Paid</h3>
              <button onClick={() => setPaidModal({ open: false, periodId: null })}>
                <X size={18} className="text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Enter the payment/transfer reference number for your records.</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Payment Reference *</label>
                <input
                  type="text"
                  value={paidRef}
                  onChange={(e) => setPaidRef(e.target.value)}
                  placeholder="e.g. TT-20240601 or IBG ref"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setPaidModal({ open: false, periodId: null })}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={markPaidCommission}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
              >
                Confirm Paid
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Stock Modal */}
      {adjustModal.open && adjustModal.inventory && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">Adjust Stock</h3>
              <button onClick={() => setAdjustModal({ open: false, inventory: null })}>
                <X size={18} className="text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <div className="mb-3">
              <p className="text-sm text-gray-700 font-medium">
                {(adjustModal.inventory.product as Product)?.name}
              </p>
              <p className="text-xs text-gray-500">
                Current: {adjustModal.inventory.quantity_on_hand} units
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Type</label>
                <select
                  value={adjustType}
                  onChange={(e) => setAdjustType(e.target.value as typeof adjustType)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                >
                  <option value="adjustment_add">Add Stock</option>
                  <option value="adjustment_remove">Remove Stock</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Quantity</label>
                <input
                  type="number"
                  min={1}
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={adjustNotes}
                  onChange={(e) => setAdjustNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setAdjustModal({ open: false, inventory: null })}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={adjustStock}
                className="flex-1 px-4 py-2 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
