// Normalizes a customer-entered phone number to a consistent digits-only
// key (assumes Malaysia, +60, since that's where Xocks operates). Returns
// null if the result doesn't look like a plausible mobile number.
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null

  let normalized = digits
  if (digits.startsWith('60')) {
    normalized = digits
  } else if (digits.startsWith('0')) {
    normalized = '60' + digits.slice(1)
  } else {
    normalized = '60' + digits
  }

  if (normalized.length < 10 || normalized.length > 13) return null
  return normalized
}
