import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const DEFAULT_API_URL = 'http://localhost:4000'

/**
 * The page's Content-Security-Policy only lets the browser talk to the API
 * it was built for. This fills that origin (HTTP and WebSocket) into
 * index.html from VITE_API_URL, so the policy always matches the deployment.
 */
function apiContentSecurityPolicy(apiUrl) {
  const origin = new URL(apiUrl).origin
  const sources = `${origin} ${origin.replace(/^http/, 'ws')}`
  return {
    name: 'opsacademy-api-csp',
    transformIndexHtml: (html) => html.replace('__API_CONNECT_SRC__', sources),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), apiContentSecurityPolicy(env.VITE_API_URL || DEFAULT_API_URL)],
  }
})
