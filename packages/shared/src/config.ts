import { z } from 'zod';

const posInt = z.number().int().positive();
const level = z.number().int().min(0).max(4);
const unitInterval = z.number().gt(0).lte(1);

/** Label fields a `<main>+<secondary>` combo can take from the secondary model; the rest stay main's. */
export const comboFieldSchema = z.enum(['secondary_skills', 'difficulty', 'quality', 'type']);
export type ComboField = z.infer<typeof comboFieldSchema>;

export const configSchema = z.strictObject({
  backfill_days: posInt,
  label_batch: posInt,
  label_delay_ms: posInt,
  label_max_chars: posInt,
  label_min_chars: posInt,
  label_max_attempts: posInt,
  label_overload_backoff_ms: z.array(posInt),
  jev_secondary_threshold: unitInterval,
  label_combo_fields: z
    .array(comboFieldSchema)
    .min(1)
    .refine((a) => new Set(a).size === a.length, 'duplicate field')
    .default(['secondary_skills']),
  relevance_threshold: unitInterval.default(0.5),
  schedule_cron: z.string().min(1),
  uncertain_spread: z.number().positive(),
  points_per_level: posInt,
  offset_k: posInt,
  interest_decay: unitInterval,
  interest_min: unitInterval,
  quality_min: level,
  background_quality_min: level,
  fresh_days: posInt,
  page_size: posInt,
  background_priority: unitInterval,
  fit_next: unitInterval,
  fit_same: unitInterval,
  fit_stretch: unitInterval,
});
export type Config = z.infer<typeof configSchema>;
