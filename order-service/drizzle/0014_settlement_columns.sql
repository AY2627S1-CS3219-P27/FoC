ALTER TYPE "public"."errand_status" ADD VALUE 'Settling-Credit';--> statement-breakpoint
ALTER TYPE "public"."errand_status" ADD VALUE 'Resolved';--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "settlement_amount" integer;--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "settlement_note" text;