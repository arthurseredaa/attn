import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { TEST_DATABASE_URL } from '@attn/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import type { Env } from '../config/env';
import { APP_CONFIG, DB, ENV } from '../tokens';

const baseEnv: Env = {
  databaseUrl: TEST_DATABASE_URL,
  port: 0,
  labelModel: undefined,
  googleApiKey: undefined,
  scheduleEnabled: false,
};

let app: INestApplication | undefined;

async function start(env: Env) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0);
  return { moduleRef, base: await app.getUrl() };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('health', () => {
  it('GET /api/health returns ok when the database is reachable', async () => {
    const { base } = await start(baseEnv);
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', db: 'up' });
  });

  it('serves nothing outside the /api prefix and 404s unknown routes', async () => {
    const { base } = await start(baseEnv);
    expect((await fetch(`${base}/health`)).status).toBe(404);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });

  it('responds 503 with db down when the database is unreachable', async () => {
    const { base } = await start({ ...baseEnv, databaseUrl: 'postgres://attn:attn@127.0.0.1:1/none' });
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('"db":"down"');
  });

  it('closes cleanly', async () => {
    await start(baseEnv);
    await expect(app!.close()).resolves.toBeUndefined();
    app = undefined;
  });

  it('resolves @Inject tokens under vitest', async () => {
    const { moduleRef } = await start(baseEnv);
    expect(moduleRef.get(DB)).toBeDefined();
    expect(moduleRef.get(APP_CONFIG).schedule_cron.length).toBeGreaterThan(0);
  });
});
