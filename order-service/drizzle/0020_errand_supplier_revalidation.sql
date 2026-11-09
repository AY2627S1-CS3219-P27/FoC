ALTER TYPE "public"."errand_status" ADD VALUE 'Revalidating-Supplier';--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "pending_supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "errands" ADD COLUMN "pending_delivery_building_id" uuid;