import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ArticleNotFoundError, recordEvent, type Db } from '@attn/core';
import type { Config, EventKind, EventResponse } from '@attn/shared';
import type { AuthUser } from '../auth/session';
import { APP_CONFIG, DB } from '../tokens';

@Injectable()
export class EventsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: Config,
  ) {}

  async record(user: AuthUser, articleId: number, kind: EventKind): Promise<EventResponse> {
    try {
      const r = await recordEvent(this.db, { userId: user.id, articleId, kind }, this.config);
      return { kind, recorded: r.recorded };
    } catch (e) {
      if (e instanceof ArticleNotFoundError) throw new NotFoundException('Article not found');
      throw e;
    }
  }
}
