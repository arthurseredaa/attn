import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Request } from 'express';
import type { Me } from '@attn/shared';
import type { Env } from '../config/env';

export const SESSION_COOKIE = 'attn_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthUser = Me;
export type AuthedRequest = Request & { user?: AuthUser };

export const generateToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    if (!name) continue;
    const raw = part.slice(i + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

export function sessionCookieOptions(env: Env): CookieOptions {
  return { httpOnly: true, secure: env.cookieSecure, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_MS };
}
