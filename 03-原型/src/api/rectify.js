/**
 * 整改域适配层（契约见《接口层契约.md》· rectify）
 *
 * 口径提醒：
 *   - 提交必须**全部整改项完成**，否则 422；
 *   - 复核：提交人不得自己复核；**退回要把整改项归零重做**（不是只改状态）。
 */
import { IS_MOCK, get, post } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 查询 ---------- */
export const queryRectifyOrders = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK
    ? mock.queryRectifyOrders({ pageNo, size, filters })
    : get('/rectify-orders', { pageNo, size, ...filters })

export const getRectifyDetail = rectifyId =>
  IS_MOCK ? mock.getRectifyDetail(rectifyId) : get(`/rectify-orders/${rectifyId}`)

/* ---------- 写 ---------- */
export const submitRectify = (rectifyId, payload = {}) =>
  IS_MOCK ? mock.submitRectify(rectifyId, payload) : post(`/rectify-orders/${rectifyId}/submit`, payload)

export const recheckRectify = (rectifyId, payload = {}) =>
  IS_MOCK ? mock.recheckRectify(rectifyId, payload) : post(`/rectify-orders/${rectifyId}/recheck`, payload)

/** 改派 / 延期：契约尚未覆盖（属第三批），先走原型实现 */
export const reassignRectify = (rectifyId, payload = {}) => mock.reassignRectify(rectifyId, payload)

/* ---------- 字典 / 统计 ---------- */
export { achievementDeptOpts, RECTIFY_LEVELS, RECTIFY_SOURCES, RECHECK_LIMIT_DAYS, rectifySummary } from '@/utils/api'
