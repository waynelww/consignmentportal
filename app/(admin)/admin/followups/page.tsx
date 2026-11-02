'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, MessageSquare, Plus } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { useXocksTeam } from '@/components/admin/useXocksTeam'
import { callOnboardingApi } from '@/components/onboarding/api'
import { AddStoreDialog } from '@/components/followups/AddStoreDialog'
import { CellDialog } from '@/components/followups/CellDialog'
import { saveFollowupEntry } from '@/components/followups/save'
import {
  FOLLOWUP_ITEMS, FOLLOWUP_ITEM_LABELS, stillToFollowUp,
  type CellView, type FollowupItem, type FollowupMonthView, type RowView,
} from '@/lib/followups/build'
import { previousMonthOf } from '@/lib/monthly-report/months'
import { todayMYT } from '@/lib/onboarding/steps'
import { cn, formatMYDate } from '@/lib/utils'

// Shared with the Onboarding board, so "Working as" is the same name on both.
const WORKING_AS_KEY = 'xcms.onboarding.workingAs'

function defaultMonth(): string {
  return previousMonthOf(todayMYT(new Date()))
}

export default function FollowupsPage() {
  const { members } = useXocksTeam()

  const [month, setMonth] = useState(defaultMonth)
  const [view, setView] = useState<FollowupMonthView | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'todo'>('all')
  const [workingAs, setWorkingAs] = useState('')
  const [open, setOpen] = useState<{ row: RowView; item: FollowupItem } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [busyRowId, setBusyRowId] = useState<string | null>(null)

  useEffect(() => {
    try {
      setWorkingAs(localStorage.getItem(WORKING_AS_KEY) ?? '')
    } catch {
      // Storage can be blocked; the picker still works for this visit.
    }
  }, [])

  function pickWorkingAs(id: string) {
    setWorkingAs(id)
    try {
      localStorage.setItem(WORKING_AS_KEY, id)
    } catch {
      // Ignore: the choice just is not remembered.
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await callOnboardingApi<FollowupMonthView>(`/api/followups?month=${month}`)
      setView(data)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load follow-ups')
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    load()
  }, [load])

  const rows = view ? (filter === 'todo' ? stillToFollowUp(view.rows) : view.rows) : []
  const openRow = open && view ? view.rows.find((r) => r.key === open.row.key) ?? null : null

  async function tick(row: RowView, item: FollowupItem, ticked: boolean) {
    if (!workingAs) { toast.error('Pick who you are under "Working as" first'); return }
    try {
      await saveFollowupEntry({ month, row, item, byMemberId: workingAs, ticked })
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    }
  }

  async function setStoreActive(id: string, active: boolean) {
    if (!workingAs) { toast.error('Pick who you are under "Working as" first'); return }
    setBusyRowId(id)
    try {
      await callOnboardingApi(`/api/followups/extra-stores/${id}`, 'PATCH', { active, by_member_id: workingAs })
      toast.success(active ? 'Store restored' : 'Store hidden. Its past ticks are kept.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update store')
    } finally {
      setBusyRowId(null)
    }
  }

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Follow-ups"
        description="Monthly checklist of consignment follow-ups. XCMS boxes fill in by themselves; every tick and note is recorded with who did it and when."
        actions={
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-[#0A0A0A] text-[#FFD700]"
          >
            <Plus className="h-4 w-4" /> Add store
          </button>
        }
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Month
          <input
            type="month"
            value={month}
            onChange={(e) => { if (e.target.value) setMonth(e.target.value) }}
            className="px-2 py-2 text-sm border border-gray-200 rounded-lg bg-white"
          />
        </label>
        <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden text-sm">
          {([['all', 'All stores'], ['todo', 'Still to follow up']] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={cn('px-3 py-2', filter === value ? 'bg-[#0A0A0A] text-[#FFD700]' : 'text-gray-600 hover:bg-gray-50')}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
          Working as
          <select
            value={workingAs}
            onChange={(e) => pickWorkingAs(e.target.value)}
            className="px-2 py-2 text-sm border border-gray-200 rounded-lg bg-white"
          >
            <option value="">Choose…</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      </div>
      {!workingAs && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          Pick who you are under &ldquo;Working as&rdquo;. Every tick, untick and note is recorded against that name.
        </p>
      )}

      {/* Outstanding count per column */}
      {view && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {FOLLOWUP_ITEMS.map((item) => {
            const n = view.outstanding[item]
            return (
              <div key={item} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
                <p className="text-xs text-gray-500">{FOLLOWUP_ITEM_LABELS[item]}</p>
                <p className={cn('text-xl font-semibold', n > 0 ? 'text-red-600' : 'text-emerald-600')}>
                  {n > 0 ? `${n} to follow up` : 'All done'}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {loadError && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{loadError}</p>
      )}

      {loading && !view ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : view && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Store</th>
                {FOLLOWUP_ITEMS.map((item) => (
                  <th key={item} className="text-left px-4 py-3 font-medium">{FOLLOWUP_ITEM_LABELS[item]}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    {filter === 'todo' ? 'Nothing left to follow up for this month.' : 'No stores on the checklist.'}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.key} className="align-top">
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">
                          {row.name}
                          {row.kind === 'extra' && (
                            <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-bold tracking-wide align-middle">EXTRA</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">
                          {row.store_code && <span className="font-mono mr-2">{row.store_code}</span>}
                          {row.pic_name}{row.pic_phone && ` · ${row.pic_phone}`}
                        </p>
                        {row.kind === 'extra' && (
                          <button
                            onClick={() => setStoreActive(row.id, false)}
                            disabled={busyRowId === row.id}
                            className="mt-1 text-xs text-gray-500 hover:text-gray-900 underline disabled:opacity-50"
                          >
                            Hide from checklist
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                  {FOLLOWUP_ITEMS.map((item) => (
                    <td key={item} className={cn('px-4 py-3', cellTone(row.cells[item]))}>
                      <CellCell
                        cell={row.cells[item]}
                        canTick={!!workingAs}
                        onTick={(ticked) => tick(row, item, ticked)}
                        onOpen={() => setOpen({ row, item })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view && view.hidden.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-medium text-gray-700 mb-2">Hidden extra stores</h2>
          <ul className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-100 text-sm">
            {view.hidden.map((h) => (
              <li key={h.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-gray-700">{h.name}{h.pic_name && <span className="text-gray-400"> · {h.pic_name}</span>}</span>
                <button
                  onClick={() => setStoreActive(h.id, true)}
                  disabled={busyRowId === h.id}
                  className="text-xs font-medium text-gray-700 hover:text-gray-900 underline disabled:opacity-50"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-400 mt-2">Hidden stores keep every past tick and note.</p>
        </section>
      )}

      {openRow && open && (
        <CellDialog
          row={openRow}
          item={open.item}
          month={month}
          workingAs={workingAs}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      )}
      {addOpen && (
        <AddStoreDialog workingAs={workingAs} onClose={() => setAddOpen(false)} onAdded={load} />
      )}
    </div>
  )
}

function cellTone(cell: CellView): string {
  return cell.done ? 'bg-emerald-50/60' : 'bg-red-50'
}

function CellCell({
  cell,
  canTick,
  onTick,
  onOpen,
}: {
  cell: CellView
  canTick: boolean
  onTick: (ticked: boolean) => void
  onOpen: () => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {cell.auto ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold',
              cell.done ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700',
            )}
          >
            {cell.done ? 'Done' : 'Missing'} <span className="font-normal opacity-70">· auto</span>
          </span>
        ) : (
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cell.done}
              disabled={!canTick}
              onChange={(e) => onTick(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-[#0A0A0A] disabled:opacity-50"
            />
            <span className={cn('text-xs font-medium', cell.done ? 'text-emerald-800' : 'text-red-700')}>
              {cell.done ? 'Done' : 'Missing'}
            </span>
          </label>
        )}
        <button
          onClick={onOpen}
          title={cell.note ? `Note: ${cell.note}` : 'Add a note or see history'}
          className={cn('p-1 rounded hover:bg-white/70', cell.note ? 'text-gray-800' : 'text-gray-300 hover:text-gray-600')}
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </button>
      </div>
      {cell.auto ? (
        <p className="text-[11px] text-gray-500">
          {cell.done && cell.auto_date && <span>{formatMYDate(cell.auto_date)}</span>}
          {cell.auto_detail && <span className="block text-gray-400">{cell.auto_detail}</span>}
        </p>
      ) : (
        cell.last_by && (
          <p className="text-[11px] text-gray-500">
            {cell.last_by}{cell.last_at && <> · {formatMYDate(cell.last_at)}</>}
          </p>
        )
      )}
      {cell.note && <p className="text-[11px] text-gray-700 line-clamp-2 whitespace-pre-wrap">{cell.note}</p>}
    </div>
  )
}
