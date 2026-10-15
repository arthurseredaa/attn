import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import { normalizeLabel, type Config } from '@attn/shared';
import type { FetchFn } from '../collect/http';
import { articleSkills, articles, type Db } from '../db';
import { fetchArticleText, limitText } from '../extract';
import { labelWithOverloadRetry, makePublicArticle, FatalLabelerError, RateLimitError, type Labeler } from '../label';

export interface LabelOptions {
  db: Db;
  labeler: Labeler;
  config: Pick<
    Config,
    'label_batch' | 'relevance_threshold' | 'label_delay_ms' | 'label_max_chars' | 'label_min_chars' | 'label_max_attempts' | 'label_overload_backoff_ms'
  >;
  taxonomyVersion: number;
  fetchFn?: FetchFn;
  timeoutMs?: number;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
  limit?: number;
  /** One line per article the relevance gate excludes (id, title, p). Defaults to nothing; the CLI prints it. */
  log?: (line: string) => void;
}

export interface LabelItemReport {
  id: number;
  url: string;
  outcome: 'labeled' | 'failed' | 'rate_limited' | 'excluded';
  error?: string;
}

export interface LabelReport {
  selected: number;
  labeled: number;
  failed: number;
  /** Articles the relevance gate marked excluded instead of labeling. */
  excluded: number;
  rateLimited: boolean;
  /** Set when the provider rejected the credentials or model id; the run stopped without touching that article. */
  fatal?: string;
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

  const report: LabelReport = { selected: rows.length, labeled: 0, failed: 0, excluded: 0, rateLimited: false, items: [] };

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
    let relevance;
    try {
      if (calledLabeler) await sleep(config.label_delay_ms);
      calledLabeler = true;
      const article = makePublicArticle({ title: row.title, url: row.url, text });
      const result = await labelWithOverloadRetry(labeler, article, config.label_overload_backoff_ms, sleep);
      relevance = result.relevance;
      label = normalizeLabel(result);
    } catch (e) {
      if (e instanceof FatalLabelerError) {
        report.fatal = e.message;
        break;
      }
      if (e instanceof RateLimitError) {
        report.rateLimited = true;
        report.items.push({ id: row.id, url: row.url, outcome: 'rate_limited', error: e.message });
        break;
      }
      await fail(row, messageOf(e));
      continue;
    }

    // Relevance gate: exclude when the labeler gave a probability below the threshold. No answer = relevant.
    if (relevance?.probability != null && relevance.probability < config.relevance_threshold) {
      const p = relevance.probability;
      try {
        await db
          .update(articles)
          .set({ labelStatus: 'excluded', excludedReason: `not relevant (p=${p.toFixed(2)})`, excludedAt: now, labelModel: labeler.model })
          .where(eq(articles.id, row.id));
        opts.log?.(`excluded  id=${row.id}  p=${p.toFixed(2)}  ${row.title}  ${row.url}`);
        report.excluded++;
        report.items.push({ id: row.id, url: row.url, outcome: 'excluded' });
      } catch (e) {
        await fail(row, messageOf(e));
      }
      continue;
    }

    try {
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
    } catch (e) {
      await fail(row, messageOf(e));
    }
  }
  return report;
}
