import { readingMinutes, type ArticleCard } from '@attn/shared';
import { shortDate } from '@/components/article-meta';
import { ArticleType } from '@/components/article-type';
import { DifficultyMeter } from '@/components/difficulty-meter';
import { SkillSummary } from '@/components/skill-summary';
import { cn } from '@/lib/utils';

/**
 * The row grid, sized by the list's container (the sidebar can be open, collapsed or a sheet), mobile first:
 * - narrow: two lines, the type icon beside them; title first, then difficulty, skill, source · minutes · date;
 * - from 600px: one 42px line, type · difficulty · title · skill · minutes · date in fixed right-hand columns;
 * - from 800px: the source column too.
 * Shared with the loading skeleton so both line up.
 */
export const ROW_GRID =
  'grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 gap-y-1 border-b border-border py-2.5 @min-[600px]:h-[42px] @min-[600px]:grid-cols-[16px_23px_minmax(0,1fr)_150px_60px_52px] @min-[600px]:items-center @min-[600px]:gap-x-4 @min-[600px]:px-2 @min-[600px]:py-0 @min-[800px]:grid-cols-[16px_23px_minmax(0,1fr)_200px_160px_60px_52px]';

/** The ul for rows: the container the row grid queries, with the top hairline. */
export const ROWS_LIST = '@container border-t border-border';

/** One quiet row on All, read-only. The title is the link; it stretches over the whole row. */
export function ArticleRow({ article, difficultyLabel }: { article: ArticleCard; difficultyLabel: string }) {
  const minutes = readingMinutes(article.wordCount);
  return (
    <li className={cn(ROW_GRID, 'relative hover:bg-accent has-[a:focus-visible]:bg-accent')}>
      {/* Tooltip triggers sit above the stretched link (z-10) so they still get the pointer. */}
      <ArticleType
        type={article.type}
        iconOnly
        className="relative z-10 row-span-2 self-start pt-0.5 @min-[600px]:row-span-1 @min-[600px]:self-auto @min-[600px]:pt-0"
      />
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="col-start-2 row-start-1 line-clamp-2 text-sm leading-snug decoration-2 underline-offset-3 outline-none after:absolute after:inset-0 focus-visible:underline focus-visible:decoration-ring @min-[600px]:order-2 @min-[600px]:col-start-auto @min-[600px]:row-start-auto @min-[600px]:block @min-[600px]:text-ellipsis @min-[600px]:whitespace-nowrap"
      >
        {article.title}
      </a>
      {/* Narrow: the second line. Wider: its children become grid cells (contents) in the fixed columns. */}
      <div className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] @min-[600px]:contents">
        <DifficultyMeter
          difficulty={article.difficulty}
          label={difficultyLabel}
          compact
          className="relative z-10 @min-[600px]:order-1"
        />
        <div className="min-w-0 flex-[1_1_calc(100%-40px)] @min-[600px]:order-3">
          <SkillSummary skills={article.skills} compact />
        </div>
        <span className="min-w-0 truncate text-muted-foreground @min-[600px]:order-3 @min-[600px]:hidden @min-[800px]:block">
          {article.sourceName}
        </span>
        <span className="font-mono whitespace-nowrap text-muted-foreground @min-[600px]:order-3 @min-[600px]:text-right">
          {minutes !== null ? (
            <>
              <span aria-hidden className="mr-2 text-faint @min-[600px]:hidden">
                ·
              </span>
              {minutes} min
            </>
          ) : null}
        </span>
        <span className="whitespace-nowrap text-muted-foreground @min-[600px]:order-3 @min-[600px]:text-right">
          <span aria-hidden className="mr-2 text-faint @min-[600px]:hidden">
            ·
          </span>
          <time dateTime={article.publishedAt} className="font-mono">
            {shortDate(article.publishedAt)}
          </time>
        </span>
      </div>
    </li>
  );
}
