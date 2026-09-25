CREATE TABLE "idempotency_keys" (
	"errand_id" uuid NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_errand_id_key_pk" PRIMARY KEY("errand_id","key")
);
--> statement-breakpoint
DROP INDEX "errand_events_errand_id_idempotency_key_index";--> statement-breakpoint
ALTER TABLE "errand_events" DROP COLUMN "idempotency_key";