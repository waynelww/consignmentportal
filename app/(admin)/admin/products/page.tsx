'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Edit, X, AlertTriangle, Upload, RefreshCw, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, PRODUCT_CATEGORY_LABELS, cn } from '@/lib/utils'
import type { Product, ProductCategory } from '@/types'
import { toast } from 'sonner'

const productSchema = z.object({
  sku: z.string().min(2, 'SKU is required'),
  name: z.string().min(2, 'Name is required'),
  category: z.string().min(1, 'Category is required'),
  color: z.string().min(1, 'Color is required'),
  selling_price: z.number().min(0.01, 'Selling price required'),
  cost_price: z.number().min(0.01, 'Cost price required'),
  barcode: z.string().optional(),
  is_core_sku: z.boolean(),
  is_active: z.boolean(),
  description: z.string().optional(),
})

type ProductFormData = z.infer<typeof productSchema>

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs text-red-500 mt-1">{message}</p>
}

interface ProductWithCount extends Product {
  stores_count: number
}

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState<Product | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncingInventory, setSyncingInventory] = useState(false)

  async function syncShopifyImages() {
    if (syncing) return
    setSyncing(true)
    try {
      const res = await fetch('/api/products/sync-shopify-images', { method: 'POST' })
      // Guard the parse: a timed-out/killed function returns an empty or
      // non-JSON body, and res.json() on that throws a cryptic error in
      // Safari ("The string did not match the expected pattern").
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        toast.error(data?.error ?? `Sync failed (HTTP ${res.status}) — it may have timed out, try again`, { description: data?.details, duration: 8000 })
        return
      }
      toast.success(
        `Updated ${data.updated ?? 0} products · ${data.unchanged ?? 0} unchanged · ${data.not_found_in_shopify ?? 0} not found in Shopify`,
        { duration: 6000 },
      )
      fetchProducts()
    } catch (e) {
      toast.error(`Network error: ${e instanceof Error ? e.message : 'Unknown'}`)
    } finally {
      setSyncing(false)
    }
  }

  async function syncShopifyInventory() {
    if (syncingInventory) return
    setSyncingInventory(true)
    try {
      const res = await fetch('/api/products/sync-shopify-inventory', { method: 'POST' })
      // Same parse guard as the images sync — never let an empty error
      // body surface as a raw browser exception.
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        toast.error(data?.error ?? `Sync failed (HTTP ${res.status}) — it may have timed out, try again`, { description: data?.details, duration: 8000 })
        return
      }
      toast.success(
        `Inventory synced: ${(data.total_warehouse_pairs ?? 0).toLocaleString()} total pairs in Shopify · ${data.updated ?? 0} updated · ${data.unchanged ?? 0} unchanged · ${data.not_found_in_shopify ?? 0} not found`,
        { duration: 8000 },
      )
      fetchProducts()
    } catch (e) {
      toast.error(`Network error: ${e instanceof Error ? e.message : 'Unknown'}`)
    } finally {
      setSyncingInventory(false)
    }
  }
  const supabase = createClient()

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: { is_core_sku: false, is_active: true },
  })

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('products').select('*').order('sku')
    const prods = (data || []) as Product[]

    // Get store count per product
    const { data: invData } = await supabase
      .from('store_inventory')
      .select('product_id')
      .gt('quantity_on_hand', 0)

    const countMap: Record<string, number> = {}
    for (const inv of invData || []) {
      countMap[inv.product_id] = (countMap[inv.product_id] || 0) + 1
    }

    setProducts(
      prods.map((p) => ({ ...p, stores_count: countMap[p.id] || 0 }))
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchProducts()
  }, [fetchProducts])

  function openAdd() {
    form.reset({ is_core_sku: false, is_active: true, selling_price: 0, cost_price: 0 })
    setEditProduct(null)
    setModalOpen(true)
  }

  function openEdit(product: Product) {
    form.reset({
      sku: product.sku,
      name: product.name,
      category: product.category,
      color: product.color,
      selling_price: product.selling_price,
      cost_price: product.cost_price,
      barcode: product.barcode || '',
      is_core_sku: product.is_core_sku,
      is_active: product.is_active,
      description: product.description || '',
    })
    setEditProduct(product)
    setModalOpen(true)
  }

  async function onSubmit(data: ProductFormData) {
    if (editProduct) {
      const { error } = await supabase
        .from('products')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', editProduct.id)
      if (error) { toast.error('Failed to update product'); return }
      toast.success('Product updated')
    } else {
      const { error } = await supabase.from('products').insert({
        ...data,
        category: data.category as ProductCategory,
      })
      if (error) { toast.error('Failed to create product: ' + error.message); return }
      toast.success('Product created')
    }
    setModalOpen(false)
    fetchProducts()
  }

  async function handleToggleActive(product: Product) {
    if (product.is_active) {
      setConfirmDeactivate(product)
      return
    }
    const { error } = await supabase
      .from('products')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', product.id)
    if (error) toast.error('Failed to activate')
    else { toast.success('Product activated'); fetchProducts() }
  }

  async function confirmDeactivateProduct() {
    if (!confirmDeactivate) return
    const { error } = await supabase
      .from('products')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', confirmDeactivate.id)
    setConfirmDeactivate(null)
    if (error) toast.error('Failed to deactivate')
    else { toast.success('Product deactivated'); fetchProducts() }
  }

  async function toggleCore(product: Product) {
    const { error } = await supabase
      .from('products')
      .update({ is_core_sku: !product.is_core_sku, updated_at: new Date().toISOString() })
      .eq('id', product.id)
    if (error) toast.error('Failed to update')
    else fetchProducts()
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end gap-2 flex-wrap">
        <button
          onClick={syncShopifyInventory}
          disabled={syncingInventory}
          className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 text-amber-900 font-semibold rounded-lg text-sm hover:bg-amber-100 transition-colors disabled:opacity-50"
        >
          {syncingInventory ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {syncingInventory ? 'Syncing…' : 'Sync Shopify inventory'}
        </button>
        <button
          onClick={syncShopifyImages}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {syncing ? 'Syncing…' : 'Sync variant images'}
        </button>
        <Link
          href="/admin/products/import"
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors"
        >
          <Upload size={16} />
          Import from Shopify
        </Link>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 transition-colors"
        >
          <Plus size={16} />
          Add Product
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">SKU</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Category</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Color</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Selling Price</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Cost Price</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500" title="Total pairs available in Shopify across all locations">
                  Shopify Qty
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">Core SKU</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">Active</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Stores</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      {Array.from({ length: 11 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-100 animate-pulse rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                : products.map((p) => (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.sku}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                      <td className="px-4 py-3 text-gray-600 capitalize">
                        {PRODUCT_CATEGORY_LABELS[p.category] || p.category}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{p.color}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(p.selling_price)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(p.cost_price)}</td>
                      <td className="px-4 py-3 text-right font-bold">
                        {p.shopify_inventory_qty == null ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <span className={cn(
                            p.shopify_inventory_qty <= 0
                              ? 'text-red-600'
                              : p.shopify_inventory_qty < 20
                                ? 'text-amber-600'
                                : 'text-gray-800',
                          )}>
                            {p.shopify_inventory_qty.toLocaleString()}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => toggleCore(p)}
                          className={cn(
                            'px-2.5 py-0.5 rounded-full text-xs font-semibold transition-colors',
                            p.is_core_sku
                              ? 'bg-[#FFD700]/20 text-[#0A0A0A] hover:bg-[#FFD700]/40'
                              : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                          )}
                        >
                          {p.is_core_sku ? 'Core' : 'No'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleToggleActive(p)}
                          className={cn(
                            'px-2.5 py-0.5 rounded-full text-xs font-semibold transition-colors',
                            p.is_active
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                          )}
                        >
                          {p.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{p.stores_count}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openEdit(p)}
                          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <Edit size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
              {!loading && products.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-gray-400 text-sm">
                    No products yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-gray-900">
                {editProduct ? 'Edit Product' : 'Add Product'}
              </h3>
              <button onClick={() => setModalOpen(false)}>
                <X size={18} className="text-gray-400 hover:text-gray-600" />
              </button>
            </div>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">SKU *</label>
                  <input
                    {...form.register('sku')}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                    placeholder="e.g. XOCKS-ANK-BLK"
                  />
                  <FieldError message={form.formState.errors.sku?.message} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Category *</label>
                  <select
                    {...form.register('category')}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  >
                    <option value="">Select...</option>
                    {Object.entries(PRODUCT_CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <FieldError message={form.formState.errors.category?.message} />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Name *</label>
                <input
                  {...form.register('name')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
                <FieldError message={form.formState.errors.name?.message} />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Color *</label>
                <input
                  {...form.register('color')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  placeholder="e.g. Black, White, Navy"
                />
                <FieldError message={form.formState.errors.color?.message} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Selling Price (RM) *</label>
                  <input
                    type="number"
                    step="0.01"
                    {...form.register('selling_price', { valueAsNumber: true })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                  <FieldError message={form.formState.errors.selling_price?.message} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Cost Price (RM) *</label>
                  <input
                    type="number"
                    step="0.01"
                    {...form.register('cost_price', { valueAsNumber: true })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                  />
                  <FieldError message={form.formState.errors.cost_price?.message} />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Barcode</label>
                <input
                  {...form.register('barcode')}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700]"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Description</label>
                <textarea
                  {...form.register('description')}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FFD700] resize-none"
                />
              </div>

              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" {...form.register('is_core_sku')} className="accent-[#FFD700]" />
                  <span className="text-sm text-gray-700">Core SKU</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" {...form.register('is_active')} className="accent-[#FFD700]" />
                  <span className="text-sm text-gray-700">Active</span>
                </label>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-[#0A0A0A] text-white rounded-lg text-sm hover:bg-gray-800 transition-colors"
                >
                  {editProduct ? 'Save Changes' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deactivate Confirm */}
      {confirmDeactivate && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-100 rounded-full">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <h3 className="text-base font-semibold text-gray-900">Deactivate Product?</h3>
            </div>
            <p className="text-sm text-gray-600 mb-5">
              Deactivating <strong>{confirmDeactivate.name}</strong> ({confirmDeactivate.sku}) will
              hide it from new store setups and restock requests.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeactivate(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeactivateProduct}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors"
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
