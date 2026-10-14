import type { ArticleCard, Config, Source, Taxonomy } from '@attn/shared';

export interface RankParams {
  limit: number;
  offset: number;
}

export interface Ranker {
  rank(userId: string, params: RankParams): Promise<ArticleCard[]>;
}

export type RankConfig = Pick<
  Config,
  'quality_min' | 'background_quality_min' | 'fresh_days' | 'background_priority' | 'fit_next' | 'fit_same' | 'fit_stretch'
>;

export interface ScoredCard {
  card: ArticleCard;
  score: number;
}

export interface RankDeps {
  config: RankConfig;
  sources: Source[];
  taxonomy: Taxonomy;
  now?: () => Date;
}
