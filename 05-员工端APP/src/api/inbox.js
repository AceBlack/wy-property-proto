/**
 * 消息中心的「待办提醒」聚合层。
 *
 * 为什么单独一个文件、而不是塞进消息页
 * ------------------------------------------------------------
 * 待办散在五个域里：工单（`wo.js` 的抢单池 / 我处理中）、巡检（`mobile.js` 的待执行）、
 * 审批（`oa.js` 的待我处理）、邻里（闲置待审 / 举报待处理）、租售（房源待审 / 看房待回）。
 * 消息页要的是"这些事哪些要我动手"，而**什么算待办**的规则已经在各域写死了 ——
 * 这里只做索引，不复述一遍判断。
 *
 * 复述的后果很具体：消息里显示 3 条、进工单页却有 5 条，用户不知道信哪个。
 *
 * 提醒不做"已读"：待办的性质是**处理掉就消失**，不是"看过就算"。
 * 拿公告那套已读逻辑套上来，会出现"读了但没办"的僵尸提醒。
 *
 * 五个来源都必须有：只做工单 / 巡检 / 审批的话，楼管登录后待办是 0 ——
 * 而他的活（欠费催收、房源审核、看房回电）一条都不在里面，等于这功能对一半身份无效。
 */
import { CAP, can } from '@/config/personas'
import { grabPool, myOpen, rowOf as woRow } from './wo'
import { listForTab } from './mobile'
import { listFor as oaList } from './oa'
import { todoOf } from './neighbor'
import { listingAuditQueueOf, viewingsOf } from './listing'

/** 每组最多列几条。超出给一个"还有 N 条"，不把消息页拉成一条无限长列表 */
const MAX_PER_GROUP = 5

/* ------------------------------ 五个来源 ------------------------------ */

function woItems(persona) {
  if (!can(persona, CAP.woView)) return []
  const out = []

  /* ① 可抢的（抢单模式下的付费入户单）：这是"要不要接"的判断，最容易漏 */
  for (const w of grabPool(persona)) {
    const r = woRow(w, persona)
    out.push({
      id: `wo-grab-${r.id}`,
      title: r.title,
      sub: [r.houseName, r.priority === '普通' ? '' : r.priority, r.total ? `¥${r.total}` : '']
        .filter(Boolean)
        .join(' · '),
      tag: '待接单',
      tagTone: r.priority === '特急' ? 'danger' : 'warn',
      at: r.createTime,
      to: `/pages/wo/detail?id=${r.id}`
    })
  }

  /* ② 我处理中**且已超时**的。正常在办的不提醒 —— 那叫工作，不叫待办 */
  for (const w of myOpen(persona)) {
    const r = woRow(w, persona)
    if (!r.slaBreached && !r.isOverdue) continue
    out.push({
      id: `wo-late-${r.id}`,
      title: r.title,
      sub: `${r.houseName} · ${r.slaLeft || '已超受理时限'}`,
      tag: '已超时',
      tagTone: 'danger',
      at: r.createTime,
      to: `/pages/wo/detail?id=${r.id}`
    })
  }
  return out
}

function inspItems(persona) {
  if (!can(persona, CAP.inspView)) return []
  const d = listForTab(persona.name, 'todo')
  /* pinned 是已超时的（置顶），groups 是其余按日期分组的 —— 两段都要，缺一段就漏单 */
  const rows = [...d.pinned, ...d.groups.flatMap(g => g.tasks)]
  return rows.map(r => {
    const late = r.time?.key === 'overdue' || r.status === '逾期'
    return {
      id: `insp-${r.taskId}`,
      title: r.planName,
      sub: `${r.communityName} · ${r.post} · 计划 ${r.scheduledDate} ${r.scheduledTime}`,
      tag: late ? '已超时' : '待执行',
      tagTone: late ? 'danger' : 'info',
      at: `${r.scheduledDate} ${r.scheduledTime}`,
      to: `/pages/tasks/detail?taskId=${r.taskId}`
    }
  })
}

function oaItems(persona) {
  if (!can(persona, CAP.approve)) return []
  return oaList(persona, 'todo').map(r => ({
    id: `oa-${r.id}`,
    title: r.title,
    sub: [r.applicant, r.bizType, r.amount ? `¥${r.amount}` : '', `已等 ${r.waitHours} 小时`]
      .filter(Boolean)
      .join(' · '),
    tag: r.urgency && r.urgency !== '普通' ? r.urgency : '待审批',
    tagTone: r.urgency === '特急' ? 'danger' : r.urgency === '紧急' ? 'warn' : 'info',
    at: r.applyTime,
    to: `/pages/oa/detail?id=${r.id}`
  }))
}

async function neighborItems(persona) {
  const canAudit = can(persona, CAP.neighborItemAudit)
  const canReport = can(persona, CAP.neighborReportHandle)
  if (!canAudit && !canReport) return []

  /* 只取有权限的那一半：没审核权的人不该为了"数一下"去拉待审闲置 */
  const t = await todoOf({ items: canAudit, reports: canReport })
  const out = []

  for (const i of t.items) {
    out.push({
      id: `nb-item-${i.itemId}`,
      title: i.title,
      sub: [i.sellerName, i.buildingName || '', i.price ? `¥${i.price}` : '免费赠送']
        .filter(Boolean)
        .join(' · '),
      tag: '闲置待审',
      tagTone: 'warn',
      at: i.publishAt,
      to: `/pages/neighbor/item?itemId=${i.itemId}`
    })
  }

  for (const r of t.reports) {
    out.push({
      id: `nb-rep-${r.reportId}`,
      title: `${r.reason}举报`,
      sub: r.detail,
      tag: '举报待处理',
      tagTone: 'danger',
      at: r.at,
      to: `/pages/neighbor/report?reportId=${r.reportId}`
    })
  }
  return out
}

async function listingItems(persona) {
  const out = []

  /* 房源待审：有详情页，逐条列 */
  if (can(persona, CAP.listingAudit)) {
    for (const r of await listingAuditQueueOf(persona)) {
      /* 挂牌数据里**没有 title 字段**（房源是「地址 + 价格 + 描述」，不是标题化的内容）。
         原来写成"房源待审"做标题，结果和左边的标签一字不差 —— 用户扫过去等于没读到信息。 */
      const addr = [r.communityName, r.buildingName, r.room].filter(Boolean).join(' ')
      out.push({
        id: `ls-${r.listingId}`,
        title: addr || '房源待审',
        sub: [r.price ? `¥${r.price}` : '', r.wait, r.stewardName].filter(Boolean).join(' · '),
        tag: '房源待审',
        tagTone: r.overdue ? 'danger' : 'warn',
        at: r.createdAt || '',
        to: `/pages/neighbor/listing?listingId=${r.listingId}`
      })
    }
  }

  /* 看房请求：处置是在列表页逐条做的，没有单条详情，所以汇总成一条 ——
     列 5 条一模一样的入口只会把别的待办挤下去 */
  if (can(persona, CAP.listViewing)) {
    const vs = await viewingsOf(persona, { status: '待联系' })
    if (vs.length) {
      const late = vs.filter(v => v.tone === 'is-bad').length
      out.push({
        id: 'ls-viewing',
        title: `${vs.length} 条看房请求待回电`,
        sub: late ? `其中 ${late} 条已超过 24 小时` : '都在 24 小时内，记得回',
        tag: late ? '已超时' : '待回电',
        tagTone: late ? 'danger' : 'info',
        at: vs[0]?.wait || '',
        to: '/pages/listing/viewing'
      })
    }
  }
  return out
}

/* ------------------------------ 对外 ------------------------------ */

/**
 * 待办提醒汇总（异步：邻里与租售的取数本来就是 async）。
 * 返回 `{ total, groups }`，`groups` 只含**有内容**的组 —— 空组会让消息页出现一堆空标题。
 */
export async function remindersOf(persona) {
  if (!persona) return { total: 0, groups: [] }

  /* 五个来源并行取，串行会在弱网下把首屏拖成 1 秒以上 */
  const [wo, insp, oa, nb, ls] = await Promise.all([
    Promise.resolve(woItems(persona)),
    Promise.resolve(inspItems(persona)),
    Promise.resolve(oaItems(persona)),
    neighborItems(persona).catch(() => []),
    listingItems(persona).catch(() => [])
  ])

  const raw = [
    { key: 'wo', label: '工单', tone: 'info', items: wo },
    { key: 'insp', label: '巡检', tone: 'ok', items: insp },
    { key: 'oa', label: '审批', tone: 'warn', items: oa },
    { key: 'nb', label: '邻里', tone: 'warn', items: nb },
    { key: 'ls', label: '租售', tone: 'info', items: ls }
  ].filter(g => g.items.length)

  const groups = raw.map(g => ({
    ...g,
    count: g.items.length,
    more: Math.max(0, g.items.length - MAX_PER_GROUP),
    items: g.items.slice(0, MAX_PER_GROUP)
  }))

  return { total: raw.reduce((s, g) => s + g.items.length, 0), groups }
}

/** 各组的色调（页面按这个给左边条上色） */
export const REMIND_TONE = {
  wo: 'info',
  insp: 'ok',
  oa: 'warn',
  nb: 'warn',
  ls: 'info'
}
