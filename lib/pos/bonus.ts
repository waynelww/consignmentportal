// Event POS bonus — pure. Tiers and bonus amounts come from the event's
// Event Target (event_target_days per_person_tier1/2/3) and the global
// bonus_tier1/2/3 settings, measured against the sum of bonus_eligible_amount
// for one person on one day. Highest tier hit only.
//
// bonus_eligible_amount itself is set in the database (pos_record_sale /
// pos_recalc_bonus): only sales after event profit passes profit_unlock_amount
// count. Part-timers never see event profit or unlock status.

export interface TargetDay { position: number; label: string; per_person_tier1: number; per_person_tier2: number; per_person_tier3: number }
export interface DayTiers { label: string; tiers: [number, number, number] }
export interface BonusAmounts { bonus_tier1: number; bonus_tier2: number; bonus_tier3: number }

/** Days since the event start date, 0-based (both YYYY-MM-DD). */
export function dayIndex(startDate: string, day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000)
}

/** The Event Target day matching this calendar day (by position from the start date), or null. */
export function tiersForDay(startDate: string, day: string, days: TargetDay[]): DayTiers | null {
  const idx = dayIndex(startDate, day)
  const d = days.find((x) => x.position === idx)
  if (!d) return null
  return { label: d.label, tiers: [Number(d.per_person_tier1) || 0, Number(d.per_person_tier2) || 0, Number(d.per_person_tier3) || 0] }
}

export function tierHit(eligible: number, tiers: DayTiers | null, b: BonusAmounts): { tier: 0 | 1 | 2 | 3; bonus: number } {
  if (!tiers) return { tier: 0, bonus: 0 }
  const amounts = [b.bonus_tier1, b.bonus_tier2, b.bonus_tier3]
  for (let t = 3; t >= 1; t--) {
    const mark = tiers.tiers[t - 1]
    if (mark > 0 && eligible >= mark) return { tier: t as 1 | 2 | 3, bonus: Number(amounts[t - 1]) || 0 }
  }
  return { tier: 0, bonus: 0 }
}

/** "RM X more to reach Tier N", or null when Tier 3 is hit / no tiers. */
export function nextTier(eligible: number, tiers: DayTiers | null): { tier: number; more: number } | null {
  if (!tiers) return null
  for (let t = 1; t <= 3; t++) {
    const mark = tiers.tiers[t - 1]
    if (mark > 0 && eligible < mark) return { tier: t, more: Math.round((mark - eligible) * 100) / 100 }
  }
  return null
}

/** Mirrors pos_recalc_bonus in SQL — used by tests and the admin summary's "unlocked at". */
export function eligibleAmounts(totals: number[], fixedCost: number | null, unlock: number): number[] {
  if (fixedCost == null) return totals.map(() => 0)
  const threshold = fixedCost + unlock
  let running = 0
  return totals.map((t) => {
    const e = Math.max(0, Math.min(t, running + t - threshold))
    running += t
    return Math.round(e * 100) / 100
  })
}
