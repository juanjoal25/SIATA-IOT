import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const API = process.env.API_URL ?? 'http://127.0.0.1:8787';

export default defineConfig({
  // El frontend vive en su propia carpeta dentro del monolito.
  root: path.resolve(__dirname, 'frontend'),
  publicDir: path.resolve(__dirname, 'frontend/public'),
  plugins: [react()],
  server: {
    port: 5173,
    // `host: true` permite abrir la PWA desde el móvil en la misma red y así
    // probar la geolocalización real (el navegador exige HTTPS o localhost).
    host: true,
    proxy: {
      '/api': { target: API, changeOrigin: true },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'frontend/dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
