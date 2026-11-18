import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: 'http://development.localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
