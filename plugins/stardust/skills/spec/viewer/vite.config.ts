import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import macros from 'unplugin-parcel-macros';
import optimizeLocales from '@react-aria/optimize-locales-plugin';

// SPEC_API lets dev and preview use the deployed Worker's data, e.g. SPEC_API=https://<worker>.<account>.workers.dev
const apiProxy = Object.fromEntries(['/api', '/media'].map((p) => [p, { target: process.env.SPEC_API ?? 'http://localhost:8787', changeOrigin: true }]));

export default defineConfig({
  root: 'web',
  plugins: [
    macros.vite(), // must be first: runs the S2 style macro at build time
    { ...optimizeLocales.vite({ locales: ['en-US'] }), enforce: 'pre' },
    react(),
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: ['es2022'],
    cssMinify: 'lightningcss',
    rollupOptions: {
      output: {
        // S2 atomic CSS overlaps heavily between pages: one shared bundle is smaller than per-chunk copies.
        manualChunks(id) {
          if (/macro-(.*)\.css$/.test(id) || /@react-spectrum\/(s2|ai)\/.*\.css$/.test(id)) return 's2-styles';
        },
      },
    },
  },
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
});
