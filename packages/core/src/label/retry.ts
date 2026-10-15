import { OverloadedError } from './errors';
import type { LabelResult, Labeler, PublicArticle } from './types';

/**
 * Labels one article, retrying only a provider overload: before retry n it sleeps `backoffMs[n]`, so the number of
 * retries is `backoffMs.length` (`label_overload_backoff_ms` in data/config.yml). Any other error, including a 429
 * quota error, is thrown at once. When the retries run out the last OverloadedError is thrown, naming the count.
 */
export async function labelWithOverloadRetry(
  labeler: Labeler,
  article: PublicArticle,
  backoffMs: readonly number[],
  sleep: (ms: number) => Promise<void>,
): Promise<LabelResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await labeler.label(article);
    } catch (e) {
      if (!(e instanceof OverloadedError)) throw e;
      const delay = backoffMs[attempt];
      if (delay === undefined) {
        throw new OverloadedError(`${e.message}; gave up after ${backoffMs.length} retries`, { cause: e });
      }
      await sleep(delay);
    }
  }
}
