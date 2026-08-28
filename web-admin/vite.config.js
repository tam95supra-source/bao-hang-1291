import { defineConfig } from 'vite'

// Web runtime: Firebase Auth/Firestore + Neon Data API + Apps Script worker; no legacy provider bridge protocol.
export default defineConfig({
  define: {
    'globalThis.__BAO_HANG_WORKER_URL__': JSON.stringify(process.env.GOOGLE_SHEET_WEBHOOK_URL || process.env.APPS_SCRIPT_WORKER_URL || ''),
  },
  build: {
    target: 'es2020',
    manifest: true,
    minify: 'oxc',
    sourcemap: false,
    cssCodeSplit: true,
  },
})
