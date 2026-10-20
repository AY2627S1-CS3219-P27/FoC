ALTER TABLE "errands" ADD COLUMN "collection_items" text;--> statement-breakpoint
UPDATE "errands" e SET "collection_items" = coalesce((SELECT ev."payload"->>'collectionItems' FROM "errand_events" ev WHERE ev."errand_id" = e."id" AND ev."sequence_number" = 1), '');--> statement-breakpoint
ALTER TABLE "errands" ALTER COLUMN "collection_items" SET NOT NULL;
