'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Store, Package, ArchiveX, PackageCheck,
  Truck, Banknote, BarChart2, Settings, User, LogOut, Menu, X
} from 'lucide-react'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

const navGroups = [
  {
    label: 'Overview',
    items: [
      { href: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    ],
  },
  {
    label: 'Network',
    items: [
      { href: '/admin/stores', icon: Store, label: 'Stores' },
      { href: '/admin/products', icon: Package, label: 'Products' },
      { href: '/admin/stock', icon: ArchiveX, label: 'Stock' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/restocks', icon: PackageCheck, label: 'Restock Queue' },
      { href: '/admin/delivery-orders', icon: Truck, label: 'Delivery Orders' },
      { href: '/admin/commissions', icon: Banknote, label: 'Commissions' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { href: '/admin/reports', icon: BarChart2, label: 'Reports' },
    ],
  },
]

interface SidebarProps {
  userName?: string
  userRole?: string
}

export function AdminSidebar({ userName, userRole }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-white/10">
        <span className="text-[#FFD700] font-black text-2xl tracking-tighter">XCMS</span>
        <p className="text-gray-400 text-xs mt-0.5">Xocks Consignment</p>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        {navGroups.map(group => (
          <div key={group.label}>
            <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider px-2 mb-2">
              {group.label}
            </p>
            {group.items.map(item => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mb-0.5',
                    isActive
                      ? 'text-[#FFD700] bg-white/5 border-l-2 border-[#FFD700] pl-[calc(0.75rem-2px)]'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  <item.icon className="h-4 w-4 flex-shrink-0" />
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Bottom system items */}
      <div className="border-t border-white/10 p-3 space-y-0.5">
        <Link
          href="/admin/settings"
          onClick={() => setMobileOpen(false)}
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
            pathname === '/admin/settings' ? 'text-[#FFD700] bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
        <div className="px-3 py-2 mt-2 border-t border-white/10">
          <p className="text-white text-sm font-medium truncate">{userName || 'Admin'}</p>
          <p className="text-gray-400 text-xs capitalize">{userRole?.replace('_', ' ') || ''}</p>
        </div>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:w-60 lg:flex-col bg-[#0A0A0A] text-white z-30">
        <SidebarContent />
      </aside>

      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-40 p-2 bg-[#0A0A0A] text-white rounded-lg"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div className="lg:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setMobileOpen(false)} />
          <aside className="lg:hidden fixed inset-y-0 left-0 w-60 bg-[#0A0A0A] text-white z-50 flex flex-col">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 p-1 text-gray-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent />
          </aside>
        </>
      )}
    </>
  )
}
