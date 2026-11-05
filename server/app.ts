import { Hono } from 'hono';
import { z } from 'zod';
import { authProxy, getSessionUser, type AuthUser } from './auth.js';
import { dbFor, rawDb } from './db.js';

type Env = { Variables: { user: AuthUser } };

export const app = new Hono<Env>().basePath('/api');

app.get('/health', async (c) => {
  const rows = await rawDb.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
  return c.json({ ok: true, db: rows[0]?.ok === 1 });
});

// Ponte para o Neon Auth: o navegador fala só com o nosso domínio, e os cookies
// de login ficam aqui (sem cookie de terceiros, que Brave/Safari bloqueiam).
app.all('/auth/*', (c) => authProxy(c.req.raw, c.req.path.replace(/^\/api\/auth\//, '')));

// Tudo abaixo de /api/* (exceto /health e /auth) exige login
app.use('*', async (c, next) => {
  const user = await getSessionUser(c.req.raw);
  if (!user) return c.json({ error: 'Não autenticado' }, 401);
  c.set('user', user);
  await next();
});

app.get('/me', (c) => c.json(c.get('user')));

app.get('/treinos', async (c) => {
  const db = dbFor(c.get('user'));
  const treinos = await db.treino.findMany({
    include: { raias: { orderBy: { raia: 'asc' } } },
    orderBy: { inicio: 'desc' },
  });
  return c.json(treinos);
});

const novoTreino = z.object({
  nome: z.string().max(100).optional(),
  comprimentoPiscina: z.number().int().positive().max(100).default(25),
  raias: z.number().int().min(1).max(10).default(6),
});

app.post('/treinos', async (c) => {
  const parsed = novoTreino.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const { nome, comprimentoPiscina, raias } = parsed.data;
  const db = dbFor(c.get('user'));
  const treino = await db.treino.create({
    data: {
      nome,
      comprimentoPiscina,
      raias: { create: Array.from({ length: raias }, (_, i) => ({ raia: i + 1 })) },
    },
    include: { raias: { orderBy: { raia: 'asc' } } },
  });
  return c.json(treino, 201);
});

app.delete('/treinos/:id', async (c) => {
  const db = dbFor(c.get('user'));
  // Com as regras de acesso, o treino de outro usuário simplesmente "não existe"
  const { count } = await db.treino.deleteMany({ where: { id: c.req.param('id') } });
  return count ? c.body(null, 204) : c.json({ error: 'Não encontrado' }, 404);
});
