# Ambiente local no Windows 11, sem Docker

Alternativa ao `npm run db:up` para quem não tem Docker: PostgreSQL 17 instalado direto no Windows, como serviço que inicia com o sistema.

## Instalação

Em um Prompt de Comando, troque `<senha-do-postgres>` por uma senha sua:

```bat
winget install --id PostgreSQL.PostgreSQL.17 --exact --accept-package-agreements --accept-source-agreements --override "--mode unattended --unattendedmodeui none --superpassword <senha-do-postgres> --serverport 5432"
set PGPASSWORD=<senha-do-postgres>
"C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h 127.0.0.1 -c "CREATE USER arandue PASSWORD 'arandue' CREATEDB;" -c "CREATE DATABASE arandue OWNER arandue;" -c "CREATE DATABASE arandue_test OWNER arandue;"
```

Depois, na raiz do projeto:

```bat
copy backend\.env.example backend\.env
npm run db:migrate
npm run db:seed
npm run dev
```

Abra <http://localhost:5173> e entre com `dono@atelie.test` / `senha-demo-123`. Não use `npm run db:up` nesse ambiente: ele depende do Docker.

## Cuidados

- **Senhas:** o usuário `arandue` usa a mesma senha do `compose.yaml`, fraca e só para desenvolvimento local. Não use em produção.
- **Seed:** `npm run db:seed` apaga o banco de desenvolvimento. Não rode se houver dados que queira manter.
- **Dados reais de clientes:** não versione espelhos ou PDFs reais no repositório. Eles trazem nome, CPF, endereço e telefone.
- **`npm audit`:** não use `npm audit fix --force`. As 4 vulnerabilidades moderadas vêm do `esbuild` antigo dentro do `drizzle-kit`, só em desenvolvimento, e o comando rebaixaria o `drizzle-kit` para a 0.18.1.

## Trabalhar em duas estações

O projeto roda em Windows (PostgreSQL nativo) e em Linux (Docker). O Git leva só o código. `backend/.env`, `node_modules` e os dados do banco ficam em cada máquina, então um registro criado em uma estação não aparece na outra.

**Ao chegar em uma estação**, com a cópia local sem alterações:

```bash
git pull --ff-only
npm install
npm run db:migrate
```

No Linux, rode `npm run db:up` antes das migrações. `npm install` e `npm run db:migrate` só são necessários quando o `package-lock.json` ou `backend/drizzle` mudarem, mas repeti-los não causa problema.

**Ao sair:** faça commit e push, mesmo em uma branch de trabalho. O que ficar só na máquina não chega à outra.

## Fim de linha

O `.gitattributes` mantém LF no repositório e nas cópias locais, com qualquer valor de `core.autocrlf`, e o `npm run lint` passa nas duas estações.

Uma cópia do Windows criada antes desse arquivo ainda tem CRLF nos arquivos e precisa ser refeita uma vez. **Os comandos abaixo descartam alterações sem commit**, então faça commit ou guarde o que estiver em aberto antes:

```bat
git pull --ff-only
git rm --cached -r -q .
git reset --hard
npm run lint
```
