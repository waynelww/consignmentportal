#!/usr/bin/env node
/**
 * One-shot backfill: pulls every product variant from Shopify Admin GraphQL,
 * builds a SKU → variant-image URL map, then UPDATEs products.image_url in Supabase.
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SHOPIFY_STORE_DOMAIN          (e.g. 3127c9.myshopify.com  or  xocks.myshopify.com)
 *   SHOPIFY_ADMIN_TOKEN           (shpat_...)
 *
 * Run: node scripts/backfill-shopify-images.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── Load .env.local manually (no dotenv dependency) ─────────────────────────
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!m) continue
      const k = m[1]
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (!process.env[k]) process.env[k] = v
    }
  } catch {
    /* ok if missing */
  }
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SHOP_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN
const SHOP_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN

const missing = []
if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL')
if (!SUPABASE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (!SHOP_DOMAIN) missing.push('SHOPIFY_STORE_DOMAIN')
if (!SHOP_TOKEN) missing.push('SHOPIFY_ADMIN_TOKEN')
if (missing.length) {
  console.error(`❌ Missing env vars in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

const API_VERSION = '2024-10'
const SHOP_URL = `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`

const QUERY = `
  query AllVariants($first: Int!, $after: String) {
    productVariants(first: $first, after: $after) {
      edges {
        cursor
        node {
          sku
          image { url }
          product { featuredImage { url } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

async function fetchAllVariants() {
  const skuToImage = new Map()
  let after = null
  let page = 0

  while (true) {
    page++
    const res = await fetch(SHOP_URL, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOP_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: QUERY, variables: { first: 100, after } }),
    })

    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Shopify HTTP ${res.status}: ${txt}`)
    }

    const json = await res.json()
    if (json.errors?.length) {
      throw new Error(`Shopify GraphQL: ${json.errors.map((e) => e.message).join('; ')}`)
    }

    const conn = json.data?.productVariants
    if (!conn) break

    for (const edge of conn.edges) {
      const sku = (edge.node.sku ?? '').trim().toUpperCase()
      if (!sku) continue
      const url = edge.node.image?.url ?? edge.node.product?.featuredImage?.url ?? null
      if (url) skuToImage.set(sku, url)
    }

    process.stdout.write(`\r📦 Fetched page ${page} · ${skuToImage.size} SKUs so far`)

    if (!conn.pageInfo.hasNextPage) break
    after = conn.pageInfo.endCursor
  }
  process.stdout.write('\n')
  return skuToImage
}

async function main() {
  console.log(`🛒 Shopify: ${SHOP_DOMAIN}`)
  console.log(`🗄  Supabase: ${SUPABASE_URL}`)
  console.log('')
  console.log('Step 1/3 — Fetching all variants from Shopify...')

  const skuToImage = await fetchAllVariants()
  console.log(`✓ ${skuToImage.size} unique SKUs with images`)
  console.log('')

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  })

  console.log('Step 2/3 — Fetching products from Supabase...')
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, sku, name, image_url')
  if (prodErr) {
    console.error('❌ Failed to fetch products:', prodErr.message)
    process.exit(1)
  }
  console.log(`✓ ${products.length} products in DB`)
  console.log('')

  console.log('Step 3/3 — Updating image_url per SKU...')
  let updated = 0
  let unchanged = 0
  let notFound = 0
  const notFoundList = []

  for (const p of products) {
    const sku = (p.sku ?? '').trim().toUpperCase()
    const newUrl = skuToImage.get(sku)

    if (!newUrl) {
      notFound++
      notFoundList.push(`${p.sku} (${p.name})`)
      continue
    }
    if (newUrl === p.image_url) {
      unchanged++
      continue
    }

    const { error: updErr } = await supabase
      .from('products')
      .update({ image_url: newUrl, updated_at: new Date().toISOString() })
      .eq('id', p.id)

    if (updErr) {
      console.error(`  ✗ ${p.sku}: ${updErr.message}`)
    } else {
      updated++
      process.stdout.write(`\r  ✓ ${updated} updated...`)
    }
  }
  process.stdout.write('\n')
  console.log('')

  console.log('═══════════════════════════════════════')
  console.log(`✓ Updated:           ${updated}`)
  console.log(`◦ Already current:   ${unchanged}`)
  console.log(`⚠ Not in Shopify:    ${notFound}`)
  console.log('═══════════════════════════════════════')

  if (notFoundList.length && notFoundList.length <= 30) {
    console.log('\nSKUs not found in Shopify:')
    notFoundList.forEach((s) => console.log(`  · ${s}`))
  } else if (notFoundList.length) {
    console.log(`\nFirst 30 SKUs not found in Shopify (of ${notFoundList.length}):`)
    notFoundList.slice(0, 30).forEach((s) => console.log(`  · ${s}`))
  }
}

main().catch((err) => {
  console.error('\n❌', err.message)
  process.exit(1)
})
