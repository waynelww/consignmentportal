/**
 * QR content generators for Xocks store identity and sale payment QR codes.
 */

/**
 * Returns the static QR content for a store identity badge.
 * This QR is printed/displayed in the store and identifies the consignment partner.
 */
export function generateStoreQRContent(storeCode: string, qrCodeRef: string): string {
  return `XOCKS-STORE:${storeCode}:${qrCodeRef}`
}

/**
 * Returns the QR value for a point-of-sale payment QR code.
 *
 * TODO: Replace QR content with actual DuitNow merchant dynamic QR API call
 * when bank merchant credentials are available.
 * Bank API docs: [to be added by admin]
 *
 * Current implementation encodes a base64 JSON payload pointing at the Xocks
 * payment gateway endpoint. Once DuitNow credentials are available, this
 * function should call the bank's dynamic QR API and return the resulting
 * QR string/image directly.
 */
export function generateSaleQRValue(params: {
  storeCode: string
  qrCodeRef: string
  productSku: string
  quantity: number
  totalAmount: number
  uniqueRef: string
}): string {
  // TODO: Replace QR content with actual DuitNow merchant dynamic QR API call
  // when bank merchant credentials are available.
  // Bank API docs: [to be added by admin]
  const payload = {
    store: params.storeCode,
    ref: params.qrCodeRef,
    sku: params.productSku,
    qty: params.quantity,
    amount: params.totalAmount,
    txn: params.uniqueRef,
    ts: Date.now(),
  }
  return `https://pay.xocks.co/?d=${btoa(JSON.stringify(payload))}`
}
