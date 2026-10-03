/**
 * Deterministic ids (RFC 4122 UUID version 5: SHA-1 of namespace + name).
 * The same name always gives the same id — on every device — so records with
 * a natural identity (a recurring occurrence = source + due date) are created
 * once, never twice, when two devices later sync.
 *
 * Synchronous on purpose: ids are generated inside Dexie transactions, where
 * awaiting WebCrypto's async digest would end the IndexedDB transaction.
 */

/** This app's UUID namespace (a fixed random UUID; never change it — ids depend on it). */
export const APP_ID_NAMESPACE = '8f2c6e0a-5b1d-4c3e-9a7f-2d4b6c8e0f13'

function sha1(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8
  const withPadding = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
  withPadding.set(bytes)
  withPadding[bytes.length] = 0x80
  const view = new DataView(withPadding.buffer)
  view.setUint32(withPadding.length - 8, Math.floor(bitLength / 0x1_0000_0000))
  view.setUint32(withPadding.length - 4, bitLength >>> 0)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n))
  for (let offset = 0; offset < withPadding.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1)
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4]
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : i < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : i < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6]
      const temp = (rotl(a, 5) + f + e + k + w[i]!) >>> 0
      e = d
      d = c
      c = rotl(b, 30) >>> 0
      b = a
      a = temp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  const out = new Uint8Array(20)
  const outView = new DataView(out.buffer)
  ;[h0, h1, h2, h3, h4].forEach((h, i) => outView.setUint32(i * 4, h))
  return out
}

/** Hex SHA-1 (exposed for tests against known vectors). */
export const sha1Hex = (text: string) => [...sha1(new TextEncoder().encode(text))].map((b) => b.toString(16).padStart(2, '0')).join('')

const uuidBytes = (uuid: string) => {
  const hex = uuid.replace(/-/g, '')
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('invalid namespace uuid')
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16))
}

/** RFC 4122 UUID v5 of `name` in `namespace`. */
export function uuidV5(name: string, namespace: string = APP_ID_NAMESPACE): string {
  const nameBytes = new TextEncoder().encode(name)
  const input = new Uint8Array(16 + nameBytes.length)
  input.set(uuidBytes(namespace))
  input.set(nameBytes, 16)
  const hash = sha1(input).slice(0, 16)
  hash[6] = (hash[6]! & 0x0f) | 0x50 // version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80 // RFC 4122 variant
  const hex = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
