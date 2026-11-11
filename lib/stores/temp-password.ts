// Temporary password for a store owner login. Used by Add Store (browser) and the
// reset-login API (server). Uses Web Crypto, which both have, rather than Math.random.
// Same alphabet and length as the old generateRef(10) (no 0/O/1/I/L).

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const TEMP_PASSWORD_LENGTH = 10

// 32 characters: 256 is a multiple of 32, so byte % 32 is unbiased.
if (CHARS.length !== 32) throw new Error('TEMP_PASSWORD alphabet must be 32 characters')

export function generateTempPassword(length = TEMP_PASSWORD_LENGTH): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) out += CHARS.charAt(bytes[i] % CHARS.length)
  return out
}
