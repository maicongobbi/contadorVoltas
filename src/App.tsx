import { authClient } from './lib/auth.js';
import { Home } from './pages/Home.js';
import { Login } from './pages/Login.js';

export function App() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <main className="center">Carregando…</main>;
  if (!session?.user) return <Login />;
  return <Home user={session.user} />;
}
