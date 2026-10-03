/** RFC 4648 §5 base64url without padding — the binary encoding of every encrypted field. */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const BASE64URL = /^[A-Za-z0-9_-]*$/

/** Strict decode: returns null for anything that is not canonical unpadded base64url. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (typeof text !== 'string' || !BASE64URL.test(text) || text.length % 4 === 1) return null
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    return null
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  // Reject non-canonical encodings (unused trailing bits set).
  return toBase64Url(bytes) === text ? bytes : null
}
