import { describe, expect, it } from 'vitest';
import { applyNotInterested, computeDifficultyOffset } from './feedback';

describe('computeDifficultyOffset (offsetK = 3)', () => {
  const cases: Array<[number, number, -1 | 0 | 1]> = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 1],
    [3, 0, 1],
    [9, 0, 1],
    [0, 1, 0],
    [0, 2, -1],
    [0, 9, -1],
    [5, 5, 0],
    [4, 2, 1],
    [2, 4, -1],
    [3, 2, 0],
    [2, 3, 0],
  ];
  it.each(cases)('(%i, %i) -> %i', (easy, hard, expected) => {
    expect(computeDifficultyOffset(easy, hard, 3)).toBe(expected);
  });
});

describe('computeDifficultyOffset other offsetK', () => {
  it('offsetK = 1', () => {
    expect(computeDifficultyOffset(1, 0, 1)).toBe(1);
    expect(computeDifficultyOffset(0, 1, 1)).toBe(-1);
    expect(computeDifficultyOffset(1, 1, 1)).toBe(0);
  });
  it('offsetK = 2 rounds half away from zero, symmetric', () => {
    expect(computeDifficultyOffset(1, 0, 2)).toBe(1);
    expect(computeDifficultyOffset(0, 1, 2)).toBe(-1);
  });
  it('offsetK = 4', () => {
    expect(computeDifficultyOffset(2, 0, 4)).toBe(1);
    expect(computeDifficultyOffset(0, 2, 4)).toBe(-1);
    expect(computeDifficultyOffset(1, 0, 4)).toBe(0);
  });
});

describe('computeDifficultyOffset sign', () => {
  it('never returns -0', () => {
    expect(Object.is(computeDifficultyOffset(0, 1, 3), 0)).toBe(true);
  });
});

describe('computeDifficultyOffset errors', () => {
  it.each([
    [-1, 0, 3],
    [1.5, 0, 3],
    [0, 0, 0],
    [0, 0, 2.5],
    [0, -1, 3],
    [0, 0.5, 3],
    [Number.NaN, 0, 3],
    [0, Number.NaN, 3],
    [0, 0, Number.NaN],
  ])('(%s, %s, %s) throws RangeError', (easy, hard, k) => {
    expect(() => computeDifficultyOffset(easy, hard, k)).toThrow(RangeError);
  });
});

describe('applyNotInterested', () => {
  it('multiplies by decay', () => {
    expect(applyNotInterested(1, 0.8, 0.2)).toBeCloseTo(0.8, 10);
  });

  it('applies repeatedly down to the floor, then stays there', () => {
    let interest = 1;
    const seen: number[] = [];
    for (let i = 0; i < 9; i++) {
      interest = applyNotInterested(interest, 0.8, 0.2);
      seen.push(interest);
    }
    const expected = [0.8, 0.64, 0.512, 0.4096, 0.32768, 0.262144, 0.2097152, 0.2, 0.2];
    expect(seen).toHaveLength(expected.length);
    seen.forEach((v, i) => expect(v).toBeCloseTo(expected[i] as number, 10));
  });

  it('interest already below the floor returns min (floor wins)', () => {
    expect(applyNotInterested(0.1, 0.8, 0.2)).toBe(0.2);
  });

  it('decay = 1 returns the interest unchanged when it is >= min', () => {
    expect(applyNotInterested(0.5, 1, 0.2)).toBe(0.5);
  });

  it('min = 1 returns 1', () => {
    expect(applyNotInterested(0.5, 0.8, 1)).toBe(1);
  });

  it.each([
    [0, 0.8, 0.2],
    [1, 0, 0.2],
    [1, 1.2, 0.2],
    [1, 0.8, 0],
    [1, 0.8, 1.5],
    [-0.5, 0.8, 0.2],
    [1, -0.8, 0.2],
    [1, 0.8, -0.2],
    [Number.NaN, 0.8, 0.2],
    [1, Number.NaN, 0.2],
    [1, 0.8, Number.NaN],
  ])('(%s, %s, %s) throws RangeError', (interest, decay, min) => {
    expect(() => applyNotInterested(interest, decay, min)).toThrow(RangeError);
  });
});
