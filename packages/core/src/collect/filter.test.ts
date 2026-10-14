import { describe, expect, it } from 'vitest';
import { passesFilter, passesPathFilter } from './filter';

const vercel = { path_prefix: ['/blog/'], keywords: ['ai', 'ai sdk', 'v0'] };

describe('passesFilter', () => {
  it('passes matching path and keyword', () => {
    expect(passesFilter({ url: 'https://vercel.com/blog/ai-gateway', title: 'AI Gateway GA' }, vercel)).toBe(true);
  });
  it('rejects path match without keyword', () => {
    expect(passesFilter({ url: 'https://vercel.com/blog/new-office', title: 'Our new office' }, vercel)).toBe(false);
  });
  it('rejects wrong path', () => {
    expect(passesFilter({ url: 'https://vercel.com/changelog/ai-thing', title: 'AI thing' }, vercel)).toBe(false);
  });
  it('rejects excluded prefix', () => {
    const f = { exclude_path_prefix: ['/ai-coding-dictionary/'], keywords: ['ai'] };
    expect(passesFilter({ url: 'https://x.com/ai-coding-dictionary/x', title: 'AI' }, f)).toBe(false);
  });
  it('matches whole words only', () => {
    const f = { keywords: ['ai'] };
    expect(passesFilter({ url: 'https://x.com/p', title: 'How to maintain things' }, f)).toBe(false);
  });
  it('matches v0 in title', () => {
    expect(passesFilter({ url: 'https://vercel.com/blog/t', title: 'Introducing v0 templates' }, vercel)).toBe(true);
  });
  it('does not throw on regex metacharacters', () => {
    expect(() => passesFilter({ url: 'https://x.com/p', title: 'C++ rocks' }, { keywords: ['c++'] })).not.toThrow();
  });
  it('undefined filter passes everything', () => {
    expect(passesFilter({ url: 'https://x.com/p', title: 't' }, undefined)).toBe(true);
  });
});

describe('passesPathFilter', () => {
  it('ignores keywords', () => {
    expect(passesPathFilter('https://vercel.com/blog/new-office', vercel)).toBe(true);
    expect(passesPathFilter('https://vercel.com/changelog/x', vercel)).toBe(false);
  });
  it('undefined passes', () => {
    expect(passesPathFilter('https://x.com/a', undefined)).toBe(true);
  });
});
