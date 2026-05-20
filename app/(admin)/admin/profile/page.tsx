export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const roleLabel: Record<string, string> = {
    super_admin: 'Super Admin',
    ops_manager: 'Operations Manager',
    store_owner: 'Store Owner',
  }

  return (
    <div className="max-w-lg">
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-[#0A0A0A] text-[#FFD700] flex items-center justify-center text-xl font-bold">
            {profile?.full_name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">{profile?.full_name}</p>
            <p className="text-sm text-gray-500">{roleLabel[profile?.role] ?? profile?.role}</p>
          </div>
        </div>
        <div className="border-t pt-4 space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Email</span>
            <span className="font-medium text-gray-900">{user.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Member since</span>
            <span className="font-medium text-gray-900">
              {new Date(user.created_at).toLocaleDateString('en-MY', { year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
