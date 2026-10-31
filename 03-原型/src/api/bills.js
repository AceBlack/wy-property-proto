/**
 * 账单域适配层（契约见《接口层契约.md》三、B 域 · 账单）
 */
import { IS_MOCK, get, post } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 查询 ---------- */
export const queryBills = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK ? mock.queryBills({ pageNo, size, filters }) : get('/bills', { pageNo, size, ...filters })

/** 当前筛选范围的小计（去树后替代左树节点上的金额） */
export const billScopeSummary = filters =>
  IS_MOCK ? mock.billScopeSummary(filters) : get('/bills/summary', filters)

export const getBillDetail = billId =>
  IS_MOCK ? mock.getBillDetail(billId) : get(`/bills/${billId}`)

/* ---------- 字典（账单域专用；跨域共用的在 shared.js，别在这里重复导出） ---------- */
export { billQuerySummary, billVirtualNodes } from '@/utils/api'

/* ---------- 写 ----------
 * 注：契约里的 `PATCH /bills/{billId}`（改备注 / 到期日）**页面还没有入口**，
 * utils/api 也没有对应实现，因此这里不导出 updateBillField——
 * 适配层导出「调不通的函数」比不导出更糟：页面点了才报错，还以为是后端问题。
 * 要做内联改，先把 utils/api 的实现补上，再回来加这一行。
 */
/** 批量催缴：部分成功要按条返回原因（后端同口径，不要整批失败） */
export const batchRemindBills = (billIds, opt) =>
  IS_MOCK
    ? mock.batchRemindBills(billIds, opt)
    : post('/bills/batch-remind', { billIds, ...(opt || {}) })

/** 批量减免：原因必填，未收清零并转「已减免」 */
export const batchReduceBills = (billIds, opt) =>
  IS_MOCK
    ? mock.batchReduceBills(billIds, opt)
    : post('/bills/batch-reduce', { billIds, ...(opt || {}) })
