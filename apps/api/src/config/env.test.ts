import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('applies defaults for a minimal environment', () => {
    expect(loadEnv({ DATABASE_URL: 'postgres://x' })).toEqual({
      databaseUrl: 'postgres://x',
      port: 3001,
      labelModel: undefined,
      googleApiKey: undefined,
      scheduleEnabled: true,
    });
  });

  it('treats empty strings as unset', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://x',
      LABEL_MODEL: '',
      GOOGLE_GENERATIVE_AI_API_KEY: '',
      PORT: '',
      SCHEDULE_ENABLED: '',
    });
    expect(env.labelModel).toBeUndefined();
    expect(env.googleApiKey).toBeUndefined();
    expect(env.port).toBe(3001);
    expect(env.scheduleEnabled).toBe(true);
  });

  it('parses provided values', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://x',
      LABEL_MODEL: 'm',
      GOOGLE_GENERATIVE_AI_API_KEY: 'k',
      PORT: '4000',
      SCHEDULE_ENABLED: 'false',
    });
    expect(env).toEqual({
      databaseUrl: 'postgres://x',
      port: 4000,
      labelModel: 'm',
      googleApiKey: 'k',
      scheduleEnabled: false,
    });
    expect(loadEnv({ DATABASE_URL: 'postgres://x', SCHEDULE_ENABLED: '0' }).scheduleEnabled).toBe(false);
  });

  it('throws naming DATABASE_URL when missing or empty', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('throws on a non-numeric PORT', () => {
    expect(() => loadEnv({ DATABASE_URL: 'postgres://x', PORT: 'abc' })).toThrow(/PORT/);
  });
});
