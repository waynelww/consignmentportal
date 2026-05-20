import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const GenerateSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
})

function calcCommission(totalAmount: number, commissionRate: number) {
  const commission = Number((totalAmount * commissionRate / 100).toFixed(2))
  return { commission_amount: commission, xocks_revenue: Number((totalAmount - commission).toFixed(2)) }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, store_id')
    .eq('id', user.id)
    .single()

  if (!profile) return Response.json({ error: 'Profile not found' }, { status: 403 })
  if (profile.role !== 'super_admin') {
    return Response.json({ error: 'Forbidden: super_admin only' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = GenerateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Validation error', details: parsed.error.flatten() }, { status: 400 })
  }

  const { month, year } = parsed.data

  // Fetch all active stores
  const { data: stores, error: storesErr } = await supabase
    .from('stores')
    .select('id, commission_rate')
    .eq('status', 'active')

  if (storesErr || !stores) {
    return Response.json({ error: 'Failed to fetch stores', details: storesErr?.message }, { status: 500 })
  }

  // Date range for the month
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  let generatedCount = 0

  for (const store of stores) {
    // Query sales for this store in the period
    const { data: sales, error: salesErr } = await supabase
      .from('sales')
      .select('quantity, total_amount, commission_amount, xocks_revenue')
      .eq('store_id', store.id)
      .gte('sale_date', startDate)
      .lte('sale_date', endDate)

    if (salesErr) continue

    const total_units_sold = (sales ?? []).reduce((sum, s) => sum + s.quantity, 0)
    const total_revenue = Number((sales ?? []).reduce((sum, s) => sum + s.total_amount, 0).toFixed(2))

    // Recalculate commission from total_revenue using store rate
    const { commission_amount, xocks_revenue } = calcCommission(total_revenue, store.commission_rate)

    // UPSERT commission_period
    const { data: period, error: upsertErr } = await supabase
      .from('commission_periods')
      .upsert({
        store_id: store.id,
        period_month: month,
        period_year: year,
        total_units_sold,
        total_revenue,
        commission_amount,
        xocks_revenue,
        status: 'pending',
      }, {
        onConflict: 'store_id,period_month,period_year',
        ignoreDuplicates: false,
      })
      .select('id')
      .single()

    if (upsertErr || !period) continue

    generatedCount++

    // Notify store
    await supabase.from('notifications').insert({
      recipient_role: null,
      recipient_store_id: store.id,
      type: 'commission_ready',
      title: 'Commission Statement Ready',
      message: `Your commission statement for ${month}/${year} is ready. Total: RM${commission_amount.toFixed(2)}`,
      reference_id: period.id,
      reference_type: 'commission_period',
      is_read: false,
    })
  }

  return Response.json({ success: true, generated: generatedCount })
}
