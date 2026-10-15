import { cn } from '@/lib/utils';

// Static class names, so Tailwind sees every level colour.
const FILL = ['bg-level-0', 'bg-level-1', 'bg-level-2', 'bg-level-3', 'bg-level-4'] as const;
const TEXT = ['text-level-0', 'text-level-1', 'text-level-2', 'text-level-3', 'text-level-4'] as const;
const SEGMENTS = [0, 1, 2, 3, 4] as const;

/**
 * A level 0–4 as five segments, filled up to and including `level` in that level's colour, plus its taxonomy label.
 * The same colour ramp marks article difficulty and the reader's skill level.
 */
export function LevelMeter({
  level,
  label,
  size = 'compact',
  caption = 'Difficulty',
  className,
}: {
  level: number;
  /** `taxonomy.levels[level].label`. */
  label: string;
  size?: 'compact' | 'full';
  /** What the level measures, for screen readers ("Difficulty: L2 Intermediate"). */
  caption?: string;
  className?: string;
}) {
  const n = Math.min(4, Math.max(0, Math.round(level)));
  const full = size === 'full';
  return (
    <span
      role="img"
      aria-label={`${caption}: L${n} ${label}`}
      className={cn('inline-flex items-center', full ? 'w-full gap-3' : 'gap-2', className)}
    >
      <span className={cn('flex', full ? 'flex-1 gap-1' : 'gap-0.5')}>
        {SEGMENTS.map((i) => (
          <span
            key={i}
            className={cn(
              'rounded-full',
              full ? 'h-1.5 flex-1' : 'h-1.5 w-2.5',
              i <= n ? FILL[n] : 'bg-muted-foreground/20',
            )}
          />
        ))}
      </span>
      <span className={cn('inline-flex items-baseline gap-1 whitespace-nowrap text-xs font-medium', TEXT[n])}>
        <span className="font-mono tabular-nums">L{n}</span>
        <span>{label}</span>
      </span>
    </span>
  );
}
