'use client'

import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { HR_BUCKET_NAME } from './constants'

export function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-green-100 text-green-700',
    paid: 'bg-blue-100 text-blue-700',
    rejected: 'bg-red-100 text-red-700',
  }
  return (
    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase', tone[status] ?? 'bg-gray-100 text-gray-500')}>
      {status}
    </span>
  )
}

/** base = '/api/hr' on the admin page, '/api/hr-portal' on the staff link. */
export function FileLink({ kind, id, label = 'View', base = '/api/hr' }: { kind: 'claim' | 'leave'; id: string; label?: string; base?: string }) {
  return (
    <a
      href={`${base}/requests/${kind}/${id}/file`}
      target="_blank"
      rel="noreferrer"
      className="text-xs font-medium text-blue-600 hover:underline"
    >
      {label}
    </a>
  )
}

/** Uploads a receipt / MC slip (staff link) straight to storage and returns what the submit call needs. */
export async function uploadHrFile(file: File): Promise<{ file_path: string; file_name: string; file_type: string }> {
  const qs = new URLSearchParams({ filename: file.name, content_type: file.type })
  const res = await fetch(`/api/hr-portal/upload-url?${qs}`)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? 'Could not start the upload')
  const { error } = await createClient().storage.from(HR_BUCKET_NAME).uploadToSignedUrl(body.path, body.token, file, {
    contentType: file.type,
  })
  if (error) throw new Error(`Upload failed: ${error.message}`)
  return { file_path: body.path, file_name: file.name, file_type: file.type }
}

export function fmtDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function fmtRange(start: string, end: string, halfDay?: boolean): string {
  if (start === end) return `${fmtDate(start)}${halfDay ? ' (half day)' : ''}`
  return `${fmtDate(start)} – ${fmtDate(end)}`
}

export const inputClass =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700]/50 focus:border-[#FFD700]'
export const labelClass = 'block text-xs font-semibold text-gray-600 mb-1'
export const cardClass = 'bg-white rounded-xl shadow-sm border border-gray-100'
export const primaryButton =
  'flex items-center justify-center gap-1.5 px-4 py-2 bg-[#0A0A0A] text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50'
