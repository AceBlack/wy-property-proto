/**
 * 公告域适配层 · 契约见 openapi.yaml 的 `notices` 域
 *
 * 状态机是**单向**的：草稿 → 待审核 → 已发布 → 已过期；已发布可撤回，撤回后要重新提交审核。
 * 两条硬约束（接口侧也拦，不只靠前端灰按钮）：
 *  ① 已发布不能改内容——业主已经看过了，改了等于篡改留痕（要改先撤回）；
 *  ② 已发布 / 已过期不能再发布——重复点，业主会收到两条一样的推送，然后打客服问"到底停不停水"。
 */
import { IS_MOCK, get, patch, post } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 查询 ---------- */
export const queryNotices = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK
    ? mock.queryNotices({ pageNo, size, filters })
    : get('/notices', { pageNo, size, ...(filters || {}) })

export const noticeSummary = () =>
  IS_MOCK ? mock.noticeSummary() : get('/notices/summary')

export const getNoticeDetail = noticeId =>
  IS_MOCK ? mock.getNoticeDetail(noticeId) : get(`/notices/${noticeId}`)

/* ---------- 写 ---------- */
export const createNotice = payload =>
  IS_MOCK ? mock.createNotice(payload) : post('/notices', payload)

export const updateNotice = (noticeId, payload) =>
  IS_MOCK ? mock.updateNotice(noticeId, payload) : patch(`/notices/${noticeId}`, payload)

/** 发布（草稿 / 待审核 / 已撤回 → 已发布） */
export const publishNotice = noticeId =>
  IS_MOCK ? mock.republishNotice(noticeId, { submitAudit: false }) : post(`/notices/${noticeId}/publish`)

/**
 * 重发。页面语义：`submitAudit=true` 是"重新提交审核"（→ 待审核），false 是直发（→ 已发布）。
 * 契约已拆成两个动作：`/submit-audit` 与 `/publish`——提审与发布不是同一个人做的，
 * 合成一个接口的结果是只要点了发布就自动跳过审核，谁审的那栏永远是空的。
 */
export const republishNotice = (noticeId, { submitAudit = true } = {}) =>
  IS_MOCK
    ? mock.republishNotice(noticeId, { submitAudit })
    : post(submitAudit ? `/notices/${noticeId}/submit-audit` : `/notices/${noticeId}/publish`)

/** 补推未读：只推没看过的人，不是"再发一条公告" */
export const repushNotice = noticeId =>
  IS_MOCK ? mock.repushNotice(noticeId) : post(`/notices/${noticeId}/repush`)

export const withdrawNotice = (noticeId, reason = '') =>
  IS_MOCK ? mock.withdrawNotice(noticeId, reason) : post(`/notices/${noticeId}/withdraw`, { reason })

/* ---------- 字典 ---------- */
export {
  NOTICE_CHANNELS, NOTICE_SCOPES, NOTICE_TYPES,
  noticeStatusOpts, noticeTypeOpts, noticeVirtualNodes
} from '@/utils/api'
