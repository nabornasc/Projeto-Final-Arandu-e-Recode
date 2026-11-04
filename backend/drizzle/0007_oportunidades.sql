CREATE TYPE "public"."activity_kind" AS ENUM('comment', 'call', 'visit', 'meeting', 'proposal', 'email', 'event');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('open', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."origin_kind" AS ENUM('converted', 'duplicated', 'copied');--> statement-breakpoint
CREATE TYPE "public"."stage_milestone" AS ENUM('start', 'quote_sent', 'negotiation');--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "opportunities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"customer_id" integer,
	"contact_name" varchar(160),
	"contact_phone" varchar(30),
	"contact_email" varchar(160),
	"source" varchar(60) NOT NULL,
	"stage_id" integer NOT NULL,
	"status" "opportunity_status" DEFAULT 'open' NOT NULL,
	"estimated_value" numeric(12, 2),
	"expected_close_date" date,
	"owner_id" integer,
	"lost_reason" varchar(255),
	"next_action" varchar(255),
	"next_action_at" date,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "opportunity_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"opportunity_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"unit_price" numeric(12, 2)
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pipeline_stages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"name" varchar(60) NOT NULL,
	"position" integer NOT NULL,
	"color" varchar(7) DEFAULT '#6d4fd6' NOT NULL,
	"milestone" "stage_milestone"
);
--> statement-breakpoint
ALTER TABLE "interactions" ADD COLUMN "opportunity_id" integer;--> statement-breakpoint
ALTER TABLE "interactions" ADD COLUMN "kind" "activity_kind" DEFAULT 'comment' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "opportunity_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "origin_quote_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "origin_order_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "origin_kind" "origin_kind";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "opportunity_id" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "origin_quote_id" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "origin_order_id" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "origin_kind" "origin_kind";--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customer_id_people_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunities_company_id_status_stage_id_index" ON "opportunities" USING btree ("company_id","status","stage_id");--> statement-breakpoint
CREATE INDEX "opportunities_company_id_source_index" ON "opportunities" USING btree ("company_id","source");--> statement-breakpoint
CREATE INDEX "opportunities_company_id_owner_id_index" ON "opportunities" USING btree ("company_id","owner_id");--> statement-breakpoint
CREATE INDEX "opportunities_customer_id_index" ON "opportunities" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "opportunity_items_opportunity_id_index" ON "opportunity_items" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "pipeline_stages_company_id_position_index" ON "pipeline_stages" USING btree ("company_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_company_id_name_index" ON "pipeline_stages" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_company_id_milestone_index" ON "pipeline_stages" USING btree ("company_id","milestone") WHERE "pipeline_stages"."milestone" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_origin_quote_id_quotes_id_fk" FOREIGN KEY ("origin_quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_origin_order_id_orders_id_fk" FOREIGN KEY ("origin_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_origin_quote_id_quotes_id_fk" FOREIGN KEY ("origin_quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_origin_order_id_orders_id_fk" FOREIGN KEY ("origin_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interactions_opportunity_id_index" ON "interactions" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "orders_opportunity_id_index" ON "orders" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "orders_origin_quote_id_index" ON "orders" USING btree ("origin_quote_id");--> statement-breakpoint
CREATE INDEX "orders_origin_order_id_index" ON "orders" USING btree ("origin_order_id");--> statement-breakpoint
CREATE INDEX "quotes_opportunity_id_index" ON "quotes" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "quotes_origin_quote_id_index" ON "quotes" USING btree ("origin_quote_id");--> statement-breakpoint
CREATE INDEX "quotes_origin_order_id_index" ON "quotes" USING btree ("origin_order_id");--> statement-breakpoint
-- Dados: cada empresa ganha o funil padrão, equivalente às etapas fixas anteriores.
INSERT INTO "pipeline_stages" ("company_id", "name", "position", "color", "milestone")
SELECT c."id", s.name, s.position, s.color, s.milestone::"stage_milestone"
FROM "companies" c
CROSS JOIN (VALUES
  ('Novo', 1, '#6d4fd6', 'start'),
  ('Em contato', 2, '#3567c4', NULL),
  ('Orçamento enviado', 3, '#b6801d', 'quote_sent'),
  ('Negociação', 4, '#1c6e4c', 'negotiation')
) AS s(name, position, color, milestone);--> statement-breakpoint
-- Leads viram oportunidades com o MESMO id. Ganho e perdido passam a ser situação; como a etapa
-- onde pararam não era guardada, ficam na última etapa do funil.
INSERT INTO "opportunities"
  ("id", "company_id", "title", "customer_id", "contact_name", "contact_phone", "contact_email", "source",
   "stage_id", "status", "owner_id", "lost_reason", "next_action", "next_action_at", "closed_at", "created_at", "updated_at")
OVERRIDING SYSTEM VALUE
SELECT l."id", l."company_id", l."name", l."customer_id", l."name", l."phone", l."email", l."source",
  (SELECT ps."id" FROM "pipeline_stages" ps
   WHERE ps."company_id" = l."company_id"
     AND ps."name" = CASE l."stage"::text
       WHEN 'new' THEN 'Novo'
       WHEN 'contacted' THEN 'Em contato'
       WHEN 'quote_sent' THEN 'Orçamento enviado'
       ELSE 'Negociação' END),
  CASE l."stage"::text WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' ELSE 'open' END::"opportunity_status",
  l."owner_id", l."lost_reason", l."next_action", l."next_action_at",
  CASE WHEN l."stage"::text IN ('won', 'lost') THEN l."updated_at" END,
  l."created_at", l."updated_at"
FROM "leads" l;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('"opportunities"', 'id'), coalesce((SELECT max("id") FROM "opportunities"), 0) + 1, false);--> statement-breakpoint
UPDATE "interactions" SET "opportunity_id" = "lead_id";--> statement-breakpoint
UPDATE "quotes" SET "opportunity_id" = "lead_id" WHERE "lead_id" IS NOT NULL;--> statement-breakpoint
-- Pedidos convertidos de orçamento: origem conhecida; herdam a oportunidade do orçamento.
UPDATE "orders" o SET "origin_quote_id" = o."quote_id", "origin_kind" = 'converted', "opportunity_id" = q."opportunity_id"
FROM "quotes" q WHERE o."quote_id" = q."id";--> statement-breakpoint
-- Permissões do CRM mudam de nome junto com o conceito.
UPDATE "access_group_permissions" SET "permission" = replace("permission", 'leads.', 'opportunities.') WHERE "permission" LIKE 'leads.%';
