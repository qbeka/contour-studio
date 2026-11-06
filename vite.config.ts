import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// base is relative so the static build works from any folder or sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['test/**/*.test.ts'] },
});
