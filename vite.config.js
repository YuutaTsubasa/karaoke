import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { karaokeApi } from './server/api.js';
import { buildDemo } from './scripts/make-demo.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.KARAOKE_PORT || 5180);

function api() {
  buildDemo(); // writes examples/demo/instrumental.wav on first run
  const handle = karaokeApi({ root });
  return {
    name: 'karaoke-api',
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

export default defineConfig({
  plugins: [svelte(), api()],
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    watch: { ignored: ['**/library/**', '**/examples/**'] },
  },
  preview: { host: '127.0.0.1', port, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        player: 'player.html',
        control: 'control.html',
        timing: 'timing.html',
      },
    },
  },
});
