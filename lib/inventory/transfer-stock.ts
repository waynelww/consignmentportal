import { createServiceClient } from '@/lib/supabase/server'

interface TransferParams {
  productId: string
  quantity: number // always positive — the caller decides direction via from/to
  fromLocationId: string | null // null = stock entering the tracked system from outside
  toLocationId: string | null   // null = stock leaving the tracked system entirely
  reason: string
  createdBy: string
}

/**
 * The single write path for all stock movement between locations
 * (Office, Central Market, IOI, Custom Printing, Events). Every call
 * updates location_stock for whichever side(s) are internal, then logs
 * one row to stock_transfers — the full "what moved from where to where,
 * why, and by whom" ledger this system is built around.
 */
export async function transferStock(params: TransferParams): Promise<{ success: true } | { error: string }> {
  if (params.quantity <= 0) return { error: 'Quantity must be positive' }
  if (!params.fromLocationId && !params.toLocationId) return { error: 'A transfer needs a source or a destination' }

  const svc = await createServiceClient()

  // Verify the source actually has enough BEFORE crediting the destination.
  // Without this check, transferring more than a location holds would floor
  // the source at 0 while still crediting the full amount elsewhere —
  // creating phantom stock out of nowhere, which defeats the entire point
  // of a ledger meant to be a trustworthy number.
  if (params.fromLocationId) {
    const { data: sourceStock } = await svc
      .from('location_stock')
      .select('quantity')
      .eq('location_id', params.fromLocationId)
      .eq('product_id', params.productId)
      .maybeSingle()
    const available = sourceStock?.quantity ?? 0
    if (available < params.quantity) {
      return { error: `Only ${available} available at the source location — cannot transfer ${params.quantity}` }
    }
  }

  async function adjustLocation(locationId: string, delta: number): Promise<string | null> {
    const { data: existing } = await svc
      .from('location_stock')
      .select('quantity')
      .eq('location_id', locationId)
      .eq('product_id', params.productId)
      .maybeSingle()

    const current = existing?.quantity ?? 0
    const next = Math.max(0, current + delta)

    const { error } = await svc
      .from('location_stock')
      .upsert({ location_id: locationId, product_id: params.productId, quantity: next, updated_at: new Date().toISOString() })

    return error ? error.message : null
  }

  if (params.fromLocationId) {
    const err = await adjustLocation(params.fromLocationId, -params.quantity)
    if (err) return { error: `Failed to update source location: ${err}` }
  }
  if (params.toLocationId) {
    const err = await adjustLocation(params.toLocationId, params.quantity)
    if (err) return { error: `Failed to update destination location: ${err}` }
  }

  const { error: logErr } = await svc.from('stock_transfers').insert({
    product_id: params.productId,
    quantity: params.quantity,
    from_location_id: params.fromLocationId,
    to_location_id: params.toLocationId,
    reason: params.reason,
    created_by: params.createdBy,
  })

  if (logErr) return { error: `Transfer applied but failed to log: ${logErr.message}` }

  return { success: true }
}

/** Resolves the id of a fixed (non-event) location by its seeded type. */
export async function getLocationIdByType(type: 'office' | 'retail' | 'printing', name?: string) {
  const svc = await createServiceClient()
  let query = svc.from('stock_locations').select('id').eq('type', type).eq('is_active', true)
  if (name) query = query.eq('name', name)
  const { data } = await query.limit(1).maybeSingle()
  return data?.id ?? null
}
