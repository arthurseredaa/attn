import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import { normalizeLabel, type Config } from '@attn/shared';
import type { FetchFn } from '../collect/http';
import { articleSkills, articles, type Db } from '../db';
import { fetchArticleText, limitText } from '../extract';
import { makePublicArticle, RateLimitError, type Labeler } from '../label';

export interface LabelOptions {
  db: Db;
  labeler: Labeler;
  config: Pick<Config, 'label_batch' | 'label_delay_ms' | 'label_max_chars' | 'label_min_chars' | 'label_max_attempts'>;
  taxonomyVersion: number;
  fetchFn?: FetchFn;
  timeoutMs?: number;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
  limit?: number;
}

export interface LabelItemReport {
  id: number;
  url: string;
  outcome: 'labeled' | 'failed' | 'rate_limited';
  error?: string;
}

export interface LabelReport {
  selected: number;
  labeled: number;
  failed: number;
  rateLimited: boolean;
  items: LabelItemReport[];
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function labelPending(opts: LabelOptions): Promise<LabelReport> {
  const { db, labeler, config, taxonomyVersion } = opts;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? new Date();
  const batch = Math.min(config.label_batch, opts.limit ?? config.label_batch);

  const rows = await db
    .select({ id: articles.id, url: articles.url, title: articles.title })
    .from(articles)
    .where(
      or(
        eq(articles.labelStatus, 'pending'),
        and(eq(articles.labelStatus, 'failed'), lt(articles.labelAttempts, config.label_max_attempts)),
      ),
    )
    .orderBy(asc(articles.publishedAt), asc(articles.id))
    .limit(batch);

  const report: LabelReport = { selected: rows.length, labeled: 0, failed: 0, rateLimited: false, items: [] };

  const fail = async (row: { id: number; url: string }, error: string): Promise<void> => {
    await db
      .update(articles)
      .set({ labelStatus: 'failed', labelAttempts: sql`${articles.labelAttempts} + 1` })
      .where(eq(articles.id, row.id));
    report.failed++;
    report.items.push({ id: row.id, url: row.url, outcome: 'failed', error });
  };

  let calledLabeler = false;
  for (const row of rows) {
    let text: string;
    try {
      const extracted = await fetchArticleText(row.url, { fetchFn: opts.fetchFn, timeoutMs: opts.timeoutMs });
      await db.update(articles).set({ wordCount: extracted.wordCount }).where(eq(articles.id, row.id));
      text = limitText(extracted.text, { minChars: config.label_min_chars, maxChars: config.label_max_chars });
    } catch (e) {
      await fail(row, messageOf(e));
      continue;
    }

    let label;
    try {
      if (calledLabeler) await sleep(config.label_delay_ms);
      calledLabeler = true;
      label = normalizeLabel(await labeler.label(makePublicArticle({ title: row.title, url: row.url, text })));
    } catch (e) {
      if (e instanceof RateLimitError) {
        report.rateLimited = true;
        report.items.push({ id: row.id, url: row.url, outcome: 'rate_limited', error: e.message });
        break;
      }
      await fail(row, messageOf(e));
      continue;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(articles)
        .set({
          labelStatus: 'labeled',
          difficulty: label.difficulty,
          type: label.type,
          quality: label.quality,
          labelModel: labeler.model,
          labeledAt: now,
          taxonomyVersion,
        })
        .where(eq(articles.id, row.id));
      await tx.delete(articleSkills).where(eq(articleSkills.articleId, row.id));
      await tx.insert(articleSkills).values([
        { articleId: row.id, skillId: label.primary_skill, isPrimary: true },
        ...label.secondary_skills.map((skillId) => ({ articleId: row.id, skillId, isPrimary: false })),
      ]);
    });
    report.labeled++;
    report.items.push({ id: row.id, url: row.url, outcome: 'labeled' });
  }
  return report;
}
