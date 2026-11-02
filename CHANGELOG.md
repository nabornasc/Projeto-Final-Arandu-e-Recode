# Changelog

Todas as mudanças relevantes do Aranduê, por versão. O roadmap das próximas versões está no [PLANEJAMENTO_V2.md](PLANEJAMENTO_V2.md) (seção 11).

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

Primeira versão do Aranduê como SaaS multiempresa (a v1, monousuário com MySQL, está na tag `v1.0.0`).

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
