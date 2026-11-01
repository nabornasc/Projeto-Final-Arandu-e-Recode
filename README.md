# Aranduê

Aplicação web de gestão para pequenos empreendedores (MEIs). O projeto centraliza produtos e serviços, clientes, pedidos, despesas, contas bancárias e movimentações financeiras em um único painel integrado.

O protótipo foi desenvolvido em alinhamento ao **ODS 1 — Erradicação da Pobreza**, com foco em organização financeira, controle de estoque e apoio à tomada de decisões estratégicas para quem empreende por conta própria.

## Índice

- [Funcionalidades](#funcionalidades)
- [Tecnologias](#tecnologias)
- [Arquitetura](#arquitetura)
- [Pré-requisitos](#pré-requisitos)
- [Execução rápida](#execução-rápida)
- [Execução em desenvolvimento](#execução-em-desenvolvimento)
- [Configuração](#configuração)
- [Banco de dados](#banco-de-dados)
- [API](#api)
- [Regras de automação financeira e estoque](#regras-de-automação-financeira-e-estoque)
- [Testes manuais](#testes-manuais)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Solução de problemas](#solução-de-problemas)
- [Plano de escalabilidade](#plano-de-escalabilidade)
- [Licença](#licença)

---

## Funcionalidades

- **Dashboard financeiro integrado:** faturamento de vendas, despesas pagas, saldo estimado real (contas bancárias + movimentações) e contagem de pedidos pendentes.
- **Catálogo de produtos e serviços:** cadastro, edição e exclusão de itens com preços, custos e controle de quantidade em estoque.
- **Gestão de clientes:** cadastro e histórico de contatos (nome, documento, telefone, e-mail e endereço).
- **Contas bancárias e carteiras:** suporte a contas correntes, poupanças e caixa físico da loja.
- **Gestão de despesas:** controle de saídas pendentes e pagas com vinculação direta à conta bancária de débito.
- **Gestão de vendas e pedidos:**
  - Criação de pedidos com seleção reativa de produtos, cálculo automático de totais com desconto.
  - Baixa automática no estoque físico ao confirmar a venda.
  - Atualização dinâmica de status do pedido (**Pendente**, **Pago** ou **Cancelado**).
- **Sincronização de fluxo de caixa:**
  - Pedidos marcados como **Pago** geram automaticamente uma entrada no caixa (`income`).
  - Despesas marcadas como **Pago** geram automaticamente uma saída no caixa (`outcome`).
  - Cancelamento ou exclusão de pedidos devolve os produtos ao estoque e remove a transação vinculada.
- **Arquivamento seguro (Soft Delete):** produtos utilizados em pedidos não são excluídos fisicamente para preservar a integridade histórica das vendas.

---

## Tecnologias

- **Frontend:** React 18, Vite e `lucide-react`.
- **Backend:** Node.js, Express e `mysql2` (Driver Promise).
- **Banco de dados:** MySQL 8.4.
- **Ambiente:** Docker Compose.

---

## Arquitetura

```text
Navegador
   │
   ├── Frontend React/Vite       http://localhost:5173
   │       │ (proxy /api)
   │       └── API REST          http://localhost:3001/api
   │                              │
   └── Backend Express ───────────┘
                                  │
                              MySQL 8.4
                         host: localhost:3307
```

Dentro da rede Docker, o backend acessa o banco usando `DB_HOST=mysql` e `DB_PORT=3306`. Fora do Docker (em desenvolvimento local), o banco é acessado pelo host `127.0.0.1` na porta `3307`.

---

## Pré-requisitos

- Node.js 18 ou superior.
- npm.
- Docker Engine e Docker Compose.
- Portas livres `3001`, `3307` e `5173`.

---

## Execução rápida

No diretório raiz do projeto:

```bash
npm install
docker compose up -d --build
npm run dev --workspace frontend
```

Depois, abra:

- **Aplicação Web:** [http://localhost:5173](http://localhost:5173)
- **Healthcheck da API:** [http://localhost:3001/api/health](http://localhost:3001/api/health)

O comando `docker compose up` inicia o MySQL e o backend. O backend só é iniciado após o healthcheck do MySQL estar aprovado.

Para acompanhar os logs dos serviços:

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f mysql
```

Para parar os serviços sem apagar os dados persistidos:

```bash
docker compose down
```

---

## Execução em desenvolvimento

Para executar o backend localmente no terminal (com reload automático via `node --watch`) mantendo apenas o MySQL no Docker:

```bash
docker compose up -d mysql
npm run dev --workspace backend
```

Em outro terminal, inicie o frontend:

```bash
npm run dev --workspace frontend
```

Ou execute ambos em paralelo com o script da raiz:

```bash
npm run dev
```

---

## Configuração

O backend aceita as seguintes variáveis de ambiente:

| Variável | Padrão local | Uso no Docker | Descrição |
|---|---|---|---|
| `PORT` | `3001` | `3001` | Porta HTTP da API Express |
| `DB_HOST` | `127.0.0.1` | `mysql` | Endereço do banco de dados |
| `DB_PORT` | `3307` | `3306` | Porta de conexão do banco |
| `DB_NAME` | `arandue` | `arandue` | Nome do banco de dados |
| `DB_USER` | `arandue` | `arandue` | Usuário do MySQL |
| `DB_PASSWORD` | `arandue` | `arandue` | Senha do usuário do MySQL |

Para personalizar localmente, copie o arquivo de exemplo:

```bash
cp backend/.env.example backend/.env
```

---

## Banco de dados

O schema está em [backend/sql/001_schema.sql](backend/sql/001_schema.sql) e os dados iniciais em [backend/sql/002_seed.sql](backend/sql/002_seed.sql). Esses arquivos são executados automaticamente pelo MySQL no primeiro boot do volume.

Tabelas principais:

- `products`: catálogo de produtos e serviços com controle de custo e estoque.
- `customers`: clientes e histórico de contatos.
- `bank_accounts`: contas correntes, poupanças e caixas físicos.
- `orders`: pedidos de venda com cliente, data, desconto, total e status.
- `order_items`: itens vinculados aos pedidos com quantidade e preço unitário.
- `expenses`: despesas do negócio categorizadas e vinculadas a contas.
- `cash_transactions`: livro-caixa de entradas e saídas financeiras.

Para recriar completamente o banco (apagando o volume local):

```bash
docker compose down -v
docker compose up -d --build
```

---

## API

### Healthcheck e Dashboard

```http
GET /api/health
GET /api/dashboard
```

### Recursos CRUD Genéricos

Os seguintes recursos suportam todas as operações do padrão REST:

```text
GET    /api/:resource        (Lista todos os registros)
GET    /api/:resource/:id    (Consulta um registro específico)
POST   /api/:resource        (Cria um novo registro)
PUT    /api/:resource/:id    (Atualiza um registro existente)
DELETE /api/:resource/:id    (Remove ou inativa o registro)
```

Recursos disponíveis:
- `/api/products`
- `/api/customers`
- `/api/bankAccounts`
- `/api/expenses`
- `/api/transactions`

### Vendas e Pedidos

```text
GET    /api/orders           (Lista pedidos com cliente e itens)
GET    /api/orders/:id       (Consulta pedido detalhado)
POST   /api/orders           (Cria pedido, baixa estoque e gera entrada se pago)
PUT    /api/orders/:id       (Atualiza status/dados, reconcilia estoque e caixa)
DELETE /api/orders/:id       (Exclui pedido e estorna estoque/caixa)
```

---

## Regras de automação financeira e estoque

1. **Baixa e estorno de estoque:**
   - Ao criar um pedido com produto físico (`type = 'product'`), o estoque é validado e reduzido automaticamente.
   - Caso o estoque seja insuficiente, a API retorna erro `400 Bad Request`.
   - Se o status do pedido for alterado para `cancelled` ou o pedido for deletado, a quantidade é estornada ao estoque.
2. **Sincronização com o fluxo de caixa:**
   - Pedidos com status `paid` geram uma transação de entrada (`income`) na conta selecionada.
   - Despesas com status `paid` geram uma transação de saída (`outcome`) na conta bancária de débito.
   - Se um pedido ou despesa tiver seu status revertido para `pending`, a movimentação de caixa correspondente é removida, mantendo o saldo fiel à realidade.
3. **Preservação de histórico:**
   - Produtos associados a vendas existentes não são deletados fisicamente; recebem `active = FALSE`, preservando relatórios e pedidos anteriores.

---

## Testes manuais

### Testar a conexão

```bash
curl -i http://localhost:3001/api/health
```

Resposta esperada:

```json
{"status":"ok"}
```

### Testar ciclo completo de cliente (Inserção, Consulta e Exclusão)

```bash
# 1. Cria um cliente
response=$(curl -sS -X POST http://localhost:3001/api/customers \
  -H 'Content-Type: application/json' \
  -d '{"name":"Cliente de Teste","email":"teste@example.invalid"}')

id=$(printf '%s' "$response" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')

# 2. Consulta pelo ID
curl -i "http://localhost:3001/api/customers/$id"

# 3. Exclui o cliente
curl -i -X DELETE "http://localhost:3001/api/customers/$id"

# 4. Confirma exclusão (deve retornar 404)
curl -i "http://localhost:3001/api/customers/$id"
```

---

## Estrutura do projeto

```text
.
├── backend/
│   ├── src/
│   │   ├── db.js                     # Pool de conexões MySQL
│   │   └── server.js                 # API REST, transações e automações
│   ├── sql/
│   │   ├── 001_schema.sql            # Definição das tabelas e índices
│   │   └── 002_seed.sql              # Dados de demonstração
│   ├── .env.example                  # Variáveis de ambiente
│   ├── Dockerfile                    # Container da API
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/               # Componentes modulares de interface
│   │   │   ├── Dashboard.jsx         # Visão geral de métricas e pedidos
│   │   │   ├── EmptyState.jsx        # Estado vazio das tabelas
│   │   │   ├── FormModal.jsx         # Formulários modais com selects dinâmicos
│   │   │   ├── MetricCard.jsx        # Cards de faturamento e saldo
│   │   │   ├── Orders.jsx            # Gestão e formulário de pedidos reativos
│   │   │   ├── ResourcePage.jsx      # Página genérica para recursos CRUD
│   │   │   ├── Sidebar.jsx           # Menu de navegação lateral
│   │   │   ├── Toast.jsx             # Notificações de sucesso/erro
│   │   │   └── Topbar.jsx            # Cabeçalho com data dinâmica
│   │   ├── config/
│   │   │   └── resources.js          # Definições de campos e tabelas
│   │   ├── services/
│   │   │   └── api.js                # Cliente de requisições HTTP
│   │   ├── utils/
│   │   │   └── formatters.js         # Formatadores de moeda, data e status
│   │   ├── App.jsx                   # Shell principal da aplicação
│   │   ├── main.jsx                  # Ponto de entrada React
│   │   └── styles.css                # Folha de estilos e responsividade
│   ├── index.html
│   ├── vite.config.js                # Configuração do Vite com proxy /api
│   └── package.json
├── compose.yaml                      # Ambiente MySQL e Backend
├── compose.debug.yaml                # Ambiente de depuração Node Inspector
├── package.json                      # Workspaces e scripts globais
├── PLANEJAMENTO_ESCALABILIDADE.md    # Estratégia completa de crescimento e produção
├── LICENSE                           # Licença MIT
└── README.md
```

---

## Solução de problemas

### Porta já está em uso

Verifique processos ou containers ocupando as portas:

```bash
docker compose ps
ss -ltnp | grep -E '3001|3307|5173'
```

### API retorna erro de conexão com MySQL

Verifique o status do container do banco:

```bash
docker compose ps
docker compose logs mysql
curl http://localhost:3001/api/health
```

### Problemas com o Frontend Vite

Confira o terminal onde você executou `npm run dev --workspace frontend`.
Caso veja erros de carregamento, verifique se a API está respondendo em [http://localhost:3001/api/health](http://localhost:3001/api/health) e recarregue a página no navegador com `Ctrl + Shift + R`.

### Erro `EACCES` no cache do Vite

Se aparecer uma mensagem como:

```text
EACCES: permission denied, unlink 'frontend/node_modules/.vite/deps/_metadata.json'
```

o cache foi criado por outro usuário, geralmente ao executar o frontend dentro de um container como `root`. Corrija somente a pasta de cache:

```bash
docker run --rm \
  -v "$PWD/frontend/node_modules/.vite:/cache" \
  alpine:3.20 \
  chown -R "$(id -u):$(id -g)" /cache
```

Depois, execute novamente:

```bash
npm run dev --workspace frontend
```

Evite usar `sudo npm install` ou iniciar o Vite como `root` no diretório do projeto, pois isso pode recriar arquivos sem permissão para o usuário normal.

---

## Plano de escalabilidade

Para ver o plano detalhado de evolução do sistema para um produto SaaS comercial (autenticação multi-tenant, integração com PIX, emissão de NF-e, filas e infraestrutura em nuvem), consulte o documento:

👉 **[PLANEJAMENTO_ESCALABILIDADE.md](PLANEJAMENTO_ESCALABILIDADE.md)**

O planejamento da próxima entrega (versão 2: multiempresa, RBAC, orçamentos, CRM, KPIs e assistente de IA, em 4 semanas) está em:

👉 **[PLANEJAMENTO_V2.md](PLANEJAMENTO_V2.md)**

---

## Licença

Distribuído sob a licença MIT. Consulte o arquivo [LICENSE](LICENSE) para mais informações.
