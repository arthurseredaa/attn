import { describe, it, expect, expectTypeOf } from 'vitest';
import { taxonomySkillIds } from '@attn/shared';
import { loadTaxonomy } from '../data';
import { makePublicArticle, type LabelResult, type Labeler, type PublicArticle } from './types';
import { RateLimitError } from './errors';
import { createFakeLabeler, DEFAULT_FAKE_LABEL } from './fake';

describe('label types', () => {
  it('PublicArticle has exactly title, url, text', () => {
    expectTypeOf<keyof PublicArticle>().toEqualTypeOf<'title' | 'url' | 'text'>();
    expectTypeOf<Parameters<Labeler['label']>>().toEqualTypeOf<[article: PublicArticle]>();
    expectTypeOf<ReturnType<Labeler['label']>>().toEqualTypeOf<Promise<LabelResult>>();
  });

  it('makePublicArticle copies only the allowed keys', () => {
    const a = makePublicArticle({ title: 'T', url: 'https://e.com/a', text: 'x', userId: 'u-1', level: 3 } as never);
    expect(Object.keys(a).sort()).toEqual(['text', 'title', 'url']);
  });

  it('DEFAULT_FAKE_LABEL skills exist in the real taxonomy', () => {
    const t = loadTaxonomy();
    const ids = taxonomySkillIds(t);
    expect(ids).toHaveLength(32);
    expect(ids).toContain('context-engineering');
    expect(ids).toContain('cc-hooks');
  });
});

describe('createFakeLabeler', () => {
  const art = makePublicArticle({ title: 'T', url: 'https://e.com/a', text: 'x' });

  it('records calls, returns the default label and numbers calls from 0', async () => {
    const seen: number[] = [];
    const fake = createFakeLabeler((_a, i) => {
      seen.push(i);
      return DEFAULT_FAKE_LABEL;
    });
    expect(fake.model).toBe('fake-model');
    expect(await fake.label(art)).toEqual(DEFAULT_FAKE_LABEL);
    await fake.label(art);
    expect(seen).toEqual([0, 1]);
    expect(fake.calls).toEqual([art, art]);
    expect(await createFakeLabeler().label(art)).toEqual(DEFAULT_FAKE_LABEL);
  });

  it('records the call even when respond throws a RateLimitError', async () => {
    const fake = createFakeLabeler(() => {
      throw new RateLimitError('429');
    });
    await expect(fake.label(art)).rejects.toBeInstanceOf(RateLimitError);
    expect(fake.calls).toHaveLength(1);
  });

  it('RateLimitError is a named Error', () => {
    const e = new RateLimitError('x');
    expect(e.name).toBe('RateLimitError');
    expect(e).toBeInstanceOf(Error);
  });
});
