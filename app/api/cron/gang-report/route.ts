/**
 * GET /api/cron/gang-report
 * Daily Vercel Cron at 9am MYT (01:00 UTC). The route decides what to send:
 *  - Monday            → weekly Shopee/TikTok CRM report
 *  - 1st of the month  → monthly report (for the previous calendar month)
 *  - any other day     → no-op
 * Manual runs: pass ?period=weekly|monthly to force one regardless of day.
 * Website members are excluded by design — the CRM's purpose is marketplace
 * customers; website buyers already live in Shopify.
 */
import { type NextRequest } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildGangReport, type GangReport } from '@/lib/gang/report'

export const maxDuration = 60

const REPORT_TO = process.env.GANG_REPORT_EMAIL || 'waynelww2000@gmail.com'

function row(label: string, value: string | number): string {
  return `<tr>
    <td style="padding:8px 0;font-size:14px;color:#666;border-bottom:1px solid #f0f0f0;">${label}</td>
    <td style="padding:8px 0;font-size:14px;color:#111;font-weight:700;text-align:right;border-bottom:1px solid #f0f0f0;">${value}</td>
  </tr>`
}

function section(title: string, rows: string): string {
  return `
    <h3 style="margin:24px 0 8px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#999;">${title}</h3>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}</table>`
}

function reportHtml(r: GangReport): string {
  const staleDays = r.lastUploadBatch
    ? Math.floor((Date.now() - new Date(r.lastUploadBatch).getTime()) / 86400_000)
    : null
  const backlogWarn =
    r.pendingBacklog > 50 || (staleDays !== null && staleDays > 3)
      ? `<div style="margin:20px 0 0;padding:12px 16px;background:#FDF0E7;border:1px solid #E8734A;border-radius:8px;font-size:13.5px;color:#8a3415;">
           ⚠️ <strong>${r.pendingBacklog} orders pending verification.</strong> Last order upload: ${r.lastUploadBatch ?? 'never'}${staleDays !== null ? ` (${staleDays} days ago)` : ''}. Have the team upload the latest Shopee/TikTok order lists.
         </div>`
      : ''
  return `
  <div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif;background:#fff;border-radius:10px;padding:28px 32px;border:1px solid #eee;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#999;">Xocks Gang · ${r.period} report</div>
    <h2 style="margin:6px 0 2px;font-size:22px;color:#111;">Shopee &amp; TikTok CRM</h2>
    <div style="font-size:13px;color:#888;">${r.periodLabel}</div>

    ${section(`New this ${r.period === 'weekly' ? 'week' : 'month'}`, [
      row('New members (Shopee)', r.newMembers.shopee),
      row('New members (TikTok)', r.newMembers.tiktok),
      row('New members total', r.newMembers.total),
      row('Orders registered (Shopee)', r.newOrders.shopee),
      row('Orders registered (TikTok)', r.newOrders.tiktok),
    ].join(''))}

    ${section('Signup rate (all time)', [
      row('Shopee — registered / platform orders', `${r.registeredOrders.shopee} / ${r.uploadedOrders.shopee} (${r.signupRate.shopee})`),
      row('TikTok — registered / platform orders', `${r.registeredOrders.tiktok} / ${r.uploadedOrders.tiktok} (${r.signupRate.tiktok})`),
    ].join(''))}

    ${section('Database (all time, marketplace only)', [
      row('Total marketplace members', r.totalMembers.total),
      row('— Shopee only', r.totalMembers.shopee),
      row('— TikTok only', r.totalMembers.tiktok),
      row('— Both platforms', r.totalMembers.multi),
      row('Repeat customers (2+ orders)', r.repeatCustomers),
      row('Crossed over to website', r.websiteCrossover),
      row('Pending verification backlog', r.pendingBacklog),
    ].join(''))}

    ${backlogWarn}

    <div style="margin-top:24px;font-size:12px;color:#aaa;">Sent automatically by XCMS · consignmentportal.vercel.app/admin/gang</div>
  </div>`
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const forced = request.nextUrl.searchParams.get('period')
  const nowMYT = new Date(Date.now() + 8 * 3600_000)
  const toSend: ('weekly' | 'monthly')[] = []
  if (forced === 'weekly' || forced === 'monthly') {
    toSend.push(forced)
  } else {
    if (nowMYT.getUTCDay() === 1) toSend.push('weekly') // Monday
    if (nowMYT.getUTCDate() === 1) toSend.push('monthly') // 1st of month
  }
  if (toSend.length === 0) {
    return Response.json({ ok: true, skipped: 'not a report day' })
  }

  const supabase = createAdminClient()
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL || 'noreply@xocks.co'
  const sent: string[] = []

  for (const period of toSend) {
    const report = await buildGangReport(supabase, period)
    const label = period === 'weekly' ? 'Weekly' : 'Monthly'
    const { error } = await resend.emails.send({
      from,
      to: REPORT_TO,
      subject: `🧦 Gang CRM ${label} — ${report.newMembers.total} new Shopee/TikTok members (${report.periodLabel})`,
      html: reportHtml(report),
    })
    if (error) {
      console.error(`[cron gang-report] ${period} email failed:`, error)
      return Response.json({ ok: false, sent, failed: period, error: String(error) }, { status: 500 })
    }
    sent.push(period)
  }

  console.log(`[cron gang-report] sent: ${sent.join(', ')} → ${REPORT_TO}`)
  return Response.json({ ok: true, sent })
}
