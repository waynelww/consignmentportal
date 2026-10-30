'use client'

// The "Daily sales report" section, used on the new-store form and the store
// edit page. Controlled: the parent holds the switch and the recipient list.
// Rules: a recipient must be an email; the switch can't be turned on with no
// recipients; removing the last recipient turns the switch off.

import { useState } from 'react'
import { X } from 'lucide-react'
import { DAILY_REPORT_MAX_RECIPIENTS, parseRecipient } from '@/lib/daily-report/settings'
import { cn } from '@/lib/utils'

interface Props {
  enabled: boolean
  recipients: string[]
  onChange: (next: { enabled: boolean; recipients: string[] }) => void
  error?: string | null
}

export function DailyReportSettings({ enabled, recipients, onChange, error }: Props) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const canTurnOn = recipients.length > 0

  function closeAdd() {
    setAdding(false)
    setDraft('')
    setDraftError(null)
  }

  function addRecipient() {
    const email = parseRecipient(draft)
    if (!email) {
      setDraftError('Enter a valid email address')
      return
    }
    if (recipients.includes(email)) {
      setDraftError('That address is already on the list')
      return
    }
    onChange({ enabled, recipients: [...recipients, email] })
    closeAdd()
  }

  function removeRecipient(email: string) {
    const next = recipients.filter((r) => r !== email)
    onChange({ enabled: enabled && next.length > 0, recipients: next })
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">Daily sales report</p>
          <p className="text-xs text-gray-500">
            Emailed to the Xocks team at 10pm (Malaysia time) with the day&apos;s sales, as a PDF.
            Stores never receive it.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Daily sales report"
          disabled={!enabled && !canTurnOn}
          onClick={() => onChange({ enabled: !enabled, recipients })}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40',
            enabled ? 'bg-[#FFD700]' : 'bg-gray-300',
          )}
        >
          <span
            className={cn(
              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
              enabled ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      <div>
        <p className="text-xs text-gray-500 mb-1.5">Recipients (Xocks team)</p>
        {recipients.length === 0 ? (
          <p className="text-xs text-gray-400">No recipients yet. Add at least one to switch the report on.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {recipients.map((email) => (
              <li
                key={email}
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-800"
              >
                {email}
                <button
                  type="button"
                  aria-label={`Remove ${email}`}
                  onClick={() => removeRecipient(email)}
                  className="text-gray-500 hover:text-red-600"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {adding ? (
          <div className="mt-2 space-y-1">
            <div className="flex gap-2">
              <input
                type="email"
                autoFocus
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setDraftError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addRecipient()
                  }
                  if (e.key === 'Escape') closeAdd()
                }}
                placeholder="name@xocks.co"
                aria-label="Recipient email"
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
              />
              <button
                type="button"
                onClick={addRecipient}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-[#0A0A0A] text-white hover:bg-gray-800"
              >
                Add
              </button>
              <button
                type="button"
                onClick={closeAdd}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
            {draftError && <p className="text-xs text-red-600">{draftError}</p>}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={recipients.length >= DAILY_REPORT_MAX_RECIPIENTS}
            className="mt-2 text-sm font-medium text-gray-800 hover:underline disabled:opacity-40"
          >
            + Add email recipient
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
