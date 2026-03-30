import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
    build: {
    rollupOptions: {
      input: {
        main:  fileURLToPath(new URL('./index.html',  import.meta.url)),
        share: fileURLToPath(new URL('./share.html',  import.meta.url)),
        shareAdmin: fileURLToPath(new URL('./share-admin.html', import.meta.url)),
      }
    }
  }
})
