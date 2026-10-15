import type { ArticleType } from '@attn/shared';
import { FlaskConical, GraduationCap, Layers, Newspaper, Tag, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const TYPES: Record<ArticleType, { label: string; icon: LucideIcon }> = {
  release: { label: 'Release', icon: Tag },
  tutorial: { label: 'Tutorial', icon: GraduationCap },
  deep_dive: { label: 'Deep dive', icon: Layers },
  news: { label: 'News', icon: Newspaper },
  research: { label: 'Research', icon: FlaskConical },
};

/** The article type as an outline badge with its icon. */
export function TypeBadge({ type, className }: { type: ArticleType; className?: string }) {
  const { label, icon: Icon } = TYPES[type];
  return (
    <Badge variant="outline" className={cn('h-6 gap-1.5 px-2 font-normal text-muted-foreground', className)}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}
