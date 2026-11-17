import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The page asks its own origin for the data (/prometheus), and this server passes the request on: the browser needs
// no permission from Prometheus (CORS), and the address stays out of the page. LOADMAP_PROMETHEUS_URL is the one
// `loadmap pull` reads too.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/prometheus': {
        target: process.env.LOADMAP_PROMETHEUS_URL ?? 'http://localhost:9090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/prometheus/, ''),
      },
    },
  },
})
