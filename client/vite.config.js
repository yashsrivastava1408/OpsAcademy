import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const DEFAULT_API_URL = 'http://localhost:4000'

/**
 * The page's Content-Security-Policy only lets the browser talk to the API
 * (and, with Supabase sign-in, Supabase) it was built for. This fills those
 * origins into index.html, so the policy always matches the deployment.
 * In a production build scripts may only come from the app's own files: no
 * inline scripts and no eval. The dev server needs both for hot reloading.
 */
function contentSecurityPolicy(apiUrl, supabaseUrl) {
  // Same-origin setups (VITE_API_URL empty, "/" or "/api") are already covered
  // by 'self', so nothing extra is added to the policy.
  const absolute = /^https?:\/\//.test(apiUrl)
  const origin = absolute ? new URL(apiUrl).origin : ''
  const sources = [absolute ? `${origin} ${origin.replace(/^http/, 'ws')}` : '', supabaseUrl ? new URL(supabaseUrl).origin : '']
    .filter(Boolean)
    .join(' ')
  return {
    name: 'opsacademy-csp',
    transformIndexHtml: (html, ctx) =>
      html
        .replace('__API_CONNECT_SRC__', sources)
        .replace('__SCRIPT_SRC__', ctx.server ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'"),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), contentSecurityPolicy(env.VITE_API_URL ?? DEFAULT_API_URL, env.VITE_AUTH_MODE === 'supabase' ? env.VITE_SUPABASE_URL : '')],
  }
})
