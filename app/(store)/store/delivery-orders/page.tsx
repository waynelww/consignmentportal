'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Truck, CheckCircle, Clock, Package, ChevronDown, ChevronUp, FileText, PenLine, Eraser } from 'lucide-react'
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

function SignatureModal({ doNumber, saving, onCancel, onSave }: {
  doNumber: string
  saving: boolean
  onCancel: () => void
  onSave: (dataUrl: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [hasInk, setHasInk] = useState(false)

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    // Guard against a 0x0 read if this ever runs before layout settles
    // (e.g. a modal-open transition) — retry on the next frame instead
    // of leaving the canvas with no backing store, which would make
    // every draw call silently do nothing.
    if (rect.width === 0 || rect.height === 0) {
      requestAnimationFrame(setupCanvas)
      return
    }
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1a1a2e'
  }, [])

  useEffect(() => {
    setupCanvas()
    // A laptop/desktop window can be resized while the modal is open —
    // a mobile viewport never triggers this, which is why it went unnoticed.
    window.addEventListener('resize', setupCanvas)
    return () => window.removeEventListener('resize', setupCanvas)
  }, [setupCanvas])

  function posFromClient(e: { clientX: number; clientY: number }, target: HTMLElement) {
    const rect = target.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function startDrawing(target: HTMLCanvasElement, p: { x: number; y: number }) {
    drawing.current = true
    last.current = p
  }

  function drawTo(target: HTMLCanvasElement, p: { x: number; y: number }) {
    if (!drawing.current || !last.current) return
    const ctx = target.getContext('2d')!
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    if (!hasInk) setHasInk(true)
  }

  function stopDrawing() {
    drawing.current = false
    last.current = null
  }

  // Pointer Events cover mouse, touch, and pen in every evergreen browser,
  // but setPointerCapture has real-world quirks on some desktop WebKit
  // builds — if it throws, the exception happens before drawing.current
  // is ever set to true, so nothing draws and nothing looks wrong to the
  // user. Wrapping it means a capture failure degrades gracefully instead
  // of silently killing the whole interaction.
  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* degrade gracefully, see comment above */ }
    startDrawing(e.currentTarget, posFromClient(e, e.currentTarget))
  }
  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    drawTo(e.currentTarget, posFromClient(e, e.currentTarget))
  }

  // Mouse fallback — only does anything in the (now rare, but nonzero)
  // case that PointerEvent isn't available at all, so it can never
  // double-draw alongside the pointer handlers above.
  const hasPointerEvents = typeof window !== 'undefined' && 'PointerEvent' in window
  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (hasPointerEvents) return
    startDrawing(e.currentTarget, posFromClient(e, e.currentTarget))
  }
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (hasPointerEvents) return
    drawTo(e.currentTarget, posFromClient(e, e.currentTarget))
  }

  function clear() {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    canvas.getContext('2d')!.clearRect(0, 0, rect.width, rect.height)
    setHasInk(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Sign for {doNumber}</h3>
        <p className="text-xs text-gray-400 mb-3">Draw your signature below — finger, mouse, or trackpad all work.</p>

        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          className="w-full h-44 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 cursor-crosshair"
          style={{ touchAction: 'none' }}
        />

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={clear}
            disabled={saving}
            className="px-4 py-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-50"
          >
            <Eraser size={14} />
            Clear
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const canvas = canvasRef.current
              if (canvas) onSave(canvas.toDataURL('image/png'))
            }}
            disabled={!hasInk || saving}
            className="flex-1 py-3 bg-[#0A0A0A] text-[#FFD700] rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <span className="animate-spin h-4 w-4 border-2 border-[#FFD700] border-t-transparent rounded-full" />
                Saving…
              </>
            ) : (
              <>
                <PenLine size={15} />
                Save Signature
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
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
  const [signingDO, setSigningDO] = useState<DOWithItems | null>(null)
  const [sigSaving, setSigSaving] = useState(false)

  async function saveSignature(dataUrl: string) {
    if (!signingDO) return
    setSigSaving(true)
    try {
      const res = await fetch(`/api/delivery-orders/${signingDO.id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: dataUrl }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? 'Failed to save signature', { duration: 6000 })
        return
      }
      toast.success(`${signingDO.do_number} signed! The signed document is now available to you and Xocks.`, { duration: 5000 })
      setSigningDO(null)
      loadOrders()
    } catch (e) {
      toast.error(`Network error: ${e instanceof Error ? e.message : 'Unknown'}`, { duration: 6000 })
    } finally {
      setSigSaving(false)
    }
  }

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

                      <a
                        href={`/api/delivery-orders/${order.id}/pdf?inline`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full mt-2 py-3 border border-gray-200 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                      >
                        <FileText size={16} />
                        View DO Document (PDF)
                      </a>
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
            {history.map((order) => {
              const isExpanded = expanded === order.id
              return (
                <div key={order.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <button
                    className="w-full px-4 py-3 flex items-center justify-between text-left"
                    onClick={() => setExpanded(isExpanded ? null : order.id)}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800 font-mono">{order.do_number}</p>
                      <p className="text-xs text-gray-400">
                        {order.total_pairs} pairs · {order.delivery_date ? formatMYDate(order.delivery_date) : formatMYDate(order.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1.5 text-green-600">
                        <CheckCircle size={14} />
                        <span className="text-xs font-medium">Received</span>
                      </div>
                      {isExpanded ? (
                        <ChevronUp size={16} className="text-gray-400" />
                      ) : (
                        <ChevronDown size={16} className="text-gray-400" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-gray-100 px-4 pb-4">
                      {(order.courier || order.tracking_number) && (
                        <p className="text-xs text-gray-400 pt-3">
                          {order.courier && `Courier: ${order.courier}`}
                          {order.courier && order.tracking_number && ' · '}
                          {order.tracking_number && `Tracking: ${order.tracking_number}`}
                        </p>
                      )}

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

                      {order.pdf_url ? (
                        <a
                          href={`/api/delivery-orders/${order.id}/pdf?inline`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full py-3 bg-green-50 border border-green-200 text-green-700 rounded-xl font-semibold text-sm hover:bg-green-100 transition-colors flex items-center justify-center gap-2"
                        >
                          <FileText size={16} />
                          View Signed DO (PDF)
                        </a>
                      ) : (
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={() => setSigningDO(order)}
                            className="w-full py-3 bg-[#0A0A0A] text-[#FFD700] rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
                          >
                            <PenLine size={16} />
                            Sign &amp; Save
                          </button>
                          <a
                            href={`/api/delivery-orders/${order.id}/pdf?inline`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full py-3 border border-gray-200 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                          >
                            <FileText size={16} />
                            View DO Document (PDF)
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
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

      {signingDO && (
        <SignatureModal
          doNumber={signingDO.do_number}
          saving={sigSaving}
          onCancel={() => setSigningDO(null)}
          onSave={saveSignature}
        />
      )}
    </div>
  )
}
