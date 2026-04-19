import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth': 'http://localhost:$BACKEND_PORT',
      '/machines': 'http://localhost:$BACKEND_PORT',
      '/tunnel': {
        target: 'ws://localhost:$BACKEND_PORT',
        ws: true,
      },
    },
  },
})
