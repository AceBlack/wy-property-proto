/**
 * 统一 API 入口（2026-10-30）
 *
 * 页面写法：
 *   import { queryBills, batchRemindBills } from '@/api'          // 推荐（自动 mock/http）
 *   import { API_MODE } from '@/api'                              // 需要区分环境时
 *
 * 迁移方式（契约替换六步的第 3 步）：
 *   1. `import ... from '@/utils/api'` → `from '@/api'`（同名函数可逐个替换，不用一次改完）
 *   2. `.env.local` 里设 `VITE_API_MODE=http` + `VITE_API_BASE`
 *   3. 未覆盖到的域继续走 utils/api（仍是 mock），因此可以按域灰度切换
 */
export * from '@/api/client'
export * from '@/api/shared'
export * from '@/api/owners'
export * from '@/api/bills'
export * from '@/api/workorders'
export * from '@/api/tenants'
export * from '@/api/inspect'
export * from '@/api/rectify'
export * from '@/api/reports'
export * from '@/api/payments'
export * from '@/api/quality'
export * from '@/api/close'
export * from '@/api/contracts'
export * from '@/api/notices'
export * from '@/api/employees'
export * from '@/api/payrolls'
export * from '@/api/access'

/** 当前环境摘要（页面角标 / 埋点用） */
export const apiInfo = () => ({
  mode: (import.meta.env.VITE_API_MODE || 'mock').toLowerCase(),
  base: import.meta.env.VITE_API_BASE || '/api',
  env: import.meta.env.VITE_APP_ENV || 'local'
})
