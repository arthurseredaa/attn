'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, ChevronsDown, ChevronsUp, CircleCheck, EyeOff, ThumbsUp, type LucideIcon } from 'lucide-react';
import { eventResponseSchema, type ArticleCard, type EventKind } from '@attn/shared';
import { articleLinks } from '@/lib/article-links';
import { BrowserApiError, browserJson } from '@/lib/browser-api';
import { cn } from '@/lib/utils';
import { ArticleMeta } from '@/components/article-meta';
import { DifficultyMeter } from '@/components/difficulty-meter';
import { SkillChip } from '@/components/skill-chip';
import { TypeBadge } from '@/components/type-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type FeedbackKind = Exclude<EventKind, 'read'>;
interface FeedbackButton {
  kind: FeedbackKind;
  label: string;
  verb: string;
  icon: LucideIcon;
}
const BUTTONS: FeedbackButton[] = [
  { kind: 'like', label: 'Like', verb: 'Like', icon: ThumbsUp },
  { kind: 'too_easy', label: 'Too easy', verb: 'Mark as too easy', icon: ChevronsDown },
  { kind: 'too_hard', label: 'Too hard', verb: 'Mark as too hard', icon: ChevronsUp },
  { kind: 'not_interested', label: 'Not interested', verb: 'Not interested in', icon: EyeOff },
];
// After a read the card collapses to these; not_interested is no longer offered.
const AFTER_READ = BUTTONS.filter((b) => b.kind !== 'not_interested');
const KIND_NAME: Record<EventKind, string> = {
  read: 'Read',
  like: 'Like',
  too_easy: 'Too easy',
  too_hard: 'Too hard',
  not_interested: 'Not interested',
};

// Pressed buttons are also disabled (a kind is sent once); keep them fully opaque so the state reads clearly.
const PRESSED: Record<FeedbackKind, string> = {
  like: 'bg-success/10 text-success hover:bg-success/15 hover:text-success disabled:opacity-100',
  too_easy: 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary disabled:opacity-100',
  too_hard: 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary disabled:opacity-100',
  not_interested: 'bg-muted text-foreground disabled:opacity-100',
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
  const [inflight, setInflight] = useState<ReadonlySet<EventKind>>(new Set());
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

  const { openLink, readLink } = articleLinks(article.url, () => void send('read'));

  // Icon-only on tiles: the aria-label carries the full name (and the article), the tooltip shows the short label.
  const feedbackButton = ({ kind, label, verb, icon: Icon }: FeedbackButton) => (
    <Tooltip key={kind}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${verb}: ${article.title}`}
          aria-pressed={sent.has(kind)}
          disabled={sent.has(kind) || inflight.has(kind)}
          onClick={() => void send(kind)}
          className={cn(sent.has(kind) ? PRESSED[kind] : 'text-muted-foreground hover:text-foreground')}
        >
          <Icon aria-hidden className={cn(kind === 'like' && sent.has(kind) && 'fill-current')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

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
          <Card
            ref={cardRef}
            tabIndex={-1}
            role="article"
            className="gap-2 rounded-xl border border-dashed bg-muted/40 p-3 shadow-none ring-0 outline-none focus-visible:ring-3 focus-visible:ring-ring/40 sm:px-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
                <CircleCheck aria-hidden className="size-4" />
                Read
              </span>
              <div className="flex items-center gap-0.5">{AFTER_READ.map(feedbackButton)}</div>
            </div>
            <a
              {...openLink}
              className="line-clamp-2 text-sm text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
            >
              {article.title}
            </a>
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
            className="h-full gap-3 rounded-xl border p-4 shadow-none ring-0 outline-none transition-colors hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TypeBadge type={article.type} />
              <DifficultyMeter difficulty={article.difficulty} label={difficultyLabel} />
            </div>

            <h2 className="line-clamp-3 text-[0.9375rem] leading-snug font-semibold tracking-tight text-pretty">
              <a
                {...openLink}
                className="outline-none hover:text-primary focus-visible:text-primary focus-visible:underline focus-visible:underline-offset-4"
              >
                {article.title}
              </a>
            </h2>
            <ArticleMeta sourceName={article.sourceName} publishedAt={article.publishedAt} wordCount={article.wordCount} />

            {article.skills.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Skills">
                {article.skills.map((s) => (
                  <li key={s.id}>
                    <SkillChip name={s.name} primary={s.isPrimary} />
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-auto space-y-3 pt-1">
              <Separator />
              <div className="flex items-center justify-between gap-2">
                <Button asChild size="sm" className="px-3">
                  <a {...readLink} aria-label={`Read ${article.title}`}>
                    Read
                    <ArrowUpRight aria-hidden />
                  </a>
                </Button>
                <div className="flex items-center gap-0.5">{BUTTONS.map(feedbackButton)}</div>
              </div>
              {alerts.length > 0 ? <div className="space-y-1">{alerts}</div> : null}
            </div>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
