# Planejamento: pedidos, notas fiscais, títulos, baixas, agenda, compras e estoque

Análise de 06/11/2026, feita a partir de 26 prints de um ERP de mercado voltado a marmorarias. **As etapas 1, 2 e 3 e o histórico do cliente, da etapa 4, foram feitos em 06/11/2026. As demais continuam guardadas, sem versão definida.**

Os prints têm dados reais de empresas e pessoas. Eles não entram no repositório, e este arquivo só registra a estrutura das telas.

O Arandu Gestão é um projeto de estudo com demonstração pública. Por isso, o critério é o que ensina e cabe no MEI, e não a paridade com o ERP.

## 1. A principal ideia a aproveitar

Nas contas a pagar e a receber do ERP, cada lançamento é um **título** com valor, valor pago e saldo. A baixa é um documento próprio, que pode quitar vários títulos de uma vez, ou só parte de um.

No Arandu, a baixa é uma ação simples: o pedido pendente vira pago, e a despesa pendente vira paga. Não há pagamento parcial, parcela nem baixa de vários lançamentos juntos. As parcelas do orçamento, da fase 5, também ainda não geram contas a receber.

Essa é a mudança com mais impacto, e as próximas dependem dela.

## 2. Padrão das telas de lista

| Ideia do ERP | Situação no Arandu | Proposta |
|---|---|---|
| Filtro de período com atalhos: hoje, ontem, esta semana, este mês, mês passado, este ano, personalizado | Não encontrei filtro de período em pedidos, orçamentos e contas a receber | **Entra primeiro.** Um componente comum, sem mudar o banco |
| Filtros avançados recolhíveis (cliente, vendedor, status, número) | Idem | Junto com o período |
| Rodapé com valor total, saldo total, valor selecionado, saldo selecionado e número de selecionados | Não existe | Entra com a seleção de vários registros |
| Paginação, imprimir lista e configurar colunas | Só parte das telas tem paginação | Imprimir e paginar entram. Configurar colunas fica para depois |
| Botão "Novo" com tipos | Criação de um tipo por tela | Só onde houver mais de um tipo |
| Menu "Mais opções" em grupos: Visualizar, Ações, Operações, Alterar, Consultar, Rastrear | O menu ⋯ já tem ações e grupos | Já coberto em boa parte. Reorganizar os grupos quando o menu crescer |

## 3. Pedidos de venda

| Ideia do ERP | Situação | Proposta |
|---|---|---|
| Copiar, cancelar, reabrir, histórico e rastrear orçamento | Já existem | Coberto |
| Status de entrega e previsão de entrega | Não existem | Entra depois dos títulos. Útil para quem entrega |
| Número do pedido do cliente | Não existe | Campo simples, se houver pedido |
| Encerrar pedido e criar novo pedido com saldo | Depende de entrega parcial | Depois |
| Ordem de produção e controle de entregas | Backlog | Depois |
| Agendamento de recursos, avaliação e etiquetas | Não existem | Fora do foco em MEI |
| Emitir nota fiscal, nota de cobrança e nota de entrega | Sem nota fiscal | Ver seção 6 |

## 4. Contas a pagar e a receber

| Ideia do ERP | Situação | Proposta |
|---|---|---|
| Colunas de valor, valor pago e saldo; status aberto, parcial e liquidado | Só pendente e pago | **Núcleo do módulo de títulos** |
| Filtro por vencimento, pessoa, forma de pagamento e número | Não encontrei | Entra com o padrão de listas |
| Alterar vencimento, valor e observação do título, com histórico | Parte existe na despesa | Com os títulos |
| Fornecedor na despesa | A despesa tem só descrição e categoria | **Entra com os títulos.** Hoje o fornecedor fica no texto |
| Lote de contas: lançar várias de uma vez | Não existe | Reaproveita a geração de parcelas da fase 5 |
| Conta para categorização e natureza financeira | Categoria em texto livre | Depende de `PLANEJAMENTO_LISTAS.md` |
| Agrupar e renegociar títulos | Não existem | Depois. Ensina bem rastreio, mas é complexo |
| Adiantamento, nota de crédito e nota de débito | Não existem | Depois da baixa simples |
| E-mail de aviso de vencimento | Não existe | Depois. Depende de serviço de e-mail |
| Boleto, remessa e retorno bancário | Não existem | Fora: exige contrato com banco |
| Centro de custo e espécie do título | Não existem | Fora do foco em MEI |

## 5. Baixa

O fluxo do ERP tem três passos:

1. Selecionar os títulos na lista, com a opção de adicionar mais, vendo os totais do fornecedor (vencido, a vencer, total em aberto).
2. Escolher o método: dinheiro, cartão, depósito ou Pix; cheque; adiantamento; nota de crédito; contábil.
3. Informar data, conta, histórico e observação e, em cada título, multa, juros, acréscimo, desconto, abatimento e valor pago, vendo o saldo final.

| Ideia | Proposta |
|---|---|
| Baixar vários títulos de uma vez | **Entra** |
| Pagamento parcial, com saldo restante | **Entra** |
| Data, conta e observação | **Entra.** A movimentação de caixa nasce da baixa |
| Juros, multa e desconto por título | **Entra.** Unir acréscimo com juros e abatimento com desconto, para simplificar |
| Consultar e estornar a baixa | **Entra.** Reabrir o título com motivo no histórico |
| Método dinheiro, cartão, depósito ou Pix | **Entra**, como forma de pagamento da baixa |
| Cheque, adiantamento, nota de crédito e pagamento contábil | Depois ou fora |

## 6. Notas fiscais

O ERP tem telas de saída e de entrada, com muitos tipos de nota, eventos da NF-e, DANFE, XML, carta de correção e inutilização.

| Ideia | Proposta |
|---|---|
| Emissão real de NF-e e NFS-e | Fora, por ser projeto de estudo: exige certificado digital, serviço externo e regras fiscais por estado |
| Registrar nota emitida em outro sistema: número, data, valor e anexo, ligada ao pedido | Possível, se quiser estudar rastreio. MEI costuma emitir pelo portal oficial |
| Espelho de nota, no mesmo formato dos espelhos de orçamento | Só faz sentido com o registro acima |
| Nota de entrada ligada à compra | Depende de compras, no backlog |
| Devolução, complementar, ajuste, estorno, transferência, importação e distribuição de XML | Fora do foco em MEI |

## 7. Produtos e serviços

| Ideia do ERP | Situação | Proposta |
|---|---|---|
| Criar item ou serviço, copiar e histórico | Parte existe | Falta copiar |
| Código ou identificação própria | Não existe | Campo simples. Útil em busca |
| Unidade padrão (UN, M2, ML) | Não existe no produto. O orçamento tem medidas em m² | **Boa continuação da fase 5:** definir no produto se ele é vendido por área |
| Grupo do item | Não existe | Depende de listas e permite um resumo por categoria no espelho interno |
| Estoque mínimo e aviso | Não existe | Simples e útil |
| Último custo e preço de reposição | Só um custo | Depende de compras |
| Formação de preço | Previsto na v2.7 | Mantém |
| Imagens e notas e anexos | Backlog | Depois. Exige armazenamento de arquivos |
| Comissão, código de barras e estrutura do item | Backlog | Depois |
| NCM, CST, grupo tributário, pesos, conjuntos e saldo por empresa | Não existem | Fora, junto com a nota fiscal |

## 8. Clientes e fornecedores

O cadastro único do Arandu já segue o mesmo modelo, com identificação, comercial e os papéis cliente, fornecedor, transportadora e representante.

| Ideia do ERP | Proposta |
|---|---|
| Empregado como papel | Fora |
| Copiar, contatos e histórico | Parte existe. O histórico do cliente com seus orçamentos, pedidos e títulos é a parte mais útil |
| Ficha cadastral para imprimir | Simples, com o padrão de espelho |
| Tabela de preços | Backlog |
| Avalista, redespacho, embarque e região | Fora, como já decidido na v2.6 |

## 9. Agenda, compras e estoque

Segundo grupo de prints, também de 06/11/2026.

**Agenda.** A v2 já prevê semana, mês e mini calendário, reunindo próximas ações, validades de orçamento e entregas. O projeto ainda não tem a tela.

| Ideia do ERP | Proposta |
|---|---|
| Visões de dia, semana, mês, ano e lista; mini calendário; botão "Hoje" | Dia, semana, mês e lista entram. Ano fica de fora |
| "Minhas agendas" e outras agendas, com cor e opção de mostrar ou esconder | Entra, com tipos fixos: tarefas, orçamentos, títulos a vencer |
| Feriados e aniversários | Aniversário depende de data no cadastro. Feriados ficam para depois |
| Agenda de outro usuário e filtro por local | Outro usuário, se a permissão permitir. Local fica de fora |
| Integração com Apple e Google | Depois. Exige OAuth e sincronização |

**Compras.** O fluxo do ERP é fornecedor, pedido de compra, nota de entrada e contas a pagar.

| Ideia do ERP | Proposta |
|---|---|
| Pedido de compra com dados, itens, entrega e pagamento | Versão simples depois dos títulos: entrada de estoque, custo e título a pagar |
| Espelho, processar, cancelar, reabrir, copiar e rastrear | Reaproveita o padrão de orçamentos |
| Cotação, cancelar saldos e custo em moeda estrangeira | Fora do foco em MEI |
| Nota de entrada com chave de acesso e XML, referências e transporte | Fora, como na seção 6. Importar o XML pode ser estudado no futuro |

**Estoque.**

| Ideia do ERP | Proposta |
|---|---|
| Ajuste de estoque com motivo e histórico | **Simples e útil.** Hoje o estoque só muda no cadastro e nos pedidos |
| Inventário | Depois do ajuste |
| Controle e acompanhamento de entregas | Junto com a entrega no pedido |
| Ordem de produção, requisição de material e produção por prioridade | Depois. Útil para quem fabrica, mas grande para MEI |
| Transferência entre empresas | Fora: várias empresas por usuário seguem no backlog |

## 10. Ordem sugerida

| Etapa | Conteúdo | Por quê |
|---|---|---|
| 1 (feita) | Filtros de período e avançados, totais no rodapé, imprimir lista | Melhora várias telas, sem mudar o banco. Filtra na tela, sobre os 500 registros mais recentes que a API devolve |
| 2 (feita) | Contas a receber por parcela, com valor pago e saldo, baixa por parcela e fornecedor na despesa | Base das demais etapas e item F da v2.6. A despesa continua como lançamento único. Valor parcial dentro de uma parcela fica na etapa 3 |
| 3 (feita) | Baixa em vários títulos, parcial, com juros e desconto, e estorno, nas contas a receber | Cada baixa é um registro, e o estorno exige permissão própria, senha de login e motivo, assim como cancelar, excluir ou voltar para pendente um pedido com baixa. Juros e desconto ajustam o faturamento dos pedidos quitados. A despesa segue como lançamento único |
| 4 | Unidade e grupo no produto, estoque mínimo. Histórico do cliente feito: ficha com CRM, documentos e financeiro; casos, ordens de serviço, anexos e nota fiscal ficaram de fora | Independentes, podem ser antecipados |
| 5 | Agenda e ajuste de estoque | A agenda ganha mais conteúdo depois dos títulos |
| 6 | Compras simples, entrega no pedido, renegociação, adiantamentos | Só se ainda houver interesse |

## 11. Cuidados

- **Migração:** pedidos pendentes e despesas viram títulos com um único vencimento, e o saldo atual precisa bater com o contas a receber, o caixa e os indicadores.
- **Limite do MEI e indicadores:** definir se o faturamento considera a data do pedido ou a da baixa antes de mudar a baixa.
- **Permissões:** `receivables.settle` e `payables.pay` continuam valendo. Estornar a baixa pode precisar de permissão própria.
- **Demonstração:** tabela nova precisa entrar em `demo.table_list()`, e os dados de exemplo precisam mostrar título parcial e vencido. A troca de dados na demo exige o SQL Editor.
- **Dados reais:** não usar nomes, documentos ou valores dos prints em testes, dados de exemplo ou documentação.

## 12. Decisões em aberto

- Decidido em 06/11/2026: o faturamento e o limite do MEI seguem a data do pedido, e só pedido quitado conta como faturado.
- Se o registro manual de notas fiscais interessa como estudo.
