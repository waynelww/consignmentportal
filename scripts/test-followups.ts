// Tests for the Follow-ups rules (lib/followups/build.ts and entry.ts).
// Run: npx tsx scripts/test-followups.ts
import assert from 'node:assert/strict'
import {
  autoSalesReport, autoInvoice, autoPayment, autoRestock, buildFollowupMonth, stillToFollowUp,
  mytDate, mytStamp, type LogInput, type BuildInput, type PeriodInput, type ReceiptInput,
} from '../lib/followups/build'
import { normaliseNote, planEntry, NOTE_MAX_LENGTH, type CellPrevious } from '../lib/followups/entry'

const STORE_A = '11111111-1111-4111-8111-111111111111'
const STORE_B = '22222222-2222-4222-8222-222222222222'
const EXTRA_X = '33333333-3333-4333-8333-333333333333'
const MEMBER_ALI = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MEMBER_SITI = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

// ── Malaysia dates ───────────────────────────────────────────────────────
// 23:30 UTC on 30 Oct is already 31 Oct in Malaysia.
assert.equal(mytDate('2026-10-30T23:30:00Z'), '2026-10-31')
assert.equal(mytDate('2026-10-30T15:59:00Z'), '2026-10-30')
assert.equal(mytStamp('2026-11-03T06:05:00Z'), '3 Nov 2026, 14:05')

// ── Sales Report ─────────────────────────────────────────────────────────
assert.deepEqual(autoSalesReport([]), { done: false, auto_date: null, auto_detail: null })
assert.deepEqual(autoSalesReport(['2026-09-14', '2026-09-02', '2026-09-30']),
  { done: true, auto_date: '2026-09-02', auto_detail: null }, 'earliest sale day is the date shown')

// ── Restock ──────────────────────────────────────────────────────────────
assert.equal(autoRestock([]).done, false)
assert.equal(autoRestock(['2026-09-20']).done, true)
assert.equal(autoRestock(['2026-09-20']).auto_date, '2026-09-20')

// ── Invoice ──────────────────────────────────────────────────────────────
const period = (over: Partial<PeriodInput> = {}): PeriodInput => ({
  id: 'p1', store_id: STORE_A, status: 'pending', invoice_no: 104,
  created_at: '2026-10-01T01:05:00Z', paid_at: null, ...over,
})

assert.deepEqual(autoInvoice(undefined), { done: false, auto_date: null, auto_detail: 'No invoice yet' })
assert.deepEqual(autoInvoice(period()), { done: true, auto_date: '2026-10-01', auto_detail: 'XCSM-104' })
assert.equal(autoInvoice({ ...period(), invoice_no: null }).auto_detail, 'Invoice created', 'no number yet still counts as created')

// ── Payment ──────────────────────────────────────────────────────────────
const receipt = (status: ReceiptInput['status']): ReceiptInput => ({ commission_period_id: 'p1', status })

assert.equal(autoPayment(undefined, undefined).done, false)
assert.equal(autoPayment(period(), undefined).auto_detail, 'Not paid')
assert.equal(
  autoPayment(period(), receipt('submitted')).auto_detail,
  'receipt uploaded, awaiting review',
  'a receipt waiting for review is labelled as such',
)
assert.equal(autoPayment(period(), receipt('submitted')).done, false, 'an uploaded receipt is not a payment')
assert.match(autoPayment(period(), receipt('rejected')).auto_detail ?? '', /rejected/,
  'a rejected receipt is not shown as awaiting review')
const paid = autoPayment(period({ status: 'paid', paid_at: '2026-10-08T03:00:00Z' }), receipt('confirmed'))
assert.deepEqual(paid, { done: true, auto_date: '2026-10-08', auto_detail: 'Paid' })

// ── Write rule: planEntry ────────────────────────────────────────────────
const plan = (auto: boolean, prev: CellPrevious | null, request: Parameters<typeof planEntry>[0]['request']) =>
  planEntry({ auto, prev, request })

// Manual box
assert.deepEqual(plan(false, null, { ticked: true }), { ok: true, action: 'tick', ticked: true, note: null })
assert.deepEqual(plan(false, { ticked: true, note: 'sent' }, { ticked: false }),
  { ok: true, action: 'untick', ticked: false, note: 'sent' }, 'untick keeps the note')
assert.deepEqual(plan(false, { ticked: false, note: null }, { note: 'chasing' }),
  { ok: true, action: 'note', ticked: false, note: 'chasing' }, 'a note does not change the tick')
assert.deepEqual(plan(false, { ticked: false, note: 'old' }, { ticked: true, note: 'paid by phone' }),
  { ok: true, action: 'tick', ticked: true, note: 'paid by phone' }, 'tick and note together record the tick')
assert.deepEqual(plan(false, { ticked: true, note: 'x' }, { note: '  ' }),
  { ok: true, action: 'note', ticked: true, note: null }, 'a blank note clears the note')
assert.deepEqual(plan(false, null, {}), { ok: false, error: 'Nothing changed' })
assert.deepEqual(plan(false, { ticked: true, note: 'x' }, { ticked: true, note: 'x' }),
  { ok: false, error: 'Nothing changed' }, 'same tick and same note is not written')

// XCMS box: notes only
const autoTickRefused = plan(true, null, { ticked: true })
assert.equal(autoTickRefused.ok, false, 'XCMS boxes cannot be ticked by hand')
assert.deepEqual(plan(true, null, { note: 'store asked for extra time' }),
  { ok: true, action: 'note', ticked: null, note: 'store asked for extra time' })
assert.deepEqual(plan(true, { ticked: false, note: 'a' }, { note: 'a' }), { ok: false, error: 'Nothing changed' })

// Notes are trimmed and capped
assert.equal(normaliseNote('  hi  '), 'hi')
assert.equal(normaliseNote(''), null)
assert.equal(normaliseNote(undefined), null)
assert.equal(NOTE_MAX_LENGTH, 500)

// ── Checklist assembly ───────────────────────────────────────────────────
const logRow = (over: Partial<LogInput> & Pick<LogInput, 'id' | 'created_at' | 'item' | 'action'>): LogInput => ({
  store_id: null, extra_store_id: null, ticked: null, note: null,
  by_member_id: MEMBER_ALI, by_name: 'Ali', ...over,
})

const base: BuildInput = {
  month: '2026-10',
  stores: [
    { id: STORE_B, store_code: 'STR-002', store_name: 'Beta', pic_name: 'Bee', pic_phone: '0123' },
    { id: STORE_A, store_code: 'STR-001', store_name: 'Alpha', pic_name: 'Ann', pic_phone: '0111' },
  ],
  extraStores: [
    { id: EXTRA_X, name: 'Xtra Shop', pic_name: null, pic_phone: null, active: true },
    { id: '44444444-4444-4444-8444-444444444444', name: 'Gone Shop', pic_name: 'G', pic_phone: '0999', active: false },
  ],
  sales: [
    { store_id: STORE_A, sale_date: '2026-10-03' },
    { store_id: STORE_A, sale_date: '2026-10-29' },
  ],
  periods: [period({ id: 'pA', store_id: STORE_A, status: 'paid', invoice_no: 101, paid_at: '2026-11-05T02:00:00Z' })],
  receipts: [{ commission_period_id: 'pA', status: 'confirmed' }],
  restocks: [{ store_id: STORE_B, dispatch_date: '2026-10-20' }],
  log: [
    logRow({ id: 'l1', created_at: '2026-11-01T01:00:00Z', extra_store_id: EXTRA_X, item: 'payment', action: 'tick', ticked: true, note: 'transfer seen' }),
    logRow({ id: 'l2', created_at: '2026-11-02T01:00:00Z', extra_store_id: EXTRA_X, item: 'payment', action: 'untick', ticked: false, note: 'transfer seen', by_member_id: MEMBER_SITI, by_name: 'Siti' }),
    logRow({ id: 'l3', created_at: '2026-11-02T02:00:00Z', extra_store_id: EXTRA_X, item: 'payment', action: 'note', ticked: false, note: 'waiting on bank', by_member_id: MEMBER_SITI, by_name: 'Siti' }),
    logRow({ id: 'l4', created_at: '2026-11-03T03:00:00Z', store_id: STORE_B, item: 'sales_report', action: 'note', note: 'shop closed for renovation' }),
  ],
}

const view = buildFollowupMonth(base)

// Rows: XCMS by store code first, then extras (active only); hidden listed apart
assert.deepEqual(view.rows.map((r) => r.key), [`store:${STORE_A}`, `store:${STORE_B}`, `extra:${EXTRA_X}`])
assert.deepEqual(view.hidden.map((h) => h.name), ['Gone Shop'])

const alpha = view.rows[0]
assert.equal(alpha.cells.sales_report.done, true)
assert.equal(alpha.cells.sales_report.auto, true)
assert.equal(alpha.cells.sales_report.auto_date, '2026-10-03')
assert.equal(alpha.cells.invoice.done, true)
assert.equal(alpha.cells.invoice.auto_detail, 'XCSM-101')
assert.equal(alpha.cells.payment.done, true)
assert.equal(alpha.cells.restock.done, false, 'no restock DO for Alpha')
assert.equal(alpha.missing, 1)

const beta = view.rows[1]
assert.equal(beta.cells.sales_report.done, false, 'Beta has no sales in the month')
assert.equal(beta.cells.sales_report.note, 'shop closed for renovation', 'auto boxes still take notes')
assert.equal(beta.cells.sales_report.last_by, 'Ali')
assert.equal(beta.cells.restock.done, true)
assert.equal(beta.cells.invoice.auto_detail, 'No invoice yet')
assert.equal(beta.missing, 3)

const extra = view.rows[2]
assert.equal(extra.kind, 'extra')
assert.equal(extra.cells.payment.done, false, 'the last change was an untick, so the box is not ticked')
assert.equal(extra.cells.payment.note, 'waiting on bank', 'the newest note wins')
assert.equal(extra.cells.payment.last_by, 'Siti')
assert.equal(extra.cells.payment.history.length, 3, 'every change stays in the history, oldest first')
assert.deepEqual(extra.cells.payment.history.map((h) => h.action), ['tick', 'untick', 'note'])
assert.equal(extra.cells.invoice.done, false, 'a hand-ticked box with no history is not done')
assert.equal(extra.cells.invoice.last_by, null)

// Column counts: Sales Report missing on Beta and Xtra; Invoice on Beta and Xtra; Payment on Beta and Xtra; Restock on Alpha and Xtra
assert.deepEqual(view.outstanding, { sales_report: 2, invoice: 2, payment: 2, restock: 2 })

// Still-to-follow-up filter keeps any row with a box not ticked
assert.deepEqual(stillToFollowUp(view.rows).map((r) => r.key), view.rows.map((r) => r.key))

// A fully ticked extra store drops out of the filter
const done = buildFollowupMonth({
  ...base,
  log: [
    ...base.log,
    ...(['sales_report', 'invoice', 'payment', 'restock'] as const).map((item, i) =>
      logRow({ id: `full${i}`, created_at: `2026-11-04T0${i}:00:00Z`, extra_store_id: EXTRA_X, item, action: 'tick', ticked: true })),
  ],
})
const extraDone = done.rows.find((r) => r.kind === 'extra')!
assert.equal(extraDone.missing, 0)
assert.ok(!stillToFollowUp(done.rows).some((r) => r.key === `extra:${EXTRA_X}`), 'fully ticked extra store leaves the filter')
assert.equal(done.outstanding.payment, 1, 'only Beta is still missing payment')

// The log never changes the XCMS box state, only the note
const notAllowedToTick = buildFollowupMonth({
  ...base,
  log: [logRow({ id: 'x1', created_at: '2026-11-05T00:00:00Z', store_id: STORE_A, item: 'invoice', action: 'note', note: 'checked' })],
})
assert.equal(notAllowedToTick.rows[0].cells.invoice.done, true, 'invoice still comes from XCMS')
assert.equal(notAllowedToTick.rows[0].cells.invoice.note, 'checked')

// Empty month: no rows, every column at zero
const empty = buildFollowupMonth({ ...base, sales: [], periods: [], receipts: [], restocks: [], log: [] })
assert.equal(empty.rows.length, 3)
assert.deepEqual(empty.outstanding, { sales_report: 3, invoice: 3, payment: 3, restock: 3 })

console.log('test-followups: all checks passed')
