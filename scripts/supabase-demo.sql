-- Demonstração pública: guarda uma cópia dos dados padrão e a restaura a cada 12 horas.
-- As funções ficam em um schema sem acesso externo: a aplicação não consegue apagar nada por aqui.

CREATE SCHEMA IF NOT EXISTS demo;
REVOKE ALL ON SCHEMA demo FROM PUBLIC;

CREATE TABLE IF NOT EXISTS demo.meta (captured_on date NOT NULL);

-- Ordem em que os dados voltam, respeitando as chaves estrangeiras. Sessões não entram na cópia.
CREATE OR REPLACE FUNCTION demo.table_list() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY[
    'companies', 'access_groups', 'access_group_permissions', 'users', 'people', 'person_contacts',
    'person_addresses', 'products', 'pipeline_stages', 'opportunities', 'opportunity_items',
    'interactions', 'bank_accounts', 'expenses', 'quotes', 'quote_items', 'orders', 'order_items',
    'cash_transactions', 'audit_logs', 'events'
  ]
$$;

-- Tabela nova sem lugar na lista interromperia a restauração com dados pela metade: falha antes.
CREATE OR REPLACE FUNCTION demo.assert_complete() RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(tablename, ', ') INTO missing
  FROM pg_catalog.pg_tables
  WHERE schemaname = 'public' AND tablename <> 'sessions' AND tablename <> ALL (demo.table_list());
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Tabelas fora da lista da demonstração: %', missing;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION demo.capture() RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  name text;
BEGIN
  PERFORM demo.assert_complete();
  FOREACH name IN ARRAY demo.table_list() LOOP
    EXECUTE format('DROP TABLE IF EXISTS demo.%I', name);
    EXECUTE format('CREATE TABLE demo.%I AS TABLE public.%I', name, name);
  END LOOP;
  DELETE FROM demo.meta;
  INSERT INTO demo.meta VALUES (CURRENT_DATE);
END $$;

-- Tudo numa transação: se algo falhar, os dados atuais ficam como estão.
-- As datas andam junto com o calendário, para os indicadores do mês não ficarem vazios.
CREATE OR REPLACE FUNCTION demo.reset() RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  name text;
  days integer;
  assignments text;
  identity record;
BEGIN
  PERFORM demo.assert_complete();
  SELECT CURRENT_DATE - captured_on INTO days FROM demo.meta;
  IF days IS NULL THEN
    RAISE EXCEPTION 'A cópia dos dados da demonstração ainda não foi criada.';
  END IF;

  EXECUTE (
    SELECT 'TRUNCATE public.sessions, ' || string_agg(format('public.%I', item), ', ') || ' RESTART IDENTITY CASCADE'
    FROM unnest(demo.table_list()) AS item
  );

  FOREACH name IN ARRAY demo.table_list() LOOP
    EXECUTE format('INSERT INTO public.%I OVERRIDING SYSTEM VALUE SELECT * FROM demo.%I', name, name);

    SELECT string_agg(
      CASE data_type
        WHEN 'date' THEN format('%I = %I + %s', column_name, column_name, days)
        ELSE format('%I = %I + interval ''%s days''', column_name, column_name, days)
      END,
      ', '
    ) INTO assignments
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = name
      AND data_type IN ('date', 'timestamp with time zone');
    IF assignments IS NOT NULL AND days <> 0 THEN
      EXECUTE format('UPDATE public.%I SET %s', name, assignments);
    END IF;
  END LOOP;

  -- Os próximos registros continuam a numeração depois dos dados restaurados.
  FOR identity IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND is_identity = 'YES' AND table_name <> 'sessions'
  LOOP
    EXECUTE format(
      'SELECT setval(pg_catalog.pg_get_serial_sequence(%L, %L), coalesce((SELECT max(%I) FROM public.%I), 0) + 1, false)',
      'public.' || identity.table_name, identity.column_name, identity.column_name, identity.table_name
    );
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA demo FROM PUBLIC;
REVOKE ALL ON ALL ROUTINES IN SCHEMA demo FROM PUBLIC;
