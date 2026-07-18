'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Plus, X, CalendarDays, MapPin, Package2 } from 'lucide-react'
import { cn, formatMYDate } from '@/lib/utils'
import { toast } from 'sonner'

interface ShopifyLocation { id: string; name: string }
interface EventRow {
  id: string
  name: string
  location: string | null
  shopify_location_name: string | null
  start_date: string
  end_date: string | null
  status: 'active' | 'closed'
  sku_count: number
  total_taken: number
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'active' | 'closed' | 'all'>('active')

  const [createModal, setCreateModal] = useState(false)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [notes, setNotes] = useState('')
  const [shopifyLocations, setShopifyLocations] = useState<ShopifyLocation[]>([])
  const [shopifyLocationId, setShopifyLocationId] = useState('')
  const [loadingLocations, setLoadingLocations] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/events')
    const body = await res.json().catch(() => ({}))
    if (res.ok) setEvents(body.events ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  function openCreate() {
    setCreateModal(true)
    setName(''); setLocation(''); setStartDate(''); setEndDate(''); setNotes(''); setShopifyLocationId('')
    setLoadingLocations(true)
    fetch('/api/shopify/locations')
      .then((r) => r.json())
      .then((body) => setShopifyLocations(body.locations ?? []))
      .catch(() => toast.error('Could not load Shopify locations — you can still create the event without one'))
      .finally(() => setLoadingLocations(false))
  }

  async function createEvent() {
    if (!name.trim() || !startDate) { toast.error('Name and start date are required'); return }
    setSubmitting(true)
    try {
      const chosenLocation = shopifyLocations.find((l) => l.id === shopifyLocationId)
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          location: location.trim() || null,
          shopify_location_id: chosenLocation?.id ?? null,
          shopify_location_name: chosenLocation?.name ?? null,
          start_date: startDate,
          end_date: endDate || null,
          notes: notes.trim() || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body.error ?? 'Failed to create event'); return }
      toast.success('Event created')
      setCreateModal(false)
      fetchEvents()
    } finally {
      setSubmitting(false)
    }
  }

  const filtered = events.filter((e) => tab === 'all' ? true : e.status === tab)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Track stock checked out to pop-ups, roadshows, and one-off events — separate from the consignment store network.</p>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 transition-colors shrink-0">
          <Plus size={16} /> New Event
        </button>
      </div>

      <div className="flex gap-2">
        {(['active', 'closed', 'all'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize',
              tab === t ? 'bg-[#0A0A0A] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}>
            {t}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 bg-gray-100 animate-pulse rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <CalendarDays size={32} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm">No {tab !== 'all' ? tab : ''} events</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map((e) => (
              <Link key={e.id} href={`/admin/events/${e.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">{e.name}</p>
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase',
                      e.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                    )}>
                      {e.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    <span>{formatMYDate(e.start_date)}{e.end_date ? ` – ${formatMYDate(e.end_date)}` : ''}</span>
                    {e.location && (
                      <span className="flex items-center gap-1"><MapPin size={11} /> {e.location}</span>
                    )}
                    {e.shopify_location_name && (
                      <span className="text-green-600">Shopify: {e.shopify_location_name}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-gray-600">
                  <Package2 size={14} className="text-gray-400" />
                  {e.sku_count} SKUs · {e.total_taken} pairs
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {createModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-gray-900">New Event</h3>
              <button onClick={() => setCreateModal(false)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Event Name *</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Pop-up @ KLCC Atrium"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Venue / Location</label>
                <input type="text" value={location} onChange={(e) => setLocation(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Start Date *</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">End Date</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Shopify POS Location <span className="text-gray-400 font-normal">(for automatic sold-vs-returned tally)</span>
                </label>
                <select value={shopifyLocationId} onChange={(e) => setShopifyLocationId(e.target.value)} disabled={loadingLocations}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] disabled:opacity-50">
                  <option value="">{loadingLocations ? 'Loading…' : 'None — I\'ll enter sold quantities manually'}</option>
                  {shopifyLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Notes</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setCreateModal(false)} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={createEvent} disabled={submitting}
                className="flex-1 py-2.5 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50 transition-colors">
                {submitting ? 'Creating...' : 'Create Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
