export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Home, ShoppingCart, Package, Truck, Info, Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import LogoutButton from '@/components/store/LogoutButton'
import PushSubscriber from '@/components/store/PushSubscriber'
import { StoreProvider } from '@/components/store/StoreContext'
import type { Store, Profile } from '@/types'

interface StoreLayoutData {
  store: Store | null
  storeId: string | null
  unreadCount: number
  pendingDOs: number
}

async function getStoreData(): Promise<StoreLayoutData> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { store: null, storeId: null, unreadCount: 0, pendingDOs: 0 }

  const { data: profile } = await supabase
    .from('profiles')
    .select('store_id')
    .eq('id', user.id)
    .single<Profile>()

  if (!profile?.store_id) return { store: null, storeId: null, unreadCount: 0, pendingDOs: 0 }

  const [{ data: store }, { count: notifCount }, { count: doCount }] = await Promise.all([
    supabase.from('stores').select('*').eq('id', profile.store_id).single<Store>(),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_store_id', profile.store_id)
      .eq('is_read', false),
    supabase
      .from('delivery_orders')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', profile.store_id)
      .in('status', ['confirmed', 'dispatched', 'delivered']),
  ])

  return { store: store ?? null, storeId: profile.store_id, unreadCount: notifCount ?? 0, pendingDOs: doCount ?? 0 }
}

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const { store, storeId, unreadCount, pendingDOs } = await getStoreData()

  return (
    <div className="min-h-screen bg-[#F8F8F8] flex flex-col">
      {/* Top header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#0A0A0A] px-4 py-3 flex items-center justify-between shadow-md">
        <Link href="/store/profile" className="flex flex-col">
          <span className="text-[#FFD700] font-bold text-base leading-tight truncate max-w-[220px]">
            {store?.store_name ?? 'My Store'}
          </span>
          {store?.store_code && (
            <span className="text-gray-400 text-xs">{store.store_code}</span>
          )}
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/store/notifications" className="relative p-2">
            <Bell size={22} className="text-white" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-[#EF4444] rounded-full text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>
          <LogoutButton />
        </div>
      </header>

      {/* Web Push subscription — registers SW and requests permission silently */}
      <PushSubscriber />

      {/* Page content — StoreProvider makes storeId + store available to all client pages */}
      <main className="flex-1 pt-[60px] pb-[72px]">
        <StoreProvider storeId={storeId} store={store}>
          {children}
        </StoreProvider>
      </main>

      {/* Bottom navigation — 5 equal tabs */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 safe-area-pb">
        <div className="flex items-stretch h-[64px]">
          <NavItem href="/store/dashboard"      icon={<Home size={22} />}         label="Home" />
          <NavItem href="/store/profile"        icon={<Info size={22} />}         label="Info" />
          <NavItem href="/store/record-sale"    icon={<ShoppingCart size={22} />} label="Sales" highlight />
          <NavItem href="/store/inventory"      icon={<Package size={22} />}      label="Inventory" />
          <NavItem href="/store/delivery-orders" icon={<Truck size={22} />}       label="Deliveries" badge={pendingDOs} />
        </div>
      </nav>
    </div>
  )
}

function NavItem({
  href, icon, label, badge, highlight,
}: {
  href: string
  icon: React.ReactNode
  label: string
  badge?: number
  highlight?: boolean
}) {
  return (
    <Link
      href={href}
      className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors relative
        ${highlight ? 'text-[#0A0A0A]' : 'text-gray-400 hover:text-[#0A0A0A]'}`}
    >
      <div className={`relative ${highlight ? 'bg-[#FFD700] rounded-xl p-2' : ''}`}>
        {icon}
        {badge && badge > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-1 bg-[#EF4444] rounded-full text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {badge > 9 ? '9+' : badge}
          </span>
        ) : null}
      </div>
      <span className={`text-[10px] font-medium ${highlight ? 'font-bold' : ''}`}>{label}</span>
    </Link>
  )
}
