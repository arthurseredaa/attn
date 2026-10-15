import { LevelMeter } from '@/components/level-meter';

/** An article's difficulty (0–4) on the shared level colour ramp, labelled from the taxonomy. */
export function DifficultyMeter({ difficulty, label, className }: { difficulty: number; label: string; className?: string }) {
  return <LevelMeter level={difficulty} label={label} size="compact" caption="Difficulty" className={className} />;
}
