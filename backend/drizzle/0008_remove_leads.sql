-- Confere a migração da 0007 antes de apagar algo.
DO $$
BEGIN
  IF (SELECT count(*) FROM "leads") <> (SELECT count(*) FROM "opportunities" o JOIN "leads" l ON l."id" = o."id") THEN
    RAISE EXCEPTION 'Migração de leads para oportunidades incompleta; nada foi apagado.';
  END IF;
  IF EXISTS (SELECT 1 FROM "interactions" WHERE "opportunity_id" IS NULL) THEN
    RAISE EXCEPTION 'Há atendimentos sem oportunidade; nada foi apagado.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "interactions" DROP CONSTRAINT "interactions_lead_id_leads_id_fk";--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_lead_id_leads_id_fk";--> statement-breakpoint
DROP INDEX "interactions_company_id_lead_id_index";--> statement-breakpoint
DROP INDEX "interactions_opportunity_id_index";--> statement-breakpoint
ALTER TABLE "interactions" ALTER COLUMN "opportunity_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "interactions_company_id_opportunity_id_index" ON "interactions" USING btree ("company_id","opportunity_id");--> statement-breakpoint
ALTER TABLE "interactions" DROP COLUMN "lead_id";--> statement-breakpoint
ALTER TABLE "quotes" DROP COLUMN "lead_id";--> statement-breakpoint
DROP TABLE "leads";--> statement-breakpoint
DROP TYPE "public"."lead_stage";
