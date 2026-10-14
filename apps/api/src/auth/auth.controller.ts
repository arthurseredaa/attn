import { Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Env } from '../config/env';
import { ENV } from '../tokens';
import { SESSION_COOKIE, parseCookies, sessionCookieOptions, type AuthedRequest } from './session';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await this.sessions.destroy(token);
    const clear = { ...sessionCookieOptions(this.env), maxAge: undefined };
    res.clearCookie(SESSION_COOKIE, clear);
  }
}
