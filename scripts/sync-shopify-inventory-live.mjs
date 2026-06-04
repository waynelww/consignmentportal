#!/usr/bin/env node
/**
 * Live Shopify inventory resync — fetches every variant's inventoryQuantity
 * from Shopify Admin API and writes it onto products.shopify_inventory_qty.
 *
 * Unlike backfill-shopify-inventory.mjs (which embeds a static SKU→qty map),
 * this one talks to Shopify directly so it always reflects current stock.
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SHOPIFY_STORE_DOMAIN          (e.g. 3127c9.myshopify.com)
 *   SHOPIFY_ADMIN_TOKEN           (shpat_...)
 *
 * Run: node scripts/sync-shopify-inventory-live.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
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
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
  console.error('❌ Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN')
  process.exit(1)
}

const SHOPIFY_API_VERSION = '2024-10'

async function fetchAllInventory() {
  const skuToQty = new Map()
  let after = null
  let page = 0

  while (page < 50) {
    page++
    const query = `
      query Inventory($first: Int!, $after: String) {
        productVariants(first: $first, after: $after) {
          edges { node { sku inventoryQuantity } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `
    const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: { first: 100, after } }),
    })
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`)
    const json = await res.json()
    if (json.errors?.length) throw new Error(`GraphQL: ${json.errors.map((e) => e.message).join('; ')}`)

    const conn = json.data?.productVariants
    if (!conn) break
    for (const edge of conn.edges) {
      const sku = (edge.node.sku ?? '').trim().toUpperCase()
      if (!sku) continue
      const qty = edge.node.inventoryQuantity ?? 0
      // Max-merge across duplicate SKUs (rare but happens with bundles)
      const existing = skuToQty.get(sku)
      skuToQty.set(sku, existing == null ? qty : Math.max(existing, qty))
    }
    process.stdout.write(`\r  · page ${page}: ${skuToQty.size} unique SKUs`)
    if (!conn.pageInfo.hasNextPage) break
    after = conn.pageInfo.endCursor
  }
  process.stdout.write('\n')
  return skuToQty
}

async function main() {
  console.log(`🛒 Shopify: ${SHOPIFY_DOMAIN}`)
  console.log(`🗄  Supabase: ${SUPABASE_URL}`)
  console.log('')
  console.log('→ Fetching live inventory from Shopify…')
  const startFetch = Date.now()
  const skuToQty = await fetchAllInventory()
  console.log(`✓ ${skuToQty.size} variants fetched in ${((Date.now() - startFetch) / 1000).toFixed(1)}s`)
  console.log('')

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

  console.log('→ Fetching products from Supabase…')
  const { data: products, error } = await supabase
    .from('products')
    .select('id, sku, name, shopify_inventory_qty')
  if (error) {
    console.error('❌ Fetch failed:', error.message)
    process.exit(1)
  }
  console.log(`✓ ${products.length} products in DB`)
  console.log('')

  function resolveQty(sku) {
    if (skuToQty.has(sku)) return skuToQty.get(sku)
    const stripped = sku.replace(/X\d+$/i, '')
    if (stripped !== sku && skuToQty.has(stripped)) return skuToQty.get(stripped)
    if (/^[FH]/i.test(sku)) {
      const noPrefix = sku.replace(/^[FH]/i, '')
      if (skuToQty.has(noPrefix)) return skuToQty.get(noPrefix)
    }
    return null
  }

  let updated = 0
  let unchanged = 0
  let notFound = 0
  let totalPairs = 0
  const notFoundSkus = []
  const syncTime = new Date().toISOString()

  for (const p of products) {
    const sku = (p.sku ?? '').trim().toUpperCase()
    const rawQty = resolveQty(sku)
    if (rawQty == null) {
      notFound++
      notFoundSkus.push(`${p.sku} — ${p.name}`)
      continue
    }
    const qty = Math.max(0, rawQty)
    totalPairs += qty
    if (qty === p.shopify_inventory_qty) {
      await supabase.from('products').update({ shopify_inventory_synced_at: syncTime }).eq('id', p.id)
      unchanged++
      continue
    }
    const { error: updErr } = await supabase
      .from('products')
      .update({
        shopify_inventory_qty: qty,
        shopify_inventory_synced_at: syncTime,
        updated_at: syncTime,
      })
      .eq('id', p.id)
    if (updErr) {
      console.error(`  ✗ ${p.sku}: ${updErr.message}`)
    } else {
      updated++
      process.stdout.write(`\r  ✓ updated: ${updated}`)
    }
  }
  process.stdout.write('\n\n')

  console.log('═══════════════════════════════════════')
  console.log(`✓ Updated:           ${updated}`)
  console.log(`◦ Already current:   ${unchanged}`)
  console.log(`⚠ No mapping found:  ${notFound}`)
  console.log(`📦 Total warehouse:   ${totalPairs.toLocaleString()} pairs`)
  console.log(`🕐 Synced at:        ${syncTime}`)
  console.log('═══════════════════════════════════════')

  if (notFoundSkus.length) {
    console.log(`\nSKUs without Shopify match (${notFoundSkus.length}):`)
    notFoundSkus.slice(0, 30).forEach((s) => console.log(`  · ${s}`))
    if (notFoundSkus.length > 30) console.log(`  · … and ${notFoundSkus.length - 30} more`)
  }
}

main().catch((err) => {
  console.error('\n❌', err)
  process.exit(1)
})
