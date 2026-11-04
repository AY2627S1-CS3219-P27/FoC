CREATE TABLE "dispute_reports" (
	"errand_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_reports_errand_id_author_id_pk" PRIMARY KEY("errand_id","author_id")
);
--> statement-breakpoint
ALTER TABLE "dispute_reports" ADD CONSTRAINT "dispute_reports_errand_id_errands_id_fk" FOREIGN KEY ("errand_id") REFERENCES "public"."errands"("id") ON DELETE no action ON UPDATE no action;