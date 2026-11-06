import { defineConfig } from 'vite';

// The project page in replay/. Paths stay relative so it works under any folder.
export default defineConfig({
  root: 'replay',
  base: './',
  publicDir: '../public',
  worker: { format: 'es' },
  build: { target: 'es2022', outDir: '../dist-site', emptyOutDir: true },
});
