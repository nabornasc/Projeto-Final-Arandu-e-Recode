CREATE TABLE "receivable_payments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "receivable_payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"receivable_id" integer NOT NULL,
	"bank_account_id" integer,
	"paid_on" date NOT NULL,
	"principal" numeric(12, 2) NOT NULL,
	"interest" numeric(12, 2) DEFAULT 0 NOT NULL,
	"discount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"received" numeric(12, 2) NOT NULL,
	"method" varchar(40),
	"notes" varchar(255),
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" integer,
	"reversal_reason" varchar(255)
);
--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_receivable_id_receivables_id_fk" FOREIGN KEY ("receivable_id") REFERENCES "public"."receivables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_payments" ADD CONSTRAINT "receivable_payments_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receivable_payments_receivable_id_index" ON "receivable_payments" USING btree ("receivable_id");--> statement-breakpoint
CREATE INDEX "receivable_payments_order_id_index" ON "receivable_payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "receivable_payments_bank_account_id_index" ON "receivable_payments" USING btree ("bank_account_id");--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD COLUMN "payment_id" integer;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_payment_id_receivable_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."receivable_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Cada entrada de pedido no caixa vira uma baixa simples, com a mesma data, conta e valor.
INSERT INTO "receivable_payments" ("company_id", "order_id", "receivable_id", "bank_account_id", "paid_on", "principal", "received", "method", "created_by", "created_at")
SELECT "c"."company_id", "c"."order_id", "c"."receivable_id", "c"."bank_account_id", "c"."transaction_date", "c"."amount", "c"."amount", "r"."method", "o"."created_by", "c"."created_at"
FROM "cash_transactions" "c"
JOIN "receivables" "r" ON "r"."id" = "c"."receivable_id"
JOIN "orders" "o" ON "o"."id" = "c"."order_id";--> statement-breakpoint
UPDATE "cash_transactions" SET "payment_id" = "receivable_payments"."id"
FROM "receivable_payments"
WHERE "receivable_payments"."receivable_id" = "cash_transactions"."receivable_id";--> statement-breakpoint
ALTER TABLE "cash_transactions" DROP COLUMN "receivable_id";--> statement-breakpoint
CREATE UNIQUE INDEX "cash_transactions_payment_id_index" ON "cash_transactions" USING btree ("payment_id");
