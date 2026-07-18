import { createServiceClient } from '@/lib/supabase/server'

export type WarehouseMovementReason = 'manual' | 'event_checkout' | 'event_return'

interface AdjustParams {
  productId: string
  delta: number
  reason: string
  referenceType: WarehouseMovementReason
  referenceId?: string | null
  createdBy: string
}

interface AdjustResult {
  quantityBefore: number
  quantityAfter: number
}

/**
 * The single write path for office stock. Every call is logged to
 * warehouse_stock_movements — this is the audit trail that makes the
 * office stock number accountable (who changed it, by how much, why).
 * Quantity is floored at 0 (can't go negative); the logged delta reflects
 * whatever was actually applied after that floor, not the requested delta.
 */
export async function adjustWarehouseStock(params: AdjustParams): Promise<AdjustResult | { error: string }> {
  const svc = await createServiceClient()

  const { data: existing } = await svc
    .from('warehouse_stock')
    .select('quantity')
    .eq('product_id', params.productId)
    .maybeSingle()

  const quantityBefore = existing?.quantity ?? 0
  const quantityAfter = Math.max(0, quantityBefore + params.delta)

  const { error: upsertErr } = await svc
    .from('warehouse_stock')
    .upsert({ product_id: params.productId, quantity: quantityAfter, updated_at: new Date().toISOString() })

  if (upsertErr) return { error: `Failed to update office stock: ${upsertErr.message}` }

  const { error: logErr } = await svc.from('warehouse_stock_movements').insert({
    product_id: params.productId,
    delta: quantityAfter - quantityBefore,
    quantity_before: quantityBefore,
    quantity_after: quantityAfter,
    reason: params.reason,
    reference_type: params.referenceType,
    reference_id: params.referenceId ?? null,
    created_by: params.createdBy,
  })

  if (logErr) return { error: `Stock was updated but the audit log entry failed to save: ${logErr.message}` }

  return { quantityBefore, quantityAfter }
}
