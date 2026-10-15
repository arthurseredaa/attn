import { cn } from '@/lib/utils';

const SEGMENTS = [0, 1, 2, 3, 4] as const;

/**
 * A 0–4 scale as five thin segments: filled up to and including `level` in ink, the rest in the empty-segment grey.
 * Purely visual; the caller labels it (see DifficultyMeter).
 */
export function LevelMeter({ level, className }: { level: number; className?: string }) {
  const n = Math.min(4, Math.max(0, Math.round(level)));
  return (
    <span aria-hidden className={cn('inline-flex items-center gap-0.5', className)}>
      {SEGMENTS.map((i) => (
        <span key={i} className={cn('h-2.5 w-1.5 rounded-[1px]', i <= n ? 'bg-foreground' : 'bg-segment')} />
      ))}
    </span>
  );
}
