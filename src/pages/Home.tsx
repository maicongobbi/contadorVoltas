import { useEffect, useState } from 'react';
import { api, type Treino } from '../lib/api.js';
import { authClient } from '../lib/auth.js';

type Props = { user: { name?: string | null; email: string; image?: string | null } };

export function Home({ user }: Props) {
  const [treinos, setTreinos] = useState<Treino[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function carregar() {
    try {
      setTreinos(await api<Treino[]>('/treinos'));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  async function novoTreino() {
    setBusy(true);
    try {
      await api('/treinos', { method: 'POST', body: JSON.stringify({ comprimentoPiscina: 25, raias: 6 }) });
      await carregar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apagar(id: string) {
    await api(`/treinos/${id}`, { method: 'DELETE' });
    await carregar();
  }

  return (
    <main>
      <header className="bar">
        <span>Olá, {user.name ?? user.email}</span>
        <button onClick={() => authClient.signOut()}>Sair</button>
      </header>

      <h1>Treinos</h1>
      <button className="big" onClick={novoTreino} disabled={busy}>
        {busy ? 'Criando…' : 'Novo treino (25 m, 6 raias)'}
      </button>
      {error && <p className="error">{error}</p>}

      {treinos === null ? (
        <p>Carregando…</p>
      ) : treinos.length === 0 ? (
        <p>Nenhum treino ainda.</p>
      ) : (
        <ul className="list">
          {treinos.map((t) => (
            <li key={t.id}>
              <div>
                <strong>{t.nome ?? new Date(t.inicio).toLocaleString('pt-BR')}</strong>
                <small>
                  {t.comprimentoPiscina} m · {t.raias.length} raias ·{' '}
                  {t.raias.reduce((s, r) => s + r.metros, 0)} m no total
                </small>
              </div>
              <button onClick={() => apagar(t.id)}>Apagar</button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
