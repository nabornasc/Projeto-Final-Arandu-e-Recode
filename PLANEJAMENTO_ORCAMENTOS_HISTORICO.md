# Planejamento: histórico de alterações e novos orçamentos

Plano de 04/11/2026, com as decisões da seção 5 aprovadas. Complementa o [PLANEJAMENTO_V2.md](PLANEJAMENTO_V2.md).

**Foco:** sistema geral para MEI. Os espelhos analisados vêm de uma empresa de mármores e granitos, então cada ideia foi generalizada para servir também a marceneiro, costureira, pintor, confeiteira e outros. O que só faz sentido para aquele setor ou para empresas maiores ficou de fora.

## 1. Histórico de alterações

### Como funciona para o usuário

**Aba "Histórico" no documento:** uma lista simples, do mais recente para o mais antigo.

```text
Maria Souza    Alterou itens e desconto    04/11/2026 14:32
João Lima      Enviou ao cliente           04/11/2026 11:05
Maria Souza    Criou o orçamento           03/11/2026 16:48
```

**Ao clicar em uma linha:** abre uma aba com o detalhe da alteração.

```text
Maria Souza alterou o orçamento #012
04/11/2026 às 14:32:08

Desconto           R$ 10,00  →  R$ 25,00
Item alterado      Instalação: quantidade 1  →  2
Item incluído      Rodapé, 1 un., R$ 150,00
Total              R$ 500,00  →  R$ 635,00

[Abrir orçamento #012]
```

**Tela geral de auditoria:** mesma lista, com filtros por usuário, período, módulo e ação.

### Regras

| Tema | Regra |
|---|---|
| Quem | Guardar também o nome do usuário na data da ação, para o registro continuar legível se o cadastro mudar |
| Quando | Data e hora com segundos, exibidas no fuso do navegador |
| O que | Só os campos e itens que mudaram, com valor anterior e novo |
| Motivo | Obrigatório ao recusar orçamento e ao cancelar pedido |
| Exclusão | Guarda uma cópia do documento excluído. O detalhe abre mesmo sem o documento existir, com o botão "Abrir" desativado |
| Proteção | A aplicação não oferece editar nem apagar registros do histórico |
| Dados sensíveis | Nunca registrar senha, hash ou token. CPF, CNPJ, e-mail, telefone, endereço e contatos aparecem só como "alterado", sem o valor |
| Quem vê a aba | Quem pode ver o documento, respeitando o escopo "só os próprios" |
| Quem vê a tela geral | Nova permissão `audit.read`, inicialmente só para o Proprietário |
| Custos | Mudanças de custo e margem aparecem só para quem pode ver custos |

**Limite:** registros antigos continuam sem esse detalhe. O histórico completo vale a partir da implantação, então é melhor que esteja pronto antes de a primeira empresa usar o sistema de verdade.

### Como construir

A tabela `audit_logs` e a função `audit()` já existem e gravam na mesma transação da alteração, mas nada lê esses dados hoje. Editar um orçamento, por exemplo, grava só o novo total.

1. **Banco:** adicionar `actor_name` e `reason` em `audit_logs`, mais um índice por `(company_id, entity, entity_id, created_at)`.
2. **Comparação:** criar uma função comum que compara antes e depois e monta `data.changes`. Itens de documento são comparados pelo produto, indicando incluído, alterado ou removido.
3. **Serviços:** usar a comparação em orçamentos e pedidos primeiro, e depois nos demais módulos (são 50 chamadas de `audit()` no total).
4. **API:**
   - `GET /history/:entity/:id`: lista de um documento.
   - `GET /history/entry/:id`: detalhe de um registro.
   - `GET /history`: tela geral, com filtros e paginação.
5. **Interface:** aba Histórico, tela de detalhe e tela geral.
6. **Testes:** isolamento entre empresas, escopo "só os próprios", ocultação de custos, motivo obrigatório, exclusão e ausência de dados sensíveis.

**Pronto quando:** dois usuários alteram e recusam um orçamento, e o proprietário consegue ver quem fez cada coisa, quando, o que mudou e o motivo, inclusive depois de excluir o documento.

## 2. O que os espelhos ensinam

Os dois PDFs são gerados a partir do mesmo orçamento, e os números batem entre si:

- O espelho do cliente organiza por item vendido. O total de cada item é a soma de material, acabamento e serviço.
- O espelho interno organiza por categoria e acrescenta custos, margem e resultado.
- O total é igual nos dois, e a margem é o resultado dividido pela venda.

**A principal ideia a aproveitar:** um único orçamento gera dois documentos, um para o cliente e outro para uso interno.

### Entra agora

| Ideia | Como fica no Arandu Gestão |
|---|---|
| Espelho do cliente | Sem custos nem margem, em A4, com "Imprimir / Salvar PDF" |
| Espelho interno | Resumo por categoria, custos, margem e resultado, com a permissão `costs.read` e o aviso **"Uso interno: não enviar ao cliente"** |
| Cabeçalho da empresa | Nome fantasia, razão social, CNPJ, endereço, telefone e logo |
| Dados do documento | Número, emissão, validade, data de impressão e vendedor |
| Dados do cliente | Vêm do cadastro de pessoas, escondendo campos vazios |
| Local de entrega ou serviço | Descrição, contato e endereço, com opção de copiar do cliente. É a versão geral de "Dados da obra" |
| Totais | Total dos itens, desconto, frete, outras despesas e total do orçamento |
| Parcelas | Forma, vencimento e valor |
| Textos do documento | Observações e textos padrão da empresa, como prazo de entrega e condições |
| Custo no item | Gravar o custo em `quote_items` na hora do orçamento, para a margem não mudar se o custo do produto mudar depois |

### Entra depois

| Ideia | Versão geral | Por que depois |
|---|---|---|
| Item composto de material, acabamento e serviço | Grupos de itens com subtotal, como ambiente, peça ou kit | Muda o formulário e o modelo de dados, e já está previsto na v2.5 |
| Comprimento × largura = m² | Medidas opcionais, ativadas por empresa | Útil para alguns ofícios e confuso para os demais |
| Perda de produção | Percentual opcional sobre o custo | Depende do custo por item |
| Comissão do vendedor e RT | Comissão e parceiro de indicação | Já está no backlog |

### Fica de fora

| Item | Motivo |
|---|---|
| Imposto por venda | O MEI paga o DAS fixo, como já decidido na v2.6. Se precisar, usar uma linha opcional de "outros custos" |
| IPI e ICMS ST | Só fazem sentido junto com nota fiscal, ainda no backlog |
| Seguro, custo de estocagem e outros custos fixos por venda | Detalhe demais para o MEI. O rateio de custos fixos fica no assistente de precificação da v2.6 |
| VMMO (total ÷ m²) | Indicador do setor de pedras |

### Problemas dos exemplos a não repetir

- Telefone vazio impresso como `()`.
- Linha "Sem material" com quantidade e valor zerados.
- Endereço cortado no espelho interno.
- Valores em dois formatos: `R$7.044.08` e `7.044,08`. Usar sempre o padrão brasileiro.
- Espelho interno sem nenhum aviso de que não deve ir para o cliente.
- Linhas zeradas de impostos e despesas: mostrar só o que tem valor.

## 3. Melhorias na aba de orçamentos

**No formulário, em seções:** Dados, Itens, Entrega ou serviço, Pagamento, Textos, Resumo e Histórico.

**Campos novos, todos opcionais, para o MEI conseguir fazer um orçamento simples em poucos cliques:**

- `quotes`: vendedor, descrição, contato e endereço do local, frete, outras despesas, observação interna.
- `quote_items`: custo unitário na data do orçamento.
- `companies`: razão social, endereço, telefone, e-mail, logo e textos padrão.

**Documento enviado não muda sozinho:** ao enviar, guardar uma cópia dos dados da empresa e do cliente. Assim, reimprimir mostra o mesmo que o cliente recebeu, mesmo que o cadastro mude depois.

**Menu ⋯:** acrescentar "Espelho do cliente" e "Espelho interno", este só para quem tem a permissão.

Os PDFs seguem a decisão da seção 7.7 do plano principal: modelo HTML e impressão pelo navegador, sem servidor de PDF.

## 4. Ordem sugerida

| Fase | Conteúdo | Observação |
|---|---|---|
| Feita | "x" de abas e janelas à esquerda | Na v2.3 |
| 1 (feita) | Histórico em orçamentos e pedidos: registro, aba e detalhe; cancelamento de orçamento e motivos | Na v2.3 |
| 2 (feita) | Histórico nos demais módulos e tela geral | Na v2.3 |
| 3 (feita) | Dados da empresa, campos novos e espelho do cliente | Antecipa parte da v2.5. O vendedor é quem criou o orçamento, sem campo próprio |
| 4 | Custo no item, margem e espelho interno | Antecipa a margem da v2.6 |
| 5 | Parcelas, grupos de itens e medidas opcionais | Restante da v2.5 |

## 5. Decisões

Aprovadas em 04/11/2026:

1. **Publicação:** as fases 1 e 2 vêm antes da v2.3 (deploy). As fases 3 e 4 podem vir antes ou depois, conforme a urgência da demonstração.
2. **Cancelar orçamento:** existe o status "cancelado", com motivo obrigatório, para orçamento enviado ou aprovado sem pedido. Só rascunhos são excluídos. O cancelamento é definitivo: para retomar, duplica-se o orçamento.
3. **Quem vê o histórico:** todos que podem ver o documento, respeitando o escopo "só os próprios". A tela geral de auditoria fica inicialmente só com o Proprietário.
