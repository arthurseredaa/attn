import { z } from 'zod';
import { articleCardSchema, type ArticleCard } from './api';
import { eventKindSchema, type EventKind } from './enums';

export const FEED_MAX_OFFSET = 10_000;

export const feedQuerySchema = z.object({
  offset: z
    .string()
    .regex(/^\d+$/, 'must be a non-negative integer')
    .transform(Number)
    .pipe(z.number().int().max(FEED_MAX_OFFSET))
    .default(0),
});

export const feedPageSchema = z.object({
  items: z.array(articleCardSchema),
  nextOffset: z.number().int().min(0).nullable(),
});
export type FeedPage = z.infer<typeof feedPageSchema>;

export const articleIdParamSchema = z
  .string()
  .regex(/^[1-9]\d{0,9}$/, 'must be a positive integer')
  .transform(Number)
  .pipe(z.number().int().max(2_147_483_647));

export const eventBodySchema = z.strictObject({ kind: eventKindSchema });
export type EventBody = z.infer<typeof eventBodySchema>;

export const eventResponseSchema = z.strictObject({ kind: eventKindSchema, recorded: z.boolean() });
export type EventResponse = z.infer<typeof eventResponseSchema>;

export function mergeFeedItems(
  current: ArticleCard[],
  incoming: ArticleCard[],
): { items: ArticleCard[]; duplicates: number } {
  const seen = new Set(current.map((c) => c.id));
  const items = [...current];
  let duplicates = 0;
  for (const card of incoming) {
    if (seen.has(card.id)) duplicates += 1;
    else {
      seen.add(card.id);
      items.push(card);
    }
  }
  return { items, duplicates };
}

/** True for the kinds after which the ranker no longer returns the article to this user (spec §6.1). */
export function excludesFromFeed(kind: EventKind): boolean {
  return kind === 'read' || kind === 'not_interested';
}

/**
 * Offset for the next "load more": cards the server has served to this list (duplicates included) minus the distinct
 * cards it now excludes because of a `read` or `not_interested` sent from this list. A read card stays on screen
 * (collapsed) but no longer ranks, so the count follows the server's exclusions, not what the DOM shows.
 */
export function feedNextOffset(served: number, excluded: ReadonlySet<number>): number {
  return Math.max(0, served - excluded.size);
}
