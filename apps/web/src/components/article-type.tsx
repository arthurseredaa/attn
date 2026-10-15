import type { ArticleType as ArticleTypeName } from '@attn/shared';
import { BookOpen, FlaskConical, Layers, Newspaper, Tag, type LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const TYPES: Record<ArticleTypeName, { label: string; icon: LucideIcon }> = {
  release: { label: 'Release', icon: Tag },
  tutorial: { label: 'Tutorial', icon: BookOpen },
  deep_dive: { label: 'Deep dive', icon: Layers },
  news: { label: 'News', icon: Newspaper },
  research: { label: 'Research', icon: FlaskConical },
};

/**
 * The article type as a plain icon and word in muted text. `iconOnly` (dense rows) drops the word: it becomes the
 * icon's accessible name and its tooltip.
 */
export function ArticleType({
  type,
  iconOnly = false,
  className,
}: {
  type: ArticleTypeName;
  iconOnly?: boolean;
  className?: string;
}) {
  const { label, icon: Icon } = TYPES[type];
  if (iconOnly) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span role="img" aria-label={label} className={cn('inline-flex text-muted-foreground', className)}>
            <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground', className)}>
      <Icon aria-hidden className="size-[15px] shrink-0" strokeWidth={1.75} />
      {label}
    </span>
  );
}
