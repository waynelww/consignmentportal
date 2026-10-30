// Daily sales report settings: recipient rules and the report clock. Pure and
// client-safe (no server imports), so the store forms can use the same rules
// the API and the cron use.
//
// Every time is Malaysia time (UTC+8, no DST). The report for a day is sent at
// 22:00 that day; sales keyed after 22:00 are not in that day's report.

import { z } from 'zod'

export const DAILY_REPORT_CUTOFF_HOUR_MYT = 22
export const DAILY_REPORT_MAX_RECIPIENTS = 20

const recipientSchema = z.string().trim().toLowerCase().email()
/** A saved recipient list: emails, at most the cap. */
export const recipientListSchema = z.array(recipientSchema).max(DAILY_REPORT_MAX_RECIPIENTS)

/** Normalised email (trimmed, lower-cased), or null when it is not an email. */
export function parseRecipient(raw: string): string | null {
  const parsed = recipientSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Trim, lower-case and de-duplicate, keeping the first-entered order. */
export function normalizeRecipients(raw: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const email = parseRecipient(item)
    if (email && !seen.has(email)) {
      seen.add(email)
      out.push(email)
    }
  }
  return out
}

/**
 * The rule for saving the switch and the recipients together. Returns the
 * message to show, or null when the pair is allowed.
 */
export function validateDailyReportSettings(enabled: boolean, recipients: string[]): string | null {
  if (recipients.length > DAILY_REPORT_MAX_RECIPIENTS) {
    return `Too many recipients (max ${DAILY_REPORT_MAX_RECIPIENTS})`
  }
  if (enabled && recipients.length === 0) {
    return 'Add at least one recipient before switching the daily report on'
  }
  return null
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const ms = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value
}

/**
 * The instant sales are counted up to for a report day: 22:00 MYT on that
 * day, or "now" when that is earlier (the test send during the day). A late
 * cron run still reports up to 22:00, not up to the time it actually ran.
 */
export function reportCutoffIso(date: string, now: Date = new Date()): string {
  const cutoffMs = Date.parse(`${date}T${String(DAILY_REPORT_CUTOFF_HOUR_MYT).padStart(2, '0')}:00:00+08:00`)
  return new Date(Math.min(cutoffMs, now.getTime())).toISOString()
}

/** "30 October 2026" for a YYYY-MM-DD date. */
export function reportDateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
