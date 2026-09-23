// Event Target Calculator — pure maths, shared by the API (authoritative
// recalculation on save) and the admin UI (live preview). Ported from the
// standalone reference implementation; the unit test in
// scripts/test-event-target-calc.mjs pins the expected values.

export interface TargetSettings {
  per_head_small: number
  per_head_medium: number
  per_head_major: number
  tier1_pct_of_tier2: number
  tier3_pct_of_tier2: number
  bonus_tier1: number
  bonus_tier2: number
  bonus_tier3: number
  round_to: number
  avg_sale_per_customer: number
  min_cover_ratio: number
}

export const DEFAULT_SETTINGS: TargetSettings = {
  per_head_small: 500,
  per_head_medium: 800,
  per_head_major: 1200,
  tier1_pct_of_tier2: 70,
  tier3_pct_of_tier2: 150,
  bonus_tier1: 20,
  bonus_tier2: 50,
  bonus_tier3: 100,
  round_to: 10,
  avg_sale_per_customer: 50,
  min_cover_ratio: 2.0,
}

export type EventLevel = 'small' | 'medium' | 'major'

export interface DayInput {
  label: string
  crew: number
  weight_pct: number
}

export interface DayResult extends DayInput {
  day_target_tier2: number
  per_person_tier1: number
  per_person_tier2: number
  per_person_tier3: number
  customers_for_tier2: number
}

export interface CalcInput {
  level: EventLevel
  per_head_override?: number | null // admin may override the level's per-head
  rental: number
  delivery: number
  other_fixed: number
  pt_daily_rate: number
  days: DayInput[]
}

export interface CalcResult {
  per_head_tier2: number
  pt_days: number
  fixed_cost: number
  tier1_total: number
  tier2_total: number
  tier3_total: number
  cover_ratio: number
  days: DayResult[]
}

export function perHeadForLevel(level: EventLevel, s: TargetSettings): number {
  return { small: s.per_head_small, medium: s.per_head_medium, major: s.per_head_major }[level]
}

/** 3 days → 25/40/35, 2 days → 55/45, otherwise equal split. */
export function defaultWeights(n: number): number[] {
  if (n === 3) return [25, 40, 35]
  if (n === 2) return [55, 45]
  return Array.from({ length: n }, () => Number((100 / n).toFixed(1)))
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step

export function calcTargets(input: CalcInput, s: TargetSettings): CalcResult {
  const per_head = input.per_head_override && input.per_head_override > 0
    ? input.per_head_override
    : perHeadForLevel(input.level, s)

  const pt_days = input.days.reduce((a, d) => a + (d.crew || 0), 0)
  const tier2_total = per_head * pt_days
  const tier1_total = tier2_total * s.tier1_pct_of_tier2 / 100
  const tier3_total = tier2_total * s.tier3_pct_of_tier2 / 100
  const fixed_cost = (input.rental || 0) + (input.delivery || 0) + (input.other_fixed || 0)
    + pt_days * (input.pt_daily_rate || 0)
  const cover_ratio = fixed_cost > 0 ? tier2_total / fixed_cost : 0

  const wsum = input.days.reduce((a, d) => a + (d.weight_pct || 0), 0) || 1
  const rnd = Math.max(1, s.round_to || 10)
  const aov = Math.max(1, s.avg_sale_per_customer || 50)

  const days: DayResult[] = input.days.map((d) => {
    const share = (d.weight_pct || 0) / wsum
    const perPerson = (total: number) => (d.crew > 0 ? roundTo(total * share / d.crew, rnd) : 0)
    const p2 = perPerson(tier2_total)
    return {
      ...d,
      day_target_tier2: Math.round(tier2_total * share),
      per_person_tier1: perPerson(tier1_total),
      per_person_tier2: p2,
      per_person_tier3: perPerson(tier3_total),
      customers_for_tier2: d.crew > 0 ? Math.ceil(p2 / aov) : 0,
    }
  })

  return {
    per_head_tier2: per_head,
    pt_days,
    fixed_cost,
    tier1_total: Math.round(tier1_total),
    tier2_total: Math.round(tier2_total),
    tier3_total: Math.round(tier3_total),
    cover_ratio: Number(cover_ratio.toFixed(2)),
    days,
  }
}

export const fmtRM = (n: number) => 'RM' + Math.round(n).toLocaleString('en-MY')

/** The message the events lead pastes into the crew WhatsApp group. */
export function whatsappBrief(name: string, result: CalcResult, s: TargetSettings): string {
  let brief = `*${name || 'Event'} — your numbers*\n\n`
  for (const d of result.days) {
    if (d.crew <= 0) continue
    brief += `*${d.label}* (${d.crew} crew)\n`
    brief += `Hit ${fmtRM(d.per_person_tier2)} = RM${s.bonus_tier2} cash tonight (about ${d.customers_for_tier2} customers at RM${s.avg_sale_per_customer})\n`
    brief += `${fmtRM(d.per_person_tier1)} = RM${s.bonus_tier1}  •  ${fmtRM(d.per_person_tier3)} = RM${s.bonus_tier3}\n\n`
  }
  brief += `Your number = sales rung under your name at the counter. Per person, per day. Top seller of the event gets an extra RM50.\n`
  brief += `Capture name + phone for every customer in POS. Let's go 💪`
  return brief
}
