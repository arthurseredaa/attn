import { Inject, Injectable } from '@nestjs/common';
import { users, type Db } from '@attn/core';
import { DB } from '../tokens';
import type { GithubProfile } from './github.client';

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Insert on first login; refresh login, name and avatar on later ones. Role keeps its default ('dev'). */
  async upsertGithubUser(p: GithubProfile): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(users)
      .values({ githubId: p.id, login: p.login, name: p.name, avatarUrl: p.avatarUrl })
      .onConflictDoUpdate({ target: users.githubId, set: { login: p.login, name: p.name, avatarUrl: p.avatarUrl } })
      .returning({ id: users.id });
    if (!row) throw new Error('user upsert returned no row');
    return row;
  }
}
