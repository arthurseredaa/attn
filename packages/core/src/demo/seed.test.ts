import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { taxonomySkillIds } from '@attn/shared';
import { loadTaxonomy } from '../data';
import type { Db } from '../db/client';
import { articleSkills, articles } from '../db/schema';
import { resetDb, testDb } from '../test/db';
import { giveSkill, makeArticle, makeUser, rankConfig, rankSources } from '../rank/fixtures';
import { createSqlRanker } from '../rank/sql';
import { removeDemoArticles, seedDemoArticles } from './seed';

const taxonomy = loadTaxonomy();
const skills = taxonomySkillIds(taxonomy);
const now = new Date('2026-10-14T12:00:00Z');
const DAY = 86_400_000;
let db: Db;

beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
});

const seed = () => seedDemoArticles(db, { taxonomy, sourceIds: ['a', 'b'], now });

describe('seedDemoArticles', () => {
  it('inserts labeled demo articles with one primary skill each', async () => {
    expect(await seed()).toEqual({ inserted: skills.length * 5 });
    const rows = await db.select().from(articles);
    expect(rows).toHaveLength(160);
    expect(rows.every((r) => r.labelStatus === 'labeled' && r.labelModel === 'demo-seed')).toBe(true);
    expect(new Set(rows.map((r) => r.url)).size).toBe(160);
    expect(rows.every((r) => r.url.startsWith('https://example.com/demo/'))).toBe(true);
    const sk = await db.select().from(articleSkills);
    const primaries = sk.filter((s) => s.isPrimary);
    expect(primaries).toHaveLength(160);
    expect(new Set(primaries.map((p) => p.articleId)).size).toBe(160);
    for (const id of skills) expect(primaries.filter((p) => p.skillId === id)).toHaveLength(5);
  });

  it('is idempotent', async () => {
    await seed();
    expect(await seed()).toEqual({ inserted: 0 });
    expect(await db.select().from(articles)).toHaveLength(160);
  });

  it('spreads difficulty, quality, type and age', async () => {
    await seed();
    const rows = await db.select().from(articles);
    expect(new Set(rows.map((r) => r.difficulty))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(new Set(rows.map((r) => r.quality))).toEqual(new Set([2, 3, 4]));
    expect(new Set(rows.map((r) => r.type))).toEqual(new Set(['tutorial', 'release', 'deep_dive', 'news', 'research']));
    const fast = rows.filter((r) => r.type === 'release' || r.type === 'news');
    const age = (r: (typeof rows)[number]) => (now.getTime() - r.publishedAt.getTime()) / DAY;
    expect(fast.some((r) => age(r) > 14)).toBe(true);
    expect(fast.some((r) => age(r) <= 14)).toBe(true);
    expect(rows.every((r) => r.quality! >= 2)).toBe(true);
  });

  it('wraps the last skill secondary to the first and never repeats the primary', async () => {
    await seed();
    const rows = await db.select().from(articles);
    const sk = await db.select().from(articleSkills);
    const last = skills[skills.length - 1]!;
    const lastIds = sk.filter((s) => s.isPrimary && s.skillId === last).map((s) => s.articleId);
    for (const r of rows.filter((x) => lastIds.includes(x.id) && /\/([2-5])$/.test(x.url))) {
      expect(sk.filter((s) => s.articleId === r.id && !s.isPrimary).map((s) => s.skillId)).toEqual([skills[0]]);
    }
    for (const r of rows) {
      const mine = sk.filter((s) => s.articleId === r.id);
      expect(new Set(mine.map((s) => s.skillId)).size).toBe(mine.length);
    }
  });

  it('feeds the ranker for an onboarded user', async () => {
    await seed();
    const u = await makeUser(db);
    for (const [i, s] of skills.entries()) {
      await giveSkill(db, u, s, i === 0 ? { focusRank: 1, level: 2, uncertain: false } : {});
    }
    const ranker = createSqlRanker(db, { config: rankConfig, sources: rankSources, taxonomy, now: () => now });
    const cards = await ranker.rank(u, { limit: 20, offset: 0 });
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.skills.some((k) => k.isPrimary && skills.includes(k.id)))).toBe(true);
    expect(cards.every((c) => c.quality >= 2)).toBe(true);
  });
});

describe('removeDemoArticles', () => {
  it('removes only demo rows', async () => {
    await seed();
    const keep = await makeArticle(db, { primary: skills[0]! });
    expect(await removeDemoArticles(db)).toEqual({ removed: 160 });
    const left = await db.select().from(articles);
    expect(left.map((r) => r.id)).toEqual([keep]);
    expect(await db.select().from(articleSkills)).toHaveLength(1);
  });
});

it('does not import labeling, eval or extraction code', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'seed.ts'), 'utf8');
  expect(src).not.toMatch(/from '\.\.\/(label|eval|extract)\b/);
});
