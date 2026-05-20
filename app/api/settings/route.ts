import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { z } from 'zod'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase.from('settings').select('*').order('key')
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data || [])
}

const updateSchema = z.object({
  updates: z.array(z.object({ key: z.string(), value: z.string() })).min(1),
})

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['super_admin', 'ops_manager'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 })

  const { updates } = parsed.data
  const upserts = updates.map(u => ({ key: u.key, value: u.value, updated_at: new Date().toISOString() }))

  const { error } = await supabase.from('settings').upsert(upserts, { onConflict: 'key' })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ success: true })
}
