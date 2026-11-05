import { useEffect, useState } from 'react';

export type Rota = { pagina: 'inicio' } | { pagina: 'treino'; id: string } | { pagina: 'painel' };

function ler(): Rota {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'treino' && b) return { pagina: 'treino', id: b };
  if (a === 'painel') return { pagina: 'painel' };
  return { pagina: 'inicio' };
}

export function ir(rota: Rota) {
  window.location.hash = rota.pagina === 'treino' ? `/treino/${rota.id}` : rota.pagina === 'painel' ? '/painel' : '/';
}

export function useRota(): Rota {
  const [r, setR] = useState(ler);
  useEffect(() => {
    const f = () => setR(ler());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}
