CREATE TABLE "access_group_permissions" (
	"group_id" integer NOT NULL,
	"permission" varchar(60) NOT NULL,
	CONSTRAINT "access_group_permissions_group_id_permission_pk" PRIMARY KEY("group_id","permission")
);
--> statement-breakpoint
CREATE TABLE "access_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "access_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(255),
	"own_only" boolean DEFAULT false NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "group_id" integer;--> statement-breakpoint
ALTER TABLE "access_group_permissions" ADD CONSTRAINT "access_group_permissions_group_id_access_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."access_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_groups" ADD CONSTRAINT "access_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_groups_company_id_name_index" ON "access_groups" USING btree ("company_id","name");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_group_id_access_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."access_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_group_id_index" ON "users" USING btree ("group_id");--> statement-breakpoint
-- Dados: cada empresa ganha os três grupos padrão, equivalentes aos papéis fixos anteriores, e cada
-- usuário vai para o grupo do seu papel. As listas espelham DEFAULT_GROUPS em packages/shared/src/permissions.ts.
INSERT INTO "access_groups" ("company_id", "name", "description", "is_owner")
SELECT "id", 'Proprietário', 'Acesso total. Não pode ser alterado.', true FROM "companies";--> statement-breakpoint
INSERT INTO "access_groups" ("company_id", "name", "description")
SELECT "id", 'Vendedor', 'Vende, cadastra clientes e monta orçamentos.' FROM "companies";--> statement-breakpoint
INSERT INTO "access_groups" ("company_id", "name", "description")
SELECT "id", 'Contador', 'Consulta vendas, financeiro e indicadores, sem alterar.' FROM "companies";--> statement-breakpoint
INSERT INTO "access_group_permissions" ("group_id", "permission")
SELECT g."id", p.permission FROM "access_groups" g
CROSS JOIN (VALUES ('quotes.read'), ('quotes.create'), ('quotes.update'), ('quotes.send'), ('quotes.convert'),
  ('orders.read'), ('orders.create'), ('orders.update'), ('orders.cancel'), ('receivables.read'),
  ('receivables.settle'), ('customers.read'), ('customers.create'), ('customers.update'), ('suppliers.read'),
  ('products.read')) AS p(permission)
WHERE g."name" = 'Vendedor';--> statement-breakpoint
INSERT INTO "access_group_permissions" ("group_id", "permission")
SELECT g."id", p.permission FROM "access_groups" g
CROSS JOIN (VALUES ('customers.read'), ('suppliers.read'), ('products.read'), ('quotes.read'), ('orders.read'),
  ('receivables.read'), ('payables.read'), ('cash.read'), ('bank_accounts.read'), ('analytics.read'),
  ('settings.read')) AS p(permission)
WHERE g."name" = 'Contador';--> statement-breakpoint
UPDATE "users" u SET "group_id" = g."id"
FROM "access_groups" g
WHERE g."company_id" = u."company_id"
  AND g."name" = CASE u."role" WHEN 'owner' THEN 'Proprietário' WHEN 'seller' THEN 'Vendedor' ELSE 'Contador' END;
