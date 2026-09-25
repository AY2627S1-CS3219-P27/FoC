CREATE TABLE "errand_events" (
	"errand_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"type" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"from_status" "errand_status",
	"to_status" "errand_status" NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_id" uuid,
	"idempotency_key" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "errand_events_errand_id_sequence_number_pk" PRIMARY KEY("errand_id","sequence_number")
);
--> statement-breakpoint
CREATE TABLE "errands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requester_id" uuid NOT NULL,
	"status" "errand_status" NOT NULL,
	"last_sequence_number" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"courier_id" uuid,
	"supplier_id" uuid NOT NULL,
	"description" text,
	"pickup_location" text,
	"delivery_location" text NOT NULL,
	"reward_credits" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "errands_requester_id_idempotency_key_unique" UNIQUE("requester_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "errand_events" ADD CONSTRAINT "errand_events_errand_id_errands_id_fk" FOREIGN KEY ("errand_id") REFERENCES "public"."errands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "errand_events_errand_id_idempotency_key_index" ON "errand_events" USING btree ("errand_id","idempotency_key") WHERE "errand_events"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "errands_status_expires_at_index" ON "errands" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "errands_status_picked_up_at_index" ON "errands" USING btree ("status","picked_up_at");--> statement-breakpoint
CREATE INDEX "errands_status_delivered_at_index" ON "errands" USING btree ("status","delivered_at");--> statement-breakpoint
CREATE INDEX "errands_courier_id_status_index" ON "errands" USING btree ("courier_id","status");--> statement-breakpoint
CREATE INDEX "errands_requester_id_status_index" ON "errands" USING btree ("requester_id","status");