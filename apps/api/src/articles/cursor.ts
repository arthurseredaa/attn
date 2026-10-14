import { z } from 'zod';

export class InvalidCursorError extends Error {}

export interface Cursor {
  publishedAt: Date;
  id: number;
}

const payload = z.object({ t: z.iso.datetime(), id: z.number().int().nonnegative() });

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ t: c.publishedAt.toISOString(), id: c.id }), 'utf8').toString('base64url');
}

export function decodeCursor(s: string): Cursor {
  try {
    const parsed = payload.parse(JSON.parse(Buffer.from(s, 'base64url').toString('utf8')));
    return { publishedAt: new Date(parsed.t), id: parsed.id };
  } catch {
    throw new InvalidCursorError('invalid cursor');
  }
}
