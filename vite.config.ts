import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Dev proxy target for /v1 → BFF. Override per machine in `.env.local`
  // (git-ignored), e.g. `BFF_URL=http://localhost:3002`.
  const env = loadEnv(mode, process.cwd(), '');
  const bff_url = env.BFF_URL || 'http://localhost:3001';
  return {
    plugins: [tailwindcss(), react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/v1': {
          target: bff_url,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
