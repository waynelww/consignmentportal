'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Download, Send } from 'lucide-react'
import { TEST_REPORT_RECIPIENT } from '@/lib/monthly-report/settings'
import type { ReportSendRow } from '@/lib/monthly-report/send-log'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthText(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

function sentText(iso: string): string {
  return new Date(iso).toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// Settings → General. The monthly email runs on the 1st (GitHub Action); these
// controls send or download last month's report on demand and show the log.
export default function MonthlyReportCard() {
  const [sending, setSending] = useState(false)
  const [sends, setSends] = useState<ReportSendRow[] | null>(null)

  const loadSends = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/monthly-report?list=sends', { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      setSends(res.ok && Array.isArray(data) ? data : [])
    } catch {
      setSends([])
    }
  }, [])

  useEffect(() => { loadSends() }, [loadSends])

  async function sendTest() {
    setSending(true)
    try {
      const res = await fetch('/api/admin/monthly-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) toast.error(data?.error ?? 'Test report failed to send')
      else toast.success(`Test report sent to ${TEST_REPORT_RECIPIENT}`)
    } catch {
      toast.error('Test report failed to send')
    } finally {
      setSending(false)
      loadSends()
    }
  }

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Monthly Report</h3>
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <label className="text-sm font-medium text-gray-700 block mb-0.5">Last month&apos;s report</label>
          <p className="text-xs text-gray-400">
            Emailed on the 1st at 09:30 MYT to the monthly report email above. The test sends last month&apos;s PDF and Excel to {TEST_REPORT_RECIPIENT}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={sendTest}
            disabled={sending}
            className="flex items-center gap-2 px-4 py-2 bg-[#0A0A0A] text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            <Send size={14} />
            {sending ? 'Sending...' : 'Send test report'}
          </button>
          <a
            href="/api/admin/monthly-report?format=pdf"
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-800 text-sm rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download size={14} />
            Download PDF
          </a>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium text-gray-500 mb-2">Recent sends</p>
        {sends === null ? (
          <div className="h-8 bg-gray-100 animate-pulse rounded-lg" />
        ) : sends.length === 0 ? (
          <p className="text-xs text-gray-400">No reports sent yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {sends.map((s) => (
              <li key={s.id} className="flex items-start gap-3 px-3 py-2 text-xs">
                <span className={s.status === 'sent' ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold'}>
                  {s.status === 'sent' ? 'Sent' : 'Failed'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-700">
                    {monthText(s.month_covered)} report · {s.kind === 'test' ? 'test' : 'monthly'} · {s.recipient ?? 'no recipient'}
                  </p>
                  {s.error_message && <p className="text-red-600 break-words">{s.error_message}</p>}
                </div>
                <span className="text-gray-400 whitespace-nowrap">{sentText(s.sent_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
