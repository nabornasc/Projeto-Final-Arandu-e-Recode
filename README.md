# Aranduê

SaaS de gestão para microempreendedores individuais (MEIs): vendas, estoque, clientes e caixa em um só lugar, com dados isolados por empresa e controle de acesso por papel.

Desenvolvido em alinhamento ao **ODS 1 — Erradicação da Pobreza**, com foco em organização financeira e apoio à decisão para quem empreende por conta própria.

> **[Demonstração no ar](https://arandue-mu.vercel.app).** Entre com `dono@atelie.test` e a senha `senha-demo-123`. Os dados são fictícios e compartilhados, e voltam ao padrão às 00h e às 12h de Cuiabá.
>
> **Versão 2 em evolução.** A v1 (monousuário, MySQL) está preservada na tag `v1.0.0`. O andamento da v2 segue o [PLANEJAMENTO_V2.md](PLANEJAMENTO_V2.md).

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
- [Publicação](DEPLOY.md)
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

- 53 permissões por ação (ex.: aprovar orçamento, dar baixa no recebimento, pagar despesa), combinadas em **grupos de acesso** que cada empresa cria e edita numa matriz.
- Grupos padrão **Proprietário** (acesso total, fixo), **Vendedor** e **Contador**.
- Escopo por grupo: ver todos os orçamentos e pedidos da empresa ou **só os próprios**.
- **Contas a receber**: o financeiro dá baixa nos pedidos pendentes sem precisar acessar vendas.
- Administração delegável (`access.manage`) sem escalada: ninguém concede o que não tem.

**Etapa de experiência de uso — parte 1 (abas e ações) concluída:**

- Área de trabalho com **abas fixas**: cada tela ou documento aberto vira uma aba que guarda o estado ao alternar; "abrir ao lado" mostra duas abas em paralelo (telas a partir de 1100 px). As abas são lembradas ao recarregar.
- Orçamento e pedido têm **tela própria** (em vez de janela), com aviso de alterações não salvas.
- **Menu de ações ⋯** em listas e documentos, conforme status e permissão: abrir, enviar, aprovar, recusar, converter, dar baixa, concluir, cancelar, reativar, duplicar, copiar para o outro tipo e excluir.

**v2.2 — Oportunidades e rastreio comercial:**

- Funil em colunas com etapas configuráveis por empresa e total em R$ por coluna; lista com filtros e totais no rodapé.
- Oportunidade com cliente ou contato, valor estimado, previsão, responsável, próxima ação (atrasadas em destaque), itens de interesse e histórico de atividades por tipo e canal.
- **Situação separada da etapa:** perdida ou ganha guarda onde parou. Perder exige o motivo; **ganhar vira cliente** sem duplicar (reaproveita cadastro com mesmo e-mail ou telefone).
- **A etapa anda sozinha, só para frente**, conforme os orçamentos e pedidos vinculados; pedido recebido ganha a oportunidade.
- **Rastreio** em cada documento: Oportunidade → Orçamento → duplicado → Pedido → recebido, com links. O vínculo acompanha ao converter, duplicar e copiar.
- Permissões próprias (`opportunities.*`) com escopo "só os próprios" pelo responsável.

**v2.1 — Cadastro único de pessoas:**

- Clientes, fornecedores, transportadoras e representantes num só cadastro com papéis (quem é cliente e fornecedor é cadastrado uma vez).
- Pessoa física ou jurídica com CPF/CNPJ validados e únicos por empresa; inscrição estadual, contribuinte, regime tributário.
- **Busca de CNPJ** (Receita Federal, pela BrasilAPI) e **de CEP** (ViaCEP), feitas pelo servidor; se o serviço falhar, o cadastro segue manual.
- Endereço estruturado, vários contatos, endereços de entrega e cobrança e aba Comercial (pagamento, frete e transportadora padrão, categoria, região, limite de crédito e **vendedor da carteira**, alterável só com a permissão `customers.assign`).

**v2.3 — Publicação e histórico de alterações:**

- Aba **Histórico** em orçamentos e pedidos: quem fez, o quê e quando. O clique abre o detalhe, com valores de antes e depois, campo a campo e item a item.
- **Tela de auditoria** com todos os módulos, filtros por usuário, módulo, ação e período, e a permissão `audit.read`.
- **Dados pessoais protegidos:** CPF/CNPJ, e-mail, telefone, endereço e senha aparecem como "alterado", sem guardar o valor.
- **Motivo obrigatório** ao recusar orçamento e ao cancelar orçamento ou pedido.
- Orçamento enviado ou aprovado é **cancelado** em vez de excluído; só rascunhos são excluídos. Documento excluído continua consultável no histórico.

O plano completo está em [PLANEJAMENTO_ORCAMENTOS_HISTORICO.md](PLANEJAMENTO_ORCAMENTOS_HISTORICO.md).

- **Publicada** na Vercel e no Supabase, em São Paulo, como demonstração que volta aos dados padrão a cada 12 horas ([guia](DEPLOY.md)).

**Próxima versão:** v2.4, navegação e produtividade. O roadmap completo está na seção 11 do [planejamento](PLANEJAMENTO_V2.md).

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript estrito (Node.js 24 executa `.ts` direto, sem etapa de build no backend) |
| Backend | Fastify 5, Drizzle ORM, driver `postgres`, Zod, Argon2id |
| Banco | PostgreSQL 17 (Docker no desenvolvimento; Supabase em produção) |
| Frontend | React 19, Vite 8, React Router 8, TanStack Query |
| Compartilhado | `packages/shared`: schemas Zod e matriz de permissões usados no front e no back |
| Qualidade | Biome (lint e formatação), Vitest, Playwright, GitHub Actions, Dependabot |
| Monitoramento | Sentry, opcional (erros, sem dados pessoais) |

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
| `npm run test:e2e` | Testes ponta a ponta no navegador (banco `arandue_e2e` e portas 3101 e 5174, recriados a cada execução) |
| `npm run typecheck` | Checagem de tipos dos pacotes e dos testes ponta a ponta |
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

GET|POST        /people?role=&q=  GET|PUT|DELETE /people/:id   (cadastro único; GET /people/sellers)
GET|POST        /customers        GET|PUT|DELETE /customers/:id (atalho: pessoas com papel de cliente)
GET|POST        /suppliers        GET|PUT|DELETE /suppliers/:id (atalho: fornecedores)
GET             /lookup/cnpj/:cnpj   GET /lookup/cep/:cep   (consulta externa, 20/min)
GET|POST        /products         GET|PUT|DELETE /products/:id
GET|POST        /bank-accounts    GET|PUT|DELETE /bank-accounts/:id
GET             /bank-accounts/options   (lista mínima para quem registra vendas)
GET|POST        /expenses         GET|PUT|DELETE /expenses/:id
GET|POST        /transactions     GET|PUT|DELETE /transactions/:id
GET|POST        /orders           GET|PUT|DELETE /orders/:id
GET|POST        /quotes           GET|PUT|DELETE /quotes/:id   (PUT só em rascunho)
POST            /quotes/:id/send | /approve | /reject | /cancel | /convert | /duplicate | /copy-to-order
POST            /orders/:id/duplicate | /copy-to-quote
POST            /quotes/:id/link | /opportunity   POST /orders/:id/link | /opportunity
GET|POST        /opportunities    GET|PUT|DELETE /opportunities/:id   (lista aceita filtros e traz os totais)
POST            /opportunities/:id/stage | /status | /interactions   GET /opportunities/owners
GET|POST        /pipeline-stages  PUT|DELETE /pipeline-stages/:id   PUT /pipeline-stages/order
GET             /trace/:tipo/:id  (cadeia do documento: quote ou order)
GET             /history/:tipo/:id   GET /history/entry/:id  (histórico do documento e detalhe de um registro)
GET             /history   GET /history/options  (tela de auditoria: filtros e paginação; exige audit.read)
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
4. **Histórico:** produto usado em pedido, orçamento ou oportunidade e conta com movimentação são **arquivados** em vez de excluídos.
5. **Orçamentos:** não mexem em estoque nem caixa. Só rascunho é editável; enviar, aprovar/recusar, converter e cancelar têm permissões próprias (`quotes.send`, `quotes.approve`, `quotes.convert`, `quotes.cancel`). Recusar e cancelar exigem o motivo. Converter cria o pedido com os itens e preços do orçamento, uma única vez (409 na segunda tentativa). Só rascunho é excluído; enviado ou aprovado sem pedido é cancelado, de forma definitiva (para retomar, duplica-se).
6. **Usuários:** não são excluídos (preserva a auditoria). Desativar ou trocar a senha de outra pessoa encerra as sessões dela. Ninguém muda o próprio grupo nem se desativa, e a empresa mantém ao menos um proprietário ativo.
7. **Pessoas:** papéis usam as permissões de clientes (`customers.*`) ou de fornecedores (`suppliers.*`, também para transportadoras e representantes); mexer numa pessoa exige a permissão de todos os seus papéis. Pessoa já usada em orçamento, pedido ou oportunidade é arquivada em vez de excluída.
8. **Permissões:** cada usuário pertence a um grupo de acesso; as permissões são lidas a cada requisição (mudança vale na hora). Marcar pedido como pago/concluído exige `receivables.settle`; pagar despesa exige `payables.pay`. Pré-requisitos são completados automaticamente (qualquer ação implica "ver"; montar orçamento ou pedido implica ver produtos e clientes). O grupo Proprietário é fixo; quem gerencia grupos só concede o que tem e não tira de si a gestão; grupo com usuários não é excluído.
9. **Numeração:** pedidos e orçamentos são numerados por empresa (#001, #002...), com contador travado na mesma transação. O número exibido não revela o volume de outras empresas.
10. **Limite do MEI:** cada empresa informa o limite anual vigente em **Configurações**. É obrigatório: o proprietário é levado à tela até preencher. O dashboard compara o faturamento do ano (pedidos pagos ou concluídos) com esse valor.
11. **Oportunidades:** a etapa anda sozinha só para frente (orçamento enviado; orçamento aprovado ou pedido criado; pedido recebido ganha) e pode ser mudada à mão enquanto a oportunidade está em andamento. Encerrada precisa ser reaberta antes de mudar de situação. Cada marco fica em uma etapa; etapa em uso e a última etapa não são excluídas.
12. **Rastreio:** cada documento guarda de qual orçamento ou pedido nasceu, mesmo sem oportunidade. Vincular e desvincular descem para os documentos gerados que estejam na mesma situação, sem arrastar os de outra oportunidade nem, em grupos "só os próprios", os de outro usuário. O rastreio mostra só o que quem consulta pode ver.
13. **Histórico:** todos os módulos registram quem fez, quando e o que mudou, na mesma transação da alteração. Salvar sem mudar nada não gera registro. Em orçamentos e pedidos, quem vê o documento vê o histórico dele, com o escopo "só os próprios"; a tela geral e os demais módulos exigem `audit.read`, que alcança tudo da empresa. Dados pessoais e senha ficam só como "alterado". A aplicação não oferece editar nem apagar registros. Cancelar pedido também exige o motivo.

## Testes

```bash
npm run db:up && npm test
```

Os 101 testes cobrem autenticação (sessão, logout, senha, e-mail duplicado), **isolamento entre empresas**, **permissões e grupos de acesso** (escopo "só os próprios", escalada de privilégio, travas do Proprietário, mudança imediata), estoque (incluindo pedidos simultâneos), sincronização do caixa, numeração por empresa, configurações da empresa, o fluxo **orçamento → pedido → estoque → caixa**, gestão de usuários, duplicar e copiar documentos, oportunidades (funil configurável, situação, ganho → cliente sem duplicar, escopo pelo responsável), rastreio (ciclo completo, vínculo em cadeia, visibilidade), histórico (o que mudou, motivo obrigatório, documento excluído, escopo e isolamento), cadastro de pessoas (CPF/CNPJ, papéis, carteira, arquivamento) e consulta de CNPJ/CEP com o serviço externo simulado, além da validação de entrada. O CI roda lint, typecheck, testes, build e `npm audit` a cada push.

Os 20 testes ponta a ponta (Playwright) usam a interface de verdade: histórico, auditoria, motivo obrigatório, cancelamento, conversão em pedido, estoque, permissões, isolamento entre empresas e abas. Na primeira vez, baixe o navegador com `npx playwright install chromium`.

```bash
npm run test:e2e
```

Eles não tocam no banco de desenvolvimento, mas precisam do PostgreSQL ativo e de um usuário que possa criar bancos.

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
│   ├── actions/                # Registro central de ações, menu ⋯ e janelas das ações
│   ├── workspace/              # Abas, painéis lado a lado e catálogo de telas
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
- **Docker indisponível (Windows):** instale o PostgreSQL 17 nativo. Os comandos estão em [RECOMENDACOES_AMBIENTE_LOCAL.md](RECOMENDACOES_AMBIENTE_LOCAL.md).
- **Porta 5432 ocupada:** outro Postgres está rodando na máquina. Pare-o ou mude a porta em `compose.yaml` e em `backend/.env`.
- **Volume antigo sem o banco de testes:** o banco `arandue_test` só é criado na primeira inicialização do volume. Recrie com `docker compose down -v && npm run db:up` (isso apaga os dados locais).
- **401 em todas as telas:** a sessão expirou ou o banco foi recriado pelo seed. Faça login de novo.

## Planejamento

- [PLANEJAMENTO_V2.md](PLANEJAMENTO_V2.md): escopo, stack, cronograma e riscos da versão 2.
- [PLANEJAMENTO_ESCALABILIDADE.md](PLANEJAMENTO_ESCALABILIDADE.md): evolução de longo prazo para um SaaS comercial.

## Licença

Distribuído sob a licença MIT. Consulte o arquivo [LICENSE](LICENSE).
