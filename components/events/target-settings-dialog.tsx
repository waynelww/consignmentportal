'use client'

// Global Event Target settings (Events list → "Target settings").
// Admin and ops manager. Saving re-runs POS bonus eligibility for active events.

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { DEFAULT_SETTINGS, type TargetSettings } from '@/lib/events/target-calc'

type Settings = TargetSettings & { profit_unlock_amount: number }

const FIELDS: [keyof Settings, string][] = [
  ['per_head_small', 'Small level per head (RM)'],
  ['per_head_medium', 'Medium level per head (RM)'],
  ['per_head_major', 'Major level per head (RM)'],
  ['tier1_pct_of_tier2', 'Tier 1 = % of Tier 2'],
  ['tier3_pct_of_tier2', 'Tier 3 = % of Tier 2'],
  ['round_to', 'Round to (RM)'],
  ['bonus_tier1', 'Tier 1 bonus (RM)'],
  ['bonus_tier2', 'Tier 2 bonus (RM)'],
  ['bonus_tier3', 'Tier 3 bonus (RM)'],
  ['avg_sale_per_customer', 'Average sale per customer (RM)'],
  ['min_cover_ratio', 'Min sales ÷ fixed cost before flag'],
  ['profit_unlock_amount', 'Bonuses unlock after event profit of (RM)'],
]

export function TargetSettingsDialog({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState<Settings>({ ...DEFAULT_SETTINGS, profit_unlock_amount: 1000 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/event-targets/settings').then((r) => r.json()).then((b) => { if (b.settings) setDraft(b.settings) })
      .catch(() => toast.error('Could not load settings')).finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    const res = await fetch('/api/event-targets/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { toast.error(body.error || 'Could not save settings'); return }
    toast.success('Target settings saved'); onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-gray-900">Target settings</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
        </div>
        <p className="text-xs text-gray-500 mb-4">Used by every event&apos;s Targets. Event profit = POS sales − the event&apos;s costs; part-timers never see it.</p>
        {loading ? <p className="text-sm text-gray-400">Loading…</p> : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {FIELDS.map(([k, label]) => (
              <div key={k}><label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                <input type="number" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  value={draft[k]} onChange={(e) => setDraft((s) => ({ ...s, [k]: +e.target.value }))} /></div>
            ))}
          </div>
        )}
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving || loading} className="flex-1 py-2.5 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
