import { afterEach, describe, expect, it } from 'vitest';
import { USER_AGENT } from '../collect/http';
import { startServer, type TestServer } from '../test/server';
import {
  countWords,
  ExtractError,
  extractFromHtml,
  fetchArticleText,
  limitText,
  truncateText,
} from './extract';
import { articleHtml } from './fixtures/html';

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords(' a  b\nc ')).toBe(3);
    expect(countWords('')).toBe(0);
  });
});

describe('truncateText', () => {
  it('cuts to maxChars', () => {
    expect(truncateText('abcdef', 3)).toBe('abc');
    expect(truncateText('abc', 3)).toBe('abc');
    expect(truncateText('abc', 10)).toBe('abc');
  });
});

describe('limitText', () => {
  it('throws too_short, truncates long, keeps mid', () => {
    const opts = { minChars: 200, maxChars: 500 };
    let err: unknown;
    try {
      limitText('x'.repeat(100), opts);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ExtractError);
    expect((err as ExtractError).kind).toBe('too_short');
    expect((err as ExtractError).message).toBe('text too short: 100 < 200 chars');
    expect(limitText('x'.repeat(600), opts)).toHaveLength(500);
    expect(limitText('x'.repeat(300), opts)).toHaveLength(300);
  });
});

describe('extractFromHtml', () => {
  it('extracts main text without nav/footer', () => {
    const a = extractFromHtml(articleHtml('My Title', 300), 'https://example.com/a');
    expect(a.title).not.toBe('');
    expect(a.wordCount).toBe(countWords(a.text));
    expect(a.wordCount).toBeGreaterThanOrEqual(295);
    expect(a.wordCount).toBeLessThanOrEqual(310);
    expect(a.text).toContain('w0');
    expect(a.text).toContain('w299');
    expect(a.text).not.toContain('Pricing');
    expect(a.text).not.toContain('Copyright junk');
  });

  it('still extracts a short page', () => {
    const a = extractFromHtml(articleHtml('T', 20), 'https://example.com/s');
    expect(a.text.length).toBeLessThan(200);
    expect(a.wordCount).toBeGreaterThanOrEqual(8);
    expect(a.wordCount).toBeLessThanOrEqual(25);
  });

  it('throws unreadable for an empty page', () => {
    try {
      extractFromHtml('<html><body></body></html>', 'https://example.com/');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ExtractError);
      expect((e as ExtractError).kind).toBe('unreadable');
    }
  });
});

describe('fetchArticleText', () => {
  let server: TestServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('fetches and extracts with the right headers', async () => {
    server = await startServer({
      '/a': {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: articleHtml('A', 300),
      },
    });
    const a = await fetchArticleText(`${server.baseUrl}/a`);
    expect(a.wordCount).toBeGreaterThanOrEqual(295);
    expect(a.wordCount).toBeLessThanOrEqual(310);
    const req = server.requests[0];
    expect(req?.headers.accept).toContain('text/html');
    expect(req?.headers['user-agent']).toBe(USER_AGENT);
  });

  it('maps 404 to http error', async () => {
    server = await startServer();
    const err = await fetchArticleText(`${server.baseUrl}/missing`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExtractError);
    expect((err as ExtractError).kind).toBe('http');
    expect((err as ExtractError).message).toContain('404');
  });

  it('rejects non-HTML content', async () => {
    server = await startServer({
      '/doc.pdf': { headers: { 'Content-Type': 'application/pdf' }, body: '%PDF-1.4' },
    });
    const err = await fetchArticleText(`${server.baseUrl}/doc.pdf`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExtractError);
    expect((err as ExtractError).kind).toBe('not_html');
  });

  it('times out instead of hanging', async () => {
    server = await startServer({
      '/slow': {
        headers: { 'Content-Type': 'text/html' },
        body: articleHtml('A', 300),
        delayMs: 300,
      },
    });
    await expect(fetchArticleText(`${server.baseUrl}/slow`, { timeoutMs: 50 })).rejects.toThrow();
  });

  it('uses an injected fetchFn', async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(articleHtml('A', 100), { headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const a = await fetchArticleText('https://example.invalid/x', { fetchFn });
    expect(calls).toEqual(['https://example.invalid/x']);
    expect(a.wordCount).toBeGreaterThan(90);
  });
});
