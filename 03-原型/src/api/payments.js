/**
 * 缴费域适配层（契约见《接口层契约.md》· payments）
 *
 * 口径提醒：
 *   - 列表与汇总**必须同参数**，否则「列表 160 笔 / 合计 158 笔」，对账时会吵；
 *   - 页面筛选里的 `range: [起, 止]` 是数组，契约是 `startDate` / `endDate` 两个参数，这里做一次转换；
 *   - 退款是**事务**：退款单 + 流水累计 + 账单回落 + 发票红冲，后端别拆开做。
 */
import { IS_MOCK, get, post } from '@/api/client'
import * as mock from '@/utils/api'

/** 页面筛选 → 契约查询参数（range 拆两参，空值交给 client 过滤） */
function payParams(filters = {}) {
  const { range, ...rest } = filters || {}
  const out = { ...rest }
  if (Array.isArray(range)) {
    if (range[0]) out.startDate = String(range[0]).slice(0, 10)
    if (range[1]) out.endDate = String(range[1]).slice(0, 10)
  }
  return out
}

/** 汇总响应的口径键 → 页面用的键（两边同一份，不各写一套） */
const toScope = d => ({
  count: d.count || 0, amount: d.amount || 0,
  cash: d.cashCount || 0, uninvoiced: d.uninvoicedCount || 0
})
const toGlobal = d => ({
  total: d.count || 0, amount: d.amount || 0,
  todayCount: d.todayCount || 0, todayAmount: d.todayAmount || 0,
  monthCount: d.monthCount || 0, monthAmount: d.monthAmount || 0,
  cashCount: d.cashCount || 0, cashAmount: d.cashAmount || 0,
  invoiced: d.invoiced || 0,
  byMethod: d.byMethod || [], byChannel: d.byChannel || []
})

/* ---------- 查询 ---------- */
export const queryPayments = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK
    ? mock.queryPayments({ pageNo, size, filters })
    : get('/payments', { pageNo, size, ...payParams(filters) })

/** 当前筛选范围的小计（替代原树节点上的金额） */
export const payScopeSummary = filters =>
  IS_MOCK
    ? mock.payScopeSummary(filters)
    : get('/payments/summary', payParams(filters)).then(toScope)

/** 全局 KPI：同一接口 + 空筛选（不另开端点，免得两套口径） */
export const paymentSummary = () =>
  IS_MOCK ? mock.paymentSummary() : get('/payments/summary', {}).then(toGlobal)

export const getPaymentDetail = payId =>
  IS_MOCK ? mock.getPaymentDetail(payId) : get(`/payments/${payId}`)

/* ---------- 写 ---------- */
export const refundPayment = (payId, opt) =>
  IS_MOCK
    ? mock.refundPayment(payId, opt)
    : post(`/payments/${payId}/refund`, opt)

/* ---------- 字典（缴费域专用） ---------- */
export {
  invoiceStatusOpts, payChannelOpts, payMethodOpts, payVirtualNodes
} from '@/utils/api'
