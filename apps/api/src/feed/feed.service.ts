import { Inject, Injectable } from '@nestjs/common';
import type { Ranker } from '@attn/core';
import { taxonomySkillIds, type Config, type FeedPage, type FeedQuery, type Taxonomy } from '@attn/shared';
import type { AuthUser } from '../auth/session';
import { assertKnownSkills } from '../common/skill-filter';
import { APP_CONFIG, RANKER, TAXONOMY } from '../tokens';

@Injectable()
export class FeedService {
  private readonly skillIds: ReadonlySet<string>;

  constructor(
    @Inject(RANKER) private readonly ranker: Ranker,
    @Inject(APP_CONFIG) private readonly config: Config,
    @Inject(TAXONOMY) taxonomy: Taxonomy,
  ) {
    this.skillIds = new Set(taxonomySkillIds(taxonomy));
  }

  /** `offset` counts ranked cards that match the same `skill`/`q` filters, so a next page must repeat them. */
  async get(user: AuthUser, { offset, skill, q }: FeedQuery): Promise<FeedPage> {
    assertKnownSkills(skill, this.skillIds);
    const size = this.config.page_size;
    const rows = await this.ranker.rank(user.id, { limit: size + 1, offset, skills: skill, q });
    return { items: rows.slice(0, size), nextOffset: rows.length > size ? offset + size : null };
  }
}
