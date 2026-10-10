import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// client/ is the Vite root; the build lands in client/dist which the Express
// server serves in production (single process, single port 8100).
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8100', changeOrigin: true } }
  }
})
