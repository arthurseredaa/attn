/** A circle centred on (x, y) that just covers a w x h box: the radius reaches its farthest corner. */
export function floodCircle(x: number, y: number, w: number, h: number): { left: number; top: number; size: number } {
  const dx = Math.max(x, w - x);
  const dy = Math.max(y, h - y);
  const r = Math.ceil(Math.hypot(dx, dy)) + 1;
  return { left: x - r, top: y - r, size: r * 2 };
}
