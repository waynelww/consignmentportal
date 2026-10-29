import { cn } from '@/lib/utils'
import type { SaleAge, SaleAgeTone } from '@/lib/sales/last-sale'

const TONE_CLASS: Record<SaleAgeTone, string> = {
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
}

/** Colour pill for how long ago a store last entered a sale. */
export function SaleAgeBadge({ age }: { age: SaleAge | null }) {
  if (!age) return <span className="text-gray-300">—</span>
  const label = age.days === 0 ? 'Today' : `${age.days}d`
  return (
    <span
      className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap', TONE_CLASS[age.tone])}
      title={age.neverSold ? 'No sales recorded yet; counted from when the store was opened' : `${age.days} days since the last sale`}
    >
      {label}
    </span>
  )
}
