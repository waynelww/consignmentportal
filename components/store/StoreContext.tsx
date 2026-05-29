'use client'

/**
 * StoreContext — provides storeId + store data to all client-side store pages.
 *
 * The server layout (app/(store)/layout.tsx) already fetches auth → profile → store
 * server-side. We pass those values down as props so every client page can access
 * storeId / store immediately — zero extra network round-trips.
 */

import { createContext, useContext } from 'react'
import type { Store } from '@/types'

interface StoreContextValue {
  storeId: string | null
  store: Store | null
}

const StoreContext = createContext<StoreContextValue>({ storeId: null, store: null })

export function StoreProvider({
  storeId,
  store,
  children,
}: StoreContextValue & { children: React.ReactNode }) {
  return (
    <StoreContext.Provider value={{ storeId, store }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore(): StoreContextValue {
  return useContext(StoreContext)
}
