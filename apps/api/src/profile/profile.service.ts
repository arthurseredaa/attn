import { Inject, Injectable } from '@nestjs/common';
import { buildProfile, type Db } from '@attn/core';
import type { Config, Profile, Source, Taxonomy } from '@attn/shared';
import type { AuthUser } from '../auth/session';
import { APP_CONFIG, DB, SOURCES, TAXONOMY } from '../tokens';

@Injectable()
export class ProfileService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TAXONOMY) private readonly taxonomy: Taxonomy,
    @Inject(SOURCES) private readonly sources: Source[],
    @Inject(APP_CONFIG) private readonly config: Config,
  ) {}

  get(user: AuthUser): Promise<Profile> {
    return buildProfile(this.db, user.id, {
      role: user.role,
      taxonomy: this.taxonomy,
      sources: this.sources,
      pointsPerLevel: this.config.points_per_level,
    });
  }
}
