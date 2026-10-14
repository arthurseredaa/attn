import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { AppValidationError } from './zod';
import type { Request, Response } from 'express';

const CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  422: 'unprocessable_entity',
  429: 'too_many_requests',
  503: 'service_unavailable',
};

export function errorCodeForStatus(status: number): string {
  return CODES[status] ?? (status >= 500 ? 'internal_error' : 'error');
}

/** http-errors style errors (body-parser's 413 etc.) that are safe to show to the client. */
function exposedClientStatus(e: unknown): number | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const o = e as { status?: unknown; statusCode?: unknown; expose?: unknown };
  const status = typeof o.status === 'number' ? o.status : o.statusCode;
  return o.expose === true && typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 499
    ? status
    : undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request | undefined>();
    if (res.headersSent) return;
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
      // Nest turns body-parser's SyntaxError into a plain BadRequestException carrying V8's
      // parser text (which echoes input); the only signals left are status, JSON content type and text.
      const malformed =
        status === 400 && !(exception instanceof AppValidationError) && Boolean(req?.is?.('json')) && /JSON at position|Unexpected end of JSON|Unexpected token|is not valid JSON/.test(text) && Object.keys(extra).length === 0;
      res.status(status).json({
        error: errorCodeForStatus(status),
        message: malformed ? 'Malformed JSON body' : text, ...extra,
      });
      return;
    }
    const clientStatus = exposedClientStatus(exception);
    if (clientStatus !== undefined) {
      const message = (exception as { message?: unknown }).message;
      res.status(clientStatus).json({
        error: errorCodeForStatus(clientStatus),
        message: typeof message === 'string' ? message : 'Bad request',
      });
      return;
    }
    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(500).json({ error: 'internal_error', message: 'Internal server error' });
  }
}
