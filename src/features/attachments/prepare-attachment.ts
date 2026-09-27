/**
 * Turn a picked file into something worth storing locally:
 * - only images and PDFs, at most 20 MB each;
 * - large photos are downscaled to 2000 px and re-encoded as JPEG to save
 *   device storage (receipts stay readable). If the browser can't do this,
 *   the original file is kept.
 */
import type { NewAttachment } from '@/db/repositories'

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_ATTACHMENTS = 10
const MAX_DIMENSION = 2000
const COMPRESS_OVER_BYTES = 1024 * 1024
const JPEG_QUALITY = 0.82

export type AttachmentProblem = 'type' | 'tooLarge' | 'read'

export class AttachmentFileError extends Error {
  readonly problem: AttachmentProblem
  readonly fileName: string
  constructor(problem: AttachmentProblem, fileName: string) {
    super(`${problem}: ${fileName}`)
    this.name = 'AttachmentFileError'
    this.problem = problem
    this.fileName = fileName
  }
}

export function isSupportedAttachment(file: Pick<File, 'type'>): boolean {
  return file.type.startsWith('image/') || file.type === 'application/pdf'
}

const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

async function compressImage(file: File): Promise<NewAttachment | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.size >= file.size) return { blob: file, fileName: file.name, mimeType: file.type, width: bitmap.width, height: bitmap.height }
    return { blob, fileName: file.name.replace(/\.[^.]+$/, '') + '.jpg', mimeType: 'image/jpeg', width, height }
  } finally {
    bitmap.close()
  }
}

export async function prepareAttachment(file: File): Promise<NewAttachment> {
  if (!isSupportedAttachment(file)) throw new AttachmentFileError('type', file.name)
  if (file.size > MAX_ATTACHMENT_BYTES) throw new AttachmentFileError('tooLarge', file.name)
  if (file.size === 0) throw new AttachmentFileError('read', file.name)

  if (COMPRESSIBLE.has(file.type) && file.size > COMPRESS_OVER_BYTES) {
    try {
      const compressed = await compressImage(file)
      if (compressed) return compressed
    } catch {
      // Fall through: keep the original rather than lose the receipt.
    }
  }
  return { blob: file, fileName: file.name, mimeType: file.type }
}
