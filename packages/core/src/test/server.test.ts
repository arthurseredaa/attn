import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from './server';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('startServer', () => {
  // Pooled keep-alive sockets outlive a closed test server; a later server on a recycled ephemeral port
  // then receives a request on a socket the client thinks is still open (oauth.e2e HTTPParserError flake).
  it('closes every connection after the response, for known and unknown routes', async () => {
    server = await startServer({ '/ok': { body: 'hi' } });
    const ok = await fetch(`${server.baseUrl}/ok`);
    expect(await ok.text()).toBe('hi');
    expect(ok.headers.get('connection')).toBe('close');
    const missing = await fetch(`${server.baseUrl}/nope`);
    expect(missing.status).toBe(404);
    await missing.text();
    expect(missing.headers.get('connection')).toBe('close');
  });
});
