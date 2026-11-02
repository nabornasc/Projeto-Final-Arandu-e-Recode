ALTER TABLE "companies" ALTER COLUMN "mei_annual_limit" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "mei_annual_limit" DROP NOT NULL;--> statement-breakpoint
-- O 81000 vinha do default antigo, não de uma escolha da empresa: cada uma passa a informar o seu.
UPDATE "companies" SET "mei_annual_limit" = NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "order_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "quote_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Numera os registros existentes por empresa, na ordem de criação, antes de exigir o número.
ALTER TABLE "orders" ADD COLUMN "number" integer;--> statement-breakpoint
UPDATE "orders" o SET "number" = r.rn
  FROM (SELECT "id", row_number() OVER (PARTITION BY "company_id" ORDER BY "id") AS rn FROM "orders") r
  WHERE o."id" = r."id";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "number" integer;--> statement-breakpoint
UPDATE "quotes" q SET "number" = r.rn
  FROM (SELECT "id", row_number() OVER (PARTITION BY "company_id" ORDER BY "id") AS rn FROM "quotes") r
  WHERE q."id" = r."id";--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
UPDATE "companies" c SET
  "order_seq" = COALESCE((SELECT max("number") FROM "orders" WHERE "company_id" = c."id"), 0),
  "quote_seq" = COALESCE((SELECT max("number") FROM "quotes" WHERE "company_id" = c."id"), 0);--> statement-breakpoint
CREATE UNIQUE INDEX "orders_company_id_number_index" ON "orders" USING btree ("company_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_company_id_number_index" ON "quotes" USING btree ("company_id","number");
