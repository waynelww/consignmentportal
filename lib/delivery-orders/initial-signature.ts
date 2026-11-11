// The store's first delivery order (do_type 'initial') must be signed by the store.
// Initial DOs are created already 'acknowledged' with the stock added (see
// app/api/stores/route.ts), so the store signs them instead of receiving them.
// Only initial DOs created from this moment on need a signature; older stores'
// initial DOs are never flagged. Client-safe: no server imports.

/** Initial DOs created at or after this instant need the store's signature (MYT). */
export const INITIAL_DO_SIGNATURE_FROM = '2026-11-11T00:00:00+08:00'

export interface SignableDO {
  do_type: string
  status: string
  pdf_url: string | null
  created_at: string
}

/** True when this DO is a new store's first DO and the store has not signed it yet. */
export function needsStoreSignature(d: SignableDO): boolean {
  return d.do_type === 'initial'
    && d.status === 'acknowledged'
    && !d.pdf_url
    && Date.parse(d.created_at) >= Date.parse(INITIAL_DO_SIGNATURE_FROM)
}
