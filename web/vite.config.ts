import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import UnoCSS from 'unocss/vite'
import i18nHTML from './i18n-html.mjs'

export default defineConfig({
  build: { outDir: "../dist", emptyOutDir: true },
  plugins: [react(), UnoCSS(), i18nHTML()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
})
