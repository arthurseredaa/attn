import { describe, expect, it } from 'vitest';
import { InvalidCursorError, decodeCursor, encodeCursor } from './cursor';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('cursor', () => {
  it('round-trips publishedAt to the millisecond and id, url-safe', () => {
    const c = { publishedAt: new Date('2026-03-02T12:34:56.789Z'), id: 42 };
    const s = encodeCursor(c);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    const d = decodeCursor(s);
    expect(d.publishedAt.toISOString()).toBe('2026-03-02T12:34:56.789Z');
    expect(d.id).toBe(42);
  });

  it.each([
    ['not base64url', '!!!'],
    ['non-JSON', b64('hello')],
    ['wrong shape', b64('{"t":1,"id":"x"}')],
    ['invalid date', b64('{"t":"2026-13-45T00:00:00.000Z","id":1}')],
    ['negative id', b64('{"t":"2026-03-02T00:00:00.000Z","id":-1}')],
    ['non-integer id', b64('{"t":"2026-03-02T00:00:00.000Z","id":1.5}')],
  ])('rejects %s', (_n, s) => {
    expect(() => decodeCursor(s)).toThrow(InvalidCursorError);
  });
});
