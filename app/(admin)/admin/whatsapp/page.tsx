'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Gauge, MessageCircle, RefreshCcw, Send, Timer, XCircle } from 'lucide-react'
import { toast } from 'sonner'

interface WaTemplate {
  name: string
  language: string
  category: string
  bodyText: string
  paramCount: number
}

interface Facet { value: string; count: number }
interface Audience { total_active: number; store_types: Facet[]; states: Facet[] }

interface Tier { limit: number; used: number; remaining: number }

interface Blast {
  id: string
  template_name: string
  template_language: string
  status: 'sending' | 'completed' | 'cancelled'
  total_recipients: number
  created_at: string
  completed_at: string | null
  counts: Record<string, number>
}

interface BlastMessage {
  id: string
  phone: string
  status: string
  error_code: string | null
  error_message: string | null
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  wa_contacts: { name: string | null } | null
}

interface Preview {
  matched_stores: number
  unique_phones: number
  invalid_phones: number
  opted_out: number
  capped_off: number
  will_send: number
  tier: Tier
}

interface MetricsDay {
  day: string
  turns: number
  answered: number
  unanswered: number
  median_seconds: number
  p95_seconds: number
}
interface Metrics {
  window_days: number
  overall: { answered: number; unanswered: number; median_seconds: number; p95_seconds: number }
  daily: MetricsDay[]
}

function formatDuration(seconds: number): string {
  if (!seconds) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-600',
  sending: 'bg-blue-50 text-blue-700',
  sent: 'bg-amber-50 text-amber-700',
  delivered: 'bg-green-50 text-green-700',
  read: 'bg-green-100 text-green-800',
  failed: 'bg-red-50 text-red-700',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

export default function WhatsAppPage() {
  const [templates, setTemplates] = useState<WaTemplate[]>([])
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [audience, setAudience] = useState<Audience | null>(null)
  const [tier, setTier] = useState<Tier | null>(null)
  const [blasts, setBlasts] = useState<Blast[]>([])
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  // Blast composer state
  const [templateKey, setTemplateKey] = useState('')
  const [params, setParams] = useState<string[]>([])
  const [storeTypes, setStoreTypes] = useState<string[]>([])
  const [states, setStates] = useState<string[]>([])
  const [capToTier, setCapToTier] = useState(true)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [processing, setProcessing] = useState<{ blastId: string; sent: number; failed: number; remaining: number } | null>(null)

  // Test send state
  const [testPhone, setTestPhone] = useState('')
  const [testing, setTesting] = useState(false)

  // Blast detail expansion
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, BlastMessage[]>>({})

  const selectedTemplate = useMemo(
    () => templates.find((t) => `${t.name}|${t.language}` === templateKey) ?? null,
    [templates, templateKey],
  )

  const loadBlasts = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/wa/blasts')
      const data = await res.json()
      if (res.ok) {
        setBlasts(data.blasts ?? [])
        setTier(data.tier ?? null)
      }
    } catch { /* leave stale data in place */ }
  }, [])

  useEffect(() => {
    fetch('/api/admin/wa/templates')
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) setTemplatesError(data.error ?? 'Could not load templates')
        else setTemplates(data.templates ?? [])
      })
      .catch(() => setTemplatesError('Could not reach the server'))
    fetch('/api/admin/wa/audience')
      .then((r) => r.json())
      .then((d) => { if (d.total_active !== undefined) setAudience(d) })
      .catch(() => {})
    fetch('/api/admin/wa/metrics')
      .then((r) => r.json())
      .then((d) => { if (d.daily) setMetrics(d) })
      .catch(() => {})
    loadBlasts()
  }, [loadBlasts])

  useEffect(() => {
    setParams(Array(selectedTemplate?.paramCount ?? 0).fill(''))
    setPreview(null)
  }, [templateKey, selectedTemplate?.paramCount])

  function toggleFilter(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
    setPreview(null)
  }

  function blastPayload(dryRun: boolean) {
    return {
      template_name: selectedTemplate!.name,
      template_language: selectedTemplate!.language,
      params,
      audience: {
        ...(storeTypes.length ? { store_types: storeTypes } : {}),
        ...(states.length ? { states } : {}),
      },
      cap_to_tier: capToTier,
      dry_run: dryRun,
    }
  }

  async function handlePreview() {
    if (!selectedTemplate) return
    setPreviewing(true)
    try {
      const res = await fetch('/api/admin/wa/blasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blastPayload(true)),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Preview failed')
        setPreview(null)
        return
      }
      setPreview(data)
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setPreviewing(false)
    }
  }

  // Sends batch after batch until the queue is drained — each call is one
  // short serverless invocation (Vercel Hobby 60s ceiling).
  const runProcessLoop = useCallback(async (blastId: string) => {
    let sent = 0
    let failed = 0
    for (;;) {
      let data: { done?: boolean; remaining?: number; sent?: number; failed?: number; error?: string }
      try {
        const res = await fetch('/api/admin/wa/blasts/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blast_id: blastId }),
        })
        data = await res.json()
        if (!res.ok) {
          toast.error(data.error ?? 'Sending failed — you can resume from the blast list')
          break
        }
      } catch {
        toast.error('Connection lost mid-blast — resume from the blast list')
        break
      }
      sent += data.sent ?? 0
      failed += data.failed ?? 0
      setProcessing({ blastId, sent, failed, remaining: data.remaining ?? 0 })
      if (data.done) {
        toast.success(`Blast finished — ${sent} sent${failed ? `, ${failed} failed` : ''}`)
        break
      }
    }
    setProcessing(null)
    loadBlasts()
  }, [loadBlasts])

  async function handleLaunch() {
    if (!selectedTemplate || !preview) return
    if (!confirm(`Send "${selectedTemplate.name}" to ${preview.will_send} store contact(s)? Marketing templates cost ~RM0.35 each (≈RM${(preview.will_send * 0.35).toFixed(2)}).`)) return
    setLaunching(true)
    try {
      const res = await fetch('/api/admin/wa/blasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blastPayload(false)),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Blast creation failed')
        return
      }
      toast.success(`Queued ${data.queued} message(s) — sending…`)
      setPreview(null)
      await loadBlasts()
      await runProcessLoop(data.blast_id)
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setLaunching(false)
    }
  }

  async function handleTestSend() {
    if (!selectedTemplate) {
      toast.error('Pick a template first (in the blast composer below)')
      return
    }
    if (!testPhone.trim()) return
    setTesting(true)
    try {
      const res = await fetch('/api/admin/wa/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: testPhone,
          template_name: selectedTemplate.name,
          template_language: selectedTemplate.language,
          params,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Test send failed')
        return
      }
      toast.success(`Sent to ${data.to} — check the phone (status updates arrive via webhook)`)
      loadBlasts()
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setTesting(false)
    }
  }

  async function toggleDetail(blastId: string) {
    if (expanded === blastId) {
      setExpanded(null)
      return
    }
    setExpanded(blastId)
    if (!detail[blastId]) {
      try {
        const res = await fetch(`/api/admin/wa/blasts?id=${blastId}`)
        const data = await res.json()
        if (res.ok) setDetail((d) => ({ ...d, [blastId]: data.messages ?? [] }))
      } catch { /* row stays in loading state */ }
    }
  }

  async function handleCancel(blastId: string) {
    if (!confirm('Cancel this blast? Anything still queued will not be sent.')) return
    try {
      const res = await fetch('/api/admin/wa/blasts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: blastId, action: 'cancel' }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Cancel failed'); return }
      toast.success(`Cancelled — ${data.cancelled} queued message(s) stopped`)
      loadBlasts()
    } catch {
      toast.error('Could not reach the server')
    }
  }

  const hasQueued = (b: Blast) => (b.counts.queued ?? 0) > 0 && b.status === 'sending'

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">WhatsApp Blasts</h2>
        <p className="text-sm text-gray-500">
          Official Cloud API template messages to consignment store PICs — no ban risk, per-message billing (~RM0.35 marketing).
        </p>
      </div>

      {/* Tier usage */}
      {tier && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 flex items-center gap-4">
          <Gauge size={20} className="text-gray-400 flex-none" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">
              24h messaging tier: {tier.used} / {tier.limit} unique recipients used
            </p>
            <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${tier.used / tier.limit > 0.9 ? 'bg-red-500' : 'bg-[#FFD700]'}`}
                style={{ width: `${Math.min(100, (tier.used / tier.limit) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {tier.remaining} left in this rolling window. The cap rises as Meta upgrades the tier — update WHATSAPP_TIER_LIMIT in Vercel when it does.
            </p>
          </div>
        </div>
      )}

      {templatesError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          {templatesError} — complete the one-time Meta setup in <code className="font-mono">docs/WHATSAPP_SETUP.md</code> first.
        </div>
      )}

      {/* Blast composer */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Send size={16} className="text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">New blast</h3>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Template (pre-approved on Meta)</p>
          <select
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value)}
            className="w-full rounded-lg border border-gray-200 p-2.5 text-sm focus:outline-none focus:border-gray-400 bg-white"
          >
            <option value="">Select a template…</option>
            {templates.map((t) => (
              <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                {t.name} ({t.language}, {t.category.toLowerCase()})
              </option>
            ))}
          </select>
          {selectedTemplate && (
            <div className="mt-2 bg-gray-50 rounded-lg p-3 text-sm text-gray-700 whitespace-pre-wrap">{selectedTemplate.bodyText}</div>
          )}
        </div>

        {selectedTemplate && selectedTemplate.paramCount > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Template variables — use {'{store_name}'} or {'{pic_name}'} to personalize per store
            </p>
            <div className="space-y-2">
              {params.map((value, i) => (
                <input
                  key={i}
                  value={value}
                  onChange={(e) => {
                    const next = [...params]
                    next[i] = e.target.value
                    setParams(next)
                    setPreview(null)
                  }}
                  placeholder={`{{${i + 1}}}`}
                  className="w-full rounded-lg border border-gray-200 p-2.5 text-sm focus:outline-none focus:border-gray-400"
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Audience — active consignment stores{audience ? ` (${audience.total_active} total)` : ''}
          </p>
          {audience && (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-400 mb-1">Store type (none selected = all)</p>
                <div className="flex flex-wrap gap-2">
                  {audience.store_types.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => toggleFilter(storeTypes, setStoreTypes, f.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        storeTypes.includes(f.value)
                          ? 'bg-[#0A0A0A] text-[#FFD700] border-[#0A0A0A]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {f.value.replaceAll('_', ' ')} · {f.count}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">State (none selected = all)</p>
                <div className="flex flex-wrap gap-2">
                  {audience.states.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => toggleFilter(states, setStates, f.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        states.includes(f.value)
                          ? 'bg-[#0A0A0A] text-[#FFD700] border-[#0A0A0A]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {f.value} · {f.count}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={capToTier} onChange={(e) => { setCapToTier(e.target.checked); setPreview(null) }} />
          Cap to what the 24h tier still allows (recommended — the rest can go in a follow-up blast)
        </label>

        {preview && (
          <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
            <div><p className="text-lg font-semibold text-gray-900">{preview.matched_stores}</p><p className="text-xs text-gray-500">Stores matched</p></div>
            <div><p className="text-lg font-semibold text-gray-900">{preview.unique_phones}</p><p className="text-xs text-gray-500">Unique numbers</p></div>
            <div><p className="text-lg font-semibold text-gray-900">{preview.invalid_phones + preview.opted_out}</p><p className="text-xs text-gray-500">Invalid / opted out</p></div>
            <div><p className="text-lg font-semibold text-gray-900">{preview.capped_off}</p><p className="text-xs text-gray-500">Held for tier</p></div>
            <div><p className="text-lg font-semibold text-green-700">{preview.will_send}</p><p className="text-xs text-gray-500">Will send</p></div>
          </div>
        )}

        {processing && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-800">
            Sending… {processing.sent} sent{processing.failed ? `, ${processing.failed} failed` : ''}, {processing.remaining} to go. Keep this tab open.
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handlePreview}
            disabled={!selectedTemplate || previewing || !!processing}
            className="flex-1 px-5 py-2.5 border border-gray-200 text-sm font-semibold rounded-lg hover:border-gray-300 disabled:opacity-40 text-gray-700"
          >
            {previewing ? 'Previewing…' : 'Preview audience'}
          </button>
          <button
            onClick={handleLaunch}
            disabled={!preview || !preview.will_send || launching || !!processing}
            className="flex-1 px-5 py-2.5 bg-[#0A0A0A] text-[#FFD700] text-sm font-semibold rounded-lg hover:opacity-80 disabled:opacity-40 transition-opacity"
          >
            {launching ? 'Launching…' : preview ? `Send to ${preview.will_send} stores` : 'Preview first'}
          </button>
        </div>
      </div>

      {/* Test send */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <MessageCircle size={16} className="text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">Test send</h3>
        </div>
        <p className="text-xs text-gray-500">
          Sends the template selected above (with its variables) to one number — use your own phone to check it end-to-end before blasting.
        </p>
        <div className="flex gap-3">
          <input
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="e.g. 012-345 6789"
            className="flex-1 rounded-lg border border-gray-200 p-2.5 text-sm focus:outline-none focus:border-gray-400"
          />
          <button
            onClick={handleTestSend}
            disabled={testing || !testPhone.trim() || !selectedTemplate}
            className="px-5 py-2.5 bg-[#0A0A0A] text-[#FFD700] text-sm font-semibold rounded-lg hover:opacity-80 disabled:opacity-40"
          >
            {testing ? 'Sending…' : 'Send test'}
          </button>
        </div>
      </div>

      {/* Blast history */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Blasts</h3>
          <button onClick={loadBlasts} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
            <RefreshCcw size={12} /> Refresh
          </button>
        </div>
        {blasts.length === 0 && <p className="text-sm text-gray-400">No blasts yet.</p>}
        <div className="space-y-2">
          {blasts.map((b) => (
            <div key={b.id} className="border border-gray-100 rounded-lg">
              <button onClick={() => toggleDetail(b.id)} className="w-full flex items-center gap-3 p-3 text-left">
                {expanded === b.id ? <ChevronDown size={14} className="text-gray-400 flex-none" /> : <ChevronRight size={14} className="text-gray-400 flex-none" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{b.template_name}</p>
                  <p className="text-xs text-gray-500">{formatWhen(b.created_at)} · {b.total_recipients} recipients</p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {(['queued', 'sent', 'delivered', 'read', 'failed'] as const).map(
                    (s) => (b.counts[s] ?? 0) > 0 && (
                      <span key={s} className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLORS[s]}`}>
                        {b.counts[s]} {s}
                      </span>
                    ),
                  )}
                  <StatusBadge status={b.status} />
                </div>
              </button>
              {expanded === b.id && (
                <div className="border-t border-gray-100 p-3 space-y-3">
                  <div className="flex gap-2">
                    {hasQueued(b) && !processing && (
                      <button
                        onClick={() => runProcessLoop(b.id)}
                        className="px-3 py-1.5 text-xs font-medium bg-[#0A0A0A] text-[#FFD700] rounded-lg hover:opacity-80"
                      >
                        Resume sending ({b.counts.queued} queued)
                      </button>
                    )}
                    {b.status === 'sending' && (
                      <button
                        onClick={() => handleCancel(b.id)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                      >
                        <XCircle size={12} /> Cancel
                      </button>
                    )}
                  </div>
                  {!detail[b.id] ? (
                    <p className="text-xs text-gray-400">Loading recipients…</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-400 uppercase tracking-wide">
                            <th className="py-1.5 pr-3 font-semibold">Store / contact</th>
                            <th className="py-1.5 pr-3 font-semibold">Phone</th>
                            <th className="py-1.5 pr-3 font-semibold">Status</th>
                            <th className="py-1.5 pr-3 font-semibold">Sent</th>
                            <th className="py-1.5 pr-3 font-semibold">Read</th>
                            <th className="py-1.5 font-semibold">Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail[b.id].map((m) => (
                            <tr key={m.id} className="border-t border-gray-50">
                              <td className="py-1.5 pr-3 text-gray-900">{m.wa_contacts?.name ?? '—'}</td>
                              <td className="py-1.5 pr-3 font-mono text-gray-600">{m.phone}</td>
                              <td className="py-1.5 pr-3"><StatusBadge status={m.status} /></td>
                              <td className="py-1.5 pr-3 text-gray-500">{formatWhen(m.sent_at)}</td>
                              <td className="py-1.5 pr-3 text-gray-500">{formatWhen(m.read_at)}</td>
                              <td className="py-1.5 text-red-600">{m.error_message ?? ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* CS response times */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Timer size={16} className="text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">CS first-response time (last {metrics?.window_days ?? 30} days)</h3>
        </div>
        {!metrics || metrics.daily.length === 0 ? (
          <p className="text-sm text-gray-400">
            No inbound conversations yet — this fills in once stores start replying on the Cloud API number.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-lg font-semibold text-gray-900">{formatDuration(metrics.overall.median_seconds)}</p><p className="text-xs text-gray-500">Median response</p></div>
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-lg font-semibold text-gray-900">{formatDuration(metrics.overall.p95_seconds)}</p><p className="text-xs text-gray-500">95th percentile</p></div>
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-lg font-semibold text-gray-900">{metrics.overall.answered}</p><p className="text-xs text-gray-500">Answered</p></div>
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-lg font-semibold text-red-600">{metrics.overall.unanswered}</p><p className="text-xs text-gray-500">Unanswered</p></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-400 uppercase tracking-wide">
                    <th className="py-1.5 pr-3 font-semibold">Day</th>
                    <th className="py-1.5 pr-3 font-semibold">Conversations</th>
                    <th className="py-1.5 pr-3 font-semibold">Median</th>
                    <th className="py-1.5 pr-3 font-semibold">95p</th>
                    <th className="py-1.5 font-semibold">Unanswered</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.daily.map((d) => (
                    <tr key={d.day} className="border-t border-gray-50">
                      <td className="py-1.5 pr-3 text-gray-900">{d.day}</td>
                      <td className="py-1.5 pr-3 text-gray-600">{d.turns}</td>
                      <td className="py-1.5 pr-3 text-gray-600">{formatDuration(d.median_seconds)}</td>
                      <td className="py-1.5 pr-3 text-gray-600">{formatDuration(d.p95_seconds)}</td>
                      <td className={`py-1.5 ${d.unanswered ? 'text-red-600' : 'text-gray-400'}`}>{d.unanswered}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400">
              Counts replies sent through the Cloud API only — replies typed in the WhatsApp Business app (coexistence) are invisible here until app-echo webhooks are enabled in Phase 2.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
