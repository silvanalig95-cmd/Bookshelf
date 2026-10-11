/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { localApi } from './server/localApi.ts';
import { SyncStore } from './server/syncStore.ts';

export default defineConfig(({ mode }) => {
  // Lädt auch Variablen ohne VITE_-Präfix – sie bleiben serverseitig.
  const env = loadEnv(mode, process.cwd(), '');
  const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
  return {
    define: {
      // Vom Update-Skript gesetzt (Commit-Kennung), damit die App neue Versionen erkennt
      __BUILD__: JSON.stringify(env.LESEKOMPASS_BUILD || 'dev'),
      __VERSION__: JSON.stringify(version),
    },
    // Relative Pfade: läuft lokal, auf GitHub Pages und in jedem Unterordner.
    base: './',
    plugins: [
      react(),
      localApi({
        anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
        geminiApiKey: env.GEMINI_API_KEY || undefined,
        llmKeys: { mistral: env.MISTRAL_API_KEY || undefined, groq: env.GROQ_API_KEY || undefined, openrouter: env.OPENROUTER_API_KEY || undefined },
        allowRemote: env.LESEKOMPASS_ALLOW_REMOTE === '1',
        sync: env.LESEKOMPASS_DATA ? new SyncStore(env.LESEKOMPASS_DATA) : undefined,
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
