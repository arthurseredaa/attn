import { sql } from 'drizzle-orm';
import { escapeLike, MAX_FOCUS, type ArticleCard, type ArticleType } from '@attn/shared';
import type { Db } from '../db/client';
import { MAX_LEVEL, UNASSESSED_LEVEL } from '../levels/scale';
import type { RankDeps, RankParams, Ranker, ScoredCard } from './types';

interface Row {
  id: number;
  source_id: string;
  url: string;
  title: string;
  published_at: string; // raw db.execute returns timestamptz as a string
  word_count: number | null;
  difficulty: number;
  type: ArticleType;
  quality: number;
  score_f: number;
  skills: { id: string; isPrimary: boolean }[];
}

/** Article quality uses the same 0-4 scale as levels (`levelSchema`); score divides by its top. */
const MAX_QUALITY = 4;

// Structural constants (not tunables) inlined as literals, so the ranker and applyReadPoint cannot drift apart.
const MAX_FOCUS_SQL = sql.raw(String(MAX_FOCUS));
const UNASSESSED_LEVEL_SQL = sql.raw(String(UNASSESSED_LEVEL));
const MAX_LEVEL_SQL = sql.raw(String(MAX_LEVEL));
const MAX_QUALITY_SQL = sql.raw(String(MAX_QUALITY));

function assertPaging(limit: number, offset: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError(`limit must be an integer 1..1000, got ${limit}`);
  if (!Number.isInteger(offset) || offset < 0) throw new RangeError(`offset must be an integer >= 0, got ${offset}`);
}

export class SqlRanker implements Ranker {
  private readonly sourceNames: Map<string, string>;
  private readonly skillNames: Map<string, string>;
  constructor(
    private readonly db: Db,
    private readonly deps: RankDeps,
  ) {
    this.sourceNames = new Map(deps.sources.map((s) => [s.id, s.name]));
    this.skillNames = new Map(deps.taxonomy.domains.flatMap((d) => d.skills.map((k) => [k.id, k.name] as const)));
  }

  async rank(userId: string, p: RankParams): Promise<ArticleCard[]> {
    return (await this.rankScored(userId, p)).map((s) => s.card);
  }

  async rankScored(userId: string, { limit, offset, skills, q }: RankParams): Promise<ScoredCard[]> {
    assertPaging(limit, offset);
    const c = this.deps.config;
    const now = (this.deps.now ?? (() => new Date()))();
    const freshSince = new Date(now.getTime() - c.fresh_days * 86_400_000).toISOString();
    // Filters sit in the eligibility WHERE, before scoring, ordering and paging, so offsets stay consistent.
    // Values are bind parameters; the only raw SQL is fixed text.
    const skillFilter = skills?.length
      ? sql`and exists (select 1 from article_skills f where f.article_id = a.id
                        and f.skill_id = any(array[${sql.join(skills.map((k) => sql`${k}`), sql`, `)}]::text[]))`
      : sql``;
    const titleFilter = q ? sql`and a.title ilike ${`%${escapeLike(q)}%`}` : sql``;
    // Only the configured sources: articles of a source dropped from data/sources.yml stop ranking.
    const sourceIds = sql`array[${sql.join(
      this.deps.sources.map((s) => sql`${s.id}`),
      sql`, `,
    )}]::text[]`;
    const rows = (await this.db.execute(sql`
      with cand as (
        select a.id, a.source_id, a.url, a.title, a.published_at, a.word_count,
               a.difficulty, a.type, a.quality,
               us.focus_rank, us.interest::numeric as interest,
               least(coalesce(us.level, ${UNASSESSED_LEVEL_SQL}) + us.difficulty_offset, ${MAX_LEVEL_SQL}) as t,
               (us.level is null or us.uncertain) as unc
        from articles a
        join article_skills p on p.article_id = a.id and p.is_primary
        join user_skills us on us.user_id = ${userId}::uuid and us.skill_id = p.skill_id
        where a.label_status = 'labeled'
          and a.url ~* '^https?://'
          and a.source_id = any(${sourceIds})
          and a.quality >= ${c.quality_min}::int
          and (us.focus_rank is not null or a.quality >= ${c.background_quality_min}::int)
          and (a.type not in ('release', 'news') or a.published_at >= ${freshSince}::timestamptz)
          ${skillFilter}
          ${titleFilter}
          and not exists (
            select 1 from article_events e
            where e.user_id = ${userId}::uuid and e.article_id = a.id and e.kind in ('read', 'not_interested'))
      )
      , scored as (
        select cand.*,
          (case when cand.focus_rank is not null
                then (${MAX_FOCUS_SQL}::numeric + 1 - cand.focus_rank) / ${MAX_FOCUS_SQL}::numeric
                else ${c.background_priority}::numeric end)
          * cand.interest
          * (case when cand.difficulty = cand.t + 1 then ${c.fit_next}::numeric
                  when cand.difficulty = cand.t then ${c.fit_same}::numeric
                  else ${c.fit_stretch}::numeric end)
          * cand.quality / ${MAX_QUALITY_SQL} as score
        from cand
        where cand.difficulty between (case when cand.unc then cand.t - 1 else cand.t end)
                                  and (case when cand.unc then cand.t + 2 else cand.t + 1 end)
      )
      select s.id, s.source_id, s.url, s.title, s.published_at, s.word_count,
             s.difficulty, s.type, s.quality,
             s.score::float8 as score_f,
             (select coalesce(json_agg(json_build_object('id', k.skill_id, 'isPrimary', k.is_primary)
                                       order by k.is_primary desc, k.skill_id), '[]'::json)
              from article_skills k where k.article_id = s.id) as skills
      from scored s
      order by s.score desc, s.published_at desc, s.id desc
      limit ${limit}::int offset ${offset}::int`)) as unknown as Row[];
    return rows.map((r) => ({ card: this.toCard(r), score: r.score_f }));
  }

  private toCard(r: Row): ArticleCard {
    return {
      id: r.id,
      title: r.title,
      url: r.url,
      sourceId: r.source_id,
      sourceName: this.sourceNames.get(r.source_id) ?? r.source_id,
      publishedAt: new Date(String(r.published_at)).toISOString(),
      wordCount: r.word_count,
      difficulty: r.difficulty,
      type: r.type,
      quality: r.quality,
      skills: r.skills.map((k) => ({ id: k.id, name: this.skillNames.get(k.id) ?? k.id, isPrimary: k.isPrimary })),
    };
  }
}

export const createSqlRanker = (db: Db, deps: RankDeps): SqlRanker => new SqlRanker(db, deps);
