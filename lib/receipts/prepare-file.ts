// Browser-side checks and shrinking for a payment receipt before it is uploaded
// to POST /api/payments/receipts. The server still enforces the same limits
// (4 MB, JPG/PNG/WEBP/HEIC/PDF). Only images are resized; a PDF over the limit
// is refused with a message, never silently changed.

export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024

/** What the file picker offers: camera/photos/files on phones, files on desktop. */
export const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf'

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'])
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

export const RECEIPT_TYPE_ERROR = 'File type not allowed — use JPG, PNG, WEBP, HEIC, or PDF'

function extOf(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase()
}

/** 'image' | 'pdf' | null. The extension wins, as on the server (HEIC often has no MIME type). */
export function receiptKind(file: Pick<File, 'name' | 'type'>): 'image' | 'pdf' | null {
  const ext = extOf(file.name)
  if (ext === 'pdf' || file.type === 'application/pdf') return 'pdf'
  if (IMAGE_EXT.has(ext) || IMAGE_TYPES.has(file.type)) return 'image'
  return null
}

/**
 * Returns a file ready to upload: the original when it is within the limit,
 * or a resized JPEG for an oversized photo. Throws an Error whose message can
 * be shown to the store as is.
 */
export async function prepareReceiptFile(file: File): Promise<File> {
  const kind = receiptKind(file)
  if (!kind) throw new Error(RECEIPT_TYPE_ERROR)
  if (file.size <= RECEIPT_MAX_BYTES) return file
  if (kind === 'pdf') {
    throw new Error('This PDF is over 4 MB. Please export a smaller PDF, or send a photo instead.')
  }
  return shrinkImage(file)
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    // The decoded image stays usable after the object URL is revoked.
    URL.revokeObjectURL(url)
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality))
}

/**
 * Resize and re-encode as JPEG until the result is under the limit. Browsers
 * that cannot decode a HEIC photo (not Safari) get a clear message instead.
 */
async function shrinkImage(file: File): Promise<File> {
  const tooBig = 'This photo is over 4 MB and could not be made smaller on this device. Please send a smaller photo or a PDF under 4 MB.'

  let img: HTMLImageElement
  try {
    img = await loadImage(file)
  } catch {
    throw new Error(tooBig)
  }

  const longest = Math.max(img.naturalWidth, img.naturalHeight)
  if (!longest) throw new Error(tooBig)

  for (const maxSide of [2400, 1800, 1400]) {
    const scale = Math.min(1, maxSide / longest)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(tooBig)
    // White behind the photo: transparent PNG areas would otherwise turn black in JPEG.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    for (const quality of [0.85, 0.75, 0.6]) {
      const blob = await toBlob(canvas, quality)
      if (blob && blob.size <= RECEIPT_MAX_BYTES) {
        const base = file.name.replace(/\.[^.]+$/, '') || 'receipt'
        return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
      }
    }
  }
  throw new Error(tooBig)
}
