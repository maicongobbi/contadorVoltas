import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    plugins: [react()],
    // A URL do Neon Auth é pública; reaproveitamos NEON_AUTH_BASE_URL (vinda do Neon/Vercel)
    define: {
      'import.meta.env.VITE_NEON_AUTH_URL': JSON.stringify(env.VITE_NEON_AUTH_URL ?? env.NEON_AUTH_BASE_URL),
    },
    server: {
      proxy: { '/api': 'http://localhost:3001' },
    },
  };
});
