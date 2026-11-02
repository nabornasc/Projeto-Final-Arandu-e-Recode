-- Confere a migração da 0005 antes de apagar algo: cada cliente e fornecedor precisa ter virado pessoa.
DO $$
BEGIN
  IF (SELECT count(*) FROM "customers") <> (SELECT count(*) FROM "people" p JOIN "customers" c ON c."id" = p."id" AND p."is_customer") THEN
    RAISE EXCEPTION 'Migração de clientes para pessoas incompleta; nada foi apagado.';
  END IF;
  IF (SELECT count(*) FROM "suppliers") > (SELECT count(*) FROM "people" WHERE "is_supplier") THEN
    RAISE EXCEPTION 'Migração de fornecedores para pessoas incompleta; nada foi apagado.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_people_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_people_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_people_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DROP TABLE "customers";--> statement-breakpoint
DROP TABLE "suppliers";
