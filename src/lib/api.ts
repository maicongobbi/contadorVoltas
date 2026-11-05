export type RaiaResultado = { id: string; raia: number; chegadas: number; metros: number };
export type Treino = {
  id: string;
  nome: string | null;
  comprimentoPiscina: number;
  inicio: string;
  fim: string | null;
  raias: RaiaResultado[];
};

// Chama a API Node. O cookie de sessão vai junto (mesmo domínio).
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error(`Erro ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}
