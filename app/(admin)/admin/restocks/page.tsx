'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, Bot } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatMYDate, cn } from '@/lib/utils'
import type { RestockRequest, RestockRequestItem, RestockRequestStatus, Product } from '@/types'
import { toast } from 'sonner'

type TabStatus = RestockRequestStatus | 'all'

const TABS: { label: string; value: TabStatus }[] = [
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Dispatched', value: 'dispatched' },
  { label: 'Received', value: 'received' },
  { label: 'All', value: 'all' },
]

interface RequestWithStore extends RestockRequest {
  store_name: string
  city: string
  total_pairs: number
  is_auto: boolean
}

interface ReviewItem extends RestockRequestItem {
  product: Product
  approved_qty: number
}

export default function RestocksPage() {
  const [requests, setRequests] = useState<RequestWithStore[]>([])
  const [counts, setCounts] = useState<Record<TabStatus, number>>({} as Record<TabStatus, number>)
  const [activeTab, setActiveTab] = useState<TabStatus>('pending')
  const [loading, setLoading] = useState(true)
  const [reviewRequest, setReviewRequest] = useState<RequestWithStore | null>(null)
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [adminNotes, setAdminNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const supabase = createClient()

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('restock_requests')
      .select('*, store:stores(store_name, city)')
      .order('created_at', { ascending: false })

    if (activeTab !== 'all') {
      query = query.eq('status', activeTab)
    }

    const { data } = await query

    const enriched: RequestWithStore[] = await Promise.all(
      (data || []).map(async (r: any) => {
        const { data: items } = await supabase
          .from('restock_request_items')
          .select('*')
          .eq('restock_request_id', r.id)
        const total = (items || []).reduce((a: number, i: any) => a + i.quantity_requested, 0)
        return {
          ...r,
          store_name: r.store?.store_name || '—',
          city: r.store?.city || '—',
          total_pairs: total,
          items: items || [],
          is_auto: !r.requested_by,
        }
      })
    )
    setRequests(enriched)

    // Get counts
    const { data: allData } = await supabase
      .from('restock_requests')
      .select('status')
    const c: Record<string, number> = { all: (allData || []).length }
    for (const r of allData || []) {
      c[r.status] = (c[r.status] || 0) + 1
    }
    setCounts(c as Record<TabStatus, number>)
    setLoading(false)
  }, [activeTab])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  async function openReview(req: RequestWithStore) {
    setReviewRequest(req)
    setAdminNotes(req.admin_notes || '')
    // Load items with product info
    const { data } = await supabase
      .from('restock_request_items')
      .select('*, product:products(*)')
      .eq('restock_request_id', req.id)
    setReviewItems(
      (data || []).map((item: any) => ({
        ...item,
        product: item.product,
        approved_qty: item.quantity_approved ?? item.quantity_requested,
      }))
    )
  }

  function updateApprovedQty(itemId: string, qty: number) {
    setReviewItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, approved_qty: Math.max(0, qty) } : i))
    )
  }

  async function handleApprove() {
    if (!reviewRequest) return
    setSubmitting(true)

    // Update each item's approved qty
    for (const item of reviewItems) {
      await supabase
        .from('restock_request_items')
        .update({ quantity_approved: item.approved_qty })
        .eq('id', item.id)
    }

    // Update request status + admin notes
    const { error } = await supabase
      .from('restock_requests')
      .update({
        status: 'approved',
        admin_notes: adminNotes,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', reviewRequest.id)

    setSubmitting(false)

    if (error) {
      toast.error('Failed to approve')
      return
    }

    // Try to generate DO
    try {
      await fetch('/api/delivery-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: reviewRequest.store_id,
          restock_request_id: reviewRequest.id,
          do_type: 'restock',
          items: reviewItems.map((i) => ({
            product_id: i.product_id,
            quantity: i.approved_qty,
          })),
          notes: adminNotes,
        }),
      })
    } catch {
      // DO generation is best-effort
    }

    toast.success('Restock approved and DO generated')
    setReviewRequest(null)
    fetchRequests()
  }

  async function handleReject() {
    if (!reviewRequest) return
    const confirmed = window.confirm('Reject this restock request?')
    if (!confirmed) return

    const { error } = await supabase
      .from('restock_requests')
      .update({
        status: 'rejected',
        admin_notes: adminNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reviewRequest.id)

    if (error) toast.error('Failed to reject')
    else {
      toast.success('Request rejected')
      setReviewRequest(null)
      fetchRequests()
    }
  }

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex overflow-x-auto border-b border-gray-100 px-4">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                'px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-2',
                activeTab === tab.value
                  ? 'border-[#FFD700] text-[#0A0A0A]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {tab.label}
              {counts[tab.value] != null && (
                <span className={cn(
                  'px-1.5 py-0.5 rounded-full text-xs font-semibold',
                  activeTab === tab.value ? 'bg-[#FFD700]/20 text-[#0A0A0A]' : 'bg-gray-100 text-gray-500'
                )}>
                  {counts[tab.value] || 0}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Request Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Store</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">City</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Total Pairs</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Notes</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-100 animate-pulse rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                : requests.map((req) => (
                    <tr key={req.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-gray-600 text-xs">{formatMYDate(req.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-gray-800">{req.store_name}</span>
                          {req.is_auto && (
                            <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-semibold">
                              <Bot size={10} />
                              AUTO
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{req.city}</td>
                      <td className="px-4 py-3 text-right font-semibold">{req.total_pairs}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[180px] truncate">
                        {req.notes || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'px-2.5 py-0.5 rounded-full text-xs font-medium capitalize',
                          req.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                          req.status === 'approved' ? 'bg-blue-100 text-blue-700' :
                          req.status === 'dispatched' ? 'bg-cyan-100 text-cyan-700' :
                          req.status === 'received' ? 'bg-green-100 text-green-700' :
                          'bg-red-100 text-red-700'
                        )}>
                          {req.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {(req.status === 'pending' || req.status === 'approved') && (
                          <button
                            onClick={() => openReview(req)}
                            className="text-xs px-3 py-1.5 bg-[#0A0A0A] text-white rounded-lg hover:bg-gray-800 transition-colors"
                          >
                            Review
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              {!loading && requests.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">
                    No {activeTab === 'all' ? '' : activeTab} requests
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review Modal */}
      {reviewRequest && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Review Restock Request</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {reviewRequest.store_name} · {reviewRequest.city}
                </p>
              </div>
              <button onClick={() => setReviewRequest(null)}>
                <X size={18} className="text-gray-400 hover:text-gray-600" />
              </button>
            </div>

            {/* Store info */}
            <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm">
              <div className="flex gap-4 flex-wrap">
                <div>
                  <p className="text-xs text-gray-500">Requested</p>
                  <p className="font-medium">{formatMYDate(reviewRequest.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total Pairs</p>
                  <p className="font-semibold">{reviewRequest.total_pairs}</p>
                </div>
                {reviewRequest.is_auto && (
                  <div>
                    <span className="flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded-lg text-xs font-semibold">
                      <Bot size={12} />
                      AUTO-GENERATED
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Items */}
            <div className="mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 text-xs font-semibold text-gray-500">Product</th>
                    <th className="text-right py-2 text-xs font-semibold text-gray-500">Requested</th>
                    <th className="text-right py-2 text-xs font-semibold text-gray-500">Approved Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewItems.map((item) => (
                    <tr key={item.id} className="border-b border-gray-50">
                      <td className="py-2.5 text-gray-800">
                        {item.product?.name || '—'}
                        <span className="ml-1 text-xs font-mono text-gray-400">
                          {item.product?.sku}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-gray-500">{item.quantity_requested}</td>
                      <td className="py-2.5 text-right">
                        <input
                          type="number"
                          min={0}
                          value={item.approved_qty}
                          onChange={(e) => updateApprovedQty(item.id, Number(e.target.value))}
                          className="w-20 px-2 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] text-right"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-gray-500 mt-2">
                Total approved: <strong>{reviewItems.reduce((a, i) => a + i.approved_qty, 0)}</strong> pairs
              </p>
            </div>

            {/* Admin notes */}
            <div className="mb-5">
              <label className="text-xs font-medium text-gray-600 block mb-1">Admin Notes</label>
              <textarea
                rows={3}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none"
                placeholder="Optional notes for the store owner..."
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleReject}
                className="flex-1 py-2.5 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 transition-colors"
              >
                Reject
              </button>
              <button
                onClick={handleApprove}
                disabled={submitting}
                className="flex-1 py-2.5 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Processing...' : 'Approve & Generate DO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
