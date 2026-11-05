# Publicação (Supabase + Vercel)

Interface e API ficam na Vercel, em São Paulo (`gru1`). O banco fica no Supabase, também em São Paulo (`sa-east-1`).

## Demonstração pública (caminho rápido)

O script abaixo faz os passos 1 e 2 de uma vez e agenda a volta aos dados padrão às 00h e às 12h de Cuiabá, com `pg_cron` no próprio banco. **Ele apaga os dados do banco.**

1. No Supabase, abra **Connect** e copie a conexão do **Session pooler**, trocando `[YOUR-PASSWORD]` pela senha do banco. Se não souber a senha, redefina em **Database > Settings**.
2. No Prompt de Comando, na raiz do projeto:

   ```bat
   set SUPABASE_DB_URL=<conexão do session pooler>
   npm run demo:setup
   ```

3. Cadastre na Vercel as variáveis que o script mostrar no final e siga para o passo 3.

Depois de uma nova migração, rode `npm run demo:setup -- --recriar` e atualize a senha em `DATABASE_URL` na Vercel. Sem isso, a cópia dos dados fica sem as colunas novas, e elas voltam vazias ou com o valor padrão a cada restauração.

## 1. Banco no Supabase

1. Crie ou reative um projeto em `sa-east-1` com PostgreSQL 17.
2. Em **Connect**, copie a conexão direta ou a do *session pooler*. Ela usa o usuário `postgres` e serve só para migrações.
3. Aplique as migrações pelo seu computador, sem salvar a senha em arquivo versionado:

   ```bash
   DATABASE_URL="<conexão do postgres>?sslmode=require" node backend/src/db/migrate.ts
   ```

4. No **SQL Editor**, crie o usuário da aplicação com uma senha forte, gerada por você:

   ```sql
   CREATE ROLE arandue_app LOGIN PASSWORD '<senha-forte>' NOINHERIT;
   ```

5. Ainda no SQL Editor, rode [scripts/supabase-seguranca.sql](scripts/supabase-seguranca.sql).
6. Em **Advisors**, confira que não há alerta de segurança em aberto.

Rode o passo 3 e depois o passo 5 a cada nova migração. A aplicação nunca altera a estrutura do banco.

## 2. Dados de demonstração (opcional)

O seed **apaga todos os dados** antes de inserir e usa uma senha pública, `senha-demo-123`. Use só em banco de demonstração:

```bash
NODE_ENV=development DATABASE_URL="<conexão do postgres>?sslmode=require" node backend/src/db/seed.ts
```

## 3. Aplicação na Vercel

1. Em <https://vercel.com/new>, importe o repositório. O `vercel.json` já traz os comandos de instalação e de build.
2. Cadastre as variáveis de ambiente:

   | Variável | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | Conexão do *transaction pooler* (porta 6543) com o usuário `arandue_app.<ref-do-projeto>`, terminada em `?sslmode=require` |
   | `ALLOWED_ORIGINS` | Endereço público da aplicação, como `https://seu-projeto.vercel.app` |
   | `VITE_DEMO_MODE` | `true` para mostrar o aviso e o acesso de teste na demonstração |
   | `SENTRY_DSN` | Opcional: DSN do projeto `arandu-gestao-api` no Sentry |
   | `VITE_SENTRY_DSN` | Opcional: DSN do projeto `arandu-gestao-web` no Sentry |
   | `SENTRY_AUTH_TOKEN` | Opcional e secreto: token da organização no Sentry, para enviar os source maps no build |

3. Faça o deploy e abra `/api/health`. A resposta esperada é `{"status":"ok"}`.

`ALLOWED_ORIGINS` precisa ser exatamente o endereço usado no navegador: ele protege contra CSRF. Deploys de pré-visualização têm outro endereço e, por isso, não aceitam alterações.

## 4. Conferência em produção

- Entre, crie um orçamento e veja o histórico dele.
- Confira no navegador que o cookie é `__Host-sid`, `HttpOnly` e `Secure`.
- Rode o Lighthouse no endereço público.

## Limites conhecidos

- O Supabase gratuito pausa projetos sem uso por cerca de uma semana. A restauração agendada pode não evitar a pausa: nesse caso, reative pelo painel.
- O limite de requisições fica na memória de cada instância da função, então é aproximado.
- O plano Hobby da Vercel é só para uso não comercial. Para clientes reais, passe ao plano Pro.
