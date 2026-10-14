import { describe, expect, it } from 'vitest';
import { effectiveLevel, effectiveUncertain } from './scale';

describe('scale', () => {
  it('treats null as level 1', () => {
    expect(effectiveLevel(null)).toBe(1);
    expect(effectiveLevel(0)).toBe(0);
    expect(effectiveLevel(4)).toBe(4);
  });
  it('treats null as uncertain', () => {
    expect(effectiveUncertain(null, false)).toBe(true);
    expect(effectiveUncertain(2, false)).toBe(false);
    expect(effectiveUncertain(2, true)).toBe(true);
  });
});
