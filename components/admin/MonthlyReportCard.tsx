'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Download, Send } from 'lucide-react'
import { TEST_REPORT_RECIPIENT } from '@/lib/monthly-report/settings'

// Settings → General. The monthly email itself runs on the 1st (GitHub Action);
// these two buttons send or download last month's report on demand.
export default function MonthlyReportCard() {
  const [sending, setSending] = useState(false)

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
    </div>
  )
}
