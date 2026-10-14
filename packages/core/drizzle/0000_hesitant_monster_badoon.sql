CREATE TYPE "public"."article_type" AS ENUM('release', 'tutorial', 'deep_dive', 'news', 'research');--> statement-breakpoint
CREATE TYPE "public"."event_kind" AS ENUM('read', 'like', 'too_easy', 'too_hard', 'not_interested');--> statement-breakpoint
CREATE TYPE "public"."label_status" AS ENUM('pending', 'labeled', 'failed');--> statement-breakpoint
CREATE TABLE "article_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "article_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"article_id" integer NOT NULL,
	"kind" "event_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_events_user_article_kind_unique" UNIQUE("user_id","article_id","kind")
);
--> statement-breakpoint
CREATE TABLE "article_skills" (
	"article_id" integer NOT NULL,
	"skill_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "article_skills_article_id_skill_id_pk" PRIMARY KEY("article_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "articles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" text NOT NULL,
	"url" text NOT NULL,
	"guid" text NOT NULL,
	"title" text NOT NULL,
	"title_hash" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"word_count" integer,
	"label_status" "label_status" DEFAULT 'pending' NOT NULL,
	"label_attempts" integer DEFAULT 0 NOT NULL,
	"difficulty" integer,
	"type" "article_type",
	"quality" integer,
	"label_model" text,
	"labeled_at" timestamp with time zone,
	"taxonomy_version" integer,
	CONSTRAINT "articles_url_unique" UNIQUE("url"),
	CONSTRAINT "articles_difficulty_range" CHECK ("articles"."difficulty" between 0 and 4),
	CONSTRAINT "articles_quality_range" CHECK ("articles"."quality" between 0 and 4)
);
--> statement-breakpoint
CREATE TABLE "quiz_answers" (
	"user_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"first_option" integer NOT NULL,
	"second_option" integer NOT NULL,
	"quiz_version" integer NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "quiz_answers_user_id_question_id_pk" PRIMARY KEY("user_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_state" (
	"source_id" text PRIMARY KEY NOT NULL,
	"etag" text,
	"last_modified" text,
	"last_run_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "user_skills" (
	"user_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"level" integer,
	"uncertain" boolean DEFAULT false NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"focus_rank" integer,
	"interest" real DEFAULT 1 NOT NULL,
	"difficulty_offset" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_skills_user_id_skill_id_pk" PRIMARY KEY("user_id","skill_id"),
	CONSTRAINT "user_skills_level_range" CHECK ("user_skills"."level" between 0 and 4),
	CONSTRAINT "user_skills_focus_rank_range" CHECK ("user_skills"."focus_rank" between 1 and 5),
	CONSTRAINT "user_skills_difficulty_offset_range" CHECK ("user_skills"."difficulty_offset" between -1 and 1)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"login" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"role" text DEFAULT 'dev' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
ALTER TABLE "article_events" ADD CONSTRAINT "article_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_events" ADD CONSTRAINT "article_events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_skills" ADD CONSTRAINT "article_skills_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_skills_one_primary_idx" ON "article_skills" USING btree ("article_id") WHERE "article_skills"."is_primary";--> statement-breakpoint
CREATE INDEX "articles_guid_idx" ON "articles" USING btree ("guid");--> statement-breakpoint
CREATE INDEX "articles_title_hash_idx" ON "articles" USING btree ("title_hash");--> statement-breakpoint
CREATE INDEX "articles_published_at_idx" ON "articles" USING btree ("published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "articles_label_status_published_at_idx" ON "articles" USING btree ("label_status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_skills_focus_rank_idx" ON "user_skills" USING btree ("user_id","focus_rank") WHERE "user_skills"."focus_rank" is not null;