import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, parseCookies, sessionCookieOptions } from './session';
import { testEnv } from '../test/app';

describe('session helpers', () => {
  it('hashToken is sha256 hex', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('generateToken is url-safe, 43 chars and unique', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });
  it('parseCookies handles several cookies, decoding and junk', () => {
    expect(parseCookies('a=1; attn_session=abc%20d; b=')).toEqual({ a: '1', attn_session: 'abc d', b: '' });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('novalue; =x; ok=1')).toEqual({ ok: '1' });
    expect(parseCookies('bad=%E0%A4%A')).toEqual({ bad: '%E0%A4%A' });
  });
  it('sessionCookieOptions follows env.cookieSecure', () => {
    expect(sessionCookieOptions(testEnv({ cookieSecure: true }))).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect(sessionCookieOptions(testEnv({ cookieSecure: false })).secure).toBe(false);
  });
});
