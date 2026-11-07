# Resposta do notebook Arch Linux

Data: 2026-11-06
Commit testado: 4ec4ab5

| Passo | Resultado | Observação |
|---|---|---|
| Ferramentas | OK | Node v24.21.0, npm 11.19.0, git 2.56.0, Docker 29.9.2, Compose 5.7.0; Docker ativo e usuário no grupo `docker` |
| Código | OK | Sem alterações locais; `git pull --ff-only` já estava atualizado; `npm install` concluído |
| Configuração | OK | `backend/.env` já existia; host do banco: `127.0.0.1` |
| Banco | OK | Porta 5432 ocupada pelo próprio `arandue-postgres`, sem parar nenhum serviço; migrações aplicadas |
| Dados | Feito | Usuário confirmou. Havia `Doces da Vila` e `Ateliê Aranduê`, com 8 pedidos, 3 orçamentos e 1 oportunidade. Backup local com `pg_dump` antes do seed (dump válido, com 23 tabelas de dados); agora há `Conveniência da Esquina` e `Doces da Vila`, com 12 pedidos |
| API e login | OK | `{"status":"ok"}`; login `200`; interface `200` |
| Tela, conferida pelo usuário | OK | Usuário abriu <http://localhost:5173>, entrou com `dono@conveniencia.test` e viu os dados da Conveniência da Esquina |
| Lint | OK | Sem erros; 1 aviso e 1 info |
| Testes | OK | 118 de 118 passaram, em 17 arquivos |

## Problemas

Nenhum.

Nenhuma decisão pendente na passagem inicial. O backup do banco local anterior ao seed fica só na pasta temporária do notebook e não vai para o Git.

## Atualização de 06/11/2026

Notebook atualizado com a seção 1 do alinhamento:

| Comando | Resultado |
|---|---|
| `git switch main` e `git pull --ff-only` | OK, em `dfa48e0` |
| `npm install` | OK |
| `npm run db:migrate` | OK, 16 de 16 migrações no banco local (`127.0.0.1`) |
| `npm run typecheck` | Sem erros |

Os planos guardados foram organizados em `PLANEJAMENTO_ETAPAS.md`, no PR #14 (branch `docs/etapas`). Ele só muda documentação e **ainda não foi mesclado**, porque o CI está vermelho.

## Problemas

**Teste que falha à noite, sem relação com o PR #14:** `backend/src/tests/customerFile.test.ts:124`, com `AssertionError: expected 4 to be 5`. Reproduzido localmente às 01:23 UTC, com `TZ=UTC` e sem ele. O `dayOffset` do teste usa a data em UTC, e o servidor usa `todayInBrazil()`, então a falha ocorre das 21h à meia-noite de Brasília. O código de produção não foi alterado. A correção está na etapa 1, aguardando decisão do usuário.

**Revisão do Copilot no PR #14:** não rodou. Mensagem: `Copilot was unable to review this pull request because the user who requested the review has insufficient remaining quota.`

## Decisões pendentes do usuário

- Corrigir o teste agora, ou mesclar o PR #14 depois de repetir o CI a partir das 00h de Brasília.
