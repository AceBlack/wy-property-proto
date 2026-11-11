/**
 * 邻里（移动端）
 *
 * 只管"离开手机做不了"的四件事：审闲置、处理举报、看活动、代客报名。
 * 业务规则（名额、退款分档、投保必填）全部调 `@pc/utils/api`，这里不复制一份 ——
 * 复制的后果是 PC 改一档退款比例，手机上还按老比例算。
 *
 * 两条过滤口径（数字和 PC 对不上是正常的）：
 *   ① 按登录人 `communityId` 过滤。手机上待审 3 + 待处理 2，PC 全公司 8 + 4，差的是数据范围；
 *   ② 活动只列「报名中 / 待成行 / 已成行」——草稿、已流团、已结束不该出现在现场作业里。
 *
 * 所有 PC 调用都过 `pc` 代理：它按登录人角色切一次再还原。原因有两个：
 *   · PC 的函数用 `_hasPerm()` 校验，读的是 PC 侧当前角色（员工端默认集团总经理），
 *     而集团总经理**没有** `n.activities.enroll`，不切就代报名 403；
 *   · `auditBy / handledBy / operator` 会记成 PC 角色对应的人，不是手机上这个人。
 */
import {
  auditItem,
  cancelEnroll,
  checkinEnroll,
  enrollActivity,
  getActivity,
  getItem,
  handleReport,
  offlineItem,
  queryActivities,
  queryEnrolls,
  queryItems,
  queryReports,
  refundEnroll,
  refundRatioOf
} from '@pc/utils/api'
import { currentRoleId, setRole } from '@pc/utils/auth'
import { IS_API, get, loginAs, post } from './client'
import { persona } from '@/store/app'

/** 按登录人角色执行；同步/异步都还原（租售域也复用它，别再抄一份） */
export function withRole(fn) {
  const prev = currentRoleId.value
  const want = persona.value?.roleId || prev
  if (!want || want === prev) return fn()
  setRole(want)
  try {
    const r = fn()
    if (r && typeof r.then === 'function') return r.finally(() => setRole(prev))
    setRole(prev)
    return r
  } catch (e) {
    setRole(prev)
    throw e
  }
}

/**
 * 用**指定**角色执行，用来拿"全部项目"的全量数据。
 *
 * 为什么需要：PC 的租售读接口会按当前角色收敛数据范围，而 `currentScope()`
 * 对「本部门 / 责任范围」这两个模式是靠 `communities` / `houseIds` 算的 ——
 * 这两个集合在员工端经常是空的（部门经理没有固定项目、楼管的责任范围按
 * `currentOperator()` 推出来的人算，未必是当前登录的这位）。
 * 结果就是列表一条不剩、页面显示"暂无待办"。
 *
 * 所以读统一用集团总经理（全部项目）取全量，再按 `persona` 自己过滤 ——
 * 过滤条件在 `listing.js` 的 `mine()` 里，不比 PC 宽。
 */
export function withRoleOf(roleId, fn) {
  const prev = currentRoleId.value
  if (!roleId || roleId === prev) return fn()
  setRole(roleId)
  try {
    const r = fn()
    if (r && typeof r.then === 'function') return r.finally(() => setRole(prev))
    setRole(prev)
    return r
  } catch (e) {
    setRole(prev)
    throw e
  }
}

/*
 * 只有「代报名 / 取消 / 退款 / 签到」四个写操作切角色，其余读取不切。
 *
 * 原因：切到 persona 角色会连带套用它的**数据范围** —— 汪磊是「本部门」，
 * 读活动时 `assertInScope(P01)` 会直接报"超出当前数据范围"，列表变空。
 * 而这四个写操作不校验数据范围，只校验 `n.activities.enroll`（集团总经理没有这个码），
 * 所以只在它们身上切，且把经办人显式传进去。
 */

/** 演示基准日：与 mock 同一口径，用来算"已等多久" */
const NOW = new Date('2026/10/21 10:00')

const cid = () => persona.value?.communityId || 'P01'
const toDate = t => (t ? new Date(String(t).replace(/-/g, '/')) : null)

export function waitText(at) {
  const d = toDate(at)
  if (!d || Number.isNaN(d.getTime())) return ''
  const h = Math.max(0, Math.round((NOW - d) / 3600000))
  if (h < 1) return '刚刚'
  if (h < 24) return `已等 ${h} 小时`
  return `已等 ${Math.floor(h / 24)} 天`
}

export function waitTone(at) {
  const d = toDate(at)
  if (!d) return ''
  const h = (NOW - d) / 3600000
  return h >= 48 ? 'is-bad' : h >= 24 ? 'is-warn' : ''
}

/** 「P01-003-0602」→「003 栋」：审核要判断内容是否合规，不需要知道具体门牌 */
export function buildingOf(houseCode) {
  const parts = String(houseCode || '').split('-')
  return parts.length >= 2 ? `${parts[1]} 栋` : ''
}

/* ---------- 待办 ---------- */

/**
 * 待办两段：待审核（闲置，事前把关）/ 待处理（举报，事后处置）。
 * 刻意不合并：一个是"能不能发"，一个是"发了之后怎么办"，判断依据和留痕要求都不同。
 */
export async function todoOf({ items = true, reports = true } = {}) {
  const out = { items: [], reports: [], counts: { items: 0, reports: 0, total: 0 } }

  /*
   * HTTP 模式：PC 的 `/neighbor/items` 与 `/neighbor/reports` 本来就是给
   * "待审队列"设计的（待审永远排最前），不用再造一层 `/mobile/*`。
   * 两层过滤要补上：① 按登录人项目；② 只取待审/待处理。
   */
  if (IS_API) {
    if (persona.value?.id) await loginAs(persona.value.id)
    if (items) {
      const r = await get(`/neighbor/items?status=${encodeURIComponent('待审核')}&size=100&communityId=${cid()}`)
      out.items = (r.rows || []).map(x => ({ ...x, building: buildingOf(x.sellerHouse), wait: waitText(x.publishAt) }))
      out.counts.items = r.total || out.items.length
    }
    if (reports) {
      const r = await get(`/neighbor/reports?status=${encodeURIComponent('待处理')}&size=100`)
      out.reports = (r.rows || [])
        .filter(x => !x.communityId || x.communityId === cid())
        .map(x => ({ ...x, building: buildingOf(x.reporterHouse), wait: waitText(x.at) }))
      out.counts.reports = out.reports.length
    }
    out.counts.total = out.counts.items + out.counts.reports
    return out
  }
  if (items) {
    const r = await queryItems({ size: 100, filters: { communityId: cid(), status: '待审核' } })
    out.items = r.rows
    out.counts.items = r.total
  }
  if (reports) {
    const r = await queryReports({ size: 100, filters: { status: '待处理' } })
    out.reports = r.rows.filter(x => !x.communityId || x.communityId === cid())
    out.counts.reports = out.reports.length
  }
  out.counts.total = out.counts.items + out.counts.reports
  return out
}
/* 原来这里有个 todoCount()：它不分权限地把两类都数一遍，楼管会看到一个"点不动的数字"。
   工作台现在按「能办的」自己算（见 home/index.vue 的 loadNeighbor），所以删掉。 */

/* ---------- 闲置审核 ---------- */

export async function itemOf(itemId) {
  if (IS_API) {
    if (persona.value?.id) await loginAs(persona.value.id)
    const r = await get(`/neighbor/items/${itemId}`)
    return { ...r, building: buildingOf(r.sellerHouse), wait: waitText(r.publishAt) }
  }
  const i = await getItem(itemId)
  if (!i) return null
  return { ...i, building: buildingOf(i.sellerHouse), wait: waitText(i.publishAt) }
}

export async function audit(personaLike, itemId, { pass, reason = '' } = {}) {
  if (IS_API) {
    if (personaLike?.id) await loginAs(personaLike.id)
    /* 驳回不写理由服务端会拒 —— 前端先拦一次，省得填完一屏再弹错 */
    if (!pass && !String(reason || '').trim()) throw new Error('驳回要写理由，业主会拿着通知来问')
    return post(`/neighbor/items/${itemId}/audit`, { pass, reason: String(reason || '').trim() })
  }
  return auditItem(itemId, { pass, reason, operator: personaLike?.name || '' })
}

export async function offline(personaLike, itemId, reason) {
  if (IS_API) {
    if (personaLike?.id) await loginAs(personaLike.id)
    return post(`/neighbor/items/${itemId}/offline`, { reason: String(reason || '').trim() })
  }
  return offlineItem(itemId, reason, personaLike?.name || '')
}

/* ---------- 举报处理 ---------- */

export async function reportOf(reportId) {
  if (IS_API) {
    if (persona.value?.id) await loginAs(persona.value.id)
    const r = await get(`/neighbor/reports/${reportId}`)
    return { ...r, building: buildingOf(r.reporterHouse), wait: waitText(r.at) }
  }
  const r = await queryReports({ size: 200, filters: { status: '待处理' } })
  const hit = r.rows.find(x => x.reportId === reportId)
  if (!hit) {
    const all = await queryReports({ size: 200 })
    const any = all.rows.find(x => x.reportId === reportId)
    return any ? { ...any, building: buildingOf(any.reporterHouse), wait: waitText(any.at) } : null
  }
  return { ...hit, building: buildingOf(hit.reporterHouse), wait: waitText(hit.at) }
}

export async function handle(personaLike, reportId, { action, note }) {
  if (IS_API) {
    if (personaLike?.id) await loginAs(personaLike.id)
    /* 处理说明必填 —— 事后要能解释为什么这么判 */
    if (!String(note || '').trim()) throw new Error('处理说明必填，事后要能解释为什么这么判')
    return post(`/neighbor/reports/${reportId}/handle`, { action, note: String(note).trim() })
  }
  return handleReport(reportId, { action, note, operator: personaLike?.name || '' })
}

/* ---------- 活动 ---------- */

const SHOW_PHASES = ['报名中', '待成行', '已成行']
const PHASE_ORDER = { 报名中: 0, 待成行: 1, 已成行: 2 }

export async function activitiesOf() {
  if (IS_API) {
    if (persona.value?.id) await loginAs(persona.value.id)
    /* 阶段过滤留在这边：接口只按社区收敛，'报名中/待成行/已成行' 是移动端的展示口径 */
    const r = await get(`/neighbor/activities?communityId=${cid()}&size=100`)
    return (r.rows || [])
      .filter(a => SHOW_PHASES.includes(a.phase))
      .sort(
        (a, b) =>
          PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] ||
          String(a.startAt).localeCompare(String(b.startAt))
      )
  }
  const r = await queryActivities({ size: 100, filters: { communityId: cid() } })
  return r.rows
    .filter(a => SHOW_PHASES.includes(a.phase))
    .sort(
      (a, b) =>
        PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] ||
        String(a.startAt).localeCompare(String(b.startAt))
    )
}

export async function activityOf(activityId) {
  if (IS_API) {
    if (persona.value?.id) await loginAs(persona.value.id)
    return get(`/neighbor/activities/${activityId}`)
  }
  return getActivity(activityId)
}

export async function enrollsOf(activityId) {
  if (IS_API) {
    if (persona.value?.id) await loginAs(persona.value.id)
    const r = await get(`/neighbor/activities/${activityId}/enrolls?size=100`)  /* size 上限 100，传 200 会 400 */
    return r.rows || []
  }
  const r = await queryEnrolls({ activityId, size: 200 })
  return r.rows
}

/**
 * 代报名。`paid` 勾了记「已支付」（现场代收），不勾记「待支付」。
 * 见证件号必填——要投保的活动，只有联系人买不了保险。
 */
export async function enroll(personaLike, activityId, body) {
  if (IS_API) {
    if (personaLike?.id) await loginAs(personaLike.id)
    return post(`/neighbor/activities/${activityId}/enroll`, {
      ...body,
      paymentMethod: body.paid ? body.paymentMethod || '现金' : ''
    })
  }
  return withRole(() =>
    enrollActivity(activityId, {
      ...body,
      operator: personaLike?.name || '',
      paymentMethod: body.paid ? body.paymentMethod || '现金' : ''
    })
  )
}

export async function cancel(personaLike, enrollId, reason) {
  if (IS_API) {
    if (personaLike?.id) await loginAs(personaLike.id)
    return post(`/neighbor/enrolls/${enrollId}/cancel`, { reason: String(reason || '') })
  }
  return withRole(() => cancelEnroll(enrollId, reason, personaLike?.name || ''))
}

export async function refund(personaLike, enrollId, reason) {
  if (IS_API) {
    if (personaLike?.id) await loginAs(personaLike.id)
    return post(`/neighbor/enrolls/${enrollId}/refund`, { reason: String(reason || '') })
  }
  return withRole(() => refundEnroll(enrollId, reason, personaLike?.name || ''))
}

export async function checkin(personaLike, enrollId) {
  if (IS_API) {
    if (personaLike?.id) await loginAs(personaLike.id)
    return post(`/neighbor/enrolls/${enrollId}/checkin`, {})
  }
  return withRole(() => checkinEnroll(enrollId, personaLike?.name || ''))
}

/** 退款预览：比例来自分档，页面不许自己算 */
export async function refundPreview(activity, atDay) {
  /*
   * 退款比例必须问服务端：档位配置在活动上（`refundPolicy`），
   * 前端自己按规则算一份，改一档比例就会出现"页面显示退 50%、实际退 30%"。
   */
  if (IS_API) {
    if (persona.value?.id) await loginAs(persona.value.id)
    const d = await get(`/neighbor/activities/${activity.activityId}/refund-ratio${atDay ? `?atDay=${encodeURIComponent(atDay)}` : ''}`)
    const ratio = typeof d === 'number' ? d : (d?.ratio ?? 0)
    return { ratio, amount: Math.round(Number(activity.fee) * ratio) / 100 }
  }
  const ratio = refundRatioOf(activity.activityId, atDay)
  return { ratio, amount: Math.round(Number(activity.fee) * ratio) / 100 }
}

/** 同一手机号重复报名：现场两个人同时办会重复，必须提示而不是静默加一条 */
export function duplicateOf(enrolls, phone) {
  const p = String(phone || '').trim()
  if (!p) return null
  return enrolls.find(e => e.phone === p && !['已取消', '已退款'].includes(e.status)) || null
}
