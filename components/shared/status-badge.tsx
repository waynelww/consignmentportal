import { cn } from '@/lib/utils'
import type { StoreStatus, CommissionStatus, RestockRequestStatus, DeliveryOrderStatus, RestockAlertStatus } from '@/types'

type BadgeVariant = 'green' | 'yellow' | 'red' | 'gray' | 'blue' | 'purple'

const variantClasses: Record<BadgeVariant, string> = {
  green:  'bg-green-50 text-green-700 border-green-200',
  yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  red:    'bg-red-50 text-red-700 border-red-200',
  gray:   'bg-gray-100 text-gray-600 border-gray-200',
  blue:   'bg-blue-50 text-blue-700 border-blue-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
}

export function StatusBadge({ label, variant }: { label: string; variant: BadgeVariant }) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border', variantClasses[variant])}>
      {label}
    </span>
  )
}

export function StoreStatusBadge({ status }: { status: StoreStatus }) {
  const map: Record<StoreStatus, { label: string; variant: BadgeVariant }> = {
    active:    { label: 'Active', variant: 'green' },
    inactive:  { label: 'Inactive', variant: 'gray' },
    suspended: { label: 'Suspended', variant: 'red' },
    pending:   { label: 'Pending', variant: 'yellow' },
  }
  const { label, variant } = map[status]
  return <StatusBadge label={label} variant={variant} />
}

export function CommissionStatusBadge({ status }: { status: CommissionStatus }) {
  const map: Record<CommissionStatus, { label: string; variant: BadgeVariant }> = {
    pending:  { label: 'Pending', variant: 'yellow' },
    approved: { label: 'Approved', variant: 'blue' },
    paid:     { label: 'Paid', variant: 'green' },
    disputed: { label: 'Disputed', variant: 'red' },
  }
  const { label, variant } = map[status]
  return <StatusBadge label={label} variant={variant} />
}

export function DOStatusBadge({ status }: { status: DeliveryOrderStatus }) {
  const map: Record<DeliveryOrderStatus, { label: string; variant: BadgeVariant }> = {
    draft:        { label: 'Draft', variant: 'gray' },
    confirmed:    { label: 'Confirmed', variant: 'blue' },
    dispatched:   { label: 'In Transit', variant: 'purple' },
    delivered:    { label: 'Delivered', variant: 'green' },
    acknowledged: { label: 'Acknowledged', variant: 'green' },
  }
  const { label, variant } = map[status]
  return <StatusBadge label={label} variant={variant} />
}

export function RestockStatusBadge({ status }: { status: RestockRequestStatus }) {
  const map: Record<RestockRequestStatus, { label: string; variant: BadgeVariant }> = {
    pending:    { label: 'Pending', variant: 'yellow' },
    approved:   { label: 'Approved', variant: 'blue' },
    rejected:   { label: 'Rejected', variant: 'red' },
    dispatched: { label: 'Dispatched', variant: 'purple' },
    received:   { label: 'Received', variant: 'green' },
  }
  const { label, variant } = map[status]
  return <StatusBadge label={label} variant={variant} />
}

export function PerformanceScore({ score }: { score: number }) {
  const color = score >= 50 ? 'text-green-600' : score >= 20 ? 'text-yellow-600' : 'text-red-600'
  return <span className={`font-semibold text-sm ${color}`}>{score.toFixed(1)}%</span>
}

export function PaymentMethodBadge({ method }: { method: 'qr' | 'cash' }) {
  return (
    <StatusBadge
      label={method === 'qr' ? 'QR' : 'Cash'}
      variant={method === 'qr' ? 'blue' : 'gray'}
    />
  )
}
