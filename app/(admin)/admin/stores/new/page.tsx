'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check, Copy, ChevronRight, ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { MALAYSIAN_STATES, STORE_TYPE_LABELS, generateRef, cn } from '@/lib/utils'
import type { Product } from '@/types'
import { toast } from 'sonner'

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
  const [products, setProducts] = useState<Product[]>([])
  const [selections, setSelections] = useState<ProductSelection[]>([])
  const [tempPassword, setTempPassword] = useState('')
  const [copied, setCopied] = useState(false)
  const [submitting, setSubmitting] = useState(false)
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
  }, [])

  useEffect(() => {
    supabase
      .from('products')
      .select('*')
      .eq('is_active', true)
      .order('sku')
      .then(({ data }) => {
        const prods = (data || []) as Product[]
        setProducts(prods)
        setSelections(
          prods.map((p) => ({
            product_id: p.id,
            selected: p.is_core_sku,
            quantity: p.is_core_sku ? 12 : 6,
            product: p,
          }))
        )
      })
  }, [])

  async function onStep1(data: Step1Data) {
    setStep1Data(data)
    form3.setValue('login_email', data.email)
    setStep(2)
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
          email: step1Data.email,
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

  function copyPassword() {
    navigator.clipboard.writeText(tempPassword)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function toggleSelection(idx: number) {
    setSelections((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, selected: !s.selected } : s))
    )
  }

  function updateQty(idx: number, qty: number) {
    setSelections((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, quantity: Math.max(0, qty) } : s))
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
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

      {/* Step 1 */}
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
                <select
                  {...form1.register('store_type')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                >
                  <option value="">Select type...</option>
                  {Object.entries(STORE_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
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

      {/* Step 2 */}
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

            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Initial Product Selection</h3>
              <p className="text-xs text-gray-500 mb-3">Core SKUs are pre-selected. Set starting quantities.</p>
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Include</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">SKU</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Name</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selections.map((sel, idx) => (
                      <tr key={sel.product_id} className="border-b border-gray-50">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={sel.selected}
                            onChange={() => toggleSelection(idx)}
                            className="accent-[#FFD700]"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-500">{sel.product.sku}</td>
                        <td className="px-3 py-2 text-gray-800">
                          {sel.product.name}
                          {sel.product.is_core_sku && (
                            <span className="ml-1.5 text-[10px] bg-[#FFD700]/20 text-[#0A0A0A] px-1.5 py-0.5 rounded font-semibold">
                              CORE
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            value={sel.quantity}
                            onChange={(e) => updateQty(idx, Number(e.target.value))}
                            disabled={!sel.selected}
                            className="w-20 ml-auto block px-2 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] disabled:opacity-40 text-right"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Total:{' '}
                <strong>
                  {selections.filter((s) => s.selected).reduce((a, s) => a + s.quantity, 0)}
                </strong>{' '}
                pairs across{' '}
                <strong>{selections.filter((s) => s.selected).length}</strong> SKUs
              </p>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 bg-[#0A0A0A] text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
              >
                Next: Account & Agreement
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-5">Account & Agreement</h2>
          <form onSubmit={form3.handleSubmit(onStep3)} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Login Email *</label>
              <input
                {...form3.register('login_email')}
                type="email"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
              />
              <FieldError message={form3.formState.errors.login_email?.message} />
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
                  onClick={copyPassword}
                  className="px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
                  title="Copy to clipboard"
                >
                  {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Share this password with the store owner after creation.</p>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              Review the login credentials below. Share the temporary password with the store owner after creation.
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
