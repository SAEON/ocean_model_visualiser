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
      // Whenever the frontend hits "/api", Vite forwards it locally to 8001
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
