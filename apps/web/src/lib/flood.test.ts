import { describe, expect, it } from 'vitest';
import { floodCircle } from './flood';

describe('floodCircle', () => {
  it('reaches the farthest corner from the entry point', () => {
    // From the top-left corner the farthest corner is the bottom-right one: hypot(300, 400) = 500.
    expect(floodCircle(0, 0, 300, 400)).toEqual({ left: -501, top: -501, size: 1002 });
  });
  it('is centred on the point', () => {
    const c = floodCircle(120, 30, 200, 100);
    expect(c.left + c.size / 2).toBe(120);
    expect(c.top + c.size / 2).toBe(30);
  });
  it('covers every corner from any point', () => {
    const [w, h] = [240, 90];
    for (const [x, y] of [[0, 0], [w, h], [w / 2, h / 2], [w, 0], [17, 63]] as const) {
      const { left, top, size } = floodCircle(x, y, w, h);
      const r = size / 2;
      for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
        expect(Math.hypot(cx - (left + r), cy - (top + r))).toBeLessThanOrEqual(r);
      }
    }
  });
});
