ALTER TYPE "public"."quote_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_name" varchar(160);--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "reason" varchar(255);--> statement-breakpoint
CREATE INDEX "audit_logs_company_id_entity_entity_id_created_at_index" ON "audit_logs" USING btree ("company_id","entity","entity_id","created_at");--> statement-breakpoint
-- Registros antigos: copia o nome atual do usuário.
UPDATE "audit_logs" a SET "actor_name" = u."name" FROM "users" u WHERE u."id" = a."user_id";--> statement-breakpoint
-- Quem já cancela pedidos passa a poder cancelar orçamentos (o Proprietário tem tudo por definição).
INSERT INTO "access_group_permissions" ("group_id", "permission")
SELECT "group_id", 'quotes.cancel' FROM "access_group_permissions" WHERE "permission" = 'orders.cancel'
ON CONFLICT DO NOTHING;
