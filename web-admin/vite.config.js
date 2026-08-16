import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
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