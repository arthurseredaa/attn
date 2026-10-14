import { startServer, type TestServer } from '@attn/core/testing';

export const GITHUB_TEST_CLIENT_ID = 'test-client';
export const GITHUB_TEST_CLIENT_SECRET = 'test-secret';

export interface GithubFixtureUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}
export type FakeGithub = TestServer;

/** Local fake of github.com (token exchange) and api.github.com (/user). `users` is keyed by OAuth `code`. */
export async function startFakeGithub(users: Record<string, GithubFixtureUser>): Promise<FakeGithub> {
  const json = (body: unknown, status = 200) => ({
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return startServer({
    '/login/oauth/access_token': (_req, body) => {
      let p: Record<string, unknown> = {};
      try { p = JSON.parse(body) as Record<string, unknown>; } catch { /* leave empty */ }
      const code = typeof p.code === 'string' ? p.code : '';
      if (p.client_id !== GITHUB_TEST_CLIENT_ID || p.client_secret !== GITHUB_TEST_CLIENT_SECRET || !(code in users)) {
        return json({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
      }
      return json({ access_token: `tok-${code}`, token_type: 'bearer', scope: '' });
    },
    '/user': (req) => {
      const code = /^Bearer tok-(.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
      const user = code === undefined ? undefined : users[code];
      return user ? json(user) : json({ message: 'Bad credentials' }, 401);
    },
  });
}
