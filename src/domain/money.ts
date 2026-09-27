/**
 * Money utilities.
 *
 * All monetary values are stored and calculated as integer **satang**
 * (1 THB = 100 satang). Floating-point numbers are never used for money:
 * - parsing works on the decimal string directly,
 * - ratio/percentage maths runs on BigInt with explicit rounding,
 * - formatting passes an exact decimal string to Intl.NumberFormat.
 *
 * Values must stay within Number.MAX_SAFE_INTEGER satang
 * (~90 trillion baht), which every function asserts.
 */

declare const satangBrand: unique symbol

/** An integer amount of satang. Construct with {@link satang}, {@link fromBaht} or {@link parseBaht}. */
export type Satang = number & { readonly [satangBrand]: true }

export const SATANG_PER_BAHT = 100
export const CURRENCY = 'THB' as const
export type CurrencyCode = typeof CURRENCY

export const ZERO = 0 as Satang

export class MoneyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyError'
  }
}

function assertSafeInteger(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer number of satang, got ${String(value)}`)
  }
}

function fromBigInt(value: bigint): Satang {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError('Result is outside the safe integer range')
  }
  // Normalise -0 to 0.
  return (Number(value) || 0) as Satang
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** Brand an existing integer satang value. Throws for non-integers. */
export function satang(value: number): Satang {
  assertSafeInteger(value)
  return (value || 0) as Satang
}

/** Whole baht → satang. Only integers are accepted; use {@link parseBaht} for decimals. */
export function fromBaht(baht: number): Satang {
  assertSafeInteger(baht, 'baht')
  return satang(baht * SATANG_PER_BAHT)
}

export function isSatang(value: unknown): value is Satang {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

const DECIMAL_PATTERN = /^([+-])?(\d+)(?:\.(\d{0,2}))?$/

/**
 * Parse a user-entered baht string into satang, without floating point.
 *
 * Accepts: "1234", "1,234.5", "-12.34", "+5", "฿1,000.00", " 1 234.00 ", ".5".
 * Rejects: more than 2 decimal places, exponent notation, empty input, garbage.
 */
export function parseBaht(input: string): Satang {
  const cleaned = input
    .trim()
    .replace(/^฿|฿$/g, '')
    .replace(/(?:THB|บาท)$/i, '')
    .replace(/[,\s]/g, '')
    .replace(/^([+-]?)\./, (_, sign: string) => `${sign}0.`)
  const match = DECIMAL_PATTERN.exec(cleaned)
  if (!match) {
    throw new MoneyError(`Invalid amount: "${input}"`)
  }
  const [, sign, whole = '0', fraction = ''] = match
  const digits = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0')
  return fromBigInt(sign === '-' ? -digits : digits)
}

/** Like {@link parseBaht} but returns null instead of throwing. */
export function tryParseBaht(input: string): Satang | null {
  try {
    return parseBaht(input)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

export function add(a: Satang, b: Satang): Satang {
  return satang(a + b)
}

export function subtract(a: Satang, b: Satang): Satang {
  return satang(a - b)
}

export function sum(values: Iterable<Satang>): Satang {
  let total = 0
  for (const value of values) {
    total += value
    assertSafeInteger(total, 'sum')
  }
  return satang(total)
}

export function negate(a: Satang): Satang {
  return satang(-a)
}

export function abs(a: Satang): Satang {
  return satang(Math.abs(a))
}

/** Multiply by an integer quantity (e.g. 3 × unit price). */
export function multiply(a: Satang, quantity: number): Satang {
  assertSafeInteger(quantity, 'quantity')
  return fromBigInt(BigInt(a) * BigInt(quantity))
}

export type RoundingMode =
  /** Round half away from zero (common commercial rounding). */
  | 'half-up'
  /** Banker's rounding: half to even. */
  | 'half-even'
  /** Toward negative infinity. */
  | 'floor'
  /** Toward positive infinity. */
  | 'ceil'
  /** Toward zero. */
  | 'truncate'

/** Integer division of BigInts with an explicit rounding mode. */
function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) throw new MoneyError('Division by zero')
  if (denominator < 0n) {
    numerator = -numerator
    denominator = -denominator
  }
  const quotient = numerator / denominator // truncates toward zero
  const remainder = numerator % denominator
  if (remainder === 0n) return quotient

  const negative = numerator < 0n
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n
  const awayFromZero = negative ? quotient - 1n : quotient + 1n

  switch (mode) {
    case 'truncate':
      return quotient
    case 'floor':
      return negative ? quotient - 1n : quotient
    case 'ceil':
      return negative ? quotient : quotient + 1n
    case 'half-up':
      return twiceRemainder >= denominator ? awayFromZero : quotient
    case 'half-even':
      if (twiceRemainder > denominator) return awayFromZero
      if (twiceRemainder < denominator) return quotient
      return quotient % 2n === 0n ? quotient : awayFromZero
  }
}

/** a × numerator ÷ denominator, rounded to whole satang. All inputs must be integers. */
export function multiplyRatio(
  a: Satang,
  numerator: number,
  denominator: number,
  mode: RoundingMode = 'half-up',
): Satang {
  assertSafeInteger(numerator, 'numerator')
  assertSafeInteger(denominator, 'denominator')
  return fromBigInt(divideRounded(BigInt(a) * BigInt(numerator), BigInt(denominator), mode))
}

/** Basis points: 1% = 100 bps, 18.5% = 1850 bps. Rates are stored as integer bps, never floats. */
export type BasisPoints = number

export const BPS_PER_PERCENT = 100
export const BPS_PER_WHOLE = 10_000

/** Percentage of an amount, e.g. `percentOf(amount, 700)` = 7% VAT. */
export function percentOf(a: Satang, bps: BasisPoints, mode: RoundingMode = 'half-up'): Satang {
  return multiplyRatio(a, bps, BPS_PER_WHOLE, mode)
}

/**
 * Share of `part` in `whole` as integer basis points (half-up), e.g.
 * ratioBps(3250, 8420) → 3860 (38.60%). Returns 0 when whole is 0.
 */
export function ratioBps(part: Satang, whole: Satang, mode: RoundingMode = 'half-up'): BasisPoints {
  if (whole === 0) return 0
  return Number(divideRounded(BigInt(part) * BigInt(BPS_PER_WHOLE), BigInt(whole), mode))
}

/**
 * Split an amount into parts proportional to integer weights so that the
 * parts always add back up to exactly the original amount (largest remainder).
 * `allocate(satang(1000), [1, 1, 1])` → [334, 333, 333].
 */
export function allocate(total: Satang, weights: readonly number[]): Satang[] {
  if (weights.length === 0) throw new MoneyError('allocate() needs at least one weight')
  weights.forEach((w) => {
    assertSafeInteger(w, 'weight')
    if (w < 0) throw new MoneyError('Weights must be non-negative')
  })
  const weightSum = weights.reduce((acc, w) => acc + BigInt(w), 0n)
  if (weightSum === 0n) throw new MoneyError('Weights must not all be zero')

  const totalBig = BigInt(total)
  const sign = totalBig < 0n ? -1n : 1n
  const magnitude = totalBig * sign

  const shares = weights.map((w, index) => {
    const exact = magnitude * BigInt(w)
    return { index, base: exact / weightSum, remainder: exact % weightSum }
  })
  let leftover = magnitude - shares.reduce((acc, s) => acc + s.base, 0n)
  const byRemainder = [...shares].sort((x, y) =>
    y.remainder === x.remainder ? x.index - y.index : y.remainder > x.remainder ? 1 : -1,
  )
  for (const share of byRemainder) {
    if (leftover === 0n) break
    share.base += 1n
    leftover -= 1n
  }
  return shares.map((s) => fromBigInt(s.base * sign))
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export function compare(a: Satang, b: Satang): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0
}

export const isZero = (a: Satang): boolean => a === 0
export const isPositive = (a: Satang): boolean => a > 0
export const isNegative = (a: Satang): boolean => a < 0

export function min(first: Satang, ...rest: Satang[]): Satang {
  return rest.reduce((m, v) => (v < m ? v : m), first)
}

export function max(first: Satang, ...rest: Satang[]): Satang {
  return rest.reduce((m, v) => (v > m ? v : m), first)
}

// ---------------------------------------------------------------------------
// Conversion & formatting
// ---------------------------------------------------------------------------

/** Exact decimal string in baht, e.g. 123456 → "1234.56", -5 → "-0.05". Suitable for inputs and CSV. */
export function toDecimalString(a: Satang): string {
  assertSafeInteger(a)
  const negative = a < 0
  const digits = String(Math.abs(a)).padStart(3, '0')
  const whole = digits.slice(0, -2)
  const fraction = digits.slice(-2)
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

export interface FormatMoneyOptions {
  /** BCP-47 locale. Defaults to Thai. */
  locale?: string
  /** Show currency symbol (฿). Default true. */
  symbol?: boolean
  /** Always show +/− sign. Default false. */
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never'
  /** Hide ".00" for whole-baht amounts. Default false. */
  trimZeroFraction?: boolean
}

const formatterCache = new Map<string, Intl.NumberFormat>()

function getFormatter(options: Required<FormatMoneyOptions>, fractionDigits: number): Intl.NumberFormat {
  const key = `${options.locale}|${options.symbol}|${options.signDisplay}|${fractionDigits}`
  let formatter = formatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(options.locale, {
      ...(options.symbol ? { style: 'currency', currency: CURRENCY } : { style: 'decimal' }),
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: 2,
      signDisplay: options.signDisplay,
    })
    formatterCache.set(key, formatter)
  }
  return formatter
}

/**
 * Locale-aware display string, e.g. 123456 → "฿1,234.56".
 * The exact decimal string is handed to Intl, so no float conversion occurs.
 */
export function formatMoney(a: Satang, options: FormatMoneyOptions = {}): string {
  const resolved: Required<FormatMoneyOptions> = {
    locale: options.locale ?? 'th-TH',
    symbol: options.symbol ?? true,
    signDisplay: options.signDisplay ?? 'auto',
    trimZeroFraction: options.trimZeroFraction ?? false,
  }
  const fractionDigits = resolved.trimZeroFraction && a % SATANG_PER_BAHT === 0 ? 0 : 2
  // Intl.NumberFormat accepts exact decimal strings (ES2023); the cast is only for older lib typings.
  return getFormatter(resolved, fractionDigits).format(toDecimalString(a) as unknown as number)
}
