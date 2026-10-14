import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from '../test/app';
import { APP_CONFIG, DB } from '../tokens';

let running: TestApp | undefined;

async function start(overrides: Parameters<typeof startTestApp>[0] = {}): Promise<TestApp> {
  running = await startTestApp(overrides);
  return running;
}

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('health', () => {
  it('GET /api/health returns ok when the database is reachable', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', db: 'up' });
  });

  it('serves nothing outside the /api prefix and 404s unknown routes', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/health`)).status).toBe(404);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });

  it('responds 503 with db down when the database is unreachable', async () => {
    const { base } = await start({ databaseUrl: 'postgres://attn:attn@127.0.0.1:1/none' });
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('"db":"down"');
  });

  it('closes cleanly', async () => {
    await start();
    await expect(running!.close()).resolves.toBeUndefined();
    running = undefined;
  });

  it('resolves @Inject tokens under vitest', async () => {
    const { moduleRef } = await start();
    expect(moduleRef.get(DB, { strict: false })).toBeDefined();
    expect(moduleRef.get(APP_CONFIG, { strict: false }).schedule_cron.length).toBeGreaterThan(0);
  });
});
