// Pins the paging in fetchPairsSinceByStore: the Stores list must count every
// sale, not just the first 1,000 rows PostgREST returns.
// Run: npx tsx scripts/test-sales-pairs.ts
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchPairsSinceByStore } from '../lib/sales/pairs'

// 2,500 sales for store A (qty 1 each) and 3 for store B (qty 2), served in
// pages of at most 1,000 like PostgREST does.
const rows = [
  ...Array.from({ length: 2500 }, (_, i) => ({ id: `a${String(i).padStart(5, '0')}`, store_id: 'A', quantity: 1 })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, store_id: 'B', quantity: 2 })),
]
const calls: { from: number; to: number; fromDate: string | null; storeIds: string[] | null }[] = []

function fakeDb(): SupabaseClient {
  let storeIds: string[] | null = null
  let fromDate: string | null = null
  const chain = {
    select: () => chain,
    in: (_col: string, ids: string[]) => { storeIds = ids; return chain },
    gte: (_col: string, d: string) => { fromDate = d; return chain },
    order: () => chain,
    range: async (from: number, to: number) => {
      calls.push({ from, to, fromDate, storeIds })
      const matching = rows.filter((r) => storeIds!.includes(r.store_id))
      const data = matching.slice(from, Math.min(to + 1, from + 1000, matching.length))
      return { data, error: null }
    },
  }
  return { from: () => chain } as unknown as SupabaseClient
}

async function main() {
  const totals = await fetchPairsSinceByStore(fakeDb(), ['A', 'B'], '2026-10-01')
  assert.deepEqual(totals, { A: 2500, B: 6 }, 'every page is read')
  assert.ok(calls.every((c) => c.fromDate === '2026-10-01' && c.storeIds!.join() === 'A,B'))
  assert.equal(calls.length, 3, 'stops after the short last page')

  assert.deepEqual(await fetchPairsSinceByStore(fakeDb(), [], '2026-10-01'), {}, 'no stores, no query')
  console.log('test-sales-pairs: all assertions passed')
}
main()
