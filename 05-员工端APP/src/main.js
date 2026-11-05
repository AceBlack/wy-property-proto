import { createSSRApp } from 'vue'
import App from './App.vue'
import { workOrders, approvals, employees, orgs, ownerTags, owners, tenants } from '@pc/mock'
import repairPrices from '@pc/mock/repairPrices.json'
import { checkPcSchema, formatSchemaErrors } from '@/config/pcSchema'

/**
 * 启动先对一遍 `@pc` 字段契约。
 * @pc 是活引用，PC 改字段不会编译报错，只在运行时变成 undefined ——
 * 这里让它在控制台大声说出来，并挂到 window 上方便排查（不 throw：原型还要能演示）。
 */
function assertPcSchema() {
  const bad = checkPcSchema({ workOrders, approvals, employees, orgs, repairPrices, ownerTags, owners, tenants })
  if (!bad.length) return
  const msg = formatSchemaErrors(bad)
  console.error(msg)
  // eslint-disable-next-line no-undef
  if (typeof window !== 'undefined') window.__WY_PC_SCHEMA_ERRORS = bad
}

assertPcSchema()

export function createApp() {
  const app = createSSRApp(App)
  return { app }
}
