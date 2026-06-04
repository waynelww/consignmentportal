'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Store,
  Package,
  Layers,
  RefreshCcw,
  Truck,
  DollarSign,
  BarChart2,
  Settings,
  User,
  LogOut,
  Bell,
  ChevronRight,
  Menu,
  X,
  Sparkles,
  Tag,
  Calculator,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { Profile } from '@/types'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'
const AiAssistant = dynamic(() => import('@/components/AiAssistant'), { ssr: false })

const NAV_ITEMS = [
  {
    section: 'Overview',
    items: [
      { label: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    section: 'Network',
    items: [
      { label: 'Stores', href: '/admin/stores', icon: Store },
      { label: 'Store Types', href: '/admin/store-types', icon: Tag },
      { label: 'Products', href: '/admin/products', icon: Package },
      { label: 'Stock', href: '/admin/stock', icon: Layers },
    ],
  },
  {
    section: 'Operations',
    items: [
      { label: 'Restock Queue', href: '/admin/restocks', icon: RefreshCcw },
      { label: 'Predictions', href: '/admin/predictions', icon: Sparkles },
      { label: 'Delivery Orders', href: '/admin/delivery-orders', icon: Truck },
      { label: 'Commissions', href: '/admin/commissions', icon: DollarSign },
      { label: 'Promos', href: '/admin/promos', icon: Tag },
      { label: 'OEM Calculator', href: '/admin/oem-calculator', icon: Calculator },
    ],
  },
  {
    section: 'Analytics',
    items: [
      { label: 'Reports', href: '/admin/reports', icon: BarChart2 },
    ],
  },
  {
    section: 'System',
    items: [
      { label: 'Settings', href: '/admin/settings', icon: Settings },
      { label: 'My Profile', href: '/admin/profile', icon: User },
    ],
  },
]

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function getPageTitle(pathname: string): string {
  const map: Record<string, string> = {
    '/admin/dashboard': 'Dashboard',
    '/admin/stores': 'Stores',
    '/admin/store-types': 'Store Types',
    '/admin/products': 'Products',
    '/admin/stock': 'Stock',
    '/admin/restocks': 'Restock Queue',
    '/admin/predictions': 'Restock Predictions',
    '/admin/delivery-orders': 'Delivery Orders',
    '/admin/commissions': 'Commissions',
    '/admin/promos': 'Promos',
    '/admin/reports': 'Reports',
    '/admin/oem-calculator': 'OEM Calculator',
    '/admin/settings': 'Settings',
    '/admin/profile': 'My Profile',
  }
  for (const [key, val] of Object.entries(map)) {
    if (pathname.includes(key)) return val
  }
  return 'XCMS'
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (data) setProfile(data as Profile)
        })
    })
    // Load unread notification count
    fetch('/api/notifications?limit=50')
      .then((r) => r.json())
      .then(({ notifications }) => {
        if (Array.isArray(notifications)) {
          setUnreadCount(notifications.filter((n: { is_read: boolean }) => !n.is_read).length)
        }
      })
      .catch(() => {})
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    toast.success('Signed out successfully')
    router.push('/login')
  }

  const pageTitle = getPageTitle(pathname)

  function NavContent({ collapsed = false }: { collapsed?: boolean }) {
    return (
      <>
        {/* Logo */}
        <div className="flex items-center gap-2 px-5 py-5 border-b border-white/10">
          <span className="text-[#FFD700] font-black text-2xl tracking-tight">XCMS</span>
          {!collapsed && (
            <span className="text-white/40 text-xs font-medium ml-1 mt-1">admin</span>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-4 space-y-6 px-3">
          {NAV_ITEMS.map((section) => (
            <div key={section.section}>
              {!collapsed && (
                <p className="text-white/30 text-[10px] font-semibold uppercase tracking-widest px-2 mb-2">
                  {section.section}
                </p>
              )}
              <ul className="space-y-1">
                {section.items.map(({ label, href, icon: Icon }) => {
                  const active = pathname.includes(href)
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={() => setSidebarOpen(false)}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all relative',
                          active
                            ? 'text-[#FFD700] bg-white/5'
                            : 'text-white/60 hover:text-white hover:bg-white/5'
                        )}
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#FFD700] rounded-r-full" />
                        )}
                        <Icon size={18} className="flex-shrink-0" />
                        {!collapsed && <span>{label}</span>}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Sign out */}
        <div className="p-3 border-t border-white/10">
          <button
            onClick={handleSignOut}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-all w-full',
              collapsed && 'justify-center'
            )}
          >
            <LogOut size={18} className="flex-shrink-0" />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="flex h-screen bg-[#F5F5F5] overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 bg-[#0A0A0A] text-white flex-shrink-0 fixed left-0 top-0 h-full z-30">
        <NavContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-full w-60 bg-[#0A0A0A] text-white flex flex-col z-50 transform transition-transform lg:hidden',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <button
          className="absolute top-4 right-4 text-white/60 hover:text-white"
          onClick={() => setSidebarOpen(false)}
        >
          <X size={20} />
        </button>
        <NavContent />
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 lg:ml-60">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between flex-shrink-0 sticky top-0 z-20">
          <div className="flex items-center gap-4">
            <button
              className="lg:hidden text-gray-500 hover:text-gray-700"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={22} />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">{pageTitle}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/admin/notifications" className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors">
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-[#FFD700] text-[#0A0A0A] rounded-full text-[9px] font-bold flex items-center justify-center px-0.5">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
            {profile && (
              <Link href="/admin/profile" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <div className="w-8 h-8 rounded-full bg-[#0A0A0A] text-[#FFD700] flex items-center justify-center text-xs font-bold">
                  {getInitials(profile.full_name)}
                </div>
                <span className="hidden md:block text-sm font-medium text-gray-700">
                  {profile.full_name}
                </span>
                <ChevronRight size={14} className="hidden md:block text-gray-400" />
              </Link>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
      <AiAssistant />
    </div>
  )
}
