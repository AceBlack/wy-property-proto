import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * base 说明：
 * - 默认 '/'：本地 dev / vite preview / 平台根路径部署（如 WorkBuddy sites）
 * - GitHub Pages 部署在子路径 https://<user>.github.io/<repo>/，
 *   构建时用 `GH_PAGES_BASE=/<repo>/ npm run build` 指定即可，源码无需改动。
 */
export default defineConfig({
  base: process.env.GH_PAGES_BASE || '/',
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  server: { port: 5173, host: true, strictPort: false },
  preview: { port: 5186, host: true, strictPort: false, allowedHosts: true },
  build: { outDir: 'dist', chunkSizeWarningLimit: 6000 }
})
