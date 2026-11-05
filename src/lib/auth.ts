import { createAuthClient } from '@neon/auth';
import { BetterAuthReactAdapter } from '@neon/auth/react/adapters';

// Neon Auth = Better Auth gerenciado pelo Neon
export const authClient = createAuthClient(import.meta.env.VITE_NEON_AUTH_URL, {
  adapter: BetterAuthReactAdapter(),
});

export function signInWithGoogle() {
  return authClient.signIn.social({ provider: 'google', callbackURL: window.location.origin });
}
