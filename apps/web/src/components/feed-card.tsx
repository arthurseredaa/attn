'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check } from 'lucide-react';
import { eventResponseSchema, type ArticleCard, type EventKind } from '@attn/shared';
import { articleLinks } from '@/lib/article-links';
import { BrowserApiError, browserJson } from '@/lib/browser-api';
import { ArticleMeta } from '@/components/article-meta';
import { ArticleType } from '@/components/article-type';
import { DifficultyMeter } from '@/components/difficulty-meter';
import { SkillSummary } from '@/components/skill-summary';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

// The feedback buttons (like, too easy, too hard, not interested) are off the cards until recommendations really
// adapt to them: plans/feedback-driven-recommendations.md. The api still accepts every kind.
const KIND_NAME: Record<EventKind, string> = {
  read: 'Read',
  like: 'Like',
  too_easy: 'Too easy',
  too_hard: 'Too hard',
  not_interested: 'Not interested',
};

function errorText(e: unknown): string {
  if (e instanceof BrowserApiError) return e.message;
  // fetch rejects with a TypeError ("Failed to fetch") when the network or the server is unreachable
  if (e instanceof TypeError) return 'Could not reach the server. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}

export function FeedCard({
  article,
  difficultyLabel,
  onExcluded,
}: {
  article: ArticleCard;
  /** Taxonomy label of `article.difficulty`. */
  difficultyLabel: string;
  /** Called after the server recorded `read` or `not_interested`: the article no longer ranks for this user. */
  onExcluded: (id: number, kind: 'read' | 'not_interested') => void;
}) {
  const [sent, setSent] = useState<ReadonlySet<EventKind>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<EventKind, string>>>({});
  // Same-tick guard: refs change synchronously, so a double click cannot send one kind twice.
  const sentRef = useRef(new Set<EventKind>());
  const inflightRef = useRef(new Set<EventKind>());
  const cardRef = useRef<HTMLDivElement>(null);
  const fullRef = useRef<HTMLDivElement>(null);
  const read = sent.has('read');
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const };

  // The Read link the user just activated leaves with the full card (it animates out); keep keyboard focus on this
  // card's collapsed row.
  useEffect(() => {
    if (!read) return;
    const active = document.activeElement;
    if (active === null || active === document.body || fullRef.current?.contains(active)) cardRef.current?.focus();
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
    }
  }

  const { openLink, readLink } = articleLinks(article.url, () => void send('read'));

  const alerts = (Object.entries(errors) as [EventKind, string][]).map(([kind, message]) => (
    <p key={kind} role="alert" className="text-sm text-destructive">
      {KIND_NAME[kind]}: {message}
    </p>
  ));

  return (
    <AnimatePresence initial={false}>
      {read ? (
        <motion.div
          key="read"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          transition={transition}
          className="overflow-hidden"
        >
          {/* Collapsed: a quiet one-line row on the page background with the Read mark. */}
          <Card
            ref={cardRef}
            tabIndex={-1}
            role="article"
            className="gap-0 bg-transparent py-0 pt-3.5 pr-4 pb-3 pl-5 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring max-sm:pt-3 max-sm:pr-3.5 max-sm:pb-2.5 max-sm:pl-4"
          >
            <h2 className="line-clamp-1 text-[15px] leading-snug font-medium text-muted-foreground">
              <a
                {...openLink}
                className="underline-offset-3 outline-none hover:underline focus-visible:text-foreground focus-visible:underline focus-visible:decoration-2 focus-visible:decoration-ring"
              >
                {article.title}
              </a>
            </h2>
            <span className="inline-flex items-center gap-1.5 pt-1.5 text-[13px] font-medium text-muted-foreground">
              <Check aria-hidden className="size-3.5" />
              Read
            </span>
            {alerts}
          </Card>
        </motion.div>
      ) : (
        <motion.div
          key="full"
          ref={fullRef}
          exit={{ height: 0, opacity: 0 }}
          transition={transition}
          className="h-full overflow-hidden"
        >
          <Card
            tabIndex={-1}
            role="article"
            className="h-full gap-0 px-[18px] py-0 pt-[18px] pb-4 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-6 sm:pt-[22px] sm:pb-5"
          >
            <div className="mb-2.5 flex items-center justify-between gap-3 sm:mb-3.5">
              <ArticleType type={article.type} />
              <DifficultyMeter difficulty={article.difficulty} label={difficultyLabel} />
            </div>

            <h2 className="mb-2.5 line-clamp-3 text-[17px] leading-[1.35] font-semibold tracking-[-0.012em] text-pretty sm:text-lg">
              <a
                {...openLink}
                className="decoration-1 underline-offset-3 outline-none hover:underline focus-visible:underline focus-visible:decoration-2 focus-visible:decoration-ring"
              >
                {article.title}
              </a>
            </h2>
            <ArticleMeta sourceName={article.sourceName} publishedAt={article.publishedAt} wordCount={article.wordCount} />

            <div className="mt-auto pt-4 sm:pt-[22px]">
              <div className="flex items-center justify-between gap-3">
                <SkillSummary skills={article.skills} />
                <div className="ml-auto flex shrink-0 items-center">
                  <Button asChild size="sm" className="px-[13px]">
                    <a {...readLink} aria-label={`Read ${article.title}`}>
                      Read
                    </a>
                  </Button>
                </div>
              </div>
              {alerts.length > 0 ? <div className="mt-3 space-y-1">{alerts}</div> : null}
            </div>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
