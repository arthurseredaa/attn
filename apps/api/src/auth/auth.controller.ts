import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, HttpCode, Inject, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthErrorCode } from '@attn/shared';
import type { Env } from '../config/env';
import { ENV } from '../tokens';
import { GithubClient } from './github.client';
import { SESSION_COOKIE, generateToken, parseCookies, sessionCookieOptions, type AuthedRequest } from './session';
import { SessionService } from './session.service';
import { UsersService } from './users.service';

export const OAUTH_STATE_COOKIE = 'attn_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error';
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(GithubClient) private readonly github: GithubClient,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  private stateCookieOptions() {
    return { httpOnly: true, secure: this.env.cookieSecure, sameSite: 'lax' as const, path: '/api/auth' };
  }

  private fail(res: Response, code: AuthErrorCode): void {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.clearCookie(OAUTH_STATE_COOKIE, this.stateCookieOptions());
    res.redirect(302, `${this.env.appUrl}/?auth_error=${code}`);
  }

  @Get('github')
  start(@Res() res: Response): void {
    if (!this.github.isConfigured()) return this.fail(res, 'not_configured');
    const state = generateToken();
    res.cookie(OAUTH_STATE_COOKIE, state, { ...this.stateCookieOptions(), maxAge: STATE_TTL_MS });
    res.redirect(302, this.github.authorizeUrl(state));
  }

  @Get('github/callback')
  async callback(
    @Query() query: Record<string, unknown>,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const cookies = parseCookies(req.headers.cookie);
    const expected = cookies[OAUTH_STATE_COOKIE];
    const state = typeof query.state === 'string' ? query.state : undefined;
    if (!expected || !state || !safeEqual(expected, state)) return this.fail(res, 'state_mismatch');
    if (query.error === 'access_denied') return this.fail(res, 'access_denied');
    const code = typeof query.code === 'string' && query.code ? query.code : undefined;
    if (typeof query.error === 'string' || !code) return this.fail(res, 'oauth_failed');
    try {
      const profile = await this.github.fetchUser(await this.github.exchangeCode(code));
      const user = await this.users.upsertGithubUser(profile);
      // best-effort housekeeping: must never block a login
      await this.sessions
        .purgeExpired()
        .catch((e: unknown) => this.logger.warn(`session purge failed: ${errMessage(e)}`));
      const old = cookies[SESSION_COOKIE];
      if (old) await this.sessions.destroy(old); // no stale session survives a new login
      const { token } = await this.sessions.create(user.id);
      res.clearCookie(OAUTH_STATE_COOKIE, this.stateCookieOptions());
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.env));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.redirect(302, `${this.env.appUrl}/profile`);
    } catch (e) {
      // message only: never the code, state, tokens or query
      this.logger.warn(`oauth callback failed: ${errMessage(e)}`);
      this.fail(res, 'oauth_failed');
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await this.sessions.destroy(token);
    const clear = { ...sessionCookieOptions(this.env), maxAge: undefined };
    res.clearCookie(SESSION_COOKIE, clear);
  }
}
