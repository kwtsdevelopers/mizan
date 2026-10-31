import {
  computeLineTotals,
  computeSaleTotals,
  divRoundHalfUp,
  formatMinor,
  lineGross,
  taxOn,
} from './money';

describe('divRoundHalfUp', () => {
  it('rounds .5 up', () => {
    expect(divRoundHalfUp(5n, 10n)).toBe(1n);
    expect(divRoundHalfUp(4n, 10n)).toBe(0n);
    expect(divRoundHalfUp(15n, 10n)).toBe(2n);
  });
  it('handles negatives symmetrically', () => {
    expect(divRoundHalfUp(-5n, 10n)).toBe(-1n);
    expect(divRoundHalfUp(-4n, 10n)).toBe(0n);
  });
  it('rejects non-positive denominator', () => {
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(RangeError);
  });
});

describe('lineGross', () => {
  it('computes whole quantities', () => {
    // 3 pieces x 2.50 = 7.50
    expect(lineGross(3000, 250)).toBe(750);
  });
  it('computes weighed quantities with rounding', () => {
    // 1.255 kg x 3.99/kg = 5.00745 -> 5.01
    expect(lineGross(1255, 399)).toBe(501);
    // 0.333 kg x 1.00 = 0.333 -> 0.33
    expect(lineGross(333, 100)).toBe(33);
  });
  it('rejects unsafe integers', () => {
    expect(() => lineGross(0.5, 100)).toThrow(RangeError);
  });
});

describe('taxOn', () => {
  it('computes 10% (1000 bps)', () => {
    expect(taxOn(1000, 1000)).toBe(100);
  });
  it('rounds half up', () => {
    // 0.05 of 105 = 5.25 -> 5 ; 0.15 of 105 = 15.75 -> 16
    expect(taxOn(105, 500)).toBe(5);
    expect(taxOn(105, 1500)).toBe(16);
  });
  it('zero rate yields zero', () => {
    expect(taxOn(99999, 0)).toBe(0);
  });
});

describe('computeLineTotals', () => {
  it('computes a simple taxed line', () => {
    const t = computeLineTotals({
      qtyMilli: 2000,
      unitPriceMinor: 199,
      discountMinor: 0,
      taxRateBps: 500,
    });
    expect(t).toEqual({
      grossMinor: 398,
      discountMinor: 0,
      netMinor: 398,
      taxMinor: 20,
      totalMinor: 418,
    });
  });
  it('applies discount before tax', () => {
    const t = computeLineTotals({
      qtyMilli: 1000,
      unitPriceMinor: 1000,
      discountMinor: 100,
      taxRateBps: 1000,
    });
    expect(t.netMinor).toBe(900);
    expect(t.taxMinor).toBe(90);
    expect(t.totalMinor).toBe(990);
  });
  it('rejects discount larger than gross', () => {
    expect(() =>
      computeLineTotals({ qtyMilli: 1000, unitPriceMinor: 100, discountMinor: 101, taxRateBps: 0 }),
    ).toThrow(RangeError);
  });
  it('rejects non-positive quantity', () => {
    expect(() =>
      computeLineTotals({ qtyMilli: 0, unitPriceMinor: 100, discountMinor: 0, taxRateBps: 0 }),
    ).toThrow(RangeError);
  });
});

describe('computeSaleTotals', () => {
  it('sums lines', () => {
    const l1 = computeLineTotals({ qtyMilli: 1000, unitPriceMinor: 500, discountMinor: 50, taxRateBps: 1000 });
    const l2 = computeLineTotals({ qtyMilli: 2500, unitPriceMinor: 120, discountMinor: 0, taxRateBps: 0 });
    const s = computeSaleTotals([l1, l2]);
    expect(s.subtotalMinor).toBe(l1.grossMinor + l2.grossMinor);
    expect(s.totalMinor).toBe(l1.totalMinor + l2.totalMinor);
  });
});

describe('formatMinor', () => {
  it('formats positive and negative values', () => {
    expect(formatMinor(123456, 'USD')).toBe('1234.56 USD');
    expect(formatMinor(-5, 'USD')).toBe('-0.05 USD');
  });
});
