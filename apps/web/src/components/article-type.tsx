import type { ArticleType as ArticleTypeName } from '@attn/shared';
import { BookOpen, FlaskConical, Layers, Newspaper, Tag, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const TYPES: Record<ArticleTypeName, { label: string; icon: LucideIcon }> = {
  release: { label: 'Release', icon: Tag },
  tutorial: { label: 'Tutorial', icon: BookOpen },
  deep_dive: { label: 'Deep dive', icon: Layers },
  news: { label: 'News', icon: Newspaper },
  research: { label: 'Research', icon: FlaskConical },
};

/** The article type as a plain icon and word in muted text. */
export function ArticleType({ type, className }: { type: ArticleTypeName; className?: string }) {
  const { label, icon: Icon } = TYPES[type];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground', className)}>
      <Icon aria-hidden className="size-[15px] shrink-0" strokeWidth={1.75} />
      {label}
    </span>
  );
}
