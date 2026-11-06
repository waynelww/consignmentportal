// Store text with invisible or non-WinAnsi characters must still render PDFs.
// Run: npx tsx scripts/test-pdf-text.ts
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { sanitizePdfText } from '../lib/pdf/text'
import { stripInvisible, stripInvisibleDeep } from '../lib/text/invisible'
import { generateDOPdf } from '../lib/pdf/generate-do'
import { generateStatementPdf } from '../lib/pdf/generate-statement'
import { generatePackingSlipPdf } from '../lib/pdf/generate-slip'

const BAD = 'Hyper‪ground​ ⁦Store⁩ ﻿日本 Ω'

async function main() {
  // 1. The bug: a raw standard font throws on these characters.
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  assert.throws(() => font.widthOfTextAtSize('a‪b', 10), /WinAnsi cannot encode/)

  // 2. Stripping and mapping.
  assert.equal(stripInvisible('A‪B​C'), 'ABC')
  assert.equal(sanitizePdfText('A‪B'), 'AB')
  assert.equal(sanitizePdfText('Ali’s “shop” – …'), 'Ali’s “shop” – …', 'WinAnsi characters are kept')
  assert.equal(sanitizePdfText('Ω'), '?')
  assert.equal(sanitizePdfText('a−b'), 'a-b')
  assert.equal(sanitizePdfText('é'), 'é', 'decomposed accents are composed')
  assert.equal(sanitizePdfText('a\tb\nc'), 'a b c')
  assert.equal(stripInvisibleDeep({ a: 'x‪y', b: ['﻿z'], n: 3 }).a, 'xy')
  assert.doesNotThrow(() => font.widthOfTextAtSize(sanitizePdfText(BAD), 10))

  // 3. Each generator renders hostile store text.
  const doBytes = await generateDOPdf({
    doNumber: 'DO-2026-9999', createdAt: '06/11/2026', status: 'acknowledged',
    storeName: BAD, storeCode: 'XCSM-1', picName: BAD, address: BAD, city: BAD,
    postcode: '50000', state: BAD, picPhone: '0123', items: [{ name: BAD, sku: 'A1', quantity: 2, unitCost: 10 }],
    companyName: 'Wayne Group', companyAddress: '', companyPhone: '', companyEmail: 'info@xocks.co',
    showCosts: true,
  })
  assert.ok(doBytes.length > 1000)

  const stmtBytes = await generateStatementPdf({
    storeName: BAD, storeCode: 'XCSM-1', picName: BAD, periodMonth: 10, periodYear: 2026,
    generatedDate: '1 November 2026', commissionRate: 30,
    items: [{ productName: BAD, sku: 'A1', keyedInBy: BAD, unitsSold: 1, unitPrice: 20, revenue: 20, commission: 6 }],
    totalUnits: 1, totalRevenue: 20, totalCommission: 6, xocksRevenue: 14, status: 'pending',
  } as Parameters<typeof generateStatementPdf>[0])
  assert.ok(stmtBytes.length > 1000)

  const slipBytes = await generatePackingSlipPdf({
    doNumber: 'DO-2026-9999', createdAt: '2026-11-06T00:00:00Z', storeName: BAD, address: BAD,
    items: [{ sku: 'A1', name: BAD, category: BAD, quantity: 2 }],
  } as Parameters<typeof generatePackingSlipPdf>[0])
  assert.ok(slipBytes.length > 1000)

  console.log('✓ PDF text sanitising checks passed')
}

main().catch((err) => { console.error(err); process.exit(1) })
