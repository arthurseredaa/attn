import { describe, expect, it } from 'vitest';
import { applyReadPoint, progressToNext } from './points';

const ppl = 5;

describe('applyReadPoint', () => {
  it('awards when difficulty >= level', () => {
    expect(applyReadPoint({ level: 2, points: 0 }, 2, ppl)).toEqual({
      level: 2,
      points: 1,
      awarded: true,
      leveledUp: false,
    });
    expect(applyReadPoint({ level: 2, points: 0 }, 3, ppl).points).toBe(1);
    expect(applyReadPoint({ level: 2, points: 0 }, 1, ppl)).toEqual({
      level: 2,
      points: 0,
      awarded: false,
      leveledUp: false,
    });
  });
  it('levels up at points_per_level', () => {
    expect(applyReadPoint({ level: 2, points: 4 }, 2, ppl)).toEqual({
      level: 3,
      points: 0,
      awarded: true,
      leveledUp: true,
    });
    expect(applyReadPoint({ level: 3, points: 4 }, 4, ppl)).toMatchObject({ level: 4, points: 0 });
  });
  it('caps at level 4', () => {
    expect(applyReadPoint({ level: 4, points: 0 }, 4, ppl)).toEqual({
      level: 4,
      points: 0,
      awarded: false,
      leveledUp: false,
    });
  });
  it('null level behaves as 1 and stays null until level up', () => {
    expect(applyReadPoint({ level: null, points: 0 }, 0, ppl).awarded).toBe(false);
    expect(applyReadPoint({ level: null, points: 0 }, 1, ppl)).toMatchObject({ level: null, points: 1, awarded: true });
    expect(applyReadPoint({ level: null, points: 4 }, 1, ppl)).toEqual({
      level: 2,
      points: 0,
      awarded: true,
      leveledUp: true,
    });
  });
  it('points_per_level 1 levels up every qualifying read', () => {
    expect(applyReadPoint({ level: 1, points: 0 }, 1, 1)).toMatchObject({ level: 2, leveledUp: true });
    expect(applyReadPoint({ level: 0, points: 0 }, 0, 1)).toMatchObject({ level: 1, awarded: true });
  });
  it('is pure and tolerates stored points >= ppl', () => {
    const s = { level: 2, points: 4 };
    applyReadPoint(s, 2, ppl);
    expect(s).toEqual({ level: 2, points: 4 });
    expect(applyReadPoint({ level: 2, points: 7 }, 2, ppl)).toMatchObject({ level: 3, points: 0, leveledUp: true });
  });
});

describe('progressToNext', () => {
  it('reports progress and null at the cap', () => {
    expect(progressToNext(2, 3, 5)).toEqual({ points: 3, needed: 5 });
    expect(progressToNext(null, 0, 5)).toEqual({ points: 0, needed: 5 });
    expect(progressToNext(4, 0, 5)).toBeNull();
  });
});
