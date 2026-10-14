import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the browser talks to this server only, and /api is forwarded to the API, so
// cookies work without cross-site settings. In production the API serves these built files itself.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3001', changeOrigin: false } },
  },
  build: { target: 'es2022', sourcemap: false },
});
