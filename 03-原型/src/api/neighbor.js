/**
 * 邻里运营适配层 —— 契约见 openapi.yaml 的 `/neighbor` 段（第 68 批）
 *
 * 口径提醒（后端实现时别丢）：
 *   - **公告复用 `/notices`**，不另建一套。这里不提供公告接口，
 *     否则运营要在两个地方发同一条通知，阅读数还对不上；
 *   - **投票只做意见征询**：`voteResult` 刻意不返回「是否通过」。
 *     一旦给出结论，它就会被当成《民法典》278 条的业主大会决议来主张 ——
 *     而表决要人数 + 专有部分面积双过半、要公示期、要出纸质票，小程序替代不了票箱；
 *   - **投票开始后题目与选项都不可变**：已投出的票会指向不存在的选项，改完合计对不上。
 *     接口要拦，不能只靠前端灰按钮；
 *   - **收费活动的「待成行」是独立状态**，不是"报名中"也不是"已结束"。
 *     它是唯一能触发批量全额退款的入口（`confirmFlow`）；
 *   - **退款按分档算**（`refundRatioOf`）：距开始天数 → 比例。比例写死在活动上，
 *     不写死在代码里 —— 每场活动的成本结构不一样；
 *   - **闲置先审后发**，驳回必须写理由；下架同理。业主会拿着通知来问「为什么」；
 *   - **身份证号只用于投保**：`needInsurance=false` 的活动不收集证件号。
 *     活动结束后应做脱敏，接口侧别把明文原样吐给列表页。
 */
import * as mock from '@/utils/api'
import { get, post, patch, del } from './client'

const IS_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

/* ---------- 工作台 ---------- */
export const neighborSummary = () =>
  (IS_MOCK ? mock.neighborSummary() : get('/neighbor/summary'))

/* ---------- 投票 ---------- */
export const queryVotes = (opt = {}) =>
  (IS_MOCK ? mock.queryVotes(opt) : get('/neighbor/votes', opt))

export const voteStats = () =>
  (IS_MOCK ? mock.voteStats() : get('/neighbor/votes/stats'))

export const getVote = voteId =>
  (IS_MOCK ? mock.getVote(voteId) : get(`/neighbor/votes/${voteId}`))

/** 结果聚合：只给参与率与分布，不给「是否通过」 */
export const voteResult = voteId =>
  (IS_MOCK ? mock.voteResult(voteId) : get(`/neighbor/votes/${voteId}/result`))

export const saveVote = (body = {}, voteId = '') =>
  (IS_MOCK
    ? mock.saveVote(body, voteId)
    : (voteId ? patch(`/neighbor/votes/${voteId}`, body) : post('/neighbor/votes', body)))

export const publishVote = voteId =>
  (IS_MOCK ? mock.publishVote(voteId) : post(`/neighbor/votes/${voteId}/publish`))

export const endVote = voteId =>
  (IS_MOCK ? mock.endVote(voteId) : post(`/neighbor/votes/${voteId}/end`))

export const deleteVote = voteId =>
  (IS_MOCK ? mock.deleteVote(voteId) : del(`/neighbor/votes/${voteId}`))

/* ---------- 活动 ---------- */
export const queryActivities = (opt = {}) =>
  (IS_MOCK ? mock.queryActivities(opt) : get('/neighbor/activities', opt))

export const activityStats = () =>
  (IS_MOCK ? mock.activityStats() : get('/neighbor/activities/stats'))

export const getActivity = activityId =>
  (IS_MOCK ? mock.getActivity(activityId) : get(`/neighbor/activities/${activityId}`))

export const activityOpts = () =>
  (IS_MOCK ? mock.activityOpts() : get('/neighbor/activities/options'))

export const saveActivity = (body = {}, activityId = '') =>
  (IS_MOCK
    ? mock.saveActivity(body, activityId)
    : (activityId ? patch(`/neighbor/activities/${activityId}`, body) : post('/neighbor/activities', body)))

export const publishActivity = activityId =>
  (IS_MOCK ? mock.publishActivity(activityId) : post(`/neighbor/activities/${activityId}/publish`))

export const endActivity = activityId =>
  (IS_MOCK ? mock.endActivity(activityId) : post(`/neighbor/activities/${activityId}/end`))

/** 确认流团：未达下限 → 全额退款（唯一出口） */
export const confirmFlow = (activityId, reason = '') =>
  (IS_MOCK
    ? mock.confirmFlow(activityId, reason)
    : post(`/neighbor/activities/${activityId}/flow`, { reason }))

/* ---------- 报名名单 ---------- */
/**
 * 报名名单挂在活动下面，不是全局资源 —— 契约里只有
 * `/neighbor/activities/{activityId}/enrolls`，没有 `/neighbor/enrollments` 这个列表。
 * （这里原来写的是后者，因为原型一直跑 mock 分支，直到补契约才暴露。）
 */
export const queryEnrolls = (opt = {}) => {
  if (IS_MOCK) return mock.queryEnrolls(opt)
  if (!opt.activityId) throw new Error('查报名名单必须指定 activityId')
  return get(`/neighbor/activities/${opt.activityId}/enrolls`, opt)
}

export const enrollStats = activityId =>
  (IS_MOCK ? mock.enrollStats(activityId) : get(`/neighbor/activities/${activityId}/enrolls/stats`))

export const enrollActivity = (activityId, body = {}) =>
  (IS_MOCK
    ? mock.enrollActivity(activityId, body)
    : post(`/neighbor/activities/${activityId}/enroll`, body))

export const cancelEnroll = (enrollId, reason = '') =>
  (IS_MOCK
    ? mock.cancelEnroll(enrollId, reason)
    : post(`/neighbor/enrolls/${enrollId}/cancel`, { reason }))

/** 按分档退款：返回 { enroll, ratio, full, amount } */
export const refundEnroll = (enrollId, reason = '') =>
  (IS_MOCK
    ? mock.refundEnroll(enrollId, reason)
    : post(`/neighbor/enrolls/${enrollId}/refund`, { reason }))

export const checkinEnroll = enrollId =>
  (IS_MOCK ? mock.checkinEnroll(enrollId) : post(`/neighbor/enrolls/${enrollId}/checkin`))

export const refundRatioOf = (activityId, atDay) =>
  (IS_MOCK ? mock.refundRatioOf(activityId, atDay) : get(`/neighbor/activities/${activityId}/refund-ratio`))

/* ---------- 闲置 ---------- */
export const queryItems = (opt = {}) =>
  (IS_MOCK ? mock.queryItems(opt) : get('/neighbor/items', opt))

export const itemStats = () =>
  (IS_MOCK ? mock.itemStats() : get('/neighbor/items/stats'))

export const getItem = itemId =>
  (IS_MOCK ? mock.getItem(itemId) : get(`/neighbor/items/${itemId}`))

export const itemCategories = () =>
  (IS_MOCK ? mock.itemCategories() : get('/neighbor/items/categories'))

export const auditItem = (itemId, body = {}) =>
  (IS_MOCK ? mock.auditItem(itemId, body) : post(`/neighbor/items/${itemId}/audit`, body))

export const offlineItem = (itemId, reason = '') =>
  (IS_MOCK ? mock.offlineItem(itemId, reason) : post(`/neighbor/items/${itemId}/offline`, { reason }))

/* ---------- 举报 ---------- */
export const queryReports = (opt = {}) =>
  (IS_MOCK ? mock.queryReports(opt) : get('/neighbor/reports', opt))

export const reportStats = () =>
  (IS_MOCK ? mock.reportStats() : get('/neighbor/reports/stats'))

export const handleReport = (reportId, body = {}) =>
  (IS_MOCK ? mock.handleReport(reportId, body) : post(`/neighbor/reports/${reportId}/handle`, body))

/* ---------- 字典与权限 ---------- */
export {
  VOTE_TYPES, VOTE_STATUS, ACTIVITY_CATEGORIES, ACTIVITY_PHASES,
  ITEM_STATUSES, REPORT_REASONS, REPORT_ACTIONS,
  canViewNeighborWorkbench, canViewVotes, canEditVotes,
  canViewActivities, canEditActivities, canEnrollActivities, canViewItems, canAuditItems,
  canViewReports, canHandleReports
} from '@/utils/api'
