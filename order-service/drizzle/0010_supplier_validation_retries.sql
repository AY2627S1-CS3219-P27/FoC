CREATE TABLE "supplier_validation_retries" (
	"errand_id" uuid PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "supplier_validation_retries_next_retry_at_index" ON "supplier_validation_retries" USING btree ("next_retry_at");