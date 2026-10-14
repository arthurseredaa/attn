import { Inject, Injectable } from '@nestjs/common';
import { sessions, users, type Db } from '@attn/core';
import { and, eq, gt, lt } from 'drizzle-orm';
import { DB } from '../tokens';
import { SESSION_TTL_MS, generateToken, hashToken, type AuthUser } from './session';

@Injectable()
export class SessionService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
    return { token, expiresAt };
  }

  async findUser(token: string): Promise<AuthUser | null> {
    const [row] = await this.db
      .select({ id: users.id, login: users.login, name: users.name, avatarUrl: users.avatarUrl, role: users.role })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return row ?? null;
  }

  async destroy(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }

  async purgeExpired(): Promise<number> {
    const rows = await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id });
    return rows.length;
  }
}
