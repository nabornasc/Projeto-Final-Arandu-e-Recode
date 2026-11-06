ALTER TABLE "quote_items" ADD COLUMN "unit_cost" numeric(12, 2);--> statement-breakpoint
-- Hoje o custo aparece para todos que veem produtos. Passa a exigir costs.read: ficam com ela os grupos
-- que já acompanham o financeiro.
INSERT INTO "access_group_permissions" ("group_id", "permission")
SELECT "group_id", 'costs.read' FROM "access_group_permissions" WHERE "permission" = 'payables.read'
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Orçamentos já enviados ficam com o custo atual, a melhor referência disponível.
UPDATE "quote_items" SET "unit_cost" = "products"."cost"
FROM "products", "quotes"
WHERE "products"."id" = "quote_items"."product_id"
  AND "quotes"."id" = "quote_items"."quote_id"
  AND "quotes"."status" <> 'draft';
