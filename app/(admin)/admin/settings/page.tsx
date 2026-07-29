'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, X, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { Setting, Profile } from '@/types'
import { toast } from 'sonner'

type SettingsTab = 'general' | 'users' | 'notifications'

interface AdminUser extends Profile {
  email: string
}

interface NotificationToggle {
  key: string
  label: string
  email: boolean
  in_app: boolean
}

const DEFAULT_NOTIFICATION_KEYS: Omit<NotificationToggle, 'email' | 'in_app'>[] = [
  { key: 'notif_low_stock', label: 'Low Stock Alerts' },
  { key: 'notif_restock_request', label: 'Restock Requests' },
  { key: 'notif_do_dispatched', label: 'DO Dispatched' },
  { key: 'notif_do_delivered', label: 'DO Delivered' },
  { key: 'notif_commission_ready', label: 'Commission Ready' },
  { key: 'notif_commission_paid', label: 'Commission Paid' },
  { key: 'notif_performance_warning', label: 'Performance Warning' },
  { key: 'notif_new_store', label: 'New Store Added' },
]

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [settings, setSettings] = useState<Setting[]>([])
  const [editedSettings, setEditedSettings] = useState<Record<string, string>>({})
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [addUserOpen, setAddUserOpen] = useState(false)
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserName, setNewUserName] = useState('')
  const [newUserRole, setNewUserRole] = useState<'super_admin' | 'ops_manager'>('ops_manager')
  const [addingUser, setAddingUser] = useState(false)
  const [notifications, setNotifications] = useState<NotificationToggle[]>([])
  const supabase = createClient()

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true)
    const { data } = await supabase.from('settings').select('*').order('key')
    const s = (data || []) as Setting[]
    setSettings(s)
    const map: Record<string, string> = {}
    for (const item of s) map[item.key] = item.value
    setEditedSettings(map)
    setSettingsLoading(false)
  }, [])

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true)
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .in('role', ['super_admin', 'ops_manager'])
      .order('created_at')

    // We can't easily join auth.users from client, so show what we have
    setAdminUsers((data || []).map((p: any) => ({ ...p, email: p.email || '' })))
    setUsersLoading(false)
  }, [])

  const fetchNotifications = useCallback(async () => {
    const { data } = await supabase
      .from('settings')
      .select('key, value')
      .like('key', 'notif_%')

    const valMap: Record<string, string> = {}
    for (const row of data || []) valMap[row.key] = row.value

    setNotifications(
      DEFAULT_NOTIFICATION_KEYS.map((n) => {
        const raw = valMap[n.key] || 'email:true,in_app:true'
        const parts = raw.split(',')
        const email = !parts[0]?.includes('false')
        const inApp = !parts[1]?.includes('false')
        return { ...n, email, in_app: inApp }
      })
    )
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])
  useEffect(() => { if (activeTab === 'users') fetchUsers() }, [activeTab, fetchUsers])
  useEffect(() => { if (activeTab === 'notifications') fetchNotifications() }, [activeTab, fetchNotifications])

  async function saveSettings() {
    setSavingSettings(true)
    const allEdited = { ...editedSettings }
    // Ensure company info keys are always included even if new
    for (const key of ['company_name', 'company_address', 'company_contact']) {
      if (!(key in allEdited)) allEdited[key] = ''
    }
    const updates = Object.entries(allEdited)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }))

    const { error } = await supabase.from('settings').upsert(updates, { onConflict: 'key' })

    setSavingSettings(false)
    if (error) toast.error('Failed to save settings')
    else {
      toast.success('Settings saved')
      fetchSettings()
    }
  }

  async function addAdminUser() {
    if (!newUserEmail.trim() || !newUserName.trim()) {
      toast.error('Email and name are required')
      return
    }
    setAddingUser(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newUserEmail, full_name: newUserName, role: newUserRole }),
      })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Failed to add user')
      } else {
        toast.success('Admin user created')
        setAddUserOpen(false)
        setNewUserEmail('')
        setNewUserName('')
        fetchUsers()
      }
    } catch {
      toast.error('An error occurred')
    }
    setAddingUser(false)
  }

  async function deactivateUser(userId: string, name: string) {
    const confirmed = window.confirm(`Deactivate "${name}"? They will no longer be able to log in.`)
    if (!confirmed) return
    try {
      const res = await fetch(`/api/admin/users/${userId}/deactivate`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body.error ?? 'Failed to deactivate'); return }
      toast.success('User deactivated — they can no longer log in')
      fetchUsers()
    } catch {
      toast.error('An error occurred')
    }
  }

  async function saveNotifications() {
    const updates = notifications.map((n) => ({
      key: n.key,
      value: `email:${n.email},in_app:${n.in_app}`,
      updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from('settings').upsert(updates, { onConflict: 'key' })
    if (error) toast.error('Failed to save')
    else toast.success('Notification preferences saved')
  }

  function updateNotification(key: string, field: 'email' | 'in_app', value: boolean) {
    setNotifications((prev) =>
      prev.map((n) => (n.key === key ? { ...n, [field]: value } : n))
    )
  }

  // Group settings by prefix
  const settingGroups = settings.reduce<Record<string, Setting[]>>((acc, s) => {
    const group = s.key.split('_')[0] || 'general'
    if (!acc[group]) acc[group] = []
    acc[group].push(s)
    return acc
  }, {})

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex border-b border-gray-100 px-4">
          {(['general', 'users', 'notifications'] as SettingsTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-3 text-sm font-medium border-b-2 capitalize transition-colors',
                activeTab === tab
                  ? 'border-[#FFD700] text-[#0A0A0A]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {tab === 'users' ? 'User Management' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'notifications' ? ' Settings' : tab === 'general' ? ' Settings' : ''}
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* ── General Settings ── */}
          {activeTab === 'general' && (
            <div className="space-y-6">
              {settingsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-12 bg-gray-100 animate-pulse rounded-xl" />
                  ))}
                </div>
              ) : (
                <>
                  {Object.entries(settingGroups).map(([group, items]) => (
                    <div key={group}>
                      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 capitalize">
                        {group} settings
                      </h3>
                      <div className="space-y-3">
                        {items.filter((s) => !s.key.startsWith('notif_')).map((setting) => (
                          <div key={setting.key} className="flex items-start gap-4">
                            <div className="flex-1 min-w-0">
                              <label className="text-sm font-medium text-gray-700 block mb-0.5">
                                {setting.key.replace(/_/g, ' ')}
                              </label>
                              {setting.description && (
                                <p className="text-xs text-gray-400">{setting.description}</p>
                              )}
                            </div>
                            <input
                              type="text"
                              value={editedSettings[setting.key] ?? setting.value}
                              onChange={(e) =>
                                setEditedSettings((prev) => ({ ...prev, [setting.key]: e.target.value }))
                              }
                              className="w-48 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Company info section — always shown for invoice purposes */}
                  <div>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Company Info (used in invoices)</h3>
                    <div className="space-y-3">
                      {[
                        { key: 'company_name', label: 'Company Name', placeholder: 'Wayne Group Holding Sdn Bhd' },
                        { key: 'company_address', label: 'Company Address', placeholder: 'Kuala Lumpur, Malaysia' },
                        { key: 'company_contact', label: 'Contact Email / Phone', placeholder: 'hello@xocks.co' },
                      ].map(({ key, label, placeholder }) => (
                        <div key={key} className="flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <label className="text-sm font-medium text-gray-700 block">{label}</label>
                          </div>
                          <input
                            type="text"
                            value={editedSettings[key] ?? ''}
                            placeholder={placeholder}
                            onChange={(e) =>
                              setEditedSettings((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            className="w-64 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {settings.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-8">No settings configured yet</p>
                  )}

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={saveSettings}
                      disabled={savingSettings}
                      className="px-6 py-2.5 bg-[#0A0A0A] text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
                    >
                      {savingSettings ? 'Saving...' : 'Save Settings'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── User Management ── */}
          {activeTab === 'users' && (
            <div className="space-y-5">
              <div className="flex justify-end">
                <button
                  onClick={() => setAddUserOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 transition-colors"
                >
                  <Plus size={16} />
                  Add Admin User
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Name</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Role</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Phone</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersLoading
                      ? Array.from({ length: 3 }).map((_, i) => (
                          <tr key={i} className="border-b border-gray-50">
                            {Array.from({ length: 4 }).map((_, j) => (
                              <td key={j} className="px-4 py-3">
                                <div className="h-4 bg-gray-100 animate-pulse rounded" />
                              </td>
                            ))}
                          </tr>
                        ))
                      : adminUsers.map((u) => (
                          <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                            <td className="px-4 py-3 font-medium text-gray-800">{u.full_name}</td>
                            <td className="px-4 py-3">
                              <span className={cn(
                                'px-2.5 py-0.5 rounded-full text-xs font-medium',
                                u.role === 'super_admin'
                                  ? 'bg-[#FFD700]/20 text-[#0A0A0A]'
                                  : 'bg-blue-100 text-blue-700'
                              )}>
                                {u.role === 'super_admin' ? 'Super Admin' : 'Ops Manager'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-600">{u.phone || '—'}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => deactivateUser(u.id, u.full_name)}
                                className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 ml-auto transition-colors"
                              >
                                <AlertTriangle size={13} />
                                Deactivate
                              </button>
                            </td>
                          </tr>
                        ))}
                    {!usersLoading && adminUsers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-gray-400 text-sm">
                          No admin users
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Add User Modal */}
              {addUserOpen && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                  <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
                    <div className="flex items-center justify-between mb-5">
                      <h3 className="text-base font-semibold text-gray-900">Add Admin User</h3>
                      <button onClick={() => setAddUserOpen(false)}>
                        <X size={18} className="text-gray-400 hover:text-gray-600" />
                      </button>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Full Name *</label>
                        <input
                          type="text"
                          value={newUserName}
                          onChange={(e) => setNewUserName(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Email *</label>
                        <input
                          type="email"
                          value={newUserEmail}
                          onChange={(e) => setNewUserEmail(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Role</label>
                        <select
                          value={newUserRole}
                          onChange={(e) => setNewUserRole(e.target.value as typeof newUserRole)}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                        >
                          <option value="ops_manager">Ops Manager</option>
                          <option value="super_admin">Super Admin</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-3 mt-5">
                      <button
                        onClick={() => setAddUserOpen(false)}
                        className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={addAdminUser}
                        disabled={addingUser}
                        className="flex-1 py-2.5 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50"
                      >
                        {addingUser ? 'Creating...' : 'Create User'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Notifications ── */}
          {activeTab === 'notifications' && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500">
                Configure which notification channels are enabled for each event type.
              </p>
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Notification Type</th>
                      <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500">Email</th>
                      <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500">In-App</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notifications.map((n) => (
                      <tr key={n.key} className="border-b border-gray-50 last:border-0">
                        <td className="px-5 py-3 text-gray-800">{n.label}</td>
                        <td className="px-5 py-3 text-center">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={n.email}
                              onChange={(e) => updateNotification(n.key, 'email', e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className={cn(
                              'w-9 h-5 rounded-full transition-colors',
                              n.email ? 'bg-[#0A0A0A]' : 'bg-gray-200'
                            )}>
                              <div className={cn(
                                'w-3.5 h-3.5 bg-white rounded-full shadow transform transition-transform mt-0.75 ml-0.75',
                                n.email ? 'translate-x-4' : 'translate-x-0'
                              )} />
                            </div>
                          </label>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={n.in_app}
                              onChange={(e) => updateNotification(n.key, 'in_app', e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className={cn(
                              'w-9 h-5 rounded-full transition-colors',
                              n.in_app ? 'bg-[#0A0A0A]' : 'bg-gray-200'
                            )}>
                              <div className={cn(
                                'w-3.5 h-3.5 bg-white rounded-full shadow transform transition-transform mt-0.75 ml-0.75',
                                n.in_app ? 'translate-x-4' : 'translate-x-0'
                              )} />
                            </div>
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={saveNotifications}
                  className="px-6 py-2.5 bg-[#0A0A0A] text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
                >
                  Save Preferences
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
