import { authClient } from './auth.js';

export type RaiaResultado = { id: string; raia: number; chegadas: number; metros: number };
export type Treino = {
  id: string;
  nome: string | null;
  comprimentoPiscina: number;
  inicio: string;
  fim: string | null;
  raias: RaiaResultado[];
};

// Chama a API Node mandando o JWT do Neon Auth
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  // O SDK do Neon troca session.token pelo JWT (header set-auth-jwt) e guarda em cache
  const { data } = await authClient.getSession();
  const token = data?.session?.token;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}
