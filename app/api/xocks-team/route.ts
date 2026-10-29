import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authoriseXocksTeam, TEAM_NAME_DUPLICATE } from '@/lib/xocks-team/access'

const NameSchema = z.string().trim().min(1, 'Name is required').max(60, 'Name must be 60 characters or fewer')

/**
 * GET  /api/xocks-team[?include_hidden=1] — the Xocks team, A–Z.
 * POST /api/xocks-team  { name }          — add a team member.
 */
export async function GET(request: NextRequest) {
  const auth = await authoriseXocksTeam()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  const includeHidden = request.nextUrl.searchParams.get('include_hidden') === '1'
  const supabase = await createClient()
  let query = supabase
    .from('xocks_team_members')
    .select('id, name, active, created_at')
    .order('name', { ascending: true })
  if (!includeHidden) query = query.eq('active', true)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ members: data ?? [] })
}

export async function POST(request: NextRequest) {
  const auth = await authoriseXocksTeam()
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = z.object({ name: NameSchema }).safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Validation error' }, { status: 400 })
  }

  const { data, error } = await createAdminClient()
    .from('xocks_team_members')
    .insert({ name: parsed.data.name })
    .select('id, name, active, created_at')
    .single()

  if (error?.code === '23505') return Response.json({ error: TEAM_NAME_DUPLICATE }, { status: 409 })
  if (error || !data) return Response.json({ error: 'Failed to add team member', details: error?.message }, { status: 500 })

  return Response.json({ member: data }, { status: 201 })
}
