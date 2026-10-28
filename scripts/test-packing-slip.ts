// Test for the 4 x 6 inch restock packing slip (lib/pdf/generate-slip.ts).
// Run: npx tsx scripts/test-packing-slip.ts [outDir]
// With outDir, the generated PDFs are written there for a visual check
// (e.g. pdftoppm -png -r 150 slip-22.pdf slip-22).
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { buildPackingSlip, slipItemText, slipDate, SLIP_WIDTH, SLIP_HEIGHT, type SlipItem, type SlipParams } from '../lib/pdf/generate-slip'

const outDir = process.argv[2]
if (outDir) mkdirSync(outDir, { recursive: true })

// ── Item text ───────────────────────────────────────────────────────────
assert.equal(slipItemText('Plain Series - Ankle - Charcoal Blue'), 'Charcoal Blue · Ankle')
assert.equal(slipItemText('Plain Series - Crew - 16 Charcoal Blue'), 'Charcoal Blue · Crew') // leading number dropped
assert.equal(slipItemText('Plain Series - No Show Socks - Aqua Blue', 'no_show'), 'Aqua Blue · No Show')
assert.equal(slipItemText('Special Patches Series - White Kuih'), 'White Kuih · Patches')
assert.equal(slipItemText('Crew (Offline) - Pearlple', 'crew'), 'Pearlple · Crew')
assert.equal(slipItemText('We Want Jam x Xocks (Adults) - Grey Green', 'ankle'), 'Grey Green · Ankle')
assert.equal(slipItemText('Raya Socks 2026'), 'Raya Socks 2026')
assert.equal(slipDate('2026-10-27T06:31:58Z'), '27 October 2026')
assert.equal(slipDate('2026-10-27T17:00:00Z'), '28 October 2026') // Malaysia time

const store = {
  storeName: 'Vaernand store',
  address: '6 jalan daun inai 18 sunway spk damansara\nno 6',
  postcode: '52200', city: 'kuala lumpur', state: 'Kuala Lumpur',
  picName: 'vaernand', picPhone: '0128940117',
}
const plain = (i: number): SlipItem => ({
  sku: `${['A', 'C', 'H'][i % 3]}${i + 1}`,
  name: `Plain Series - ${['Ankle', 'Crew', 'Half'][i % 3]} - ${['Charcoal Blue', 'Light Purple Blue', 'Classic Green', 'Teddy Brown'][i % 4]}`,
  quantity: (i % 4) + 1,
})
const patch = (i: number): SlipItem => ({
  sku: ['WHITEKUIH', 'HALFSILVERPORCUPINE', 'BLUEELEPHANT', 'PCOCONUT'][i % 4],
  name: ['Special Patches Series - White Kuih', 'Special Patches Series - Half Silver Porcupine', 'Special Patches Series - Blue Elephant', 'Patches Socks (LOKAL Jehhh)'][i % 4],
  quantity: 2,
})

async function check(name: string, params: SlipParams, expect: { labels: number; columns: 1 | 2 } | null) {
  const { bytes, pages } = await buildPackingSlip(params)
  if (outDir) writeFileSync(join(outDir, `${name}.pdf`), bytes)

  // Page size is exactly 4 x 6 in on every label
  const doc = await PDFDocument.load(bytes)
  if (expect) assert.equal(doc.getPageCount(), expect.labels, `${name}: label count`)
  for (const pg of doc.getPages()) {
    assert.equal(pg.getWidth(), SLIP_WIDTH, `${name}: width`)
    assert.equal(pg.getHeight(), SLIP_HEIGHT, `${name}: height`)
  }
  assert.equal(SLIP_WIDTH, 4 * 72)
  assert.equal(SLIP_HEIGHT, 6 * 72)

  assert.equal(pages.reduce((a, p) => a + p.rows, 0), params.items.length, `${name}: every item printed once`)
  for (const p of pages) {
    // the final label of a multi-label slip may drop back to one column
    if (expect && !(pages.length > 1 && p === pages[pages.length - 1])) assert.equal(p.columns, expect.columns, `${name}: columns`)
    assert.ok(p.rows >= 1, `${name}: no empty label`)
    assert.equal(p.rowLines, p.rows, `${name}: a line under every row`)
    assert.ok(p.rowHeight >= 8.5 && p.rowHeight <= 13, `${name}: row height ${p.rowHeight}`)
    assert.ok(p.fontSize >= 6.5 && p.fontSize <= 9, `${name}: font ${p.fontSize}`)
    assert.ok(p.rowsBottom < p.rowsTop)
    if (p.totalsTop !== null) {
      // totals sit under the rows, Packed by sits under the totals, footer under that
      const totalsBottom = p.totalsTop - 18
      const packedLineTop = p.packedByBottom! + 18
      assert.ok(p.totalsTop <= p.rowsBottom, `${name}: totals below rows`)
      assert.ok(totalsBottom > packedLineTop + 4, `${name}: totals clear of Packed by (${totalsBottom} vs ${packedLineTop})`)
      assert.ok(p.packedByBottom! - 2 > p.footerTop!, `${name}: Packed by clear of footer (${p.packedByBottom} vs ${p.footerTop})`)
      assert.ok(p.footerTop! < 60, `${name}: footer at the bottom`)
    } else {
      assert.ok(p.continuedNote, `${name}: continued note on non-last labels`)
      assert.ok(p.rowsBottom > 14 + 18, `${name}: rows clear of the continued note`)
    }
  }
  const last = pages[pages.length - 1]
  assert.ok(last.totalsTop !== null && last.footerTop !== null, `${name}: totals + footer on the last label`)
  if (!expect) return pages
  console.log(`${name}: ${pages.length} label(s), ${pages.map((p) => `${p.rows} rows × ${p.columns} col @ ${p.rowHeight}pt/${p.fontSize}pt`).join(' | ')}`)
}

async function main() {
  // DO-2026-0052: A1, A11, A16 × 1 pair each (live data)
  await check('slip-DO-2026-0052', {
    doNumber: 'DO-2026-0052', createdAt: '2026-10-27T06:31:58.792Z', ...store,
    items: [
      { sku: 'A1', name: 'Plain Series - Ankle - Purple Blue', quantity: 1 },
      { sku: 'A11', name: 'Plain Series - Ankle - Classic Green', quantity: 1 },
      { sku: 'A16', name: 'Plain Series - Ankle - Charcoal Blue', quantity: 1 },
    ],
  }, { labels: 1, columns: 1 })

  // Typical restock: 22 SKUs (mix of plain and patches) → one label, one column
  await check('slip-22', {
    doNumber: 'DO-2026-0099', createdAt: '2026-10-27T06:31:58Z', ...store,
    items: [...Array.from({ length: 18 }, (_, i) => plain(i)), ...Array.from({ length: 4 }, (_, i) => patch(i))],
  }, { labels: 1, columns: 1 })

  // Long address + 26 SKUs: one column no longer fits at 8.5pt → two columns, still one label
  await check('slip-26-long-address', {
    doNumber: 'DO-2026-0100', createdAt: '2026-10-27T06:31:58Z', ...store,
    storeName: 'Montanic Adventure Store Suria Sabah Shopping Mall Lot G-12',
    address: 'Lot G-12, Ground Floor, Suria Sabah Shopping Mall, 1 Jalan Tun Fuad Stephens, Kota Kinabalu Waterfront',
    items: Array.from({ length: 26 }, (_, i) => (i % 5 === 0 ? patch(i) : plain(i))),
  }, { labels: 1, columns: 2 })

  // Too many for one column → two columns on one label
  await check('slip-40', {
    doNumber: 'DO-2026-0101', createdAt: '2026-10-27T06:31:58Z', ...store,
    items: Array.from({ length: 40 }, (_, i) => (i % 6 === 0 ? patch(i) : plain(i))),
  }, { labels: 1, columns: 2 })

  // Too many for two columns → extra labels
  await check('slip-120', {
    doNumber: 'DO-2026-0102', createdAt: '2026-10-27T06:31:58Z', ...store,
    items: Array.from({ length: 120 }, (_, i) => plain(i)),
  }, { labels: 3, columns: 2 })

  // Store with no contact / odd characters must not break the slip
  await check('slip-minimal', {
    doNumber: 'DO-2026-0103', createdAt: '2026-10-27T06:31:58Z',
    storeName: 'Kedai “Ūnicode” 店', address: null, postcode: null, city: null, state: null, picName: null, picPhone: null,
    items: [{ sku: 'A1', name: 'Plain Series - Ankle - Purple Blue', quantity: 3 }],
  }, { labels: 1, columns: 1 })

  // Real restock DO-2026-0032 (18 SKUs); its phone has invisible bidi marks
  // and a non-breaking hyphen that must print as plain text
  const real: SlipParams = {
    doNumber: 'DO-2026-0032', createdAt: '2026-07-08T07:27:59.568Z',
    storeName: 'Montanic Adventure Store SS2 PJ',
    address: 'No,58 & 60, Jalan SS 2/4A, Taman Bahagia, 47300 Petaling Jaya, Selangor Darul Ehsan',
    postcode: '47300', city: 'Petaling Jaya', state: 'Selangor', picName: 'Mr Azmi ', picPhone: '\u202A+60 13\u2011676 2004\u202C',
    items: ['A10','A18','A26','A30','A39','A4','C10','C18','C26','C30','C39','C4','H10','H18','H26','H30','H39','H4'].map((sku) => ({
      sku, quantity: 3,
      name: `Plain Series - ${({ A: 'Ankle', C: 'Crew', H: 'Half' } as Record<string, string>)[sku[0]]} - Colour ${sku}`,
    })),
  }
  await check('slip-DO-2026-0032', real, { labels: 1, columns: 1 })
  const realPdf = await PDFDocument.load((await buildPackingSlip(real)).bytes)
  assert.equal(realPdf.getTitle(), 'Packing slip DO-2026-0032')

  // Every size from 1 to 200 SKUs: 1 col → 2 cols → extra labels, evenly
  // filled, nothing overlapping
  let prevLabels = 1
  for (let n = 1; n <= 200; n++) {
    const pages = (await check(`sweep-${n}`, {
      doNumber: 'DO-2026-0104', createdAt: '2026-10-27T06:31:58Z', ...store,
      items: Array.from({ length: n }, (_, i) => (i % 7 === 0 ? patch(i) : plain(i))),
    }, null))!
    assert.ok(pages.length >= prevLabels, `sweep-${n}: label count never goes down`)
    prevLabels = pages.length
    if (n <= 22) assert.equal(pages.length, 1)
    if (n <= 22) assert.equal(pages[0].columns, 1, `sweep-${n}: up to 22 SKUs fit one column`)
    if (pages.length > 1) {
      const rows = pages.map((p) => p.rows)
      assert.ok(Math.max(...rows) - Math.min(...rows) <= Math.ceil(n / pages.length), `sweep-${n}: balanced ${rows}`)
    }
  }
  console.log(`sweep 1–200 SKUs ok (200 SKUs → ${prevLabels} labels)`)

  console.log('packing slip: all assertions passed')
}

main().catch((e) => { console.error(e); process.exit(1) })
