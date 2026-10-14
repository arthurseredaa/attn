import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessions, users } from '@attn/core';
import { resetDb } from '@attn/core/testing';
import { AUTH_ERROR_CODES } from '@attn/shared';
import { startTestApp, type TestApp } from '../test/app';
import {
  GITHUB_TEST_CLIENT_ID,
  GITHUB_TEST_CLIENT_SECRET,
  startFakeGithub,
  type FakeGithub,
} from '../test/fake-github';
import { seedUser } from '../test/seed';
import { hashToken } from './session';
import { SessionService } from './session.service';

const PROFILE = { id: 4242, login: 'octocat', name: 'The Octocat', avatar_url: 'https://avatars.example/o.png' };
const LANDING = 'http://localhost:3000';

let fake: FakeGithub;
let ctx: TestApp;

const appOpts = () => ({
  githubClientId: GITHUB_TEST_CLIENT_ID,
  githubClientSecret: GITHUB_TEST_CLIENT_SECRET,
  githubOauthBaseUrl: fake.baseUrl,
  githubApiBaseUrl: fake.baseUrl,
});

beforeEach(async () => {
  fake = await startFakeGithub({ 'good-code': PROFILE });
  ctx = await startTestApp(appOpts());
  await resetDb(ctx.db);
});

afterEach(async () => {
  await ctx.close();
  await fake.close();
});

async function begin(base = ctx.base) {
  const res = await fetch(`${base}/api/auth/github`, { redirect: 'manual' });
  const location = new URL(res.headers.get('location') ?? '');
  const state = location.searchParams.get('state') ?? '';
  const stateCookie = res.headers.getSetCookie().find((c) => c.startsWith('attn_oauth_state=')) ?? '';
  return { res, location, state, stateCookie };
}

const callback = (query: string, cookie?: string, base = ctx.base) =>
  fetch(`${base}/api/auth/github/callback?${query}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });

const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const valueOf = (setCookie: string) => setCookie.split(';')[0]!.split('=')[1]!;
const clearsState = (res: Response) => {
  const c = cookieOf(res, 'attn_oauth_state');
  return Boolean(c && c.startsWith('attn_oauth_state=;') && /Expires=Thu, 01 Jan 1970/.test(c));
};
const counts = async () => ({
  users: (await ctx.db.select().from(users)).length,
  sessions: (await ctx.db.select().from(sessions)).length,
});

function expectFailure(res: Response, code: string) {
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe(`${LANDING}/?auth_error=${code}`);
  expect(clearsState(res)).toBe(true);
  expect(cookieOf(res, 'attn_session')).toBeUndefined();
}

describe('GET /api/auth/github', () => {
  it('redirects to GitHub with state, no scope, and a hardened state cookie', async () => {
    const { res, location, state, stateCookie } = await begin();
    expect(res.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe(`${fake.baseUrl}/login/oauth/authorize`);
    expect(location.searchParams.get('client_id')).toBe('test-client');
    expect(location.searchParams.get('redirect_uri')).toBe(`${LANDING}/api/auth/github/callback`);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.has('scope')).toBe(false);
    expect(valueOf(stateCookie)).toBe(state);
    expect(stateCookie).toContain('HttpOnly');
    expect(stateCookie).toContain('SameSite=Lax');
    expect(stateCookie).toContain('Path=/api/auth');
    expect(stateCookie).toContain('Max-Age=600');
    expect(stateCookie).not.toContain('Secure');
  });

  it('not configured -> not_configured, no state cookie value, no session', async () => {
    const app = await startTestApp({ ...appOpts(), githubClientId: undefined });
    try {
      const res = await fetch(`${app.base}/api/auth/github`, { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`${LANDING}/?auth_error=not_configured`);
      const c = cookieOf(res, 'attn_oauth_state');
      expect(c === undefined || c.startsWith('attn_oauth_state=;')).toBe(true);
      expect(cookieOf(res, 'attn_session')).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/auth/github/callback', () => {
  it('happy path: upserts the user, creates a hashed session, sets the cookie', async () => {
    const { state } = await begin();
    const res = await callback(`code=good-code&state=${state}`, `attn_oauth_state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${LANDING}/all`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const session = cookieOf(res, 'attn_session')!;
    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Lax');
    expect(session).toContain('Path=/');
    expect(session).not.toContain('Secure');
    expect(clearsState(res)).toBe(true);
    const token = valueOf(session);

    const rows = await ctx.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      githubId: 4242,
      login: 'octocat',
      name: 'The Octocat',
      avatarUrl: 'https://avatars.example/o.png',
      role: 'dev',
    });
    const srows = await ctx.db.select().from(sessions);
    expect(srows).toHaveLength(1);
    expect(srows[0]).toMatchObject({ id: hashToken(token), userId: rows[0]!.id });

    const me = await fetch(`${ctx.base}/api/me`, { headers: { cookie: `attn_session=${token}` } });
    expect(((await me.json()) as { login: string }).login).toBe('octocat');

    const tokenReqs = fake.requests.filter((r) => r.path === '/login/oauth/access_token');
    expect(tokenReqs).toHaveLength(1);
    expect(tokenReqs[0]!.method).toBe('POST');
    expect(JSON.parse(tokenReqs[0]!.body)).toMatchObject({
      client_id: 'test-client',
      client_secret: 'test-secret',
      code: 'good-code',
      redirect_uri: `${LANDING}/api/auth/github/callback`,
    });
    const userReqs = fake.requests.filter((r) => r.path === '/user');
    expect(userReqs).toHaveLength(1);
    expect(userReqs[0]!.method).toBe('GET');
    expect(userReqs[0]!.headers.authorization).toBe('Bearer tok-good-code');
    expect(String(userReqs[0]!.headers['user-agent'])).not.toBe('');
  });

  it('sets Secure on both cookies and uses the https app url when cookieSecure is on', async () => {
    const app = await startTestApp({ ...appOpts(), appUrl: 'https://attn.example', cookieSecure: true });
    try {
      const { res, location, state, stateCookie } = await begin(app.base);
      expect(location.searchParams.get('redirect_uri')).toBe('https://attn.example/api/auth/github/callback');
      expect(res.status).toBe(302);
      expect(stateCookie).toContain('Secure');
      const cb = await callback(`code=good-code&state=${state}`, `attn_oauth_state=${state}`, app.base);
      expect(cb.headers.get('location')).toBe('https://attn.example/all');
      expect(cookieOf(cb, 'attn_session')).toContain('Secure');
      expect(cookieOf(cb, 'attn_oauth_state')).toContain('Secure');
    } finally {
      await app.close();
    }
  });

  it('re-login with a changed profile updates the user and adds a session', async () => {
    for (const round of [1, 2]) {
      if (round === 2) {
        fake.setRoute('/user', {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: 4242, login: 'octocat2', name: 'New Name', avatar_url: 'https://avatars.example/n.png' }),
        });
      }
      const { state } = await begin();
      const res = await callback(`code=good-code&state=${state}`, `attn_oauth_state=${state}`);
      expect(res.headers.get('location')).toBe(`${LANDING}/all`);
    }
    const rows = await ctx.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ login: 'octocat2', name: 'New Name', avatarUrl: 'https://avatars.example/n.png' });
    expect(await ctx.db.select().from(sessions)).toHaveLength(2);
  });

  it('state mismatch -> state_mismatch, no rows, token endpoint untouched', async () => {
    const { state } = await begin();
    const res = await callback(`code=good-code&state=${state}`, 'attn_oauth_state=something-else');
    expectFailure(res, 'state_mismatch');
    expect(await counts()).toEqual({ users: 0, sessions: 0 });
    expect(fake.hits('/login/oauth/access_token')).toBe(0);
  });

  it('missing state cookie, and missing state query -> state_mismatch', async () => {
    const { state } = await begin();
    expectFailure(await callback(`code=good-code&state=${state}`), 'state_mismatch');
    expectFailure(await callback('code=good-code', `attn_oauth_state=${state}`), 'state_mismatch');
    expect(await counts()).toEqual({ users: 0, sessions: 0 });
    expect(fake.hits('/login/oauth/access_token')).toBe(0);
  });

  it('session fixation: an existing session is destroyed on login', async () => {
    const other = await seedUser(ctx.db);
    const svc = ctx.moduleRef.get(SessionService, { strict: false });
    const { token: oldToken } = await svc.create(other.id);
    const { state } = await begin();
    const res = await callback(
      `code=good-code&state=${state}`,
      `attn_oauth_state=${state}; attn_session=${oldToken}`,
    );
    expect(res.headers.get('location')).toBe(`${LANDING}/all`);
    const rows = await ctx.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(hashToken(oldToken));
    const newUser = (await ctx.db.select().from(users)).find((u) => u.githubId === 4242)!;
    expect(rows[0]!.userId).toBe(newUser.id);
    const me = await fetch(`${ctx.base}/api/me`, { headers: { cookie: `attn_session=${oldToken}` } });
    expect(me.status).toBe(401);
  });

  it('a garbage old session cookie does not break login', async () => {
    const { state } = await begin();
    const res = await callback(`code=good-code&state=${state}`, `attn_oauth_state=${state}; attn_session=garbage%E0%A4%A`);
    expect(res.headers.get('location')).toBe(`${LANDING}/all`);
    expect(await counts()).toEqual({ users: 1, sessions: 1 });
  });

  it('replay without the cleared cookie -> state_mismatch, no second user or session', async () => {
    const { state } = await begin();
    const ok = await callback(`code=good-code&state=${state}`, `attn_oauth_state=${state}`);
    expect(ok.headers.get('location')).toBe(`${LANDING}/all`);
    expectFailure(await callback(`code=good-code&state=${state}`), 'state_mismatch');
    expect(await counts()).toEqual({ users: 1, sessions: 1 });
  });

  it('error=access_denied -> access_denied, state cleared, token endpoint untouched', async () => {
    const { state } = await begin();
    expectFailure(await callback(`error=access_denied&state=${state}`, `attn_oauth_state=${state}`), 'access_denied');
    expect(fake.hits('/login/oauth/access_token')).toBe(0);
  });

  it('unknown code -> oauth_failed', async () => {
    const { state } = await begin();
    expectFailure(await callback(`code=bad&state=${state}`, `attn_oauth_state=${state}`), 'oauth_failed');
    expect(await counts()).toEqual({ users: 0, sessions: 0 });
  });

  it('missing code with valid state -> oauth_failed', async () => {
    const { state } = await begin();
    expectFailure(await callback(`state=${state}`, `attn_oauth_state=${state}`), 'oauth_failed');
  });

  it('GitHub /user 500 -> oauth_failed', async () => {
    fake.setRoute('/user', { status: 500, body: 'x' });
    const { state } = await begin();
    expectFailure(await callback(`code=good-code&state=${state}`, `attn_oauth_state=${state}`), 'oauth_failed');
    expect(await counts()).toEqual({ users: 0, sessions: 0 });
  });

  it('non-JSON token response -> oauth_failed', async () => {
    fake.setRoute('/login/oauth/access_token', { body: '<html>' });
    const { state } = await begin();
    expectFailure(await callback(`code=good-code&state=${state}`, `attn_oauth_state=${state}`), 'oauth_failed');
  });

  it('unreachable GitHub -> oauth_failed quickly, not a 500', async () => {
    const app = await startTestApp({ ...appOpts(), githubOauthBaseUrl: 'http://127.0.0.1:1' });
    try {
      const { state } = await begin(app.base);
      const t0 = Date.now();
      const res = await callback(`code=good-code&state=${state}`, `attn_oauth_state=${state}`, app.base);
      expect(Date.now() - t0).toBeLessThan(5000);
      expectFailure(res, 'oauth_failed');
    } finally {
      await app.close();
    }
  });

  it('every error code used by the api is a known AuthErrorCode', () => {
    for (const c of ['not_configured', 'state_mismatch', 'access_denied', 'oauth_failed']) {
      expect(AUTH_ERROR_CODES).toContain(c);
    }
  });
});
