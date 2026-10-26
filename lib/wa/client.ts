// WhatsApp Cloud API client (direct Meta Graph API, no BSP).
// Env: WHATSAPP_TOKEN (system-user token), WHATSAPP_PHONE_NUMBER_ID,
// WHATSAPP_WABA_ID (business-account id, for template listing),
// WHATSAPP_GRAPH_VERSION (optional, defaults below).

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v24.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

export function waConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
}

interface GraphError {
  message?: string
  code?: number
  error_subcode?: number
  error_data?: { details?: string }
}

export interface SendResult {
  ok: boolean
  waMessageId?: string
  errorCode?: string
  errorMessage?: string
}

async function graphFetch(path: string, init?: RequestInit): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

// Sends a pre-approved template message. `bodyParams` are positional {{1}}…
// values; pass [] for templates without variables.
export async function sendTemplate(
  to: string,
  templateName: string,
  language: string,
  bodyParams: string[],
): Promise<SendResult> {
  const components = bodyParams.length
    ? [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }]
    : undefined

  const { status, json } = await graphFetch(
    `/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: language },
          ...(components ? { components } : {}),
        },
      }),
    },
  )

  const data = json as { messages?: { id: string }[]; error?: GraphError } | null
  if (status >= 200 && status < 300 && data?.messages?.[0]?.id) {
    return { ok: true, waMessageId: data.messages[0].id }
  }
  return {
    ok: false,
    errorCode: String(data?.error?.code ?? status),
    errorMessage:
      data?.error?.error_data?.details || data?.error?.message || `HTTP ${status}`,
  }
}

export interface WaTemplate {
  name: string
  language: string
  category: string
  bodyText: string
  // Number of {{n}} placeholders in the body.
  paramCount: number
}

// Lists APPROVED templates on the WhatsApp Business Account.
export async function fetchApprovedTemplates(): Promise<{ templates: WaTemplate[]; error?: string }> {
  const wabaId = process.env.WHATSAPP_WABA_ID
  if (!wabaId) return { templates: [], error: 'WHATSAPP_WABA_ID is not set' }

  const { status, json } = await graphFetch(
    `/${wabaId}/message_templates?status=APPROVED&limit=100&fields=name,language,category,components`,
  )
  const data = json as {
    data?: { name: string; language: string; category: string; components?: { type: string; text?: string }[] }[]
    error?: GraphError
  } | null

  if (status < 200 || status >= 300 || !data?.data) {
    return { templates: [], error: data?.error?.message || `HTTP ${status}` }
  }

  const templates = data.data.map((t) => {
    const body = t.components?.find((c) => c.type === 'BODY')?.text ?? ''
    const placeholders = new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]))
    return {
      name: t.name,
      language: t.language,
      category: t.category,
      bodyText: body,
      paramCount: placeholders.size,
    }
  })
  return { templates }
}
