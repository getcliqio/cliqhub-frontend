import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    exclude: ['services/**', 'vendor/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      // Report only files loaded by tests — do not force every page into the denominator.
      exclude: [
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/lib/types.ts',
        'src/__tests__/**',
        'services/**',
        'vendor/**',
        'node_modules/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
