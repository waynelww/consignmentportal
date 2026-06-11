export type UserRole = 'super_admin' | 'ops_manager' | 'store_owner'

export type StoreType =
  | 'barbershop'
  | 'shoe_store'
  | 'fashion_boutique'
  | 'sports_store'
  | 'laundromat'
  | 'gym'
  | 'muslim_fashion'
  | 'school_uniform'
  | 'pharmacy'
  | 'optical'
  | 'cafe'
  | 'other'

export type StoreStatus = 'active' | 'inactive' | 'suspended' | 'pending'

export type ProductCategory = 'ankle' | 'crew' | 'no_show' | 'half' | 'kids' | 'muslimah' | 'design'

export type MovementType =
  | 'inbound_initial'
  | 'inbound_restock'
  | 'outbound_sale'
  | 'outbound_return'
  | 'adjustment_add'
  | 'adjustment_remove'

export type PaymentMethod = 'qr' | 'cash'

export type RestockRequestStatus = 'pending' | 'approved' | 'rejected' | 'dispatched' | 'received'

export type DeliveryOrderStatus = 'draft' | 'confirmed' | 'dispatched' | 'delivered' | 'acknowledged'

export type DeliveryOrderType = 'initial' | 'restock' | 'return'

export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'disputed'

export type NotificationType =
  | 'low_stock_alert'
  | 'restock_request'
  | 'do_dispatched'
  | 'do_delivered'
  | 'commission_ready'
  | 'commission_paid'
  | 'performance_warning'
  | 'new_store_added'
  | 'payment_receipt_submitted'
  | 'payment_receipt_confirmed'
  | 'payment_receipt_rejected'

export type PaymentReceiptStatus = 'submitted' | 'confirmed' | 'rejected'

export type RestockAlertStatus = 'pending' | 'acknowledged' | 'fulfilled' | 'dismissed'

// ── Database row types ──────────────────────────────────────────────────────

export interface Profile {
  id: string
  full_name: string
  phone: string | null
  role: UserRole
  store_id: string | null
  created_at: string
  updated_at: string
}

export interface Store {
  id: string
  store_code: string
  store_name: string
  pic_name: string
  pic_phone: string
  email: string | null
  address: string
  city: string
  state: string
  postcode: string
  store_type: StoreType
  bank_name: string | null
  bank_account_number: string | null
  bank_account_name: string | null
  commission_rate: number
  payment_terms_days: number
  status: StoreStatus
  performance_score: number
  consecutive_low_months: number
  qr_code_ref: string
  payment_qr_url: string | null
  agreement_signed_at: string | null
  agreement_signed_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Product {
  id: string
  sku: string
  name: string
  category: ProductCategory
  color: string
  selling_price: number
  cost_price: number
  is_core_sku: boolean
  is_active: boolean
  barcode: string | null
  description: string | null
  image_url: string | null
  shopify_inventory_qty: number | null
  shopify_inventory_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface StoreInventory {
  id: string
  store_id: string
  product_id: string
  quantity_on_hand: number
  restock_threshold: number
  last_restocked_at: string | null
  created_at: string
  updated_at: string
  // joined
  product?: Product
  store?: Store
}

export interface StockMovement {
  id: string
  store_id: string
  product_id: string
  movement_type: MovementType
  quantity: number
  reference_id: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  // joined
  product?: Product
}

export interface Sale {
  id: string
  store_id: string
  product_id: string
  quantity: number
  unit_price: number
  total_amount: number
  commission_amount: number
  xocks_revenue: number
  payment_method: PaymentMethod
  qr_reference: string | null
  recorded_by: string | null
  sale_date: string
  created_at: string
  sale_group_id?: string | null
  promo_id?: string | null
  promo_discount?: number
  // joined
  product?: Product
  store?: Store
  promo?: Promo
}

export interface StoreTypeRow {
  id: string
  value: string
  label: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Promo {
  id: string
  store_id: string | null      // null = global, applies to all stores
  code: string | null
  name: string
  discount_type: 'percentage' | 'fixed' | 'bxgy'
  discount_value: number | null
  min_quantity: number
  min_amount: number
  // BXGY-specific: buy X, get Y free (Y cheapest pairs)
  buy_quantity: number | null
  free_quantity: number | null
  is_active: boolean
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface RestockAlert {
  id: string
  store_id: string
  product_id: string
  current_quantity: number
  threshold_quantity: number
  status: RestockAlertStatus
  acknowledged_by: string | null
  acknowledged_at: string | null
  created_at: string
  // joined
  product?: Product
  store?: Store
}

export interface RestockRequest {
  id: string
  store_id: string
  status: RestockRequestStatus
  requested_by: string | null
  approved_by: string | null
  approved_at: string | null
  notes: string | null
  admin_notes: string | null
  created_at: string
  updated_at: string
  // joined
  store?: Store
  items?: RestockRequestItem[]
}

export interface RestockRequestItem {
  id: string
  restock_request_id: string
  product_id: string
  quantity_requested: number
  quantity_approved: number | null
  created_at: string
  // joined
  product?: Product
}

export interface DeliveryOrder {
  id: string
  do_number: string
  store_id: string
  restock_request_id: string | null
  do_type: DeliveryOrderType
  status: DeliveryOrderStatus
  dispatch_date: string | null
  delivery_date: string | null
  tracking_number: string | null
  courier: string | null
  total_pairs: number
  pdf_url: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // joined
  store?: Store
  items?: DeliveryOrderItem[]
}

export interface DeliveryOrderItem {
  id: string
  delivery_order_id: string
  product_id: string
  quantity: number
  unit_cost: number
  created_at: string
  // joined
  product?: Product
}

export interface CommissionPeriod {
  id: string
  store_id: string
  period_month: number
  period_year: number
  total_units_sold: number
  total_revenue: number
  commission_amount: number
  xocks_revenue: number
  status: CommissionStatus
  pdf_url: string | null
  approved_by: string | null
  approved_at: string | null
  paid_at: string | null
  payment_reference: string | null
  notes: string | null
  created_at: string
  // joined
  store?: Store
  receipt?: PaymentReceipt | null
}

export interface PaymentReceipt {
  id: string
  commission_period_id: string
  store_id: string
  file_path: string
  file_name: string | null
  mime_type: string | null
  file_size: number | null
  bank_reference: string | null
  transfer_date: string | null
  store_notes: string | null
  status: PaymentReceiptStatus
  admin_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  uploaded_by: string | null
  created_at: string
  updated_at: string
}

export interface Notification {
  id: string
  recipient_role: UserRole | null
  recipient_store_id: string | null
  type: NotificationType
  title: string
  message: string
  reference_id: string | null
  reference_type: string | null
  is_read: boolean
  created_at: string
}

export interface Setting {
  key: string
  value: string
  description: string | null
  updated_at: string
}

// ── API / form types ─────────────────────────────────────────────────────────

export interface RecordSaleInput {
  store_id: string
  product_id: string
  quantity: number
  payment_method: PaymentMethod
  qr_reference?: string
}

export interface CreateRestockRequestInput {
  store_id: string
  items: Array<{ product_id: string; quantity_requested: number }>
  notes?: string
}

export interface CreateDeliveryOrderInput {
  store_id: string
  restock_request_id?: string
  do_type: DeliveryOrderType
  items: Array<{ product_id: string; quantity: number }>
  notes?: string
}

export interface StockAdjustmentInput {
  store_id: string
  product_id: string
  quantity_change: number
  movement_type: 'adjustment_add' | 'adjustment_remove'
  notes?: string
}

// ── Dashboard / analytics types ──────────────────────────────────────────────

export interface DashboardKPIs {
  active_stores: number
  total_sales_mtd: number
  revenue_mtd: number
  commissions_due: number
  low_stock_alerts: number
  pending_restocks: number
  dos_in_transit: number
  at_risk_stores: number
}

export interface SalesTrendPoint {
  date: string
  pairs_sold: number
  revenue: number
}

export interface StorePerformanceRow {
  store_id: string
  store_code: string
  store_name: string
  city: string
  state: string
  pairs_sold: number
  revenue: number
  performance_score: number
  consecutive_low_months: number
}
