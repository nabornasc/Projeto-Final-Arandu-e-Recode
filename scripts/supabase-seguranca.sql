-- Proteção do banco no Supabase. Rode depois de cada migração: é seguro repetir.
--
-- O Supabase publica o schema public por uma API própria, acessível com a chave pública do projeto.
-- O Aranduê não usa essa API, então os papéis dela perdem o acesso e toda tabela fica com RLS ligado.
-- A aplicação conecta como arandue_app, sem poder de alterar a estrutura do banco.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon, authenticated;

GRANT USAGE ON SCHEMA public TO arandue_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO arandue_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO arandue_app;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.tablename);
    EXECUTE format('DROP POLICY IF EXISTS arandue_app_all ON public.%I', item.tablename);
    EXECUTE format(
      'CREATE POLICY arandue_app_all ON public.%I TO arandue_app USING (true) WITH CHECK (true)',
      item.tablename
    );
  END LOOP;
END $$;
