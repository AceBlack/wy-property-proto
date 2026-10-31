/**
 * 工单域适配层（契约见《接口层契约.md》三、F 域 · 工单）
 */
import { IS_MOCK, get, patch, post } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 查询 ---------- */
export const queryWorkOrders = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK
    ? mock.queryWorkOrders({ pageNo, size, filters })
    : get('/work-orders', { pageNo, size, ...filters })

export const woScopeSummary = filters =>
  IS_MOCK ? mock.woScopeSummary(filters) : get('/work-orders/summary', filters)

export const getWorkOrder = woId =>
  IS_MOCK ? mock.getWorkOrder(woId) : get(`/work-orders/${woId}`)

/* 工单域字典（跨域共用的字典在 shared.js） */
export { WO_PRIORITY_OPTS } from '@/utils/api'

export const woVirtualNodes = () => mock.woVirtualNodes()
export const woQuerySummary = () => mock.woQuerySummary()

/* ---------- 写 ---------- */
export const createWorkOrder = payload =>
  IS_MOCK ? mock.createWorkOrder(payload) : post('/work-orders', payload)

export const updateWorkOrderField = (woId, field, value, ver) =>
  IS_MOCK
    ? mock.updateWorkOrderField(woId, field, value, ver)
    : patch(`/work-orders/${woId}`, { field, value, ver })

export const batchUpdateWorkOrders = (woIds, patchData, opt) =>
  IS_MOCK
    ? mock.batchUpdateWorkOrders(woIds, patchData, opt)
    : post('/work-orders/batch', { woIds, patch: patchData, ...(opt || {}) })

/* ---------- SLA ----------
 * mock 模式下 SLA 倒计时在前端按工作日历算；
 * 接后端后这个字段由服务端下发（`slaDueAt / slaLeftHours / slaBreached`），
 * 前端只负责展示，避免两边算法不一致。 */
export const woSlaState = wo =>
  IS_MOCK ? mock.woSlaState(wo) : wo.slaState || null
