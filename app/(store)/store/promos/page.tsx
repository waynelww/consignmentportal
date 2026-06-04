'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, X, Tag, Percent, DollarSign, Trash2, Loader2, Power } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, cn } from '@/lib/utils'
import type { Promo } from '@/types'
import { useStore } from '@/components/store/StoreContext'

interface PromoFormData {
  name: string
  code: string
  discount_type: 'percentage' | 'fixed'
  discount_value: number
  min_quantity: number
  min_amount: number
  is_active: boolean
}

const EMPTY_FORM: PromoFormData = {
  name: '',
  code: '',
  discount_type: 'percentage',
  discount_value: 10,
  min_quantity: 0,
  min_amount: 0,
  is_active: true,
}

export default function PromosPage() {
  const { storeId } = useStore()
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingPromo, setEditingPromo] = useState<Promo | null>(null)
  const [form, setForm] = useState<PromoFormData>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  const loadPromos = useCallback(async () => {
    if (!storeId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/promos?store_id=${storeId}`)
      const data = await res.json()
      setPromos(data.promos ?? [])
    } catch {
      toast.error('Failed to load promos')
    } finally {
      setLoading(false)
    }
  }, [storeId])

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
      discount_value: Number(promo.discount_value),
      min_quantity: promo.min_quantity,
      min_amount: Number(promo.min_amount),
      is_active: promo.is_active,
    })
    setModalOpen(true)
  }

  async function submitForm() {
    if (!storeId || !form.name.trim()) {
      toast.error('Promo name is required')
      return
    }
    if (form.discount_type === 'percentage' && form.discount_value > 100) {
      toast.error('Percentage cannot exceed 100')
      return
    }
    setSubmitting(true)
    try {
      const url = editingPromo ? `/api/promos/${editingPromo.id}` : '/api/promos'
      const method = editingPromo ? 'PATCH' : 'POST'
      const body = editingPromo
        ? { ...form, code: form.code.trim() || null }
        : { ...form, store_id: storeId, code: form.code.trim() || null }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      if (!res.ok) throw new Error('Failed')
      toast.success(promo.is_active ? 'Promo deactivated' : 'Promo activated')
      loadPromos()
    } catch {
      toast.error('Failed to update')
    }
  }

  async function deletePromo(promo: Promo) {
    if (!confirm(`Delete "${promo.name}"? It will be deactivated.`)) return
    try {
      const res = await fetch(`/api/promos/${promo.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      toast.success('Promo removed')
      loadPromos()
    } catch {
      toast.error('Failed to delete')
    }
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/store/dashboard" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft size={16} />
          Back
        </Link>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 text-xs font-bold text-[#0A0A0A] bg-[#FFD700] px-3 py-2 rounded-lg"
        >
          <Plus size={14} />
          New Promo
        </button>
      </div>

      <div>
        <h1 className="text-xl font-bold text-[#0A0A0A]">My Promos</h1>
        <p className="text-xs text-gray-500 mt-1">
          Create discounts you can apply during a sale. Customers see the discount in the cart.
        </p>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : promos.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center">
          <Tag size={32} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No promos yet.</p>
          <p className="text-xs text-gray-400 mt-1">Tap "New Promo" to create your first one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {promos.map((promo) => (
            <div
              key={promo.id}
              className={cn(
                'bg-white rounded-xl shadow-sm p-4 border-2',
                promo.is_active ? 'border-transparent' : 'border-gray-100 opacity-60',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {promo.discount_type === 'percentage' ? (
                      <Percent size={14} className="text-amber-600 shrink-0" />
                    ) : (
                      <DollarSign size={14} className="text-amber-600 shrink-0" />
                    )}
                    <p className="text-sm font-bold text-[#0A0A0A] truncate">{promo.name}</p>
                    {!promo.is_active && (
                      <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full shrink-0">
                        OFF
                      </span>
                    )}
                  </div>
                  <p className="text-2xl font-bold text-[#0A0A0A]">
                    {promo.discount_type === 'percentage'
                      ? `${Number(promo.discount_value)}% off`
                      : `${formatCurrency(Number(promo.discount_value))} off`}
                  </p>
                  <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                    {promo.code && (
                      <p>
                        Code: <span className="font-mono font-bold text-gray-700">{promo.code}</span>
                      </p>
                    )}
                    {promo.min_quantity > 0 && (
                      <p>Minimum {promo.min_quantity} pair{promo.min_quantity !== 1 ? 's' : ''}</p>
                    )}
                    {Number(promo.min_amount) > 0 && (
                      <p>Minimum spend {formatCurrency(Number(promo.min_amount))}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    onClick={() => togglePromo(promo)}
                    className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                      promo.is_active ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-gray-100 text-gray-400 hover:bg-gray-200',
                    )}
                    title={promo.is_active ? 'Deactivate' : 'Activate'}
                  >
                    <Power size={13} />
                  </button>
                  <button
                    onClick={() => openEdit(promo)}
                    className="w-8 h-8 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center hover:bg-gray-200"
                    title="Edit"
                  >
                    <Tag size={13} />
                  </button>
                  <button
                    onClick={() => deletePromo(promo)}
                    className="w-8 h-8 rounded-lg bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !submitting && setModalOpen(false)} />
          <div className="relative bg-white rounded-t-2xl w-full max-w-lg px-5 pt-5 pb-6 shadow-2xl mb-[72px] max-h-[80vh] flex flex-col">
            <div className="flex justify-center mb-3 shrink-0">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h3 className="text-base font-bold text-[#0A0A0A]">
                {editingPromo ? 'Edit Promo' : 'New Promo'}
              </h3>
              <button
                onClick={() => !submitting && setModalOpen(false)}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 -mx-1 px-1">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Buy 5 Get 10% Off"
                  className="w-full h-11 px-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Code (optional)</label>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. RAYA10"
                  className="w-full h-11 px-3 text-sm font-mono uppercase border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
                <p className="text-[10px] text-gray-400 mt-1">If blank, you pick this promo from a list in the cart.</p>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-2">Discount Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, discount_type: 'percentage' })}
                    className={cn(
                      'h-11 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-1.5',
                      form.discount_type === 'percentage'
                        ? 'bg-[#0A0A0A] text-[#FFD700]'
                        : 'bg-gray-100 text-gray-500',
                    )}
                  >
                    <Percent size={14} />
                    Percentage
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, discount_type: 'fixed' })}
                    className={cn(
                      'h-11 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-1.5',
                      form.discount_type === 'fixed'
                        ? 'bg-[#0A0A0A] text-[#FFD700]'
                        : 'bg-gray-100 text-gray-500',
                    )}
                  >
                    <DollarSign size={14} />
                    Fixed RM
                  </button>
                </div>
              </div>

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
                  className="w-full h-11 px-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Min Pairs</label>
                  <input
                    type="number"
                    min="0"
                    value={form.min_quantity}
                    onChange={(e) => setForm({ ...form, min_quantity: Number(e.target.value) || 0 })}
                    className="w-full h-11 px-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Min Total (RM)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.min_amount}
                    onChange={(e) => setForm({ ...form, min_amount: Number(e.target.value) || 0 })}
                    className="w-full h-11 px-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="w-4 h-4 accent-[#FFD700]"
                />
                <span className="text-sm font-medium text-gray-700">Active (available in cart)</span>
              </label>
            </div>

            <div className="shrink-0 pt-4 border-t border-gray-100 mt-2">
              <button
                onClick={submitForm}
                disabled={submitting || !form.name.trim()}
                className={cn(
                  'w-full h-14 rounded-xl bg-[#0A0A0A] text-[#FFD700] font-bold text-base flex items-center justify-center gap-2',
                  (submitting || !form.name.trim())
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:opacity-90 active:scale-95 transition-all',
                )}
              >
                {submitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Saving…
                  </>
                ) : editingPromo ? 'Save Changes' : 'Create Promo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
