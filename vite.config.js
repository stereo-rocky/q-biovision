import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// In dev we proxy /api -> the FastAPI backend so the browser only ever talks
// to the Vite origin (no CORS, no hardcoded localhost in the bundle).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_DEV_API_PROXY || 'http://localhost:8000'

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      // Allow cloud/preview hostnames (Codespaces, e2b, ngrok, etc.)
      allowedHosts: true,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: true,
      proxy: { '/api': { target, changeOrigin: true, secure: false } },
    },
  }
})
