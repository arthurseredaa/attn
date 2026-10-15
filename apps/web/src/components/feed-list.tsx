'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { feedNextOffset, feedPageSchema, mergeFeedItems, type FeedPage } from '@attn/shared';
import { BrowserApiError, browserJson } from '@/lib/browser-api';
import { buildQueryString } from '@/lib/query';
import { EmptyState } from '@/components/empty-state';
import { FeedCard } from '@/components/feed-card';
import { Button } from '@/components/ui/button';

export function FeedList({
  initial,
  filters,
  filtered,
  difficultyLabels,
}: {
  initial: FeedPage;
  /** The skill/title filters `initial` was fetched with; "load more" repeats them so the offset stays in the same list. */
  filters: { skill: string[]; q: string };
  /** Any filter is set: an empty list then means "no match", not "nothing to read". */
  filtered: boolean;
  /** Taxonomy labels of the difficulty scale, indexed 0–4. */
  difficultyLabels: string[];
}) {
  const [items, setItems] = useState(initial.items);
  const [hasMore, setHasMore] = useState(initial.nextOffset !== null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Source of truth between renders, so in-flight fetches and same-tick removals see current state.
  const itemsRef = useRef(initial.items);
  // "Load more" offset = cards the server has served minus the distinct cards it now excludes (read or
  // not_interested sent from this list; see feedNextOffset). A read card stays on screen, collapsed, but no
  // longer ranks, so the count follows server-side exclusions, not DOM removals.
  const servedRef = useRef(initial.items.length);
  const excludedRef = useRef(new Set<number>());
  const loadingRef = useRef(false);
  const cardRefs = useRef(new Map<number, HTMLLIElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<{ next: number | null; prev: number | null } | null>(null);

  useEffect(() => {
    const f = focusAfter.current;
    if (!f) return;
    focusAfter.current = null;
    const target =
      (f.next !== null ? cardRefs.current.get(f.next) : undefined) ??
      (f.prev !== null ? cardRefs.current.get(f.prev) : undefined) ??
      listRef.current;
    target?.focus();
  }, [items]);

  function remove(id: number) {
    const cur = itemsRef.current;
    const i = cur.findIndex((c) => c.id === id);
    if (i === -1) return; // idempotent
    focusAfter.current = { next: cur[i + 1]?.id ?? null, prev: cur[i - 1]?.id ?? null };
    itemsRef.current = cur.filter((c) => c.id !== id);
    setItems(itemsRef.current);
  }

  function excluded(id: number, kind: 'read' | 'not_interested') {
    excludedRef.current.add(id);
    // a read card collapses in place (FeedCard) and leaves on the next page load; not_interested removes it now
    if (kind === 'not_interested') remove(id);
  }

  async function loadMore() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const page = await browserJson(
        'GET',
        `/feed${buildQueryString({ offset: feedNextOffset(servedRef.current, excludedRef.current), skill: filters.skill, q: filters.q })}`,
        feedPageSchema,
      );
      // merge into the current items, not the ones captured at click time
      itemsRef.current = mergeFeedItems(itemsRef.current, page.items).items;
      servedRef.current += page.items.length;
      setItems(itemsRef.current);
      setHasMore(page.nextOffset !== null);
    } catch (e) {
      if (e instanceof BrowserApiError && e.status === 401) {
        window.location.assign('/');
        return;
      }
      setError('Could not load more. Please try again.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div ref={listRef} tabIndex={-1} className="outline-none">
      {items.length === 0 && !hasMore && filtered ? (
        <EmptyState title="No matching articles" />
      ) : items.length === 0 && !hasMore ? (
        <EmptyState title="Nothing to read right now">
          <Link href="/profile">Edit focus skills</Link>
        </EmptyState>
      ) : (
        // Columns follow the content width (not the viewport), so the sidebar state counts: 1 column, 2 from 560px,
        // 3 from 1000px, 4 from 1560px. Equal-height rows.
        <div className="@container">
          <ul className="grid grid-cols-1 gap-3 @min-[560px]:grid-cols-2 @min-[560px]:gap-4 @min-[1000px]:grid-cols-3 @min-[1560px]:grid-cols-4">
            {items.map((a) => (
              <li
                key={a.id}
                tabIndex={-1}
                className="rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring"
                ref={(el) => {
                  if (el) cardRefs.current.set(a.id, el);
                  else cardRefs.current.delete(a.id);
                }}
              >
                <FeedCard article={a} difficultyLabel={difficultyLabels[a.difficulty] ?? `L${a.difficulty}`} onExcluded={excluded} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-6 text-center text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {hasMore ? (
        <div className="mt-8 flex justify-center">
          <Button type="button" variant="outline" disabled={loading} onClick={() => void loadMore()} className="h-[38px] min-w-32 px-[18px]">
            {loading ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
