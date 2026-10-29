// Loads the low-stock settings rows. No server-only imports, so client pages
// (store and admin) can use it as well as the API routes.

import type { SupabaseClient } from '@supabase/supabase-js'
import { LOW_STOCK_SETTING_KEYS, parseLowStockSettings, type LowStockSettings } from './low-stock'

export async function loadLowStockSettings(db: SupabaseClient): Promise<LowStockSettings> {
  const { data } = await db.from('settings').select('key, value').in('key', Object.values(LOW_STOCK_SETTING_KEYS))
  return parseLowStockSettings(data ?? [])
}
