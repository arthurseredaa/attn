import { Injectable, UnsupportedMediaTypeException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Defense in depth for state-changing routes with a body: only `application/json` (parameters such as
 * `; charset=utf-8` allowed) is accepted, so a cross-site form post (urlencoded, multipart, text/plain) is refused
 * with 415. List it after SessionGuard so an anonymous request still gets 401 first.
 */
@Injectable()
export class JsonBodyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.is('application/json') !== 'application/json') {
      throw new UnsupportedMediaTypeException('Content-Type must be application/json');
    }
    return true;
  }
}
