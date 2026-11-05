import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The API lives in the Go server (internal/server). In development `npm run dev`
// starts it on API_PORT and Vite proxies to it; the built pages are embedded into
// the desktop app, which serves both on one port.
const port = Number(process.env.KARAOKE_PORT || 5180);
const api = `http://127.0.0.1:${process.env.KARAOKE_API_PORT || 5181}`;

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    proxy: { '/api': api, '/media': api },
    watch: { ignored: ['**/library/**', '**/examples/**', '**/build/**'] },
  },
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
