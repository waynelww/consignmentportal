import { createServiceClient } from '@/lib/supabase/server'
import { requireWaAdmin } from '@/lib/wa/require-admin'
import { pageAll } from '@/lib/performance/channels'
import { chunk } from '@/lib/wa/blast'

// GET /api/admin/wa/metrics — CS first-response times, last 30 days.
//
// A "turn" starts at the first inbound message after the last outbound
// reply in a conversation; it is answered by the next NON-BLAST outbound
// message (a marketing blast landing mid-conversation is not a CS reply).
// Per day (Malaysia time, keyed by when the turn STARTED): count, median
// and 95th-percentile response time, plus turns still unanswered.
//
// Caveat while CS replies from the WhatsApp Business app (coexistence):
// only replies visible to the Cloud API count — subscribe the app-echo
// webhook field or send replies through XCMS for full coverage (Phase 2).

const WINDOW_DAYS = 30

interface MsgRow {
  conversation_key: string
  direction: 'inbound' | 'outbound'
  created_at: string
}

function mytDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

export async function GET() {
  const { denied } = await requireWaAdmin()
  if (denied) return denied

  const db = await createServiceClient()
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const inbound = await pageAll<MsgRow>((from, to) =>
    db
      .from('wa_messages')
      .select('conversation_key, direction, created_at')
      .eq('direction', 'inbound')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )

  const keys = [...new Set(inbound.map((m) => m.conversation_key))]
  const outbound: MsgRow[] = []
  for (const batch of chunk(keys, 100)) {
    const rows = await pageAll<MsgRow>((from, to) =>
      db
        .from('wa_messages')
        .select('conversation_key, direction, created_at')
        .eq('direction', 'outbound')
        .is('blast_id', null)
        .in('conversation_key', batch)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )
    outbound.push(...rows)
  }

  // Walk each conversation chronologically, pairing turn starts with the
  // first reply that follows.
  const byConversation = new Map<string, MsgRow[]>()
  for (const m of [...inbound, ...outbound]) {
    const list = byConversation.get(m.conversation_key) ?? []
    list.push(m)
    byConversation.set(m.conversation_key, list)
  }

  interface DayAgg { times: number[]; unanswered: number }
  const days = new Map<string, DayAgg>()
  const dayAgg = (day: string): DayAgg => {
    let agg = days.get(day)
    if (!agg) { agg = { times: [], unanswered: 0 }; days.set(day, agg) }
    return agg
  }

  for (const msgs of byConversation.values()) {
    msgs.sort((a, b) => a.created_at.localeCompare(b.created_at))
    let turnStart: string | null = null
    for (const m of msgs) {
      if (m.direction === 'inbound') {
        if (turnStart === null) turnStart = m.created_at
      } else if (turnStart !== null) {
        const seconds = (new Date(m.created_at).getTime() - new Date(turnStart).getTime()) / 1000
        dayAgg(mytDay(turnStart)).times.push(seconds)
        turnStart = null
      }
    }
    if (turnStart !== null) dayAgg(mytDay(turnStart)).unanswered++
  }

  const daily = [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, agg]) => {
      const sorted = [...agg.times].sort((a, b) => a - b)
      return {
        day,
        turns: agg.times.length + agg.unanswered,
        answered: agg.times.length,
        unanswered: agg.unanswered,
        median_seconds: percentile(sorted, 50),
        p95_seconds: percentile(sorted, 95),
      }
    })

  const allTimes = daily.flatMap((d) => days.get(d.day)?.times ?? []).sort((a, b) => a - b)
  return Response.json({
    window_days: WINDOW_DAYS,
    overall: {
      answered: allTimes.length,
      unanswered: daily.reduce((sum, d) => sum + d.unanswered, 0),
      median_seconds: percentile(allTimes, 50),
      p95_seconds: percentile(allTimes, 95),
    },
    daily,
  })
}
