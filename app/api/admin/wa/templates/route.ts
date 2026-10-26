import { requireWaAdmin } from '@/lib/wa/require-admin'
import { fetchApprovedTemplates, waConfigured } from '@/lib/wa/client'

// GET /api/admin/wa/templates — approved templates on the WABA, for the
// blast composer's template picker.
export async function GET() {
  const { denied } = await requireWaAdmin()
  if (denied) return denied

  if (!waConfigured()) {
    return Response.json(
      { error: 'WhatsApp is not configured — set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID (see docs/WHATSAPP_SETUP.md)' },
      { status: 503 },
    )
  }

  const { templates, error } = await fetchApprovedTemplates()
  if (error) return Response.json({ error: `Template fetch failed: ${error}` }, { status: 502 })
  return Response.json({ templates })
}
