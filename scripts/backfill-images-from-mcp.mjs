#!/usr/bin/env node
/**
 * One-shot variant image backfill — uses SKU→URL data pulled from Shopify via
 * MCP and updates products.image_url in Supabase. No Shopify token needed.
 *
 * Run: node scripts/backfill-images-from-mcp.mjs
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

// SKU → variant image URL pulled live from Shopify Admin API via MCP.
// Map is normalized to UPPERCASE SKU for safe lookup.
const RAW = {
  // ── Plain Series — Ankle (A1–A56)
  A1: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A01.webp?v=1769657960',
  A2: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A02_1.webp?v=1769657960',
  A3: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A03.webp?v=1769657960',
  A4: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A04.webp?v=1769657960',
  A5: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A05.webp?v=1769657960',
  A6: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A06.webp?v=1769657960',
  A7: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A07copy.webp?v=1769657960',
  A8: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A8copy.webp?v=1769657960',
  A9: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A09.webp?v=1769658026',
  A10: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A10.webp?v=1769658217',
  A11: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A11.webp?v=1769658434',
  A12: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A12copy.webp?v=1769657960',
  A13: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A13_18d2be56-4ebe-4ead-8dad-9fa5bc2fd477.webp?v=1769658434',
  A14: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A14copy.webp?v=1769658434',
  A15: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A15copy.webp?v=1769658434',
  A16: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A16copy.webp?v=1769657960',
  A17: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A17.webp?v=1769658026',
  A18: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A18copy.webp?v=1769658026',
  A19: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A19copy.webp?v=1769658297',
  A20: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A20.webp?v=1769658297',
  A21: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A21copy.webp?v=1769658297',
  A22: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A22.webp?v=1769658350',
  A23: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A23.webp?v=1769658350',
  A24: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A24.webp?v=1769658217',
  A25: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A25.webp?v=1769658350',
  A26: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A26.webp?v=1769658026',
  A27: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A27.webp?v=1769658026',
  A28: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A28.webp?v=1769658217',
  A29: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A29.webp?v=1769658217',
  A30: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A30copy.webp?v=1769658297',
  A31: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A31copy.webp?v=1769658434',
  A32: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A32copy.webp?v=1769658434',
  A33: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A33.webp?v=1769658217',
  A34: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A34.webp?v=1769658434',
  A35: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A35.webp?v=1769658350',
  A36: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A36.webp?v=1769658217',
  A37: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A37.webp?v=1769657960',
  A38: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A38copy.webp?v=1769658434',
  A39: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A39.webp?v=1769658350',
  A40: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A40.webp?v=1769658217',
  A41: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A41.webp?v=1769658217',
  A42: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A42.webp?v=1769658350',
  A43: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A43copy.webp?v=1769658350',
  A44: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A44copy.webp?v=1769658217',
  A45: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A45copy.webp?v=1767007008',
  A46: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A46copy.webp?v=1769657960',
  A47: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A47copy.webp?v=1769658434',
  A48: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A48.webp?v=1769657960',
  A49: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A49copy.webp?v=1769658350',
  A50: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A50copy.webp?v=1769658350',
  A51: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A51.webp?v=1769658350',
  A52: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A52.webp?v=1769658350',
  A53: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A53.webp?v=1769658350',
  A54: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A54.webp?v=1769658434',
  A55: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A55copy.webp?v=1769658434',
  A56: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A56.webp?v=1769658434',

  // ── Plain Series — Crew (C1–C56)
  C1: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C01.webp?v=1769657960',
  C2: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C02.webp?v=1769657960',
  C3: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C03.webp?v=1755587929',
  C4: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C04.webp?v=1755587929',
  C5: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C05.webp?v=1769657960',
  C6: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C06.webp?v=1769657960',
  C7: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C07.webp?v=1769657960',
  C8: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C08.webp?v=1769657960',
  C9: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C09.webp?v=1769658026',
  C10: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C10.webp?v=1769658217',
  C11: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C11.webp?v=1769658434',
  C12: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C12.webp?v=1769657960',
  C13: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C13.webp?v=1769658434',
  C14: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C14.webp?v=1769658434',
  C15: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C15.webp?v=1769658434',
  C16: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C16.webp?v=1769657960',
  C17: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C17.webp?v=1769658026',
  C18: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C18.webp?v=1769658217',
  C19: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C19.webp?v=1769658297',
  C20: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C20.webp?v=1769658297',
  C21: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C21.webp?v=1769658297',
  C22: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C22.webp?v=1769658350',
  C23: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C23.webp?v=1769658350',
  C24: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C24.webp?v=1769658217',
  C25: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C25.webp?v=1769658350',
  C26: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C26.webp?v=1769658026',
  C27: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C27.webp?v=1769658026',
  C28: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C28.webp?v=1769658217',
  C29: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C29.webp?v=1769658217',
  C30: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C30.webp?v=1769658297',
  C31: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C31.webp?v=1769658434',
  C32: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C32.webp?v=1769658434',
  C33: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C33.webp?v=1769658217',
  C34: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C34.webp?v=1769658434',
  C35: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C35.webp?v=1769658350',
  C36: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C36.webp?v=1769658217',
  C37: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C37.webp?v=1769657960',
  C38: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C38.webp?v=1769658434',
  C39: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C39.webp?v=1755589238',
  C40: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C40.webp?v=1769658217',
  C41: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C41.webp?v=1769658217',
  C42: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C42.webp?v=1769658350',
  C43: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C43.webp?v=1769658350',
  C44: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C44.webp?v=1769658217',
  C45: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C45.webp?v=1769657960',
  C46: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C46.webp?v=1769657960',
  C47: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C47.webp?v=1769658434',
  C48: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C48.webp?v=1769657960',
  C49: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C49.webp?v=1769658350',
  C50: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C50.webp?v=1769658350',
  C51: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C51.webp?v=1769658350',
  C52: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C52.webp?v=1769658350',
  C53: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C53.webp?v=1769658350',
  C54: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C54.webp?v=1769658434',
  C55: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C55.webp?v=1769658434',
  C56: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/C56.webp?v=1769658434',

  // ── Plain Series — Half (H1–H56)
  H1: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H01_782a7176-27e4-44ca-b285-18c52a892138.webp?v=1769657960',
  H2: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H02_90561bbf-f69d-44e4-9dc4-07c0de99fdf6.webp?v=1769657960',
  H3: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H03_fb77b0f2-a34e-44ed-a52b-a57a750aceb1.webp?v=1769657960',
  H4: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H04_450b4f23-4c93-479c-8013-7113e932a8c5.webp?v=1769657960',
  H5: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H05_cb45ff6d-9b83-4880-a540-d825568f86d5.webp?v=1769657960',
  H6: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H06_f0076741-c036-40eb-b157-efb1c5065cc8.webp?v=1769657960',
  H7: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H07_eb961896-78eb-4018-ae76-044c8e38b215.webp?v=1769657960',
  H8: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H08_a6cd5071-18ee-41e2-9389-8050694ea601.webp?v=1769657960',
  H9: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H09_11f8ef16-9481-425a-a688-3849e2b9d737.webp?v=1769658026',
  H10: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H10_c046a10b-5241-439c-893e-95df47c3d59b.webp?v=1769658217',
  H11: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H11_cfa60a08-5a34-4f75-bd01-8827fbfb7dad.webp?v=1769658434',
  H12: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H12_72997d94-10cd-4e4b-ada0-04f70e3b1744.webp?v=1769657960',
  H13: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H13_4bae0dc6-21a2-4889-8c1c-ad753660f36f.webp?v=1769658434',
  H14: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H14_e473a5a4-c55a-40bc-9390-37971768a3f1.webp?v=1769658434',
  H15: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H15_22f05aa4-2e59-450b-b0a3-713f2cdb60e1.webp?v=1769658434',
  H16: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H16_39fbcde4-5881-479a-92e2-48d627b1e2cb.webp?v=1769657960',
  H17: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H17_999e4d5c-0e1f-4350-bc06-26b6550e03eb.webp?v=1769658026',
  H18: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H18_6d2a0e7a-bbb9-48d0-ab2f-3481625793aa.webp?v=1769658026',
  H19: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H19_c7fae7d3-c0f8-4e6b-a95c-fcaab55d48fb.webp?v=1769658297',
  H20: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H20_03b5188d-b85e-4b42-9622-fd09403c7ad1.webp?v=1769658297',
  H21: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H21_6f909bda-e42b-43c5-842e-b4d471491489.webp?v=1769658297',
  H22: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H22_7c699477-3ee3-4f16-847e-eacb76dc2c51.webp?v=1769658350',
  H23: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H23_726e0372-b90e-4129-a0e1-fcb3a315c8dd.webp?v=1769658350',
  H24: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H24_f6aec933-598a-41ed-bdfa-489e9e27cab8.webp?v=1769658217',
  H25: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H25_ced8bea1-6da1-4ce3-9c1a-170bef7fe281.webp?v=1769658350',
  H26: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H26_af88e266-c505-4b76-8b22-fc4ecf655299.webp?v=1769658026',
  H27: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H27_5aed13e7-cd84-402d-a4f4-7e4548f23b89.webp?v=1769658026',
  H28: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H28_7868fd7b-0890-411a-ad3b-3636143367f6.webp?v=1755590398',
  H29: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H29_c804f98e-bc7d-4ab5-b7ac-54ab961e2e96.webp?v=1769658217',
  H30: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H30_fb48d099-06c8-4357-9aef-6a39107ea618.webp?v=1769658297',
  H31: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H31_5101b4b1-38a1-44ea-83c5-09b2604c5175.webp?v=1769658434',
  H32: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H32_f07b5d18-09c9-4534-92ce-c15822941f73.webp?v=1769658434',
  H33: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H33_6253be61-91c4-4bd2-870d-b34c054c094b.webp?v=1769658217',
  H34: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H34_836df78d-81a5-4d97-bec6-beac9a81353a.webp?v=1769658434',
  H35: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H35_24e3be5c-5f26-4d80-83fa-c4cfd0f7c4f2.webp?v=1769658350',
  H36: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H36_25cb1e9d-9e3a-4c85-b03c-fdd4ced90c8d.webp?v=1769658217',
  H37: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H37_060269c7-1a1d-4c5f-a666-2828177b9b35.webp?v=1769657960',
  H38: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H38_dd448147-d390-42ac-80e7-0d2d5bb92112.webp?v=1769658434',
  H39: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H39_4bf03f9a-84f6-45ee-a9e8-14de676a6eed.webp?v=1755590398',
  H40: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H40_bd6e5ebe-a922-48bc-ba4b-99ca6ad4682c.webp?v=1769658217',
  H41: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H41_ca9e6825-2d3f-4125-b55c-ec07dbcc55a1.webp?v=1769658217',
  H42: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H42_60830e36-3143-426f-a417-a19f7706a49b.webp?v=1769658350',
  H43: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H43_2ff6c585-7b7a-4ab4-b6eb-4bc2a8bd7eb5.webp?v=1769658350',
  H44: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H44_fdccd439-13c8-46d1-a393-05a17cfb63f6.webp?v=1769658217',
  H45: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H45_40eeebf4-5486-4079-8dd6-c145707bf4d7.webp?v=1769657960',
  H46: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H46_f7e830e6-627b-4f8c-9f2e-105a85623edd.webp?v=1769657960',
  H47: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H47_cba96f62-a828-4472-8f78-640a88f88edc.webp?v=1769658434',
  H48: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H48_73120fc4-2a37-4847-ae19-666d633ffb25.webp?v=1769657960',
  H49: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H49_2ea5263b-18c8-48dc-91c4-fa6e2b831f58.webp?v=1769658350',
  H50: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H50_46f53751-26d3-47ba-95c9-07cfee05a7ae.webp?v=1769658350',
  H51: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H51_1bfd638b-8d49-4f9a-b2a6-e484c651d43c.webp?v=1769658350',
  H52: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H52_59b5a4cf-e53d-4715-90b7-03423c2068b6.webp?v=1769658350',
  H53: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H53_ec0294a5-b368-48c6-a2c5-014f27cdef0d.webp?v=1769658350',
  H54: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H54_56411901-5c22-4679-b1f9-2885892acfe0.webp?v=1769658434',
  H55: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H55.webp?v=1769658434',
  H56: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/H56_2c46f1f6-f90f-4190-a206-b9308f4c4c7a.webp?v=1769658434',

  // ── Trial Bundle (TB1–TB37)
  TB1: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_222444.png?v=1701614055',
  TB2: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_222430.png?v=1701614055',
  TB3: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_222416.png?v=1701614055',
  TB4: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_222347.png?v=1701614055',
  TB5: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_222316.png?v=1701614055',
  TB6: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_222253.png?v=1701614055',
  TB7: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_222022.png?v=1701614055',
  TB8: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221956.png?v=1701614055',
  TB9: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221904.png?v=1701614055',
  TB10: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221836.png?v=1701614055',
  TB11: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221821.png?v=1701613593',
  TB12: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221749.png?v=1701613599',
  TB13: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_222906.png?v=1701613775',
  TB14: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_223105.png?v=1701613900',
  TB15: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221730.png?v=1701613594',
  TB16: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221714.png?v=1701613598',
  TB17: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221623.png?v=1701613593',
  TB18: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221602.png?v=1701613591',
  TB19: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221541.png?v=1701613595',
  TB20: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221524.png?v=1701613591',
  TB21: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221510.png?v=1701613597',
  TB22: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221448.png?v=1701613596',
  TB23: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221430.png?v=1701613596',
  TB24: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221410.png?v=1701613600',
  TB25: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221359.png?v=1701613600',
  TB26: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221347.png?v=1701613592',
  TB27: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221325.png?v=1701613598',
  TB28: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221301.png?v=1701613591',
  TB29: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221239.png?v=1701613592',
  TB30: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221220.png?v=1701613595',
  TB31: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221141.png?v=1701613591',
  TB32: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221058.png?v=1701613593',
  TB33: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_221024.png?v=1701613595',
  TB34: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_220940.png?v=1701613592',
  TB35: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_220909.png?v=1701613598',
  TB36: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_220834.png?v=1701613594',
  TB37: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PhotoRoom_25661203_220731.png?v=1701613600',

  // ── MX (Muslimah, MX1-MX25)
  MX1: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/1_1.png?v=1709392637',
  MX2: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/2_25392c86-05ed-4553-a6ad-5bd7c902a9fd.png?v=1709392638',
  MX3: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/3_1.png?v=1709392637',
  MX4: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/4_60eff2a1-6aea-4193-b7e5-8ca8d226a770.png?v=1709392637',
  MX5: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/5_2cee32db-e52e-4ff6-80de-9a3e4e134480.png?v=1709392637',
  MX6: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/6_ddbc67ec-393c-409e-a7ca-94983e2611ae.png?v=1709392637',
  MX7: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/7_b65c0c2d-7aca-48ee-a52b-e0d4645374a0.png?v=1709392637',
  MX8: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/8_e66bd7bf-9623-42ef-82b9-fca4b6fc585f.png?v=1709392637',
  MX9: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/9_5ce0f461-af9f-4c77-83cc-3b74ed4f57ba.png?v=1709392637',
  MX10: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/10_0bbf0666-31fd-4dcf-823a-690abe836396.png?v=1709392637',
  MX11: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/11_1.png?v=1709392637',
  MX12: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/12_a21d1c87-2875-415a-b7aa-55e2507033c1.png?v=1709392637',
  MX13: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/13_033a68e7-5a1f-48f1-99bf-c2cd0be48fad.png?v=1709392637',
  MX14: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/14_297689c9-846d-42f0-8e16-0e20ed69362f.png?v=1709392637',
  MX15: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/15_3cce8d34-5a4d-468f-9bc9-71d60b6fdabe.png?v=1709392637',
  MX16: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/16_6bb4e495-5340-42e1-a25e-43403ffa5d43.png?v=1709392637',
  MX17: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/17_e5f7186c-6e8e-4d4d-8a4a-5e2d144b39fe.png?v=1709392637',
  MX18: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/18_398d06b2-9c2e-4c39-a663-63555bbb8c8b.png?v=1709392637',
  MX19: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/19_9b28996c-822f-46fe-b6d3-2e5b7de96643.png?v=1709392637',
  MX20: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/20_8cc6aba2-94b5-4fb3-a2e0-253c6cbd1dd4.png?v=1709392637',
  MX21: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/21_793a6320-99a0-4178-941c-e63690ac9707.png?v=1709392637',
  MX22: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/22_cd25e9d9-650b-4d71-95c5-f70c9441fc68.png?v=1709392637',
  MX23: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/23_a8272b9a-4677-4869-a036-591645fd55a9.png?v=1709392637',
  MX24: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/24_8a969932-98d0-42b5-ae51-f4965f24ed81.png?v=1709392637',
  MX25: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/25_ac5ea393-4615-4992-a6a2-69c711f211af.png?v=1709392637',

  // ── Color Bundles (legacy)
  AMONO: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/Xocks-Ankle-Mono-Bundle.png?v=1701603675',
  CMONO: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/Xocks-Crew-Mono-Bundle.png?v=1701603675',
  APARTY: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/XOCKS_Ankle_PartyTime.jpg?v=1701603668',
  CPARTY: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/XOCKS_Crew_PartyTime.jpg?v=1701603675',
  AVINTAGE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/XOCKS_Ankle_GOD.jpg?v=1701603669',
  CVINTAGE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/XOCKS_Crew_GOD.jpg?v=1701603675',
  AGRASS: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/XOCKS_Ankle_Grasshopper.jpg?v=1701603668',
  CGRASS: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/XOCKS_Crew_Grasshopper.jpg?v=1701603675',
  ABLUE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/XOCKS_Ankle_UTS.jpg?v=1701603669',
  CBLUE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/XOCKS_Crew_UTS.jpg?v=1701603675',

  // ── 2024 themed bundles
  ASPRING: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/SPRING_DAY_ANKLE.jpg?v=1721488008',
  CSPRING: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/SPRING_DAY_CREW.jpg?v=1721488009',
  ARETRO: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/RETRO_ANKLE.jpg?v=1721488008',
  CRETRO: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/RETRO_CREW.jpg?v=1721488009',
  AFLORAL: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/FLORAL_ANKLE.jpg?v=1721488008',
  CFLORAL: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/FLORAL_CREW.jpg?v=1721488009',
  AMACARON: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/MACARON_HUES_ANKLE.jpg?v=1721488008',
  CMACARON: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/MACARON_HUES_CREW.jpg?v=1721488008',
  AMOONRISE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/MOONRISE_SUNSET_ANKLE.jpg?v=1721488008',
  CMOONRISE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/MOONRISE_SUNSET_CREW.jpg?v=1721488010',
  ASUNFLOWER: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/SUNFLOWERS_ANKLE.jpg?v=1721488008',
  CSUNFLOWER: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/SUNFLOWERS_CREW.jpg?v=1721488009',

  // ── Film/themed bundles
  AJUSTBLACK: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/1_Ankle_Black.jpg?v=1724067995',
  CJUSTBLACK: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/1_Just_Black.jpg?v=1724039939',
  ABASICWHITE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/2_Ankle_White.jpg?v=1724068011',
  CBASICWHITE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/2_Basic_B_tch.jpg?v=1724039841',
  AMONDAYBLUE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/3_Ankle_Monday_Blues.jpg?v=1724068042',
  CMONDAYBLUE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/3_Monday_Blues.jpg?v=1724039842',
  APINKPANTHER: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/4_Ankle_ink_Panther.jpg?v=1724068059',
  CPINKPANTHER: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/4_Pink_Panther.jpg?v=1724039842',
  ADUNE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/5_Ankle_Dune.jpg?v=1724068090',
  CDUNE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/5_Dune.jpg?v=1724039842',
  ATHEMATRIX: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/6_The_Matrix_2e288e97-8798-4350-a934-e9336a45f184.jpg?v=1724068118',
  CTHEMATRIX: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/6_The_Matrix.jpg?v=1724039842',
  AMADMIX: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/7_Ankle_Mad_Max.jpg?v=1724068146',
  CMADMIX: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/7_Mad_Max.jpg?v=1724039842',
  ATAXIDRIVER: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/8_Taxi_Driver_4ba954f6-7479-433a-86b0-add621f7f29c.jpg?v=1724068193',
  CTAXIDRIVER: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/8_Taxi_Driver.jpg?v=1724039841',
  ABLADERUNNER: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/9_Ankle_Blade_Runner.jpg?v=1724068208',
  CBLADERUNNER: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/9_Blade_Runner_2049.jpg?v=1724039842',
  AINTERSTELLAR: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/10_Ankle_Interstellar.jpg?v=1724068221',
  CINTERSTELLAR: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/10_Interstellar.jpg?v=1724039842',
  ATHEVOID: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/11_Ankle_Enter_The_Void.jpg?v=1724068236',
  CTHEVOID: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/11_Enter_The_Void.jpg?v=1724039843',

  // ── 2024 film bundles part 2
  ABARBIE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/13_Barbie.jpg?v=1731658032',
  CBARBIE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/13_Barbie_5f0bd7f4-f2ec-4b95-8613-af9b8b141f3a.jpg?v=1731658041',
  AJUNGLE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/14_Jungle_Cruise.jpg?v=1731658032',
  CJUNGLE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/14_Jungle_Cruise_bb06daf3-9a76-4bde-9036-50d460508525.jpg?v=1731658041',
  AGREENBOOK: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/15_Greenbook.jpg?v=1731658032',
  CGREENBOOK: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/15_Greenbook_0488031c-600c-42c9-a2b6-4452975bc2d3.jpg?v=1731658041',
  ALIER: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/16_Hotel_Chevalier.jpg?v=1731658032',
  CLIER: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/16_Hotel_Chevalier_ae6237d2-3e50-4146-881a-c3c698e17e87.jpg?v=1731658041',
  ASPIRIT: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/17_Spirit_Away.jpg?v=1731658032',
  CSPIRIT: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/17_Spirit_Away_1b4b2638-e590-45d4-9be3-f126b0dbdf5e.jpg?v=1731658041',
  APULP: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/18_Pulp_Fiction.jpg?v=1731658032',
  CPULP: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/18_Pulp_Fiction_2b4693e9-cd46-4a3e-84b9-81574ab466c4.jpg?v=1731658041',

  // ── 9-pack bundles
  AMONO9P: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/1_Mono.jpg?v=1731658353',
  CMONO9P: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/1_Mono_C.jpg?v=1731658340',
  APINKISH9P: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/2_Pinkish.jpg?v=1731658354',
  CPINKISH9P: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/2_Pinkish_C.jpg?v=1731658341',
  ABLUE9P: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/3_More_Blue.jpg?v=1731658354',
  CBLUE9P: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/3_More_Blue_C.jpg?v=1731658341',
  ASUNSET9P: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/4_Sunset.jpg?v=1731658354',
  CSUNSET9P: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/4_Sunset_C.jpg?v=1731658341',
  AAURORA9P: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/5_Aurora.jpg?v=1731658354',
  CAURORA9P: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/5_Aurora_C.jpg?v=1731658341',
  ASATURN9P: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/6_Saturn.jpg?v=1731658353',
  CSATURN9P: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/6_Saturn.jpg?v=1731658353',

  // ── CNY 2025
  CNY25HUAT: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/CNY-10-min.jpg?v=1751351818',
  CNY25CAT: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/CNY-04-min.jpg?v=1751351818',
  CNY25CHAIN: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/CNY-05-min.jpg?v=1751351818',
  CNY25CLOUD: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/CNY-08-min.jpg?v=1751351818',
  CNY25FUWHITE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/WhatsApp_Image_2025-01-25_at_13.22.28.jpg?v=1737782806',
  CNY25FURED: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/CNY-02-min.jpg?v=1751351818',

  // ── Merdeka 67 collection
  'MDK-67-WAU': 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/1D.jpg?v=1724906097',
  'MDK-67-CONGKAK': 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/2D.jpg?v=1724906097',
  'MDK-67-BUNGA': 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/3D.jpg?v=1724906097',
  'MDK-67-ALL': 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/4Bundle.jpg?v=1724906097',

  // ── Raya 2025
  RAYAGUCCI: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/1_abbd6419-0c9e-4cd9-ad42-9783e864556b.png?v=1751285252',
  RAYACORAKW: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/2_407ab3ba-63f3-49cd-b818-27dc44adf3db.png?v=1751285252',
  RAYACORALG: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/5_11fdab19-adf5-4d9a-8000-2ca4bc648e31.png?v=1751285252',
  RAYAFLOWERW: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/3_98a3153f-4483-45b5-8bf5-1fa46a0de86b.png?v=1751285252',
  RAYAFLOWERG: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/4_94519e56-3af8-4b0f-a644-ccd4290598c6.png?v=1751285252',

  // ── Misc (product-level featured fallback since no variant image)
  TOTEBAG: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/Screenshot2025-02-14at2.39.19PM.png?v=1739515173',
  FREETOTEBAG: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/Screenshot2025-02-14at2.39.19PM.png?v=1739515173',
  TOTEBAG599: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/Screenshot2025-02-14at2.39.19PM.png?v=1739515173',
  FA26: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A26CLEANWHITE.png?v=1740021019',
  FA27: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A27CLASSICBLACK.png?v=1740021046',
  HA17: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A17LIGHTGREY.png?v=1740021126',
  FA18: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A18GREYBLACK.png?v=1740021161',

  // ── Patches Socks (LOKAL Jehhh)
  PCENDUL: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PatchesThumbnail-01_100kb.webp?v=1775536867',
  PTEHTARIK: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PatchesThumbnail-04_100kb.webp?v=1775536866',
  PRHINO: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PatchesThumbnail-05_100kb.webp?v=1775536867',
  PGAJAH: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PatchesThumbnail-10_100kb.webp?v=1775536867',
  PBASSEKOLAH: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PatchesThumbnail-11_100kb.webp?v=1775536866',
  PHIBIS: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/Raya_Bloom_100kb.webp?v=1775541627',
  PTAPIR: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PatchesThumbnail-06_100kb.webp?v=1775536866',
  PKETUPAT: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PatchesThumbnail-03_100kb.webp?v=1775536866',
  PICE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PatchesThumbnail-09_100kb.webp?v=1775536866',
  PCURRYPUFF: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/Currybuff.webp?v=1775550803',
  PDRAGONBOAT: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PatchesThumbnail-08_100kb.webp?v=1775536866',
  PTINGKAT: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/PatchesThumbnail-07_100kb.webp?v=1775536866',

  // ── AOS x Xocks
  AOSWHITE: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/06fe2065-f6a9-4602-a2cd-6e4bd1e4d431.jpg?v=1753420003',
  AOSBLACK: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/fe755044-cf4a-475b-a512-e1c622b99886.jpg?v=1753420002',

  // ── Merdeka Ke-68 Design Series
  DSBELANG: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/2.webp?v=1756170590',
  DSRUKUN: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/3.webp?v=1756170589',
  DSNASI: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/1.webp?v=1756170589',
  DSHEY: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/4.webp?v=1756170589',
  DSSEMUA: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/6.webp?v=1756170589',

  // ── No Show Socks (V series)
  V6: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/V1.webp?v=1767173627',
  V9: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/V2_000ceb70-8c62-4ef1-ac2f-38a5dbfe2b3f.webp?v=1767173627',
  V15: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/V3.webp?v=1767173627',
  V17: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/V4.webp?v=1767173627',
  V26: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/V5.webp?v=1767173627',
  V27: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/V6.webp?v=1767173627',
  V32: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/V7.webp?v=1767173627',
  V46: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/V8.webp?v=1767173627',
  V54: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/V9.webp?v=1767173627',
  V55: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/V10.webp?v=1767173627',

  // ── Raya 2026
  RAYA26G: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/xocks_raya_3.webp?v=1772708216',
  RAYA26Y: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/xocks_raya_1.webp?v=1772708216',
  RAYA26B: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/xocks_raya_2.webp?v=1772708216',

  // ── Muslimah Socks (M1-M7)
  M1: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/M1_Light_Beige.webp?v=1773215190',
  M2: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/M2_Classic_Khaki.webp?v=1773215190',
  M3: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/M3_Pearl_Cream.webp?v=1773215190',
  M4: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/M4_Khaki_Sand.webp?v=1773215190',
  M5: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/M5_Mocha_Brown.webp?v=1773215190',
  M6: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/M6_Navy_Blue.webp?v=1773215190',
  M7: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/M7_Classy_Black.webp?v=1773215190',

  // ── Patches singletons (product-level featured)
  FREEPATCH: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/BD126B5E-8CAF-4A9A-B817-7757B43CBB6B.jpg?v=1750311076',
  PATCHESRM2: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/962413E9-9C67-41BA-B793-040F27EE39C5.jpg?v=1750311144',

  // ── Free-pair / promo SKUs (map to base SKU image)
  AY: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A27.webp?v=1769658026',
  AX: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/A27.webp?v=1769658026',

  // ── Kids (K1–K12)
  K1: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/S31.webp?v=1753322131',
  K2: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/S60.webp?v=1753322131',
  K3: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/S43.webp?v=1753322131',
  K4: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/S18.webp?v=1753322131',
  K5: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/S42.webp?v=1753322131',
  K6: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/S58.webp?v=1753322131',
  K7: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/S22.webp?v=1753322131',
  K8: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/S03.webp?v=1753322131',
  K9: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/S63_compressed.webp?v=1753419763',
  K10: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/S41.webp?v=1753322131',
  K11: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/S28.webp?v=1753322131',
  K12: 'https://cdn.shopify.com/s/files/1/0841/5556/4340/files/S48.webp?v=1753322131',
}

// Normalize keys to uppercase (Shopify SKUs are case-sensitive but our DB upserts SKUs as UPPERCASE)
const MAP = {}
for (const [k, v] of Object.entries(RAW)) MAP[k.toUpperCase()] = v

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

async function main() {
  console.log(`📦 SKU→image map loaded: ${Object.keys(MAP).length} entries`)
  console.log(`🗄  Supabase: ${SUPABASE_URL}`)
  console.log('')

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  })

  console.log('→ Fetching products from Supabase...')
  const { data: products, error } = await supabase
    .from('products')
    .select('id, sku, name, image_url')
  if (error) {
    console.error('❌ Fetch failed:', error.message)
    process.exit(1)
  }
  console.log(`✓ ${products.length} products in DB`)
  console.log('')

  let updated = 0
  let unchanged = 0
  let notFound = 0
  const notFoundList = []

  // Resolve a SKU to an image URL, with fallback for quantity-pack derivatives.
  // e.g. A26X4 (pack of 4) -> A26, H27X10 (pack of 10) -> H27, RAYAGUCCIX6 -> RAYAGUCCI
  function resolveImage(sku) {
    if (MAP[sku]) return MAP[sku]
    // Strip trailing "X<digits>" suffix and try again
    const stripped = sku.replace(/X\d+$/i, '')
    if (stripped !== sku && MAP[stripped]) return MAP[stripped]
    // Strip leading "F" or "H" prefix (free pack / half variant) and try
    if (/^[FH]/i.test(sku)) {
      const noPrefix = sku.replace(/^[FH]/i, '')
      if (MAP[noPrefix]) return MAP[noPrefix]
    }
    return null
  }

  for (const p of products) {
    const sku = (p.sku ?? '').trim().toUpperCase()
    const newUrl = resolveImage(sku)
    if (!newUrl) {
      notFound++
      notFoundList.push(`${p.sku} — ${p.name}`)
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
      process.stdout.write(`\r  ✓ updated: ${updated}`)
    }
  }
  process.stdout.write('\n\n')

  console.log('═══════════════════════════════════════')
  console.log(`✓ Updated:           ${updated}`)
  console.log(`◦ Already current:   ${unchanged}`)
  console.log(`⚠ No mapping found:  ${notFound}`)
  console.log('═══════════════════════════════════════')

  if (notFoundList.length) {
    console.log(`\nSKUs without image mapping (${notFoundList.length}):`)
    notFoundList.slice(0, 30).forEach((s) => console.log(`  · ${s}`))
    if (notFoundList.length > 30) console.log(`  · ... and ${notFoundList.length - 30} more`)
  }
}

main().catch((err) => {
  console.error('\n❌', err)
  process.exit(1)
})
