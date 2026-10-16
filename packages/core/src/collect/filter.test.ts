import { describe, expect, it } from 'vitest';
import { exclusionRule, passesFilter, passesPathFilter } from './filter';

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

describe('exclusionRule', () => {
  const at = (path: string, title: string | null = 'T', filter = {}) =>
    exclusionRule({ url: `https://x.com${path}`, title }, filter);

  it('exclude_paths is an exact match, ignoring a trailing slash', () => {
    const f = { exclude_paths: ['/skills', '/skills/subscribe'] };
    expect(at('/skills', 'T', f)).toBe('exclude_paths');
    expect(at('/skills/', 'T', f)).toBe('exclude_paths');
    expect(at('/skills/subscribe', 'T', f)).toBe('exclude_paths');
    expect(at('/skills/tdd', 'T', f)).toBeNull();
    expect(at('/skills-catalog', 'T', f)).toBeNull();
    expect(at('/my/skills', 'T', f)).toBeNull();
  });
  it('exclude_paths with a trailing slash in the config also matches the bare path', () => {
    expect(at('/newsletter', 'T', { exclude_paths: ['/newsletter/'] })).toBe('exclude_paths');
  });
  it('exclude_path_prefix is reported by name', () => {
    expect(at('/workshops/a', 'T', { exclude_path_prefix: ['/workshops/'] })).toBe('exclude_path_prefix');
  });
  it('exclude_path_regex tests the path, case-sensitively', () => {
    const f = { exclude_path_regex: ['^/blog/how-.*-(on-vercel|with-v0|with-vercel)$', 'accelerator'] };
    expect(at('/blog/how-rogo-ships-on-vercel', 'T', f)).toBe('exclude_path_regex');
    expect(at('/blog/how-x-cut-time-with-v0', 'T', f)).toBe('exclude_path_regex');
    expect(at('/blog/2026-vercel-ai-accelerator-recap', 'T', f)).toBe('exclude_path_regex');
    expect(at('/blog/how-to-build-agents', 'T', f)).toBeNull();
    expect(at('/blog/how-x-on-vercel/more', 'T', f)).toBeNull();
    expect(at('/blog/ACCELERATOR', 'T', f)).toBeNull();
  });
  it('exclude_title_regex is case-insensitive and ignores the path', () => {
    const f = { exclude_title_regex: ['birthday', 'launched during', 'civil society'] };
    expect(at('/p', 'Everything we launched during Birthday Week', f)).toBe('exclude_title_regex');
    expect(at('/p', 'Protecting Civil Society', f)).toBe('exclude_title_regex');
    expect(at('/birthday', 'A normal title', f)).toBeNull();
  });
  it('title rules wait for a title; path rules do not', () => {
    const f = { exclude_title_regex: ['birthday'], exclude_paths: ['/a'] };
    expect(at('/p', null, f)).toBeNull();
    expect(at('/a', null, f)).toBe('exclude_paths');
  });
  it('ignores URLs outside path_prefix and passes without a filter', () => {
    expect(at('/other/skills', 'T', { path_prefix: ['/blog/'], exclude_path_regex: ['skills'] })).toBeNull();
    expect(exclusionRule({ url: 'https://x.com/a', title: 'T' }, undefined)).toBeNull();
  });
  it('passesFilter applies the exclusion rules', () => {
    expect(passesFilter({ url: 'https://x.com/skills', title: 'AI' }, { exclude_paths: ['/skills'] })).toBe(false);
    expect(
      passesFilter({ url: 'https://x.com/p', title: 'Founders letter' }, { exclude_title_regex: ['founders'] }),
    ).toBe(false);
  });
});
