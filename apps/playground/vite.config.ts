import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// elkjs (about 1.5 MB) runs in a worker chunk of its own, loaded on the first layout
export default defineConfig({ plugins: [react()], build: { chunkSizeWarningLimit: 2500 } })
