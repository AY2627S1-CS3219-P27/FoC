ALTER TABLE "errands" DROP CONSTRAINT "errands_cancellation_reason_valid";--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "delivery_venue_id" uuid;--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "delivery_latitude" double precision;--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "delivery_longitude" double precision;--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "delivery_venue" text;--> statement-breakpoint
ALTER TABLE "errands" ADD CONSTRAINT "errands_cancellation_reason_valid" CHECK ("errands"."cancellation_reason" IN ('SUPPLIER_UNAVAILABLE', 'BUILDING_UNAVAILABLE', 'VENUE_UNAVAILABLE', 'SUPPLIER_VALIDATION_TIMEOUT', 'INSUFFICIENT_CREDITS', 'MISSING_BALANCE', 'CREDIT_TIMEOUT', 'ERRAND_EXPIRED', 'PICKUP_TIME_EXCEEDED', 'REQUESTER_CANCELLED'));