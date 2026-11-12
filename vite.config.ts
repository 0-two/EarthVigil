import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // MapLibre 6 loads its worker via new URL('./maplibre-gl-worker.mjs', import.meta.url);
  // pre-bundling moves the file and breaks that URL, so serve it as-is.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787', '/u': 'http://localhost:8787' },
  },
})
