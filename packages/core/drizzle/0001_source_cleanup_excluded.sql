ALTER TYPE "public"."label_status" ADD VALUE 'excluded';--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "excluded_reason" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "excluded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "relevance_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "source_state" ADD COLUMN "feed_url" text;