#!/usr/bin/env node
/**
 * Nightly off-site backup — exports every business-critical table to CSV.
 *
 * Run by .github/workflows/nightly-backup.yml, which uploads the CSVs as a
 * workflow artifact (kept 90 days). This is independent of Supabase's own
 * backups, so even a total project loss leaves us with at-most-24h-old data.
 *
 * Env (from GitHub secrets or .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Run locally: node scripts/export-backup.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!m) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!process.env[m[1]]) process.env[m[1]] = v
    }
  } catch {}
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const TABLES = [
  'stores',
  'profiles',
  'products',
  'sales',
  'commission_periods',
  'payment_receipts',
  'delivery_orders',
  'delivery_order_items',
  'stock_movements',
  'store_inventory',
  'restock_requests',
  'restock_request_items',
  'promos',
  'notifications',
]

const PAGE = 1000

function toCsv(rows) {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const esc = (v) => {
    if (v == null) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return `"${s.replace(/"/g, '""')}"`
  }
  const lines = [cols.map(esc).join(',')]
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','))
  return lines.join('\n')
}

async function exportTable(supabase, table, outDir) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) {
      // Table may not exist yet (e.g. on older DBs) — skip, don't fail the run
      console.warn(`  ⚠ ${table}: ${error.message} — skipped`)
      return 0
    }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  writeFileSync(resolve(outDir, `${table}.csv`), toCsv(rows))
  console.log(`  ✓ ${table}: ${rows.length} rows`)
  return rows.length
}

async function main() {
  const outDir = resolve(process.cwd(), 'backup-out')
  mkdirSync(outDir, { recursive: true })

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

  console.log(`🗄  Exporting from ${SUPABASE_URL}`)
  let total = 0
  for (const table of TABLES) {
    total += await exportTable(supabase, table, outDir)
  }
  console.log(`\n✓ Backup complete — ${total} total rows across ${TABLES.length} tables → backup-out/`)
}

main().catch((err) => {
  console.error('❌', err)
  process.exit(1)
})
