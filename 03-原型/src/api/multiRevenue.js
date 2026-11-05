/**
 * 多种经营收入 · 契约见 openapi.yaml 的 `multi-revenue` 域（2026-11-02）
 *
 * 两个分项的时间口径不一样，这是接口层必须收口的原因：
 *   商业服务收入 —— **完工确认制**：工单完工才算收入，没做完不产生应收；
 *   商业合作收入 —— **合同年化**：(合同金额 − 公共收益) ÷ 期间月数 × 12，再乘当年覆盖月数 ÷ 12。
 *
 * 页面只拿结果，不再自己遍历工单与合同 —— 否则三个页面会算出三个数。
 */
import { IS_MOCK, get } from '@/api/client'
import * as mock from '@/utils/api'

export const multiRevenue = (filters = {}) =>
  IS_MOCK ? mock.multiRevenue(filters) : get('/reports/multi-revenue', filters)

export const multiRevenueMonthly = (filters = {}, months = 12) =>
  IS_MOCK ? mock.multiRevenueMonthly(filters, months) : get('/reports/multi-revenue/monthly', { ...filters, months })

export const multiRevenueByProject = (filters = {}) =>
  IS_MOCK ? mock.multiRevenueByProject(filters) : get('/reports/multi-revenue/by-project', filters)

/** 公司收入结构（主营 + 多种经营），只用来算"多种经营占几成" */
export const companyRevenue = (filters = {}) =>
  IS_MOCK ? mock.companyRevenue(filters) : get('/reports/company-revenue', filters)

/** 下钻明细：页面上「工单 / 合同」两个表直接读这两个，不再各自遍历原始数据 */
export const multiRevenueServiceOrders = (filters = {}) =>
  IS_MOCK ? mock.multiRevenueServiceOrders(filters) : get('/reports/multi-revenue/orders', filters)

export const multiRevenueContracts = (filters = {}) =>
  IS_MOCK ? mock.multiRevenueContracts(filters) : get('/reports/multi-revenue/contracts', filters)

export { canViewMultiRevenue, commercialCooperationRevenue, yearCoverMonths } from '@/utils/api'
