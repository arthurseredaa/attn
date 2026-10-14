import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

const CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable_entity',
  429: 'too_many_requests',
  503: 'service_unavailable',
};

export function errorCodeForStatus(status: number): string {
  return CODES[status] ?? (status >= 500 ? 'internal_error' : 'error');
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const obj = typeof raw === 'string' ? { message: raw } : (raw as Record<string, unknown>);
      const extra = { ...obj };
      const { message } = obj;
      delete extra.statusCode;
      delete extra.error;
      delete extra.message;
      const text = Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : exception.message;
      res.status(status).json({ error: errorCodeForStatus(status), message: text, ...extra });
      return;
    }
    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(500).json({ error: 'internal_error', message: 'Internal server error' });
  }
}
