import { createRemoteJWKSet, jwtVerify } from 'jose';

// O login acontece no navegador via Neon Auth (Better Auth gerenciado).
// O front manda o JWT em `Authorization: Bearer`, e aqui só verificamos a assinatura.
const baseUrl = process.env.NEON_AUTH_BASE_URL;
const jwksUrl = process.env.NEON_AUTH_JWKS_URL ?? (baseUrl ? `${baseUrl}/.well-known/jwks.json` : undefined);

const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : undefined;

export type AuthUser = { id: string; email?: string; name?: string };

export async function verifyBearer(header: string | undefined): Promise<AuthUser | undefined> {
  if (!jwks || !header?.startsWith('Bearer ')) return undefined;
  try {
    const { payload } = await jwtVerify(header.slice(7), jwks, {
      issuer: baseUrl ? new URL(baseUrl).origin : undefined,
    });
    if (!payload.sub) return undefined;
    return {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  } catch {
    return undefined;
  }
}
