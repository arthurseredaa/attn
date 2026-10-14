import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb } from '@attn/core';
import type { Env } from '../config/env';
import { DB, DB_HANDLE, ENV } from '../tokens';

type DbHandle = ReturnType<typeof createDb>;

@Injectable()
export class DbLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}

@Global()
@Module({
  providers: [
    { provide: DB_HANDLE, inject: [ENV], useFactory: (env: Env) => createDb(env.databaseUrl) },
    { provide: DB, inject: [DB_HANDLE], useFactory: (handle: DbHandle) => handle.db },
    DbLifecycle,
  ],
  exports: [DB, DB_HANDLE],
})
export class DbModule {}
