import { Resend } from 'resend'

// Lazy singleton — avoids crashing at module load time when RESEND_API_KEY is
// not present (e.g. during Next.js build-time static page collection).
let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

const FROM = process.env.RESEND_FROM_EMAIL || 'noreply@xocks.co'

// ── Shared HTML helpers ──────────────────────────────────────────────────────

function brandHeader(): string {
  return `
    <div style="background:#000;padding:20px 32px;">
      <span style="font-family:Arial,sans-serif;font-size:28px;font-weight:bold;color:#D4AC3A;letter-spacing:3px;">XOCKS</span>
    </div>
  `
}

function emailWrapper(body: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
              <tr><td>${brandHeader()}</td></tr>
              <tr>
                <td style="padding:32px;">
                  ${body}
                </td>
              </tr>
              <tr>
                <td style="background:#f9f9f9;padding:16px 32px;text-align:center;border-top:1px solid #eee;">
                  <p style="margin:0;font-size:12px;color:#999;">
                    Wayne Group Holding Sdn Bhd &bull; hello@xocks.co
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `
}

function h2(text: string): string {
  return `<h2 style="margin:0 0 16px;font-size:20px;color:#111;">${text}</h2>`
}

function p(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;color:#333;line-height:1.6;">${text}</p>`
}

function infoRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:6px 0;font-size:14px;color:#666;width:160px;">${label}</td>
      <td style="padding:6px 0;font-size:14px;color:#111;font-weight:600;">${value}</td>
    </tr>
  `
}

function infoTable(rows: Array<[string, string]>): string {
  return `
    <table cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;border-collapse:collapse;">
      ${rows.map(([l, v]) => infoRow(l, v)).join('')}
    </table>
  `
}

function ctaButton(text: string, href: string): string {
  return `
    <a href="${href}" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#000;color:#D4AC3A;font-size:14px;font-weight:bold;text-decoration:none;border-radius:4px;letter-spacing:1px;">
      ${text}
    </a>
  `
}

function formatCurrency(amount: number): string {
  return `RM ${amount.toFixed(2)}`
}

// ── Email senders ────────────────────────────────────────────────────────────

export async function sendWelcomeEmail(params: {
  to: string
  storeName: string
  picName: string
  email: string
  tempPassword: string
}): Promise<void> {
  try {
    const body = `
      ${h2(`Welcome to Xocks, ${params.picName}!`)}
      ${p(`Your consignment store <strong>${params.storeName}</strong> has been registered on the Xocks platform.`)}
      ${p('Here are your login credentials:')}
      ${infoTable([
        ['Email', params.email],
        ['Temporary Password', params.tempPassword],
      ])}
      ${p('Please log in and change your password as soon as possible.')}
      ${ctaButton('Log In to Xocks', 'https://xcms.xocks.co/login')}
      ${p('If you have any questions, contact your Xocks account manager.')}
    `
    await getResend().emails.send({
      from: FROM,
      to: params.to,
      subject: `Welcome to Xocks — ${params.storeName}`,
      html: emailWrapper(body),
    })
  } catch (err) {
    console.error('[sendWelcomeEmail] Failed to send email:', err)
  }
}

export async function sendDODispatchedEmail(params: {
  to: string
  storeName: string
  doNumber: string
  courier: string
  trackingNumber: string
  dispatchDate: string
}): Promise<void> {
  try {
    const body = `
      ${h2('Your Delivery Is On The Way!')}
      ${p(`A delivery order has been dispatched to <strong>${params.storeName}</strong>.`)}
      ${infoTable([
        ['DO Number', params.doNumber],
        ['Courier', params.courier],
        ['Tracking No.', params.trackingNumber],
        ['Dispatch Date', params.dispatchDate],
      ])}
      ${p('Please acknowledge receipt in the system once the delivery arrives.')}
      ${ctaButton('View Delivery Order', `https://xcms.xocks.co/store/deliveries`)}
    `
    await getResend().emails.send({
      from: FROM,
      to: params.to,
      subject: `DO Dispatched: ${params.doNumber} — ${params.storeName}`,
      html: emailWrapper(body),
    })
  } catch (err) {
    console.error('[sendDODispatchedEmail] Failed to send email:', err)
  }
}

export async function sendCommissionStatementEmail(params: {
  to: string
  storeName: string
  month: string
  year: number
  commissionAmount: number
  pdfUrl?: string
}): Promise<void> {
  try {
    const body = `
      ${h2(`Commission Statement Ready — ${params.month} ${params.year}`)}
      ${p(`Your commission statement for <strong>${params.storeName}</strong> is now available.`)}
      ${infoTable([
        ['Period', `${params.month} ${params.year}`],
        ['Commission Due', formatCurrency(params.commissionAmount)],
      ])}
      ${params.pdfUrl
        ? ctaButton('Download Statement PDF', params.pdfUrl)
        : ctaButton('View Statement', 'https://xcms.xocks.co/store/commissions')}
      ${p('Payment will be processed once the statement is approved. Contact your account manager for queries.')}
    `
    await getResend().emails.send({
      from: FROM,
      to: params.to,
      subject: `Commission Statement Ready — ${params.month} ${params.year}`,
      html: emailWrapper(body),
    })
  } catch (err) {
    console.error('[sendCommissionStatementEmail] Failed to send email:', err)
  }
}

export async function sendCommissionPaidEmail(params: {
  to: string
  storeName: string
  amount: number
  paymentReference: string
}): Promise<void> {
  try {
    const body = `
      ${h2('Commission Payment Received!')}
      ${p(`Great news — your commission payment for <strong>${params.storeName}</strong> has been processed.`)}
      ${infoTable([
        ['Amount Paid', formatCurrency(params.amount)],
        ['Payment Reference', params.paymentReference],
      ])}
      ${p('Thank you for your continued partnership with Xocks!')}
      ${ctaButton('View Commission History', 'https://xcms.xocks.co/store/commissions')}
    `
    await getResend().emails.send({
      from: FROM,
      to: params.to,
      subject: `Commission Paid — ${formatCurrency(params.amount)}`,
      html: emailWrapper(body),
    })
  } catch (err) {
    console.error('[sendCommissionPaidEmail] Failed to send email:', err)
  }
}

export async function sendLowStockEmail(params: {
  to: string
  storeName: string
  productName: string
}): Promise<void> {
  try {
    const body = `
      ${h2('Low Stock Alert')}
      ${p(`Stock for <strong>${params.productName}</strong> at <strong>${params.storeName}</strong> has dropped below the restock threshold.`)}
      ${p('Please submit a restock request to avoid running out of stock.')}
      ${ctaButton('Request Restock', 'https://xcms.xocks.co/store/restock')}
    `
    await getResend().emails.send({
      from: FROM,
      to: params.to,
      subject: `Low Stock Alert — ${params.productName} at ${params.storeName}`,
      html: emailWrapper(body),
    })
  } catch (err) {
    console.error('[sendLowStockEmail] Failed to send email:', err)
  }
}

export async function sendRestockRequestEmail(params: {
  to: string
  storeName: string
  totalPairs: number
}): Promise<void> {
  try {
    const body = `
      ${h2('New Restock Request')}
      ${p(`A restock request has been submitted for <strong>${params.storeName}</strong>.`)}
      ${infoTable([
        ['Store', params.storeName],
        ['Total Pairs Requested', String(params.totalPairs)],
      ])}
      ${p('Please review and approve the request in the admin panel.')}
      ${ctaButton('Review Request', 'https://xcms.xocks.co/admin/restock')}
    `
    await getResend().emails.send({
      from: FROM,
      to: params.to,
      subject: `Restock Request — ${params.storeName} (${params.totalPairs} pairs)`,
      html: emailWrapper(body),
    })
  } catch (err) {
    console.error('[sendRestockRequestEmail] Failed to send email:', err)
  }
}

export async function sendAtRiskAlertEmail(params: {
  to: string
  storeName: string
  consecutiveMonths: number
  threshold: number
}): Promise<void> {
  try {
    const body = `
      ${h2('At-Risk Store Alert')}
      ${p(`<strong>${params.storeName}</strong> has underperformed for <strong>${params.consecutiveMonths} consecutive month${params.consecutiveMonths !== 1 ? 's' : ''}</strong>.`)}
      ${infoTable([
        ['Consecutive Low Months', String(params.consecutiveMonths)],
        ['At-Risk Threshold', `${params.threshold} months`],
      ])}
      ${p('Please review the store performance and consider scheduling a check-in call.')}
      ${ctaButton('View Store Performance', 'https://xcms.xocks.co/admin/stores')}
    `
    await getResend().emails.send({
      from: FROM,
      to: params.to,
      subject: `At-Risk Alert — ${params.storeName} (${params.consecutiveMonths} months low)`,
      html: emailWrapper(body),
    })
  } catch (err) {
    console.error('[sendAtRiskAlertEmail] Failed to send email:', err)
  }
}
