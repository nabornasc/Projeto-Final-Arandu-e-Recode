# Aranduê

SaaS de gestão para microempreendedores individuais (MEIs): vendas, estoque, clientes e caixa em um só lugar, com dados isolados por empresa e controle de acesso por papel.

Desenvolvido em alinhamento ao **ODS 1 — Erradicação da Pobreza**, com foco em organização financeira e apoio à decisão para quem empreende por conta própria.

> **Versão 2 em desenvolvimento.** A v1 (monousuário, MySQL) está preservada na tag `v1.0.0`. O andamento da v2 segue o [PLANEJAMENTO_V2.md](PLANEJAMENTO_V2.md).

## Índice

- [Situação atual](#situação-atual)
- [Tecnologias](#tecnologias)
- [Execução local](#execução-local)
- [Usuários de demonstração](#usuários-de-demonstração)
- [Scripts](#scripts)
- [Arquitetura](#arquitetura)
- [Segurança](#segurança)
- [API](#api)
- [Regras de negócio](#regras-de-negócio)
- [Testes](#testes)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Solução de problemas](#solução-de-problemas)
- [Planejamento](#planejamento)
- [Licença](#licença)

---

## Situação atual

**Semana 1 (fundação) concluída:**

- Cadastro de empresa com usuário proprietário, login e logout com sessão segura.
- Multiempresa: todo dado pertence a uma empresa e nenhuma consulta cruza empresas.
- Controle de acesso verificado no servidor (detalhado na etapa de permissões abaixo).
- Produtos e serviços (com estoque), clientes, pedidos com vários itens, despesas, contas bancárias e movimentações de caixa.
- Log de auditoria de toda alteração.
- Interface responsiva, com o menu e os botões ajustados ao papel do usuário.

**Semana 2 (ERP) concluída:**

- Gestão de usuários: convite com senha inicial, troca de papel e desativação (encerra as sessões).
- Fornecedores.
- Orçamentos com vários itens: rascunho → enviado → aprovado ou recusado (só o proprietário decide) e **conversão em pedido** numa transação, com baixa de estoque e entrada no caixa se pago.
- Numeração de pedidos e orçamentos por empresa (#001, #002...).
- Configurações da empresa com o **limite anual do MEI** obrigatório, usado como referência no dashboard.

**Etapa extra (permissões e grupos de acesso) concluída:**

- 45 permissões por ação (ex.: aprovar orçamento, dar baixa no recebimento, pagar despesa), combinadas em **grupos de acesso** que cada empresa cria e edita numa matriz.
- Grupos padrão **Proprietário** (acesso total, fixo), **Vendedor** e **Contador**.
- Escopo por grupo: ver todos os orçamentos e pedidos da empresa ou **só os próprios**.
- **Contas a receber**: o financeiro dá baixa nos pedidos pendentes sem precisar acessar vendas.
- Administração delegável (`access.manage`) sem escalada: ninguém concede o que não tem.

**Próximas semanas:** CRM e KPIs (semana 3); assistente de IA, bot do Telegram e deploy (semana 4).

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript estrito (Node.js 24 executa `.ts` direto, sem etapa de build no backend) |
| Backend | Fastify 5, Drizzle ORM, driver `postgres`, Zod, Argon2id |
| Banco | PostgreSQL 17 (Docker no desenvolvimento; Supabase em produção) |
| Frontend | React 19, Vite 8, React Router 8, TanStack Query |
| Compartilhado | `packages/shared`: schemas Zod e matriz de permissões usados no front e no back |
| Qualidade | Biome (lint e formatação), Vitest, GitHub Actions, Dependabot |

## Execução local

Pré-requisitos: **Node.js 24+**, **Docker** e as portas `5432`, `3001` e `5173` livres.

```bash
npm install
cp backend/.env.example backend/.env
npm run db:up        # sobe o PostgreSQL (cria também o banco de testes)
npm run db:migrate   # aplica as migrações
npm run db:seed      # dados de demonstração (APAGA o banco de desenvolvimento)
npm run dev          # API em :3001 e interface em :5173
```

Abra [http://localhost:5173](http://localhost:5173). Healthcheck da API: [http://localhost:5173/api/health](http://localhost:5173/api/health).

## Usuários de demonstração

O seed cria duas empresas, cada uma com os três papéis. A senha de todos é `senha-demo-123`.

| Empresa | Proprietário | Vendedor | Contador |
|---|---|---|---|
| Ateliê Aranduê | `dono@atelie.test` | `vendedor@atelie.test` | `contador@atelie.test` |
| Doces da Vila | `dono@doces.test` | `vendedor@doces.test` | `contador@doces.test` |

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | API e frontend com recarga automática |
| `npm test` | Testes do backend (banco `arandue_test`, recriado a cada execução) |
| `npm run typecheck` | Checagem de tipos dos três pacotes |
| `npm run lint` / `npm run format` | Verifica / corrige lint e formatação (Biome) |
| `npm run build` | Build de produção do frontend |
| `npm run db:generate` | Gera uma nova migração a partir de `backend/src/db/schema.ts` |
| `npm run db:migrate` / `npm run db:seed` | Aplica migrações / recria os dados de demonstração |

## Arquitetura

```text
Navegador ──> React (Vite) ──/api──> Fastify
                                       │  sessão (cookie) → ctx { userId, companyId, role }
                                       ▼
                                 routes/   só HTTP
                                 services/ regras + permissão + empresa + auditoria
                                       ▼
                                 PostgreSQL (company_id em toda tabela de negócio)
```

Toda função de serviço recebe o contexto de quem está agindo, verifica a permissão do grupo de acesso (`authorize(ctx, 'quotes.approve')`, catálogo em `packages/shared/src/permissions.ts`) e filtra pela empresa (e pelo criador, em grupos restritos aos próprios registros). É a mesma camada que o assistente de IA e o bot do Telegram vão usar na semana 4.

## Segurança

- **Senhas** com Argon2id. O login responde igual para e-mail inexistente e senha errada, com tempo equivalente.
- **Sessão** em cookie `HttpOnly`, `SameSite=Lax` (e `Secure` + prefixo `__Host-` em produção). O banco guarda só o hash do token, e o logout revoga a sessão de verdade.
- **CSRF:** a API aceita só JSON e recusa requisições que alteram dados vindas de outras origens.
- **Isolamento:** IDs vindos do cliente (cliente, produto, conta) são conferidos contra a empresa do usuário.
- **Cabeçalhos** de segurança (`@fastify/helmet`) e limite de requisições, mais rígido nas rotas de login e cadastro.
- **Banco** exposto só em `127.0.0.1` no ambiente local.

## API

Todas as rotas ficam sob `/api` e, exceto as de autenticação e o healthcheck, exigem sessão.

```text
GET  /health
POST /auth/register   POST /auth/login   POST /auth/logout   GET /auth/me

GET|POST        /customers        GET|PUT|DELETE /customers/:id
GET|POST        /suppliers        GET|PUT|DELETE /suppliers/:id
GET|POST        /products         GET|PUT|DELETE /products/:id
GET|POST        /bank-accounts    GET|PUT|DELETE /bank-accounts/:id
GET             /bank-accounts/options   (lista mínima para quem registra vendas)
GET|POST        /expenses         GET|PUT|DELETE /expenses/:id
GET|POST        /transactions     GET|PUT|DELETE /transactions/:id
GET|POST        /orders           GET|PUT|DELETE /orders/:id
GET|POST        /quotes           GET|PUT|DELETE /quotes/:id   (PUT só em rascunho)
POST            /quotes/:id/send | /approve | /reject | /convert
GET             /receivables      POST /receivables/:id/settle  (contas a receber)
GET|POST        /access-groups    GET|PUT|DELETE /access-groups/:id
GET|POST        /users            GET|PUT /users/:id           (sem DELETE: desativar)
GET             /dashboard
GET|PUT         /company          (configurações da empresa, incluindo o limite anual do MEI)
```

Os campos usam camelCase e as datas vêm no formato `AAAA-MM-DD`. Os erros retornam `{ "message": "..." }` com o status adequado: 400 (validação), 401, 403, 404 ou 409.

## Regras de negócio

1. **Estoque:** criar um pedido baixa o estoque dos produtos físicos dentro de uma transação, com bloqueio de linha, para que vendas simultâneas não vendam a mesma unidade. Estoque insuficiente retorna 400 e nada é alterado. Cancelar ou excluir o pedido devolve o estoque, e reativar um pedido cancelado valida o saldo de novo.
2. **Caixa:** pedido **pago** ou **concluído** gera uma única entrada no caixa, e despesa **paga** com conta gera uma única saída. Voltar o status a pendente remove a movimentação. Movimentações geradas automaticamente não podem ser editadas diretamente (409).
3. **Saldo:** saldo inicial mais movimentações, considerando só contas ativas nos dois termos.
4. **Histórico:** produto usado em pedido e conta com movimentação são **arquivados** em vez de excluídos.
5. **Orçamentos:** não mexem em estoque nem caixa. Só rascunho é editável; enviar, aprovar/recusar e converter têm permissões próprias (`quotes.send`, `quotes.approve`, `quotes.convert`). Converter cria o pedido com os itens e preços do orçamento, uma única vez (409 na segunda tentativa); orçamento convertido não pode ser excluído.
6. **Usuários:** não são excluídos (preserva a auditoria). Desativar ou trocar a senha de outra pessoa encerra as sessões dela. Ninguém muda o próprio grupo nem se desativa, e a empresa mantém ao menos um proprietário ativo.
7. **Permissões:** cada usuário pertence a um grupo de acesso; as permissões são lidas a cada requisição (mudança vale na hora). Marcar pedido como pago/concluído exige `receivables.settle`; pagar despesa exige `payables.pay`. Pré-requisitos são completados automaticamente (qualquer ação implica "ver"; montar orçamento ou pedido implica ver produtos e clientes). O grupo Proprietário é fixo; quem gerencia grupos só concede o que tem e não tira de si a gestão; grupo com usuários não é excluído.
8. **Numeração:** pedidos e orçamentos são numerados por empresa (#001, #002...), com contador travado na mesma transação. O número exibido não revela o volume de outras empresas.
9. **Limite do MEI:** cada empresa informa o limite anual vigente em **Configurações**. É obrigatório: o proprietário é levado à tela até preencher. O dashboard compara o faturamento do ano (pedidos pagos ou concluídos) com esse valor.

## Testes

```bash
npm run db:up && npm test
```

Os 40 testes cobrem autenticação (sessão, logout, senha, e-mail duplicado), **isolamento entre empresas**, **permissões e grupos de acesso** (escopo "só os próprios", escalada de privilégio, travas do Proprietário, mudança imediata), estoque (incluindo pedidos simultâneos), sincronização do caixa, numeração por empresa, configurações da empresa, o fluxo **orçamento → pedido → estoque → caixa**, gestão de usuários e validação de entrada. O CI roda lint, typecheck, testes, build e `npm audit` a cada push.

## Estrutura do projeto

```text
.
├── packages/shared/src/
│   ├── permissions.ts          # Catálogo de permissões, pré-requisitos e grupos padrão
│   └── schemas/index.ts        # Schemas Zod (validação no front e no back)
├── backend/
│   ├── drizzle/                # Migrações SQL geradas
│   ├── db-init/                # Script de criação do banco de testes (Docker)
│   └── src/
│       ├── app.ts, server.ts   # Montagem do Fastify / inicialização
│       ├── config.ts           # Variáveis de ambiente validadas
│       ├── db/                 # Schema Drizzle, conexão, migrate e seed
│       ├── lib/                # Erros, contexto/autorização, utilitários
│       ├── plugins/            # Segurança, sessão e tratamento de erros
│       ├── routes/             # Rotas HTTP (sem regra de negócio)
│       ├── services/           # Regras de negócio por módulo + auditoria
│       └── tests/              # Testes de integração (Vitest)
├── frontend/src/
│   ├── components/             # Layout, modal, formulário e tabela genéricos
│   ├── config/                 # Menu e definição dos formulários
│   ├── lib/                    # Cliente da API, autenticação, formatação
│   ├── pages/                  # Telas (carregadas sob demanda)
│   └── styles.css
├── compose.yaml                # PostgreSQL local
├── PLANEJAMENTO_V2.md          # Plano da versão 2 (4 semanas)
└── PLANEJAMENTO_ESCALABILIDADE.md
```

## Solução de problemas

- **`ECONNREFUSED` ao rodar migrações ou testes:** o Postgres não está ativo. Rode `npm run db:up` e confira com `docker compose ps`.
- **Porta 5432 ocupada:** outro Postgres está rodando na máquina. Pare-o ou mude a porta em `compose.yaml` e em `backend/.env`.
- **Volume antigo sem o banco de testes:** o banco `arandue_test` só é criado na primeira inicialização do volume. Recrie com `docker compose down -v && npm run db:up` (isso apaga os dados locais).
- **401 em todas as telas:** a sessão expirou ou o banco foi recriado pelo seed. Faça login de novo.

## Planejamento

- [PLANEJAMENTO_V2.md](PLANEJAMENTO_V2.md): escopo, stack, cronograma e riscos da versão 2.
- [PLANEJAMENTO_ESCALABILIDADE.md](PLANEJAMENTO_ESCALABILIDADE.md): evolução de longo prazo para um SaaS comercial.

## Licença

Distribuído sob a licença MIT. Consulte o arquivo [LICENSE](LICENSE).
