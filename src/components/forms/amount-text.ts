/**
 * Keep only digits and one decimal point with at most two decimals.
 * Commas are dropped while typing and re-added on blur.
 */
export function sanitizeAmountText(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = cleaned.split('.')
  return rest.length > 0 ? `${whole}.${rest.join('').slice(0, 2)}` : whole
}
