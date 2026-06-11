'use client'

import { useEffect, useState, useCallback } from 'react'
import { Bell, CheckCheck } from 'lucide-react'
import { timeAgo } from '@/lib/utils'
import type { Notification } from '@/types'

const TYPE_ICON: Record<string, string> = {
  do_dispatched: '🚚',
  do_delivered: '📦',
  low_stock_alert: '⚠️',
  restock_request: '🔄',
  commission_ready: '💰',
  commission_paid: '✅',
  performance_warning: '📉',
  new_store_added: '🏪',
  payment_receipt_submitted: '🧾',
  payment_receipt_confirmed: '✅',
  payment_receipt_rejected: '❌',
}

export default function StoreNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState(false)

  const loadNotifications = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/notifications?limit=50')
    if (res.ok) {
      const json = await res.json()
      setNotifications(json.notifications ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadNotifications()
  }, [loadNotifications])

  async function markAllRead() {
    const unread = notifications.filter((n) => !n.is_read)
    if (unread.length === 0) return
    setMarking(true)
    await fetch('/api/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: unread.map((n) => n.id), is_read: true }),
    })
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    setMarking(false)
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length

  if (loading) {
    return (
      <div className="px-4 py-5 space-y-3 max-w-lg mx-auto">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-200 rounded w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Notifications {unreadCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold">
              {unreadCount}
            </span>
          )}
        </h2>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            disabled={marking}
            className="flex items-center gap-1.5 text-xs text-[#0A0A0A] font-medium hover:underline disabled:opacity-50"
          >
            <CheckCheck size={14} />
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-16">
          <Bell size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No notifications yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`bg-white rounded-xl shadow-sm px-4 py-3.5 flex items-start gap-3 ${!n.is_read ? 'border-l-4 border-[#FFD700]' : ''}`}
            >
              <span className="text-xl mt-0.5 shrink-0">{TYPE_ICON[n.type] ?? '🔔'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#0A0A0A] leading-snug">{n.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.message}</p>
                <p className="text-[10px] text-gray-300 mt-1">{timeAgo(n.created_at)}</p>
              </div>
              {!n.is_read && (
                <span className="w-2 h-2 rounded-full bg-[#FFD700] mt-1.5 shrink-0" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
