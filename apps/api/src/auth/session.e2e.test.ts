import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessions } from '@attn/core';
import { resetDb } from '@attn/core/testing';
import { meSchema } from '@attn/shared';
import { startTestApp, type TestApp } from '../test/app';
import { seedUser } from '../test/seed';
import { SESSION_TTL_MS, hashToken } from './session';
import { SessionService } from './session.service';

let ctx: TestApp;
let svc: SessionService;

beforeEach(async () => {
  ctx = await startTestApp();
  await resetDb(ctx.db);
  svc = ctx.moduleRef.get(SessionService, { strict: false });
});

afterEach(async () => {
  await ctx.close();
});

const cookie = (token: string) => ({ cookie: `attn_session=${token}` });

describe('GET /api/me', () => {
  it('401 without a cookie', async () => {
    const res = await fetch(`${ctx.base}/api/me`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized', message: 'Sign in required' });
  });

  it('returns the user for a valid session, uncached', async () => {
    const user = await seedUser(ctx.db);
    const { token } = await svc.create(user.id);
    const res = await fetch(`${ctx.base}/api/me`, { headers: cookie(token) });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = meSchema.parse(await res.json());
    expect(body).toEqual({ id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl, role: 'dev' });
  });

  it('401 for garbage and never-issued tokens', async () => {
    for (const t of ['garbage', '%E0%A4%A', 'A'.repeat(43)]) {
      const res = await fetch(`${ctx.base}/api/me`, { headers: cookie(t) });
      expect(res.status).toBe(401);
    }
  });

  it('401 for an expired session', async () => {
    const user = await seedUser(ctx.db);
    const t = 'expired-token';
    await ctx.db.insert(sessions).values({ id: hashToken(t), userId: user.id, expiresAt: new Date(Date.now() - 60_000) });
    const res = await fetch(`${ctx.base}/api/me`, { headers: cookie(t) });
    expect(res.status).toBe(401);
  });
});

describe('SessionService', () => {
  it('stores only the hash and a 30-day expiry', async () => {
    const user = await seedUser(ctx.db);
    const { token, expiresAt } = await svc.create(user.id);
    const rows = await ctx.db.select().from(sessions);
    expect(rows.map((r) => r.id)).toEqual([hashToken(token)]);
    expect(rows[0]?.id).not.toBe(token);
    expect(Math.abs(expiresAt.getTime() - (Date.now() + SESSION_TTL_MS))).toBeLessThan(5000);
    expect(Math.abs((rows[0]?.expiresAt.getTime() ?? 0) - (Date.now() + SESSION_TTL_MS))).toBeLessThan(5000);
  });

  it('purgeExpired deletes expired rows only and returns the count', async () => {
    const user = await seedUser(ctx.db);
    const past = new Date(Date.now() - 60_000);
    await ctx.db.insert(sessions).values([
      { id: hashToken('e1'), userId: user.id, expiresAt: past },
      { id: hashToken('e2'), userId: user.id, expiresAt: past },
    ]);
    const { token } = await svc.create(user.id);
    expect(await svc.purgeExpired()).toBe(2);
    const rows = await ctx.db.select().from(sessions);
    expect(rows.map((r) => r.id)).toEqual([hashToken(token)]);
  });
});

describe('POST /api/auth/logout', () => {
  it('deletes the session, clears the cookie and invalidates /me', async () => {
    const user = await seedUser(ctx.db);
    const { token } = await svc.create(user.id);
    const res = await fetch(`${ctx.base}/api/auth/logout`, { method: 'POST', headers: cookie(token) });
    expect(res.status).toBe(204);
    expect(await ctx.db.select().from(sessions)).toEqual([]);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('attn_session=;');
    expect(setCookie).toMatch(/Max-Age=0|Expires=\w{3}, \d{2} \w{3} 1970/);
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    const me = await fetch(`${ctx.base}/api/me`, { headers: cookie(token) });
    expect(me.status).toBe(401);
  });

  it('clearing cookie carries HttpOnly, Secure, SameSite=Lax and Path=/ with the production default', async () => {
    const app = await startTestApp({ cookieSecure: true });
    try {
      const res = await fetch(`${app.base}/api/auth/logout`, { method: 'POST', headers: cookie('whatever') });
      expect(res.status).toBe(204);
      const setCookie = res.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('attn_session=;');
      for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(setCookie).toContain(attr);
      expect(setCookie).not.toContain('Path=/api');
    } finally {
      await app.close();
    }
  });

  it('is idempotent: twice, and without a cookie', async () => {
    const user = await seedUser(ctx.db);
    const { token } = await svc.create(user.id);
    for (const headers of [cookie(token), cookie(token), {}]) {
      const res = await fetch(`${ctx.base}/api/auth/logout`, { method: 'POST', headers });
      expect(res.status).toBe(204);
    }
  });

  it("only removes the current session, not the user's others", async () => {
    const user = await seedUser(ctx.db);
    const a = await svc.create(user.id);
    const b = await svc.create(user.id);
    await fetch(`${ctx.base}/api/auth/logout`, { method: 'POST', headers: cookie(a.token) });
    expect((await fetch(`${ctx.base}/api/me`, { headers: cookie(a.token) })).status).toBe(401);
    expect((await fetch(`${ctx.base}/api/me`, { headers: cookie(b.token) })).status).toBe(200);
  });
});
