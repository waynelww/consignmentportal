import type { SupabaseClient } from '@supabase/supabase-js'
import { pageAll } from '@/lib/performance/channels'

// Messaging-tier awareness. Meta limits template sends to N UNIQUE
// recipients per rolling 24h (250 → 1000 → 2000 → … as the tier upgrades).
// The current tier is configured as an env var; bump it in Vercel when Meta
// raises the tier (Business Manager shows the current limit).
export function tierLimit(): number {
  const n = Number(process.env.WHATSAPP_TIER_LIMIT)
  return Number.isFinite(n) && n > 0 ? n : 250
}

// Unique phones we attempted a template send to in the last 24h. Counts
// sending/sent/delivered/read/failed (an attempt is an attempt) but not
// queued (not yet attempted).
export async function tierUsedLast24h(db: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const rows = await pageAll<{ phone: string }>((from, to) =>
    db
      .from('wa_messages')
      .select('phone')
      .eq('direction', 'outbound')
      .neq('status', 'queued')
      .gte('created_at', since)
      .order('id', { ascending: true })
      .range(from, to),
  )
  return new Set(rows.map((r) => r.phone)).size
}

// Template body params may use {store_name} / {pic_name} tokens that are
// resolved per recipient at queue time.
export function resolveParams(
  params: string[],
  store: { store_name?: string | null; pic_name?: string | null } | null,
): string[] {
  return params.map((p) =>
    p
      .replaceAll('{store_name}', store?.store_name ?? '')
      .replaceAll('{pic_name}', store?.pic_name ?? '')
      .trim(),
  )
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
