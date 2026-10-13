import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// In development the browser talks to this server only, and /api is forwarded to the API,
// so cookies work without any cross-site settings. Production does the same with a reverse proxy.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3000,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3001', changeOrigin: false } },
  },
  build: { target: 'es2022', sourcemap: false },
});
