'use client'

// Store page card: "Send test report" (today's sales so far, to the saved
// recipients) and the last few sends from the daily report log.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { formatMYTime, cn } from '@/lib/utils'
import type { DailySendRow } from '@/lib/daily-report/send-log'

const KIND_LABEL = { daily: 'Daily', test: 'Test' } as const

export function DailyReportTestCard({ storeId, recipientCount }: { storeId: string; recipientCount: number }) {
  const [sends, setSends] = useState<DailySendRow[] | null>(null)
  const [sending, setSending] = useState(false)

  const loadSends = useCallback(async () => {
    try {
      const res = await fetch(`/api/stores/${storeId}/daily-report`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Failed to load sends')
      setSends(body.sends ?? [])
    } catch (err) {
      setSends([])
      toast.error(err instanceof Error ? err.message : 'Failed to load sends')
    }
  }, [storeId])

  useEffect(() => {
    loadSends()
  }, [loadSends])

  async function sendTest() {
    setSending(true)
    try {
      const res = await fetch(`/api/stores/${storeId}/daily-report`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Test report failed to send')
      if (body.sent === false) toast.message(body.message ?? 'Nothing to send yet')
      else toast.success(`Test report sent to ${recipientCount} recipient${recipientCount === 1 ? '' : 's'}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test report failed to send')
    } finally {
      setSending(false)
      loadSends()
    }
  }

  return (
    <div className="bg-gray-50 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Daily sales report</h3>
      <p className="text-xs text-gray-500 mb-3">
        Test sends today&apos;s sales so far to the saved recipients. The daily email goes out at 10pm.
      </p>
      <button
        type="button"
        onClick={sendTest}
        disabled={sending || recipientCount === 0}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-[#0A0A0A] text-white hover:bg-gray-800 disabled:opacity-40 transition-colors flex items-center gap-2"
      >
        {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        {sending ? 'Sending…' : 'Send test report'}
      </button>
      {recipientCount === 0 && (
        <p className="text-xs text-gray-500 mt-2">Add a recipient and save the store first.</p>
      )}

      <div className="mt-4">
        <p className="text-xs font-medium text-gray-600 mb-2">Last sends</p>
        {sends === null ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : sends.length === 0 ? (
          <p className="text-xs text-gray-400">No sends yet.</p>
        ) : (
          <ul className="divide-y divide-gray-200 text-xs">
            {sends.map((s) => (
              <li key={s.id} className="py-2 grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-0.5 items-baseline">
                <span
                  className={cn(
                    'px-1.5 py-0.5 rounded font-medium',
                    s.status === 'sent' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
                  )}
                >
                  {s.status === 'sent' ? 'Sent' : 'Failed'}
                </span>
                <span className="text-gray-800 truncate">{s.recipient}</span>
                <span className="text-gray-500 whitespace-nowrap">{formatMYTime(s.sent_at)}</span>
                <span className="text-gray-500">
                  {KIND_LABEL[s.kind]} · sales of {s.report_date}
                </span>
                {s.error_message && <span className="col-span-2 text-red-600 break-words">{s.error_message}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
