// Unit test for the Shopify catalogue matching rules (lib/shopify/catalogue-match.ts).
// Run: npx tsx scripts/test-catalogue-match.ts
import assert from 'node:assert/strict'
import {
  describeCatalogueSync,
  planCatalogueSync,
  type ShopifyVariant,
  type XcmsProduct,
} from '../lib/shopify/catalogue-match'

function v(over: Partial<ShopifyVariant> & Pick<ShopifyVariant, 'id'>): ShopifyVariant {
  const base: ShopifyVariant = {
    id: '',
    sku: null,
    title: 'Default',
    imageUrl: null,
    productTitle: 'Product',
    productImageUrl: null,
  }
  return { ...base, ...over }
}

function p(over: Partial<XcmsProduct> & Pick<XcmsProduct, 'id' | 'sku' | 'name'>): XcmsProduct {
  const base: XcmsProduct = { id: '', sku: '', name: '', image_url: null, shopify_variant_id: null }
  return { ...base, ...over }
}

// ---- 1. Link by SKU when exactly one variant has it (trim, case-insensitive) --
{
  const plan = planCatalogueSync(
    [p({ id: 'a', sku: ' ab12 ', name: 'Ankle Black' })],
    [v({ id: 'gid/1', sku: 'AB12', productTitle: 'Ankle', title: 'Black' })],
  )
  assert.deepEqual(plan.links, [{ productId: 'a', variantId: 'gid/1', via: 'sku' }])
  assert.equal(plan.skuChanges.length, 0, 'same SKU after normalising is not a rename')
}

// ---- 2. Shared SKU (several variants) is never linked ------------------------
{
  const plan = planCatalogueSync(
    [p({ id: 'a9', sku: 'A9', name: 'Plain Series A9' })],
    [
      v({ id: 'gid/1', sku: 'A9', productTitle: 'Plain Series', title: 'Ankle' }),
      v({ id: 'gid/2', sku: 'a9', productTitle: 'Plain Series', title: 'Ankle (Offline)' }),
      v({ id: 'gid/3', sku: 'A9', productTitle: 'We Want Jam x Xocks', title: 'Default' }),
    ],
  )
  assert.equal(plan.links.length, 0, 'shared SKU must not link')
  assert.equal(plan.notLinked.length, 1)
  assert.match(plan.notLinked[0].reason, /shared by 3 Shopify variants/)
}

// ---- 3. SKU missing in Shopify → name match (exactly one) and SKU follows ----
{
  const plan = planCatalogueSync(
    [p({ id: 'kuih', sku: 'OLDKUIH', name: 'Special Patches Series - White Kuih' })],
    [v({ id: 'gid/9', sku: ' whitekuihc26 ', productTitle: 'Special Patches Series', title: 'White Kuih' })],
  )
  assert.deepEqual(plan.links, [{ productId: 'kuih', variantId: 'gid/9', via: 'name' }])
  assert.deepEqual(plan.skuChanges, [{ productId: 'kuih', name: 'Special Patches Series - White Kuih', oldSku: 'OLDKUIH', newSku: 'WHITEKUIHC26' }])
  assert.equal(plan.skuConflicts.length, 0)
}

// ---- 4. Name match: case-insensitive, several matches → not linked -----------
{
  const plan = planCatalogueSync(
    [p({ id: 'x', sku: 'NOPE1', name: 'special patches series - white kuih' })],
    [
      v({ id: 'gid/1', sku: 'K1', productTitle: 'Special Patches Series', title: 'White Kuih' }),
      v({ id: 'gid/2', sku: 'K2', productTitle: 'Special Patches Series', title: 'White Kuih' }),
    ],
  )
  assert.equal(plan.links.length, 0)
  assert.match(plan.notLinked[0].reason, /name matches 2 Shopify variants/)
}

// ---- 5. Nothing matches → reported, not linked --------------------------------
{
  const plan = planCatalogueSync([p({ id: 'z', sku: 'ZZ9', name: 'Gone Product' })], [v({ id: 'gid/1', sku: 'AA1' })])
  assert.equal(plan.links.length, 0)
  assert.equal(plan.notLinked[0].reason, 'not found in Shopify by SKU or name')
}

// ---- 6. A variant already linked to another product is never linked again ----
{
  const plan = planCatalogueSync(
    [
      p({ id: 'owner', sku: 'SAME', name: 'Owner', shopify_variant_id: 'gid/1' }),
      p({ id: 'other', sku: 'SAME', name: 'Other' }),
    ],
    [v({ id: 'gid/1', sku: 'SAME' })],
  )
  assert.equal(plan.links.length, 0, 'already-claimed variant must not be linked twice')
  assert.match(plan.notLinked[0].reason, /already linked to Owner/)
}

// ---- 7. SKU rename on a linked product, logged as a change --------------------
{
  const plan = planCatalogueSync(
    [p({ id: 'r', sku: 'OLD1', name: 'Renamed', shopify_variant_id: 'gid/5' })],
    [v({ id: 'gid/5', sku: 'new1' })],
  )
  assert.deepEqual(plan.skuChanges, [{ productId: 'r', name: 'Renamed', oldSku: 'OLD1', newSku: 'NEW1' }])
}

// ---- 8. Rename conflict: new SKU used by another XCMS product → nothing changes
{
  const plan = planCatalogueSync(
    [
      p({ id: 'a', sku: 'OLD', name: 'Alpha', shopify_variant_id: 'gid/1', image_url: 'old.jpg' }),
      p({ id: 'b', sku: 'TAKEN', name: 'Beta' }),
    ],
    [v({ id: 'gid/1', sku: 'TAKEN', imageUrl: 'new.jpg' })],
  )
  assert.equal(plan.skuChanges.length, 0)
  assert.equal(plan.skuConflicts.length, 1)
  assert.equal(plan.skuConflicts[0].conflictProductId, 'b')
  assert.equal(plan.skuConflicts[0].conflictName, 'Beta')
  // The photo is independent of the SKU and still follows Shopify.
  assert.deepEqual(plan.photoUpdates, [{ productId: 'a', oldUrl: 'old.jpg', newUrl: 'new.jpg' }])
}

// ---- 9. Conflicts are checked against SKU owners as the run stands -----------
{
  const plan = planCatalogueSync(
    [
      p({ id: 'a', sku: 'SWAP1', name: 'A', shopify_variant_id: 'gid/1' }),
      p({ id: 'b', sku: 'SWAP2', name: 'B', shopify_variant_id: 'gid/2' }),
    ],
    [v({ id: 'gid/1', sku: 'SWAP2' }), v({ id: 'gid/2', sku: 'SWAP3' })],
  )
  // A wants SWAP2, which B still holds when A is planned → conflict (no swap in one run).
  // B then moves to SWAP3, which nobody holds → applied.
  assert.equal(plan.skuConflicts.length, 1)
  assert.equal(plan.skuChanges.length, 1)
  assert.equal(plan.skuChanges[0].productId, 'b')
}

// ---- 10. Photo: variant image, fall back to product featured image ------------
{
  const plan = planCatalogueSync(
    [
      p({ id: 'img', sku: 'I1', name: 'Img', shopify_variant_id: 'gid/1', image_url: 'same.jpg' }),
      p({ id: 'fb', sku: 'F1', name: 'Fallback', shopify_variant_id: 'gid/2', image_url: 'old.jpg' }),
      p({ id: 'none', sku: 'N1', name: 'NoImage', shopify_variant_id: 'gid/3', image_url: 'keep.jpg' }),
    ],
    [
      v({ id: 'gid/1', sku: 'I1', imageUrl: 'same.jpg' }),
      v({ id: 'gid/2', sku: 'F1', imageUrl: null, productImageUrl: 'featured.jpg' }),
      v({ id: 'gid/3', sku: 'N1', imageUrl: null, productImageUrl: null }),
    ],
  )
  assert.deepEqual(plan.photoUpdates, [{ productId: 'fb', oldUrl: 'old.jpg', newUrl: 'featured.jpg' }])
}

// ---- 11. Linked product whose variant is gone from Shopify: left alone -------
{
  const plan = planCatalogueSync(
    [p({ id: 'gone', sku: 'G1', name: 'Gone', shopify_variant_id: 'gid/404', image_url: 'x.jpg' })],
    [v({ id: 'gid/1', sku: 'G1' })],
  )
  assert.equal(plan.skuChanges.length, 0)
  assert.equal(plan.photoUpdates.length, 0)
  assert.equal(plan.linkedMissing.length, 1)
}

// ---- 12. Empty Shopify SKU never blanks an XCMS SKU -------------------------
{
  const plan = planCatalogueSync(
    [p({ id: 'blank', sku: 'KEEP1', name: 'Blank', shopify_variant_id: 'gid/1' })],
    [v({ id: 'gid/1', sku: '   ' })],
  )
  assert.equal(plan.skuChanges.length, 0)
}

// ---- 13. Result lines ------------------------------------------------------
{
  const plan = planCatalogueSync(
    [
      p({ id: 'kuih', sku: 'OLDKUIH', name: 'Special Patches Series - White Kuih' }),
      p({ id: 'shared', sku: 'A9', name: 'Plain Series - Ankle' }),
    ],
    [
      v({ id: 'gid/9', sku: 'WHITEKUIHC26', productTitle: 'Special Patches Series', title: 'White Kuih' }),
      v({ id: 'gid/a', sku: 'A9', productTitle: 'Plain Series', title: 'Ankle' }),
      v({ id: 'gid/b', sku: 'A9', productTitle: 'Plain Series', title: 'Ankle (Offline)' }),
    ],
  )
  const lines = describeCatalogueSync(plan, 3)
  assert.equal(lines[0], 'SKUs updated: OLDKUIH → WHITEKUIHC26')
  assert.equal(lines[1], 'Photos updated: 3')
  assert.ok(lines.includes('Not linked: 1'))
  assert.ok(lines.some((l) => l.includes('Plain Series - Ankle (A9): SKU is shared by 2 Shopify variants')))

  const none = describeCatalogueSync(planCatalogueSync([], []), 0)
  assert.equal(none[0], 'SKUs updated: none')
}

console.log('test-catalogue-match: all checks passed')
