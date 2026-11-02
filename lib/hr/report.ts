// Monthly HR report: per-person claims, penalties, leave and MC for one
// month, plus year-to-date balances. Built fresh from the live database on
// every run (nothing stored). Used by /api/cron/hr-report and the admin
// "Download" / "Send test report" buttons.

import * as XLSX from 'xlsx'
import type { SupabaseClient } from '@supabase/supabase-js'
import { monthLabel, monthRange, parseYearMonth } from '@/lib/monthly-report/months'
import { todayMYT } from '@/lib/sales/last-sale'
import { CLAIM_CATEGORIES, LEAVE_TYPES, leaveBalance, leaveDaysWithin, type LeaveType } from './rules'
import { loadHolidaySet, loadHrSettings } from './settings'
import {
  CLAIM_COLUMNS, LEAVE_COLUMNS, MEMBER_COLUMNS, PENALTY_COLUMNS,
  numClaim, numLeave, numMember, type HrClaim, type HrLeave, type HrMember, type HrPenalty,
} from './types'

export interface HrMemberRow {
  name: string
  claimsApproved: number
  claimsPending: number
  /** Approved but not yet paid, from any month: what still has to be reimbursed. */
  toReimburse: number
  penalties: number
  lateCount: number
  leaveDays: Record<LeaveType, number>
  annualRemaining: number
  annualEntitled: number
  mcRemaining: number
  mcEntitled: number
}

export interface HrMonthReport {
  ym: string
  monthLabel: string
  today: string
  rows: HrMemberRow[]
  claims: (HrClaim & { name: string })[]
  leaves: (HrLeave & { name: string; daysInMonth: number })[]
  penalties: (HrPenalty & { name: string })[]
  totals: { claimsApproved: number; claimsPending: number; toReimburse: number; penalties: number; leaveDays: number; mcDays: number }
  pendingRequests: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function buildHrMonthReport(db: SupabaseClient, ym: string): Promise<HrMonthReport> {
  const parsed = parseYearMonth(ym)
  if (!parsed) throw new Error(`Invalid month: ${ym}`)
  const { start, end } = monthRange(ym)
  const yearStart = `${parsed.year}-01-01`
  const yearEnd = `${parsed.year}-12-31`

  const [settings, holidays, membersRes, claimsRes, outstandingRes, leavesRes, penaltiesRes, pendingClaims, pendingLeaves] =
    await Promise.all([
      loadHrSettings(db),
      loadHolidaySet(db, yearStart, yearEnd),
      db.from('xocks_team_members').select(MEMBER_COLUMNS).order('name'),
      db.from('hr_claims').select(CLAIM_COLUMNS).gte('claim_date', start).lte('claim_date', end).order('claim_date'),
      db.from('hr_claims').select('member_id, amount').eq('status', 'approved'),
      // Every leave touching the year: balances need the whole year, the month list filters below.
      db.from('hr_leaves').select(LEAVE_COLUMNS).lte('start_date', yearEnd).gte('end_date', yearStart).order('start_date'),
      db.from('hr_penalties').select(PENALTY_COLUMNS).gte('penalty_date', start).lte('penalty_date', end).order('penalty_date'),
      db.from('hr_claims').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      db.from('hr_leaves').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ])
  for (const r of [membersRes, claimsRes, outstandingRes, leavesRes, penaltiesRes]) {
    if (r.error) throw new Error(r.error.message)
  }

  const members = (membersRes.data ?? []).map(numMember) as HrMember[]
  const nameOf = new Map(members.map((m) => [m.id, m.name]))
  const claims = (claimsRes.data ?? []).map(numClaim) as HrClaim[]
  const allLeaves = (leavesRes.data ?? []).map(numLeave) as HrLeave[]
  const penalties = (penaltiesRes.data ?? []).map((p) => ({ ...p, amount: Number(p.amount) })) as HrPenalty[]
  const outstanding = new Map<string, number>()
  for (const c of outstandingRes.data ?? []) {
    outstanding.set(c.member_id, (outstanding.get(c.member_id) ?? 0) + Number(c.amount))
  }

  const dayOpts = { workDays: settings.workDays, holidays }
  const monthLeaves = allLeaves
    .filter((l) => l.status !== 'rejected' && l.start_date <= end && l.end_date >= start)
    .map((l) => ({ ...l, name: nameOf.get(l.member_id) ?? '?', daysInMonth: leaveDaysWithin(l, start, end, dayOpts) }))

  // Everyone active, plus anyone hidden since who still has records this month.
  const withRecords = new Set([
    ...claims.map((c) => c.member_id),
    ...monthLeaves.map((l) => l.member_id),
    ...penalties.map((p) => p.member_id),
    ...outstanding.keys(),
  ])
  const inScope = members.filter((m) => m.active || withRecords.has(m.id))

  const rows: HrMemberRow[] = inScope.map((m) => {
    const mine = <T extends { member_id: string }>(list: T[]) => list.filter((x) => x.member_id === m.id)
    const myClaims = mine(claims)
    const myPenalties = mine(penalties)
    const leaveDays: Record<LeaveType, number> = { annual: 0, emergency: 0, unpaid: 0, mc: 0 }
    for (const l of mine(monthLeaves)) if (l.status === 'approved') leaveDays[l.leave_type] += l.daysInMonth
    const myYear = mine(allLeaves)
    const annual = leaveBalance('annual', m.annual_leave_days, myYear, parsed.year, dayOpts)
    const mc = leaveBalance('mc', m.mc_days, myYear, parsed.year, dayOpts)
    return {
      name: m.name,
      claimsApproved: round2(myClaims.filter((c) => c.status === 'approved' || c.status === 'paid').reduce((s, c) => s + c.amount, 0)),
      claimsPending: round2(myClaims.filter((c) => c.status === 'pending').reduce((s, c) => s + c.amount, 0)),
      toReimburse: round2(outstanding.get(m.id) ?? 0),
      penalties: round2(myPenalties.reduce((s, p) => s + p.amount, 0)),
      lateCount: myPenalties.filter((p) => p.kind === 'late').length,
      leaveDays,
      annualRemaining: annual.remaining,
      annualEntitled: annual.entitled,
      mcRemaining: mc.remaining,
      mcEntitled: mc.entitled,
    }
  })

  const sum = (f: (r: HrMemberRow) => number) => round2(rows.reduce((s, r) => s + f(r), 0))
  return {
    ym,
    monthLabel: monthLabel(ym),
    today: todayMYT(),
    rows,
    claims: claims.map((c) => ({ ...c, name: nameOf.get(c.member_id) ?? '?' })),
    leaves: monthLeaves,
    penalties: penalties.map((p) => ({ ...p, name: nameOf.get(p.member_id) ?? '?' })),
    totals: {
      claimsApproved: sum((r) => r.claimsApproved),
      claimsPending: sum((r) => r.claimsPending),
      toReimburse: sum((r) => r.toReimburse),
      penalties: sum((r) => r.penalties),
      leaveDays: sum((r) => r.leaveDays.annual + r.leaveDays.emergency + r.leaveDays.unpaid),
      mcDays: sum((r) => r.leaveDays.mc),
    },
    pendingRequests: (pendingClaims.count ?? 0) + (pendingLeaves.count ?? 0),
  }
}

type Cell = string | number | null

function sheet(rows: Cell[][], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = widths.map((wch) => ({ wch }))
  return ws
}

export function hrReportWorkbook(r: HrMonthReport): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet([
    [`Xocks HR Report — ${r.monthLabel}`],
    [`Generated ${r.today}. Leave balances are for the calendar year, approved + pending deducted.`],
    [],
    ['Staff', 'Claims approved (RM)', 'Claims pending (RM)', 'To reimburse, all months (RM)', 'Penalties (RM)', 'Times late',
      'Annual leave (days)', 'Emergency leave (days)', 'Unpaid leave (days)', 'MC (days)', 'Annual leave left', 'MC left'],
    ...r.rows.map((x) => [
      x.name, x.claimsApproved, x.claimsPending, x.toReimburse, x.penalties, x.lateCount,
      x.leaveDays.annual, x.leaveDays.emergency, x.leaveDays.unpaid, x.leaveDays.mc,
      `${x.annualRemaining} / ${x.annualEntitled}`, `${x.mcRemaining} / ${x.mcEntitled}`,
    ]),
    ['TOTAL', r.totals.claimsApproved, r.totals.claimsPending, r.totals.toReimburse, r.totals.penalties,
      r.rows.reduce((s, x) => s + x.lateCount, 0), null, null, null, r.totals.mcDays],
  ], [22, 18, 18, 24, 14, 10, 16, 18, 16, 10, 16, 10]), 'Summary')

  XLSX.utils.book_append_sheet(wb, sheet([
    ['Date', 'Staff', 'Category', 'Description', 'Amount (RM)', 'Status', 'Receipt', 'Note'],
    ...r.claims.map((c) => [c.claim_date, c.name, CLAIM_CATEGORIES[c.category] ?? c.category, c.description, c.amount, c.status,
      c.receipt_path ? 'Yes' : 'No', c.review_note]),
  ], [12, 20, 18, 40, 12, 10, 8, 30]), 'Claims')

  XLSX.utils.book_append_sheet(wb, sheet([
    ['Staff', 'Type', 'From', 'To', 'Half day', 'Days this month', 'Status', 'Reason', 'MC slip'],
    ...r.leaves.map((l) => [l.name, LEAVE_TYPES[l.leave_type], l.start_date, l.end_date, l.half_day ? 'Yes' : '', l.daysInMonth,
      l.status, l.reason, l.leave_type === 'mc' ? (l.attachment_path ? 'Yes' : 'No') : '']),
  ], [20, 18, 12, 12, 9, 15, 10, 36, 8]), 'Leave & MC')

  XLSX.utils.book_append_sheet(wb, sheet([
    ['Date', 'Staff', 'Type', 'Minutes late', 'Amount (RM)', 'Note'],
    ...r.penalties.map((p) => [p.penalty_date, p.name, p.kind === 'late' ? 'Late' : 'Other', p.minutes_late, p.amount, p.note]),
  ], [12, 20, 8, 13, 12, 36]), 'Penalties')

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export function hrReportFileName(ym: string): string {
  return `Xocks-HR-Report-${ym}.xlsx`
}
