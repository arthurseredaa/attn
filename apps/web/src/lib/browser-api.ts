import { errorBodySchema } from '@attn/shared';

export class BrowserApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function browserJson<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  schema: { parse(i: unknown): T },
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = errorBodySchema.safeParse(json);
    throw new BrowserApiError(res.status, err.success ? err.data.message : `Request failed (${res.status})`);
  }
  try {
    return schema.parse(json);
  } catch {
    // a ZodError (response shape drifted from @attn/shared): show a plain message, not zod's issue dump
    throw new BrowserApiError(res.status, 'The server sent an unexpected response. Please reload the page.');
  }
}
