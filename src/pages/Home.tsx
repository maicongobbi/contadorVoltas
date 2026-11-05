import { useEffect, useState } from 'react';
import { api, type Treino } from '../lib/api.js';
import { authClient } from '../lib/auth.js';
import { ir } from '../lib/router.js';

type Props = { user: { name?: string | null; email: string; image?: string | null } };

export function Home({ user }: Props) {
  const [treinos, setTreinos] = useState<Treino[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [apagar, setApagar] = useState<string | null>(null);

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
      const t = await api<Treino>('/treinos', { method: 'POST', body: JSON.stringify({ comprimentoPiscina: 25, raias: 6 }) });
      ir({ pagina: 'treino', id: t.id });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  // apagar pede dois toques (nada de confirm())
  async function tocarApagar(id: string) {
    if (apagar !== id) {
      setApagar(id);
      window.setTimeout(() => setApagar((a) => (a === id ? null : a)), 3000);
      return;
    }
    await api(`/treinos/${id}`, { method: 'DELETE' });
    setApagar(null);
    await carregar();
  }

  return (
    <main>
      <header className="bar">
        <span>Olá, {user.name ?? user.email}</span>
        <button onClick={() => authClient.signOut()}>Sair</button>
      </header>

      <h1>Treinos</h1>
      <div className="linha-botoes">
        <button className="big" onClick={novoTreino} disabled={busy}>
          {busy ? 'Criando…' : '+ Novo treino'}
        </button>
        <button onClick={() => ir({ pagina: 'painel' })}>📊 Painel</button>
      </div>
      {error && <p className="error">{error}</p>}

      {treinos === null ? (
        <p>Carregando…</p>
      ) : treinos.length === 0 ? (
        <p>Nenhum treino ainda.</p>
      ) : (
        <ul className="list">
          {treinos.map((t) => (
            <li key={t.id}>
              <div className="clicavel" onClick={() => ir({ pagina: 'treino', id: t.id })}>
                <strong>{t.nome ?? new Date(t.inicio).toLocaleString('pt-BR')}</strong>
                <small>
                  {t.comprimentoPiscina} m · {t.raias.length} raias ·{' '}
                  {t.raias.reduce((s, r) => s + r.metros, 0).toLocaleString('pt-BR')} m no total
                  {t.fim ? '' : ' · em andamento'}
                </small>
              </div>
              <div className="linha-botoes">
                <button onClick={() => ir({ pagina: 'treino', id: t.id })}>Abrir</button>
                <button className={apagar === t.id ? 'perigo' : ''} onClick={() => tocarApagar(t.id)}>
                  {apagar === t.id ? 'Confirmar' : 'Apagar'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
