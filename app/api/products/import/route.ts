import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export interface ImportRow {
  sku: string
  name: string
  category: string
  color: string
  selling_price: number
  cost_price: number
  barcode?: string
  description?: string
  is_core_sku: boolean
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { products }: { products: ImportRow[] } = await req.json()
  if (!products?.length) return NextResponse.json({ error: 'No products' }, { status: 400 })

  const { data, error } = await supabase
    .from('products')
    .upsert(products, { onConflict: 'sku' })
    .select('id, sku')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ imported: data?.length ?? 0 })
}
