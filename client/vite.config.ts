import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.BACKEND_PORT || '3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth': `http://localhost:${backendPort}`,
      '/machines': `http://localhost:${backendPort}`,
      '/tunnel': {
        target: `ws://localhost:${backendPort}`,
        ws: true,
      },
    },
  },
})
