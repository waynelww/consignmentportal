import type { ClaimCategory, ClaimStatus, LeaveStatus, LeaveType } from './rules'

export interface HrMember {
  id: string
  name: string
  active: boolean
  /** Used only when custom_entitlement is on or there is no join date yet. */
  annual_leave_days: number
  mc_days: number
  join_date: string | null
  custom_entitlement: boolean
}

/** Work on a rest day / public holiday that earns replacement leave once approved. */
export interface HrRestDayWork {
  id: string
  member_id: string
  work_date: string
  day_kind: 'rest_day' | 'public_holiday'
  days_earned: number
  event_name: string
  note: string | null
  status: 'pending' | 'approved' | 'rejected'
  review_note: string | null
  reviewed_at: string | null
  created_at: string
}

export interface HrClaim {
  id: string
  member_id: string
  claim_date: string
  category: ClaimCategory
  amount: number
  description: string
  receipt_path: string | null
  receipt_name: string | null
  status: ClaimStatus
  review_note: string | null
  reviewed_at: string | null
  paid_at: string | null
  drive_url: string | null
  created_at: string
}

export interface HrLeave {
  id: string
  member_id: string
  leave_type: LeaveType
  start_date: string
  end_date: string
  half_day: boolean
  days: number
  reason: string | null
  attachment_path: string | null
  attachment_name: string | null
  status: LeaveStatus
  review_note: string | null
  reviewed_at: string | null
  drive_url: string | null
  created_at: string
}

export interface HrPenalty {
  id: string
  member_id: string
  penalty_date: string
  kind: 'late' | 'other'
  minutes_late: number | null
  amount: number
  note: string | null
  created_at: string
}

export interface HrHoliday {
  id: string
  holiday_date: string
  name: string
}

export const CLAIM_COLUMNS =
  'id, member_id, claim_date, category, amount, description, receipt_path, receipt_name, status, review_note, reviewed_at, paid_at, drive_url, created_at'
export const LEAVE_COLUMNS =
  'id, member_id, leave_type, start_date, end_date, half_day, days, reason, attachment_path, attachment_name, status, review_note, reviewed_at, drive_url, created_at'
export const PENALTY_COLUMNS = 'id, member_id, penalty_date, kind, minutes_late, amount, note, created_at'
export const MEMBER_COLUMNS = 'id, name, active, annual_leave_days, mc_days, join_date, custom_entitlement'
export const WORK_COLUMNS = 'id, member_id, work_date, day_kind, days_earned, event_name, note, status, review_note, reviewed_at, created_at'

/** Supabase returns NUMERIC columns as strings; coerce the money/day fields. */
export function numClaim<T extends { amount: unknown }>(r: T): T & { amount: number } {
  return { ...r, amount: Number(r.amount) }
}
export function numLeave<T extends { days: unknown }>(r: T): T & { days: number } {
  return { ...r, days: Number(r.days) }
}
export function numWork<T extends { days_earned: unknown }>(r: T): T & { days_earned: number } {
  return { ...r, days_earned: Number(r.days_earned) }
}
export function numMember<T extends { annual_leave_days: unknown; mc_days: unknown }>(r: T): T & { annual_leave_days: number; mc_days: number } {
  return { ...r, annual_leave_days: Number(r.annual_leave_days), mc_days: Number(r.mc_days) }
}
