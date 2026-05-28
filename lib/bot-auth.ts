import { type NextRequest } from 'next/server'

export function verifyBotAuth(request: NextRequest): { ok: true } | { ok: false; response: Response } {
  const auth = request.headers.get('authorization')
  const expected = process.env.BOT_API_KEY

  if (!expected) {
    return {
      ok: false,
      response: Response.json({ error: 'BOT_API_KEY not configured on server' }, { status: 500 }),
    }
  }

  if (!auth || auth !== `Bearer ${expected}`) {
    return {
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  return { ok: true }
}
