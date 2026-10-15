import { LevelMeter } from '@/components/level-meter';
import { cn } from '@/lib/utils';

/** An article's difficulty (0–4): its taxonomy label in small mono text, then the five-segment bar. */
export function DifficultyMeter({ difficulty, label, className }: { difficulty: number; label: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={`Difficulty: ${label}`}
      className={cn('inline-flex items-center gap-2 text-[11.5px] whitespace-nowrap text-muted-foreground', className)}
    >
      <span aria-hidden className="font-mono">
        {label}
      </span>
      <LevelMeter level={difficulty} />
    </span>
  );
}
