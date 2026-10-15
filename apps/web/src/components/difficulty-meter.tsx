import { LevelMeter } from '@/components/level-meter';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * An article's difficulty (0–4): its taxonomy label in small mono text, then the five-segment bar. `compact` (dense
 * rows) shows thin bars only; the label stays as the accessible name and a tooltip.
 */
export function DifficultyMeter({
  difficulty,
  label,
  compact = false,
  className,
}: {
  difficulty: number;
  label: string;
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span role="img" aria-label={`Difficulty: ${label}`} className={cn('inline-flex', className)}>
            <LevelMeter level={difficulty} className="[&>span]:w-[3px] [&>span]:rounded-none" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }
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
