ALTER TABLE "users" ALTER COLUMN "group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."user_role";