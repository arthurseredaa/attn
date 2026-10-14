import { describe, expect, it } from 'vitest';
import { readFixture } from './fixtures/load';
import { parseFeed } from './parse-feed';
import { parsePageTitle } from './parse-page';
import { isSitemapIndex, parseSitemap, parseSitemapIndex } from './parse-sitemap';

const B = 'http://fixture.test';
const fx = (n: string) => readFixture(n, B);

describe('parseFeed rss', () => {
  const e = parseFeed(fx('rss.xml'));
  it('returns 7 entries, dropping the linkless one', () => {
    expect(e).toHaveLength(7);
    expect(e.map((x) => x.title)).not.toContain('No link');
  });
  it('uses guid and decodes CDATA entities', () => {
    expect(e[1]?.guid).toBe('tag:two');
    expect(e[1]?.title).toBe('Tom & Jerry');
    expect(e[0]?.guid).toBe(e[0]?.url);
    expect(e[0]?.publishedAt?.toISOString()).toBe('2026-10-06T10:00:00.000Z');
  });
  it('handles invalid date, mailto and missing title', () => {
    expect(e.find((x) => x.title === 'Undated')?.publishedAt).toBeNull();
    expect(e.find((x) => x.title === 'Mail')?.url).toBe('mailto:editor@example.com');
    expect(e.find((x) => x.url.endsWith('/notitle'))?.title).toBeNull();
  });
  it('returns 4 entries for variants', () => {
    expect(parseFeed(fx('variants.xml'))).toHaveLength(4);
  });
});

describe('parseFeed atom', () => {
  const e = parseFeed(fx('atom.xml'));
  it('parses entries', () => {
    expect(e).toHaveLength(3);
    expect(e[0]?.url).toBe(`${B}/atom/one`);
    expect(e[0]?.guid).toBe('tag:atom-one');
    expect(e[0]?.publishedAt?.toISOString()).toBe('2026-09-20T10:00:00.000Z');
    expect(e[1]?.url).toBe(`${B}/atom/two`);
    expect(e[1]?.publishedAt?.toISOString()).toBe('2026-09-10T10:00:00.000Z');
    expect(e[2]?.title).toBe('Atom three');
  });
});

describe('parseFeed errors', () => {
  it('throws on malformed and non-feed xml', () => {
    expect(() => parseFeed(fx('broken.xml'))).toThrow();
    expect(() => parseFeed('<html/>')).toThrow('unrecognized feed format');
  });
});

describe('sitemap', () => {
  it('filters by prefix', () => {
    const r = parseSitemap(fx('sitemap.xml'), '/news/');
    expect(r.map((x) => x.url)).toEqual([
      `${B}/news/alpha`,
      `${B}/news/beta`,
      `${B}/news/gamma`,
      `${B}/news/ancient`,
    ]);
    expect(r[0]?.lastmod?.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(r[1]?.lastmod?.toISOString()).toBe('2026-09-15T08:30:00.000Z');
    expect(r[2]?.lastmod).toBeNull();
    expect(parseSitemap(fx('sitemap.xml'), '/engineering/')).toHaveLength(1);
  });
  it('detects and parses a sitemap index', () => {
    expect(() => parseSitemap(fx('sitemapindex.xml'), '/news/')).toThrow(/^sitemap index/);
    expect(isSitemapIndex(fx('sitemapindex.xml'))).toBe(true);
    expect(isSitemapIndex(fx('sitemap.xml'))).toBe(false);
    expect(parseSitemapIndex(fx('sitemapindex.xml'))).toEqual([
      `${B}/sitemap-a.xml`,
      `${B}/sitemap-b.xml`,
    ]);
  });
});

describe('parsePageTitle', () => {
  it('prefers og:title, falls back to title, else null', () => {
    expect(parsePageTitle(fx('page.html'))).toBe('OG Title');
    expect(parsePageTitle('<title> T </title>')).toBe('T');
    expect(parsePageTitle('')).toBeNull();
  });
});

describe('entities and numeric-looking text', () => {
  const e = parseFeed(fx('entities.xml'));
  it('decodes entities exactly once and in urls', () => {
    expect(e[0]?.title).toBe('Tom &amp; Jerry');
    expect(e[0]?.url).toBe(`${B}/e/one?a=1&b=2`);
  });
  it('keeps numeric-looking guids and titles verbatim', () => {
    expect(e.map((x) => x.guid)).toEqual(['007', '1e3', '1.10']);
    expect(e[1]?.title).toBe('0x10');
    expect(e[2]?.title).toBe('1.10');
  });
});
