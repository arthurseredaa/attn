import { beforeEach, describe, expect, it } from 'vitest';
import { loadTaxonomy } from '../data';
import type { Db } from '../db';
import { resetDb, testDb } from '../test/db';
import { giveSkill, makeArticle, makeUser, RANK_NOW, rankConfig, rankSources } from './fixtures';
import { createSqlRanker } from './sql';

const taxonomy = loadTaxonomy();
const [S1, S2, S3] = taxonomy.domains.flatMap((d) => d.skills.map((s) => s.id)) as [string, string, string];
const SAME = new Date(RANK_NOW.getTime() - 86_400_000);

let db: Db;
let u: string;
let ranker: ReturnType<typeof createSqlRanker>;

beforeEach(async () => {
  db = await testDb();
  await resetDb(db);
  u = await makeUser(db);
  await giveSkill(db, u, S1, { focusRank: 1 });
  await giveSkill(db, u, S2, { focusRank: 2 });
  ranker = createSqlRanker(db, { config: rankConfig, sources: rankSources, taxonomy, now: () => RANK_NOW });
});

const ids = async (p: { skills?: string[]; q?: string; limit?: number; offset?: number } = {}) =>
  (await ranker.rank(u, { limit: p.limit ?? 100, offset: p.offset ?? 0, skills: p.skills, q: p.q }))
    .map((c) => c.id)
    .sort((a, b) => a - b);

describe('rank filters', () => {
  it('skills match any of the article skills, primary or secondary', async () => {
    const a = await makeArticle(db, { primary: S1 });
    const b = await makeArticle(db, { primary: S2, secondary: [S3] });
    const c = await makeArticle(db, { primary: S2 });
    expect(await ids()).toEqual([a, b, c]);
    expect(await ids({ skills: [S1] })).toEqual([a]);
    expect(await ids({ skills: [S3] })).toEqual([b]); // secondary only
    expect(await ids({ skills: [S1, S3] })).toEqual([a, b]); // any-match
    expect(await ids({ skills: [] })).toEqual([a, b, c]);
  });

  it('q is a case-insensitive title substring', async () => {
    const a = await makeArticle(db, { primary: S1, title: 'Building RAG Pipelines' });
    await makeArticle(db, { primary: S1, title: 'Fine-tuning basics' });
    expect(await ids({ q: 'rag pipe' })).toEqual([a]);
    expect(await ids({ q: 'nothing like this' })).toEqual([]);
  });

  it('q treats % _ and backslash literally', async () => {
    const a = await makeArticle(db, { primary: S1, title: '100% accuracy' });
    const b = await makeArticle(db, { primary: S1, title: 'snake_case naming' });
    const c = await makeArticle(db, { primary: S1, title: 'path C:\\temp' });
    await makeArticle(db, { primary: S1, title: 'plain title' });
    expect(await ids({ q: '%' })).toEqual([a]);
    expect(await ids({ q: '_' })).toEqual([b]);
    expect(await ids({ q: '\\' })).toEqual([c]);
    expect(await ids({ q: "'; drop table articles; --" })).toEqual([]);
  });

  it('skills and q combine with AND', async () => {
    await makeArticle(db, { primary: S1, title: 'Agents in practice' });
    const b = await makeArticle(db, { primary: S2, title: 'Agents at scale' });
    await makeArticle(db, { primary: S2, title: 'Embeddings' });
    expect(await ids({ skills: [S2], q: 'agents' })).toEqual([b]);
  });

  it('filters apply before paging: pages concatenate to the filtered order', async () => {
    for (let i = 0; i < 25; i++) {
      await makeArticle(db, {
        primary: i % 2 ? S1 : S2,
        title: i % 3 ? `Topic ${i}` : `Other ${i}`,
        difficulty: 2 + (i % 2),
        quality: 2 + (i % 3),
        publishedAt: new Date(SAME.getTime() - i * 3_600_000),
      });
    }
    const f = { skills: [S1], q: 'topic' };
    const order = async (limit: number, offset: number) =>
      (await ranker.rank(u, { limit, offset, ...f })).map((c) => c.id);
    const full = await order(100, 0);
    expect(full.length).toBeGreaterThan(5);
    const got = [...(await order(5, 0)), ...(await order(5, 5)), ...(await order(5, 10)), ...(await order(5, 15))];
    expect(got).toEqual(full);
    expect(new Set(got).size).toBe(got.length);
  });
});
