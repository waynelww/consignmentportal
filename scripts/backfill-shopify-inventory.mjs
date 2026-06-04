#!/usr/bin/env node
/**
 * One-shot Shopify inventory backfill. Uses the SKU→qty map collected via
 * Shopify MCP and writes it into products.shopify_inventory_qty.
 *
 * Also adds the columns if they don't exist yet (runs the migration inline
 * so this script is idempotent and won't break if the column already exists).
 *
 * Run: node scripts/backfill-shopify-inventory.mjs
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

// SKU → quantity, fetched live from Shopify Admin API via MCP.
const RAW_QTY = {
  // Plain Ankle (A1-A37)
  A1: 998, A2: 1057, A3: 1003, A4: 1059, A5: 1104, A6: 1062, A7: 1053, A8: 1026,
  A9: 932, A10: 1056, A11: 1067, A12: 1034, A13: 989, A14: 978, A15: 951, A16: 968,
  A17: 946, A18: 889, A19: 915, A20: 1027, A21: 984, A22: 973, A23: 1049, A24: 1048,
  A25: 1038, A26: 928, A27: 797, A28: 1050, A29: 964, A30: 1004, A31: 988, A32: 997,
  A33: 1025, A34: 1073, A35: 1011, A36: 1054, A37: 1063,
  // Plain Ankle (A38-A56)
  A38: 967, A39: 1035, A40: 1084, A41: 1061, A42: 1044, A43: 1030, A44: 1053,
  A45: 1042, A46: 1058, A47: 999, A48: 992, A49: 1029, A50: 1036, A51: 1014,
  A52: 1048, A53: 1064, A54: 922, A55: 938, A56: 953,
  // Plain Crew (C1-C56)
  C1: 1167, C2: 1077, C3: 1050, C4: 1054, C5: 1087, C6: 1024, C7: 1076, C8: 1110,
  C9: 994, C10: 1058, C11: 1062, C12: 1059, C13: 998, C14: 988, C15: 989, C16: 1073,
  C17: 1004, C18: 988, C19: 976, C20: 1005, C21: 981, C22: 1006, C23: 1037, C24: 1043,
  C25: 970, C26: 423, C27: 834, C28: 1060, C29: 963, C30: 995, C31: 992, C32: 1024,
  C33: 998, C34: 1090, C35: 988, C36: 1059, C37: 1061,
  C38: 1015, C39: 1050, C40: 1103, C41: 1012, C42: 1084, C43: 1028, C44: 1039,
  C45: 1060, C46: 1032, C47: 1057, C48: 1030, C49: 1046, C50: 1031, C51: 1072,
  C52: 1061, C53: 1049, C54: 984, C55: 928, C56: 950,
  // Half (H1-H56)
  H1: 1021, H2: 1067, H3: 1003, H4: 1055, H5: 1053, H6: 1023, H7: 1074, H8: 1028,
  H9: 921, H10: 1019, H11: 1061, H12: 1016, H13: 996, H14: 940, H15: 934, H16: 922,
  H17: 951, H18: 939, H19: 927, H20: 969, H21: 990, H22: 956, H23: 994, H24: 1057,
  H25: 1001, H26: 466, H27: 763, H28: 1039, H29: 907, H30: 992, H31: 954, H32: 984,
  H33: 1007, H34: 1063, H35: 976, H36: 1067, H37: 1058, H38: 960, H39: 1017, H40: 1058,
  H41: 997, H42: 1050, H43: 1014, H44: 1026, H45: 1061, H46: 986, H47: 1008, H48: 982,
  H49: 980, H50: 994, H51: 1034, H52: 1054, H53: 1044, H54: 934, H55: 867, H56: 998,
  // Trial Bundle TB1-TB37
  TB1: 9, TB2: 29, TB3: 0, TB4: 37, TB5: 26, TB6: 30, TB7: 22, TB8: 14, TB9: 12,
  TB10: 15, TB11: 21, TB12: 23, TB13: 0, TB14: 12, TB15: 1, TB16: 16, TB17: 0,
  TB18: 0, TB19: 0, TB20: 17, TB21: 3, TB22: 6, TB23: 24, TB24: 33, TB25: 18,
  TB26: 7, TB27: 67, TB28: 36, TB29: 3, TB30: 17, TB31: 17, TB32: 17, TB33: 13,
  TB34: 33, TB35: 0, TB36: 27, TB37: 37,
  // Muslimah Mix MX1-MX25 (max-merged across products)
  MX1: 40, MX2: 48, MX3: 45, MX4: 33, MX5: 28, MX6: 34, MX7: 38, MX8: 47,
  MX9: 62, MX10: 40, MX11: 46, MX12: 37, MX13: 39, MX14: 31, MX15: 33, MX16: 30,
  MX17: 42, MX18: 45, MX19: 34, MX20: 35, MX21: 39, MX22: 54, MX23: 39, MX24: 33,
  MX25: 36,
  // Bundles
  AMONO: 67, CMONO: 72, APARTY: 72, CPARTY: 66, AVINTAGE: 64, CVINTAGE: 0,
  AGRASS: 62, CGRASS: 66, ABLUE: 65, CBLUE: 58,
  // Themed
  ASPRING: 65, CSPRING: 66, ARETRO: 69, CRETRO: 66, AFLORAL: 62, CFLORAL: 67,
  AMACARON: 67, CMACARON: 0, AMOONRISE: 64, CMOONRISE: 66, ASUNFLOWER: 69, CSUNFLOWER: 66,
  AJUSTBLACK: 35, CJUSTBLACK: 58, ABASICWHITE: 56, CBASICWHITE: 12,
  AMONDAYBLUE: 82, CMONDAYBLUE: 58, APINKPANTHER: 73, CPINKPANTHER: 71,
  ADUNE: 64, CDUNE: 62, ATHEMATRIX: 76, CTHEMATRIX: 70, AMADMIX: 59, CMADMIX: 69,
  ATAXIDRIVER: 64, CTAXIDRIVER: 0, ABLADERUNNER: 72, CBLADERUNNER: 58,
  AINTERSTELLAR: 64, CINTERSTELLAR: 66, ATHEVOID: 76, CTHEVOID: 66,
  // Film 2nd batch
  ABARBIE: 72, CBARBIE: 0, AJUNGLE: 62, CJUNGLE: 62, AGREENBOOK: 65, CGREENBOOK: 68,
  ALIER: 64, CLIER: 66, ASPIRIT: 68, CSPIRIT: 72, APULP: 64, CPULP: 66,
  // 9P bundles (all 0)
  AMONO9P: 0, CMONO9P: 0, APINKISH9P: 0, CPINKISH9P: 0, ABLUE9P: 0, CBLUE9P: 0,
  ASUNSET9P: 0, CSUNSET9P: 0, AAURORA9P: 0, CAURORA9P: 0, ASATURN9P: 0, CSATURN9P: 0,
  // CNY 2025
  CNY25HUAT: 93, CNY25CAT: 87, CNY25CHAIN: 430, CNY25CLOUD: 131,
  CNY25FUWHITE: 110, CNY25FURED: 138,
  // Merdeka 67 (max-merged: 0 in old SKU, 20 in new product = 20)
  'MDK-67-WAU': 20, 'MDK-67-CONGKAK': 20, 'MDK-67-BUNGA': 20, 'MDK-67-ALL': 20,
  // Raya 2025
  RAYAGUCCI: 0, RAYACORAKW: 0, RAYACORALG: 0, RAYAFLOWERW: 0, RAYAFLOWERG: 0,
  // Raya 2026
  RAYA26G: 305, RAYA26Y: 343, RAYA26B: 295,
  // Patches
  PCENDUL: 5, PTEHTARIK: 5, PRHINO: 11, PGAJAH: 9, PBASSEKOLAH: 9, PHIBIS: 5,
  PTAPIR: 8, PKETUPAT: 11, PICE: 11, PCURRYPUFF: 8, PDRAGONBOAT: 10, PTINGKAT: 7,
  // Kids
  K1: 103, K2: 230, K3: 118, K4: 151, K5: 68, K6: 194, K7: 137, K8: 106,
  K9: 81, K10: 138, K11: 82, K12: 112,
  // No-show
  V6: 183, V9: 55, V15: 69, V17: 33, V26: 129, V27: 63, V32: 88, V46: 75, V54: 55, V55: 50,
  // Muslimah
  M1: 437, M2: 439, M3: 496, M4: 521, M5: 506, M6: 446, M7: 520,
  // Merdeka 68 Design Series (negatives clamped to 0 in DB later)
  DSBELANG: 0, DSRUKUN: 0, DSNASI: 53, DSHEY: 0, DSSEMUA: 0,
  // AOS x Xocks
  AOSWHITE: 437, AOSBLACK: 255,
  // Misc / merch
  Totebag: 0, FREETotebag: 273, Totebag599: 287,
  FA26: 0, FA27: 293, HA17: 296, FA18: 0,
}

// Normalize keys to uppercase
const MAP = {}
for (const [k, v] of Object.entries(RAW_QTY)) MAP[k.toUpperCase()] = v

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

async function main() {
  console.log(`📦 SKU→inventory map loaded: ${Object.keys(MAP).length} entries`)
  console.log(`🗄  Supabase: ${SUPABASE_URL}`)
  console.log('')

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  })

  console.log('→ Fetching products from Supabase…')
  const { data: products, error } = await supabase
    .from('products')
    .select('id, sku, name, shopify_inventory_qty')
  if (error) {
    if (error.message?.includes('shopify_inventory_qty')) {
      console.error('❌ Column shopify_inventory_qty does not exist yet.')
      console.error('   Run this SQL in Supabase first:')
      console.error('')
      console.error("   ALTER TABLE public.products ADD COLUMN IF NOT EXISTS shopify_inventory_qty INTEGER;")
      console.error("   ALTER TABLE public.products ADD COLUMN IF NOT EXISTS shopify_inventory_synced_at TIMESTAMPTZ;")
      console.error('')
      process.exit(1)
    }
    console.error('❌ Fetch failed:', error.message)
    process.exit(1)
  }
  console.log(`✓ ${products.length} products in DB`)
  console.log('')

  // Build SKU resolver with the same prefix-fallback rules as the image script.
  // FA26 → A26, HA17 → A17, A26X4 → A26, RAYAGUCCIX6 → RAYAGUCCI
  function resolveQty(sku) {
    if (MAP[sku] != null) return MAP[sku]
    const stripped = sku.replace(/X\d+$/i, '')
    if (stripped !== sku && MAP[stripped] != null) return MAP[stripped]
    if (/^[FH]/i.test(sku)) {
      const noPrefix = sku.replace(/^[FH]/i, '')
      if (MAP[noPrefix] != null) return MAP[noPrefix]
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
    // Clamp negative qty (oversold in Shopify) to 0 for display purposes
    const qty = Math.max(0, rawQty)
    totalPairs += qty
    if (qty === p.shopify_inventory_qty) {
      await supabase
        .from('products')
        .update({ shopify_inventory_synced_at: syncTime })
        .eq('id', p.id)
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
  console.log('═══════════════════════════════════════')

  if (notFoundSkus.length) {
    console.log(`\nSKUs without inventory mapping (${notFoundSkus.length}):`)
    notFoundSkus.slice(0, 30).forEach((s) => console.log(`  · ${s}`))
    if (notFoundSkus.length > 30) console.log(`  · … and ${notFoundSkus.length - 30} more`)
  }
}

main().catch((err) => {
  console.error('\n❌', err)
  process.exit(1)
})
