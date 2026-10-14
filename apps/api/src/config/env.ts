import { z } from 'zod';

export interface Env {
  databaseUrl: string;
  port: number;
  labelModel: string | undefined;
  googleApiKey: string | undefined;
  scheduleEnabled: boolean;
  appUrl: string;
  githubClientId: string | undefined;
  githubClientSecret: string | undefined;
  githubOauthBaseUrl: string;
  githubApiBaseUrl: string;
  cookieSecure: boolean;
}

// Empty strings count as unset, so a copied .env.example (empty values) loads.
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);
const optionalString = z.preprocess(blankToUndefined, z.string().optional());

const stripSlashes = (s: string) => s.replace(/\/+$/, '');
const urlString = (def: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string()
      .default(def)
      .refine((v) => URL.canParse(v) && ['http:', 'https:'].includes(new URL(v).protocol), 'must be an http(s) URL')
      .transform(stripSlashes),
  );

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
  APP_URL: urlString('http://localhost:3000'),
  GITHUB_CLIENT_ID: optionalString,
  GITHUB_CLIENT_SECRET: optionalString,
  GITHUB_OAUTH_BASE_URL: urlString('https://github.com'),
  GITHUB_API_BASE_URL: urlString('https://api.github.com'),
  COOKIE_SECURE: z.preprocess(blankToUndefined, z.enum(['true', 'false', '1', '0']).optional()),
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
    appUrl: e.APP_URL,
    githubClientId: e.GITHUB_CLIENT_ID,
    githubClientSecret: e.GITHUB_CLIENT_SECRET,
    githubOauthBaseUrl: e.GITHUB_OAUTH_BASE_URL,
    githubApiBaseUrl: e.GITHUB_API_BASE_URL,
    // Secure by default (spec §6.5); only an explicit false/0 turns it off.
    cookieSecure: !(e.COOKIE_SECURE === 'false' || e.COOKIE_SECURE === '0'),
  };
}

export function describeInsecureCookies(env: Env): string | null {
  return env.cookieSecure
    ? null
    : 'COOKIE_SECURE=false: session cookies are sent without the Secure flag. Use this for local http development only.';
}
