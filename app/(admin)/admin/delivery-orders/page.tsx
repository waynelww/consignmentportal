'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, X, Pencil, Trash2, Loader2, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatMYDate, cn } from '@/lib/utils'
import type { DeliveryOrder, DeliveryOrderStatus, DeliveryOrderType, Store, Product } from '@/types'
import { toast } from 'sonner'

interface DOWithStore extends DeliveryOrder {
  store_name: string
}

interface DispatchModal {
  open: boolean
  doId: string
  courier: string
  tracking: string
}

interface CreateDOItem {
  product_id: string
  quantity: number
}

export default function DeliveryOrdersPage() {
  const [orders, setOrders] = useState<DOWithStore[]>([])
  const [loading, setLoading] = useState(true)
  const [stores, setStores] = useState<Store[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [dispatchModal, setDispatchModal] = useState<DispatchModal>({ open: false, doId: '', courier: '', tracking: '' })
  const [createModal, setCreateModal] = useState(false)
  const [createStore, setCreateStore] = useState('')
  const [createType, setCreateType] = useState<DeliveryOrderType>('restock')
  const [createNotes, setCreateNotes] = useState('')
  const [createItems, setCreateItems] = useState<CreateDOItem[]>([{ product_id: '', quantity: 1 }])
  const [submitting, setSubmitting] = useState(false)

  // Edit DO state
  const [editingDo, setEditingDo] = useState<DOWithStore | null>(null)
  const [editItems, setEditItems] = useState<CreateDOItem[]>([])
  const [editNotes, setEditNotes] = useState('')
  const [editSearch, setEditSearch] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [cancellingDoId, setCancellingDoId] = useState<string | null>(null)

  const supabase = createClient()

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('delivery_orders')
      .select('*, store:stores(store_name)')
      .order('created_at', { ascending: false })
      .limit(200)

    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59')
    if (storeFilter) query = query.eq('store_id', storeFilter)
    if (statusFilter) query = query.eq('status', statusFilter)
    if (typeFilter) query = query.eq('do_type', typeFilter)

    const { data } = await query
    setOrders(
      (data || []).map((d: any) => ({
        ...d,
        store_name: d.store?.store_name || '—',
      }))
    )
    setLoading(false)
  }, [dateFrom, dateTo, storeFilter, statusFilter, typeFilter])

  useEffect(() => {
    fetchOrders()
    // Load stores and products for create modal
    supabase.from('stores').select('id, store_name').eq('status', 'active').order('store_name').then(({ data }) => {
      setStores((data || []) as Store[])
    })
    supabase.from('products').select('id, sku, name').eq('is_active', true).order('sku').then(({ data }) => {
      setProducts((data || []) as Product[])
    })
  }, [fetchOrders])

  async function markDispatched() {
    const { error } = await supabase
      .from('delivery_orders')
      .update({
        status: 'dispatched',
        courier: dispatchModal.courier,
        tracking_number: dispatchModal.tracking,
        dispatch_date: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      })
      .eq('id', dispatchModal.doId)

    if (error) toast.error('Failed to update')
    else {
      toast.success('Marked as dispatched')
      setDispatchModal({ open: false, doId: '', courier: '', tracking: '' })
      fetchOrders()
    }
  }

  async function openEdit(d: DOWithStore) {
    // Fetch the existing items
    const { data: items, error } = await supabase
      .from('delivery_order_items')
      .select('product_id, quantity')
      .eq('delivery_order_id', d.id)

    if (error) {
      toast.error('Failed to load items')
      return
    }
    setEditingDo(d)
    setEditItems(
      ((items as { product_id: string; quantity: number }[]) ?? []).map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
      }))
    )
    setEditNotes(d.notes ?? '')
    setEditSearch('')
  }

  function closeEdit() {
    setEditingDo(null)
    setEditItems([])
    setEditNotes('')
    setEditSearch('')
  }

  function editAddProduct(productId: string) {
    // If already in the list, just +1 to its quantity. Otherwise append.
    setEditItems((prev) => {
      const existing = prev.find((i) => i.product_id === productId)
      if (existing) {
        return prev.map((i) => (i.product_id === productId ? { ...i, quantity: i.quantity + 1 } : i))
      }
      return [...prev, { product_id: productId, quantity: 1 }]
    })
    setEditSearch('')
  }

  function editSetQty(productId: string, qty: number) {
    if (qty <= 0) {
      editRemove(productId)
      return
    }
    setEditItems((prev) =>
      prev.map((i) => (i.product_id === productId ? { ...i, quantity: qty } : i))
    )
  }

  function editRemove(productId: string) {
    setEditItems((prev) => prev.filter((i) => i.product_id !== productId))
  }

  async function submitEdit() {
    if (!editingDo) return
    if (editItems.length === 0) {
      toast.error('At least one SKU is required')
      return
    }
    setEditSubmitting(true)
    try {
      const res = await fetch(`/api/delivery-orders/${editingDo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: editItems.filter((i) => i.product_id && i.quantity > 0),
          notes: editNotes.trim() || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Failed')
      toast.success('Delivery order updated')
      closeEdit()
      fetchOrders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setEditSubmitting(false)
    }
  }

  async function cancelDO(d: DOWithStore) {
    const ok = window.confirm(
      `Cancel ${d.do_number}? This permanently removes the DO and its ${d.total_pairs} pairs.`
    )
    if (!ok) return
    setCancellingDoId(d.id)
    try {
      const res = await fetch(`/api/delivery-orders/${d.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Failed')
      toast.success(`${d.do_number} cancelled`)
      fetchOrders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel')
    } finally {
      setCancellingDoId(null)
    }
  }

  async function markDelivered(id: string) {
    const confirmed = window.confirm('Mark this DO as delivered?')
    if (!confirmed) return
    const { error } = await supabase
      .from('delivery_orders')
      .update({
        status: 'delivered',
        delivery_date: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) toast.error('Failed to update')
    else { toast.success('Marked as delivered'); fetchOrders() }
  }

  async function createDO() {
    if (!createStore) { toast.error('Select a store'); return }
    const validItems = createItems.filter((i) => i.product_id && i.quantity > 0)
    if (validItems.length === 0) { toast.error('Add at least one product'); return }

    setSubmitting(true)
    try {
      const res = await fetch('/api/delivery-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: createStore,
          do_type: createType,
          items: validItems,
          notes: createNotes,
        }),
      })
      if (!res.ok) { toast.error('Failed to create DO'); setSubmitting(false); return }
      toast.success('Delivery order created')
      setCreateModal(false)
      setCreateItems([{ product_id: '', quantity: 1 }])
      setCreateNotes('')
      setCreateStore('')
      fetchOrders()
    } catch {
      toast.error('An error occurred')
    }
    setSubmitting(false)
  }

  function addItem() {
    setCreateItems((prev) => [...prev, { product_id: '', quantity: 1 }])
  }

  function removeItem(idx: number) {
    setCreateItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateItem(idx: number, field: keyof CreateDOItem, value: string | number) {
    setCreateItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    )
  }

  const statusColor = (s: DeliveryOrderStatus) => {
    const map: Record<DeliveryOrderStatus, string> = {
      draft: 'bg-gray-100 text-gray-600',
      confirmed: 'bg-blue-100 text-blue-700',
      dispatched: 'bg-cyan-100 text-cyan-700',
      delivered: 'bg-yellow-100 text-yellow-800',
      acknowledged: 'bg-green-100 text-green-700',
    }
    return map[s] || 'bg-gray-100 text-gray-600'
  }

  const statusLabel = (s: DeliveryOrderStatus): string => {
    const map: Record<DeliveryOrderStatus, string> = {
      draft: 'Draft',
      confirmed: 'Incoming',
      dispatched: 'On the Way',
      delivered: 'Waiting to Receive',
      acknowledged: 'Shop Received',
    }
    return map[s] || s
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex justify-end">
        <button
          onClick={() => setCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 transition-colors"
        >
          <Plus size={16} />
          Create DO
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Store</label>
            <select
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
            >
              <option value="">All Stores</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.store_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
            >
              <option value="">All Statuses</option>
              {(['draft', 'confirmed', 'dispatched', 'delivered', 'acknowledged'] as const).map((s) => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
            >
              <option value="">All Types</option>
              <option value="initial">Initial</option>
              <option value="restock">Restock</option>
              <option value="return">Return</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
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
                      {Array.from({ length: 9 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-100 animate-pulse rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                : orders.map((d) => (
                    <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{d.do_number}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{d.store_name}</td>
                      <td className="px-4 py-3 capitalize text-gray-600">{d.do_type}</td>
                      <td className="px-4 py-3">
                        <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-medium', statusColor(d.status))}>
                          {statusLabel(d.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {d.dispatch_date ? formatMYDate(d.dispatch_date) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{d.total_pairs}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{d.courier || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs font-mono">{d.tracking_number || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {d.pdf_url && (
                            <a
                              href={d.pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline"
                            >
                              PDF
                            </a>
                          )}
                          {(d.status === 'confirmed' || d.status === 'draft') && (
                            <button
                              onClick={() =>
                                setDispatchModal({
                                  open: true,
                                  doId: d.id,
                                  courier: d.courier || '',
                                  tracking: d.tracking_number || '',
                                })
                              }
                              className="text-xs px-2.5 py-1 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors"
                            >
                              Dispatch
                            </button>
                          )}
                          {d.status === 'dispatched' && (
                            <button
                              onClick={() => markDelivered(d.id)}
                              className="text-xs px-2.5 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                            >
                              Delivered
                            </button>
                          )}
                          {/* Edit + Cancel — hidden once the store has acknowledged receipt */}
                          {d.status !== 'acknowledged' && (
                            <>
                              <button
                                onClick={() => openEdit(d)}
                                className="text-xs p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                                title="Edit SKUs and quantities"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => cancelDO(d)}
                                disabled={cancellingDoId === d.id}
                                className="text-xs p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                                title="Cancel this DO"
                              >
                                {cancellingDoId === d.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Trash2 size={13} />
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              {!loading && orders.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-400 text-sm">
                    No delivery orders found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dispatch Modal */}
      {dispatchModal.open && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-gray-900">Mark as Dispatched</h3>
              <button onClick={() => setDispatchModal({ open: false, doId: '', courier: '', tracking: '' })}>
                <X size={18} className="text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Courier</label>
                <input
                  type="text"
                  value={dispatchModal.courier}
                  onChange={(e) => setDispatchModal((p) => ({ ...p, courier: e.target.value }))}
                  placeholder="e.g. J&T, Poslaju, GDex"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Tracking Number</label>
                <input
                  type="text"
                  value={dispatchModal.tracking}
                  onChange={(e) => setDispatchModal((p) => ({ ...p, tracking: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setDispatchModal({ open: false, doId: '', courier: '', tracking: '' })}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={markDispatched}
                className="flex-1 py-2.5 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 transition-colors"
              >
                Confirm Dispatch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create DO Modal */}
      {createModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-gray-900">Create Delivery Order</h3>
              <button onClick={() => setCreateModal(false)}>
                <X size={18} className="text-gray-400 hover:text-gray-600" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Store *</label>
                  <select
                    value={createStore}
                    onChange={(e) => setCreateStore(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  >
                    <option value="">Select store...</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>{s.store_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Type</label>
                  <select
                    value={createType}
                    onChange={(e) => setCreateType(e.target.value as DeliveryOrderType)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  >
                    <option value="initial">Initial</option>
                    <option value="restock">Restock</option>
                    <option value="return">Return</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">Products *</label>
                  <button
                    onClick={addItem}
                    className="text-xs text-[#0A0A0A] hover:underline"
                  >
                    + Add row
                  </button>
                </div>
                <div className="space-y-2">
                  {createItems.map((item, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <select
                        value={item.product_id}
                        onChange={(e) => updateItem(idx, 'product_id', e.target.value)}
                        className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                      >
                        <option value="">Select product...</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} — {p.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                        className="w-20 px-2 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] text-center"
                      />
                      {createItems.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="text-gray-400 hover:text-red-500">
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setCreateModal(false)}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createDO}
                disabled={submitting}
                className="flex-1 py-2.5 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Creating...' : 'Create DO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit DO Modal — locked once status is 'acknowledged' (enforced server-side too) */}
      {editingDo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div className="absolute inset-0 bg-black/50" onClick={() => !editSubmitting && closeEdit()} />
          <div className="relative bg-white rounded-xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Edit {editingDo.do_number}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {editingDo.store_name} · {editingDo.status}
                </p>
              </div>
              <button
                onClick={() => !editSubmitting && closeEdit()}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Add product search */}
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Add a SKU</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    value={editSearch}
                    onChange={(e) => setEditSearch(e.target.value)}
                    placeholder="Search by SKU or name…"
                    className="w-full h-10 pl-9 pr-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                </div>
                {editSearch.trim() && (
                  <div className="mt-1 border border-gray-200 rounded-lg max-h-48 overflow-y-auto bg-white shadow-sm">
                    {products
                      .filter((p) => {
                        const q = editSearch.trim().toLowerCase()
                        return (
                          p.sku.toLowerCase().includes(q) ||
                          p.name.toLowerCase().includes(q)
                        )
                      })
                      .slice(0, 15)
                      .map((p) => (
                        <button
                          key={p.id}
                          onClick={() => editAddProduct(p.id)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50 last:border-b-0 flex items-center gap-2 text-sm"
                        >
                          <span className="font-mono text-xs text-gray-500 shrink-0 w-16">{p.sku}</span>
                          <span className="text-gray-800 truncate">{p.name}</span>
                        </button>
                      ))}
                    {products.filter((p) => {
                      const q = editSearch.trim().toLowerCase()
                      return p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
                    }).length === 0 && (
                      <p className="text-xs text-gray-400 px-3 py-2">No SKUs match.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Existing items */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">
                  Items in this DO ({editItems.length} SKU{editItems.length !== 1 ? 's' : ''} · {editItems.reduce((s, i) => s + i.quantity, 0)} pairs)
                </p>
                {editItems.length === 0 ? (
                  <p className="text-xs text-gray-400 py-4 text-center bg-gray-50 rounded-lg">
                    No items yet. Search above to add one.
                  </p>
                ) : (
                  <div className="border border-gray-100 rounded-lg overflow-hidden">
                    {editItems.map((item) => {
                      const product = products.find((p) => p.id === item.product_id)
                      return (
                        <div
                          key={item.product_id}
                          className="flex items-center gap-3 px-3 py-2 border-b border-gray-50 last:border-b-0"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono text-gray-500">{product?.sku ?? '—'}</p>
                            <p className="text-sm text-gray-800 truncate">{product?.name ?? '(unknown)'}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => editSetQty(item.product_id, item.quantity - 1)}
                              className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold hover:bg-gray-200"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(e) => editSetQty(item.product_id, Number(e.target.value) || 1)}
                              className="w-16 h-8 px-2 text-sm font-bold border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] text-center"
                            />
                            <button
                              type="button"
                              onClick={() => editSetQty(item.product_id, item.quantity + 1)}
                              className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold hover:bg-gray-200"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => editRemove(item.product_id)}
                              className="w-7 h-7 rounded-lg bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100 ml-1"
                              title="Remove"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Notes (optional)</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none"
                  placeholder="Internal notes for this delivery…"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-gray-100 shrink-0 flex justify-end gap-2">
              <button
                onClick={() => !editSubmitting && closeEdit()}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={submitEdit}
                disabled={editSubmitting || editItems.length === 0}
                className="px-5 py-2 bg-[#0A0A0A] text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
              >
                {editSubmitting && <Loader2 size={14} className="animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
