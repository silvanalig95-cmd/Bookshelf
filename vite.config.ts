/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { localApi } from './server/localApi.ts';

export default defineConfig(({ mode }) => {
  // Lädt auch Variablen ohne VITE_-Präfix – sie bleiben serverseitig.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    // Relative Pfade: läuft lokal, auf GitHub Pages und in jedem Unterordner.
    base: './',
    plugins: [
      react(),
      localApi({
        anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
        allowRemote: env.LESEKOMPASS_ALLOW_REMOTE === '1',
      }),
    ],
    server: { port: 5173 },
    preview: { port: 4173 },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
