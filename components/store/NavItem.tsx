'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface NavItemProps {
  href: string
  icon: React.ReactNode
  iconActive?: React.ReactNode
  label: string
  badge?: number
  highlight?: boolean
}

export default function NavItem({ href, icon, iconActive, label, badge, highlight }: NavItemProps) {
  const pathname = usePathname()
  const isActive = pathname === href || pathname.startsWith(href + '/')

  // Color logic:
  // - "highlight" tab (Sales) keeps its yellow puck; turns black-on-yellow when active
  // - Other tabs: gray when inactive, solid black when active
  const containerColor = highlight
    ? 'text-[#0A0A0A]'
    : isActive
      ? 'text-[#0A0A0A]'
      : 'text-gray-400 hover:text-[#0A0A0A]'

  return (
    <Link
      href={href}
      className={cn('flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors relative', containerColor)}
    >
      {/* Active marker dot above the icon (skip on highlight tab since it has its own puck) */}
      {isActive && !highlight && (
        <span className="absolute top-0 w-8 h-[3px] bg-[#0A0A0A] rounded-full" />
      )}

      <div
        className={cn(
          'relative transition-transform',
          highlight && 'bg-[#FFD700] rounded-xl p-2',
          // Bigger icon when active so it's obvious which tab you're on
          isActive && 'scale-110',
        )}
      >
        {isActive && iconActive ? iconActive : icon}
        {badge && badge > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-1 bg-[#EF4444] rounded-full text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {badge > 9 ? '9+' : badge}
          </span>
        ) : null}
      </div>

      <span
        className={cn(
          'text-[10px] truncate transition-all',
          isActive ? 'font-bold text-[11px]' : 'font-medium',
          highlight && 'font-bold',
        )}
      >
        {label}
      </span>
    </Link>
  )
}
