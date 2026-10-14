import { describe, expect, it } from 'vitest';
import { describeInsecureCookies, loadEnv } from './env';

describe('loadEnv', () => {
  it('applies defaults for a minimal environment', () => {
    expect(loadEnv({ DATABASE_URL: 'postgres://x' })).toEqual({
      databaseUrl: 'postgres://x',
      port: 3001,
      labelModel: undefined,
      googleApiKey: undefined,
      scheduleEnabled: true,
      appUrl: 'http://localhost:3000',
      githubClientId: undefined,
      githubClientSecret: undefined,
      githubOauthBaseUrl: 'https://github.com',
      githubApiBaseUrl: 'https://api.github.com',
      cookieSecure: true,
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
      appUrl: 'http://localhost:3000',
      githubClientId: undefined,
      githubClientSecret: undefined,
      githubOauthBaseUrl: 'https://github.com',
      githubApiBaseUrl: 'https://api.github.com',
      cookieSecure: true,
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

describe('loadEnv auth settings', () => {
  const base = { DATABASE_URL: 'postgres://x' };

  it('cookieSecure is true by default, whatever the APP_URL scheme', () => {
    expect(loadEnv(base).cookieSecure).toBe(true);
    expect(loadEnv({ ...base, APP_URL: 'http://localhost:3000' }).cookieSecure).toBe(true);
    expect(loadEnv({ ...base, APP_URL: 'https://attn.example' }).cookieSecure).toBe(true);
    expect(loadEnv({ ...base, COOKIE_SECURE: '' }).cookieSecure).toBe(true);
  });

  it('only an explicit COOKIE_SECURE=false/0 disables it', () => {
    expect(loadEnv({ ...base, COOKIE_SECURE: 'false' }).cookieSecure).toBe(false);
    expect(loadEnv({ ...base, COOKIE_SECURE: '0' }).cookieSecure).toBe(false);
    expect(loadEnv({ ...base, COOKIE_SECURE: 'true' }).cookieSecure).toBe(true);
    expect(() => loadEnv({ ...base, COOKIE_SECURE: 'maybe' })).toThrow(/COOKIE_SECURE/);
  });

  it('describeInsecureCookies warns only when Secure is off', () => {
    expect(describeInsecureCookies(loadEnv(base))).toBeNull();
    expect(describeInsecureCookies(loadEnv({ ...base, COOKIE_SECURE: 'false' }))).toMatch(/COOKIE_SECURE=false/);
  });

  it('strips trailing slashes and rejects a non-http(s) APP_URL', () => {
    expect(loadEnv({ ...base, APP_URL: 'https://attn.example///' }).appUrl).toBe('https://attn.example');
    expect(() => loadEnv({ ...base, APP_URL: 'not a url' })).toThrow(/APP_URL/);
    expect(() => loadEnv({ ...base, APP_URL: 'localhost:3000' })).toThrow(/APP_URL/); // parses as scheme "localhost:"
    expect(() => loadEnv({ ...base, APP_URL: 'ftp://attn.example' })).toThrow(/APP_URL/);
  });

  it('reads GitHub settings and treats blanks as unset', () => {
    const env = loadEnv({
      ...base,
      GITHUB_CLIENT_ID: 'id',
      GITHUB_CLIENT_SECRET: '',
      GITHUB_OAUTH_BASE_URL: 'http://127.0.0.1:9/',
      GITHUB_API_BASE_URL: 'http://127.0.0.1:9',
    });
    expect(env.githubClientId).toBe('id');
    expect(env.githubClientSecret).toBeUndefined();
    expect(env.githubOauthBaseUrl).toBe('http://127.0.0.1:9');
    expect(env.githubApiBaseUrl).toBe('http://127.0.0.1:9');
  });
});
