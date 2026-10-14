import { Inject, Injectable } from '@nestjs/common';
import type { Ranker } from '@attn/core';
import type { Config, FeedPage } from '@attn/shared';
import type { AuthUser } from '../auth/session';
import { APP_CONFIG, RANKER } from '../tokens';

@Injectable()
export class FeedService {
  constructor(
    @Inject(RANKER) private readonly ranker: Ranker,
    @Inject(APP_CONFIG) private readonly config: Config,
  ) {}

  async get(user: AuthUser, offset: number): Promise<FeedPage> {
    const size = this.config.page_size;
    const rows = await this.ranker.rank(user.id, { limit: size + 1, offset });
    return { items: rows.slice(0, size), nextOffset: rows.length > size ? offset + size : null };
  }
}
