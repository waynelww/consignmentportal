'use client'

// Admin pages: Drive status for a list of DOs or invoices, plus a queue/retry action.
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { fetchDriveRows, requeueDrive, type DriveRow } from './client'
import type { DriveKind } from './layout'

export function useDriveRows(kind: DriveKind, ids: string[]) {
  const [rows, setRows] = useState<Map<string, DriveRow>>(new Map())
  const [busyId, setBusyId] = useState<string | null>(null)
  // Key on the joined ids so a new array with the same ids does not refetch.
  const key = ids.join(',')

  const load = useCallback(async () => {
    const list = key ? key.split(',') : []
    if (list.length === 0) { setRows(new Map()); return }
    try {
      setRows(await fetchDriveRows(createClient(), kind, list))
    } catch {
      // Keep the last known statuses; the next change or reload retries.
    }
  }, [kind, key])

  useEffect(() => { load() }, [load])

  async function queue(id: string) {
    setBusyId(id)
    const r = await requeueDrive(kind, [id])
    setBusyId(null)
    if (!r.ok) {
      toast.error(`Drive: ${r.error}`)
      return
    }
    toast.success('Queued for Drive — it uploads within 15 minutes')
    load()
  }

  return { rows, busyId, queue }
}
