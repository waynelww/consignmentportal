// Event POS discounts — rules, never fixed RM amounts. Pure; the phone uses it
// for the live total and the API recalculates with it before every sale.
// One discount per sale. Percentages apply to the cart after free pairs.

export type DiscountType =
  | 'free_cheapest' | 'percent' | 'free_then_percent' | 'bundle_price'
  | 'group_percent' | 'addon_free' | 'per_pair_off'

export interface PosDiscount {
  id: string
  label: string
  type: DiscountType
  params: Record<string, unknown>
  sort: number
}

export interface DiscountLine {
  unit_price: number
  qty: number
  is_pair: boolean
  is_patch: boolean
  design: boolean
}

export interface DiscountResult {
  qualifies: boolean
  amount: number // RM off, rounded to sen, never more than the subtotal
  note: string // "Needs 5 pairs (3 in cart)" when it doesn't qualify
}

const r2 = (n: number) => Math.round(Number((n * 100).toPrecision(12))) / 100
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' ? Number(v) : d)

function units(lines: DiscountLine[], pick: (l: DiscountLine) => boolean): number[] {
  const out: number[] = []
  for (const l of lines) if (pick(l)) for (let i = 0; i < l.qty; i++) out.push(l.unit_price)
  return out.sort((a, b) => a - b)
}
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)

export function cartSubtotal(lines: DiscountLine[]): number {
  return r2(lines.reduce((s, l) => s + l.unit_price * l.qty, 0))
}
export function cartPairs(lines: DiscountLine[]): number {
  return lines.reduce((s, l) => s + (l.is_pair ? l.qty : 0), 0)
}

function needPairs(n: number, have: number): DiscountResult {
  return { qualifies: false, amount: 0, note: `Needs ${n} pair${n === 1 ? '' : 's'} (${have} in cart)` }
}

export function evaluateDiscount(d: Pick<PosDiscount, 'type' | 'params'>, lines: DiscountLine[]): DiscountResult {
  const subtotal = cartSubtotal(lines)
  const pairs = units(lines, (l) => l.is_pair)
  const p = d.params ?? {}
  let amount = 0

  switch (d.type) {
    case 'free_cheapest': {
      const min = num(p.min_pairs, 1), free = num(p.free, 1)
      if (pairs.length < min) return needPairs(min, pairs.length)
      amount = sum(pairs.slice(0, free))
      break
    }
    case 'free_then_percent': {
      const min = num(p.min_pairs, 1), free = num(p.free, 1), pct = num(p.pct)
      if (pairs.length < min) return needPairs(min, pairs.length)
      const freeAmt = sum(pairs.slice(0, free))
      amount = freeAmt + (subtotal - freeAmt) * pct / 100
      break
    }
    case 'percent': {
      if (subtotal <= 0) return { qualifies: false, amount: 0, note: 'Add items first' }
      amount = subtotal * num(p.pct) / 100
      break
    }
    case 'bundle_price': {
      const n = num(p.pairs, 1), price = num(p.price)
      if (pairs.length < n) return needPairs(n, pairs.length)
      amount = Math.max(0, sum(pairs.slice(0, n)) - price)
      break
    }
    case 'group_percent': {
      const g = units(lines, (l) => l.is_pair && l.design)
      if (!g.length) return { qualifies: false, amount: 0, note: 'Needs Design socks in cart' }
      amount = sum(g) * num(p.pct) / 100
      break
    }
    case 'addon_free': {
      const n = num(p.patches, 2)
      const patches = units(lines, (l) => l.is_patch && l.unit_price > 0)
      if (patches.length < n) return { qualifies: false, amount: 0, note: `Needs ${n} patches (${patches.length} in cart)` }
      amount = sum(patches.slice(0, n))
      break
    }
    case 'per_pair_off': {
      const off = num(p.amount), price = num(p.unit_price)
      const eligible = pairs.filter((u) => Math.abs(u - price) < 0.005)
      if (!eligible.length) return { qualifies: false, amount: 0, note: `Needs RM${price.toFixed(2)} pairs in cart` }
      amount = eligible.reduce((s, u) => s + Math.min(off, u), 0)
      break
    }
    default:
      return { qualifies: false, amount: 0, note: 'Unknown discount' }
  }

  amount = r2(Math.min(subtotal, Math.max(0, amount)))
  if (amount <= 0) return { qualifies: false, amount: 0, note: 'Nothing to discount' }
  return { qualifies: true, amount, note: `−RM${amount.toFixed(2)}` }
}

export function cartTotals(lines: DiscountLine[], discount: Pick<PosDiscount, 'type' | 'params'> | null) {
  const subtotal = cartSubtotal(lines)
  const res = discount ? evaluateDiscount(discount, lines) : null
  const discount_amount = res?.qualifies ? res.amount : 0
  return { subtotal, discount_amount, total: r2(subtotal - discount_amount), pairs: cartPairs(lines), discount: res }
}
