import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { swPrecache } from './scripts/vite-plugin-sw.mjs';

export default defineConfig({
  // Rutas relativas: la app funciona igual en la raíz de un dominio o en un subdirectorio.
  base: './',
  resolve: {
    alias: {
      // La lógica pura vive junto a las Edge Functions (_shared) para poder reutilizarla allí.
      '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)),
    },
  },
  plugins: [swPrecache()],
  build: { target: 'es2022' },
});
