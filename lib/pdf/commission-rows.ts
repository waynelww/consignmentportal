// Makes the COMMISSION column of an invoice add up exactly to the period's
// stored commission total.
//
// Each row is a sum of sale-level commissions, so rounding every row to the
// sen can leave the rows a few sen away from the total (XCSM-119: rows 235.71,
// total 235.67). Largest-remainder rounding fixes that: every row is floored to
// the sen, then the leftover sen go to the rows that lost the most in rounding.
// Only the printed figures change. Stored amounts are never touched.

const SEN = 100

export function fitCommissionRows<T extends { commission: number }>(
  rows: T[],
  totalCommission: number,
): T[] {
  const n = rows.length
  if (n === 0) return rows

  const scaled = rows.map((r) => r.commission * SEN)
  const floors = scaled.map((v) => Math.floor(v + 1e-9))
  const remainders = scaled.map((v, i) => Math.max(0, v - floors[i]))
  const target = Math.round(totalCommission * SEN)

  let diff = target - floors.reduce((sum, v) => sum + v, 0)

  // Largest remainder first; ties keep the original row order.
  const byRemainderDesc = rows
    .map((_, i) => i)
    .sort((a, b) => remainders[b] - remainders[a] || a - b)

  // Normally 0 <= diff < n. Cycling keeps the sum exact even if it is larger.
  for (let k = 0; diff > 0; k++, diff--) floors[byRemainderDesc[k % n]] += 1
  for (let k = 0; diff < 0; k++, diff++) floors[byRemainderDesc[n - 1 - (k % n)]] -= 1

  return rows.map((r, i) => ({ ...r, commission: floors[i] / SEN }))
}
