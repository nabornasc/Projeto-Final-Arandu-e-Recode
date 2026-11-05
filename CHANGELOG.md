# Changelog

Todas as mudanças relevantes do Arandu Gestão, por versão. O roadmap das próximas versões está no [PLANEJAMENTO_V2.md](PLANEJAMENTO_V2.md) (seção 11).

## [Não lançado]

### Adicionado

- **Reabrir orçamento:** enviado, aprovado ou recusado volta para rascunho, com motivo no histórico, e passa de novo por envio e aprovação. Cancelado e convertido em pedido não reabrem.
- **Exclusão bloqueada depois do envio:** orçamento reaberto só pode ser excluído pelo Proprietário. Nenhum outro grupo recebe essa liberação.
- **Espelho do cliente:** o orçamento vira um documento A4, pronto para imprimir ou salvar em PDF, sem custos nem observação interna. Rascunho, recusado e cancelado saem com um aviso.
- **Dados da empresa no documento:** razão social, endereço, telefone, e-mail, logo e condições padrão, nas configurações.
- **Novos campos no orçamento:** frete, outras despesas, local de entrega ou serviço e observação interna. Frete e despesas entram no total e seguem para o pedido.
- **Documento enviado não muda sozinho:** ao enviar, o orçamento guarda uma cópia dos dados da empresa, do cliente e dos itens.

### Alterado

- **Monitoramento ligado:** erros da API e do navegador chegam ao Sentry, sem dados pessoais.
- **Novo nome: Arandu Gestão**, na interface, na documentação e no endereço da demonstração.

## [2.3.0] — 2026-11-05

### Adicionado

- **Histórico de alterações** em orçamentos e pedidos: aba com quem fez, o quê e quando; o clique abre o detalhe com valores de antes e depois, campo a campo e item a item.
- **Cancelar orçamento** enviado ou aprovado, com a permissão `quotes.cancel`, concedida a quem já cancelava pedidos.
- **Motivo obrigatório** ao recusar orçamento e ao cancelar orçamento ou pedido.
- O registro de auditoria guarda o nome do usuário na data da ação e, na exclusão, uma cópia do documento.
- **Registro detalhado em todos os módulos:** produtos, pessoas, oportunidades, financeiro, usuários, grupos e configurações guardam valores de antes e depois.
- **Tela de auditoria** com filtros por usuário, módulo, ação e período, e a permissão `audit.read`.
- **Dados pessoais protegidos no registro:** CPF/CNPJ, e-mail, telefone, endereço e senha aparecem como "alterado", sem guardar o valor.
- **Testes ponta a ponta** com Playwright, também no CI.
- **Preparação da publicação:** pacote para a Vercel em `gru1`, usuário de banco sem poder de alterar a estrutura, RLS em todas as tabelas, cabeçalhos de segurança e monitoramento opcional com Sentry, sem dados pessoais.
- **Modo demonstração:** aviso com o acesso de teste e dados que voltam ao padrão a cada 12 horas.

### Alterado

- **Só rascunhos podem ser excluídos** em orçamentos; enviado ou aprovado é cancelado.
- O botão de fechar abas e janelas fica à esquerda.

### Corrigido

- Migrações e testes falhavam no Windows por causa do caminho da pasta `drizzle`.

## [2.2.0] — 2026-11-03

### Adicionado

- **Oportunidades** no lugar dos leads: título, cliente ou dados de contato, valor estimado, previsão de fechamento e itens de interesse, que preenchem o primeiro orçamento.
- **Situação separada da etapa:** em andamento, ganha ou perdida, mantendo a etapa onde parou.
- **Funil configurável por empresa** (nome, ordem, cor e marco da automação), com a permissão `opportunities.configure`.
- **Automação de etapas, só para frente:** orçamento enviado, orçamento aprovado ou pedido criado e pedido recebido (ganha) geram eventos no histórico.
- **Rastreio** em cada orçamento e pedido: a cadeia completa desde a oportunidade, com a data do recebimento, respeitando o escopo de quem consulta.
- **Vincular, desvincular e criar oportunidade a partir de um documento.** Duplicar pergunta se mantém na mesma oportunidade (já marcado) e sempre guarda a origem.
- Kanban com total em R$ e quantidade por coluna; lista com filtros e totais no rodapé; tela da oportunidade com barra de etapas e valor estimado × em orçamentos × em pedidos × recebido.
- Tipos de atividade no histórico (comentário, ligação, visita, reunião, proposta, e-mail).
- Menu ⋯ organizado em grupos.

### Alterado

- Migração preserva os ids: leads viram oportunidades e `leads.*` vira `opportunities.*` nos grupos de acesso. Ganho e perdido deixam de ser colunas do funil e passam a ser situação.
- `/leads` foi substituído por `/opportunities`.
- Produto usado como item de interesse é arquivado em vez de excluído.

### Corrigido

- Contraste dos selos de status (pago, pendente, cancelado, aprovado, ganho, perdido) e dos textos secundários do menu e do histórico acima de 4,5:1.
- Barra de abas como navegação (`<nav>` + `aria-current`), sem papéis ARIA inválidos; Lighthouse de acessibilidade volta a 100.
- Título do topo nas telas fora do menu (ex.: cadastro de pessoa) e alinhamento de nomes longos em listas e cartões.

## [2.1.0] — 2026-11-02

### Adicionado

- Cadastro único de pessoas (`people`) com papéis: cliente, fornecedor, transportadora e representante.
- CPF/CNPJ validados pelos dígitos verificadores e únicos por empresa; inscrição estadual, contribuinte, consumidor final e regime tributário.
- Consulta de CNPJ (BrasilAPI) e de CEP (ViaCEP) pelo servidor, com limite de 5 s e de 20 consultas por minuto.
- Endereço estruturado, contatos, endereços de entrega e cobrança e dados comerciais (pagamento, frete, transportadora padrão, categoria, região, limite de crédito, vendedor da carteira).
- Permissão `customers.assign` para alterar o vendedor da carteira.
- Telas de Clientes, Fornecedores, Transportadoras e Representantes (lista com busca) e cadastro em abas.

### Alterado

- Clientes e fornecedores migrados para `people` mantendo os ids dos clientes; orçamentos, pedidos e leads passam a apontar para `people`. `/customers` e `/suppliers` continuam como atalhos por papel.
- Pessoa usada em documentos é arquivada em vez de excluída.

## [2.0.0] — 2026-11-02

Primeira versão do Arandu Gestão como SaaS multiempresa (a v1, monousuário com MySQL, está na tag `v1.0.0`).

### Adicionado

- Cadastro de empresa, login e sessão segura (Argon2id, cookie `HttpOnly`, proteção CSRF, limite de tentativas).
- Multiempresa com isolamento verificado por testes; numeração de pedidos e orçamentos por empresa.
- Permissões por ação (49) e grupos de acesso por empresa, com escopo "só os próprios" e administração delegável sem escalada.
- Usuários (convite, grupo, desativação), fornecedores, configurações da empresa com limite anual do MEI obrigatório.
- Orçamentos (rascunho → enviado → aprovado/recusado), conversão em pedido, duplicar e copiar entre orçamento e pedido.
- Contas a receber com baixa, contas a pagar com permissão própria de pagamento, caixa sincronizado com pedidos e despesas.
- CRM: funil em colunas, atendimentos por canal, lead ganho vira cliente sem duplicar.
- Área de trabalho com abas fixas, duas telas lado a lado e menu de ações ⋯ por status e permissão.
- 47 testes de integração; CI com lint, typecheck, testes, build e auditoria de dependências.
