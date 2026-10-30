// Shipment details on a store (stores.shipment_*). Printed on delivery orders
// and packing slips only when something is filled, so existing stores print
// exactly as before.

export interface ShipmentDetails {
  address?: string | null
  contact?: string | null
  pic?: string | null
}

/**
 * The printed lines for the shipment block, or [] when nothing is filled.
 * Address lines keep their line breaks; PIC and contact follow.
 */
export function shipmentLines(shipment?: ShipmentDetails | null): string[] {
  if (!shipment) return []
  const addressLines = (shipment.address ?? '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const pic = shipment.pic?.trim()
  const contact = shipment.contact?.trim()
  const lines = [...addressLines]
  if (pic) lines.push(`Attn: ${pic}`)
  if (contact) lines.push(`Contact: ${contact}`)
  return lines
}
