/**
 * 支出域适配层（批 5 · 2026-11-13）
 * ------------------------------------------------------------
 * 支出归集是**四类来源的合并视图**，不是一张表：报销、工资、合同摊、手工补录。
 * 这里不重新实现汇总逻辑，只决定"谁来算"：
 *   · 支出归集 / 工资成本：http 模式交给服务端（口径必须与后端一致，前端各算一遍必然漂移）
 *   · 手工补录的读写：走 /manual-entries
 *   · 分类字典与常量：纯前端，直连 utils/api（它只是读字典，不产生数据）
 */
import { IS_MOCK, get, post } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 支出归集 ---------- */

/** 某账期的支出，按「分类二级 × 来源」拆开 */
export const expenseCollect = params =>
  IS_MOCK ? mock.expenseCollect(params) : get('/expenses/collect', params)

/** 工资成本（单月，含社保与福利估算） */
export const payrollCostOf = params =>
  IS_MOCK ? mock.payrollCostOf(params) : get('/expenses/payroll-cost', params)

/** 押金台账口径：收 − 退 − 扣 = 在账（押金是负债，不是收入） */
export const depositLedger = () =>
  IS_MOCK ? mock.depositLedger() : get('/deposits/ledger')

/* ---------- 手工补录 ---------- */

export const queryManualEntries = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK
    ? mock.queryManualEntries({ pageNo, size, filters })
    : get('/manual-entries', { pageNo, size, ...filters })

export const manualEntrySummary = () =>
  IS_MOCK ? mock.manualEntrySummary() : get('/manual-entries/summary')

export const saveManualEntry = (payload, entryId = '') =>
  IS_MOCK
    ? mock.saveManualEntry(payload, entryId)
    : (entryId ? post(`/manual-entries/${entryId}`, payload) : post('/manual-entries', payload))

/** 作废而不是删除：补录是"没有单据流"的钱，删掉就再也查不到它存在过 */
export const voidManualEntry = (entryId, reason = '') =>
  IS_MOCK
    ? mock.voidManualEntry(entryId, reason)
    : post(`/manual-entries/${entryId}/void`, { reason })

/* ---------- 常量与字典（纯前端） ---------- */

export {
  EXPENSE_SOURCES, DEPOSIT_CATEGORY_CODE, MANUAL_ENTRY_STATUS, manualCategoryOpts
} from '@/utils/api'
