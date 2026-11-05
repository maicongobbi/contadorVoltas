# Contador de Voltas

App para contar chegadas por raia na piscina usando a câmera do celular. Especificação completa em [ESPECIFICACAO.md](ESPECIFICACAO.md); o protótipo original está em [prototipo/index.html](prototipo/index.html).

## Stack

- **Front:** React + Vite (`src/`)
- **API:** Node + Hono (`server/`); na Vercel roda como função em `api/index.ts`
- **Login:** Neon Auth (Better Auth gerenciado) com Google
- **Banco:** Neon Postgres
- **Acesso a dados:** ZenStack v3 (`zenstack/schema.zmodel`), com regras de acesso por usuário

Fluxo de login: o navegador fala só com `/api/auth` no próprio domínio, e o servidor repassa para o Neon Auth (`handleAuthProxyRequest`). Assim o cookie de sessão é do nosso domínio e não é bloqueado como cookie de terceiros. A API lê o usuário pelo cookie e usa `db.$setAuth(user)` para que o ZenStack aplique as regras `@@allow` (cada usuário só vê os próprios treinos).

## Rodar localmente

```bash
npm install
neon env pull        # cria .env.local com DATABASE_URL e NEON_AUTH_*
echo "NEON_AUTH_COOKIE_SECRET=$(openssl rand -base64 32)" >> .env.local
npm run dev          # web em http://localhost:5173, API em :3001
```

## Banco

- Editar `zenstack/schema.zmodel`
- `npm run generate` gera `zenstack/schema.ts`
- `npm run db:push` aplica o schema no Neon (por enquanto sem migrações; use `npm run db:migrate` quando quiser histórico de migrações)

## Deploy na Vercel

Variáveis necessárias no projeto: `DATABASE_URL`, `NEON_AUTH_BASE_URL` e `NEON_AUTH_COOKIE_SECRET` (gere com `openssl rand -base64 32`).
Depois do primeiro deploy, libere o domínio no Neon Auth:

```bash
neon neon-auth domain add https://SEU-APP.vercel.app
```

O login com Google usa, por enquanto, as credenciais compartilhadas do Neon (só para desenvolvimento). Para produção, cadastre suas próprias credenciais com `neon neon-auth oauth-provider update`.
