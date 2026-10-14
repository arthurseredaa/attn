import { describe, expect, it } from 'vitest';
import {
  AUTH_ERROR_CODES,
  articleCardSchema,
  articlesPageSchema,
  articlesQuerySchema,
  authErrorMessage,
  errorBodySchema,
  isDateBound,
  meSchema,
  readingMinutes,
  resolveDateRange,
} from './index';

const card = {
  id: 1,
  title: 'T',
  url: 'https://example.com/a',
  sourceId: 's',
  sourceName: 'Source',
  publishedAt: '2026-03-01T10:00:00.000Z',
  wordCount: 1200,
  difficulty: 2,
  type: 'tutorial',
  quality: 3,
  skills: [{ id: 'x', name: 'X', isPrimary: true }],
};

describe('articlesQuerySchema', () => {
  it('accepts an empty query and coerces limit', () => {
    expect(articlesQuerySchema.parse({})).toEqual({});
    expect(articlesQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 });
  });

  it.each([{ limit: '0' }, { limit: '51' }, { limit: 'abc' }, { limit: '1.5' }])('rejects limit %j', (q) => {
    expect(articlesQuerySchema.safeParse(q).success).toBe(false);
  });

  it('rejects empty strings and unknown shapes for text params', () => {
    expect(articlesQuerySchema.safeParse({ source: '' }).success).toBe(false);
    expect(articlesQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
    expect(articlesQuerySchema.safeParse({ skill: ['a', 'b'] }).success).toBe(false);
  });

  it('validates date bounds and ordering', () => {
    expect(articlesQuerySchema.safeParse({ from: '2026-03-01', to: '2026-03-01' }).success).toBe(true);
    expect(articlesQuerySchema.safeParse({ from: '2026-03-02', to: '2026-03-01' }).success).toBe(false);
    expect(articlesQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
    expect(articlesQuerySchema.safeParse({ from: '2026-02-31' }).success).toBe(false);
    expect(articlesQuerySchema.safeParse({ from: '2026-03-01T10:00:00' }).success).toBe(false); // no timezone
    expect(articlesQuerySchema.safeParse({ from: '2026-03-01T10:00:00Z' }).success).toBe(true);
  });
});

describe('date helpers', () => {
  it('isDateBound', () => {
    expect(isDateBound('2026-03-01')).toBe(true);
    expect(isDateBound('2026-03-01T10:00:00.123+02:00')).toBe(true);
    expect(isDateBound('2026-13-01')).toBe(false);
    expect(isDateBound('')).toBe(false);
  });

  it('resolveDateRange: date-only covers whole UTC days, datetimes are exact', () => {
    const r = resolveDateRange({ from: '2026-03-01', to: '2026-03-02' });
    expect(r.from?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(r.toExclusive?.toISOString()).toBe('2026-03-03T00:00:00.000Z');
    const t = resolveDateRange({ from: '2026-03-01T10:00:00Z', to: '2026-03-01T12:00:00Z' });
    expect(t.from?.toISOString()).toBe('2026-03-01T10:00:00.000Z');
    expect(t.toExclusive?.toISOString()).toBe('2026-03-01T12:00:00.001Z');
    expect(resolveDateRange({})).toEqual({});
  });
});

describe('response schemas', () => {
  it('parse valid payloads and reject malformed ones', () => {
    expect(articleCardSchema.parse(card)).toEqual(card);
    expect(articleCardSchema.safeParse({ ...card, difficulty: 5 }).success).toBe(false);
    expect(articleCardSchema.safeParse({ ...card, url: 'javascript:alert(1)' }).success).toBe(false);
    expect(articleCardSchema.safeParse({ ...card, url: 'data:text/html,x' }).success).toBe(false);
    expect(articlesPageSchema.parse({ items: [card], nextCursor: null }).nextCursor).toBeNull();
    expect(meSchema.safeParse({ id: 'nope', login: 'a', name: null, avatarUrl: null, role: 'dev' }).success).toBe(false);
    expect(errorBodySchema.parse({ error: 'bad_request', message: 'm', db: 'down' }).error).toBe('bad_request');
    const me = { id: '00000000-0000-4000-8000-000000000000', login: 'a', name: null, avatarUrl: null, role: 'dev' };
    expect(meSchema.parse(me)).toEqual(me);
    expect(meSchema.parse({ ...me, avatarUrl: 'https://avatars.example/a.png' }).avatarUrl).toBe('https://avatars.example/a.png');
    for (const avatarUrl of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url', '']) {
      expect(meSchema.safeParse({ ...me, avatarUrl }).success).toBe(false);
    }
  });
});

describe('authErrorMessage', () => {
  it('maps known codes to fixed messages and ignores anything else', () => {
    for (const code of AUTH_ERROR_CODES) expect(authErrorMessage(code)).toMatch(/\w/);
    expect(authErrorMessage('<script>alert(1)</script>')).toBeNull();
    expect(authErrorMessage(undefined)).toBeNull();
    expect(authErrorMessage('')).toBeNull();
  });
});

describe('readingMinutes', () => {
  it('rounds up with a floor of one minute', () => {
    expect(readingMinutes(1)).toBe(1);
    expect(readingMinutes(200)).toBe(1);
    expect(readingMinutes(201)).toBe(2);
    expect(readingMinutes(1500)).toBe(8);
  });
  it('is null when unknown', () => {
    expect(readingMinutes(null)).toBeNull();
    expect(readingMinutes(undefined)).toBeNull();
    expect(readingMinutes(0)).toBeNull();
  });
});
