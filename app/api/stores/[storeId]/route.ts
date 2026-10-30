import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { DAILY_REPORT_MAX_RECIPIENTS, normalizeRecipients, validateDailyReportSettings } from '@/lib/daily-report/settings'

const UpdateStoreSchema = z.object({
  store_name: z.string().min(1).optional(),
  pic_name: z.string().min(1).optional(),
  pic_phone: z.string().min(1).optional(),
  email: z.string().email().optional(),
  address: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  postcode: z.string().min(1).optional(),
  store_type: z.string().min(1).optional(),
  bank_name: z.string().optional(),
  bank_account_number: z.string().optional(),
  bank_account_name: z.string().optional(),
  commission_rate: z.number().min(0).max(100).optional(),
  status: z.enum(['active', 'inactive', 'suspended', 'pending']).optional(),
  is_test: z.boolean().optional(),
  daily_report_enabled: z.boolean().optional(),
  daily_report_recipients: z.array(z.string().trim().toLowerCase().email()).max(DAILY_REPORT_MAX_RECIPIENTS).optional(),
  notes: z.string().optional(),
  agreement_signed_at: z.string().optional(),
  agreement_signed_by: z.string().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const { storeId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })
  if (profile.role !== 'super_admin' && profile.role !== 'ops_manager') {
    return Response.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateStoreSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  if (Object.keys(parsed.data).length === 0) {
    return Response.json({ error: 'No fields provided for update' }, { status: 400 })
  }

  const update: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.daily_report_enabled !== undefined || parsed.data.daily_report_recipients !== undefined) {
    // Check the switch and recipients as they will be after this save, not just the fields sent.
    const { data: current } = await supabase
      .from('stores')
      .select('daily_report_enabled, daily_report_recipients')
      .eq('id', storeId)
      .maybeSingle()
    if (!current) return Response.json({ error: 'Store not found' }, { status: 404 })

    const enabled = parsed.data.daily_report_enabled ?? current.daily_report_enabled
    const recipients = normalizeRecipients(parsed.data.daily_report_recipients ?? current.daily_report_recipients)
    const dailyReportError = validateDailyReportSettings(enabled, recipients)
    if (dailyReportError) return Response.json({ error: dailyReportError }, { status: 400 })
    update.daily_report_recipients = recipients
  }

  const { data: updated, error: updateErr } = await supabase
    .from('stores')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', storeId)
    .select()
    .single()

  if (updateErr) {
    return Response.json({ error: 'Failed to update store', details: updateErr.message }, { status: 500 })
  }

  if (!updated) {
    return Response.json({ error: 'Store not found' }, { status: 404 })
  }

  return Response.json({ store: updated })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const { storeId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })

  if (profile.role === 'store_owner' && profile.store_id !== storeId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: store, error } = await supabase
    .from('stores')
    .select('*')
    .eq('id', storeId)
    .single()

  if (error || !store) {
    return Response.json({ error: 'Store not found' }, { status: 404 })
  }

  return Response.json({ store })
}
