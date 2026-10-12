ALTER TYPE "public"."errand_status" RENAME VALUE 'Pending-Credit' TO 'Reserving-Credit';--> statement-breakpoint
ALTER TYPE "public"."errand_status" ADD VALUE 'Transferring-Credit' BEFORE 'Completed';--> statement-breakpoint
ALTER TYPE "public"."errand_status" ADD VALUE 'Adjusting-Credit' BEFORE 'Completed';
