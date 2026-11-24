import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev: Vite serves the UI on :5173 (reachable from other devices on your
// network) and forwards API + socket traffic to the game server on :3001.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
})
