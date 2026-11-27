// Pins which Shopify product a SKU's name and photo come from
// (lib/shopify/catalogue-source.ts). Run: npx tsx scripts/test-catalogue-source.ts
import assert from 'node:assert/strict'
import { isCollabProductTitle, pickName, pickPhoto, rankSources, sourceTier, type SourceVariant } from '../lib/shopify/catalogue-source'
import { planCatalogueSync, type ShopifyVariant, type XcmsProduct } from '../lib/shopify/catalogue-match'

let n = 0
const v = (productTitle: string, opts: Partial<SourceVariant> = {}): SourceVariant => ({
  id: `gid://shopify/ProductVariant/${++n}`,
  sku: 'C27',
  title: 'Classic Black',
  imageUrl: `https://img/${encodeURIComponent(productTitle)}/variant.jpg`,
  productTitle,
  productImageUrl: `https://img/${encodeURIComponent(productTitle)}/featured.jpg`,
  productStatus: 'ACTIVE',
  ...opts,
})

// Collab titles
for (const t of ['Xocks x Luwis — Socks', 'We Want Jam x Xocks (Adults)', 'We Want Jam x Xocks (Kids)', 'WWJ Socks', 'wwj kids']) {
  assert.equal(isCollabProductTitle(t), true, t)
}
for (const t of ['Plain Series - Crew', 'Crew (Offline)', 'Cool Blues', 'Mens Womens Everyday Socks 20 BEST SELLING COLOURS']) {
  assert.equal(isCollabProductTitle(t), false, t)
}

// Tiers
assert.equal(sourceTier('Plain Series - Crew'), 0)
assert.equal(sourceTier('Plain Series - No Show Socks (Offline)'), 0)
assert.equal(sourceTier('Plain Series Trial Bundle'), 2, 'Trial Bundle is not Plain Series')
assert.equal(sourceTier('Crew (Offline)'), 1)
assert.equal(sourceTier('Cool Blues'), 2)

// The reported bug: a collab product listed after Plain Series must not win
const luwis = v('Xocks x Luwis — Socks', { imageUrl: 'https://img/luwis-ankle.jpg' })
const wwj = v('We Want Jam x Xocks (Adults)', { productStatus: 'ARCHIVED' })
const offline = v('Crew (Offline)')
const plain = v('Plain Series - Crew')
const bundle = v('Cool Blues')
assert.equal(pickPhoto([luwis, wwj, bundle, offline, plain])?.url, plain.imageUrl)
assert.equal(pickName([luwis, wwj, bundle, offline, plain]), 'Plain Series - Crew - Classic Black')
// Without Plain Series: (Offline) next, then other active
assert.equal(pickPhoto([luwis, bundle, offline])?.variant.productTitle, 'Crew (Offline)')
assert.equal(pickPhoto([luwis, bundle])?.variant.productTitle, 'Cool Blues')
// Only collab products → nothing
assert.equal(pickPhoto([luwis, wwj]), null)
assert.equal(pickName([luwis, wwj]), null)

// Archived / draft never used while an active product has the SKU, even if it ranks higher
const archivedPlain = v('Plain Series - Crew', { productStatus: 'ARCHIVED' })
const draftPlain = v('Plain Series - Crew', { productStatus: 'DRAFT' })
assert.equal(pickPhoto([archivedPlain, draftPlain, bundle])?.variant.productTitle, 'Cool Blues')
// …but used when nothing active is left
assert.equal(pickPhoto([archivedPlain, luwis])?.variant.id, archivedPlain.id)

// Variant image first, then the product's featured image; skip a source with neither
const noVariantImg = v('Plain Series - Crew', { imageUrl: null })
assert.equal(pickPhoto([noVariantImg, offline])?.url, noVariantImg.productImageUrl)
const noImg = v('Plain Series - Crew', { imageUrl: null, productImageUrl: null })
assert.equal(pickPhoto([noImg, offline])?.url, offline.imageUrl)

// Two Plain Series products (No Show and No Show (Offline)): the one without "(Offline)"
const ns = v('Plain Series - No Show Socks', { sku: 'V27' })
const nsOff = v('Plain Series - No Show Socks (Offline)', { sku: 'V27' })
assert.equal(rankSources([nsOff, ns])[0].productTitle, 'Plain Series - No Show Socks')

// Kids keep the "Plain Series - For Kids (4YO to 12 YO) - <colour>" format
const kidsPlain = v('Plain Series - For Kids (4YO to 12 YO)', { sku: 'K9', title: 'Pink Ponk' })
const kidsOff = v('Kids (Offline)', { sku: 'K9', title: 'Pink Ponk' })
const kidsWwj = v('We Want Jam x Xocks (Kids)', { sku: 'K9', title: 'Pink Ponk', productStatus: 'ARCHIVED' })
assert.equal(pickName([kidsWwj, kidsOff, kidsPlain]), 'Plain Series - For Kids (4YO to 12 YO) - Pink Ponk')

// ── catalogue-match uses the same rule for a linked product's photo ─────────
const sv = (x: SourceVariant): ShopifyVariant => x as ShopifyVariant
const linkedPlain = v('Plain Series - Half', { sku: 'H9', title: 'Grey Blue' })
const sameSkuLuwis = v('Xocks x Luwis — Socks', { sku: 'H9', title: 'Grey Blue', imageUrl: 'https://img/luwis.jpg' })
const products: XcmsProduct[] = [
  { id: 'p1', sku: 'H9', name: 'Plain Series - Half - Grey Blue', image_url: 'https://old.jpg', shopify_variant_id: linkedPlain.id },
]
const plan = planCatalogueSync(products, [sv(sameSkuLuwis), sv(linkedPlain)])
assert.deepEqual(plan.photoUpdates.map((u) => u.newUrl), [linkedPlain.imageUrl])
// A product linked to a collab variant gets no photo from it
const linkedCollab: XcmsProduct[] = [
  { id: 'p2', sku: 'LUWIS1', name: 'Luwis thing', image_url: 'https://keep.jpg', shopify_variant_id: 'gid://x/1' },
]
const plan2 = planCatalogueSync(linkedCollab, [sv(v('Xocks x Luwis — Socks', { id: 'gid://x/1', sku: 'LUWIS1' }))])
assert.equal(plan2.photoUpdates.length, 0)
// Shared SKUs are still not linked by ID (links unchanged)
const plan3 = planCatalogueSync(
  [{ id: 'p3', sku: 'C27', name: 'Plain Series - Crew - Classic Black', image_url: null, shopify_variant_id: null }],
  [sv(plain), sv(luwis)],
)
assert.equal(plan3.links.length, 0)
assert.equal(plan3.notLinked.length, 1)

console.log('test-catalogue-source: all passed')
