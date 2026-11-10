/**
 * 工单（移动端 · 付费入户维修的抢单模型）
 *
 * 口径（2026-11-01 与业主方确认）：
 *   1. **只有付费的入户维修进抢单池**。公区维修一律由后台指派，不走抢单 —— 公区没提成，抢单没有意义。
 *   2. 付费入户单**业主下单时已看到价目并预付**，所以移动端没有"报价"环节；
 *      现场若有增项，师傅在工单上加、业主当面/扫码确认后**合并到同一订单**、后付这一笔。
 *   3. 抢单是并发动作：两个人同时点，只能一个人抢到。接口必须做条件更新
 *      （WHERE status='待派单' AND assignee IS NULL），抢失败返回 409「已被 X 抢走」。
 *      前端不能"点完就当成功"。
 *   4. 抢到后要在项目配置的时限内到场（P01 = 15 分钟），超时算迟到；直接不干要记弃单。
 *   5. 提成只按人工费计提（材料费是成本），**已收款才结**，未收款算在途。
 *
 * 状态机沿用 PC（不新增状态）：
 *   待派单 →（抢单/派单）→ 处理中 →（完工）→ 已完工 → 业主确认/评价 → 已评价
 *   待确认 = 完工但增项等业主确认，计时已停。
 * 已关闭 / 已取消 是终态。
 */
import { workOrders, employees } from '@pc/mock'
import { WO_TYPES, createWorkOrder, woSlaState } from '@pc/utils/api'
import { stamp } from '@/config/personas'
import { addAbandon, addAddon, addonsOf, abandonsOf, claimOf, confirmAddons, dropClaim, linkInspectWo, paysOf, saveClaim, savePay } from '@/store/app'
import { addonFee, commissionOf, projectParam, round2, snapshotOf } from '@/api/pricing'
import { IS_API, get, loginAs, post, patch } from './client'

/* ---------- HTTP 模式下的缓存（与巡检域同一套思路） ---------- */

/*
 * 工单域和巡检不一样：它**必须读写一起切**。
 * 只切读不切写，写操作改的是本地种子、列表读的是接口 ——
 * 用户抢完单回列表发现"还在池子里"。
 *
 * 读用「预加载 + 同步读缓存」，写改成 async（页面 await）：
 * 读函数被 computed 大量调用，改 async 要连模板的重算逻辑一起动；
 * 写函数每页只有一两处，加 await 成本最低。
 */
const LIST_CACHE = { tabs: [], rows: {}, loaded: false }
const DETAIL_CACHE = new Map()

/** 写操作后清缓存：下一次 onShow / refresh 会重新拉，避免"抢了单但列表没变" */
export const invalidateWo = () => {
  LIST_CACHE.loaded = false
  DETAIL_CACHE.clear()
}

export async function loadWorkOrders(persona, tab = 'mine') {
  if (!IS_API) return
  if (persona?.id) await loginAs(persona.id)
  const d = await get(`/mobile/work-orders?tab=${tab}`)
  LIST_CACHE.tabs = d.tabs || []
  LIST_CACHE.rows[tab] = d.rows || []
  LIST_CACHE.loaded = true
}

export async function loadWoDetail(woId, persona) {
  if (!IS_API) return null
  if (persona?.id) await loginAs(persona.id)
  const d = await get(`/mobile/work-orders/${woId}`)
  DETAIL_CACHE.set(woId, d)
  return d
}

const DONE = ['已完工', '已关闭', '已评价']
/** 商业服务 = 付费入户维修（PC 第 47 批把「入户维修」改名为「商业服务」） */
export const PAID_TYPE = '商业服务'
/** 公共区域维修 = 公区设施，不向业主收费、师傅无提成 */
export const PUBLIC_TYPE = '公共区域维修'
const CLOSED = ['已关闭', '已取消', '已评价']
const ORG_OF = new Map(employees.map(e => [e.name, e.orgId]))
const EMP_OF = new Map(employees.map(e => [e.name, e]))

/** 可抢单的岗位：维修工与工程主管。保洁/秩序/客服都不该抢维修单（会抢到不会干的活） */
const GRAB_POSITIONS = ['维修工', '工程主管']
/** 能派单的岗位（叠加 f.wo.dispatch 能力位判断） */
const DISPATCH_POSITIONS = ['客服专员', '客服主管', '项目经理']

export const WO_TONE = {
  待派单: 'var(--biz-warning)',
  已派单: 'var(--biz-primary)',
  处理中: 'var(--biz-ins-doing)',
  待确认: 'var(--biz-warning)',
  已完工: 'var(--biz-accent)',
  已关闭: 'var(--biz-text-3)',
  已评价: 'var(--biz-ins-done)',
  已取消: 'var(--biz-text-4)'
}

export const PRIORITY_TONE = {
  特急: 'var(--biz-danger)',
  紧急: 'var(--biz-warning)',
  普通: 'var(--biz-text-3)'
}

export const PAY_TONE = {
  已支付: 'var(--biz-accent)',
  未支付: 'var(--biz-danger)',
  已挂账: 'var(--biz-warning)',
  无需支付: 'var(--biz-text-3)'
}

/**
 * 派单方式以业务口径为准，不信任数据里的历史值：
 * 早期 mock 把 24 张免费公区单也标成「抢单」，照着显示会出现"公区单可以抢"的错误引导。
 */
export function modeOf(w) {
  if (!w) return ''
  /* 有派单记录就以记录为准（派过之后就不是抢单来的了）；老数据才按口径兜底推导 */
  if (w.dispatchMode) return w.dispatchMode
  return w.type === PAID_TYPE ? '抢单' : '后台指派'
}

/**
 * 抢单资格按**岗位**判，不按员工名册的 position 字面量：
 * 移动端的 persona.post 是「工程维修」（展示用），名册里是「维修工」，
 * 只比字符串会漏掉主角一个人 —— 所以角色 R-ENG 或名册岗位任一命中即可。
 */
export const canGrab = persona =>
  !!persona &&
  (persona.roleId === 'R-ENG' || GRAB_POSITIONS.includes(persona.post || '')) &&
  projectParam(persona.communityId).enabled !== false

export const canDispatch = (persona, w) => {
  if (!persona) return false
  if (!DISPATCH_POSITIONS.includes(persona.post || '')) return false
  /* 付费单只有项目经理能指派（业主点名、或抢单池超时升级）；
     客服与班组长只派公区单 —— 否则派单会直接吃掉师傅的提成，一线会有情绪 */
  if (w && w.type === PAID_TYPE && persona.roleId !== 'R-PM') return false
  return true
}

/* ---------------- 抢单池 ---------------- */

/** 可抢池：付费入户 + 待派单 + 未指派 + 同项目 + 有资格 */
export function grabPool(persona) {
  if (!persona || !canGrab(persona)) return []
  return workOrders
    .filter(
      w =>
        w.communityId === persona.communityId &&
        w.status === '待派单' &&
        !w.assignee &&
        /* 只有商业服务（付费入户）进池：公区维修没提成，抢了就是白干 */
        w.type === PAID_TYPE &&
        w.feeType === '收费' &&
        modeOf(w) === '抢单'
    )
    .sort((a, b) => {
      const p = { 特急: 0, 紧急: 1, 普通: 2 }
      return (p[a.priority] ?? 9) - (p[b.priority] ?? 9) || String(a.createTime).localeCompare(String(b.createTime))
    })
}

/** 待派单（有派单权的人看到的是"要派出去"的池子，不是"要抢"的池子） */
export function dispatchPool(persona) {
  if (!persona) return []
  return workOrders
    .filter(w => w.communityId === persona.communityId && ['待派单', '已派单'].includes(w.status))
    .filter(w => canDispatch(persona, w))
    .sort((a, b) => String(a.createTime).localeCompare(String(b.createTime)))
}

/** 我手上的：已接但没完结 */
export function myOpen(persona) {
  if (!persona) return []
  return workOrders.filter(w => w.assignee === persona.name && !DONE.includes(w.status))
}

export function myDone(persona) {
  if (!persona) return []
  return workOrders
    .filter(w => w.assignee === persona.name && DONE.includes(w.status))
    .sort((a, b) => String(b.finishTime || b.createTime).localeCompare(String(a.finishTime || a.createTime)))
}

/** 保留：原有「本班组可接」的口径（客服/班组长要能看到本班组派出去的单） */
export function poolOf(persona) {
  if (!persona) return []
  return workOrders
    .filter(w => w.communityId === persona.communityId && ['待派单', '已派单'].includes(w.status))
    .filter(w => !w.assignee || ORG_OF.get(w.assignee) === persona.orgId || persona.roleId === 'R-PM')
}

export function tabsFor(persona) {
  /* HTTP 模式：页签与计数来自 /mobile/work-orders 的同一次快照 */
  if (IS_API) return LIST_CACHE.tabs
  const t = []
  if (canGrab(persona)) t.push({ key: 'grab', label: '可抢', count: grabPool(persona).length })
  if (canDispatch(persona)) t.push({ key: 'dispatch', label: '待派', count: dispatchPool(persona).length })
  t.push({ key: 'mine', label: '我的', count: myOpen(persona).length })
  t.push({ key: 'done', label: '已完成', count: myDone(persona).length })
  return t
}

/**
 * 把服务端行适配成页面认识的形状。
 *
 * 服务端给的是 `woId / woNo / totalWithAddon`，而页面用的是 `id / no / total`
 * 外加两个配色（priorityTone / statusTone）。不补这一层，
 * 卡片 id 会是 `wo-card-undefined`、点进去是 `?id=undefined` —— 整个列表看着像没数据。
 *
 * 这里只做**字段改名与配色映射**，金额和业务判断一律用服务端给的：
 * 什么算待办、应收怎么算，仍然只有服务端一处定义。
 */
function adaptRow(w, persona) {
  const addonTotal = Math.max(0, Number(w.totalWithAddon || 0) - Number(w.totalFee || 0))
  return {
    ...w,
    id: w.woId,
    no: w.woNo,
    title: w.title,
    type: w.type,
    category: w.category,
    priority: w.priority,
    priorityTone: PRIORITY_TONE[w.priority] || 'var(--biz-text-3)',
    status: w.status,
    statusTone: WO_TONE[w.status] || 'var(--biz-text-3)',
    houseName: w.houseName || '公区',
    ownerName: w.ownerName || '',
    createTime: w.createTime,
    assignee: w.assignee || '',
    mode: w.dispatchMode || '后台指派',
    serviceName: w.serviceName || w.category || '',
    isOverdue: !!w.isOverdue,
    score: w.score || 0,
    mine: w.assignee === persona?.name,
    /* SLA 剩余时间由前端按 slaDueAt 现算，服务端只给到期时刻 */
    slaLeft: '',
    slaBreached: !!w.slaBreached,
    feeType: w.feeType,
    total: Number(w.totalWithAddon || w.totalFee || 0),
    labor: Number(w.laborFee || 0) + addonTotal,
    commission: Number(w.commission || 0),
    paid: w.payStatus === '已支付',
    payStatus: w.payStatus || '',
    addonCount: w.addonCount || 0,
    addonPending: w.addonPending || 0,
    grabLeft: ''
  }
}

export function listFor(persona, tab = 'mine') {
  if (IS_API) return (LIST_CACHE.rows[tab] || []).map(w => adaptRow(w, persona))
  if (tab === 'grab') return grabPool(persona).map(w => rowOf(w, persona))
  if (tab === 'dispatch') return dispatchPool(persona).map(w => rowOf(w, persona))
  if (tab === 'mine') return myOpen(persona).map(w => rowOf(w, persona))
  return myDone(persona).map(w => rowOf(w, persona))
}

/** 兼容旧调用：countsOf 现在给到 4 个页签 */
export const countsOf = persona => {
  if (IS_API) {
    /* 页面读的是 pool / doing / done 三个旧名字，接口给的是 grab / mine / done */
    const out = { pool: 0, doing: 0, done: 0 }
    for (const t of LIST_CACHE.tabs) out[t.key] = t.count
    out.pool = out.grab || 0
    out.doing = out.mine || 0
    return out
  }
  const tabs = tabsFor(persona)
  const out = { pool: grabPool(persona).length, doing: myOpen(persona).length, done: myDone(persona).length }
  tabs.forEach(t => (out[t.key] = t.count))
  return out
}

/* ---------------- 取数 ---------------- */

const addonList = woId => addonsOf(woId)
const addonPaid = woId => addonList(woId).filter(a => a.confirmed)
const addonSum = (woId, onlyConfirmed = false) => {
  const list = onlyConfirmed ? addonPaid(woId) : addonList(woId)
  return {
    material: round2(list.reduce((s, a) => s + (a.material || 0), 0)),
    labor: round2(list.reduce((s, a) => s + (a.labor || 0), 0)),
    total: round2(list.reduce((s, a) => s + (a.total || 0), 0)),
    pending: list.filter(a => !a.confirmed).length,
    count: list.length
  }
}

export function rowOf(w, persona) {
  const sla = woSlaState ? woSlaState(w) : null
  const addon = addonSum(w.woId)
  const labor = round2((w.laborFee || 0) + addon.labor)
  return {
    id: w.woId,
    no: w.woNo,
    title: w.title,
    type: w.type,
    category: w.category,
    priority: w.priority,
    priorityTone: PRIORITY_TONE[w.priority] || 'var(--biz-text-3)',
    status: w.status,
    statusTone: WO_TONE[w.status] || 'var(--biz-text-3)',
    houseName: w.houseName || '公区',
    ownerName: w.ownerName || '',
    createTime: w.createTime,
    assignee: w.assignee || '',
    mode: modeOf(w),
    serviceName: w.serviceName || w.category || '',
    isOverdue: !!w.isOverdue,
    score: w.score || 0,
    mine: w.assignee === persona?.name,
    slaLeft: sla?.leftText || '',
    slaBreached: !!sla?.breached,
    /* 费用与提成：抢单卡片上必须直接给到，这是师傅的唯一动机 */
    feeType: w.feeType,
    total: round2((w.totalFee || 0) + addon.total),
    labor,
    commission: w.feeType === '收费' ? commissionOf({ labor, communityId: w.communityId }) : 0,
    paid: w.payStatus === '已支付',
    payStatus: w.payStatus || '',
    addonCount: addon.count,
    addonPending: addon.pending,
    grabLeft: claimOf(w.woId) ? grabLeftText(w) : '',
    arriveTime: w.arriveTime || ''
  }
}

/** 抢单后到场倒计时（按项目配置的分钟数） */
export function grabLeftText(w) {
  const c = claimOf(w.woId)
  if (!c || w.arriveTime) return ''
  const limit = projectParam(w.communityId).grabArriveMinutes || 15
  const start = new Date(String(c.at).replace(/-/g, '/'))
  const now = new Date(String(stamp()).replace(/-/g, '/'))
  const used = Math.floor((now - start) / 60000)
  const left = limit - used
  if (left <= 0) return `已超时 ${-left} 分钟未到场`
  return `还剩 ${left} 分钟到场`
}

export function detailOf(woId, persona) {
  /*
   * HTTP 模式：详情来自 /mobile/work-orders/{id}（一屏一请求）。
   * 这里把服务端的扁平结构**还原成页面认识的那套形状** —— 页面用的是 `row` / `fee` /
   * `addons` / `commission` 这些名字，接口给的是 `workOrder` + 同名费用块。
   * 映射集中在这一个函数里，页面一行都不用改。
   */
  if (IS_API) {
    const d = DETAIL_CACHE.get(woId)
    if (!d) return null
    /*
     * `raw` 给业务判断用（canDispatch 读它），`row` 必须走适配层 ——
     * 页面靠 `row.mine` 决定要不要显示"放弃/到场"，直接用原始 workOrder
     * 会是 undefined，按钮整排不渲染（看着像没权限）。
     */
    const w = d.workOrder
    return {
      raw: w,
      row: adaptRow(w, persona),
      description: w.description || '',
      images: w.images || 0,
      ownerPhone: w.ownerPhone || '',
      assigneePhone: w.assigneePhone || '',
      acceptTime: w.acceptTime || '',
      arriveTime: w.arriveTime || '',
      finishTime: w.finishTime || '',
      slaHours: w.slaHours || 0,
      price: d.price,
      fee: d.fee,
      addons: d.addons || [],
      addonSum: d.addonSum,
      commission: d.commission || 0,
      settled: !!d.settled,
      pays: d.pays || [],
      ownerEval: d.ownerEval,
      staffEval: d.staffEval,
      timeline: d.timeline || []
    }
  }
  const w = workOrders.find(x => x.woId === woId)
  if (!w) return null
  const addon = addonSum(woId)
  const addonDone = addonSum(woId, true)
  /* 读下单时的价目快照，不反查字典 —— 反查会让历史单跟着后台调价一起变 */
  const price = snapshotOf(w)
  const labor = round2((w.laborFee || 0) + addonDone.labor)
  const pays = paysOf(woId)
  return {
    raw: w,
    row: rowOf(w, persona),
    description: w.description || '',
    images: w.images || 0,
    ownerPhone: w.ownerPhone || '',
    assigneePhone: w.assigneePhone || '',
    acceptTime: w.acceptTime || '',
    arriveTime: w.arriveTime || '',
    finishTime: w.finishTime || '',
    slaHours: w.slaHours || 0,
    price,
    fee: {
      type: w.feeType,
      material: round2((w.materialFee || 0) + addonDone.material),
      labor,
      total: round2((w.totalFee || 0) + addonDone.total),
      baseTotal: w.totalFee || 0,
      prepaid: !!w.prepaid,
      payStatus: w.payStatus || ''
    },
    addons: addonList(woId),
    addonSum: addon,
    commission: w.feeType === '收费' ? commissionOf({ labor, communityId: w.communityId }) : 0,
    settled: w.payStatus === '已支付',
    pays,
    ownerEval: w.score ? { score: w.score, tags: w.evalTags || [], text: w.evaluate || '' } : null,
    staffEval: w.staffEval || null
  }
}

function must(woId) {
  const w = workOrders.find(x => x.woId === woId)
  if (!w) throw new Error('工单不存在')
  if (CLOSED.includes(w.status)) throw new Error(`工单「${w.status}」，不能再操作`)
  return w
}

/* ---------------- 抢单 ---------------- */

/**
 * 抢单：先到先得。
 * 这里刻意抛「已被 X 抢走」而不是静默失败 —— 后台是条件更新，前端 409 后必须刷新池子。
 */
export async function claim(woId, persona) {
  if (IS_API) {
    await post(`/work-orders/${woId}/claim`)
    invalidateWo()
    return { ok: true }
  }

  const w = must(woId)
  if (!canGrab(persona)) throw new Error('你的岗位不在抢单范围（只有维修工能抢单）')
  if (w.communityId !== persona?.communityId) throw new Error('跨项目的工单不能抢')
  if (w.type !== PAID_TYPE) throw new Error('公区维修由后台指派，不进抢单池')
  if (w.status !== '待派单') throw new Error(`这单是「${w.status}」，已经不能抢了`)
  if (w.assignee && w.assignee !== persona.name) throw new Error(`手慢了，已被 ${w.assignee} 抢走`)
  w.status = '处理中'
  w.assignee = persona.name
  w.acceptTime = stamp()
  w.dispatchMode = '抢单'
  saveClaim(woId, persona.name)
  return { ...w }
}

/** 到场：抢到后必须在时限内点这一下，超时会被标迟到（不阻断，但要留痕） */
export async function arrive(woId, persona) {
  if (IS_API) {
    const r = await post(`/work-orders/${woId}/arrive`, { remark: '' })
    invalidateWo()
    /* late 由服务端按 SLA 判；拿不到就当作没超时，页面文案会退化成"已到场打卡" */
    return { ...r, late: !!r?.late }
  }

  const w = must(woId)
  if (w.assignee !== persona?.name) throw new Error('这单不在你手上')
  const left = grabLeftText(w)
  w.arriveTime = stamp()
  w.status = '处理中'
  const late = left.startsWith('已超时')
  return { ...w, late }
}

/** 放弃：抢了不到场就放弃，记一次弃单；超过项目配置的次数当天不能再抢 */
export async function abandon(woId, persona) {
  if (IS_API) {
    await post(`/work-orders/${woId}/abandon`, { reason: '现场无法处理' })
    invalidateWo()
    const q = grabQuota(persona)
    return { ok: true, used: q.used, limit: q.limit }
  }

  const w = must(woId)
  if (w.assignee !== persona?.name) throw new Error('这单不在你手上')
  const param = projectParam(w.communityId)
  w.status = '待派单'
  w.assignee = ''
  w.acceptTime = ''
  w.arriveTime = ''
  dropClaim(woId)
  const used = addAbandon(woId, persona.name)
  return { ...w, limit: param.abandonLimit || 3, used }
}

/* ---------------- 派单 ---------------- */

export async function dispatchTo(woId, toName, persona, note = '') {
  if (IS_API) {
    await post(`/work-orders/${woId}/dispatch`, { to: toName, note })
    invalidateWo()
    return { ok: true }
  }

  const w = must(woId)
  if (!canDispatch(persona, w)) {
    throw new Error(w.feeType === '收费' ? '付费单只有项目经理能指派' : '你没有派单权限')
  }
  const emp = EMP_OF.get(toName)
  if (!emp) throw new Error('请选择处理人')
  if (!GRAB_POSITIONS.includes(emp.position)) throw new Error('只能派给维修岗（维修工 / 工程主管）')
  if (emp.orgId && !String(emp.orgId).startsWith(`O-${w.communityId}`)) {
    throw new Error('不能派给其他项目的师傅')
  }
  w.status = '已派单'
  w.assignee = toName
  w.assigneePhone = w.assigneePhone || ''
  w.acceptTime = ''
  w.dispatchMode = '后台指派'
  w.dispatchBy = persona.name
  w.dispatchAt = stamp()
  w.remark = note ? `指派给 ${toName}：${note}` : `由 ${persona.name} 指派给 ${toName}`
  return { ...w }
}

/** 派单候选人：本项目的维修岗，按手上有几单排（负载少的先派） */
export function dispatchTargets(persona, woId) {
  const w = workOrders.find(x => x.woId === woId)
  const list = employees.filter(
    e =>
      e.status !== '离职' &&
      GRAB_POSITIONS.includes(e.position) &&
      String(e.orgId || '').startsWith(`O-${w?.communityId || persona?.communityId || ''}`)
  )
  return list
    .map(e => ({
      value: e.name,
      name: e.name,
      label: `${e.name} · ${e.position}`,
      load: workOrders.filter(x => x.assignee === e.name && !DONE.includes(x.status)).length,
      desc: ''
    }))
    .map(x => ({ ...x, desc: `手上 ${x.load} 单` }))
    .sort((a, b) => a.load - b.load)
    .slice(0, 12)
}

/* ---------------- 完工 / 增项 / 收款 ---------------- */

export async function addAddonItem(woId, code, qty, persona, item) {
  if (IS_API) {
    await post(`/work-orders/${woId}/addons`, { code, qty })
    invalidateWo()
    return { ok: true }
  }

  const w = must(woId)
  if (w.assignee !== persona?.name) throw new Error('这单不在你手上')
  if (w.status !== '处理中') throw new Error('接单后才能加增项')
  const fee = addonFee(item, qty)
  const rec = {
    code,
    name: item.name,
    qty: Math.max(1, Number(qty) || 1),
    material: fee.material,
    labor: fee.labor,
    total: fee.total,
    at: stamp(),
    by: persona.name,
    confirmed: false
  }
  addAddon(woId, rec)
  return rec
}

/** 业主确认增项：业主端未建，这里模拟"业主当面/扫码确认"，确认后才合并进订单 */
export async function ownerConfirmAddons(woId) {
  if (IS_API) {
    await post(`/work-orders/${woId}/addons/confirm`, { confirmedBy: '业主当面确认' })
    invalidateWo()
    return { ok: true }
  }

  const w = must(woId)
  confirmAddons(woId)
  const sum = addonSum(woId, true)
  w.totalFee = round2((w.totalFee || 0) + sum.total)
  w.materialFee = round2((w.materialFee || 0) + sum.material)
  w.laborFee = round2((w.laborFee || 0) + sum.labor)
  w.addons = addonList(woId).map(a => ({ ...a }))
  return { ...w, addonTotal: sum.total }
}

/**
 * 完工。
 * 有未确认增项时**不能直接完工**：金额还没被业主认，先把确认做完，
 * 否则会出现"单子结了、钱多了一截没人认"的扯皮。
 */
export async function finish(woId, { remark = '', photos = 0, persona } = {}) {
  if (IS_API) {
    /* 前端也拦一次：服务端会拒，但填完一屏再弹错是浪费现场时间 */
    if (!String(remark).trim()) throw new Error('完工要写处理结果')
    await post(`/work-orders/${woId}/finish`, { remark: String(remark).trim(), photos: Number(photos) || 0 })
    invalidateWo()
    return { ok: true }
  }

  const w = must(woId)
  if (w.assignee !== persona?.name) throw new Error('这单不在你手上')
  if (!['处理中', '已派单'].includes(w.status)) throw new Error('先接单再完工')
  if (!String(remark).trim()) throw new Error('完工要写处理结果')
  if (addonSum(woId).pending > 0) throw new Error('还有增项没经业主确认，先确认再完工')
  const fee = w.totalFee || 0
  w.status = '已完工'
  w.finishTime = stamp()
  w.remark = String(remark).trim()
  w.images = (w.images || 0) + photos
  return { ...w, fee }
}

/** 收款：移动端只出收款码，不经手现金 */
export async function payByQr(woId, persona, method = '微信支付') {
  if (IS_API) {
    /* 全额收款：应收 − 已收。服务端会拒超额，所以金额必须现算，不能写死单额 */
    const d = await loadWoDetail(woId, persona)
    const due = Number(d?.fee?.due) || 0
    const paid = Number(d?.fee?.paid) || 0
    if (due - paid <= 0) throw new Error('已经收过了')
    await post(`/work-orders/${woId}/payments`, { amount: Math.round((due - paid) * 100) / 100, method })
    invalidateWo()
    return { ok: true }
  }

  const w = workOrders.find(x => x.woId === woId)
  if (!w) throw new Error('工单不存在')
  if (w.feeType !== '收费') throw new Error('这单不收费')
  if (w.payStatus === '已支付') throw new Error('已经收过了')
  w.payStatus = '已支付'
  w.paidAt = stamp()
  w.payMethod = method
  savePay({
    woId,
    no: w.woNo,
    amount: w.totalFee || 0,
    method,
    by: persona?.name || ''
  })
  return { ...w }
}

/** 挂账：业主不在家/企业客户月结，必须写原因 */
export async function hangUp(woId, reason) {
  if (IS_API) {
    if (!String(reason || '').trim()) throw new Error('挂账要写原因')
    const d = DETAIL_CACHE.get(woId)
    const left = Math.max(0, (Number(d?.fee?.due) || 0) - (Number(d?.fee?.paid) || 0))
    await post(`/work-orders/${woId}/payments`, {
      amount: Math.round(left * 100) / 100,
      method: '挂账',
      reason: String(reason).trim()
    })
    invalidateWo()
    return { ok: true }
  }

  const w = workOrders.find(x => x.woId === woId)
  if (!w) throw new Error('工单不存在')
  if (!String(reason || '').trim()) throw new Error('挂账要写清原因')
  w.payStatus = '已挂账'
  w.hangReason = String(reason).trim()
  return { ...w }
}

export const HANG_REASONS = ['业主不在家', '企业客户月结', '业主对金额有异议', '现场无法进入']

/* ---------------- 提成 ---------------- */

/**
 * 提成结算单（本人 · 按月）
 *
 * 为什么单独出一张结算单、而不是直接塞进工资条：
 * 提成的确认依赖「钱到没到」（已收款才结），而工资表是**期间锁定**的核算快照 ——
 * 10 月的工资表发出去以后，10 月才收到的款没地方记。所以按行业做法先出结算单，
 * 财务在下月工资里并入（`commission` 行），两边口径一致但时点不同。
 */
export function commissionSheet(persona, month = '2026-10') {
  const mine = workOrders.filter(w => w.assignee === persona?.name && w.feeType === '收费')
  const rows = []
  for (const w of mine) {
    const d = detailOf(w.woId, persona)
    if (!d) continue
    const doneAt = w.finishTime || ''
    /* 没完工的单不进结算单（还在办）；完工月份按 finishTime 算，没有就归本月 */
    if (!doneAt && !['待确认'].includes(w.status)) continue
    const m = doneAt ? String(doneAt).slice(0, 7) : month
    rows.push({
      woId: w.woId,
      woNo: w.woNo,
      category: w.category,
      doneAt,
      month: m,
      total: d.fee.total,
      labor: d.fee.labor,
      commission: d.commission,
      settled: d.settled,
      payStatus: d.fee.payStatus,
      addonTotal: round2(d.addonSum.total)
    })
  }
  const inMonth = rows.filter(r => r.month === month)
  const settledRows = inMonth.filter(r => r.settled)
  const pendingRows = inMonth.filter(r => !r.settled)
  const sum = list => round2(list.reduce((s, r) => s + r.commission, 0))
  return {
    month,
    period: month.replace('-', ''),
    settleNo: `TC${month.replace('-', '')}-01`,
    rate: projectParam(persona?.communityId).commissionRate || 0,
    settleDay: '次月 10 日随工资发放',
    count: inMonth.length,
    settledCount: settledRows.length,
    settled: sum(settledRows),
    pendingCount: pendingRows.length,
    pending: sum(pendingRows),
    rows: inMonth.sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)))
  }
}

/** 只给数字的场景（列表页顶部卡片）直接取结算单的汇总 */
export function commissionSummary(persona, month = '2026-10') {
  const s = commissionSheet(persona, month)
  return { count: s.count, settledCount: s.settledCount, settled: s.settled, pending: s.pending }
}

/** 弃单配额：超限当天不能再抢（服务端按当日计数，这里按本机记录展示） */
export function grabQuota(persona) {
  const param = projectParam(persona?.communityId)
  const used = abandonsOf(persona?.name).length
  return { limit: param.abandonLimit || 3, used, blocked: used >= (param.abandonLimit || 3) }
}

/* ---------------- 转单（保留） ---------------- */

export async function accept(woId, persona) {
  if (IS_API) {
    await post(`/work-orders/${woId}/accept`, { to: persona?.name || '' })
    invalidateWo()
    return { ok: true }
  }

  const w = must(woId)
  if (w.status === '处理中') throw new Error('这单已经在处理了')
  if (w.assignee && w.assignee !== persona.name && persona.roleId !== 'R-PM') {
    throw new Error(`这单已派给 ${w.assignee}`)
  }
  w.status = '处理中'
  w.assignee = persona.name
  w.acceptTime = stamp()
  return { ...w }
}

export async function transfer(woId, toName, note = '') {
  if (IS_API) {
    await post(`/work-orders/${woId}/transfer`, { to: toName, note: String(note || '') })
    invalidateWo()
    return { ok: true }
  }

  const w = must(woId)
  if (!toName) throw new Error('请选择转给谁')
  w.status = '已派单'
  w.assignee = toName
  w.acceptTime = ''
  w.remark = `转单：${note || '现场情况不匹配，转交处理'}`
  return { ...w }
}

export const STAFF_EVAL_TAGS = ['业主配合', '家中无人', '需二次上门', '现场无法进入', '非本专业问题']

export async function rateOwner(woId, { score = 5, tags = [], note = '' } = {}) {
  if (IS_API) {
    await post(`/work-orders/${woId}/staff-eval`, { score, tags, note: String(note || '') })
    invalidateWo()
    return { ok: true }
  }

  const w = workOrders.find(x => x.woId === woId)
  if (!w) throw new Error('工单不存在')
  if (!DONE.includes(w.status)) throw new Error('完工后才能回评')
  w.staffEval = { score, tags, note, at: stamp() }
  return { ...w }
}

/** 转单候选人：同项目维修岗优先，其次同项目其他一线 */
export function transferTargets(persona, woId) {
  const w = workOrders.find(x => x.woId === woId)
  const list = employees.filter(
    e =>
      e.status !== '离职' &&
      e.name !== persona?.name &&
      String(e.orgId || '').startsWith(`O-${w?.communityId || persona?.communityId || ''}`) &&
      ['维修工', '工程主管', '保安', '保洁员', '绿化员', '客服专员'].includes(e.position)
  )
  const mine = list.filter(e => e.orgId === persona?.orgId)
  const others = list.filter(e => e.orgId !== persona?.orgId)
  return [...mine, ...others].slice(0, 14).map(e => ({
    name: e.name,
    label: `${e.name} · ${e.position}`,
    value: e.name,
    desc: e.orgId === persona?.orgId ? '本班组' : '同项目'
  }))
}

/* ================= 巡检异常 → 转工单 ================= */
/* 巡检发现的问题都在公区/现场，没有业主房屋 → 不提供「商业服务」这个选项 */
export const WOCREATE_TYPES = WO_TYPES.filter(t => t !== PAID_TYPE)
export const WOCREATE_PRIORITY = ['普通', '紧急', '特急']

export function createFromInspection({ task, item, payload = {} }) {
  if (!task) throw new Error('巡检任务不存在')
  if (!item) throw new Error('先选一条异常项')
  const desc = String(payload.description || '').trim()
  if (!desc) throw new Error('工单描述要写清现象与位置')
  if (payload.priority === '特急' && desc.length < 8) throw new Error('特急单请把现场情况写清楚（至少 8 个字）')

  const wo = createWorkOrder({
    communityId: task.communityId,
    houseName: payload.place || `${task.post}责任区 · 巡检点位`,
    type: payload.type || '公共区域维修',
    category: item.reason || '未达标',
    source: '巡检转单',
    priority: payload.priority || '普通',
    title: payload.title || `${item.label}异常（巡检转单）`,
    description: `${desc}\n—— 来源：${task.planName}（${task.taskId}）· 检查项「${item.label}」`,
    images: payload.photos || 0,
    remark: `由巡检 ${task.taskId} 转出`
  })

  task.refWoId = wo.woId
  linkInspectWo(task.taskId, item.label, wo)
  return wo
}
