ALTER TABLE "errands" DROP CONSTRAINT "errands_cancellation_reason_valid";--> statement-breakpoint
ALTER TABLE "errands" ALTER COLUMN "delivery_location" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "delivery_building_id" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';--> statement-breakpoint
ALTER TABLE "errands" ALTER COLUMN "delivery_building_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "delivery_detail" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "errands" ALTER COLUMN "delivery_detail" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "errands" ADD CONSTRAINT "errands_cancellation_reason_valid" CHECK ("errands"."cancellation_reason" IN ('SUPPLIER_UNAVAILABLE', 'BUILDING_UNAVAILABLE', 'SUPPLIER_VALIDATION_TIMEOUT', 'INSUFFICIENT_CREDITS', 'MISSING_BALANCE', 'CREDIT_TIMEOUT', 'ERRAND_EXPIRED', 'PICKUP_TIME_EXCEEDED', 'REQUESTER_CANCELLED'));