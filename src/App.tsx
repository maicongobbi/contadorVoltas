import { authClient } from './lib/auth.js';
import { useRota } from './lib/router.js';
import { Home } from './pages/Home.js';
import { Login } from './pages/Login.js';
import { Painel } from './pages/Painel.js';
import { Treino } from './pages/Treino.js';

export function App() {
  const { data: session, isPending } = authClient.useSession();
  const rota = useRota();

  if (isPending) return <main className="center">Carregando…</main>;
  if (!session?.user) return <Login />;
  if (rota.pagina === 'treino') return <Treino key={rota.id} id={rota.id} />;
  if (rota.pagina === 'painel') return <Painel />;
  return <Home user={session.user} />;
}
