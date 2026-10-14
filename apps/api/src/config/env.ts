import { z } from 'zod';

export interface Env {
  databaseUrl: string;
  port: number;
  labelModel: string | undefined;
  googleApiKey: string | undefined;
  scheduleEnabled: boolean;
}

// Empty strings count as unset, so a copied .env.example (empty values) loads.
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);
const optionalString = z.preprocess(blankToUndefined, z.string().optional());

const envSchema = z.object({
  DATABASE_URL: z.preprocess(
    blankToUndefined,
    z.string({ error: 'DATABASE_URL is required' }).min(1, 'DATABASE_URL is required'),
  ),
  PORT: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(65535).default(3001)),
  LABEL_MODEL: optionalString,
  GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
  SCHEDULE_ENABLED: z.preprocess(
    blankToUndefined,
    z
      .string()
      .optional()
      .transform((v) => v !== 'false' && v !== '0'),
  ),
});

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'env'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    labelModel: e.LABEL_MODEL,
    googleApiKey: e.GOOGLE_GENERATIVE_AI_API_KEY,
    scheduleEnabled: e.SCHEDULE_ENABLED,
  };
}
