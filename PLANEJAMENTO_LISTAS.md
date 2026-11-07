# Planejamento: listas configuráveis

Análise de 05/11/2026, feita a partir de prints do menu "Listas" de um ERP de mercado. **Guardada para depois: nada aqui foi implementado nem tem versão definida.**

> **Ordem de trabalho:** a sequência atual está em [PLANEJAMENTO_ETAPAS.md](PLANEJAMENTO_ETAPAS.md). Este arquivo guarda os detalhes.

Os prints mostram 40 listas. Pode faltar alguma entre "Histórico financeiro" e "Indicações", porque esse trecho da rolagem não aparece com certeza. O conteúdo de cada lista foi deduzido pelo nome.

| Situação | Quantidade |
|---|---:|
| Já coberta pelo projeto | 7 |
| Já existe como texto livre e pode virar lista | 9 |
| Depende de outra entrega | 15 |
| Fora do foco em MEI | 9 |

## 1. Já coberta pelo projeto

| Lista do print | No Arandu |
|---|---|
| Clientes / Fornecedores | Cadastro único de pessoas |
| Tipos de clientes / fornecedores | Papéis da pessoa: cliente, fornecedor, transportadora e representante |
| Itens e serviços | Produtos e serviços |
| Contas | Contas bancárias |
| Portadores | Contas bancárias, incluindo caixa (equivalência deduzida pelo nome) |
| Etapas da oportunidade | Etapas do funil, configuráveis por empresa |
| Empresas | Dados da empresa, em Configurações. Várias empresas por usuário seguem no backlog |

## 2. Já existe como texto livre e pode virar lista

Hoje a empresa não consegue ajustar esses valores. Parte tem sugestões fixas no código, e o restante é só texto digitado, o que gera variações como "Pix" e "PIX" e atrapalha filtros e relatórios.

| Lista do print | Campo atual | Como está hoje |
|---|---|---|
| Formas de pagamento | `people.payment_method` | Sugestões fixas |
| Condições de pagamento | `people.payment_terms` | Sugestões fixas. A versão com parcelas continua na v2.6 |
| Motivos de perda | `opportunities.lost_reason` | Sugestões fixas |
| Origem da indicação | `opportunities.source` | Sugestões fixas |
| Categorias de cliente | `people.category` | Texto livre |
| Cargo | `person_contacts.role` | Texto livre |
| Centro de custos | `expenses.category` | Texto livre |
| Plano de contas | `expenses.category` e `cash_transactions.category` | Texto livre |
| Histórico financeiro | `cash_transactions.category` | Texto livre |

**Simplificação para MEI:** centro de custos, plano de contas e histórico financeiro viram uma única lista, "Categorias financeiras". Plano de contas hierárquico e centro de custo separado são controles de empresa maior.

## 3. Depende de outra entrega

| Lista do print | Depende de |
|---|---|
| Unidades | Medidas opcionais (fase 5 do plano de orçamentos) |
| Ambiente de orçamento | Grupos de itens (fase 5 do plano de orçamentos) |
| Informação complementar | Biblioteca de textos e cláusulas (v2.6) |
| Grupos do item | Categoria no cadastro de produtos e serviços (campo novo) |
| Tabelas de preço de venda | Tabelas de preço (backlog) |
| Indicações | Parceiro de indicação (backlog) |
| Etapas da entrega | Situação de entrega no pedido |
| Operações de cartão | Forma de pagamento na baixa. Taxa de maquininha é útil para MEI |
| Cotações | Módulo de compras (backlog), se forem cotações de compra. Se forem de moeda, fica fora |
| Séries; Serviço fiscal; Tributação; Grupos tributários do item; Carga tributária; Eventos de nota fiscal eletrônica | Nota fiscal por serviço externo (backlog), e só o que esse serviço exigir |

## 4. Fora do foco em MEI

- Obrigações fiscais de empresa maior: Exportação Sintegra e Exportação SPED. Confirmar com um contador antes de tratar como definitivo.
- Produção: Prioridade da produção, Produções por prioridade e Roteiros de produção.
- Logística própria: Prioridade de entrega e Roteiros da entrega.
- Moedas: o sistema opera em real.
- Tipos de caso: o nome sugere atendimento ou suporte, e o projeto não tem esse módulo.

## 5. Proposta para a primeira entrega

1. Criar a tela "Listas" em Configurações, com busca, como no ERP analisado.
2. Criar uma tabela única, em vez de uma por lista: `company_list_items`, com `company_id`, `kind`, `name`, `position` e `active`.
3. Criar para cada empresa nova os valores que hoje estão fixos no código, para a tela não começar vazia.
4. Entregar as listas da seção 2, com "Categorias financeiras" unificada.
5. Trocar as sugestões fixas dos formulários pelos valores da lista da empresa.

## 6. Cuidados

- **Documentos antigos:** os documentos continuam guardando o texto. Renomear ou desativar um valor da lista não altera orçamentos, pedidos e lançamentos já feitos, nem o histórico.
- **Desativar em vez de excluir:** um valor desativado sai das sugestões e continua aparecendo onde já foi usado.
- **Dados existentes:** categorias já digitadas com grafias diferentes precisam de revisão antes de virarem filtro. Pode haver uma etapa de juntar valores.
- **Permissões:** cada lista exige permissão de alteração, e a mudança entra no histórico geral.
- **Separação entre empresas:** toda consulta filtra por `company_id`, como nas demais tabelas.
- **Demonstração:** a tabela nova precisa entrar na restauração automática da demo.

## 7. Decisões em aberto

- Entra na etapa 3 de [PLANEJAMENTO_ETAPAS.md](PLANEJAMENTO_ETAPAS.md), antes dos relatórios, porque filtros por categoria e forma de pagamento dependem de dados padronizados.
- Se o campo aceita digitar um valor fora da lista, o que é mais simples para o MEI, ou se só permite escolher, o que deixa os dados mais limpos.
