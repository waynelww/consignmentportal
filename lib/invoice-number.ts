import type { SupabaseClient } from '@supabase/supabase-js'

export const INVOICE_PREFIX = 'XCSM'

// Historical invoices were backfilled XCSM-001…0xx (ordered oldest store
// first). Every number assigned at generation time starts from 100, per
// Wayne — the gap makes old vs new numbering obvious at a glance.
const FIRST_AUTO_NO = 100

export function formatInvoiceNo(n: number | null | undefined): string | null {
  if (!n) return null
  return `${INVOICE_PREFIX}-${String(n).padStart(3, '0')}`
}

/**
 * Assign the next free invoice number to a commission period.
 * Reads MAX(invoice_no)+1 (floored at FIRST_AUTO_NO) and writes it; the
 * partial unique index on invoice_no makes concurrent assignments collide
 * loudly instead of duplicating, and the loop just re-reads and retries.
 * MAX, not COUNT — deletions must never let a number be reissued.
 */
export async function assignInvoiceNo(
  svc: SupabaseClient,
  periodId: string,
): Promise<number | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data: top } = await svc
      .from('commission_periods')
      .select('invoice_no')
      .not('invoice_no', 'is', null)
      .order('invoice_no', { ascending: false })
      .limit(1)
      .maybeSingle()

    const next = Math.max(((top?.invoice_no as number | null) ?? 0) + 1, FIRST_AUTO_NO)

    const { data: updated, error } = await svc
      .from('commission_periods')
      .update({ invoice_no: next })
      .eq('id', periodId)
      .is('invoice_no', null) // never renumber an invoice that already has one
      .select('invoice_no')

    if (!error) {
      if (updated && updated.length > 0) return next
      // 0 rows touched — someone else numbered this period already; return theirs
      const { data: row } = await svc
        .from('commission_periods')
        .select('invoice_no')
        .eq('id', periodId)
        .single()
      return (row?.invoice_no as number | null) ?? null
    }
    if (error.code !== '23505') {
      console.error('[assignInvoiceNo] failed for period', periodId, error)
      return null
    }
    // collision with a parallel assignment — re-read max and try again
  }
  console.error('[assignInvoiceNo] gave up after retries for period', periodId)
  return null
}
