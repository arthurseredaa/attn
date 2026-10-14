import type { users } from '@attn/core';
import { SESSION_COOKIE } from '../auth/session';
import { SessionService } from '../auth/session.service';
import type { TestApp } from './app';
import { seedUser } from './seed';

/** Seeds a user, opens a session for it and returns the cookie header to send. */
export async function signIn(ctx: TestApp, over: Partial<typeof users.$inferInsert> = {}) {
  const user = await seedUser(ctx.db, over);
  const { token } = await ctx.moduleRef.get(SessionService, { strict: false }).create(user.id);
  return { user, token, headers: { cookie: `${SESSION_COOKIE}=${token}` } };
}
