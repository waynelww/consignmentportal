'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Plus, X, Pencil, Trash2, Loader2, Search, ArrowUpDown, Truck, Eye, FileText, Package } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatMYDate, cn } from '@/lib/utils'
import type { DeliveryOrder, DeliveryOrderStatus, DeliveryOrderType, Store, Product } from '@/types'
import { toast } from 'sonner'

interface DOWithStore extends DeliveryOrder { store_name: string }
interface DispatchModal { open: boolean; doId: string; courier: string; tracking: string }
interface CreateDOItem { product_id: string; quantity: number }
interface DetailItem { id: string; quantity: number; unit_cost: number; product: { name: string; sku: string; image_url?: string | null } | null }

type SortBy = 'date-desc' | 'date-asc' | 'pairs-desc' | 'pairs-asc' | 'store'

export default function DeliveryOrdersPage() {
  const [orders, setOrders]   = useState<DOWithStore[]>([])
  const [loading, setLoading] = useState(true)
  const [stores, setStores]   = useState<Store[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter]   = useState('')
  const [sortBy, setSortBy]           = useState<SortBy>('date-desc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Single dispatch modal
  const [dispatchModal, setDispatchModal] = useState<DispatchModal>({ open: false, doId: '', courier: '', tracking: '' })

  // Bulk dispatch modal
  const [bulkDispatchModal, setBulkDispatchModal] = useState(false)
  const [bulkCourier, setBulkCourier] = useState('')
  const [bulkTracking, setBulkTracking] = useState('')
  const [bulkDispatchSubmitting, setBulkDispatchSubmitting] = useState(false)

  // Create / edit / cancel
  const [createModal, setCreateModal] = useState(false)
  const [createStore, setCreateStore] = useState('')
  const [createType, setCreateType]   = useState<DeliveryOrderType>('restock')
  const [createNotes, setCreateNotes] = useState('')
  const [createItems, setCreateItems] = useState<CreateDOItem[]>([])
  const [createSearch, setCreateSearch] = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [editingDo, setEditingDo]     = useState<DOWithStore | null>(null)
  const [editItems, setEditItems]     = useState<CreateDOItem[]>([])
  const [editNotes, setEditNotes]     = useState('')
  const [editSearch, setEditSearch]   = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [cancellingDoId, setCancellingDoId] = useState<string | null>(null)

  // Details modal
  const [detailDO, setDetailDO] = useState<DOWithStore | null>(null)
  const [detailItems, setDetailItems] = useState<DetailItem[] | null>(null)

  const supabase = createClient()

  async function openDetails(d: DOWithStore) {
    setDetailDO(d)
    setDetailItems(null)
    const { data, error } = await supabase
      .from('delivery_order_items')
      .select('id, quantity, unit_cost, product:products(name, sku, image_url)')
      .eq('delivery_order_id', d.id)
    if (error) {
      toast.error('Failed to load DO items')
      setDetailItems([])
      return
    }
    setDetailItems((data as unknown as DetailItem[]) ?? [])
  }

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('delivery_orders')
      .select('*, store:stores(store_name)')
      .order('created_at', { ascending: false })
      .limit(200)
    if (dateFrom)    query = query.gte('created_at', dateFrom)
    if (dateTo)      query = query.lte('created_at', dateTo + 'T23:59:59')
    if (storeFilter) query = query.eq('store_id', storeFilter)
    if (statusFilter) query = query.eq('status', statusFilter)
    if (typeFilter)  query = query.eq('do_type', typeFilter)
    const { data } = await query
    setOrders((data || []).map((d: any) => ({ ...d, store_name: d.store?.store_name || '—' })))
    setLoading(false)
  }, [dateFrom, dateTo, storeFilter, statusFilter, typeFilter])

  useEffect(() => {
    fetchOrders()
    supabase.from('stores').select('id, store_name').eq('status', 'active').order('store_name')
      .then(({ data }) => setStores((data || []) as Store[]))
    supabase.from('products').select('id, sku, name').eq('is_active', true).order('sku')
      .then(({ data }) => setProducts((data || []) as Product[]))
  }, [fetchOrders])

  // Clear selection when filters/sort change
  useEffect(() => { setSelectedIds(new Set()) }, [dateFrom, dateTo, storeFilter, statusFilter, typeFilter, sortBy])

  const sorted = useMemo(() => {
    return [...orders].sort((a, b) => {
      switch (sortBy) {
        case 'date-asc':   return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        case 'pairs-desc': return b.total_pairs - a.total_pairs
        case 'pairs-asc':  return a.total_pairs - b.total_pairs
        case 'store':      return a.store_name.localeCompare(b.store_name)
        default:           return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
    })
  }, [orders, sortBy])

  // Checkbox helpers
  const allVisibleIds = sorted.map((d) => d.id)
  const allSelected   = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIds.has(id))
  const someSelected  = !allSelected && allVisibleIds.some((id) => selectedIds.has(id))
  function toggleAll() { setSelectedIds(allSelected ? new Set() : new Set(allVisibleIds)) }
  function toggleRow(id: string) {
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const selectedRows         = sorted.filter((d) => selectedIds.has(d.id))
  const bulkDispatchTargets  = selectedRows.filter((d) => d.status === 'confirmed' || d.status === 'draft')
  const bulkDeliverTargets   = selectedRows.filter((d) => d.status === 'dispatched')
  const canBulkDispatch      = bulkDispatchTargets.length > 0
  const canBulkDeliver       = bulkDeliverTargets.length > 0

  // ── Single dispatch ───────────────────────────────────────────────────────
  async function markDispatched() {
    const today = new Date().toISOString().slice(0, 10)
    const { data: updated, error } = await supabase
      .from('delivery_orders')
      .update({ status: 'delivered', courier: dispatchModal.courier, tracking_number: dispatchModal.tracking,
        dispatch_date: today, delivery_date: today, updated_at: new Date().toISOString() })
      .eq('id', dispatchModal.doId)
      .select('store_id, do_number, total_pairs')
      .single()
    if (error || !updated) { toast.error('Failed to update'); return }
    await supabase.from('notifications').insert({
      recipient_role: null, recipient_store_id: updated.store_id, type: 'do_delivered',
      title: 'Delivery Arrived',
      message: `${updated.do_number} (${updated.total_pairs} pairs) is waiting for you to confirm receipt.`,
      reference_id: dispatchModal.doId, reference_type: 'delivery_order', is_read: false,
    })
    toast.success('Dispatched — store notified')
    setDispatchModal({ open: false, doId: '', courier: '', tracking: '' })
    fetchOrders()
  }

  // ── Bulk dispatch ─────────────────────────────────────────────────────────
  async function executeBulkDispatch() {
    if (bulkDispatchTargets.length === 0) return
    const today = new Date().toISOString().slice(0, 10)
    setBulkDispatchSubmitting(true)
    let ok = 0, fail = 0
    for (const d of bulkDispatchTargets) {
      const { data: updated, error } = await supabase
        .from('delivery_orders')
        .update({ status: 'delivered', courier: bulkCourier || null, tracking_number: bulkTracking || null,
          dispatch_date: today, delivery_date: today, updated_at: new Date().toISOString() })
        .eq('id', d.id)
        .select('store_id, do_number, total_pairs')
        .single()
      if (error || !updated) { fail++; continue }
      ok++
      await supabase.from('notifications').insert({
        recipient_role: null, recipient_store_id: updated.store_id, type: 'do_delivered',
        title: 'Delivery Arrived',
        message: `${updated.do_number} (${updated.total_pairs} pairs) is waiting for you to confirm receipt.`,
        reference_id: d.id, reference_type: 'delivery_order', is_read: false,
      })
    }
    setBulkDispatchSubmitting(false)
    setBulkDispatchModal(false); setBulkCourier(''); setBulkTracking('')
    setSelectedIds(new Set())
    if (ok)   toast.success(`${ok} DO${ok > 1 ? 's' : ''} dispatched — stores notified`)
    if (fail) toast.error(`${fail} failed`)
    fetchOrders()
  }

  // ── Bulk mark delivered ───────────────────────────────────────────────────
  async function executeBulkDeliver() {
    if (bulkDeliverTargets.length === 0) return
    let ok = 0, fail = 0
    for (const d of bulkDeliverTargets) {
      const { error } = await supabase.from('delivery_orders')
        .update({ status: 'delivered', delivery_date: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() })
        .eq('id', d.id)
      error ? fail++ : ok++
    }
    setSelectedIds(new Set())
    if (ok)   toast.success(`${ok} DO${ok > 1 ? 's' : ''} marked as delivered`)
    if (fail) toast.error(`${fail} failed`)
    fetchOrders()
  }

  // ── Edit helpers ──────────────────────────────────────────────────────────
  async function openEdit(d: DOWithStore) {
    const { data: items, error } = await supabase.from('delivery_order_items')
      .select('product_id, quantity').eq('delivery_order_id', d.id)
    if (error) { toast.error('Failed to load items'); return }
    setEditingDo(d)
    setEditItems(((items as { product_id: string; quantity: number }[]) ?? []).map((i) => ({ product_id: i.product_id, quantity: i.quantity })))
    setEditNotes(d.notes ?? ''); setEditSearch('')
  }
  function closeEdit() { setEditingDo(null); setEditItems([]); setEditNotes(''); setEditSearch('') }
  function editAddProduct(productId: string) {
    setEditItems((prev) => {
      const ex = prev.find((i) => i.product_id === productId)
      return ex ? prev.map((i) => i.product_id === productId ? { ...i, quantity: i.quantity + 1 } : i)
                : [...prev, { product_id: productId, quantity: 1 }]
    }); setEditSearch('')
  }
  function editSetQty(productId: string, qty: number) {
    if (qty <= 0) { editRemove(productId); return }
    setEditItems((prev) => prev.map((i) => i.product_id === productId ? { ...i, quantity: qty } : i))
  }
  function editRemove(productId: string) { setEditItems((prev) => prev.filter((i) => i.product_id !== productId)) }
  async function submitEdit() {
    if (!editingDo || editItems.length === 0) { toast.error('At least one SKU is required'); return }
    setEditSubmitting(true)
    try {
      const res = await fetch(`/api/delivery-orders/${editingDo.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: editItems.filter((i) => i.product_id && i.quantity > 0), notes: editNotes.trim() || null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Failed')
      toast.success('Delivery order updated'); closeEdit(); fetchOrders()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to update') }
    finally { setEditSubmitting(false) }
  }

  async function cancelDO(d: DOWithStore) {
    if (!window.confirm(`Cancel ${d.do_number}? This permanently removes the DO and its ${d.total_pairs} pairs.`)) return
    setCancellingDoId(d.id)
    try {
      const res = await fetch(`/api/delivery-orders/${d.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Failed')
      toast.success(`${d.do_number} cancelled`); fetchOrders()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to cancel') }
    finally { setCancellingDoId(null) }
  }

  async function markDelivered(id: string) {
    if (!window.confirm('Mark this DO as delivered?')) return
    const { error } = await supabase.from('delivery_orders')
      .update({ status: 'delivered', delivery_date: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) toast.error('Failed to update')
    else { toast.success('Marked as delivered'); fetchOrders() }
  }

  // ── Create DO helpers ─────────────────────────────────────────────────────
  function createAddProduct(productId: string) {
    setCreateItems((prev) => {
      const ex = prev.find((i) => i.product_id === productId)
      return ex ? prev.map((i) => i.product_id === productId ? { ...i, quantity: i.quantity + 1 } : i)
                : [...prev, { product_id: productId, quantity: 1 }]
    }); setCreateSearch('')
  }
  function createSetQty(productId: string, qty: number) {
    if (qty <= 0) { createRemove(productId); return }
    setCreateItems((prev) => prev.map((i) => i.product_id === productId ? { ...i, quantity: qty } : i))
  }
  function createRemove(productId: string) { setCreateItems((prev) => prev.filter((i) => i.product_id !== productId)) }
  async function createDO() {
    if (!createStore) { toast.error('Select a store'); return }
    const validItems = createItems.filter((i) => i.product_id && i.quantity > 0)
    if (validItems.length === 0) { toast.error('Add at least one product'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/delivery-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: createStore, do_type: createType, items: validItems, notes: createNotes }),
      })
      if (!res.ok) { toast.error('Failed to create DO'); return }
      toast.success('Delivery order created')
      setCreateModal(false); setCreateItems([]); setCreateSearch(''); setCreateNotes(''); setCreateStore('')
      fetchOrders()
    } catch { toast.error('An error occurred') }
    finally { setSubmitting(false) }
  }

  const statusColor = (s: DeliveryOrderStatus): string => ({
    draft:        'bg-gray-100 text-gray-600',
    confirmed:    'bg-blue-100 text-blue-700',
    dispatched:   'bg-cyan-100 text-cyan-700',
    delivered:    'bg-yellow-100 text-yellow-800',
    acknowledged: 'bg-green-100 text-green-700',
  }[s] || 'bg-gray-100 text-gray-600')

  const statusLabel = (s: DeliveryOrderStatus): string => ({
    draft:        'Draft',
    confirmed:    'Incoming',
    dispatched:   'On the Way',
    delivered:    'Waiting to Receive',
    acknowledged: 'Shop Received',
  }[s] || s)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex justify-end">
        <button onClick={() => setCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 transition-colors">
          <Plus size={16} /> Create DO
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Store</label>
            <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]">
              <option value="">All Stores</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.store_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]">
              <option value="">All Statuses</option>
              {(['draft','confirmed','dispatched','delivered','acknowledged'] as const).map((s) => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]">
              <option value="">All Types</option>
              <option value="initial">Initial</option>
              <option value="restock">Restock</option>
              <option value="return">Return</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <ArrowUpDown size={13} className="text-gray-400" />
            <div>
              <label className="text-xs text-gray-500 block mb-1">Sort</label>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]">
                <option value="date-desc">Date (Newest)</option>
                <option value="date-asc">Date (Oldest)</option>
                <option value="pairs-desc">Pairs (High → Low)</option>
                <option value="pairs-asc">Pairs (Low → High)</option>
                <option value="store">Store A → Z</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="bg-[#0A0A0A] text-white rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">{selectedIds.size} selected</span>
          {canBulkDispatch && (
            <button onClick={() => { setBulkDispatchModal(true); setBulkCourier(''); setBulkTracking('') }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-cyan-500 text-white font-bold rounded-lg hover:bg-cyan-400 transition-colors">
              <Truck size={13} /> Dispatch {bulkDispatchTargets.length} DO{bulkDispatchTargets.length > 1 ? 's' : ''}
            </button>
          )}
          {canBulkDeliver && (
            <button onClick={executeBulkDeliver}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-500 text-white font-bold rounded-lg hover:bg-green-400 transition-colors">
              <Plus size={13} /> Mark Delivered ({bulkDeliverTargets.length})
            </button>
          )}
          <button onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-white/60 hover:text-white transition-colors">
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected }}
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-[#0A0A0A] focus:ring-[#FFD700] cursor-pointer" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">DO Number</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Store</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Dispatch Date</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Pairs</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Courier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Tracking</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      {Array.from({ length: 10 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 animate-pulse rounded" /></td>
                      ))}
                    </tr>
                  ))
                : sorted.map((d) => {
                    const checked = selectedIds.has(d.id)
                    return (
                      <tr key={d.id} className={cn('border-b border-gray-50 hover:bg-gray-50/50 transition-colors', checked && 'bg-amber-50/50')}>
                        <td className="px-4 py-3 w-10">
                          <input type="checkbox" checked={checked} onChange={() => toggleRow(d.id)}
                            className="rounded border-gray-300 text-[#0A0A0A] focus:ring-[#FFD700] cursor-pointer" />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          <button onClick={() => openDetails(d)} className="text-blue-700 hover:underline font-semibold">
                            {d.do_number}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-800">{d.store_name}</td>
                        <td className="px-4 py-3 capitalize text-gray-600">{d.do_type}</td>
                        <td className="px-4 py-3">
                          <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-medium', statusColor(d.status))}>
                            {statusLabel(d.status)}
                          </span>
                          {d.pdf_url && (
                            <span className="ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-600 text-white">
                              ✓ Signed
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{d.dispatch_date ? formatMYDate(d.dispatch_date) : '—'}</td>
                        <td className="px-4 py-3 text-right font-medium">{d.total_pairs}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{d.courier || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs font-mono">{d.tracking_number || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => openDetails(d)}
                              className="text-xs p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors" title="View details">
                              <Eye size={13} />
                            </button>
                            <a href={`/api/delivery-orders/${d.id}/pdf?inline`} target="_blank" rel="noopener noreferrer"
                              className="text-xs p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors" title="Open PDF">
                              <FileText size={13} />
                            </a>
                            {(d.status === 'confirmed' || d.status === 'draft') && (
                              <button onClick={() => setDispatchModal({ open: true, doId: d.id, courier: d.courier || '', tracking: d.tracking_number || '' })}
                                className="text-xs px-2.5 py-1 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors">
                                Dispatch
                              </button>
                            )}
                            {d.status === 'dispatched' && (
                              <button onClick={() => markDelivered(d.id)}
                                className="text-xs px-2.5 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                                Delivered
                              </button>
                            )}
                            {d.status !== 'acknowledged' && (
                              <>
                                <button onClick={() => openEdit(d)}
                                  className="text-xs p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors" title="Edit">
                                  <Pencil size={13} />
                                </button>
                                <button onClick={() => cancelDO(d)} disabled={cancellingDoId === d.id}
                                  className="text-xs p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40" title="Cancel">
                                  {cancellingDoId === d.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
              }
              {!loading && sorted.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400 text-sm">No delivery orders found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── DO Details Modal ──────────────────────────────────────────────────── */}
      {detailDO && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setDetailDO(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-semibold text-gray-900 font-mono">{detailDO.do_number}</h3>
                <span className={cn('inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium', statusColor(detailDO.status))}>
                  {statusLabel(detailDO.status)}
                </span>
              </div>
              <button onClick={() => setDetailDO(null)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>

            <div className="px-5 py-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-4">
                <div><span className="text-xs text-gray-400 block">Store</span>{detailDO.store_name}</div>
                <div><span className="text-xs text-gray-400 block">Type</span><span className="capitalize">{detailDO.do_type}</span></div>
                <div><span className="text-xs text-gray-400 block">Created</span>{formatMYDate(detailDO.created_at)}</div>
                <div><span className="text-xs text-gray-400 block">Dispatch Date</span>{detailDO.dispatch_date ? formatMYDate(detailDO.dispatch_date) : '—'}</div>
                <div><span className="text-xs text-gray-400 block">Courier</span>{detailDO.courier || '—'}</div>
                <div><span className="text-xs text-gray-400 block">Tracking</span><span className="font-mono text-xs">{detailDO.tracking_number || '—'}</span></div>
              </div>
              {detailDO.notes && (
                <p className="text-xs text-gray-500 italic mb-4 bg-gray-50 rounded-lg px-3 py-2">{detailDO.notes}</p>
              )}

              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Items {detailItems ? `(${detailItems.length} SKUs · ${detailItems.reduce((s, i) => s + i.quantity, 0)} pairs)` : ''}
              </h4>
              {detailItems === null ? (
                <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-gray-300" /></div>
              ) : detailItems.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No items found</p>
              ) : (
                <div className="space-y-2">
                  {detailItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-3 min-w-0">
                        {item.product?.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.product.image_url} alt={item.product.sku}
                            loading="lazy"
                            className="w-10 h-10 rounded-lg object-cover bg-gray-50 border border-gray-100 shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0">
                            <Package size={16} className="text-gray-300" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm text-gray-800 truncate">{item.product?.name ?? 'Unknown product'}</p>
                          <p className="text-xs font-mono text-gray-400">{item.product?.sku}</p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold shrink-0">× {item.quantity}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex gap-3 shrink-0">
              <a href={`/api/delivery-orders/${detailDO.id}/pdf?inline`} target="_blank" rel="noopener noreferrer"
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                <FileText size={15} />
                Open PDF
              </a>
              <button onClick={() => setDetailDO(null)}
                className="flex-1 py-2.5 bg-[#0A0A0A] text-white rounded-lg text-sm font-semibold hover:bg-gray-800 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Single Dispatch Modal ─────────────────────────────────────────────── */}
      {dispatchModal.open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-gray-900">Mark as Dispatched</h3>
              <button onClick={() => setDispatchModal({ open: false, doId: '', courier: '', tracking: '' })}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Courier</label>
                <input type="text" value={dispatchModal.courier}
                  onChange={(e) => setDispatchModal((p) => ({ ...p, courier: e.target.value }))}
                  placeholder="e.g. J&T, Poslaju, GDex"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Tracking Number</label>
                <input type="text" value={dispatchModal.tracking}
                  onChange={(e) => setDispatchModal((p) => ({ ...p, tracking: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setDispatchModal({ open: false, doId: '', courier: '', tracking: '' })}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={markDispatched}
                className="flex-1 py-2.5 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 transition-colors">Confirm Dispatch</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Dispatch Modal ───────────────────────────────────────────────── */}
      {bulkDispatchModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">Bulk Dispatch</h3>
              <button onClick={() => setBulkDispatchModal(false)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600">
                Dispatching <span className="font-bold text-gray-900">{bulkDispatchTargets.length} DO{bulkDispatchTargets.length > 1 ? 's' : ''}</span>.
                Courier and tracking apply to all (leave blank if unknown).
              </p>
              <div className="bg-gray-50 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                {bulkDispatchTargets.map((d) => (
                  <div key={d.id} className="px-3 py-2 flex justify-between text-xs">
                    <span className="font-mono text-gray-600">{d.do_number}</span>
                    <span className="text-gray-700 font-medium">{d.store_name} · {d.total_pairs} pairs</span>
                  </div>
                ))}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Courier (optional)</label>
                <input type="text" value={bulkCourier} onChange={(e) => setBulkCourier(e.target.value)}
                  placeholder="e.g. J&T, Poslaju, GDex"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Tracking Number (optional)</label>
                <input type="text" value={bulkTracking} onChange={(e) => setBulkTracking(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
              </div>
              <button onClick={executeBulkDispatch} disabled={bulkDispatchSubmitting}
                className="w-full py-2.5 bg-[#0A0A0A] text-white rounded-lg text-sm font-bold hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                {bulkDispatchSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
                Confirm Dispatch All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create DO Modal ───────────────────────────────────────────────────── */}
      {createModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-gray-900">Create Delivery Order</h3>
              <button onClick={() => setCreateModal(false)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Store *</label>
                  <select value={createStore} onChange={(e) => setCreateStore(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]">
                    <option value="">Select store...</option>
                    {stores.map((s) => <option key={s.id} value={s.id}>{s.store_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Type</label>
                  <select value={createType} onChange={(e) => setCreateType(e.target.value as DeliveryOrderType)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]">
                    <option value="initial">Initial</option>
                    <option value="restock">Restock</option>
                    <option value="return">Return</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Products *</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input type="text" value={createSearch} onChange={(e) => setCreateSearch(e.target.value)}
                    placeholder="Search by SKU or name (e.g. A54, Ankle, Patches)"
                    className="w-full h-10 pl-9 pr-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
                </div>
                {(() => {
                  const q = createSearch.trim().toLowerCase()
                  const matches = q ? products.filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0, 15) : []
                  return (
                    <div className="mt-1 border border-gray-200 rounded-lg h-48 overflow-y-auto bg-white shadow-sm">
                      {!q ? <p className="text-xs text-gray-400 px-3 py-2">Start typing a SKU or name to search…</p>
                          : matches.length === 0 ? <p className="text-xs text-gray-400 px-3 py-2">No SKUs match.</p>
                          : matches.map((p) => (
                              <button key={p.id} type="button" onClick={() => createAddProduct(p.id)}
                                className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-b-0 flex items-center gap-2 text-sm">
                                <span className="font-mono text-xs text-gray-500 shrink-0 w-28 truncate">{p.sku}</span>
                                <span className="text-gray-800 truncate">{p.name}</span>
                              </button>
                            ))
                      }
                    </div>
                  )
                })()}
                <div className="mt-3">
                  <p className="text-xs font-semibold text-gray-600 mb-2">Items ({createItems.length} SKU{createItems.length !== 1 ? 's' : ''} · {createItems.reduce((s, i) => s + i.quantity, 0)} pairs)</p>
                  {createItems.length === 0
                    ? <p className="text-xs text-gray-400 py-4 text-center bg-gray-50 rounded-lg">No items yet.</p>
                    : (
                      <div className="border border-gray-100 rounded-lg overflow-hidden">
                        {createItems.map((item) => {
                          const product = products.find((p) => p.id === item.product_id)
                          return (
                            <div key={item.product_id} className="flex items-center gap-3 px-3 py-2 border-b border-gray-50 last:border-b-0">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-mono text-gray-500">{product?.sku ?? '—'}</p>
                                <p className="text-sm text-gray-800 truncate">{product?.name ?? '(unknown)'}</p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button type="button" onClick={() => createSetQty(item.product_id, item.quantity - 1)} className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold hover:bg-gray-200">−</button>
                                <input type="number" min={1} value={item.quantity} onChange={(e) => createSetQty(item.product_id, Number(e.target.value) || 1)}
                                  className="w-14 h-7 text-center text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
                                <button type="button" onClick={() => createSetQty(item.product_id, item.quantity + 1)} className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold hover:bg-gray-200">+</button>
                                <button type="button" onClick={() => createRemove(item.product_id)} className="ml-1 text-gray-400 hover:text-red-500"><X size={14} /></button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  }
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Notes</label>
                <textarea rows={2} value={createNotes} onChange={(e) => setCreateNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setCreateModal(false)} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={createDO} disabled={submitting}
                className="flex-1 py-2.5 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50 transition-colors">
                {submitting ? 'Creating...' : 'Create DO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit DO Modal ─────────────────────────────────────────────────────── */}
      {editingDo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div className="absolute inset-0 bg-black/50" onClick={() => !editSubmitting && closeEdit()} />
          <div className="relative bg-white rounded-xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Edit {editingDo.do_number}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{editingDo.store_name} · {editingDo.status}</p>
              </div>
              <button onClick={() => !editSubmitting && closeEdit()} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Add a SKU</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input type="text" value={editSearch} onChange={(e) => setEditSearch(e.target.value)}
                    placeholder="Search by SKU or name…"
                    className="w-full h-10 pl-9 pr-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
                </div>
                {editSearch.trim() && (
                  <div className="mt-1 border border-gray-200 rounded-lg max-h-48 overflow-y-auto bg-white shadow-sm">
                    {products.filter((p) => { const q = editSearch.trim().toLowerCase(); return p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) }).slice(0, 15).map((p) => (
                      <button key={p.id} onClick={() => editAddProduct(p.id)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-b-0 flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs text-gray-500 shrink-0 w-16">{p.sku}</span>
                        <span className="text-gray-800 truncate">{p.name}</span>
                      </button>
                    ))}
                    {products.filter((p) => { const q = editSearch.trim().toLowerCase(); return p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) }).length === 0 && (
                      <p className="text-xs text-gray-400 px-3 py-2">No SKUs match.</p>
                    )}
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">Items ({editItems.length} SKU{editItems.length !== 1 ? 's' : ''} · {editItems.reduce((s, i) => s + i.quantity, 0)} pairs)</p>
                {editItems.length === 0
                  ? <p className="text-xs text-gray-400 py-4 text-center bg-gray-50 rounded-lg">No items yet.</p>
                  : (
                    <div className="border border-gray-100 rounded-lg overflow-hidden">
                      {editItems.map((item) => {
                        const product = products.find((p) => p.id === item.product_id)
                        return (
                          <div key={item.product_id} className="flex items-center gap-3 px-3 py-2 border-b border-gray-50 last:border-b-0">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-mono text-gray-500">{product?.sku ?? '—'}</p>
                              <p className="text-sm text-gray-800 truncate">{product?.name ?? '(unknown)'}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button type="button" onClick={() => editSetQty(item.product_id, item.quantity - 1)} className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold hover:bg-gray-200">−</button>
                              <input type="number" min={1} value={item.quantity} onChange={(e) => editSetQty(item.product_id, Number(e.target.value) || 1)}
                                className="w-16 h-8 px-2 text-sm font-bold border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] text-center" />
                              <button type="button" onClick={() => editSetQty(item.product_id, item.quantity + 1)} className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold hover:bg-gray-200">+</button>
                              <button type="button" onClick={() => editRemove(item.product_id)} className="w-7 h-7 rounded-lg bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100 ml-1" title="Remove"><Trash2 size={12} /></button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                }
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Notes (optional)</label>
                <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none"
                  placeholder="Internal notes…" />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 shrink-0 flex justify-end gap-2">
              <button onClick={() => !editSubmitting && closeEdit()} className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={submitEdit} disabled={editSubmitting || editItems.length === 0}
                className="px-5 py-2 bg-[#0A0A0A] text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2">
                {editSubmitting && <Loader2 size={14} className="animate-spin" />} Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
