import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser, AuthedRequest } from './session';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without SessionGuard');
  return user;
});
