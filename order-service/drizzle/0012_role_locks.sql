CREATE TABLE "role_blocks" (
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "role_blocks_user_id_role_pk" PRIMARY KEY("user_id","role")
);
