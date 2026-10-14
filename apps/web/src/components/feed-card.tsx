'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { eventResponseSchema, readingMinutes, type ArticleCard, type EventKind } from '@attn/shared';
import { BrowserApiError, browserJson } from '@/lib/browser-api';

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });

type FeedbackKind = Exclude<EventKind, 'read'>;
const BUTTONS: { kind: FeedbackKind; label: string; verb: string }[] = [
  { kind: 'like', label: '👍 Like', verb: 'Like' },
  { kind: 'too_easy', label: 'Too easy', verb: 'Mark as too easy' },
  { kind: 'too_hard', label: 'Too hard', verb: 'Mark as too hard' },
  { kind: 'not_interested', label: 'Not interested', verb: 'Not interested in' },
];
// After a read the card collapses to these; not_interested is no longer offered.
const AFTER_READ: { kind: FeedbackKind; label: string; verb: string }[] = [
  { kind: 'like', label: '👍', verb: 'Like' },
  { kind: 'too_easy', label: 'Too easy', verb: 'Mark as too easy' },
  { kind: 'too_hard', label: 'Too hard', verb: 'Mark as too hard' },
];
const KIND_NAME: Record<EventKind, string> = {
  read: 'Read',
  like: 'Like',
  too_easy: 'Too easy',
  too_hard: 'Too hard',
  not_interested: 'Not interested',
};

const btn =
  'rounded-md border border-line px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40';
const pressed = 'bg-accent-soft font-medium';

function errorText(e: unknown): string {
  if (e instanceof BrowserApiError) return e.message;
  // fetch rejects with a TypeError ("Failed to fetch") when the network or the server is unreachable
  if (e instanceof TypeError) return 'Could not reach the server. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}

export function FeedCard({
  article,
  onExcluded,
}: {
  article: ArticleCard;
  /** Called after the server recorded `read` or `not_interested`: the article no longer ranks for this user. */
  onExcluded: (id: number, kind: 'read' | 'not_interested') => void;
}) {
  const [sent, setSent] = useState<ReadonlySet<EventKind>>(new Set());
  const [inflight, setInflight] = useState<ReadonlySet<EventKind>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<EventKind, string>>>({});
  // Same-tick guard: refs change synchronously, so a double click cannot send one kind twice.
  const sentRef = useRef(new Set<EventKind>());
  const inflightRef = useRef(new Set<EventKind>());
  const cardRef = useRef<HTMLElement>(null);
  const minutes = readingMinutes(article.wordCount);
  const read = sent.has('read');

  // The Read link the user just activated is gone after the collapse; keep keyboard focus on this card.
  useEffect(() => {
    if (read && (document.activeElement === null || document.activeElement === document.body)) cardRef.current?.focus();
  }, [read]);

  function setError(kind: EventKind, message: string | null) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message === null) delete next[kind];
      else next[kind] = message;
      return next;
    });
  }

  async function send(kind: EventKind) {
    if (sentRef.current.has(kind) || inflightRef.current.has(kind)) return;
    inflightRef.current.add(kind);
    setInflight(new Set(inflightRef.current));
    setError(kind, null);
    try {
      await browserJson('POST', `/articles/${article.id}/events`, eventResponseSchema, { kind });
      sentRef.current.add(kind);
      setSent(new Set(sentRef.current));
      if (kind === 'read' || kind === 'not_interested') onExcluded(article.id, kind);
    } catch (e) {
      if (e instanceof BrowserApiError && e.status === 401) {
        window.location.assign('/');
        return;
      }
      setError(kind, errorText(e));
    } finally {
      inflightRef.current.delete(kind);
      setInflight(new Set(inflightRef.current));
    }
  }

  // Title and Read link both open the article and record `read`: click (also ctrl/cmd-click and Enter) and middle click.
  const readLink = {
    href: article.url,
    target: '_blank',
    rel: 'noopener noreferrer',
    onClick: () => void send('read'),
    onAuxClick: (e: MouseEvent) => {
      if (e.button === 1) void send('read');
    },
  };

  const feedbackButton = ({ kind, label, verb }: { kind: FeedbackKind; label: string; verb: string }) => (
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
  );

  const alerts = (Object.entries(errors) as [EventKind, string][]).map(([kind, message]) => (
    <p key={kind} role="alert" className="mt-2 text-sm text-red-600">
      {KIND_NAME[kind]}: {message}
    </p>
  ));

  if (read) {
    return (
      <article ref={cardRef} tabIndex={-1} className="rounded-xl border border-line bg-card px-4 py-2 outline-none">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Read ✓</span>
          <a {...readLink} className="min-w-0 flex-1 truncate text-sm text-muted hover:underline">
            {article.title}
          </a>
          {AFTER_READ.map(feedbackButton)}
        </div>
        {alerts}
      </article>
    );
  }

  return (
    <article ref={cardRef} tabIndex={-1} className="rounded-xl border border-line bg-card p-4 outline-none">
      <a {...readLink} className="font-semibold hover:underline">
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
          {...readLink}
          aria-label={`Read ${article.title}`}
          className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-fg"
        >
          Read
        </a>
        {BUTTONS.map(feedbackButton)}
      </div>
      {alerts}
    </article>
  );
}
