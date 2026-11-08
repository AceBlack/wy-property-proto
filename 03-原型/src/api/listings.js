/**
 * 租售信息适配层 —— 契约见 openapi.yaml 的 `/listings` 段（第 69 批）
 *
 * 口径提醒（后端实现时别丢）：
 *   - **只做信息发布**，不参与撮合与成交。别加「佣金」「成交价」「带看排期」这类字段，
 *     加了性质就变了：从物业服务变成房地产经纪，要《房地产经纪机构备案表》；
 *   - **审核人是该房的责任楼管**（`house.stewardEmpId`），不是"审核员"角色；
 *     24 小时未审升直属上级（按 orgLeaders 解析，不写死角色名）；
 *   - **楼管手机号不得出现在任何返回里**：对外只给姓名、微信号、二维码。
 *     访客要联系就留自己的号码，楼管回拨 —— 方向反过来，要保护的是访客的号码；
 *   - 面积 / 户型 / 朝向 / 楼层**从 house 派生**，不要落库；
 *   - 审核只针对「内容版本」：`contentVersion !== auditedVersion` 才需要再审，
 *     原样续挂、原样重新上架直接回「已发布」。
 */
import * as mock from '@/utils/api'
import { get, post, patch } from './client'

const IS_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

/* ---------- 挂牌 ---------- */
export const queryListings = (opt = {}) =>
  (IS_MOCK ? mock.queryListings(opt) : get('/listings', opt))

export const listingStats = () =>
  (IS_MOCK ? mock.listingStats() : get('/listings/stats'))

/** 数据范围说明（楼管看到的是「责任范围 · 负责 N 套」） */
export const listingScopeHint = () =>
  (IS_MOCK ? mock.listingScopeHint() : get('/listings/scope-hint'))

export const getListing = listingId =>
  (IS_MOCK ? mock.getListing(listingId) : get(`/listings/${listingId}`))

/** 通过 / 驳回（驳回必填理由，业主看得到） */
export const auditListing = (listingId, body = {}) =>
  (IS_MOCK ? mock.auditListing(listingId, body) : post(`/listings/${listingId}/audit`, body))

export const offlineListing = (listingId, reason = '') =>
  (IS_MOCK ? mock.offlineListing(listingId, reason) : post(`/listings/${listingId}/offline`, { reason }))

/** 改派的是「房源」的责任楼管，不是单条请求 —— 审核权与联系方式都挂在这个人身上 */
export const reassignListing = (listingId, empId) =>
  (IS_MOCK ? mock.reassignListing(listingId, empId) : patch(`/listings/${listingId}/steward`, { empId }))

export const listingStewardOpts = () =>
  (IS_MOCK ? mock.listingStewardOpts() : get('/listings/steward-options'))

/* ---------- 看房请求 ---------- */
export const queryViewings = (opt = {}) =>
  (IS_MOCK ? mock.queryViewings(opt) : get('/listings/viewings', opt))

export const viewingStats = () =>
  (IS_MOCK ? mock.viewingStats() : get('/listings/viewings/stats'))

export const getViewing = viewingId =>
  (IS_MOCK ? mock.getViewing(viewingId) : get(`/listings/viewings/${viewingId}`))

/**
 * 标记看房请求已联系 / 已关闭（必写结果）。
 * PC 端不做这个动作 —— 那是「谁超时了」的监控页；真正回电话在手机上，
 * 两边调同一个函数，时间线与经办人才对得上。
 */
export const markViewingContacted = (viewingId, body = {}) =>
  (IS_MOCK ? mock.markViewingContacted(viewingId, body) : post(`/listings/viewings/${viewingId}/contact`, body))

/* ---------- 我的对外联系方式（本人自助，无权限码） ---------- */

export const myContact = (empId = '') =>
  (IS_MOCK ? mock.myContact(empId) : get('/listings/my-contact', empId ? { empId } : {}))

export const updateMyContact = (body = {}, empId = '') =>
  (IS_MOCK ? mock.updateMyContact(body, empId) : patch('/listings/my-contact', { ...body, ...(empId ? { empId } : {}) }))

/* ---------- 字典与权限 ---------- */
export {
  LISTING_STATUS, LISTING_DECORATE, LISTING_PAY_TERM, LISTING_FACILITIES, VIEWING_STATUS,
  canViewListings, canAuditListings, canViewListingsViewing
} from '@/utils/api'
