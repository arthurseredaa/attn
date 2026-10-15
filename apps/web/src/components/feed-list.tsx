'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Inbox, Loader2, SearchX } from 'lucide-react';
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
    <div ref={listRef} tabIndex={-1} className="space-y-4 outline-none">
      {items.length === 0 && !hasMore && filtered ? (
        <EmptyState icon={SearchX} title="No matches">
          No articles in your feed match these filters. Try removing a skill or changing the search.
        </EmptyState>
      ) : items.length === 0 && !hasMore ? (
        <EmptyState icon={Inbox} title="Nothing to show right now">
          Check your focus skills on your{' '}
          <Link href="/profile" className="underline">
            profile
          </Link>
          , or come back after the next collection run.
        </EmptyState>
      ) : (
        // One column (list) below md; from md as many >= 18rem tiles as fit (2 / 3 / 4 as the width grows). Equal-height rows.
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]">
          {items.map((a) => (
            <li
              key={a.id}
              tabIndex={-1}
              className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              ref={(el) => {
                if (el) cardRefs.current.set(a.id, el);
                else cardRefs.current.delete(a.id);
              }}
            >
              <FeedCard article={a} difficultyLabel={difficultyLabels[a.difficulty] ?? `L${a.difficulty}`} onExcluded={excluded} />
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {hasMore ? (
        <div className="flex justify-center pt-2">
          <Button type="button" variant="outline" disabled={loading} onClick={() => void loadMore()} className="min-w-36">
            {loading ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
