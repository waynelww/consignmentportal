import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Format as RM X,XXX.XX
export function formatCurrency(amount: number): string {
  return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function padTwo(n: number): string {
  return String(n).padStart(2, '0')
}

// Malaysia timezone display (UTC+8)
export function formatMYTime(dateStr: string): string {
  const date = new Date(dateStr)
  const my = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return `${padTwo(my.getUTCDate())}/${padTwo(my.getUTCMonth() + 1)}/${my.getUTCFullYear()} ${padTwo(my.getUTCHours())}:${padTwo(my.getUTCMinutes())}`
}

export function formatMYDate(dateStr: string): string {
  const date = new Date(dateStr)
  const my = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return `${padTwo(my.getUTCDate())}/${padTwo(my.getUTCMonth() + 1)}/${my.getUTCFullYear()}`
}

export function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatMYDate(dateStr)
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

export function formatMonthYear(month: number, year: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

// Generate 8-char alphanumeric reference
export function generateRef(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export function getStockStatus(quantity: number, threshold: number): 'in_stock' | 'low_stock' | 'out_of_stock' {
  if (quantity === 0) return 'out_of_stock'
  if (quantity <= threshold) return 'low_stock'
  return 'in_stock'
}

export const MALAYSIAN_STATES = [
  'Johor',
  'Kedah',
  'Kelantan',
  'Melaka',
  'Negeri Sembilan',
  'Pahang',
  'Perak',
  'Perlis',
  'Pulau Pinang',
  'Sabah',
  'Sarawak',
  'Selangor',
  'Terengganu',
  'Kuala Lumpur',
  'Labuan',
  'Putrajaya',
]

export const STORE_TYPE_LABELS: Record<string, string> = {
  barbershop: 'Barbershop',
  shoe_store: 'Shoe Store',
  fashion_boutique: 'Fashion Boutique',
  sports_store: 'Sports Store',
  laundromat: 'Laundromat',
  gym: 'Gym',
  muslim_fashion: 'Muslim Fashion',
  school_uniform: 'School Uniform',
  pharmacy: 'Pharmacy',
  optical: 'Optical',
  cafe: 'Cafe',
  other: 'Other',
}

export const PRODUCT_CATEGORY_LABELS: Record<string, string> = {
  ankle: 'Ankle',
  crew: 'Crew',
  no_show: 'No Show',
  half: 'Half',
  kids: 'Kids',
  muslimah: 'Muslimah',
  design: 'Design',
}
