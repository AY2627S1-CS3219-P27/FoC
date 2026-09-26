ALTER TABLE "errand_events" ADD COLUMN "from_status" "errand_status";--> statement-breakpoint
ALTER TABLE "errand_events" ADD COLUMN "to_status" "errand_status" NOT NULL;