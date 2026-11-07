# Planejamento: sequência em etapas

Organizado em 06/11/2026. **Este arquivo é a fonte única da ordem de trabalho das duas estações.** Os outros planos continuam guardando os detalhes de cada assunto.

Nada aqui tem data. Uma etapa só começa com pedido do dono do projeto, e a ordem pode mudar a cada ciclo. O projeto é só para estudo e demonstração: o critério é o que ensina e cabe no MEI.

## Visão geral

| Etapa | Conteúdo | Situação | Detalhes em |
|---|---|---|---|
| 1 | Fechar o que já está na `main` e resolver pendências pequenas | **Próxima** | Este arquivo |
| 2 | Estoque: mínimo com aviso, ajuste com motivo e unidade no produto | Sugerida em seguida | [Operações](PLANEJAMENTO_OPERACOES.md), seções 7 e 9 |
| 3 | Listas configuráveis e grupo do produto | Planejada | [Listas](PLANEJAMENTO_LISTAS.md) |
| 4 | Central de relatórios com exportação em CSV | Planejada | [Relatórios](PLANEJAMENTO_RELATORIOS.md) |
| 5 | Agenda: dia, semana, mês e lista | Planejada | [Operações](PLANEJAMENTO_OPERACOES.md), seção 9 |
| 6 | Navegação: menu por módulos, cadastro rápido, paginação, busca e atalhos | Planejada | [Plano da v2](PLANEJAMENTO_V2.md), seção 7 |
| 7 | Restante dos documentos | Planejada | [Plano da v2](PLANEJAMENTO_V2.md), seção 11 |
| 8 | Gestão: precificação, dashboard modular e metas | Planejada | [Plano da v2](PLANEJAMENTO_V2.md), seções 7.8 e 11 |
| 9 | Operações opcionais: compras, entrega, baixa em contas a pagar e renegociação | Só se ainda houver interesse | [Operações](PLANEJAMENTO_OPERACOES.md), seções 4, 9 e 10 |
| 10 | Assistente de IA: chat de ajuda e bot do Telegram | Planejada | [Plano da v2](PLANEJAMENTO_V2.md), seção 10 |

## Por que esta ordem

- **Estoque antes de relatórios:** o ajuste com motivo cria o registro de movimentos, que os relatórios de extrato e de movimentação de estoque precisam.
- **Listas antes de relatórios:** filtros por categoria e forma de pagamento dependem de dados padronizados.
- **Grupo do produto com as listas:** sem elas, o grupo seria mais um campo de texto livre. Por isso sai da etapa do estoque.
- **Agenda depois dos títulos:** contas a receber por parcela já existem, então a agenda nasce com conteúdo.
- **Navegação depois das telas novas:** relatórios e agenda aumentam o menu, e a reorganização passa a considerar a estrutura completa.

## Etapas

### Etapa 1: fechar o que já está na `main`

- Fechar o `[Não lançado]` do `CHANGELOG.md` em uma versão com tag.
- Corrigir `backend/src/tests/customerFile.test.ts`: `dayOffset` usa a data em UTC, e o servidor usa `todayInBrazil()`. O teste falha das 21h à meia-noite de Brasília, e isso trava o CI nesse horário.
- Verificar o espelho no Lighthouse.
- Revisar o rótulo da permissão "Cancelar ou reativar".
- Atualizar as dependências, sem `npm audit fix --force`.
- Tratar os erros falsos de `npm run lint` onde existe `.vercel/output`.
- Portfólio: trocar `dono@atelie.test` por `dono@conveniencia.test` e refazer as capturas, que ainda mostram os dados antigos.
- Apagar as branches já mescladas, só com pedido do dono do projeto.

### Etapa 2: estoque

- Estoque mínimo com aviso.
- Ajuste de estoque com motivo e histórico, criando o registro de movimentos.
- Unidade padrão no produto (UN, M2, ML), definindo se ele é vendido por área.

### Etapa 3: listas

- Tela "Listas" em Configurações, com a tabela única `company_list_items`.
- Valores que hoje estão fixos no código, criados para cada empresa.
- "Categorias financeiras" unificando centro de custos, plano de contas e histórico financeiro.
- Grupo do produto, com resumo por categoria no espelho interno.

### Etapa 4: relatórios

- Página com busca, grupos, filtro de período, impressão e exportação em CSV, com o cálculo no servidor.
- Os 14 relatórios já possíveis no plano original.
- Candidatos que passaram a ter dados: formação de preço, composições dos orçamentos e, depois da etapa 2, extrato e movimentação de estoque.
- **Revisar antes de começar:** o plano de relatórios é anterior às baixas. "Baixas de contas a receber" deve usar `receivable_payments`, em vez de só `cash_transactions`.

### Etapa 5: agenda

- Tarefas, próximas ações, validades de orçamento e títulos a vencer, com tipos fixos que podem ser mostrados ou escondidos.
- Eventos manuais.
- Ficam para depois: visão de ano, feriados e integração com Apple e Google.

### Etapa 6: navegação

- Menu por módulos e páginas de módulo.
- Cadastro rápido, busca rápida e atalhos de teclado.
- Paginação no servidor. Os filtros de lista atuais trabalham na tela, sobre os 500 registros mais recentes que a API devolve.

### Etapa 7: restante dos documentos

- Modelos e duplicação de grupos de itens, unidades além de m² e item avulso.
- Condições de pagamento cadastráveis, com várias formas por documento.
- Biblioteca de textos e cláusulas.
- Validade em dias, ocultar item no espelho e desconto em R$ ou %.
- Exportação em DOCX.

### Etapa 8: gestão

- Assistente de precificação, com rateio de custos fixos.
- Dashboard modular com KPIs.
- Metas de venda.

### Etapa 9: operações opcionais

- Compras simples: entrada de estoque, custo e título a pagar.
- Situação e previsão de entrega no pedido.
- Baixa parcial, em lote e com estorno nas contas a pagar, que hoje seguem em lançamento único.
- Renegociação de títulos e adiantamentos.

### Etapa 10: assistente de IA

- Chat de ajuda guiada.
- Bot do Telegram, com confirmação antes de gravar.

## Fora da sequência

**Itens pequenos, quando surgir a necessidade:** copiar produto, código próprio do produto, ficha cadastral para imprimir, número do pedido do cliente, inventário e configurar colunas das listas.

**Backlog sem etapa:** tabelas de preço, parceiro de indicação com comissão, indicação separada da origem, ordem de serviço, anexos, aviso de vencimento por e-mail, várias empresas por usuário e recuperação de senha por e-mail.

**Fora do escopo de estudo:** emissão real de NF-e e NFS-e, boleto e retorno bancário, ordem de produção, centro de custo separado e os demais itens marcados como fora nos planos de operações, relatórios e listas.

**Só referência:** `PLANEJAMENTO_ESCALABILIDADE.md` descreve a evolução para um SaaS comercial, e o projeto não será vendido.

## Decisões pendentes

| Decisão | Quando responder |
|---|---|
| Número da versão que fecha a etapa 1 | Etapa 1 |
| O campo de lista aceita valor digitado fora da lista, ou só permite escolher | Etapa 3 |
| A exportação de relatórios tem permissão própria, separada da leitura | Etapa 4 |
| Quais itens da etapa 9 ainda interessam | Ao chegar nela |
| Se o registro manual de notas fiscais interessa como estudo | Quando o dono do projeto quiser |

## Versões

O número da versão é definido ao fechar cada etapa, para evitar renumerar o roadmap de novo. Planos mais antigos ainda citam os rótulos anteriores:

| Rótulo antigo | Agora |
|---|---|
| v2.5, navegação | Etapa 6 |
| v2.6, documentos | Etapa 7 |
| v2.7, gestão | Etapa 8 |
| v2.8, agenda | Etapa 5 |
| v3.0, assistente de IA | Etapa 10 |
| Operações, etapa 4 | Etapas 2 e 3 |
| Operações, etapa 5 | Etapas 2 e 5 |
| Operações, etapa 6 | Etapa 9 |
