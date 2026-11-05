import { ZenStackClient } from '@zenstackhq/orm';
import { PostgresDialect } from '@zenstackhq/orm/dialects/postgres';
import { PolicyPlugin } from '@zenstackhq/plugin-policy';
import pg from 'pg';
import { schema } from '../zenstack/schema.js';

// Servidor Node de longa duração (e Vercel Fluid Compute): driver `pg` com a URL pooled do Neon.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

// Cliente "cru", sem regras de acesso. Use só em código interno confiável.
export const rawDb = new ZenStackClient(schema, {
  dialect: new PostgresDialect({ pool }),
});

// Cliente com as regras @@allow do schema aplicadas.
export const policyDb = rawDb.$use(new PolicyPlugin());

export function dbFor(user: { id: string; email?: string } | undefined) {
  return policyDb.$setAuth(user);
}
