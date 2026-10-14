function assertCount(n: number, name: string): void {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`${name} must be a non-negative integer, got ${n}`);
}

export function computeDifficultyOffset(tooEasy: number, tooHard: number, offsetK: number): -1 | 0 | 1 {
  assertCount(tooEasy, 'tooEasy');
  assertCount(tooHard, 'tooHard');
  if (!Number.isInteger(offsetK) || offsetK < 1) throw new RangeError(`offsetK must be a positive integer, got ${offsetK}`);
  const raw = (tooEasy - tooHard) / offsetK;
  const rounded = Math.sign(raw) * Math.round(Math.abs(raw)); // half away from zero
  if (rounded >= 1) return 1;
  if (rounded <= -1) return -1;
  return 0;
}

export function applyNotInterested(interest: number, decay: number, min: number): number {
  if (!(interest > 0)) throw new RangeError(`interest must be > 0, got ${interest}`);
  if (!(decay > 0 && decay <= 1)) throw new RangeError(`decay must be in (0, 1], got ${decay}`);
  if (!(min > 0 && min <= 1)) throw new RangeError(`min must be in (0, 1], got ${min}`);
  return Math.max(min, interest * decay);
}
