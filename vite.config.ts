import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    exclude: ['jeep-sqlite', '@capacitor-community/sqlite'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
