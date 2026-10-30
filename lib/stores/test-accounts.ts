// Test accounts: stores with stores.is_test = true. They work normally in the
// store app (staff picker, sales, inventory) but are left out of every report,
// KPI, chart, alert email, restock calculation and commission run.
//
// This file is the only place that decides it. Callers load the ids once and
// then filter their rows with isTestStore().

import type { SupabaseClient } from '@supabase/supabase-js'

/** Ids of every store flagged as a test account. */
export async function loadTestStoreIds(db: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await db.from('stores').select('id').eq('is_test', true)
  if (error) throw new Error(error.message)
  return new Set((data ?? []).map((s) => s.id as string))
}

/** True when the store is a test account. Pass the set from loadTestStoreIds. */
export function isTestStore(testIds: ReadonlySet<string>, storeId: string | null | undefined): boolean {
  return storeId != null && testIds.has(storeId)
}
