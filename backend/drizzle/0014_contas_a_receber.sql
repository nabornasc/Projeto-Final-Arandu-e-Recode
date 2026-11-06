CREATE TYPE "public"."receivable_status" AS ENUM('open', 'settled', 'cancelled');--> statement-breakpoint
CREATE TABLE "receivables" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "receivables_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"position" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"paid_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"method" varchar(40),
	"status" "receivable_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "cash_transactions_order_id_index";--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD COLUMN "receivable_id" integer;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "supplier_id" integer;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receivables_company_id_status_due_date_index" ON "receivables" USING btree ("company_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "receivables_order_id_position_index" ON "receivables" USING btree ("order_id","position");--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_receivable_id_receivables_id_fk" FOREIGN KEY ("receivable_id") REFERENCES "public"."receivables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplier_id_people_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_transactions_receivable_id_index" ON "cash_transactions" USING btree ("receivable_id");--> statement-breakpoint
CREATE INDEX "expenses_supplier_id_index" ON "expenses" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "cash_transactions_order_id_index" ON "cash_transactions" USING btree ("order_id");--> statement-breakpoint
-- Todo pedido passa a ter uma conta a receber, de acordo com o status atual, e a entrada no caixa aponta para ela.
INSERT INTO "receivables" ("company_id", "order_id", "position", "due_date", "amount", "paid_amount", "status", "created_at")
SELECT "company_id", "id", 1, "order_date", "total",
  CASE WHEN "status" IN ('paid', 'completed') THEN "total" ELSE 0 END,
  (CASE WHEN "status" IN ('paid', 'completed') THEN 'settled' WHEN "status" = 'cancelled' THEN 'cancelled' ELSE 'open' END)::"receivable_status",
  "created_at"
FROM "orders";--> statement-breakpoint
UPDATE "cash_transactions" SET "receivable_id" = "receivables"."id"
FROM "receivables"
WHERE "receivables"."order_id" = "cash_transactions"."order_id";
