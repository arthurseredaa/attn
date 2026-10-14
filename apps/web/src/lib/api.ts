// Server-side API client. Server components call the api directly at API_URL
// (the browser uses the /api/* rewrite instead). Import only from server components.
import { cache } from 'react';
import { cookies } from 'next/headers';
import {
  articlesPageSchema,
  errorBodySchema,
  meSchema,
  profileSchema,
  quizResponseSchema,
  sourcesResponseSchema,
  taxonomySchema,
  type ArticlesPage,
  type ArticlesQuery,
  type ErrorBody,
  type Me,
  type Profile,
  type QuizResponse,
  type SourceSummary,
  type Taxonomy,
} from '@attn/shared';
import { buildQueryString } from './query';

const apiBase = () => (process.env.API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody | null,
    message: string,
  ) {
    super(message);
  }
}

interface Parser<T> {
  parse(input: unknown): T;
}

export async function apiGet<T>(
  path: string,
  schema: Parser<T>,
  opts: { query?: Record<string, string | number | undefined>; cookie?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await fetch(`${apiBase()}/api${path}${buildQueryString(opts.query ?? {})}`, {
    headers,
    cache: 'no-store',
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const body = errorBodySchema.safeParse(json);
    throw new ApiError(res.status, body.success ? body.data : null, body.success ? body.data.message : `API ${res.status}`);
  }
  return schema.parse(json);
}

// cache(): Nav and pages share one /me call per request.
export const getMe = cache(async (): Promise<Me | null> => {
  // Read cookies() OUTSIDE the try: Next signals "dynamic usage" by throwing from it,
  // and swallowing that would let a prerendered route cache a signed-out shell.
  const cookie = (await cookies()).toString();
  try {
    return await apiGet('/me', meSchema, { cookie });
  } catch {
    return null; // 401, or the api is down: render the signed-out shell
  }
});

export const getArticles = (q: ArticlesQuery): Promise<ArticlesPage> =>
  apiGet('/articles', articlesPageSchema, { query: { ...q } });
export const getSources = (): Promise<SourceSummary[]> => apiGet('/sources', sourcesResponseSchema);
export const getTaxonomy = (): Promise<Taxonomy> => apiGet('/taxonomy', taxonomySchema);

export async function getProfile(): Promise<Profile> {
  const cookie = (await cookies()).toString(); // outside any try/catch, see getMe
  return apiGet('/profile', profileSchema, { cookie });
}

export async function getQuiz(skills: string[]): Promise<QuizResponse> {
  const cookie = (await cookies()).toString();
  return apiGet('/quiz', quizResponseSchema, { query: { skills: skills.join(',') }, cookie });
}
