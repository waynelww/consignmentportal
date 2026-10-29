'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { XocksTeamMember } from '@/types'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/**
 * The Xocks team list (admins only). Pass includeHidden to also get names
 * that were hidden, so an existing store's "Opened by" can still be shown.
 */
export function useXocksTeam({ includeHidden = false }: { includeHidden?: boolean } = {}) {
  const [members, setMembers] = useState<XocksTeamMember[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/xocks-team${includeHidden ? '?include_hidden=1' : ''}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not load the team list')
      setMembers((body.members ?? []) as XocksTeamMember[])
      setLoaded(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load the team list')
    } finally {
      setLoading(false)
    }
  }, [includeHidden])

  useEffect(() => {
    reload()
  }, [reload])

  const add = useCallback(async (name: string) => {
    const res = await fetch('/api/xocks-team', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(body.error ?? 'Could not add name')
      return null
    }
    await reload()
    return body.member as XocksTeamMember
  }, [reload])

  const update = useCallback(async (id: string, patch: { name?: string; active?: boolean }) => {
    const res = await fetch(`/api/xocks-team/${id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(body.error ?? 'Could not update name')
      return null
    }
    await reload()
    return body.member as XocksTeamMember
  }, [reload])

  return { members, loaded, loading, reload, add, update }
}
