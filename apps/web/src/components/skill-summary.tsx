import type { ArticleCard } from '@attn/shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** The article's primary skill in accent text, then "+N more" (the others in a tooltip). Nothing when it has no skills. */
export function SkillSummary({ skills, className }: { skills: ArticleCard['skills']; className?: string }) {
  const primary = skills.find((s) => s.isPrimary) ?? skills[0];
  if (!primary) return null;
  const others = skills.filter((s) => s !== primary);
  return (
    <p className={cn('min-w-0 text-[13.5px] leading-snug', className)}>
      <span className="font-medium text-primary">{primary.name}</span>
      {others.length > 0 ? (
        <>
          {' '}
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="rounded-sm whitespace-nowrap text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring">
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
