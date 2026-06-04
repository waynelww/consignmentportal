'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, X, Tag, Percent, DollarSign, Gift, Trash2, Loader2, Power, Globe } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, cn } from '@/lib/utils'
import type { Promo } from '@/types'

interface PromoFormData {
  name: string
  code: string
  discount_type: 'percentage' | 'fixed' | 'bxgy'
  discount_value: number
  buy_quantity: number
  free_quantity: number
  min_quantity: number
  min_amount: number
  is_active: boolean
}

const EMPTY_FORM: PromoFormData = {
  name: '',
  code: '',
  discount_type: 'percentage',
  discount_value: 10,
  buy_quantity: 5,
  free_quantity: 2,
  min_quantity: 0,
  min_amount: 0,
  is_active: true,
}

export default function AdminPromosPage() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingPromo, setEditingPromo] = useState<Promo | null>(null)
  const [form, setForm] = useState<PromoFormData>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  const loadPromos = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/promos?scope=global')
      const data = await res.json()
      setPromos(data.promos ?? [])
    } catch {
      toast.error('Failed to load promos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPromos() }, [loadPromos])

  function openCreate() {
    setEditingPromo(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  function openEdit(promo: Promo) {
    setEditingPromo(promo)
    setForm({
      name: promo.name,
      code: promo.code ?? '',
      discount_type: promo.discount_type,
      discount_value: Number(promo.discount_value ?? 0),
      buy_quantity: promo.buy_quantity ?? 5,
      free_quantity: promo.free_quantity ?? 2,
      min_quantity: promo.min_quantity,
      min_amount: Number(promo.min_amount),
      is_active: promo.is_active,
    })
    setModalOpen(true)
  }

  async function submitForm() {
    if (!form.name.trim()) {
      toast.error('Promo name is required')
      return
    }
    if (form.discount_type === 'percentage' && form.discount_value > 100) {
      toast.error('Percentage cannot exceed 100')
      return
    }
    if (form.discount_type === 'bxgy' && (form.buy_quantity < 1 || form.free_quantity < 1)) {
      toast.error('Buy and Free quantities must be at least 1')
      return
    }
    setSubmitting(true)
    try {
      const url = editingPromo ? `/api/promos/${editingPromo.id}` : '/api/promos'
      const method = editingPromo ? 'PATCH' : 'POST'

      // Build payload per discount type
      const payload: Record<string, unknown> = {
        name: form.name,
        code: form.code.trim() || null,
        discount_type: form.discount_type,
        min_quantity: form.min_quantity,
        min_amount: form.min_amount,
        is_active: form.is_active,
      }
      if (form.discount_type === 'bxgy') {
        payload.buy_quantity = form.buy_quantity
        payload.free_quantity = form.free_quantity
        payload.discount_value = 0
      } else {
        payload.discount_value = form.discount_value
        payload.buy_quantity = null
        payload.free_quantity = null
      }
      if (!editingPromo) payload.store_id = null // global

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed')
      }
      toast.success(editingPromo ? 'Promo updated' : 'Promo created')
      setModalOpen(false)
      loadPromos()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  async function togglePromo(promo: Promo) {
    try {
      const res = await fetch(`/api/promos/${promo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !promo.is_active }),
      })
      if (!res.ok) throw new Error()
      toast.success(promo.is_active ? 'Deactivated' : 'Activated')
      loadPromos()
    } catch {
      toast.error('Failed')
    }
  }

  async function deletePromo(promo: Promo) {
    if (!confirm(`Delete "${promo.name}"? It will be deactivated for all stores.`)) return
    try {
      const res = await fetch(`/api/promos/${promo.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Promo removed')
      loadPromos()
    } catch {
      toast.error('Failed')
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Global Promos</h1>
          <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">
            <Globe size={13} />
            Available to every store at checkout
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#0A0A0A] text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
        >
          <Plus size={16} />
          New Promo
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : promos.length === 0 ? (
          <div className="p-12 text-center">
            <Tag size={32} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No global promos yet.</p>
            <p className="text-xs text-gray-400 mt-1">Tap "New Promo" to create one available to all stores.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Discount</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Code</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Conditions</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {promos.map((promo) => (
                <tr key={promo.id} className={cn('border-b border-gray-50 last:border-b-0', !promo.is_active && 'opacity-50')}>
                  <td className="px-4 py-3 font-medium text-gray-900">{promo.name}</td>
                  <td className="px-4 py-3">
                    {promo.discount_type === 'percentage' && (
                      <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                        <Percent size={12} /> {Number(promo.discount_value)}% off
                      </span>
                    )}
                    {promo.discount_type === 'fixed' && (
                      <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                        <DollarSign size={12} /> {formatCurrency(Number(promo.discount_value))} off
                      </span>
                    )}
                    {promo.discount_type === 'bxgy' && (
                      <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                        <Gift size={12} /> Buy {promo.buy_quantity} Free {promo.free_quantity}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{promo.code ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {promo.min_quantity > 0 && <span>Min {promo.min_quantity} pairs</span>}
                    {promo.min_quantity > 0 && Number(promo.min_amount) > 0 && <span> · </span>}
                    {Number(promo.min_amount) > 0 && <span>Min {formatCurrency(Number(promo.min_amount))}</span>}
                    {!promo.min_quantity && !Number(promo.min_amount) && <span className="text-gray-400">No minimum</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'text-[10px] font-bold px-2 py-0.5 rounded-full',
                      promo.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500',
                    )}>
                      {promo.is_active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => togglePromo(promo)}
                        className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                          promo.is_active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100',
                        )}
                        title={promo.is_active ? 'Deactivate' : 'Activate'}
                      >
                        <Power size={14} />
                      </button>
                      <button
                        onClick={() => openEdit(promo)}
                        className="w-8 h-8 rounded-lg text-gray-600 hover:bg-gray-100 flex items-center justify-center"
                        title="Edit"
                      >
                        <Tag size={14} />
                      </button>
                      <button
                        onClick={() => deletePromo(promo)}
                        className="w-8 h-8 rounded-lg text-red-500 hover:bg-red-50 flex items-center justify-center"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !submitting && setModalOpen(false)} />
          <div className="relative bg-white rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <h3 className="text-base font-semibold text-gray-900">
                {editingPromo ? 'Edit Global Promo' : 'New Global Promo'}
              </h3>
              <button
                onClick={() => !submitting && setModalOpen(false)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Raya Special — Buy 5 Free 2"
                  className="w-full h-10 px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Code (optional)</label>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. RAYA2026"
                  className="w-full h-10 px-3 text-sm font-mono uppercase border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-2">Discount Type</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, discount_type: 'percentage' })}
                    className={cn(
                      'h-11 rounded-lg text-xs font-bold transition-all flex flex-col items-center justify-center gap-0.5',
                      form.discount_type === 'percentage' ? 'bg-[#0A0A0A] text-[#FFD700]' : 'bg-gray-100 text-gray-500',
                    )}
                  >
                    <Percent size={13} />
                    Percent
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, discount_type: 'fixed' })}
                    className={cn(
                      'h-11 rounded-lg text-xs font-bold transition-all flex flex-col items-center justify-center gap-0.5',
                      form.discount_type === 'fixed' ? 'bg-[#0A0A0A] text-[#FFD700]' : 'bg-gray-100 text-gray-500',
                    )}
                  >
                    <DollarSign size={13} />
                    Fixed RM
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, discount_type: 'bxgy' })}
                    className={cn(
                      'h-11 rounded-lg text-xs font-bold transition-all flex flex-col items-center justify-center gap-0.5',
                      form.discount_type === 'bxgy' ? 'bg-[#0A0A0A] text-[#FFD700]' : 'bg-gray-100 text-gray-500',
                    )}
                  >
                    <Gift size={13} />
                    Buy X Free Y
                  </button>
                </div>
              </div>

              {form.discount_type === 'bxgy' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Buy quantity *</label>
                    <input
                      type="number"
                      min="1"
                      value={form.buy_quantity}
                      onChange={(e) => setForm({ ...form, buy_quantity: Number(e.target.value) || 1 })}
                      className="w-full h-10 px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Free quantity *</label>
                    <input
                      type="number"
                      min="1"
                      value={form.free_quantity}
                      onChange={(e) => setForm({ ...form, free_quantity: Number(e.target.value) || 1 })}
                      className="w-full h-10 px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                    />
                  </div>
                  <p className="col-span-2 text-[11px] text-gray-500">
                    Customer needs <b>{form.buy_quantity + form.free_quantity}</b> pairs in cart. The <b>{form.free_quantity}</b> cheapest become free; SKUs still record as sold so stock deducts.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">
                    Discount Value * {form.discount_type === 'percentage' ? '(%)' : '(RM)'}
                  </label>
                  <input
                    type="number"
                    step={form.discount_type === 'percentage' ? '1' : '0.01'}
                    min="0"
                    max={form.discount_type === 'percentage' ? '100' : undefined}
                    value={form.discount_value}
                    onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) || 0 })}
                    className="w-full h-10 px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Min pairs</label>
                  <input
                    type="number"
                    min="0"
                    value={form.min_quantity}
                    onChange={(e) => setForm({ ...form, min_quantity: Number(e.target.value) || 0 })}
                    className="w-full h-10 px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Min total (RM)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.min_amount}
                    onChange={(e) => setForm({ ...form, min_amount: Number(e.target.value) || 0 })}
                    className="w-full h-10 px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="w-4 h-4 accent-[#FFD700]"
                />
                <span className="text-sm text-gray-700">Active (visible to all stores)</span>
              </label>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 shrink-0 flex justify-end gap-2">
              <button
                onClick={() => !submitting && setModalOpen(false)}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={submitForm}
                disabled={submitting || !form.name.trim()}
                className="px-5 py-2 bg-[#0A0A0A] text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {editingPromo ? 'Save Changes' : 'Create Promo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
