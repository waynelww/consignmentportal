import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { insertWithSequenceCode } from '@/lib/sequence-code'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are XCMS Assistant — the AI operations manager for Xocks Consignment Management System.

You help Wayne and the ops team manage consignment operations across all stores. You can:
- List stores and check their inventory
- Create Delivery Orders (DOs) to send stock to stores
- Check restock queue and pending requests
- Look up products and stock levels
- View recent sales and commissions

When taking actions, be direct and confirm what you did. Format DO numbers, store codes, and SKUs in bold.
For creating DOs: always confirm the store name, list the items, and show the DO number created.
If you need info you don't have (like which specific products), ask the user or use list_products to find them.
When the user says "SKUs A10 to A20", expand that into the explicit list: ["A10","A11","A12","A13","A14","A15","A16","A17","A18","A19","A20"] and use the skus parameter in list_products.`

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_stores',
    description: 'List all active consignment stores. Returns store id, name, code, city, state, and commission rate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Optional search term to filter by store name or code' },
      },
    },
  },
  {
    name: 'list_products',
    description: 'Search the product catalog. Returns product id, sku, name, category, color, selling_price.',
    input_schema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search by name, SKU, or color. Use this for a single keyword.' },
        skus: { type: 'array', items: { type: 'string' }, description: 'Fetch exact list of SKUs, e.g. ["A10","A11","A12"]. Use this when the user specifies a range like "A10 to A20".' },
        category: { type: 'string', description: 'Filter by category: ankle, crew, no_show, half, kids, muslimah, design' },
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
    },
  },
  {
    name: 'get_store_inventory',
    description: 'Get current stock levels for a specific store.',
    input_schema: {
      type: 'object' as const,
      properties: {
        store_id: { type: 'string', description: 'Store UUID' },
      },
      required: ['store_id'],
    },
  },
  {
    name: 'create_delivery_order',
    description: 'Create a Delivery Order (DO) to send stock to a store. The store will see it as pending receiving. Once they receive it, the stock flows into their inventory automatically.',
    input_schema: {
      type: 'object' as const,
      properties: {
        store_id: { type: 'string', description: 'Store UUID' },
        do_type: { type: 'string', enum: ['initial', 'restock', 'return'], description: 'initial = first stock, restock = replenishment, return = stock coming back' },
        items: {
          type: 'array',
          description: 'Products to include in the delivery order',
          items: {
            type: 'object',
            properties: {
              product_id: { type: 'string', description: 'Product UUID' },
              quantity: { type: 'number', description: 'Number of pairs' },
            },
            required: ['product_id', 'quantity'],
          },
        },
        notes: { type: 'string', description: 'Optional notes for the store' },
      },
      required: ['store_id', 'do_type', 'items'],
    },
  },
  {
    name: 'list_delivery_orders',
    description: 'List recent delivery orders, optionally filtered by store or status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        store_id: { type: 'string', description: 'Filter by store UUID' },
        status: { type: 'string', description: 'Filter by status: confirmed, dispatched, received, cancelled' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
    },
  },
  {
    name: 'get_dashboard_stats',
    description: 'Get overall system stats: active stores, total sales this month, revenue, pending restocks, DOs in transit.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'list_restock_requests',
    description: 'List pending restock requests from stores.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'Filter by status: pending, approved, fulfilled, rejected' },
      },
    },
  },
]

async function runTool(name: string, input: Record<string, unknown>, supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  switch (name) {
    case 'list_stores': {
      let q = supabase.from('stores').select('id, store_name, store_code, city, state, commission_rate, status').eq('status', 'active').order('store_name')
      if (input.search) q = q.or(`store_name.ilike.%${input.search}%,store_code.ilike.%${input.search}%`)
      const { data, error } = await q
      if (error) return { error: error.message }
      return { stores: data, count: data?.length }
    }

    case 'list_products': {
      let q = supabase.from('products').select('id, sku, name, category, color, selling_price').eq('is_active', true).order('sku').limit((input.limit as number) || 50)
      if (input.skus && Array.isArray(input.skus) && input.skus.length > 0) {
        q = q.in('sku', input.skus as string[])
      } else if (input.search) {
        q = q.or(`name.ilike.%${input.search}%,sku.ilike.%${input.search}%,color.ilike.%${input.search}%`)
      }
      if (input.category) q = q.eq('category', input.category)
      const { data, error } = await q
      if (error) return { error: error.message }
      return { products: data, count: data?.length }
    }

    case 'get_store_inventory': {
      const { data, error } = await supabase
        .from('store_inventory')
        .select('quantity_on_hand, restock_threshold, products:product_id(sku, name, category, color)')
        .eq('store_id', input.store_id as string)
        .order('quantity_on_hand', { ascending: false })
      if (error) return { error: error.message }
      return { inventory: data, total_items: data?.length }
    }

    case 'create_delivery_order': {
      const year = new Date().getFullYear()
      const items = input.items as Array<{ product_id: string; quantity: number }>
      const total_pairs = items.reduce((s, i) => s + i.quantity, 0)

      const { data: newDo, error: doErr } = await insertWithSequenceCode<{ id: string; do_number: string }>({
        supabase,
        table: 'delivery_orders',
        column: 'do_number',
        prefix: `DO-${year}-`,
        padLength: 4,
        insertFn: (doNumber) =>
          supabase
            .from('delivery_orders')
            .insert({
              do_number: doNumber,
              store_id: input.store_id,
              do_type: input.do_type,
              status: 'confirmed',
              total_pairs,
              notes: input.notes ?? null,
              created_by: userId,
            })
            .select('id, do_number')
            .single(),
      })

      if (doErr || !newDo) return { error: doErr?.message ?? 'Failed to create DO' }

      const productIds = items.map(i => i.product_id)
      const { data: products } = await supabase.from('products').select('id, cost_price').in('id', productIds)
      const costMap = new Map((products ?? []).map(p => [p.id, p.cost_price]))

      const { error: itemsErr } = await supabase.from('delivery_order_items').insert(
        items.map(i => ({ delivery_order_id: newDo.id, product_id: i.product_id, quantity: i.quantity, unit_cost: costMap.get(i.product_id) ?? 0 }))
      )
      if (itemsErr) return { error: itemsErr.message }

      return { success: true, do_number: newDo.do_number, delivery_order_id: newDo.id, total_pairs, status: 'confirmed', message: 'Delivery order created. The store can now see it as pending receiving.' }
    }

    case 'list_delivery_orders': {
      let q = supabase
        .from('delivery_orders')
        .select('id, do_number, do_type, status, total_pairs, created_at, notes, stores:store_id(store_name, store_code)')
        .order('created_at', { ascending: false })
        .limit((input.limit as number) || 10)
      if (input.store_id) q = q.eq('store_id', input.store_id as string)
      if (input.status) q = q.eq('status', input.status as string)
      const { data, error } = await q
      if (error) return { error: error.message }
      return { delivery_orders: data }
    }

    case 'get_dashboard_stats': {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const [
        { count: activeStores },
        { count: salesMTD },
        { count: pendingRestocks },
        { count: dosInTransit },
      ] = await Promise.all([
        supabase.from('stores').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('sales').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
        supabase.from('restock_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('delivery_orders').select('*', { count: 'exact', head: true }).in('status', ['confirmed', 'dispatched']),
      ])
      const { data: revData } = await supabase.from('sales').select('total_amount').gte('created_at', monthStart)
      const revenueMTD = (revData ?? []).reduce((s, r) => s + (r.total_amount ?? 0), 0)
      return { active_stores: activeStores, sales_pairs_mtd: salesMTD, revenue_mtd: revenueMTD, pending_restocks: pendingRestocks, dos_in_transit: dosInTransit }
    }

    case 'list_restock_requests': {
      let q = supabase
        .from('restock_requests')
        .select('id, status, notes, created_at, stores:store_id(store_name, store_code)')
        .order('created_at', { ascending: false })
        .limit(20)
      if (input.status) q = q.eq('status', input.status as string)
      const { data, error } = await q
      if (error) return { error: error.message }
      return { restock_requests: data }
    }

    default:
      return { error: 'Unknown tool' }
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { messages } = await req.json() as { messages: Anthropic.MessageParam[] }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let currentMessages = [...messages]

        // Agentic loop — keep going until no more tool calls
        while (true) {
          const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            system: SYSTEM_PROMPT,
            tools: TOOLS,
            messages: currentMessages,
          })

          // Stream text chunks
          for (const block of response.content) {
            if (block.type === 'text') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text: block.text })}\n\n`))
            }
          }

          if (response.stop_reason === 'end_turn') break

          if (response.stop_reason === 'tool_use') {
            const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')
            currentMessages.push({ role: 'assistant', content: response.content })

            const toolResults: Anthropic.ToolResultBlockParam[] = []
            for (const block of toolUseBlocks) {
              if (block.type !== 'tool_use') continue
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'tool_call', tool: block.name })}\n\n`))
              const result = await runTool(block.name, block.input as Record<string, unknown>, supabase, user.id)
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
            }
            currentMessages.push({ role: 'user', content: toolResults })
          } else {
            break
          }
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'AI error'
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
