'use client'

import { useEffect, useState, useCallback } from 'react'
import { Bell, CheckCheck, Package, Truck, DollarSign, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  is_read: boolean
  created_at: string
  reference_id?: string
  reference_type?: string
}

function NotifIcon({ type }: { type: string }) {
  if (type.startsWith('do_') || type.includes('delivery')) return <Truck size={16} className="text-blue-500" />
  if (type.includes('commission') || type.includes('payment')) return <DollarSign size={16} className="text-green-500" />
  if (type.includes('stock') || type.includes('restock')) return <Package size={16} className="text-amber-500" />
  if (type.includes('alert') || type.includes('low')) return <AlertTriangle size={16} className="text-red-500" />
  return <Info size={16} className="text-gray-400" />
}

export default function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/notifications?limit=50')
    if (res.ok) {
      const { notifications: data } = await res.json()
      setNotifications(data ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function markAllRead() {
    const unread = notifications.filter((n) => !n.is_read)
    if (unread.length === 0) return
    setMarking(true)
    const res = await fetch('/api/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: unread.map((n) => n.id), is_read: true }),
    })
    if (res.ok) {
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
      toast.success('All notifications marked as read')
    } else {
      toast.error('Failed to mark as read')
    }
    setMarking(false)
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A0A0A] flex items-center gap-2">
            <Bell size={22} />
            Notifications
          </h1>
          {unreadCount > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">{unreadCount} unread</p>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            disabled={marking}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <CheckCheck size={15} />
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
              <div className="h-3 bg-gray-200 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <Bell size={36} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No notifications yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={cn(
                'bg-white rounded-xl shadow-sm px-4 py-3.5 flex items-start gap-3 border-l-4 transition-colors',
                n.is_read ? 'border-transparent' : 'border-[#FFD700]'
              )}
            >
              <div className="mt-0.5 shrink-0">
                <NotifIcon type={n.type} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm', n.is_read ? 'text-gray-700' : 'font-semibold text-gray-900')}>
                  {n.title}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{n.message}</p>
                <p className="text-[10px] text-gray-400 mt-1">
                  {new Date(n.created_at).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}
                </p>
              </div>
              {!n.is_read && (
                <span className="w-2 h-2 bg-[#FFD700] rounded-full shrink-0 mt-1.5" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
