CREATE TYPE "public"."address_kind" AS ENUM('delivery', 'billing');--> statement-breakpoint
CREATE TYPE "public"."freight_type" AS ENUM('sender', 'recipient', 'none');--> statement-breakpoint
CREATE TYPE "public"."person_kind" AS ENUM('individual', 'company');--> statement-breakpoint
CREATE TYPE "public"."tax_regime" AS ENUM('mei', 'simples', 'presumido', 'real');--> statement-breakpoint
CREATE TYPE "public"."taxpayer_type" AS ENUM('contributor', 'exempt', 'non_contributor');--> statement-breakpoint
CREATE TABLE "people" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "people_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"kind" "person_kind" DEFAULT 'individual' NOT NULL,
	"document" varchar(14),
	"name" varchar(160) NOT NULL,
	"legal_name" varchar(160),
	"is_customer" boolean DEFAULT false NOT NULL,
	"is_supplier" boolean DEFAULT false NOT NULL,
	"is_carrier" boolean DEFAULT false NOT NULL,
	"is_sales_rep" boolean DEFAULT false NOT NULL,
	"email" varchar(160),
	"phone" varchar(30),
	"mobile" varchar(30),
	"state_registration" varchar(20),
	"taxpayer" "taxpayer_type" DEFAULT 'non_contributor' NOT NULL,
	"final_consumer" boolean DEFAULT true NOT NULL,
	"tax_regime" "tax_regime",
	"zip" varchar(8),
	"street" varchar(160),
	"number" varchar(20),
	"complement" varchar(80),
	"district" varchar(80),
	"city" varchar(80),
	"state" varchar(2),
	"country" varchar(60) DEFAULT 'Brasil',
	"payment_method" varchar(60),
	"payment_terms" varchar(120),
	"freight_type" "freight_type",
	"carrier_id" integer,
	"category" varchar(60),
	"region" varchar(60),
	"seller_id" integer,
	"credit_limit" numeric(12, 2),
	"notes" varchar(1000),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_addresses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "person_addresses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"person_id" integer NOT NULL,
	"kind" "address_kind" NOT NULL,
	"zip" varchar(8),
	"street" varchar(160),
	"number" varchar(20),
	"complement" varchar(80),
	"district" varchar(80),
	"city" varchar(80),
	"state" varchar(2)
);
--> statement-breakpoint
CREATE TABLE "person_contacts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "person_contacts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"person_id" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"role" varchar(80),
	"phone" varchar(30),
	"email" varchar(160)
);
--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_carrier_id_people_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_addresses" ADD CONSTRAINT "person_addresses_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_contacts" ADD CONSTRAINT "person_contacts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "people_company_id_name_index" ON "people" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "people_company_id_city_index" ON "people" USING btree ("company_id","city");--> statement-breakpoint
CREATE UNIQUE INDEX "people_company_id_document_index" ON "people" USING btree ("company_id","document") WHERE "people"."document" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "person_addresses_person_id_index" ON "person_addresses" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "person_contacts_person_id_index" ON "person_contacts" USING btree ("person_id");--> statement-breakpoint
-- Dados: clientes viram pessoas com o MESMO id (orçamentos, pedidos e leads continuam apontando
-- para o registro certo quando a chave estrangeira mudar de tabela na próxima migração).
-- Documento fica só com dígitos; repetido na mesma empresa fica só no primeiro registro.
INSERT INTO "people"
  ("id", "company_id", "kind", "document", "name", "is_customer", "email", "phone", "street", "created_at")
OVERRIDING SYSTEM VALUE
SELECT c."id", c."company_id",
  CASE WHEN length(regexp_replace(coalesce(c."document", ''), '\D', '', 'g')) = 14 THEN 'company' ELSE 'individual' END::"person_kind",
  CASE WHEN row_number() OVER (PARTITION BY c."company_id", nullif(regexp_replace(coalesce(c."document", ''), '\D', '', 'g'), '') ORDER BY c."id") = 1
       THEN nullif(left(regexp_replace(coalesce(c."document", ''), '\D', '', 'g'), 14), '') END,
  c."name", true, c."email", c."phone", left(c."address", 160), c."created_at"
FROM "customers" c;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('"people"', 'id'), coalesce((SELECT max("id") FROM "people"), 0) + 1, false);--> statement-breakpoint
-- Fornecedores: viram pessoas novas (não há chaves apontando para eles); o contato vira um contato da pessoa.
INSERT INTO "people" ("company_id", "kind", "name", "is_supplier", "email", "phone", "created_at")
SELECT s."company_id", 'company', s."name", true, s."email", s."phone", s."created_at" FROM "suppliers" s;--> statement-breakpoint
INSERT INTO "person_contacts" ("person_id", "name", "phone", "email")
SELECT p."id", s."contact", s."phone", s."email"
FROM "suppliers" s
JOIN "people" p ON p."company_id" = s."company_id" AND p."name" = s."name" AND p."is_supplier" AND p."created_at" = s."created_at"
WHERE s."contact" IS NOT NULL AND s."contact" <> '';
