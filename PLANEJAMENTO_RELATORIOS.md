# Planejamento: central de relatórios

Análise de 05/11/2026, feita a partir de três prints do menu de relatórios de um ERP de mercado. **Guardada para depois: nada aqui foi implementado nem tem versão definida.**

> **Ordem de trabalho:** a sequência atual está em [PLANEJAMENTO_ETAPAS.md](PLANEJAMENTO_ETAPAS.md). Este arquivo guarda os detalhes.

Hoje o projeto tem o dashboard, o histórico geral e as listas de cada módulo, mas não tem uma tela de relatórios nem exportação em CSV ou Excel.

Os prints mostram 42 relatórios. A lista pode ter mais, porque o trecho entre Estoque e o início do Financeiro não aparece. O nome "Financeiro" também não aparece: foi deduzido pelos itens. O conteúdo de cada relatório também foi deduzido pelo nome.

| Situação | Quantidade |
|---|---:|
| Dá para fazer com os dados atuais | 14 |
| Depende de outra entrega | 19 |
| Fora do foco em MEI | 9 |

## 1. Dá para fazer com os dados atuais

| Grupo | Relatório do print | No Arandu | Origem dos dados |
|---|---|---|---|
| Vendas | Orçamentos | Igual | `quotes` |
| Vendas | Itens dos orçamentos | Igual | `quote_items` |
| Vendas | Ajustes de orçamentos | Descontos, frete e despesas por orçamento (confirmar o que o original mostra) | `quotes` |
| Vendas | Pedidos emitidos | Igual | `orders` |
| Vendas | Itens dos pedidos emitidos | Igual | `order_items` |
| Financeiro | Contas a pagar | Igual | `expenses` pendentes |
| Financeiro | Contas a receber | Igual | Mesmos dados da tela de contas a receber |
| Financeiro | Baixas de contas a pagar | Igual | `cash_transactions` com `expense_id` |
| Financeiro | Baixas de contas a receber | Igual | `cash_transactions` com `order_id` |
| Financeiro | Movimentações | Igual | `cash_transactions` |
| Financeiro | Regime de caixa | Entradas e saídas por período | `cash_transactions` |
| Compras | Despesas por centro de custo | **Despesas por categoria**, sem criar centro de custo | `expenses.category` |
| Serviços | Comparativos de serviço | **Serviços vendidos**: quantidade e valor por serviço e período | `order_items` e `products` |
| Geral | Histórico de alterações de registros | Já existe: só entra como atalho para a tela atual | `audit_logs` |

## 2. Depende de outra entrega

| Relatórios | Depende de |
|---|---|
| Formação de preço | Custo no item e margem (fase 4 do plano de orçamentos) |
| Composições dos orçamentos | Grupos de itens (fase 5 do plano de orçamentos) |
| Extrato de estoque; Movimentação de estoque | Registro de movimentos: hoje só existe o saldo em `products.stock` |
| Cartões recebidos | Forma de pagamento na baixa |
| Entregas | Situação de entrega no pedido |
| Comissões a pagar; Pedidos emitidos por indicação; Reservas técnicas | Parceiro de indicação com comissão (backlog) |
| Ordens de serviço; Serviços das ordens de serviço | Ordem de serviço ligada ao pedido (backlog) |
| Pedidos de compra; Itens dos pedidos de compra | Módulo de compras (backlog) |
| Documentos fiscais; Notas fiscais de entrada e de saída, com seus itens; Notas fiscais por indicação | Nota fiscal por serviço externo (backlog) |

## 3. Fora do foco em MEI

Ficam de fora por exigirem controle de fábrica ou por terem pouco uso em um sistema geral para MEI:

- Produção: Ordens de produção, Produção, Itens produzidos, Necessidade de produção e Necessidade de compra - Produção.
- Materiais: Consumo de matéria-prima, Necessidade por materiais de orçamento e Itens com defeito.
- Cheques recebidos.

## 4. O que aproveitar da tela

- Busca de relatório no topo da lista.
- Relatórios em grupos que abrem e fecham.
- Cada usuário vê só os relatórios que suas permissões liberam.

## 5. Proposta para a primeira entrega

1. Criar a página "Relatórios", com busca, grupos, filtro de período e os 14 relatórios da seção 1.
2. Oferecer impressão e exportação em CSV. Excel pode vir depois: o CSV já abre nele.
3. Fazer o cálculo no servidor, com paginação na tela.

## 6. Cuidados

- **Permissões:** cada relatório respeita a permissão de leitura do módulo e o escopo "só os próprios". Custo e margem exigem a permissão de ver custos.
- **Exportação:** toda exportação entra no histórico, com quem exportou e quando. Traz só as colunas do relatório, sem CPF, CNPJ, telefone ou endereço por padrão.
- **Fórmulas em CSV:** valores que começam com `=`, `+`, `-` ou `@` precisam ser neutralizados, para o Excel não os executar como fórmula.
- **Desempenho:** períodos longos exigem limite de linhas e conferência dos índices.

## 7. Decisões em aberto

- Entra na etapa 4 de [PLANEJAMENTO_ETAPAS.md](PLANEJAMENTO_ETAPAS.md).
- Se a exportação terá permissão própria, separada da leitura.
