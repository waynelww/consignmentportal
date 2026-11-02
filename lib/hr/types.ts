import type { ClaimCategory, ClaimStatus, LeaveStatus, LeaveType } from './rules'

export interface HrMember {
  id: string
  name: string
  active: boolean
  annual_leave_days: number
  mc_days: number
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
  'id, member_id, claim_date, category, amount, description, receipt_path, receipt_name, status, review_note, reviewed_at, paid_at, created_at'
export const LEAVE_COLUMNS =
  'id, member_id, leave_type, start_date, end_date, half_day, days, reason, attachment_path, attachment_name, status, review_note, reviewed_at, created_at'
export const PENALTY_COLUMNS = 'id, member_id, penalty_date, kind, minutes_late, amount, note, created_at'
export const MEMBER_COLUMNS = 'id, name, active, annual_leave_days, mc_days'

/** Supabase returns NUMERIC columns as strings; coerce the money/day fields. */
export function numClaim<T extends { amount: unknown }>(r: T): T & { amount: number } {
  return { ...r, amount: Number(r.amount) }
}
export function numLeave<T extends { days: unknown }>(r: T): T & { days: number } {
  return { ...r, days: Number(r.days) }
}
export function numMember<T extends { annual_leave_days: unknown; mc_days: unknown }>(r: T): T & { annual_leave_days: number; mc_days: number } {
  return { ...r, annual_leave_days: Number(r.annual_leave_days), mc_days: Number(r.mc_days) }
}
