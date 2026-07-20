import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/ocean_model_visualiser/',
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    hmr: false, // Keep this disabled for FortiGate
    proxy: {
      // Catch any request ending in /api (with or without base path subpath)
      '^/.*api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^.*\/api/, '/api')
      }
    }
  }
})
