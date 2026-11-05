import { createAuthClient } from '@neon/auth';
import { BetterAuthReactAdapter } from '@neon/auth/react/adapters';

// Neon Auth = Better Auth gerenciado pelo Neon.
// O cliente fala com /api/auth no nosso domínio; o servidor repassa para o Neon.
export const authClient = createAuthClient(`${window.location.origin}/api/auth`, {
  adapter: BetterAuthReactAdapter(),
});

export function signInWithGoogle() {
  return authClient.signIn.social({ provider: 'google', callbackURL: window.location.origin });
}
