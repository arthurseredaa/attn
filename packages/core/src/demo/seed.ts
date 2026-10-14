import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { taxonomySkillIds, type ArticleType, type Taxonomy } from '@attn/shared';
import { articleSkills, articles } from '../db/schema';
import type { Db } from '../db/client';

export const DEMO_LABEL_MODEL = 'demo-seed';

const QUALITY = [4, 3, 2, 4, 3] as const;
const TYPES: readonly ArticleType[] = ['tutorial', 'release', 'deep_dive', 'news', 'research'];
const DAY = 86_400_000;

export interface SeedDemoOptions {
  taxonomy: Taxonomy;
  sourceIds: string[];
  now: Date;
  perSkill?: number;
}

/** Deterministic labeled articles for local use without a labeling key; idempotent on url. */
export async function seedDemoArticles(db: Db, opts: SeedDemoOptions): Promise<{ inserted: number }> {
  const { taxonomy, sourceIds, now, perSkill = 5 } = opts;
  if (sourceIds.length === 0) throw new Error('seedDemoArticles needs at least one source id');
  const skillIds = taxonomySkillIds(taxonomy);
  const names = new Map(taxonomy.domains.flatMap((d) => d.skills.map((s) => [s.id, s.name] as const)));

  const rows: (typeof articles.$inferInsert)[] = [];
  const skillsByUrl = new Map<string, { primary: string; secondary?: string }>();
  let seq = 0;
  for (const [skillIndex, skillId] of skillIds.entries()) {
    for (let n = 1; n <= perSkill; n++) {
      const url = `https://example.com/demo/${skillId}/${n}`;
      const type = TYPES[(n - 1) % TYPES.length]!;
      const fastType = type === 'release' || type === 'news';
      const ageDays = fastType
        ? skillIndex % 2 === 1
          ? 3 + (skillIndex % 7)
          : 30 + skillIndex
        : 20 * n + skillIndex;
      const title = `Demo: ${names.get(skillId) ?? skillId} #${n}`;
      rows.push({
        sourceId: sourceIds[seq++ % sourceIds.length]!,
        url,
        guid: url,
        title,
        titleHash: createHash('sha256').update(title).digest('hex'),
        publishedAt: new Date(now.getTime() - ageDays * DAY),
        wordCount: 400 + 150 * n,
        labelStatus: 'labeled',
        difficulty: (n + skillIndex) % 5,
        type,
        quality: QUALITY[(n - 1) % QUALITY.length]!,
        labelModel: DEMO_LABEL_MODEL,
        labeledAt: now,
        taxonomyVersion: taxonomy.version,
      });
      skillsByUrl.set(url, {
        primary: skillId,
        ...(n >= 2 ? { secondary: skillIds[(skillIndex + 1) % skillIds.length]! } : {}),
      });
    }
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const created = await db
      .insert(articles)
      .values(chunk)
      .onConflictDoNothing({ target: articles.url })
      .returning({ id: articles.id, url: articles.url });
    inserted += created.length;
    const skillRows = created.flatMap((a) => {
      const s = skillsByUrl.get(a.url)!;
      return [
        { articleId: a.id, skillId: s.primary, isPrimary: true },
        ...(s.secondary && s.secondary !== s.primary ? [{ articleId: a.id, skillId: s.secondary, isPrimary: false }] : []),
      ];
    });
    if (skillRows.length > 0) await db.insert(articleSkills).values(skillRows);
  }
  return { inserted };
}

export async function removeDemoArticles(db: Db): Promise<{ removed: number }> {
  const gone = await db.delete(articles).where(eq(articles.labelModel, DEMO_LABEL_MODEL)).returning({ id: articles.id });
  return { removed: gone.length };
}
