import { Body, Controller, Get, HttpException, Logger, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureApp } from '../app.setup';
import { errorCodeForStatus } from './all-exceptions.filter';

@Controller('boom')
class BoomController {
  @Get('plain') plain(): never { throw new Error('secret internals'); }
  @Get('teapot') teapot(): never { throw new HttpException('short and stout', 418); }
  @Get('array') array(): never { throw new HttpException({ message: ['a bad', 'b bad'] }, 400); }
  @Get('string') str(): never { throw 'just a string'; }
  @Post('echo') echo(@Body() body: unknown): unknown { return body; }
  @Get('extra') extra(): never { throw new HttpException({ message: 'down', db: 'down' }, 503); }
}
@Module({ controllers: [BoomController] })
class BoomModule {}

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

async function start(): Promise<string> {
  const ref = await Test.createTestingModule({ imports: [BoomModule] }).compile();
  app = ref.createNestApplication();
  configureApp(app);
  await app.listen(0);
  return app.getUrl();
}

describe('AllExceptionsFilter', () => {
  it('maps statuses to snake_case codes', () => {
    expect(errorCodeForStatus(400)).toBe('bad_request');
    expect(errorCodeForStatus(401)).toBe('unauthorized');
    expect(errorCodeForStatus(404)).toBe('not_found');
    expect(errorCodeForStatus(503)).toBe('service_unavailable');
    expect(errorCodeForStatus(500)).toBe('internal_error');
    expect(errorCodeForStatus(413)).toBe('payload_too_large');
    expect(errorCodeForStatus(415)).toBe('unsupported_media_type');
    expect(errorCodeForStatus(418)).toBe('error');
  });

  it('renders unknown routes as JSON { error, message }', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'not_found', message: expect.any(String) });
  });

  it('hides the message of unexpected errors', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const base = await start();
    const res = await fetch(`${base}/api/boom/plain`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal_error', message: 'Internal server error' });
    expect(String(errorLog.mock.calls[0]?.[0])).toContain('secret internals');
  });

  it('keeps string messages and extra keys of HttpExceptions', async () => {
    const base = await start();
    expect(await (await fetch(`${base}/api/boom/teapot`)).json()).toEqual({ error: 'error', message: 'short and stout' });
    expect(await (await fetch(`${base}/api/boom/extra`)).json()).toEqual({
      error: 'service_unavailable',
      message: 'down',
      db: 'down',
    });
  });

  it('does not send x-powered-by', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/nope`);
    expect(res.headers.has('x-powered-by')).toBe(false);
  });

  it('joins array messages', async () => {
    const base = await start();
    const res = await fetch(`${base}/api/boom/array`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request', message: 'a bad; b bad' });
  });

  it('hides non-Error throws and logs them as strings', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const base = await start();
    const res = await fetch(`${base}/api/boom/string`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal_error', message: 'Internal server error' });
    expect(errorLog.mock.calls[0]?.[0]).toBe('just a string');
  });

  it('maps an oversized body to 413 payload_too_large without an error-level log', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const base = await start();
    const res = await fetch(`${base}/api/boom/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pad: 'x'.repeat(200 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large', message: expect.any(String) });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('replaces the raw parser message for malformed JSON', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const base = await start();
    const res = await fetch(`${base}/api/boom/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a": nope',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request', message: 'Malformed JSON body' });
    expect(errorLog).not.toHaveBeenCalled();
  });
});
