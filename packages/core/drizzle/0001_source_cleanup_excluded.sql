ALTER TYPE "public"."label_status" ADD VALUE 'excluded';--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "excluded_reason" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "excluded_at" timestamp with time zone;