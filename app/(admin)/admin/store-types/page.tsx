'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, X, Pencil, Trash2, Power, Loader2, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { StoreTypeRow } from '@/types'

interface FormData {
  value: string
  label: string
  sort_order: number
  is_active: boolean
}

const EMPTY_FORM: FormData = { value: '', label: '', sort_order: 500, is_active: true }

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export default function StoreTypesPage() {
  const [types, setTypes] = useState<StoreTypeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<StoreTypeRow | null>(null)
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/store-types')
      const data = await res.json()
      setTypes(data.store_types ?? [])
    } catch {
      toast.error('Failed to load store types')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  function openEdit(t: StoreTypeRow) {
    setEditing(t)
    setForm({
      value: t.value,
      label: t.label,
      sort_order: t.sort_order,
      is_active: t.is_active,
    })
    setModalOpen(true)
  }

  async function submit() {
    if (!form.label.trim()) {
      toast.error('Label is required')
      return
    }
    if (!editing && !form.value.trim()) {
      toast.error('Value is required')
      return
    }
    setSubmitting(true)
    try {
      const url = editing ? `/api/store-types/${editing.id}` : '/api/store-types'
      const method = editing ? 'PATCH' : 'POST'
      // The value can't be edited (it's the FK link to stores.store_type rows)
      const payload = editing
        ? {
            label: form.label.trim(),
            sort_order: form.sort_order,
            is_active: form.is_active,
          }
        : {
            value: form.value.trim().toLowerCase(),
            label: form.label.trim(),
            sort_order: form.sort_order,
            is_active: form.is_active,
          }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Failed')
      toast.success(editing ? 'Type updated' : 'Type created')
      setModalOpen(false)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(t: StoreTypeRow) {
    try {
      const res = await fetch(`/api/store-types/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !t.is_active }),
      })
      if (!res.ok) throw new Error()
      toast.success(t.is_active ? 'Deactivated' : 'Activated')
      load()
    } catch {
      toast.error('Failed')
    }
  }

  async function remove(t: StoreTypeRow) {
    if (!confirm(`Remove "${t.label}"? Stores already using this type will keep it.`)) return
    try {
      const res = await fetch(`/api/store-types/${t.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Failed')
      if (body.soft_deleted) toast.info(body.reason ?? 'Deactivated instead')
      else toast.success('Type removed')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Store Types</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Categories shown when creating a new store. Add your own; ones in use can't be deleted.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#0A0A0A] text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
        >
          <Plus size={16} />
          New Type
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : types.length === 0 ? (
          <div className="p-12 text-center">
            <Tag size={32} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No types yet.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Sort</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Label</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Value (code)</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className={cn('border-b border-gray-50 last:border-b-0', !t.is_active && 'opacity-50')}>
                  <td className="px-4 py-3 text-gray-500">{t.sort_order}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{t.label}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.value}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'text-[10px] font-bold px-2 py-0.5 rounded-full',
                      t.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500',
                    )}>
                      {t.is_active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => toggleActive(t)}
                        className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                          t.is_active ? 'text-green-600 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100',
                        )}
                        title={t.is_active ? 'Deactivate' : 'Activate'}
                      >
                        <Power size={14} />
                      </button>
                      <button
                        onClick={() => openEdit(t)}
                        className="w-8 h-8 rounded-lg text-gray-600 hover:bg-gray-100 flex items-center justify-center"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => remove(t)}
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

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => !submitting && setModalOpen(false)} />
          <div className="relative bg-white rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">
                {editing ? 'Edit Store Type' : 'New Store Type'}
              </h3>
              <button
                onClick={() => !submitting && setModalOpen(false)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Label *</label>
                <input
                  type="text"
                  value={form.label}
                  onChange={(e) => {
                    const label = e.target.value
                    setForm((prev) => ({
                      ...prev,
                      label,
                      // Auto-suggest value when creating
                      value: editing ? prev.value : (prev.value === '' || prev.value === slugify(prev.label)) ? slugify(label) : prev.value,
                    }))
                  }}
                  placeholder="e.g. Coffee Shop"
                  className="w-full h-10 px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
                <p className="text-[10px] text-gray-400 mt-1">Shown in the store-type dropdown.</p>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Value (code) {editing && <span className="text-gray-400">— cannot be changed</span>}
                </label>
                <input
                  type="text"
                  value={form.value}
                  onChange={(e) =>
                    setForm({ ...form, value: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })
                  }
                  disabled={!!editing}
                  placeholder="e.g. coffee_shop"
                  className="w-full h-10 px-3 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] disabled:bg-gray-50 disabled:text-gray-500"
                />
                <p className="text-[10px] text-gray-400 mt-1">Lowercase letters, numbers, underscores only. Used internally — can't change after creation.</p>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Sort order</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })}
                  className="w-full h-10 px-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
                <p className="text-[10px] text-gray-400 mt-1">Lower numbers appear first in the dropdown.</p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="w-4 h-4 accent-[#FFD700]"
                />
                <span className="text-sm text-gray-700">Active (visible in dropdown)</span>
              </label>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => !submitting && setModalOpen(false)}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting || !form.label.trim() || (!editing && !form.value.trim())}
                className="px-5 py-2 bg-[#0A0A0A] text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {editing ? 'Save Changes' : 'Create Type'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
