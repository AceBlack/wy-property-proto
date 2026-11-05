import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

/** 本项目源码根 */
const SRC = fileURLToPath(new URL('./src', import.meta.url))
/** 只读引用的 PC 原型源码根（mock / utils/api） */
const PC = fileURLToPath(new URL('../03-原型/src', import.meta.url))

/**
 * PC 端源码内部用 '@/mock'、'@/utils/api' 引用自己的兄弟模块。
 * uni-app 自己也注册了一条 '@/' → 本项目 src 的 alias，且 Vite 的 alias 先于用户插件执行，
 * 所以光加 alias 抢不过它 —— PC 的 '@/mock' 会被解析到 05/src/mock（不存在）。
 *
 * 做法：在 PC 源码被载入后、import 分析前，把它内部的 '@/x' 改写成 '@pc/x'。
 * 只作用于 03-原型/src 下的 .js 文件，本项目自己的 '@/x' 仍然走 uni 的别名。
 */
const wyPcImports = {
  name: 'wy-pc-imports',
  enforce: 'pre',
  transform(code, id) {
    if (!id.startsWith(PC) || !/\.m?js$/.test(id)) return null
    const out = code
      .replace(/(\bfrom\s*)(['"])@\//g, '$1$2@pc/')
      .replace(/(\bimport\s*)(['"])@\//g, '$1$2@pc/')
      .replace(/(\bimport\()(['"])@\//g, '$1$2@pc/')
    return out === code ? null : { code: out, map: null }
  }
}

export default defineConfig({
  plugins: [wyPcImports, uni()],
  resolve: {
    alias: [
      // 只读别名：@pc/mock、@pc/utils/api
      { find: '@pc', replacement: PC }
    ]
  },
  optimizeDeps: {
    /**
     * 关掉依赖预扫描：它是 esbuild 独立解析一遍入口，不经过上面那条 transform，
     * 于是 PC 源码里的 '@/mock' 会被 uni 的别名解析到 05/src/mock 而报错（页面本身没坏，只是刷一屏红字）。
     * 本工程没有需要预打包的第三方依赖（vue 由 uni 自己 include），关掉最省事。
     */
    noDiscovery: true
  },
  server: {
    port: 5199,
    fs: {
      // 允许读取工程外的 03-原型/src（Vite 默认只放行项目根）
      allow: [fileURLToPath(new URL('.', import.meta.url)), PC, fileURLToPath(new URL('..', import.meta.url))]
    }
  }
})
