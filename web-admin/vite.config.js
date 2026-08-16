import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  define: {
    'globalThis.__BAO_HANG_WORKER_URL__': JSON.stringify(process.env.GOOGLE_SHEET_WEBHOOK_URL || process.env.APPS_SCRIPT_WORKER_URL || ''),
  },
  resolve: {
    alias: {
      '@supabase/supabase-js': fileURLToPath(new URL('./src/supabase-shim.js', import.meta.url)),
    },
  },
  build: {
    target: 'es2020',
    minify: 'oxc',
    sourcemap: false,
    cssCodeSplit: true,
  },
})