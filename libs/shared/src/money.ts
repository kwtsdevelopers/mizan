/**
 * Money arithmetic in integer minor units (e.g. cents, fils).
 *
 * Rules:
 *  - All monetary amounts are integers in the currency's minor unit.
 *  - Quantities are integers in milli-units (1 unit = 1000) so weighed goods
 *    (e.g. 1.250 kg) stay in integer arithmetic.
 *  - Tax rates are expressed in basis points (bps). 10% = 1000 bps.
 *  - Rounding: round-half-up on the final value of each derived amount.
 */

export const QTY_SCALE = 1000;
export const BPS_SCALE = 10_000;

export function assertSafeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, got ${value}`);
  }
}

/** Round-half-up division of two non-negative integers scaled by bigint math. */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  const neg = numerator < 0n;
  const n = neg ? -numerator : numerator;
  const q = (n * 2n + denominator) / (denominator * 2n);
  return neg ? -q : q;
}

/** qtyMilli * unitPriceMinor / 1000, rounded half-up. */
export function lineGross(qtyMilli: number, unitPriceMinor: number): number {
  assertSafeInt(qtyMilli, 'qtyMilli');
  assertSafeInt(unitPriceMinor, 'unitPriceMinor');
  return Number(divRoundHalfUp(BigInt(qtyMilli) * BigInt(unitPriceMinor), BigInt(QTY_SCALE)));
}

/** Tax on a net amount at taxRateBps, rounded half-up. */
export function taxOn(netMinor: number, taxRateBps: number): number {
  assertSafeInt(netMinor, 'netMinor');
  assertSafeInt(taxRateBps, 'taxRateBps');
  if (taxRateBps < 0) throw new RangeError('taxRateBps must be >= 0');
  return Number(divRoundHalfUp(BigInt(netMinor) * BigInt(taxRateBps), BigInt(BPS_SCALE)));
}

export interface LineTotalsInput {
  /** quantity in milli-units (1 piece = 1000, 1.250 kg = 1250) */
  qtyMilli: number;
  /** unit price in minor units per whole unit */
  unitPriceMinor: number;
  /** absolute discount on the line, in minor units (>= 0) */
  discountMinor: number;
  /** tax rate in basis points, applied on (gross - discount). Tax-exclusive model. */
  taxRateBps: number;
}

export interface LineTotals {
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export function computeLineTotals(input: LineTotalsInput): LineTotals {
  const { qtyMilli, unitPriceMinor, discountMinor, taxRateBps } = input;
  if (qtyMilli <= 0) throw new RangeError('qtyMilli must be > 0');
  if (unitPriceMinor < 0) throw new RangeError('unitPriceMinor must be >= 0');
  if (discountMinor < 0) throw new RangeError('discountMinor must be >= 0');
  const grossMinor = lineGross(qtyMilli, unitPriceMinor);
  if (discountMinor > grossMinor) {
    throw new RangeError('discountMinor cannot exceed line gross');
  }
  const netMinor = grossMinor - discountMinor;
  const taxMinor = taxOn(netMinor, taxRateBps);
  return { grossMinor, discountMinor, netMinor, taxMinor, totalMinor: netMinor + taxMinor };
}

export interface SaleTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export function computeSaleTotals(lines: LineTotals[]): SaleTotals {
  return lines.reduce<SaleTotals>(
    (acc, l) => ({
      subtotalMinor: acc.subtotalMinor + l.grossMinor,
      discountMinor: acc.discountMinor + l.discountMinor,
      taxMinor: acc.taxMinor + l.taxMinor,
      totalMinor: acc.totalMinor + l.totalMinor,
    }),
    { subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 },
  );
}

/** Format minor units for display. Pure helper; UI should prefer Intl. */
export function formatMinor(amountMinor: number, currency: string, minorDigits = 2): string {
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(amountMinor);
  const major = Math.floor(abs / 10 ** minorDigits);
  const minor = String(abs % 10 ** minorDigits).padStart(minorDigits, '0');
  return `${sign}${major}.${minor} ${currency}`;
}
