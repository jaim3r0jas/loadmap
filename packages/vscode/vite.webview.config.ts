import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The preview's webview: dist/webview/main.js, its lazy chunks and the ELK worker, loaded from the extension's own
// files (localResourceRoots). Relative URLs, since the webview serves them from a resource origin; no modulepreload
// links, which the CSP would refuse without a nonce
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  logLevel: 'warn',
  plugins: [react()],
  build: {
    outDir: 'dist/webview',
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: 'src/webview/main.tsx',
      output: {
        entryFileNames: 'main.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
