import { formatCurrency } from '@/lib/utils'

export function Currency({ amount, className }: { amount: number; className?: string }) {
  return <span className={className}>{formatCurrency(amount)}</span>
}
