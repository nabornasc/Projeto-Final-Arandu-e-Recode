# Passagem de trabalho: notebook Arch Linux

Para o Claude Code que estiver rodando no notebook. O dono do projeto usa duas estações, um Windows 11 e este Arch Linux. O Windows já está funcionando. Sua tarefa é deixar o projeto funcionando aqui e responder ao Claude do Windows pelo Git.

Fale com o usuário em português.

## Regras

1. Nunca grave nem peça a URI do Supabase. `backend/.env` deve apontar só para `127.0.0.1` ou `localhost`: com a URI de produção nele, `npm run db:seed` apaga a demonstração pública.
2. Não coloque senha, token, conteúdo do `.env` ou dado real de cliente na resposta. Este arquivo e a resposta vão para o GitHub. `arandue` e `senha-demo-123` são públicas e podem aparecer.
3. Não descarte alterações sem commit. Se `git status` mostrar alterações, pare e pergunte ao usuário.
4. Comandos com `sudo` são do usuário: mostre o comando e peça para ele rodar.
5. Não altere o código do projeto. Se algo falhar, registre na resposta. Corrigir fica para uma decisão do usuário.

## Passos

Rode na raiz do repositório e anote o resultado de cada passo.

### 1. Ferramentas

```bash
node -v
npm -v
git --version
docker --version
docker compose version
systemctl is-active docker
groups
```

É preciso Node 24 ou mais, Docker ativo e o usuário no grupo `docker`. Se faltar algo, peça ao usuário:

```bash
sudo pacman -S --needed git nodejs npm docker docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Depois do `usermod`, ele precisa sair e entrar na sessão de novo.

### 2. Código

```bash
git status -sb
git pull --ff-only
npm install
```

### 3. Configuração

```bash
[ -f backend/.env ] || cp backend/.env.example backend/.env
node -e 'const l=require("fs").readFileSync("backend/.env","utf8").split(/\r?\n/).find(x=>x.startsWith("DATABASE_URL="));console.log(new URL(l.slice(13).replace(/^"|"$/g,"")).hostname)'
```

O segundo comando mostra só o host. Se não for `127.0.0.1` nem `localhost`, pare e avise o usuário, sem mostrar a linha inteira.

### 4. Banco

Se a porta 5432 estiver ocupada por outro PostgreSQL, pergunte ao usuário antes de parar qualquer serviço.

```bash
npm run db:up
npm run db:migrate
```

### 5. Dados de demonstração

`npm run db:seed` apaga o banco local. Antes, veja o que existe:

```bash
docker exec arandue-postgres psql -U arandue -d arandue -c "select name from companies" -c "select count(*) as pedidos from orders"
```

- Se a tabela estiver vazia, ou se as empresas forem só `Doces da Vila` com `Ateliê Aranduê`, `Ateliê Arandu` ou `Conveniência da Esquina`, ainda assim avise o usuário de que os dados locais serão apagados e peça a confirmação.
- Se houver outra empresa, pergunte com mais cuidado: pode ser trabalho que só existe nesta máquina.

Com a confirmação:

```bash
npm run db:seed
```

### 6. Conferência

Em um terminal separado, ou em segundo plano, rode `npm run dev`. Depois:

```bash
curl -s http://localhost:3001/api/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -H 'origin: http://localhost:5173' -d '{"email":"dono@conveniencia.test","password":"senha-demo-123"}' http://localhost:3001/api/auth/login
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173
npm run lint
npm test
```

Esperado: `{"status":"ok"}`, `200`, `200`, lint sem erros e testes passando. Encerre o `npm run dev` que você iniciou.

Peça ao usuário para abrir <http://localhost:5173> e entrar com `dono@conveniencia.test` / `senha-demo-123`. Registre o que ele responder.

## Resposta

Crie `handoff/resposta-arch.md` com este formato, informando o que de fato aconteceu:

```markdown
# Resposta do notebook Arch Linux

Data:
Commit testado:

| Passo | Resultado | Observação |
|---|---|---|
| Ferramentas | | versões |
| Código | | |
| Configuração | | host do banco |
| Banco | | |
| Dados | | feito, recusado ou não necessário |
| API e login | | códigos recebidos |
| Tela, conferida pelo usuário | | |
| Lint | | |
| Testes | | quantos passaram |

## Problemas

Comando, erro exato e o que foi tentado. Escreva "nenhum" se não houver.

## Decisões pendentes do usuário
```

Publique em uma branch própria, sem mexer na `main`:

```bash
git switch -c handoff/resposta-arch
git add handoff/resposta-arch.md
git commit -m "docs: resposta da passagem de trabalho do Arch Linux"
git push -u origin handoff/resposta-arch
```

Se o commit assinado ou o push falhar, não desative a assinatura. Mostre a resposta ao usuário e peça que ele resolva a chave.

Por fim, diga ao usuário para voltar ao Windows e pedir: `leia a resposta do notebook`.

## Para o Claude do Windows

Ao receber esse pedido:

```bash
git fetch origin
git show origin/handoff/resposta-arch:handoff/resposta-arch.md
```
