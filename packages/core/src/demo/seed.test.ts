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

const sourceIds = ['a', 'b'];
const seed = () => seedDemoArticles(db, { taxonomy, sourceIds, now });
// The ranker only serves configured sources, so it gets the demo's.
const demoSources = sourceIds.map((id) => ({ ...rankSources[0]!, id, name: id }));

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

  it('pins the attribute tables exactly', async () => {
    await seed();
    const rows = await db.select().from(articles);
    const QUALITY = [4, 3, 2, 4, 3];
    const TYPES = ['tutorial', 'release', 'deep_dive', 'news', 'research'];
    const names = new Map(taxonomy.domains.flatMap((d) => d.skills.map((s) => [s.id, s.name] as const)));
    for (const i of [0, 1, 2, 7, 30, 31]) {
      const id = skills[i]!;
      for (let n = 1; n <= 5; n++) {
        const r = rows.find((x) => x.url === `https://example.com/demo/${id}/${n}`)!;
        expect(r, `${id}/${n}`).toBeDefined();
        expect(r.title).toBe(`Demo: ${names.get(id)} #${n}`);
        expect(r.wordCount).toBe(400 + 150 * n);
        expect(r.taxonomyVersion).toBe(taxonomy.version);
        expect(r.labelStatus).toBe('labeled');
        expect(r.difficulty).toBe((n + i) % 5);
        expect(r.quality).toBe(QUALITY[n - 1]);
        expect(r.type).toBe(TYPES[n - 1]);
        const fast = r.type === 'release' || r.type === 'news';
        const days = fast ? (i % 2 === 1 ? 3 + (i % 7) : 30 + i) : 20 * n + i;
        expect(r.publishedAt.getTime()).toBe(now.getTime() - days * DAY);
      }
    }
  });

  it('cycles source ids', async () => {
    await seed();
    const rows = (await db.select().from(articles)).sort((a, b) => a.id - b.id);
    expect(rows.slice(0, 4).map((r) => r.sourceId)).toEqual(['a', 'b', 'a', 'b']);
  });

  it('secondary skills: none for n=1, next skill otherwise, wrapping at the end', async () => {
    await seed();
    const rows = await db.select().from(articles);
    const sk = await db.select().from(articleSkills);
    for (const i of [0, 5, skills.length - 2, skills.length - 1]) {
      for (let n = 1; n <= 5; n++) {
        const r = rows.find((x) => x.url === `https://example.com/demo/${skills[i]}/${n}`)!;
        const mine = sk.filter((s) => s.articleId === r.id);
        expect(mine.filter((s) => s.isPrimary).map((s) => s.skillId)).toEqual([skills[i]]);
        expect(mine.filter((s) => !s.isPrimary).map((s) => s.skillId)).toEqual(
          n === 1 ? [] : [skills[(i + 1) % skills.length]],
        );
      }
    }
  });

  it('never repeats the primary as secondary', async () => {
    await seed();
    const sk = await db.select().from(articleSkills);
    const pairs = sk.map((s) => `${s.articleId}:${s.skillId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(sk).toHaveLength(160 + 128);
  });

  it('feeds the ranker for an onboarded user', async () => {
    await seed();
    const u = await makeUser(db);
    for (const [i, s] of skills.entries()) {
      await giveSkill(db, u, s, i === 0 ? { focusRank: 1, level: 2, uncertain: false } : {});
    }
    const ranker = createSqlRanker(db, { config: rankConfig, sources: demoSources, taxonomy, now: () => now });
    const cards = await ranker.rank(u, { limit: 20, offset: 0 });
    expect(cards.length).toBeGreaterThan(0);
    const primary = (c: (typeof cards)[number]) => c.skills.find((k) => k.isPrimary)!.id;
    expect(cards.every((c) => skills.includes(primary(c)))).toBe(true);
    expect(cards.every((c) => c.quality >= 2)).toBe(true);
    // focus skill 0, level 2 certain: t = 2, band {2, 3}
    const focus = cards.filter((c) => primary(c) === skills[0]);
    expect(focus.length).toBeGreaterThan(0);
    expect(focus.every((c) => c.difficulty === 2 || c.difficulty === 3)).toBe(true);
    for (const c of cards) {
      if (c.type === 'release' || c.type === 'news') {
        expect((now.getTime() - Date.parse(c.publishedAt)) / DAY).toBeLessThanOrEqual(14);
      }
    }
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
