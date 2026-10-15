import type { Config, Source } from '@attn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { articles } from '../db/schema';
import { isDuplicate, urlExists, type Candidate } from './dedup';
import { exclusionRule, passesFilter, passesPathFilter } from './filter';
import { conditionalGet, getText, type FetchFn } from './http';
import { normalizeUrl, titleHash } from './normalize';
import { parseFeed } from './parse-feed';
import { parsePageTitle } from './parse-page';
import { isSitemapIndex, parseSitemap, parseSitemapIndex } from './parse-sitemap';
import { getState, recordFailure, recordSuccess } from './state';
import type { RawEntry } from './types';

export interface SourceReport {
  sourceId: string;
  status: 'ok' | 'not_modified' | 'error';
  /** entries returned by the parser (rss entries, or sitemap urls under path_prefix) */
  seen: number;
  inserted: number;
  duplicates: number;
  tooOld: number;
  /** invalid/non-http url, missing title (rss), failed filter, undated sitemap url on the first run */
  skipped: number;
  /** entries blocked by an exclusion rule of the source filter (not counted in `skipped`), with the rule that blocked each */
  filtered: number;
  filteredItems: { rule: string; url: string }[];
  error?: string;
}

export interface CollectOptions {
  db: Db;
  sources: Source[];
  config: Pick<Config, 'backfill_days'>;
  fetchFn?: FetchFn;
  now?: Date;
  backfillDays?: number;
  timeoutMs?: number;
  onlySourceIds?: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function slugTitle(url: string): string {
  const segment = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
  const words = decodeURIComponentSafe(segment).replace(/-/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

async function hasArticles(db: Db, sourceId: string): Promise<boolean> {
  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.sourceId, sourceId))
    .limit(1);
  return rows.length > 0;
}

async function loadSitemapEntries(
  source: Extract<Source, { type: 'sitemap' }>,
  body: string,
  fetchFn: FetchFn | undefined,
  timeoutMs: number | undefined,
): Promise<RawEntry[]> {
  const urls = new Map<string, RawEntry>();
  const add = (xml: string) => {
    for (const u of parseSitemap(xml, source.path_prefix)) {
      if (!urls.has(u.url)) urls.set(u.url, { url: u.url, guid: null, title: null, publishedAt: u.lastmod });
    }
  };
  if (isSitemapIndex(body)) {
    for (const childUrl of parseSitemapIndex(body)) {
      const child = await getText(childUrl, fetchFn, timeoutMs);
      if (isSitemapIndex(child)) continue; // one level deep only
      add(child);
    }
  } else {
    add(body);
  }
  return [...urls.values()];
}

export async function collectSource(
  opts: Omit<CollectOptions, 'sources' | 'onlySourceIds'> & { source: Source },
): Promise<SourceReport> {
  const { db, source, config, fetchFn, timeoutMs } = opts;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.backfillDays ?? config.backfill_days) * DAY_MS);
  const report: SourceReport = {
    sourceId: source.id,
    status: 'ok',
    seen: 0,
    inserted: 0,
    duplicates: 0,
    tooOld: 0,
    skipped: 0,
    filtered: 0,
    filteredItems: [],
  };
  const block = (rule: string, url: string): void => {
    report.filtered++;
    report.filteredItems.push({ rule, url });
  };

  try {
    const state = await getState(db, source.id);
    let pageFetchFailed = false;
    const res = await conditionalGet(source.url, state, fetchFn, timeoutMs);
    if (res.status === 'not_modified') {
      await recordSuccess(db, source.id, { etag: res.etag, lastModified: res.lastModified }, now);
      report.status = 'not_modified';
      return report;
    }

    const body = res.body ?? '';
    const isSitemap = source.type === 'sitemap';
    const entries = isSitemap
      ? await loadSitemapEntries(source, body, fetchFn, timeoutMs)
      : parseFeed(body);
    // "First run" = no article from this source exists yet (not: no source_state row).
    const firstRun = isSitemap && !(await hasArticles(db, source.id));
    report.seen = entries.length;

    for (const entry of entries) {
      const url = normalizeUrl(entry.url);
      if (url === null) {
        report.skipped++;
        continue;
      }
      let title = entry.title?.trim() || null;
      if (!isSitemap && title === null) {
        report.skipped++;
        continue;
      }
      const early = exclusionRule({ url, title }, source.filter);
      if (early !== null) {
        block(early, url);
        continue;
      }
      if (!passesPathFilter(url, source.filter)) {
        report.skipped++;
        continue;
      }
      if (!isSitemap && !passesFilter({ url, title: title ?? '' }, source.filter)) {
        report.skipped++;
        continue;
      }
      if (isSitemap && entry.publishedAt === null && firstRun) {
        report.skipped++;
        continue;
      }
      const publishedAt = entry.publishedAt ?? now;
      if (publishedAt < cutoff) {
        report.tooOld++;
        continue;
      }

      if (isSitemap) {
        if (await urlExists(db, url)) {
          report.duplicates++;
          continue;
        }
        try {
          title = parsePageTitle(await getText(url, fetchFn, timeoutMs));
        } catch {
          // Page unavailable: do not insert (a made-up title would be permanent) and
          // keep the old validators below so the next run re-reads the sitemap and retries.
          pageFetchFailed = true;
          report.skipped++;
          continue;
        }
        // Page fetched but has no title: fall back to the URL slug.
        title = title || slugTitle(url);
        const late = exclusionRule({ url, title }, source.filter);
        if (late !== null) {
          block(late, url);
          continue;
        }
        if (!passesFilter({ url, title }, source.filter)) {
          report.skipped++;
          continue;
        }
      }

      const candidate: Candidate = {
        sourceId: source.id,
        url,
        guid: entry.guid ?? url,
        title: title as string,
        titleHash: titleHash(title as string),
        publishedAt,
      };
      if (await isDuplicate(db, candidate)) {
        report.duplicates++;
        continue;
      }
      const inserted = await db
        .insert(articles)
        .values(candidate)
        .onConflictDoNothing({ target: articles.url })
        .returning({ id: articles.id });
      if (inserted.length > 0) report.inserted++;
      else report.duplicates++;
    }

    const validators = pageFetchFailed
      ? { etag: state?.etag ?? null, lastModified: state?.lastModified ?? null }
      : { etag: res.etag, lastModified: res.lastModified };
    await recordSuccess(db, source.id, validators, now);
    return report;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await recordFailure(db, source.id, message, now);
    } catch (recordErr) {
      const detail = recordErr instanceof Error ? recordErr.message : String(recordErr);
      return { ...report, status: 'error', error: `${message} (also failed to record failure: ${detail})` };
    }
    return { ...report, status: 'error', error: message };
  }
}

export async function collectAll(opts: CollectOptions): Promise<SourceReport[]> {
  const { sources, onlySourceIds, ...rest } = opts;
  if (onlySourceIds) {
    const known = new Set(sources.map((s) => s.id));
    const unknown = onlySourceIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new Error(`unknown source id(s): ${unknown.join(', ')}`);
  }
  const selected = onlySourceIds ? sources.filter((s) => onlySourceIds.includes(s.id)) : sources;
  const reports: SourceReport[] = [];
  for (const source of selected) reports.push(await collectSource({ ...rest, source }));
  return reports;
}
