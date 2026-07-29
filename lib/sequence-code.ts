import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Generates the next code in a zero-padded sequence (e.g. DO-2026-0035,
 * STR-004) by finding the MAX existing code with this prefix — not a
 * COUNT of rows. COUNT-based generation collides with an existing code
 * whenever any row with a lower sequence number was ever deleted (e.g.
 * a cancelled DO), since the count silently drops below the highest
 * sequence number actually in use.
 */
async function nextSequenceCode(
  supabase: SupabaseServerClient,
  table: string,
  column: string,
  prefix: string,
  padLength: number
): Promise<string> {
  const { data } = await supabase
    .from(table)
    .select(column)
    .like(column, `${prefix}%`)
    .order(column, { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastValue = data ? (data as unknown as Record<string, string>)[column] : null
  let nextSeq = 1
  if (lastValue) {
    const parsed = parseInt(lastValue.slice(prefix.length), 10)
    if (!Number.isNaN(parsed)) nextSeq = parsed + 1
  }
  return `${prefix}${String(nextSeq).padStart(padLength, '0')}`
}

interface InsertResult<T> {
  data: T | null
  error: { code?: string; message: string } | null
}

/**
 * Runs `insertFn` with a freshly generated sequence code, retrying with
 * the next number if the insert fails on a unique-constraint violation
 * (Postgres error code 23505) — covers a genuine race between two
 * near-simultaneous creations reading the same MAX at once. Gives up
 * after `maxAttempts` and returns the last error.
 *
 * insertFn's return type is PromiseLike, not Promise — Supabase's
 * `.single()` builder is thenable but not a full Promise (no .catch/
 * .finally), so it can be awaited directly without wrapping.
 */
export async function insertWithSequenceCode<T>(params: {
  supabase: SupabaseServerClient
  table: string
  column: string
  prefix: string
  padLength: number
  insertFn: (code: string) => PromiseLike<InsertResult<T>>
  maxAttempts?: number
}): Promise<InsertResult<T> & { code: string }> {
  const { supabase, table, column, prefix, padLength, insertFn, maxAttempts = 5 } = params
  let lastError: InsertResult<T>['error'] = null
  let code = ''

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    code = await nextSequenceCode(supabase, table, column, prefix, padLength)
    const result = await insertFn(code)
    if (!result.error) return { ...result, code }
    lastError = result.error
    if (result.error.code !== '23505') break // not a uniqueness collision — no point retrying
  }

  return { data: null, error: lastError, code }
}
