/**
 * 租售信息（移动端）
 *
 * 只做三件事：审挂牌、回看房电话、维护自己的联系方式。
 * 发布 / 下架 / 改派 / 导出全部留在 PC —— 这里连函数都不 import，
 * 免得哪天有人顺手把「下架」按钮加进来。
 *
 * 两条与 PC 不同的取数口径：
 *   ① **读固定切到「全部项目」**。PC 的 `_lvScopedListings()` 对「本部门 / 责任范围」
 *      是按 communities / houseIds 收敛的，而这两个集合在员工端经常是空的
 *      （当前 PC 角色未必是登录的这个人，楼管的责任范围又是按 `currentOperator()` 推的），
 *      结果就是列表一条不剩、页面显示"暂无待办"。
 *      所以读统一用 R-GM 取全量，再按 `communityId` + `stewardEmpId` 自己收 —— 不比 PC 宽。
 *      —— 这跟邻居读接口踩过的坑同源，只是那边靠"不切"，这边靠"切到全量"。
 *   ② **写要切到登录人的角色**。PC 的写函数走 `_hasPerm()`，读的是 PC 侧当前角色；
 *      不切就是"用总经理的身份办楼管的活"，经办人会记错人。
 */
import {
  auditListing as pcAuditListing,
  getListing,
  getViewing,
  markViewingContacted,
  myContact,
  queryListings,
  queryViewings,
  updateMyContact
} from '@pc/utils/api'
import { withRole, withRoleOf } from './neighbor'

/**
 * 「已等 6 小时」这种话比时间戳有用：看房这条线靠的就是等多久。
 * 48 小时以内**一律按小时说** —— "已等 1 天"读起来像"还好"，
 * 而"已等 30 小时"才是真的刺眼，这正是这一页要的效果。
 */
export function waitText(hours) {
  const h = Math.max(0, Number(hours) || 0)
  if (h < 1) return '刚刚'
  if (h < 48) return `已等 ${h} 小时`
  return `已等 ${Math.floor(h / 24)} 天`
}

/** 超 24h 标红（§12.4 的"生命线"），12h 起提醒 */
export function waitTone(row) {
  if (row?.overdue) return 'is-bad'
  return (Number(row?.hoursWaiting) || 0) >= 12 ? 'is-warn' : ''
}

/**
 * 一条挂牌归不归这个人管。
 * 楼管按「责任楼管」收敛（不是按项目）—— 他管的是几栋楼，不是整个项目；
 * 其余角色按本项目。
 */
function mine(row, p) {
  if (!p) return false
  if (row.communityId !== p.communityId) return false
  if (p.roleId === 'R-STW') return row.stewardEmpId === p.empId
  return true
}

/* ---------- 审核队列 ---------- */

/**
 * 待审房源。与邻里的闲置**合并成一个队列**（§12.3），
 * 但条目按权限过滤：客服没有 `a.listings.audit`，只看到闲置；
 * 楼管没有 `n.items.audit`，只看到房源。
 */
export async function listingAuditQueueOf(personaLike) {
  /* 读用「全部项目」取全量，再自己按项目 / 责任楼管收 —— 见 withRoleOf 的注释 */
  const r = await withRoleOf('R-GM', () => queryListings({ size: 100, filters: { status: '待审核' } }))
  return r.rows
    .filter(row => mine(row, personaLike))
    .map(row => ({ ...row, wait: waitText(row.hoursWaiting), tone: row.overdue ? 'is-bad' : '' }))
}

export function listingOf(listingId) {
  return withRoleOf('R-GM', () => getListing(listingId))
}

export function audit(personaLike, listingId, { pass, reason = '' } = {}) {
  return withRole(() => pcAuditListing(listingId, { pass, reason }))
}

/* ---------- 看房请求 ---------- */

export async function viewingsOf(personaLike, { status = '待联系' } = {}) {
  const r = await withRoleOf('R-GM', () => queryViewings({ size: 100, filters: { status } }))
  return r.rows
    .filter(row => mine(row, personaLike))
    .map(row => ({ ...row, wait: waitText(row.hoursWaiting), tone: waitTone(row) }))
}

export function viewingOf(viewingId) {
  return withRoleOf('R-GM', () => getViewing(viewingId))
}

/**
 * 标记已联系 / 已关闭。
 * `note` 必填写在数据层（PC 也会拦）—— 下个人接手要知道聊到哪了。
 */
export function contactViewing(personaLike, viewingId, { status = '已联系', note } = {}) {
  return withRole(() => markViewingContacted(viewingId, { status, note, operator: personaLike?.name || '' }))
}

/* ---------- 我的联系方式 ---------- */

/*
 * 写操作不切角色：`updateMyContact` 内部按 `currentOperator()` 判"是不是本人"，
 * 切到楼管角色后 `currentOperator()` 会按岗位名找第一个人（可能是别的楼管），
 * 反而判成"改他人"。所以固定用宿主角色 + 显式传自己的 empId ——
 * 界面只会传登录人自己的 empId，这一点由调用方保证（见 mine 页）。
 */
export function myContactOf(personaLike) {
  return myContact(personaLike?.empId || '')
}

export function saveMyContact(personaLike, body) {
  return updateMyContact(body, personaLike?.empId || '')
}

/** 工作台卡片：待审房源 + 待联系看房（只算归我的） */
export async function listingCountsOf(personaLike) {
  const [pend, views] = await Promise.all([
    listingAuditQueueOf(personaLike),
    viewingsOf(personaLike)
  ])
  return {
    pending: pend.length,
    viewing: views.length,
    overdue: views.filter(v => v.overdue).length,
    total: pend.length + views.length
  }
}
