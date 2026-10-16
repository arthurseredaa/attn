import { Inject, Injectable } from '@nestjs/common';
import { articleSkills, articles, type Db } from '@attn/core';
import { articlesPageSchema, escapeLike, resolveDateRange, taxonomySkillIds, type ArticleCard, type ArticlesPage, type ArticlesQuery, type Config, type Source, type Taxonomy } from '@attn/shared';
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { assertKnownSkills } from '../common/skill-filter';
import { APP_CONFIG, DB, SOURCES, TAXONOMY } from '../tokens';
import { decodeCursor, encodeCursor } from './cursor';

@Injectable()
export class ArticlesService {
  private readonly sourceNames: Map<string, string>;
  /** The configured sources (data/sources.yml): articles of a source dropped from the config are not listed. */
  private readonly sourceIds: string[];
  private readonly skillNames: Map<string, string>;
  private readonly skillIds: ReadonlySet<string>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SOURCES) sources: Source[],
    @Inject(TAXONOMY) taxonomy: Taxonomy,
    @Inject(APP_CONFIG) private readonly config: Config,
  ) {
    this.sourceNames = new Map(sources.map((s) => [s.id, s.name]));
    this.sourceIds = sources.map((s) => s.id);
    this.skillIds = new Set(taxonomySkillIds(taxonomy));
    this.skillNames = new Map(taxonomy.domains.flatMap((d) => d.skills.map((s) => [s.id, s.name] as const)));
  }

  async list(query: ArticlesQuery): Promise<ArticlesPage> {
    const limit = query.limit ?? this.config.page_size;
    const { from, toExclusive } = resolveDateRange(query);
    // Only http(s) urls are served (the card schema rejects anything else); filtering in SQL keeps page sizes and cursors exact.
    const conds: SQL[] = [
      eq(articles.labelStatus, 'labeled'),
      sql`${articles.url} ~* '^https?://'`,
      inArray(articles.sourceId, this.sourceIds),
    ];
    if (query.source) conds.push(eq(articles.sourceId, query.source));
    assertKnownSkills(query.skill, this.skillIds);
    if (query.skill?.length) {
      // any-match on primary or secondary
      conds.push(sql`exists (select 1 from ${articleSkills} where ${articleSkills.articleId} = ${articles.id} and ${inArray(articleSkills.skillId, query.skill)})`);
    }
    if (query.q) conds.push(sql`${articles.title} ilike ${`%${escapeLike(query.q)}%`}`);
    if (from) conds.push(gte(articles.publishedAt, from));
    if (toExclusive) conds.push(lt(articles.publishedAt, toExclusive));
    if (query.cursor) {
      const c = decodeCursor(query.cursor); // InvalidCursorError is mapped to 400 by the controller
      conds.push(sql`(${articles.publishedAt}, ${articles.id}) < (${c.publishedAt.toISOString()}::timestamptz, ${c.id})`);
    }

    const rows = await this.db
      .select({
        id: articles.id, sourceId: articles.sourceId, url: articles.url, title: articles.title,
        publishedAt: articles.publishedAt, wordCount: articles.wordCount,
        difficulty: articles.difficulty, type: articles.type, quality: articles.quality,
      })
      .from(articles)
      .where(and(...conds))
      .orderBy(desc(articles.publishedAt), desc(articles.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const skillRows = page.length
      ? await this.db.select().from(articleSkills).where(inArray(articleSkills.articleId, page.map((r) => r.id)))
      : [];

    const items: ArticleCard[] = page.map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      sourceId: r.sourceId,
      sourceName: this.sourceNames.get(r.sourceId) ?? r.sourceId,
      publishedAt: r.publishedAt.toISOString(),
      wordCount: r.wordCount,
      difficulty: r.difficulty ?? 0,
      type: r.type ?? 'news',
      quality: r.quality ?? 0,
      skills: skillRows
        .filter((s) => s.articleId === r.id)
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.skillId.localeCompare(b.skillId))
        .map((s) => ({ id: s.skillId, name: this.skillNames.get(s.skillId) ?? s.skillId, isPrimary: s.isPrimary })),
    }));

    // Cursor precision is milliseconds: safe because every published_at write comes from a JS Date.
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? encodeCursor({ publishedAt: last.publishedAt, id: last.id }) : null;
    // Unreachable failure after the SQL filter; if it ever fires it is a logged 500 via the exception filter.
    return articlesPageSchema.parse({ items, nextCursor });
  }
}
