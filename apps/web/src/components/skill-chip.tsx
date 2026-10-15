import { cn } from '@/lib/utils';

/** A skill tag on an article; the article's primary skill is tinted with the primary colour. */
export function SkillChip({ name, primary = false, className }: { name: string; primary?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full border px-2.5 text-xs whitespace-nowrap',
        primary ? 'border-primary/25 bg-primary/10 font-medium text-primary' : 'bg-muted/60 text-muted-foreground',
        className,
      )}
    >
      {name}
    </span>
  );
}
