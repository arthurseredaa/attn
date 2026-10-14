import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from '../test/server';
import { conditionalGet, getText, USER_AGENT } from './http';

let server: TestServer;
afterEach(async () => {
  await server.close();
});

const LM = 'Wed, 01 Oct 2026 00:00:00 GMT';

describe('conditionalGet', () => {
  it('returns body and validators on first request without conditional headers', async () => {
    server = await startServer({
      '/feed': { body: '<rss/>', headers: { etag: '"v1"', 'last-modified': LM } },
    });
    const r = await conditionalGet(`${server.baseUrl}/feed`, null);
    expect(r).toEqual({ status: 'ok', body: '<rss/>', etag: '"v1"', lastModified: LM });
    const h = server.requests[0]!.headers;
    expect(h['if-none-match']).toBeUndefined();
    expect(h['if-modified-since']).toBeUndefined();
  });

  it('sends validators and maps 304 to not_modified echoing them', async () => {
    server = await startServer({
      '/feed': (req) =>
        req.headers['if-none-match'] === '"v1"' && req.headers['if-modified-since'] === LM
          ? { status: 304 }
          : { body: 'full' },
    });
    const r = await conditionalGet(`${server.baseUrl}/feed`, { etag: '"v1"', lastModified: LM });
    expect(r).toEqual({ status: 'not_modified', etag: '"v1"', lastModified: LM });
  });

  it('throws on 500 with the status in the message', async () => {
    server = await startServer({ '/feed': { status: 500 } });
    await expect(conditionalGet(`${server.baseUrl}/feed`, null)).rejects.toThrow(/500/);
  });

  it('rejects when the server is slower than the timeout', async () => {
    server = await startServer({ '/feed': { delayMs: 500, body: 'x' } });
    await expect(conditionalGet(`${server.baseUrl}/feed`, null, fetch, 50)).rejects.toThrow();
  });

  it('follows redirects', async () => {
    server = await startServer({
      '/old': { status: 301, headers: { location: '/final' } },
      '/final': { body: 'done' },
    });
    const r = await conditionalGet(`${server.baseUrl}/old`, null);
    expect(r.body).toBe('done');
  });

  it('sends the User-Agent and Accept headers', async () => {
    server = await startServer({ '/feed': { body: 'x' } });
    await conditionalGet(`${server.baseUrl}/feed`, null);
    const h = server.requests[0]!.headers;
    expect(h['user-agent']).toBe(USER_AGENT);
    expect(h.accept).toContain('application/rss+xml');
  });
});

describe('getText', () => {
  it('returns the body and throws on 404', async () => {
    server = await startServer({ '/ok': { body: 'hello' } });
    expect(await getText(`${server.baseUrl}/ok`)).toBe('hello');
    await expect(getText(`${server.baseUrl}/missing`)).rejects.toThrow(/404/);
  });
});
