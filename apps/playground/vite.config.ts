import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// elkjs is about 1.5 MB on its own; moving it into a worker is milestone 2
export default defineConfig({ plugins: [react()], build: { chunkSizeWarningLimit: 2500 } })
