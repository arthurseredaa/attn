import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { articleTypeSchema, eventKindSchema, labelStatusSchema } from '@attn/shared';

export const labelStatus = pgEnum('label_status', labelStatusSchema.enum);
export const articleType = pgEnum('article_type', articleTypeSchema.enum);
export const eventKind = pgEnum('event_kind', eventKindSchema.enum);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubId: bigint('github_id', { mode: 'number' }).notNull().unique(),
  login: text('login').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  role: text('role').notNull().default('dev'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  expiresAt: timestamptz('expires_at').notNull(),
});

export const sourceState = pgTable('source_state', {
  sourceId: text('source_id').primaryKey(),
  etag: text('etag'),
  lastModified: text('last_modified'),
  lastRunAt: timestamptz('last_run_at'),
  lastError: text('last_error'),
  /** The feed url the validators belong to; validators are ignored when the source's url has changed. */
  feedUrl: text('feed_url'),
});

export const articles = pgTable(
  'articles',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    sourceId: text('source_id').notNull(),
    url: text('url').notNull().unique(),
    guid: text('guid').notNull(),
    title: text('title').notNull(),
    titleHash: text('title_hash').notNull(),
    publishedAt: timestamptz('published_at').notNull(),
    collectedAt: timestamptz('collected_at').notNull().defaultNow(),
    wordCount: integer('word_count'),
    labelStatus: labelStatus('label_status').notNull().default('pending'),
    labelAttempts: integer('label_attempts').notNull().default(0),
    difficulty: integer('difficulty'),
    type: articleType('type'),
    quality: integer('quality'),
    labelModel: text('label_model'),
    labeledAt: timestamptz('labeled_at'),
    taxonomyVersion: integer('taxonomy_version'),
    excludedReason: text('excluded_reason'),
    excludedAt: timestamptz('excluded_at'),
    /** Set by `attn unexclude`: the relevance gate no longer excludes this article. */
    relevanceOverride: boolean('relevance_override').notNull().default(false),
  },
  (t) => [
    index('articles_guid_idx').on(t.guid),
    index('articles_title_hash_idx').on(t.titleHash),
    index('articles_published_at_idx').on(t.publishedAt.desc()),
    index('articles_label_status_published_at_idx').on(t.labelStatus, t.publishedAt),
    check('articles_difficulty_range', sql`${t.difficulty} between 0 and 4`),
    check('articles_quality_range', sql`${t.quality} between 0 and 4`),
  ],
);

export const articleSkills = pgTable(
  'article_skills',
  {
    articleId: integer('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    skillId: text('skill_id').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.skillId] }),
    index('article_skills_skill_id_idx').on(t.skillId),
    uniqueIndex('article_skills_one_primary_idx').on(t.articleId).where(sql`${t.isPrimary}`),
  ],
);

export const userSkills = pgTable(
  'user_skills',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    skillId: text('skill_id').notNull(),
    level: integer('level'),
    uncertain: boolean('uncertain').notNull().default(false),
    points: integer('points').notNull().default(0),
    focusRank: integer('focus_rank'),
    interest: real('interest').notNull().default(1.0),
    difficultyOffset: integer('difficulty_offset').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.skillId] }),
    uniqueIndex('user_skills_focus_rank_idx')
      .on(t.userId, t.focusRank)
      .where(sql`${t.focusRank} is not null`),
    check('user_skills_level_range', sql`${t.level} between 0 and 4`),
    check('user_skills_focus_rank_range', sql`${t.focusRank} between 1 and 5`),
    check('user_skills_difficulty_offset_range', sql`${t.difficultyOffset} between -1 and 1`),
  ],
);

export const quizAnswers = pgTable(
  'quiz_answers',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    firstOption: integer('first_option').notNull(),
    secondOption: integer('second_option').notNull(),
    quizVersion: integer('quiz_version').notNull(),
    answeredAt: timestamptz('answered_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.questionId] })],
);

export const articleEvents = pgTable(
  'article_events',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    articleId: integer('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    kind: eventKind('kind').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [unique('article_events_user_article_kind_unique').on(t.userId, t.articleId, t.kind)],
);
