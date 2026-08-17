import { defineConfig } from 'vite'

// Web runtime: Firebase Auth/Firestore + Neon Data API + Apps Script worker.
export default defineConfig({
  define: {
    'globalThis.__BAO_HANG_WORKER_URL__': JSON.stringify(process.env.GOOGLE_SHEET_WEBHOOK_URL || process.env.APPS_SCRIPT_WORKER_URL || ''),
  },
  build: {
    target: 'es2020',
    minify: 'oxc',
    sourcemap: false,
    cssCodeSplit: true,
  },
})
