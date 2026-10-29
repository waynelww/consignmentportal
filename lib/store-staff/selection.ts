/**
 * The staff member currently selected on this phone for a store.
 * Kept in localStorage (per store, per browser) until changed. Storage can be
 * blocked (private mode), in which case the pick simply lasts for this visit.
 */

const CHANGE_EVENT = 'xcms-selected-staff-change'

const keyFor = (storeId: string) => `xcms.selectedStaff.${storeId}`

export function getSelectedStaffId(storeId: string): string | null {
  try {
    return window.localStorage.getItem(keyFor(storeId))
  } catch {
    return null
  }
}

export function setSelectedStaffId(storeId: string, staffId: string | null): void {
  try {
    if (staffId) window.localStorage.setItem(keyFor(storeId), staffId)
    else window.localStorage.removeItem(keyFor(storeId))
  } catch {
    // Storage blocked: fall through and still notify listeners
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function subscribeSelectedStaff(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}
