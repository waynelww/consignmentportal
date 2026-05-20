'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, ShoppingCart, Package, Receipt, User } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/store/dashboard', icon: Home, label: 'Home' },
  { href: '/store/record-sale', icon: ShoppingCart, label: 'Sale', highlight: true },
  { href: '/store/inventory', icon: Package, label: 'Stock' },
  { href: '/store/sales-history', icon: Receipt, label: 'History' },
  { href: '/store/commissions', icon: User, label: 'Account' },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 safe-area-pb">
      <div className="flex items-center justify-around h-16">
        {navItems.map(({ href, icon: Icon, label, highlight }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-0.5 min-w-0 flex-1 py-2 transition-colors',
                highlight
                  ? isActive
                    ? 'text-[#FFD700]'
                    : 'text-gray-400'
                  : isActive
                  ? 'text-[#0A0A0A]'
                  : 'text-gray-400'
              )}
            >
              <div className={cn(
                'flex items-center justify-center',
                highlight && 'bg-[#0A0A0A] rounded-xl p-2 -mt-4 shadow-lg',
              )}>
                <Icon className={cn(
                  highlight ? 'h-6 w-6 text-[#FFD700]' : 'h-5 w-5',
                )} />
              </div>
              <span className={cn('text-xs truncate', highlight && 'mt-1')}>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
