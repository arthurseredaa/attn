'use client';

import { useState } from 'react';
import { eventResponseSchema, readingMinutes, type ArticleCard, type EventKind } from '@attn/shared';
import { BrowserApiError, browserJson } from '@/lib/browser-api';

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });

const BUTTONS: { kind: Exclude<EventKind, 'read'>; label: string; verb: string }[] = [
  { kind: 'like', label: '👍 Like', verb: 'Like' },
  { kind: 'too_easy', label: 'Too easy', verb: 'Mark as too easy' },
  { kind: 'too_hard', label: 'Too hard', verb: 'Mark as too hard' },
  { kind: 'not_interested', label: 'Not interested', verb: 'Not interested in' },
];

const btn =
  'rounded-md border border-line px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40';
const pressed = 'bg-accent-soft font-medium';

export function FeedCard({
  article,
  onRemoved,
}: {
  article: ArticleCard;
  onRemoved: (id: number) => void;
}) {
  const [sent, setSent] = useState<Set<EventKind>>(new Set());
  const [inflight, setInflight] = useState<Set<EventKind>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const minutes = readingMinutes(article.wordCount);

  async function send(kind: EventKind) {
    if (sent.has(kind) || inflight.has(kind)) return;
    setInflight((s) => new Set(s).add(kind));
    setError(null);
    try {
      await browserJson('POST', `/articles/${article.id}/events`, eventResponseSchema, { kind });
      setSent((s) => new Set(s).add(kind));
      if (kind === 'read' || kind === 'not_interested') onRemoved(article.id);
    } catch (e) {
      setError(
        e instanceof BrowserApiError && e.status === 401
          ? 'Your session expired, sign in again.'
          : e instanceof Error
            ? e.message
            : 'Something went wrong.',
      );
    } finally {
      setInflight((s) => {
        const next = new Set(s);
        next.delete(kind);
        return next;
      });
    }
  }

  return (
    <article className="rounded-xl border border-line bg-card p-4">
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold hover:underline"
      >
        {article.title}
      </a>
      <p className="mt-1 text-sm text-muted">
        {article.sourceName} · {dateFormat.format(new Date(article.publishedAt))}
        {minutes !== null ? ` · ${minutes} min read` : ''}
      </p>
      {article.skills.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {article.skills.map((s) => (
            <li
              key={s.id}
              className={`rounded-full px-2.5 py-0.5 text-xs ${s.isPrimary ? 'bg-accent text-accent-fg' : 'bg-accent-soft'}`}
            >
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Read ${article.title}`}
          onClick={() => void send('read')}
          onAuxClick={(e) => {
            if (e.button === 1) void send('read');
          }}
          className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-fg"
        >
          Read
        </a>
        {BUTTONS.map(({ kind, label, verb }) => (
          <button
            key={kind}
            type="button"
            aria-label={`${verb}: ${article.title}`}
            aria-pressed={sent.has(kind)}
            disabled={sent.has(kind) || inflight.has(kind)}
            onClick={() => void send(kind)}
            className={`${btn} ${sent.has(kind) ? pressed : 'hover:text-fg text-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </article>
  );
}
