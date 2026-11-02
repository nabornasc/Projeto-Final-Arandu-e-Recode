# Changelog

Todas as mudanças relevantes do Aranduê, por versão. O roadmap das próximas versões está no [PLANEJAMENTO_V2.md](PLANEJAMENTO_V2.md) (seção 10).

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
