CREATE INDEX "leads_company_id_owner_id_index" ON "leads" USING btree ("company_id","owner_id");--> statement-breakpoint
-- O CRM passa a ter permissões próprias: o grupo padrão Vendedor ganha criar e editar leads
-- (como na matriz original). Grupos personalizados recebem pela tela de grupos de acesso.
INSERT INTO "access_group_permissions" ("group_id", "permission")
SELECT g."id", p.permission FROM "access_groups" g
CROSS JOIN (VALUES ('leads.read'), ('leads.create'), ('leads.update')) AS p(permission)
WHERE g."name" = 'Vendedor' AND NOT g."is_owner"
ON CONFLICT DO NOTHING;
