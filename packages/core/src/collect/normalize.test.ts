import { describe, expect, it } from 'vitest';
import { decodeEntities, normalizeUrl, titleHash, utcDay, utcDayBounds } from './normalize';

const cases: [string, string | null][] = [
  ['https://Example.COM/Post/?utm_source=x&utm_medium=y&id=3#frag', 'https://example.com/Post?id=3'],
  ['https://example.com/a/?ref=hn&fbclid=abc', 'https://example.com/a'],
  ['https://example.com/', 'https://example.com'],
  ['https://example.com/?id=1', 'https://example.com?id=1'],
  ['https://example.com/a/b/', 'https://example.com/a/b'],
  ['http://example.com/a?b=1&a=2', 'http://example.com/a?b=1&a=2'], // param order untouched
  ['mailto:a@b.c', null],
  ['javascript:alert(1)', null],
  ['not a url', null],
  ['', null],
  ['https://example.com:443/a', 'https://example.com/a'],
  ['HTTPS://EXAMPLE.com/A', 'https://example.com/A'], // only the host is lowercased; path case kept
];

describe('normalizeUrl', () => {
  it.each(cases)('%s -> %s', (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });
});

describe('titleHash', () => {
  it('ignores punctuation, spacing and case', () => {
    expect(titleHash('Hello,  World!')).toBe(titleHash('hello world'));
  });
  it('decodes entities first', () => {
    expect(titleHash('Tom &amp; Jerry')).toBe(titleHash('Tom & Jerry'));
  });
  it('differs for different titles', () => {
    expect(titleHash('one')).not.toBe(titleHash('two'));
  });
  it('is 64 hex chars', () => {
    expect(titleHash('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('decodeEntities', () => {
  it('decodes known entities and leaves unknown ones', () => {
    expect(decodeEntities('a &amp; b &#65; &#x42; &bogus;')).toBe('a & b A B &bogus;');
  });
  it('decodes lt gt quot apos #39', () => {
    expect(decodeEntities('&lt;&gt;&quot;&apos;&#39;')).toBe("<>\"''");
  });
});

describe('utcDay', () => {
  const d = new Date('2026-01-01T23:30:00-05:00');
  it('formats the UTC day', () => {
    expect(utcDay(d)).toBe('2026-01-02');
  });
  it('returns half-open UTC bounds', () => {
    const { start, end } = utcDayBounds(d);
    expect(start.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-03T00:00:00.000Z');
  });
});
