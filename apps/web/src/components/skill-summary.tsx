import type { ArticleCard } from '@attn/shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The article's primary skill in accent text, then "+N more" (the others in a tooltip). Nothing when it has no skills.
 * `compact` (dense rows) keeps it to one line: the primary skill truncates, "+N more" stays whole and sits above a
 * stretched row link so its tooltip still works.
 */
export function SkillSummary({
  skills,
  compact = false,
  className,
}: {
  skills: ArticleCard['skills'];
  compact?: boolean;
  className?: string;
}) {
  const primary = skills.find((s) => s.isPrimary) ?? skills[0];
  if (!primary) return null;
  const others = skills.filter((s) => s !== primary);
  return (
    <p
      className={cn(
        'min-w-0 text-[13.5px] leading-snug',
        compact && 'flex items-baseline gap-1 text-[13px] whitespace-nowrap',
        className,
      )}
    >
      <span className={cn('font-medium text-primary', compact && 'min-w-0 truncate')}>{primary.name}</span>
      {others.length > 0 ? (
        <>
          {compact ? null : ' '}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className={cn(
                  'rounded-sm whitespace-nowrap text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring',
                  compact && 'relative z-10 shrink-0',
                )}
              >
                +{others.length} more
                <span className="sr-only">: {others.map((s) => s.name).join(', ')}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" align="start">
              {others.map((s) => s.name).join(', ')}
            </TooltipContent>
          </Tooltip>
        </>
      ) : null}
    </p>
  );
}
