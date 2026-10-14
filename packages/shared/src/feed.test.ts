import { describe, it, expect } from 'vitest';
import {
  articleIdParamSchema,
  eventBodySchema,
  eventResponseSchema,
  feedPageSchema,
  feedQuerySchema,
  mergeFeedItems,
  type ArticleCard,
} from './index';

const card = (id: number): ArticleCard => ({
  id,
  title: `t${id}`,
  url: `https://example.com/${id}`,
  sourceId: 's',
  sourceName: 'S',
  publishedAt: '2026-10-13T12:00:00.000Z',
  wordCount: null,
  difficulty: 2,
  type: 'news',
  quality: 3,
  skills: [{ id: 'a', name: 'A', isPrimary: true }],
});

describe('feedQuerySchema', () => {
  it('defaults and parses offsets', () => {
    expect(feedQuerySchema.parse({})).toEqual({ offset: 0 });
    expect(feedQuerySchema.parse({ offset: '40' })).toEqual({ offset: 40 });
    expect(feedQuerySchema.parse({ offset: '0' })).toEqual({ offset: 0 });
    expect(feedQuerySchema.parse({ offset: '10000' })).toEqual({ offset: 10000 });
  });
  it('accepts leading zeros as the same decimal number (never octal)', () => {
    expect(feedQuerySchema.parse({ offset: '007' })).toEqual({ offset: 7 });
    expect(feedQuerySchema.parse({ offset: '00' })).toEqual({ offset: 0 });
    expect(feedQuerySchema.parse({ offset: '010000' })).toEqual({ offset: 10000 });
    expect(feedQuerySchema.safeParse({ offset: '010001' }).success).toBe(false);
  });
  it.each(['-1', '1.5', 'abc', '', '10001', '1e3', ' 5', ['1', '2']])('rejects %j', (offset) => {
    expect(feedQuerySchema.safeParse({ offset }).success).toBe(false);
  });
});

describe('articleIdParamSchema', () => {
  it('parses a positive id', () => {
    expect(articleIdParamSchema.parse('7')).toBe(7);
  });
  it.each(['0', '-1', '1.5', 'abc', '007', '99999999999', '2147483648'])('rejects %j', (v) => {
    expect(articleIdParamSchema.safeParse(v).success).toBe(false);
  });
});

describe('event schemas', () => {
  it('accepts the five kinds', () => {
    for (const kind of ['read', 'like', 'too_easy', 'too_hard', 'not_interested']) {
      expect(eventBodySchema.safeParse({ kind }).success).toBe(true);
    }
  });
  it('rejects unknown kind, empty and extra keys', () => {
    expect(eventBodySchema.safeParse({ kind: 'share' }).success).toBe(false);
    expect(eventBodySchema.safeParse({}).success).toBe(false);
    expect(eventBodySchema.safeParse({ kind: 'read', extra: 1 }).success).toBe(false);
  });
  it('parses a response and requires recorded', () => {
    expect(eventResponseSchema.parse({ kind: 'read', recorded: false })).toEqual({ kind: 'read', recorded: false });
    expect(eventResponseSchema.safeParse({ kind: 'read' }).success).toBe(false);
  });
  it('rejects a response with extra keys (no hidden state may ride along)', () => {
    expect(eventResponseSchema.safeParse({ kind: 'read', recorded: true, level: 3 }).success).toBe(false);
    expect(eventResponseSchema.safeParse({ kind: 'share', recorded: true }).success).toBe(false);
  });
});

describe('feedPageSchema', () => {
  it('parses pages', () => {
    expect(feedPageSchema.safeParse({ items: [card(1)], nextOffset: null }).success).toBe(true);
    expect(feedPageSchema.safeParse({ items: [], nextOffset: 20 }).success).toBe(true);
  });
  it('rejects a bad nextOffset', () => {
    expect(feedPageSchema.safeParse({ items: [], nextOffset: -1 }).success).toBe(false);
    expect(feedPageSchema.safeParse({ items: [], nextOffset: 1.5 }).success).toBe(false);
    expect(feedPageSchema.safeParse({ items: [] }).success).toBe(false);
  });
});

describe('mergeFeedItems', () => {
  const [c1, c2, c3, c4] = [card(1), card(2), card(3), card(4)];
  it('appends new cards and counts duplicates', () => {
    expect(mergeFeedItems([c1, c2], [c2, c3, c4])).toEqual({ items: [c1, c2, c3, c4], duplicates: 1 });
  });
  it('handles empty sides', () => {
    expect(mergeFeedItems([], [c1, c2])).toEqual({ items: [c1, c2], duplicates: 0 });
    const current = [c1];
    const r = mergeFeedItems(current, []);
    expect(r).toEqual({ items: [c1], duplicates: 0 });
    expect(r.items).not.toBe(current);
  });
  it('does not mutate inputs and skips duplicates inside incoming', () => {
    const current = [c1];
    const incoming = [c2, c2, c1];
    const r = mergeFeedItems(current, incoming);
    expect(r).toEqual({ items: [c1, c2], duplicates: 2 });
    expect(current).toEqual([c1]);
    expect(incoming).toEqual([c2, c2, c1]);
  });
});
