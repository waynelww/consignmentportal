'use client'

import { useState } from 'react'
import { Pencil, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useXocksTeam } from '@/components/admin/useXocksTeam'

/**
 * Settings → Xocks Team. Add, rename, and hide the people who open stores.
 * Hidden names stay on the stores they opened and can be restored.
 */
export default function XocksTeamManager() {
  const state = useXocksTeam({ includeHidden: true })
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  async function handleAdd() {
    const name = newName.trim()
    if (!name || saving) return
    setSaving(true)
    const created = await state.add(name)
    setSaving(false)
    if (created) setNewName('')
  }

  async function handleRename(id: string) {
    const name = editName.trim()
    if (!name || saving) return
    setSaving(true)
    const updated = await state.update(id, { name })
    setSaving(false)
    if (updated) setEditingId(null)
  }

  async function handleHide(id: string, name: string) {
    if (!window.confirm(`Hide ${name} from the list? Stores they opened keep the name.`)) return
    await state.update(id, { active: false })
  }

  const active = state.members.filter((m) => m.active)
  const hidden = state.members.filter((m) => !m.active)

  return (
    <div className="space-y-4 max-w-xl">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Add name</h3>
        <p className="text-xs text-gray-500 mb-3">
          Xocks team members who can be recorded as opening a store.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            maxLength={60}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            placeholder="Team member name"
            className="flex-1 min-w-0 h-10 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newName.trim() || saving}
            className="px-4 h-10 rounded-lg bg-[#0A0A0A] text-[#FFD700] text-sm font-semibold disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Team ({active.length})</h3>
        {!state.loaded && state.loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : active.length === 0 ? (
          <p className="text-sm text-gray-400">No names yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {active.map((member) => (
              <li key={member.id} className="flex items-center gap-2 py-2">
                {editingId === member.id ? (
                  <>
                    <input
                      type="text"
                      autoFocus
                      maxLength={60}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRename(member.id) }}
                      className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                    />
                    <button
                      type="button"
                      onClick={() => handleRename(member.id)}
                      disabled={!editName.trim() || saving}
                      className="px-3 h-9 rounded-lg bg-[#0A0A0A] text-[#FFD700] text-xs font-semibold disabled:opacity-40"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center"
                      aria-label="Cancel rename"
                    >
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 min-w-0 truncate text-sm text-gray-800">{member.name}</span>
                    <button
                      type="button"
                      onClick={() => { setEditingId(member.id); setEditName(member.name) }}
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100"
                      aria-label={`Rename ${member.name}`}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleHide(member.id, member.name)}
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50"
                      aria-label={`Hide ${member.name}`}
                    >
                      <X size={14} />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {hidden.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-500 mb-3">Hidden ({hidden.length})</h3>
          <ul className="divide-y divide-gray-100">
            {hidden.map((member) => (
              <li key={member.id} className="flex items-center gap-2 py-2">
                <span className={cn('flex-1 min-w-0 truncate text-sm text-gray-400 line-through')}>{member.name}</span>
                <button
                  type="button"
                  onClick={() => state.update(member.id, { active: true })}
                  className="flex items-center gap-1 px-2.5 h-8 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  <RotateCcw size={12} />
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
