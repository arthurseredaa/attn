import { readingMinutes } from '@attn/shared';
import { cn } from '@/lib/utils';

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });

/** Source · date · reading time, as a small mono row. */
export function ArticleMeta({
  sourceName,
  publishedAt,
  wordCount,
  className,
}: {
  sourceName: string;
  publishedAt: string;
  wordCount: number | null;
  className?: string;
}) {
  const minutes = readingMinutes(wordCount);
  return (
    <p
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-1.5 font-mono text-xs tracking-wide text-muted-foreground uppercase tabular-nums',
        className,
      )}
    >
      <span className="min-w-0 truncate">{sourceName}</span>
      <span aria-hidden>·</span>
      <time dateTime={publishedAt}>{dateFormat.format(new Date(publishedAt))}</time>
      {minutes !== null ? (
        <>
          <span aria-hidden>·</span>
          <span>{minutes} min read</span>
        </>
      ) : null}
    </p>
  );
}
