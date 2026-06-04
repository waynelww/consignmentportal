'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check, Copy, ChevronRight, ArrowLeft, Search, X, Sparkles, MessageCircle, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { MALAYSIAN_STATES, generateRef, cn } from '@/lib/utils'
import type { Product, StoreTypeRow } from '@/types'

// ── Step schemas ──────────────────────────────────────────────────────────────

const step1Schema = z.object({
  store_name: z.string().min(2, 'Store name is required'),
  pic_name: z.string().min(2, 'PIC name is required'),
  pic_phone: z.string().min(8, 'Valid phone number required'),
  email: z.string().email('Valid email required'),
  store_type: z.string().min(1, 'Store type is required'),
  address: z.string().min(5, 'Address is required'),
  city: z.string().min(2, 'City is required'),
  state: z.string().min(1, 'State is required'),
  postcode: z.string().min(5, 'Postcode is required'),
  notes: z.string().optional(),
})

const step2Schema = z.object({
  commission_rate: z.number().min(1).max(100),
  restock_threshold: z.number().min(1),
  payment_terms_days: z.number().int().min(1).max(365),
})

const step3Schema = z.object({
  login_email: z.string().email('Valid email required'),
})

type Step1Data = z.infer<typeof step1Schema>
type Step2Data = z.infer<typeof step2Schema>
type Step3Data = z.infer<typeof step3Schema>

interface ProductSelection {
  product_id: string
  selected: boolean
  quantity: number
  product: Product
  is_recommended?: boolean
  rank?: number | null
  suggested_qty?: number
  total_units_sold?: number
  store_coverage?: number
}

interface RecommendationMeta {
  signal_source: 'nearby_city' | 'nearby_state' | 'global'
  signal_store_count: number
  nearby_city: string | null
  nearby_state: string | null
  lookback_days: number
}

function StepIndicator({ current, step, label }: { current: number; step: number; label: string }) {
  const done = step < current
  const active = step === current
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
          done ? 'bg-[#FFD700] text-[#0A0A0A]' : active ? 'bg-[#0A0A0A] text-white' : 'bg-gray-200 text-gray-500'
        )}
      >
        {done ? <Check size={13} /> : step}
      </div>
      <span className={cn('text-sm', active ? 'font-semibold text-gray-900' : done ? 'text-gray-600' : 'text-gray-400')}>
        {label}
      </span>
    </div>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs text-red-500 mt-1">{message}</p>
}

export default function NewStorePage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [step1Data, setStep1Data] = useState<Step1Data | null>(null)
  const [step2Data, setStep2Data] = useState<Step2Data | null>(null)
  const [selections, setSelections] = useState<ProductSelection[]>([])
  const [recMeta, setRecMeta] = useState<RecommendationMeta | null>(null)
  const [tempPassword, setTempPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [storeTypes, setStoreTypes] = useState<StoreTypeRow[]>([])

  // Inline "+ Add new type" state for the dropdown
  const [addTypeOpen, setAddTypeOpen] = useState(false)
  const [newTypeLabel, setNewTypeLabel] = useState('')
  const [addingType, setAddingType] = useState(false)

  function slugifyType(label: string): string {
    return label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  }

  async function quickAddType() {
    const label = newTypeLabel.trim()
    if (!label) return
    const value = slugifyType(label)
    if (!value) {
      toast.error('Type name must include letters or numbers')
      return
    }
    setAddingType(true)
    try {
      const res = await fetch('/api/store-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, value, sort_order: 500, is_active: true }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Failed to create')

      // Refresh the list and auto-select the new type
      const refreshed = await fetch('/api/store-types?active=1')
        .then((r) => r.json())
        .then((d) => (d.store_types ?? []) as StoreTypeRow[])
        .catch(() => storeTypes)
      setStoreTypes(refreshed)
      form1.setValue('store_type', value, { shouldValidate: true })
      toast.success(`"${label}" added and selected`)
      setNewTypeLabel('')
      setAddTypeOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create type')
    } finally {
      setAddingType(false)
    }
  }

  // Step 2 two-phase: 'pick' for ticking SKUs, 'quantities' for setting amounts
  const [pickPhase, setPickPhase] = useState<'pick' | 'quantities'>('pick')
  const [search, setSearch] = useState('')

  // Step 3 clipboard state
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const supabase = createClient()

  // Step 1 form
  const form1 = useForm<Step1Data>({ resolver: zodResolver(step1Schema) })
  // Step 2 form
  const form2 = useForm<Step2Data>({
    resolver: zodResolver(step2Schema),
    defaultValues: { commission_rate: 30, restock_threshold: 6, payment_terms_days: 7 },
  })
  // Step 3 form
  const form3 = useForm<Step3Data>({
    resolver: zodResolver(step3Schema),
  })

  useEffect(() => {
    setTempPassword(generateRef(10))
    // Fetch active store types
    fetch('/api/store-types?active=1')
      .then((r) => r.json())
      .then((data) => setStoreTypes((data.store_types ?? []) as StoreTypeRow[]))
      .catch(() => {})
  }, [])

  // Load recommended products WHEN step 1 is completed (we have the state/city)
  useEffect(() => {
    if (!step1Data || step !== 2) return
    setLoadingProducts(true)

    const url = `/api/stores/recommendations?state=${encodeURIComponent(step1Data.state)}&city=${encodeURIComponent(step1Data.city)}`
    fetch(url)
      .then((r) => r.json())
      .then((data: { products: (Product & { is_recommended: boolean; rank: number | null; suggested_qty: number; total_units_sold: number; store_coverage: number })[]; meta: RecommendationMeta }) => {
        if (!data.products) return
        setRecMeta(data.meta)
        // Preserve any prior selections if user navigates back
        setSelections((prev) => {
          const priorById = new Map(prev.map((s) => [s.product_id, s]))
          return data.products.map((p) => {
            const prior = priorById.get(p.id)
            return {
              product_id: p.id,
              selected: prior ? prior.selected : p.is_recommended,
              quantity: prior ? prior.quantity : p.suggested_qty,
              product: p,
              is_recommended: p.is_recommended,
              rank: p.rank,
              suggested_qty: p.suggested_qty,
              total_units_sold: p.total_units_sold,
              store_coverage: p.store_coverage,
            }
          })
        })
      })
      .finally(() => setLoadingProducts(false))
  }, [step1Data, step])

  async function onStep1(data: Step1Data) {
    setStep1Data(data)
    form3.setValue('login_email', data.email)
    setStep(2)
    setPickPhase('pick')
  }

  async function onStep2(data: Step2Data) {
    setStep2Data(data)
    setStep(3)
  }

  async function onStep3(data: Step3Data) {
    if (!step1Data || !step2Data) return
    setSubmitting(true)

    try {
      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...step1Data,
          commission_rate: step2Data.commission_rate,
          restock_threshold: step2Data.restock_threshold,
          payment_terms_days: step2Data.payment_terms_days,
          initial_inventory: selections
            .filter((s) => s.selected)
            .map((s) => ({ product_id: s.product_id, quantity: s.quantity })),
          email: data.login_email,
          password: tempPassword,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Failed to create store')
        setSubmitting(false)
        return
      }

      const { store_id } = await res.json()
      toast.success('Store created successfully!')
      router.push(`/admin/stores/${store_id}`)
    } catch {
      toast.error('An error occurred')
      setSubmitting(false)
    }
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    toast.success(`${field} copied`)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const loginUrl = typeof window !== 'undefined' ? `${window.location.origin}/login` : ''
  const loginEmail = form3.watch('login_email') || step1Data?.email || ''

  function welcomeMessage() {
    const storeName = step1Data?.store_name || 'your store'
    return `Hi ${step1Data?.pic_name ?? 'there'}! 👋

Welcome to Xocks. Here are your login details for ${storeName}:

🔗 Login link: ${loginUrl}
📧 Email: ${loginEmail}
🔑 Temporary password: ${tempPassword}

For security, please change your password after first login:
1. Log in with the password above
2. Tap the Account tab at the bottom
3. Tap "Change Password"
4. Set a strong password you'll remember

Need help? Check the tutorial guide in the Account tab.

Welcome aboard! 🧦`
  }

  function copyWelcomeMessage() {
    copyToClipboard(welcomeMessage(), 'Welcome message')
  }

  function shareWhatsApp() {
    const phone = (step1Data?.pic_phone ?? '').replace(/\D/g, '')
    const text = encodeURIComponent(welcomeMessage())
    // strip leading 0 and prepend 60 if Malaysian local number
    let intl = phone
    if (phone.startsWith('0')) intl = '60' + phone.slice(1)
    window.open(`https://wa.me/${intl}?text=${text}`, '_blank')
  }

  // Default quantity for any newly-ticked SKU. When this changes (via the
  // big input on the picker), every currently-selected SKU is also reset to
  // this value so ops doesn't need to edit row by row.
  const [defaultQty, setDefaultQty] = useState<number>(12)

  function toggleSelection(productId: string) {
    setSelections((prev) =>
      prev.map((s) =>
        s.product_id === productId
          ? {
              ...s,
              selected: !s.selected,
              // When ticking, seed the quantity from defaultQty so ops can
              // batch-pick without editing every row.
              quantity: !s.selected ? defaultQty : s.quantity,
            }
          : s
      )
    )
  }

  // Setting default qty also rewrites every currently-selected SKU's qty.
  function setDefaultAndApply(value: number) {
    const clean = Math.max(0, Math.floor(Number(value) || 0))
    setDefaultQty(clean)
    setSelections((prev) => prev.map((s) => (s.selected ? { ...s, quantity: clean } : s)))
  }

  function updateQty(productId: string, qty: number) {
    setSelections((prev) =>
      prev.map((s) => (s.product_id === productId ? { ...s, quantity: Math.max(0, qty) } : s))
    )
  }

  function selectAllRecommended() {
    setSelections((prev) => prev.map((s) => (s.is_recommended ? { ...s, selected: true } : s)))
  }

  function clearAll() {
    setSelections((prev) => prev.map((s) => ({ ...s, selected: false })))
  }

  // Filtered list for the pick phase
  const filteredSelections = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return selections
    return selections.filter(
      (s) =>
        s.product.sku.toLowerCase().includes(q) ||
        s.product.name.toLowerCase().includes(q) ||
        (s.product.category ?? '').toLowerCase().includes(q)
    )
  }, [selections, search])

  const recommendedItems = useMemo(() => filteredSelections.filter((s) => s.is_recommended), [filteredSelections])
  const otherItems = useMemo(() => filteredSelections.filter((s) => !s.is_recommended), [filteredSelections])
  const selectedItems = useMemo(() => selections.filter((s) => s.selected), [selections])
  const totalSelectedSKUs = selectedItems.length
  const totalSelectedPairs = selectedItems.reduce((a, s) => a + s.quantity, 0)

  // Bulk operations on the quantities phase
  const [bulkValue, setBulkValue] = useState<number>(12)
  function applyBulkQty(value: number) {
    if (value < 0) return
    setSelections((prev) =>
      prev.map((s) => (s.selected ? { ...s, quantity: value } : s))
    )
  }
  function applySuggestedQty() {
    setSelections((prev) =>
      prev.map((s) => (s.selected ? { ...s, quantity: s.suggested_qty ?? 12 } : s))
    )
  }
  function addToAll(delta: number) {
    setSelections((prev) =>
      prev.map((s) => (s.selected ? { ...s, quantity: Math.max(0, s.quantity + delta) } : s))
    )
  }

  const signalLabel = (() => {
    if (!recMeta) return ''
    if (recMeta.signal_source === 'nearby_city') return `Based on ${recMeta.signal_store_count} store${recMeta.signal_store_count !== 1 ? 's' : ''} in ${recMeta.nearby_city}`
    if (recMeta.signal_source === 'nearby_state') return `Based on ${recMeta.signal_store_count} store${recMeta.signal_store_count !== 1 ? 's' : ''} in ${recMeta.nearby_state}`
    return 'Network-wide best sellers (not enough local data yet)'
  })()

  return (
    <div className="max-w-2xl mx-auto pb-32">
      {/* Back link */}
      <div className="mb-4">
        <Link href="/admin/stores" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft size={16} />
          Back to Stores
        </Link>
      </div>

      {/* Steps header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-5">
        <div className="flex items-center gap-4 flex-wrap">
          <StepIndicator current={step} step={1} label="Store Information" />
          <ChevronRight size={14} className="text-gray-300 hidden sm:block" />
          <StepIndicator current={step} step={2} label="Commercial Terms" />
          <ChevronRight size={14} className="text-gray-300 hidden sm:block" />
          <StepIndicator current={step} step={3} label="Account & Agreement" />
        </div>
      </div>

      {/* Step 1 (unchanged) */}
      {step === 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-5">Store Information</h2>
          <form onSubmit={form1.handleSubmit(onStep1)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Store Name *</label>
                <input
                  {...form1.register('store_name')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  placeholder="e.g. Tukang Gunting KL"
                />
                <FieldError message={form1.formState.errors.store_name?.message} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Store Type *</label>
                <div className="flex gap-2">
                  <select
                    {...form1.register('store_type')}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  >
                    <option value="">Select type...</option>
                    {storeTypes.map((t) => (
                      <option key={t.id} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setAddTypeOpen((o) => !o)}
                    className={cn(
                      'shrink-0 inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors',
                      addTypeOpen
                        ? 'bg-[#0A0A0A] text-[#FFD700] border-[#0A0A0A]'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50',
                    )}
                    title="Quick-add a new store type"
                  >
                    <Plus size={14} />
                    New
                  </button>
                </div>

                {addTypeOpen && (
                  <div className="mt-2 p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
                    <p className="text-[11px] text-amber-900 font-semibold">
                      Add a new store type — it appears in this dropdown right away.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newTypeLabel}
                        onChange={(e) => setNewTypeLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            quickAddType()
                          }
                          if (e.key === 'Escape') setAddTypeOpen(false)
                        }}
                        placeholder="e.g. Coffee Shop"
                        autoFocus
                        className="flex-1 px-3 py-2 text-sm border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] bg-white"
                      />
                      <button
                        type="button"
                        onClick={quickAddType}
                        disabled={addingType || !newTypeLabel.trim()}
                        className="shrink-0 inline-flex items-center gap-1 px-4 py-2 bg-[#0A0A0A] text-[#FFD700] text-xs font-bold rounded-lg disabled:opacity-50"
                      >
                        {addingType ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        Add
                      </button>
                    </div>
                    {newTypeLabel.trim() && (
                      <p className="text-[10px] text-amber-700 font-mono">
                        Internal code: <strong>{slugifyType(newTypeLabel) || '—'}</strong>
                      </p>
                    )}
                  </div>
                )}

                <FieldError message={form1.formState.errors.store_type?.message} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">PIC Name *</label>
                <input
                  {...form1.register('pic_name')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  placeholder="Person in charge"
                />
                <FieldError message={form1.formState.errors.pic_name?.message} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">PIC Phone *</label>
                <input
                  {...form1.register('pic_phone')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  placeholder="01x-xxxxxxx"
                />
                <FieldError message={form1.formState.errors.pic_phone?.message} />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Email *</label>
              <input
                {...form1.register('email')}
                type="email"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                placeholder="store@email.com"
              />
              <FieldError message={form1.formState.errors.email?.message} />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Address *</label>
              <textarea
                {...form1.register('address')}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none"
                placeholder="Full street address"
              />
              <FieldError message={form1.formState.errors.address?.message} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">City *</label>
                <input
                  {...form1.register('city')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
                <FieldError message={form1.formState.errors.city?.message} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">State *</label>
                <select
                  {...form1.register('state')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                >
                  <option value="">Select state...</option>
                  {MALAYSIAN_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <FieldError message={form1.formState.errors.state?.message} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Postcode *</label>
                <input
                  {...form1.register('postcode')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
                <FieldError message={form1.formState.errors.postcode?.message} />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Notes</label>
              <textarea
                {...form1.register('notes')}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none"
                placeholder="Any additional notes..."
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="px-6 py-2.5 bg-[#0A0A0A] text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
              >
                Next: Commercial Terms
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Step 2 — REDESIGNED */}
      {step === 2 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-5">Commercial Terms</h2>
          <form onSubmit={form2.handleSubmit(onStep2)} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Commission Rate (%)</label>
                <input
                  type="number"
                  {...form2.register('commission_rate', { valueAsNumber: true })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
                <FieldError message={form2.formState.errors.commission_rate?.message} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Restock Threshold (per SKU)</label>
                <input
                  type="number"
                  {...form2.register('restock_threshold', { valueAsNumber: true })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
                <FieldError message={form2.formState.errors.restock_threshold?.message} />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Payment Terms (working days)</label>
              <select
                {...form2.register('payment_terms_days', { valueAsNumber: true })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
              >
                <option value={7}>7 working days (default)</option>
                <option value={14}>14 working days</option>
                <option value={30}>30 working days</option>
                <option value={0}>No payment terms (pay immediately)</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">Days the store has to transfer commission after receiving invoice.</p>
              <FieldError message={form2.formState.errors.payment_terms_days?.message} />
            </div>

            {/* ── Product picker ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800">Initial Product Selection</h3>
                {pickPhase === 'quantities' && (
                  <button
                    type="button"
                    onClick={() => setPickPhase('pick')}
                    className="text-xs text-gray-500 hover:text-gray-800 underline"
                  >
                    Edit picks
                  </button>
                )}
              </div>

              {/* Smart recommendation banner */}
              {recMeta && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-lg">
                  <Sparkles size={14} className="text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-800">
                    <strong>Smart picks:</strong> {signalLabel}
                  </p>
                </div>
              )}

              {loadingProducts ? (
                <p className="text-xs text-gray-400 py-6 text-center">Loading recommendations…</p>
              ) : pickPhase === 'pick' ? (
                <>
                  {/* Default-quantity bar — sets the starting qty for every SKU you tick,
                      and overrides any already-ticked SKUs the moment you change it. */}
                  <div className="rounded-xl border-2 border-[#FFD700] bg-amber-50 px-4 py-3 mb-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-[200px]">
                        <p className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                          Default quantity per SKU
                        </p>
                        <p className="text-[11px] text-amber-700 mt-0.5">
                          Every SKU you tick uses this. Change it — all ticked SKUs update too.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setDefaultAndApply(defaultQty - 6)}
                          className="w-9 h-10 rounded-lg bg-white border border-amber-300 text-amber-900 text-sm font-bold hover:bg-amber-100"
                        >
                          −6
                        </button>
                        <input
                          type="number"
                          min={0}
                          value={defaultQty}
                          onChange={(e) => setDefaultAndApply(Number(e.target.value))}
                          onFocus={(e) => e.target.select()}
                          className="w-20 h-10 px-2 text-base font-bold text-center border-2 border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => setDefaultAndApply(defaultQty + 6)}
                          className="w-9 h-10 rounded-lg bg-white border border-amber-300 text-amber-900 text-sm font-bold hover:bg-amber-100"
                        >
                          +6
                        </button>
                      </div>
                    </div>
                    {/* Quick presets */}
                    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-amber-200">
                      <span className="text-[11px] text-amber-800 font-semibold">Quick:</span>
                      {[6, 12, 24, 48].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setDefaultAndApply(n)}
                          className={cn(
                            'h-7 px-2.5 text-xs font-bold rounded-lg transition-colors',
                            defaultQty === n
                              ? 'bg-[#0A0A0A] text-[#FFD700]'
                              : 'bg-white border border-amber-300 text-amber-900 hover:bg-amber-100'
                          )}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Search + bulk actions */}
                  <div className="flex flex-col sm:flex-row gap-2 mb-3">
                    <div className="relative flex-1">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by SKU, name, or category…"
                        className="w-full h-10 pl-9 pr-3 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                      />
                      {search && (
                        <button
                          type="button"
                          onClick={() => setSearch('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={selectAllRecommended}
                        className="px-3 h-10 text-xs font-medium bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 transition-colors"
                      >
                        Tick all recommended
                      </button>
                      <button
                        type="button"
                        onClick={clearAll}
                        className="px-3 h-10 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Clear all
                      </button>
                    </div>
                  </div>

                  {/* Recommended group */}
                  {recommendedItems.length > 0 && (
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles size={12} className="text-amber-600" />
                        <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Recommended for this location</h4>
                      </div>
                      <div className="border-2 border-amber-200 rounded-xl overflow-hidden bg-amber-50/30">
                        {recommendedItems.map((sel) => (
                          <label
                            key={sel.product_id}
                            className="flex items-center gap-3 px-3 py-2.5 border-b border-amber-100 last:border-b-0 cursor-pointer hover:bg-amber-50"
                          >
                            <input
                              type="checkbox"
                              checked={sel.selected}
                              onChange={() => toggleSelection(sel.product_id)}
                              className="accent-[#FFD700] w-4 h-4"
                            />
                            <div className="flex-1 min-w-0 flex items-center gap-2">
                              <span className="font-mono text-xs text-gray-500 shrink-0">{sel.product.sku}</span>
                              <span className="text-sm text-gray-800 truncate">{sel.product.name}</span>
                              {sel.product.is_core_sku && (
                                <span className="text-[10px] bg-[#FFD700]/30 text-[#0A0A0A] px-1.5 py-0.5 rounded font-semibold shrink-0">CORE</span>
                              )}
                              {sel.rank !== null && sel.rank !== undefined && sel.rank <= 8 && (
                                <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded font-semibold shrink-0">#{sel.rank} seller</span>
                              )}
                            </div>
                            {(sel.total_units_sold ?? 0) > 0 && (
                              <span className="text-[10px] text-gray-500 shrink-0">{sel.total_units_sold} sold</span>
                            )}
                            {sel.selected && (
                              <span className="text-[10px] font-bold bg-[#0A0A0A] text-[#FFD700] px-2 py-0.5 rounded-full shrink-0">
                                × {sel.quantity}
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Other SKUs */}
                  {otherItems.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">All Other SKUs</h4>
                      <div className="border border-gray-200 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
                        {otherItems.map((sel) => (
                          <label
                            key={sel.product_id}
                            className="flex items-center gap-3 px-3 py-2 border-b border-gray-100 last:border-b-0 cursor-pointer hover:bg-gray-50"
                          >
                            <input
                              type="checkbox"
                              checked={sel.selected}
                              onChange={() => toggleSelection(sel.product_id)}
                              className="accent-[#FFD700] w-4 h-4"
                            />
                            <div className="flex-1 min-w-0 flex items-center gap-2">
                              <span className="font-mono text-xs text-gray-400 shrink-0">{sel.product.sku}</span>
                              <span className="text-sm text-gray-700 truncate">{sel.product.name}</span>
                            </div>
                            {sel.selected && (
                              <span className="text-[10px] font-bold bg-[#0A0A0A] text-[#FFD700] px-2 py-0.5 rounded-full shrink-0">
                                × {sel.quantity}
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {filteredSelections.length === 0 && (
                    <p className="text-xs text-center text-gray-400 py-6">No SKUs match your search.</p>
                  )}
                </>
              ) : (
                // Quantities phase — set how many pairs of each SKU the store gets
                <div className="space-y-3">
                  {/* Bulk Update bar */}
                  {selectedItems.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                      <p className="text-xs font-bold text-amber-900 mb-2 uppercase tracking-wide">
                        Bulk Update ({selectedItems.length} selected SKUs)
                      </p>

                      {/* Set-all input + quick presets */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-amber-800 font-semibold">Set all to:</span>
                        <input
                          type="number"
                          min={0}
                          value={bulkValue}
                          onChange={(e) => {
                            const v = e.target.value
                            setBulkValue(v === '' ? 0 : Math.max(0, Math.floor(Number(v) || 0)))
                          }}
                          onFocus={(e) => e.target.select()}
                          className="w-20 h-9 px-2 text-sm font-bold border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] text-right bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => applyBulkQty(bulkValue)}
                          className="h-9 px-3 bg-[#0A0A0A] text-[#FFD700] text-xs font-bold rounded-lg hover:opacity-90"
                        >
                          Apply
                        </button>

                        <span className="text-xs text-amber-700 mx-1">|</span>

                        <span className="text-xs text-amber-800 font-semibold">Quick:</span>
                        {[6, 12, 24, 48].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => applyBulkQty(n)}
                            className="h-9 px-2.5 bg-white border border-amber-300 text-xs font-bold text-amber-900 rounded-lg hover:bg-amber-100"
                          >
                            {n}
                          </button>
                        ))}
                      </div>

                      {/* Secondary row: increment / decrement / use suggested */}
                      <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-amber-200">
                        <span className="text-xs text-amber-800 font-semibold">Adjust:</span>
                        <button
                          type="button"
                          onClick={() => addToAll(6)}
                          className="h-8 px-2 bg-white border border-amber-300 text-xs font-bold text-amber-900 rounded-lg hover:bg-amber-100"
                        >
                          +6
                        </button>
                        <button
                          type="button"
                          onClick={() => addToAll(12)}
                          className="h-8 px-2 bg-white border border-amber-300 text-xs font-bold text-amber-900 rounded-lg hover:bg-amber-100"
                        >
                          +12
                        </button>
                        <button
                          type="button"
                          onClick={() => addToAll(-6)}
                          className="h-8 px-2 bg-white border border-amber-300 text-xs font-bold text-amber-900 rounded-lg hover:bg-amber-100"
                        >
                          −6
                        </button>
                        <span className="text-xs text-amber-700 mx-1">|</span>
                        <button
                          type="button"
                          onClick={applySuggestedQty}
                          className="h-8 px-2.5 bg-amber-100 border border-amber-300 text-xs font-bold text-amber-900 rounded-lg hover:bg-amber-200 inline-flex items-center gap-1"
                        >
                          <Sparkles size={11} />
                          Use Suggested
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Per-row qty editor */}
                  <div className="border border-gray-100 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">SKU</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Name</th>
                          <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Suggested</th>
                          <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 w-[180px]">Quantity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedItems.map((sel) => (
                          <tr key={sel.product_id} className="border-b border-gray-50">
                            <td className="px-3 py-2 font-mono text-xs text-gray-500">{sel.product.sku}</td>
                            <td className="px-3 py-2 text-gray-800">
                              {sel.product.name}
                              {sel.is_recommended && (
                                <Sparkles size={10} className="inline ml-1 text-amber-500" />
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-xs text-gray-400">
                              {sel.suggested_qty ?? '—'}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => updateQty(sel.product_id, sel.quantity - 6)}
                                  className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold hover:bg-gray-200"
                                >
                                  −6
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  value={sel.quantity}
                                  onChange={(e) => {
                                    const v = e.target.value
                                    // Treat empty as 0 but let the user clear+retype freely
                                    updateQty(sel.product_id, v === '' ? 0 : Math.max(0, Math.floor(Number(v) || 0)))
                                  }}
                                  onFocus={(e) => e.target.select()}
                                  className="w-20 h-8 px-2 text-sm font-bold border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] text-center"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateQty(sel.product_id, sel.quantity + 6)}
                                  className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-xs font-bold hover:bg-gray-200"
                                >
                                  +6
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {selectedItems.length === 0 && (
                          <tr>
                            <td colSpan={4} className="text-center py-6 text-xs text-gray-400">
                              No SKUs picked yet. Go back to pick some.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Sticky bottom action bar */}
            <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-lg">
              <div className="max-w-2xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
                <div className="text-xs text-gray-600">
                  <strong className="text-[#0A0A0A]">{totalSelectedSKUs}</strong> SKUs ·{' '}
                  <strong className="text-[#0A0A0A]">{totalSelectedPairs}</strong> pairs
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                  >
                    Back
                  </button>
                  {pickPhase === 'pick' ? (
                    <button
                      type="button"
                      onClick={() => setPickPhase('quantities')}
                      disabled={totalSelectedSKUs === 0}
                      className="px-5 py-2 bg-[#0A0A0A] text-[#FFD700] text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      Done Picking →
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="px-5 py-2 bg-[#0A0A0A] text-[#FFD700] text-sm font-semibold rounded-lg hover:opacity-90 transition-all"
                    >
                      Next: Account →
                    </button>
                  )}
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Step 3 — Improved clipboard */}
      {step === 3 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-5">Account & Agreement</h2>
          <form onSubmit={form3.handleSubmit(onStep3)} className="space-y-5">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Login Email *</label>
              <div className="flex gap-2">
                <input
                  {...form3.register('login_email')}
                  type="email"
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(loginEmail, 'Email')}
                  className="px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
                  title="Copy email"
                >
                  {copiedField === 'Email' ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                </button>
              </div>
              <FieldError message={form3.formState.errors.login_email?.message} />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Login URL</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={loginUrl}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(loginUrl, 'Login URL')}
                  className="px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
                  title="Copy URL"
                >
                  {copiedField === 'Login URL' ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Temporary Password</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={tempPassword}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 font-mono"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(tempPassword, 'Password')}
                  className="px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
                  title="Copy password"
                >
                  {copiedField === 'Password' ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Owner should change this after first login.</p>
            </div>

            {/* All-in-one welcome message */}
            <div className="border border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-amber-600" />
                <h3 className="text-sm font-semibold text-gray-800">One-tap onboarding</h3>
              </div>
              <p className="text-xs text-gray-600">
                Send a ready-to-go welcome message with login link, credentials, and password-change instructions.
              </p>
              <pre className="text-[11px] text-gray-600 bg-white/70 rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans border border-amber-100">
                {welcomeMessage()}
              </pre>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={copyWelcomeMessage}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-[#0A0A0A] text-white text-sm font-medium rounded-lg hover:opacity-90 transition-all"
                >
                  {copiedField === 'Welcome message' ? <Check size={14} /> : <Copy size={14} />}
                  Copy welcome message
                </button>
                <button
                  type="button"
                  onClick={shareWhatsApp}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-all"
                >
                  <MessageCircle size={14} />
                  Send via WhatsApp
                </button>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2.5 bg-[#0A0A0A] text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Creating...' : 'Create Store'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
