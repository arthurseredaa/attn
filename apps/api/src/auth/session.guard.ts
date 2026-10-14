import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { SESSION_COOKIE, parseCookies, type AuthedRequest } from './session';
import { SessionService } from './session.service';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const user = token ? await this.sessions.findUser(token) : null;
    if (!user) throw new UnauthorizedException('Sign in required');
    req.user = user;
    return true;
  }
}
