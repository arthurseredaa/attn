import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Env } from '../config/env';
import { ENV } from '../tokens';

export interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export class GithubError extends Error {}

const tokenSchema = z.object({ access_token: z.string().min(1) });
const userSchema = z.object({
  id: z.number().int(),
  login: z.string().min(1),
  name: z.string().nullish(),
  avatar_url: z.string().nullish(),
});

const TIMEOUT_MS = 10_000;

@Injectable()
export class GithubClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  isConfigured(): boolean {
    return Boolean(this.env.githubClientId && this.env.githubClientSecret);
  }

  redirectUri(): string {
    return `${this.env.appUrl}/api/auth/github/callback`;
  }

  authorizeUrl(state: string): string {
    const u = new URL(`${this.env.githubOauthBaseUrl}/login/oauth/authorize`);
    u.searchParams.set('client_id', this.env.githubClientId ?? '');
    u.searchParams.set('redirect_uri', this.redirectUri());
    u.searchParams.set('state', state);
    return u.toString();
  }

  async exchangeCode(code: string): Promise<string> {
    const json = await this.request(`${this.env.githubOauthBaseUrl}/login/oauth/access_token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'attn' },
      body: JSON.stringify({
        client_id: this.env.githubClientId,
        client_secret: this.env.githubClientSecret,
        code,
        redirect_uri: this.redirectUri(),
      }),
    });
    const parsed = tokenSchema.safeParse(json);
    if (!parsed.success) throw new GithubError('token exchange did not return an access_token');
    return parsed.data.access_token;
  }

  async fetchUser(accessToken: string): Promise<GithubProfile> {
    const json = await this.request(`${this.env.githubApiBaseUrl}/user`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${accessToken}`, 'user-agent': 'attn' },
    });
    const parsed = userSchema.safeParse(json);
    if (!parsed.success) throw new GithubError('unexpected /user response');
    const u = parsed.data;
    return { id: u.id, login: u.login, name: u.name ?? null, avatarUrl: u.avatar_url ?? null };
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new GithubError(`GitHub answered ${res.status}`);
      return (await res.json()) as unknown;
    } catch (e) {
      throw e instanceof GithubError ? e : new GithubError(e instanceof Error ? e.message : String(e));
    }
  }
}
