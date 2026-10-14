import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Db } from '@attn/core';
import { TEST_DATABASE_URL } from '@attn/core/testing';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import type { Env } from '../config/env';
import { DB, ENV } from '../tokens';

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    databaseUrl: TEST_DATABASE_URL,
    port: 0,
    labelModel: undefined,
    googleApiKey: undefined,
    scheduleEnabled: false,
    appUrl: 'http://localhost:3000',
    githubClientId: undefined,
    githubClientSecret: undefined,
    githubOauthBaseUrl: 'http://127.0.0.1:1',
    githubApiBaseUrl: 'http://127.0.0.1:1',
    cookieSecure: false, // explicit: tests run over plain http (production default is true)
    ...overrides,
  };
}

export interface TestApp {
  app: INestApplication;
  moduleRef: TestingModule;
  base: string;
  db: Db;
  close(): Promise<void>;
}

export async function startTestApp(overrides: Partial<Env> = {}): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(testEnv(overrides))
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0);
  return {
    app,
    moduleRef,
    base: await app.getUrl(),
    db: moduleRef.get<Db>(DB, { strict: false }),
    close: () => app.close(),
  };
}
