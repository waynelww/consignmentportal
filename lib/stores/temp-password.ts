// Server-only. Temporary password for a store owner login.
// Same alphabet and length as the Add Store form (generateRef(10) in lib/utils.ts),
// but drawn with crypto.randomInt, since Math.random is not safe for credentials.

import { randomInt } from 'node:crypto'

// Same alphabet as generateRef in lib/utils.ts (no 0/O/1/I/L).
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const TEMP_PASSWORD_LENGTH = 10

export function generateTempPassword(length = TEMP_PASSWORD_LENGTH): string {
  let out = ''
  for (let i = 0; i < length; i++) out += CHARS.charAt(randomInt(CHARS.length))
  return out
}
