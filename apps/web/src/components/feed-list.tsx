'use client';

import { useState } from 'react';
import Link from 'next/link';
import { feedPageSchema, mergeFeedItems, type FeedPage } from '@attn/shared';
import { browserJson } from '@/lib/browser-api';
import { FeedCard } from '@/components/feed-card';

export function FeedList({ initial }: { initial: FeedPage }) {
  const [items, setItems] = useState(initial.items);
  const [hasMore, setHasMore] = useState(initial.nextOffset !== null);
  const [duplicates, setDuplicates] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    setLoading(true);
    setError(null);
    try {
      const page = await browserJson('GET', `/feed?offset=${items.length + duplicates}`, feedPageSchema);
      const merged = mergeFeedItems(items, page.items);
      setItems(merged.items);
      setDuplicates((d) => d + merged.duplicates);
      setHasMore(page.nextOffset !== null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load more.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
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
            <li key={a.id}>
              <FeedCard article={a} onRemoved={(id) => setItems((cur) => cur.filter((c) => c.id !== id))} />
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
