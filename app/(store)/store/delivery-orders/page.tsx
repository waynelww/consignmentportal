'use client'

import { useEffect, useState, useCallback } from 'react'
import { Truck, CheckCircle, Clock, Package, ChevronDown, ChevronUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatMYDate, cn } from '@/lib/utils'
import type { DeliveryOrder, DeliveryOrderItem, Product } from '@/types'
import { toast } from 'sonner'
import { useStore } from '@/components/store/StoreContext'

interface DOItem extends DeliveryOrderItem {
  product: Product
}

interface DOWithItems extends Omit<DeliveryOrder, 'store'> {
  items?: DOItem[]
  store?: { store_name: string; store_code: string }
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:        { label: 'Draft',        color: 'bg-gray-100 text-gray-600' },
  confirmed:    { label: 'Incoming',     color: 'bg-blue-100 text-blue-700' },
  dispatched:   { label: 'On the Way',   color: 'bg-cyan-100 text-cyan-700' },
  delivered:    { label: 'Waiting to Receive', color: 'bg-yellow-100 text-yellow-700' },
  acknowledged: { label: 'Shop Received',      color: 'bg-green-100 text-green-700' },
}

export default function StoreDeliveryOrdersPage() {
  const { storeId } = useStore()
  const [orders, setOrders] = useState<DOWithItems[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [acknowledging, setAcknowledging] = useState<string | null>(null)

  const loadOrders = useCallback(async () => {
    if (!storeId) return
    setLoading(true)
    const supabase = createClient()

    // storeId from context — no auth waterfall needed
    const { data } = await supabase
      .from('delivery_orders')
      .select(`
        *,
        items:delivery_order_items(*, product:products(*))
      `)
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(50)

    setOrders((data as DOWithItems[]) ?? [])
    setLoading(false)
  }, [storeId])

  useEffect(() => {
    loadOrders()
  }, [loadOrders])

  async function acceptDO(doId: string, doNumber: string) {
    setAcknowledging(doId)
    try {
      const res = await fetch(`/api/delivery-orders/${doId}/acknowledge`, { method: 'POST' })
      let json: { error?: string; details?: unknown; success?: boolean } = {}
      try { json = await res.json() } catch { /* non-JSON response */ }
      if (!res.ok) {
        const msg = json.error ?? `Error ${res.status}`
        toast.error(msg, { duration: 6000 })
      } else {
        toast.success(`${doNumber} received! Stock has been added to your inventory.`, { duration: 5000 })
        loadOrders()
      }
    } catch (e) {
      toast.error(`Network error: ${e instanceof Error ? e.message : 'Unknown'}`, { duration: 6000 })
    } finally {
      setAcknowledging(null)
    }
  }

  const pending = orders.filter((o) => ['confirmed', 'dispatched', 'delivered'].includes(o.status))
  const history = orders.filter((o) => o.status === 'acknowledged')

  if (loading) {
    return (
      <div className="px-4 py-5 space-y-3 max-w-lg mx-auto">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
            <div className="h-3 bg-gray-200 rounded w-1/3" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="px-4 py-5 space-y-6 max-w-lg mx-auto">
      {/* Pending/incoming DOs */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Incoming Deliveries {pending.length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">
              {pending.length}
            </span>
          )}
        </h2>

        {pending.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center">
            <Truck size={32} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No incoming deliveries</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((order) => {
              const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.confirmed
              const isExpanded = expanded === order.id
              const canAccept = ['confirmed', 'dispatched', 'delivered'].includes(order.status)

              return (
                <div key={order.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <button
                    className="w-full px-4 py-4 flex items-start justify-between text-left"
                    onClick={() => setExpanded(isExpanded ? null : order.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs font-semibold text-gray-700">{order.do_number}</span>
                        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold', cfg.color)}>
                          {cfg.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {order.total_pairs} pairs · {formatMYDate(order.created_at)}
                        {order.courier && ` · ${order.courier}`}
                        {order.tracking_number && ` · ${order.tracking_number}`}
                      </p>
                      {order.notes && (
                        <p className="text-xs text-gray-500 mt-1 italic">{order.notes}</p>
                      )}
                    </div>
                    {isExpanded ? (
                      <ChevronUp size={16} className="text-gray-400 mt-0.5 ml-2 shrink-0" />
                    ) : (
                      <ChevronDown size={16} className="text-gray-400 mt-0.5 ml-2 shrink-0" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-gray-100 px-4 pb-4">
                      {/* Items list — thumbnail helps owner spot colour at a glance */}
                      <div className="py-3 space-y-2">
                        {(order.items ?? []).map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-3 min-w-0">
                              {item.product?.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={item.product.image_url}
                                  alt={item.product.name ?? item.product.sku ?? ''}
                                  loading="lazy"
                                  className="w-12 h-12 rounded-lg object-cover bg-gray-50 border border-gray-100 shrink-0"
                                />
                              ) : (
                                <div className="w-12 h-12 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0">
                                  <Package size={18} className="text-gray-300" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="text-sm text-gray-800 truncate">{item.product?.name}</p>
                                <p className="text-xs font-mono text-gray-400">{item.product?.sku}</p>
                              </div>
                            </div>
                            <span className="text-sm font-semibold text-[#0A0A0A] shrink-0">× {item.quantity}</span>
                          </div>
                        ))}
                      </div>

                      {canAccept && (
                        <button
                          onClick={() => acceptDO(order.id, order.do_number)}
                          disabled={acknowledging === order.id}
                          className="w-full mt-1 py-3 bg-[#0A0A0A] text-[#FFD700] rounded-xl font-semibold text-sm hover:bg-gray-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                        >
                          {acknowledging === order.id ? (
                            <>
                              <span className="animate-spin h-4 w-4 border-2 border-[#FFD700] border-t-transparent rounded-full" />
                              Confirming…
                            </>
                          ) : (
                            <>
                              <CheckCircle size={16} />
                              Receive Stock
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Received history */}
      {history.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Previously Received
          </h2>
          <div className="space-y-2">
            {history.map((order) => (
              <div key={order.id} className="bg-white rounded-xl shadow-sm px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800 font-mono">{order.do_number}</p>
                  <p className="text-xs text-gray-400">
                    {order.total_pairs} pairs · {order.delivery_date ? formatMYDate(order.delivery_date) : formatMYDate(order.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-green-600">
                  <CheckCircle size={14} />
                  <span className="text-xs font-medium">Received</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {orders.length === 0 && (
        <div className="text-center py-16">
          <Clock size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No delivery orders yet</p>
          <p className="text-xs text-gray-300 mt-1">Your admin will send stock here</p>
        </div>
      )}
    </div>
  )
}
