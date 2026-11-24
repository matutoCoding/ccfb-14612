import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5180, open: true },
});
