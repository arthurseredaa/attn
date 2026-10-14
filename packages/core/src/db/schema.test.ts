import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb, testDb } from '../test/db';
import type { Db } from './client';
import { articleEvents, articleSkills, articles, sessions, userSkills, users } from './schema';

let db: Db;

beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});

function article(over: Partial<typeof articles.$inferInsert> = {}): typeof articles.$inferInsert {
  return {
    sourceId: 's',
    url: 'https://example.com/a',
    guid: 'g1',
    title: 'T',
    titleHash: 'h',
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

async function insertUser(githubId = 1) {
  const [u] = await db.insert(users).values({ githubId, login: `u${githubId}` }).returning();
  return u!;
}

async function insertArticle(over: Partial<typeof articles.$inferInsert> = {}) {
  const [a] = await db.insert(articles).values(article(over)).returning();
  return a!;
}

async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code;
  }
  return undefined;
}

describe('schema constraints', () => {
  it('rejects two articles with the same url', async () => {
    await insertArticle();
    const p = db.insert(articles).values(article({ guid: 'g2' }));
    await expect(p).rejects.toThrow();
    expect(await pgCode(db.insert(articles).values(article({ guid: 'g3' })))).toBe('23505');
  });

  it('rejects two primary skills for the same article', async () => {
    const a = await insertArticle();
    await db.insert(articleSkills).values({ articleId: a.id, skillId: 'x', isPrimary: true });
    const p = db.insert(articleSkills).values({ articleId: a.id, skillId: 'y', isPrimary: true });
    await expect(p).rejects.toThrow();
    expect(
      await pgCode(db.insert(articleSkills).values({ articleId: a.id, skillId: 'z', isPrimary: true })),
    ).toBe('23505');
  });

  it('allows a non-primary skill next to a primary one', async () => {
    const a = await insertArticle();
    await db.insert(articleSkills).values({ articleId: a.id, skillId: 'x', isPrimary: true });
    await db.insert(articleSkills).values({ articleId: a.id, skillId: 'y', isPrimary: false });
    expect(await db.select().from(articleSkills)).toHaveLength(2);
  });

  it('rejects difficulty 5', async () => {
    const p = db.insert(articles).values(article({ difficulty: 5 }));
    await expect(p).rejects.toThrow();
    expect(await pgCode(db.insert(articles).values(article({ difficulty: 5 })))).toBe('23514');
  });

  it('rejects a duplicate (user, article, kind) event', async () => {
    const u = await insertUser();
    const a = await insertArticle();
    await db.insert(articleEvents).values({ userId: u.id, articleId: a.id, kind: 'like' });
    const p = db.insert(articleEvents).values({ userId: u.id, articleId: a.id, kind: 'like' });
    await expect(p).rejects.toThrow();
    expect(
      await pgCode(db.insert(articleEvents).values({ userId: u.id, articleId: a.id, kind: 'like' })),
    ).toBe('23505');
    await db.insert(articleEvents).values({ userId: u.id, articleId: a.id, kind: 'read' });
  });

  it('cascades user deletion to sessions and user_skills', async () => {
    const u = await insertUser();
    await db.insert(sessions).values({ id: 'tok', userId: u.id, expiresAt: new Date(Date.now() + 1e6) });
    await db.insert(userSkills).values({ userId: u.id, skillId: 'x' });
    await db.delete(users).where(eq(users.id, u.id));
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(await db.select().from(userSkills)).toHaveLength(0);
  });

  it('resetDb leaves tables empty and restarts identity', async () => {
    const u = await insertUser();
    const a = await insertArticle();
    await db.insert(articleEvents).values({ userId: u.id, articleId: a.id, kind: 'read' });
    await resetDb(db);
    expect(await db.select().from(users)).toHaveLength(0);
    expect(await db.select().from(articles)).toHaveLength(0);
    expect(await db.select().from(articleEvents)).toHaveLength(0);
    expect((await insertArticle()).id).toBe(1);
  });
});
