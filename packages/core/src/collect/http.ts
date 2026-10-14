export type FetchFn = typeof fetch;

export interface ConditionalResult {
  status: 'ok' | 'not_modified';
  body?: string;
  etag: string | null;
  lastModified: string | null;
}
export interface CachedState {
  etag: string | null;
  lastModified: string | null;
}

export const USER_AGENT = 'attn-collector/0.1 (+https://github.com/arthursereda/attn)';
const ACCEPT = 'application/xml, text/xml, application/rss+xml, application/atom+xml, */*';
const DEFAULT_TIMEOUT_MS = 20000;

export async function conditionalGet(
  url: string,
  state: CachedState | null,
  fetchFn: FetchFn = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ConditionalResult> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: ACCEPT };
  if (state?.etag) headers['If-None-Match'] = state.etag;
  if (state?.lastModified) headers['If-Modified-Since'] = state.lastModified;

  const res = await fetchFn(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (res.status === 304) {
    return {
      status: 'not_modified',
      etag: state?.etag ?? null,
      lastModified: state?.lastModified ?? null,
    };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return {
    status: 'ok',
    body: await res.text(),
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  };
}

export async function getText(
  url: string,
  fetchFn: FetchFn = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const res = await fetchFn(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
