import { readingMinutes } from '@attn/shared';
import { cn } from '@/lib/utils';

const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Source · date · reading time: the source in sans, the numbers in mono. */
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
    <p className={cn('flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground', className)}>
      <span className="min-w-0 truncate">{sourceName}</span>
      <span aria-hidden className="text-faint">
        ·
      </span>
      <time dateTime={publishedAt} className="font-mono text-[13px]">
        {dateFormat.format(new Date(publishedAt))}
      </time>
      {minutes !== null ? (
        <>
          <span aria-hidden className="text-faint">
            ·
          </span>
          <span className="font-mono text-[13px]">{minutes} min</span>
        </>
      ) : null}
    </p>
  );
}
