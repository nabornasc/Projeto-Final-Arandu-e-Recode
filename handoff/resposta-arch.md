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

## Decisões pendentes do usuário

Nenhuma nesta passagem. O backup do banco local anterior ao seed fica só na pasta temporária do notebook e não vai para o Git.
