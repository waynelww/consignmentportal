// Invisible characters that come in with text copied from chats and web pages
// (e.g. U+202A from WhatsApp). They are never meaningful in store details, and
// they break PDF rendering, so they are stripped when details are saved.

export const INVISIBLE_CHARS_RE = /[​-‏‪-‮⁦-⁩﻿]/g

export function stripInvisible(value: string): string {
  return value.replace(INVISIBLE_CHARS_RE, '')
}

/** Strip invisible characters from every string in a parsed JSON body (objects and arrays). */
export function stripInvisibleDeep<T>(value: T): T {
  if (typeof value === 'string') return stripInvisible(value) as T
  if (Array.isArray(value)) return value.map((v) => stripInvisibleDeep(v)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = stripInvisibleDeep(v)
    return out as T
  }
  return value
}
