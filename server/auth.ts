import { handleAuthProxyRequest } from '@neon/auth/server';

// O login acontece pelo Neon Auth (Better Auth gerenciado), através da ponte em /api/auth.
// Como front e API estão no mesmo domínio, o cookie de sessão chega junto em cada chamada.
const config = () => ({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookieSecret: process.env.NEON_AUTH_COOKIE_SECRET!,
  sameSite: 'lax' as const,
});

export type AuthUser = { id: string; email?: string; name?: string };

/** Repassa qualquer chamada de /api/auth/* para o Neon Auth. */
export function authProxy(request: Request, path: string) {
  return handleAuthProxyRequest({ ...config(), request, path });
}

/** Lê o usuário logado a partir dos cookies da requisição. */
export async function getSessionUser(request: Request): Promise<AuthUser | undefined> {
  const cookie = request.headers.get('cookie');
  if (!cookie) return undefined;
  const origin = new URL(request.url).origin;
  const res = await authProxy(
    new Request(`${origin}/api/auth/get-session`, { headers: { cookie, origin } }),
    'get-session',
  );
  if (!res.ok) return undefined;
  const data = (await res.json().catch(() => null)) as { user?: { id: string; email?: string; name?: string } } | null;
  if (!data?.user?.id) return undefined;
  return { id: data.user.id, email: data.user.email, name: data.user.name };
}
