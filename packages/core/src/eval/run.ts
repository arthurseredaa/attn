import type { Config, LabelOutput } from '@attn/shared';
import type { FetchFn } from '../collect/http';
import { fetchArticleText, limitText } from '../extract';
import { labelWithOverloadRetry, makePublicArticle, FatalLabelerError, RateLimitError, type Labeler } from '../label';
import type { TextCache } from './cache';
import type { GoldenEntry } from './golden';
import { buildReport, type EvalFailure, type EvalReport } from './score';

export interface EvalOptions {
  labeler: Labeler;
  golden: GoldenEntry[];
  cache: TextCache;
  config: Pick<Config, 'label_max_chars' | 'label_min_chars' | 'label_delay_ms' | 'label_overload_backoff_ms'>;
  fetchFn?: FetchFn;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: Date;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runEval(opts: EvalOptions): Promise<EvalReport> {
  const { labeler, golden, cache, config } = opts;
  const sleep = opts.sleep ?? defaultSleep;
  const scored: { url: string; expected: GoldenEntry; actual: LabelOutput }[] = [];
  const failures: EvalFailure[] = [];
  let rateLimited = false;
  let fatal: string | undefined;
  let labelCalls = 0;

  for (const entry of golden) {
    const { url } = entry;
    try {
      let cached = await cache.get(url);
      if (!cached) {
        const fetched = await fetchArticleText(url, { fetchFn: opts.fetchFn, timeoutMs: opts.timeoutMs });
        cached = {
          url,
          title: fetched.title,
          text: fetched.text,
          wordCount: fetched.wordCount,
          fetchedAt: (opts.now ?? new Date()).toISOString(),
        };
        await cache.set(cached);
      }
      const text = limitText(cached.text, { minChars: config.label_min_chars, maxChars: config.label_max_chars });
      if (labelCalls > 0) await sleep(config.label_delay_ms);
      labelCalls++;
      const article = makePublicArticle({ title: cached.title, url, text });
      const actual = await labelWithOverloadRetry(labeler, article, config.label_overload_backoff_ms, sleep);
      scored.push({ url, expected: entry, actual });
    } catch (e) {
      if (e instanceof FatalLabelerError) {
        fatal = e.message;
        break;
      }
      if (e instanceof RateLimitError) {
        rateLimited = true;
        break;
      }
      failures.push({ url, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return buildReport({
    model: labeler.model,
    total: golden.length,
    scored,
    failures,
    rateLimited,
    ...(fatal !== undefined ? { fatal } : {}),
    ...(labeler.usage ? { usage: labeler.usage() } : {}),
  });
}
