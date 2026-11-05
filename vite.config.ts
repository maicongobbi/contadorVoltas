import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Em dev, /api (inclusive /api/auth) vai para o servidor Node
    proxy: { '/api': 'http://localhost:3001' },
  },
});
