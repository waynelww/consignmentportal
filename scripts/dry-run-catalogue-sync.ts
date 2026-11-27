// READ-ONLY dry run of the Shopify → XCMS catalogue syncs. Writes nothing.
// Shows what the next run would change in products (SKU, photo, link), using
// the same rules as the real syncs:
//   - hourly / nightly / Refresh: planCatalogueSync (lib/shopify/catalogue-match.ts)
//   - daily image sync / "Sync images": pickPhoto per SKU (lib/shopify/catalogue-source.ts)
// Also checks each A/C/H/V/K product's name against the name the source rule
// would pick (for information: no sync writes names).
//
// Needs SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY in the environment.
// Run: npx tsx scripts/dry-run-catalogue-sync.ts
import { planCatalogueSync, type ShopifyVariant, type XcmsProduct } from '../lib/shopify/catalogue-match'
import { pickName, pickPhoto } from '../lib/shopify/catalogue-source'
import { normalizeSku } from '../lib/stock/hq-availability'

const CUT_CODE = /^[ACHVK]\d+$/

const QUERY = `query($after: String) {
  productVariants(first: 100, after: $after) {
    nodes { id sku title image { url } product { title status featuredImage { url } } }
    pageInfo { hasNextPage endCursor }
  }
}`

interface Node {
  id: string; sku: string | null; title: string; image: { url: string } | null
  product: { title: string; status: string | null; featuredImage: { url: string } | null } | null
}

async function shopifyVariants(): Promise<ShopifyVariant[]> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN, token = process.env.SHOPIFY_ADMIN_TOKEN
  if (!domain || !token) throw new Error('SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN missing')
  const out: ShopifyVariant[] = []
  let after: string | null = null
  for (let page = 0; page < 100; page++) {
    const res = await fetch(`https://${domain}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { after } }),
    })
    const json = (await res.json()) as { data?: { productVariants: { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }; errors?: unknown }
    if (!json.data) throw new Error(`Shopify: ${JSON.stringify(json.errors)}`)
    for (const n of json.data.productVariants.nodes) {
      out.push({
        id: n.id, sku: n.sku, title: n.title, imageUrl: n.image?.url ?? null,
        productTitle: n.product?.title ?? '', productImageUrl: n.product?.featuredImage?.url ?? null,
        productStatus: n.product?.status ?? null,
      })
    }
    if (!json.data.productVariants.pageInfo.hasNextPage) return out
    after = json.data.productVariants.pageInfo.endCursor
  }
  throw new Error('too many variants')
}

async function xcmsProducts(): Promise<(XcmsProduct & { category: string | null })[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
  const rows: (XcmsProduct & { category: string | null })[] = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${url}/rest/v1/products?select=id,sku,name,category,image_url,shopify_variant_id&order=id`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` },
    })
    const page = (await res.json()) as (XcmsProduct & { category: string | null })[]
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

async function main() {
  const [variants, products] = await Promise.all([shopifyVariants(), xcmsProducts()])
  const isCut = (sku: string) => CUT_CODE.test(normalizeSku(sku))
  console.log(`Shopify variants: ${variants.length} · XCMS products: ${products.length} (A/C/H/V/K: ${products.filter((p) => isCut(p.sku)).length})\n`)

  // 1. Hourly / nightly / Refresh
  const plan = planCatalogueSync(products, variants)
  const byId = new Map(products.map((p) => [p.id, p]))
  const label = (id: string) => { const p = byId.get(id)!; return `${p.sku} ${p.name}` }
  console.log('== Hourly / nightly / Refresh from Shopify (catalogue step) ==')
  const report = (name: string, rows: { productId: string; text: string }[]) => {
    const cut = rows.filter((r) => isCut(byId.get(r.productId)!.sku))
    console.log(`${name}: A/C/H/V/K ${cut.length} · other ${rows.length - cut.length}`)
    for (const r of rows) console.log(`  - ${label(r.productId)}${r.text}`)
  }
  report('New links', plan.links.map((l) => ({ productId: l.productId, text: ` (by ${l.via})` })))
  report('SKU renames', plan.skuChanges.map((c) => ({ productId: c.productId, text: ` → ${c.newSku}` })))
  report('Photo updates', plan.photoUpdates.map((u) => ({ productId: u.productId, text: `\n      ${u.oldUrl}\n   →  ${u.newUrl}` })))
  console.log(`SKU conflicts: ${plan.skuConflicts.length}`)
  for (const c of plan.skuConflicts) console.log(`  - ${c.name} stays ${c.oldSku}; ${c.newSku} used by ${c.conflictName}`)

  // 2. Daily image sync / Sync images
  const bySku = new Map<string, ShopifyVariant[]>()
  for (const v of variants) {
    const k = normalizeSku(v.sku)
    if (k) bySku.set(k, [...(bySku.get(k) ?? []), v])
  }
  const imageChanges = products
    .map((p) => ({ p, photo: pickPhoto(bySku.get(normalizeSku(p.sku)) ?? []) }))
    .filter(({ p, photo }) => photo && photo.url !== p.image_url)
  console.log('\n== Daily image sync / Sync images (new rule) ==')
  console.log(`Photo updates: A/C/H/V/K ${imageChanges.filter((x) => isCut(x.p.sku)).length} · other ${imageChanges.filter((x) => !isCut(x.p.sku)).length}`)
  for (const { p, photo } of imageChanges) {
    console.log(`  - ${p.sku} ${p.name} (from "${photo!.variant.productTitle}")\n      ${p.image_url}\n   →  ${photo!.url}`)
  }

  // For comparison: what the OLD image sync (last variant wins) would have done
  const lastWins = new Map<string, string>()
  for (const v of variants) {
    const k = normalizeSku(v.sku)
    const u = v.imageUrl ?? v.productImageUrl
    if (k && u) lastWins.set(k, u)
  }
  const oldChanges = products.filter((p) => isCut(p.sku) && lastWins.get(normalizeSku(p.sku)) && lastWins.get(normalizeSku(p.sku)) !== p.image_url)
  console.log(`\n(Old image sync rule would have changed ${oldChanges.length} A/C/H/V/K photos: ${oldChanges.map((p) => p.sku).join(', ') || 'none'})`)

  // 3. Names (information only: no sync writes names)
  const nameDiffs = products
    .filter((p) => isCut(p.sku))
    .map((p) => ({ p, want: pickName(bySku.get(normalizeSku(p.sku)) ?? []) }))
    .filter(({ p, want }) => want && want !== p.name)
  console.log('\n== Names (information only, never written by any sync) ==')
  // Shopify variant titles carry the colour number ("28 Orange Ginger"); XCMS names do not.
  const onlyNumber = nameDiffs.filter(({ p, want }) => want!.replace(/ - \d+ /, ' - ') === p.name)
  const realDiffs = nameDiffs.filter((x) => !onlyNumber.includes(x))
  console.log(`A/C/H/V/K names that differ from the source rule's pick: ${nameDiffs.length}`)
  console.log(`  only by Shopify's leading colour number ("28 Orange Ginger"): ${onlyNumber.length}`)
  console.log(`  otherwise: ${realDiffs.length}`)
  for (const { p, want } of realDiffs) console.log(`  - ${p.sku}: "${p.name}" vs "${want}"`)
  const kids = products.filter((p) => /^K\d+$/.test(normalizeSku(p.sku)))
  const kidsBad = kids.filter((p) => !/^Plain Series - For Kids \(4YO to 12 YO\) - .+/.test(p.name))
  console.log(`Kids names in "Plain Series - For Kids (4YO to 12 YO) - <colour>" format: ${kids.length - kidsBad.length}/${kids.length}`)
  const noSource = products.filter((p) => isCut(p.sku) && !pickPhoto(bySku.get(normalizeSku(p.sku)) ?? []))
  console.log(`A/C/H/V/K products with no usable Shopify source (photo left as is): ${noSource.map((p) => p.sku).join(', ') || 'none'}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
