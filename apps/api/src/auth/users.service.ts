import { Inject, Injectable } from '@nestjs/common';
import { users, type Db } from '@attn/core';
import { httpUrlOrNull } from '@attn/shared';
import { DB } from '../tokens';
import type { GithubProfile } from './github.client';

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Insert on first login; refresh login, name and avatar on later ones. Role keeps its default ('dev').
   * A non-http(s) avatar is stored as null: the web renders it as an image source and `meSchema` rejects it.
   */
  async upsertGithubUser(p: GithubProfile): Promise<{ id: string }> {
    const avatarUrl = httpUrlOrNull(p.avatarUrl);
    const [row] = await this.db
      .insert(users)
      .values({ githubId: p.id, login: p.login, name: p.name, avatarUrl })
      .onConflictDoUpdate({ target: users.githubId, set: { login: p.login, name: p.name, avatarUrl } })
      .returning({ id: users.id });
    if (!row) throw new Error('user upsert returned no row');
    return row;
  }
}
