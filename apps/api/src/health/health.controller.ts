import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Db } from '@attn/core';
import { sql } from 'drizzle-orm';
import { DB } from '../tokens';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async check(): Promise<{ status: 'ok'; db: 'up' }> {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }
    return { status: 'ok', db: 'up' };
  }
}
