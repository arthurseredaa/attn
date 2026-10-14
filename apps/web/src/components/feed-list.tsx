'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { feedPageSchema, mergeFeedItems, type FeedPage } from '@attn/shared';
import { BrowserApiError, browserJson } from '@/lib/browser-api';
import { FeedCard } from '@/components/feed-card';

export function FeedList({ initial }: { initial: FeedPage }) {
  const [items, setItems] = useState(initial.items);
  const [hasMore, setHasMore] = useState(initial.nextOffset !== null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Source of truth between renders, so in-flight fetches and same-tick removals see current state.
  const itemsRef = useRef(initial.items);
  // Offset = items the server has served minus cards the user removed (a removed card no longer ranks,
  // so the next unseen item moves up by one). Unlike items.length + duplicates, removing a card that was
  // also a duplicate cannot leave it too high.
  const offsetRef = useRef(initial.items.length);
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
    offsetRef.current = Math.max(0, offsetRef.current - 1);
    setItems(itemsRef.current);
  }

  async function loadMore() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const page = await browserJson('GET', `/feed?offset=${offsetRef.current}`, feedPageSchema);
      // merge into the current items, not the ones captured at click time
      itemsRef.current = mergeFeedItems(itemsRef.current, page.items).items;
      offsetRef.current += page.items.length;
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
      {items.length === 0 && !hasMore ? (
        <p className="text-sm text-muted">
          Nothing to show right now. Check your focus skills on your{' '}
          <Link href="/profile" className="underline">
            profile
          </Link>
          , or come back after the next collection run.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
            <li
              key={a.id}
              tabIndex={-1}
              className="outline-none"
              ref={(el) => {
                if (el) cardRefs.current.set(a.id, el);
                else cardRefs.current.delete(a.id);
              }}
            >
              <FeedCard article={a} onRemoved={remove} />
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {hasMore ? (
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadMore()}
          className="rounded-md border border-line px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
