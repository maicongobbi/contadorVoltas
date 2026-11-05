import { useState } from 'react';
import { signInWithGoogle } from '../lib/auth.js';

export function Login() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function entrar() {
    setLoading(true);
    setError(null);
    try {
      const { error } = await signInWithGoogle();
      if (error) setError(error.message ?? 'Não foi possível entrar com o Google.');
    } catch {
      setError('Não foi possível entrar com o Google.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="center">
      <h1>Contador de Voltas</h1>
      <p>Conta as chegadas de cada raia pela câmera do celular.</p>
      <button className="big" onClick={entrar} disabled={loading}>
        {loading ? 'Abrindo o Google…' : 'Entrar com Google'}
      </button>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
