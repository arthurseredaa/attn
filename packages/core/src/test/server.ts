import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RouteResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  delayMs?: number;
}
export type Route = RouteResponse | ((req: IncomingMessage, body: string) => RouteResponse);

export interface TestServer {
  baseUrl: string;
  requests: { method: string; path: string; headers: IncomingMessage['headers']; body: string }[];
  /** Count of requests to that path (query excluded). */
  hits(path: string): number;
  setRoute(path: string, route: Route): void;
  /** Closes open connections first, so stalled routes cannot hang the test run. */
  close(): Promise<void>;
}

/** Local HTTP server on an ephemeral port. Unknown path -> 404; default status 200; every response closes its connection. */
export async function startServer(initial: Record<string, Route> = {}): Promise<TestServer> {
  const routes = new Map<string, Route>(Object.entries(initial));
  const requests: TestServer['requests'] = [];

  const server = createServer((req, res) => {
    // No keep-alive: a pooled client socket must not outlive this server and be reused against a later
    // server that got the same ephemeral port (seen as HTTPParserError in oauth.e2e).
    res.setHeader('connection', 'close');
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      requests.push({ method: req.method ?? 'GET', path, headers: req.headers, body });
      const route = routes.get(path);
      if (!route) {
        res.writeHead(404).end('not found');
        return;
      }
      const r = typeof route === 'function' ? route(req, body) : route;
      const send = () => {
        if (res.destroyed) return;
        res.writeHead(r.status ?? 200, r.headers ?? {});
        res.end(r.body ?? '');
      };
      if (r.delayMs) setTimeout(send, r.delayMs);
      else send();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    hits: (path) => requests.filter((r) => r.path === path).length,
    setRoute: (path, route) => void routes.set(path, route),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
