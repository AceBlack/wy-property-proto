// 原型数据服务层：页面只读这里，禁止在页面里直接 filter/reduce 原始数据
// 目的：口径统一（欠费、收缴率、逾期口径只有一个定义），后续换接口只改本文件

import {
  alarms, approvals, attendance, bills, buildingStewards, buildings, collectionRecords, communities, contracts,
  decorationDeposits, devices, employees, feeItems, houses, inspectPlans, inspectTasks,
  inspectTemplates, invoices, maintenanceRecords, members, meterReadings, meters, metrics,
  notices, operationLogs, orgs, ownerTags, owners, parkings, passRecords, payments, permissions,
  feeCategories, feeItemCategoryMap, waiveReasons, communityUtility, depositTypes,
  utilityPrices, houseUtilityBinding,
  prepayAccounts, qualityChecks, roles, tenants, units, vehicles, workOrders,
  // N 域（邻里）复用的存量数据：公告不另建源，投票/活动/闲置都从业主端同一份数据出发
  activities, activityEnrollments, secondhandItems, surveys,
  // 批 5（2026-11-13）：支出归集的两条来源 —— 费用报销单与手工补录
  expenses, manualEntries
} from '@/mock'
import repairPrices from '@/mock/repairPrices.json'
/* 年度预算（2026-11-14）：人审定的数，不是实际数的函数；脚本 scripts/gen-budgets.mjs 生成 */
import budgets from '@/mock/budgets.json'
import { TODAY, daysBetween, maskId, maskPhone } from '@/utils/format'
import { currentRoleId, currentRoleName } from '@/utils/auth'
import { permCodesOfRole, setRolePerms } from '@/utils/rbac'
import { idCardValid } from '@/utils/rules'
import { DICT_MAP, dictMapRaw } from '@/utils/dict'
import { ENUM } from '@/utils/enums'
import { OA_FLOW_DEFS, OA_FORM_DEFS, oaFormOf } from '@/utils/oa'
import { track } from '@/utils/track'

/* ---------------- 房屋 / 业主 ---------------- */

export const housesOfOwner = ownerId => houses.filter(h => h.ownerId === ownerId)
export const parkingsOfOwner = ownerId => parkings.filter(p => p.ownerId === ownerId)
export const vehiclesOfOwner = ownerId => vehicles.filter(v => v.ownerId === ownerId)
export const wosOfOwner = ownerId => workOrders.filter(w => w.ownerId === ownerId)
export const billsOfOwner = ownerId => bills.filter(b => b.ownerId === ownerId)
export const billsOfHouse = houseId => bills.filter(b => b.houseId === houseId)

/** 欠费口径：未缴 / 部分缴 / 逾期 三类账单的 unpaid 之和（已减免、已作废不计入） */
const DEBT_STATUS = ['未缴', '部分缴', '逾期']
export const isDebt = b => DEBT_STATUS.includes(b.status) && (b.unpaid || 0) > 0
/**
 * Q1 口径（2026-10-23 确认）：收缴率分母剔除「已作废」与「已减免」账单。
 * 剔除后 应收 = 实收 + 欠费 严格自洽（¥1,522,504.90 = ¥1,282,285.24 + ¥240,219.66）。
 */
export const isEffectiveBill = b => b.status !== '已作废' && b.status !== '已减免'
const effectiveBills = list => list.filter(isEffectiveBill)

export function debtOf(list) {
  return list.filter(isDebt).reduce((s, b) => s + (b.unpaid || 0), 0)
}

/** 最长逾期天数 */
export function maxOverdue(list) {
  return list.reduce((m, b) => Math.max(m, b.overdueDays || 0), 0)
}

/** 业主聚合视图：一人多房，收银台 / 业主360 / 催缴共用 */
export function ownerProfile(ownerId) {
  const owner = owners.find(o => o.ownerId === ownerId)
  if (!owner) return null
  const hs = housesOfOwner(ownerId)
  const bl = billsOfOwner(ownerId)
  const ps = parkingsOfOwner(ownerId)
  return {
    owner,
    houses: hs,
    parkings: ps,
    vehicles: vehiclesOfOwner(ownerId),
    bills: bl,
    workOrders: wosOfOwner(ownerId),
    debt: debtOf(bl),
    maxOverdue: maxOverdue(bl),
    totalArea: hs.reduce((s, h) => s + (h.area || 0), 0),
    debtByHouse: hs.map(h => {
      const hb = billsOfHouse(h.houseId)
      return { house: h, debt: debtOf(hb), maxOverdue: maxOverdue(hb), count: hb.filter(isDebt).length }
    })
  }
}

/* ---------------- 业主标签（字典 + 打标签） ----------------
 * 两件事两个权限位，刻意分开：
 *   · 打/去标签 → a.owners.edit（楼栋管家有，且受责任范围约束）
 *   · 维护字典 → e.ownerTags.edit（楼管没有）—— 楼管能选不能改，正是需求要的效果
 * 标签只存 tagIds：词条改名不用刷 682 条业主，停用一个词条也不会让历史标签变成孤儿。
 */
export const OWNER_TAG_PERM = 'e.ownerTags.edit'
export const OWNER_TAG_DICT_PERM = 'e.ownerTags.view'
export const canEditOwnerTags = () => _hasPerm(OWNER_TAG_PERM)
export const canViewOwnerTagDict = () => _hasPerm(OWNER_TAG_DICT_PERM)

/** 分类四档与配色：颜色只给页面用，不参与业务判断 */
export const OWNER_TAG_CATEGORIES = ['关怀', '风险', '价值', '行为']
export const OWNER_TAG_COLORS = ['red', 'orange', 'green', 'blue', 'cyan', 'gray']

/** 每个词条当前被多少人用（实时统计，不信种子里的静态值——打完标签要立刻变） */
const _tagUsage = () => {
  const m = new Map()
  for (const o of owners) for (const t of (o.tagIds || [])) m.set(t, (m.get(t) || 0) + 1)
  return m
}

/** 字典列表。默认只回启用的——选择弹层要的是"能选的"，维护页才看全部 */
export function ownerTagRows({ category = '', enabled = null, kw = '' } = {}) {
  const use = _tagUsage()
  return ownerTags
    .filter(t => !category || t.category === category)
    .filter(t => (enabled === null || enabled === '' ? true : t.enabled === enabled))
    .filter(t => !kw || `${t.name}${t.desc}${t.tagId}`.includes(kw))
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(t => ({ ...t, ownerCount: use.get(t.tagId) || 0 }))
}

export const ownerTagOf = tagId => {
  const t = ownerTags.find(x => x.tagId === tagId)
  if (!t) return null
  return { ...t, ownerCount: _tagUsage().get(tagId) || 0 }
}

/** 某业主的标签（已按字典排序，含颜色/分类，页面直接渲染） */
export function ownerTagsOf(owner) {
  const ids = (owner && owner.tagIds) || []
  return ids.map(ownerTagOf).filter(Boolean).sort((a, b) => (a.sort || 0) - (b.sort || 0))
}

export const ownerTagStats = () => {
  const use = _tagUsage()
  const used = ownerTags.filter(t => (use.get(t.tagId) || 0) > 0)
  return {
    total: ownerTags.length,
    enabled: ownerTags.filter(t => t.enabled).length,
    disabled: ownerTags.filter(t => !t.enabled).length,
    used: used.length,
    taggedOwners: owners.filter(o => (o.tagIds || []).length).length,
    untaggedOwners: owners.filter(o => !(o.tagIds || []).length).length
  }
}

/** 新增词条：名称全库唯一（含已停用的也算占用，否则会出现两个"重点关怀"） */
export function createOwnerTag({ name = '', category = '关怀', color = 'blue', desc = '' } = {}) {
  assertPerm(OWNER_TAG_PERM, '维护标签字典需要「业主标签字典」操作权限（e.ownerTags.edit）——楼管只能选不能改')
  const n = String(name).trim()
  if (n.length < 2) throw Object.assign(new Error('标签名称至少 2 个字'), { code: 42201 })
  if (ownerTags.some(t => t.name === n)) throw Object.assign(new Error(`标签「${n}」已存在`), { code: 40902 })
  if (!OWNER_TAG_CATEGORIES.includes(category)) throw Object.assign(new Error('分类非法'), { code: 42201 })
  const seq = ownerTags.reduce((m, t) => Math.max(m, Number(String(t.tagId).replace(/\D/g, '')) || 0), 0) + 1
  const rec = {
    tagId: 'OT' + String(seq).padStart(2, '0'),
    name: n, category, color, builtin: false, enabled: true,
    sort: ownerTags.reduce((m, t) => Math.max(m, t.sort || 0), 0) + 1,
    desc: String(desc).trim(), ownerCount: 0
  }
  ownerTags.push(rec)
  return { ...rec }
}

/** 改词条：名称/分类/颜色/排序/说明/启停。**tagId 不可改**（业主表引用的是它） */
export function updateOwnerTag(tagId, patch = {}) {
  assertPerm(OWNER_TAG_PERM, '维护标签字典需要「业主标签字典」操作权限（e.ownerTags.edit）')
  const t = ownerTags.find(x => x.tagId === tagId)
  if (!t) throw Object.assign(new Error('标签不存在'), { code: 40401 })
  const before = { ...t }
  if (patch.name !== undefined) {
    const n = String(patch.name).trim()
    if (n.length < 2) throw Object.assign(new Error('标签名称至少 2 个字'), { code: 42201 })
    if (ownerTags.some(x => x.tagId !== tagId && x.name === n)) {
      throw Object.assign(new Error(`标签「${n}」已存在`), { code: 40902 })
    }
    t.name = n
  }
  if (patch.category !== undefined) {
    if (!OWNER_TAG_CATEGORIES.includes(patch.category)) throw Object.assign(new Error('分类非法'), { code: 42201 })
    t.category = patch.category
  }
  if (patch.color !== undefined) t.color = patch.color
  if (patch.desc !== undefined) t.desc = String(patch.desc).trim()
  if (patch.sort !== undefined) t.sort = Number(patch.sort) || 0
  if (patch.enabled !== undefined) t.enabled = !!patch.enabled
  const changed = Object.keys(patch).filter(k => patch[k] !== undefined && String(before[k]) !== String(t[k]))
  return { tag: { ...t, ownerCount: _tagUsage().get(tagId) || 0 }, changed }
}

/** 给业主打标签：必须启用中、必须还没打（重复打不打补丁，直接说清"已经打过了"） */
export function addOwnerTag(ownerId, tagId) {
  assertPerm('a.owners.edit', '打标签属于业主资料维护（a.owners.edit）')
  const o = owners.find(x => x.ownerId === ownerId)
  if (!o) throw Object.assign(new Error('业主不存在'), { code: 40401 })
  const t = ownerTags.find(x => x.tagId === tagId)
  if (!t) throw Object.assign(new Error('标签不存在'), { code: 40401 })
  if (!t.enabled) throw Object.assign(new Error(`标签「${t.name}」已停用，不能再打；已打过的不受影响`), { code: 40919 })
  o.tagIds = o.tagIds || []
  if (o.tagIds.includes(tagId)) throw Object.assign(new Error(`「${o.name}」已经有「${t.name}」标签`), { code: 40920 })
  o.tagIds.push(tagId)
  return { ownerId, tagIds: [...o.tagIds], tag: { ...t, ownerCount: _tagUsage().get(tagId) || 0 } }
}

/** 去掉标签：停用的标签也能去掉（不然挂错了就永远摘不掉） */
export function removeOwnerTag(ownerId, tagId) {
  assertPerm('a.owners.edit', '去标签属于业主资料维护（a.owners.edit）')
  const o = owners.find(x => x.ownerId === ownerId)
  if (!o) throw Object.assign(new Error('业主不存在'), { code: 40401 })
  o.tagIds = o.tagIds || []
  if (!o.tagIds.includes(tagId)) {
    const t = ownerTags.find(x => x.tagId === tagId)
    throw Object.assign(new Error(`「${o.name}」没有「${t ? t.name : tagId}」标签`), { code: 40409 })
  }
  o.tagIds = o.tagIds.filter(x => x !== tagId)
  return { ownerId, tagIds: [...o.tagIds] }
}

/* ---------------- 费用 ---------------- */

/** 项目/全局费用汇总：应收、实收、欠费、收缴率 */
export function feeSummary(communityId = null) {
  const all = scopeFilter(communityId ? bills.filter(b => b.communityId === communityId) : bills)
  // 应收 / 实收 / 收缴率只算有效账单；作废与减免不进分母（Q1 口径）
  const list = effectiveBills(all)
  const receivable = list.reduce((s, b) => s + (b.payable || 0), 0)
  const received = list.reduce((s, b) => s + (b.paidAmount || 0), 0)
  const debt = debtOf(list)
  const overdue = list.filter(b => b.status === '逾期')
  return {
    receivable,
    received,
    debt,
    rate: receivable ? (received / receivable) * 100 : 0,
    overdueAmount: overdue.reduce((s, b) => s + (b.unpaid || 0), 0),
    overdueCount: overdue.length,
    billCount: all.length,
    voidCount: all.length - list.length
  }
}

/** 欠费排行（催缴 / 看板共用） */
export function debtRank(limit = 10, communityId = null) {
  const map = new Map()
  const nameOf = new Map(owners.map(o => [o.ownerId, o.name]))
  const list = communityId ? bills.filter(b => b.communityId === communityId) : bills
  for (const b of list) {
    if (!isDebt(b)) continue
    const cur = map.get(b.ownerId) || {
      ownerId: b.ownerId,
      name: b.ownerName || nameOf.get(b.ownerId) || '未知业主',
      debt: 0, maxOverdue: 0, count: 0
    }
    cur.debt += b.unpaid || 0
    cur.maxOverdue = Math.max(cur.maxOverdue, b.overdueDays || 0)
    cur.count += 1
    map.set(b.ownerId, cur)
  }
  return [...map.values()].sort((a, b) => b.debt - a.debt).slice(0, limit)
}

/* ---------------- 工单 ---------------- */

export const OPEN_WO = ['待派单', '已派单', '处理中', '待确认']
export const isOpenWo = w => OPEN_WO.includes(w.status)

export function woSummary(communityId = null) {
  const list = scopeFilter(communityId ? workOrders.filter(w => w.communityId === communityId) : workOrders, { emp: w => w.assignee, org: w => orgOfEmpName(w.assignee), house: w => w.houseId })
  const by = s => list.filter(w => w.status === s).length
  return {
    total: list.length,
    open: list.filter(isOpenWo).length,
    overdue: list.filter(w => w.isOverdue).length,
    done: by('已完工') + by('已评价'),
    byType: groupCount(list, 'type'),
    byStatus: groupCount(list, 'status'),
    /** 平均响应时长（小时）：受理 - 创建 */
    avgResponse: avg(list.filter(w => w.acceptTime).map(w => hoursBetween(w.createTime, w.acceptTime)))
  }
}

/* ---------------- 巡检 ---------------- */

export function inspectSummary(communityId = null) {
  const list = scopeFilter(communityId ? inspectTasks.filter(t => t.communityId === communityId) : inspectTasks, { emp: t => t.executor, org: orgOfTask })
  return {
    total: list.length,
    done: list.filter(t => t.status === '已完成').length,
    overdue: list.filter(t => t.status === '逾期').length,
    toWo: list.filter(t => t.status === '已转工单').length,
    issueRate: list.length ? (list.reduce((s, t) => s + (t.issueCount || 0), 0) / list.reduce((s, t) => s + (t.itemCount || 1), 0)) * 100 : 0,
    avgScore: avg(list.filter(t => t.score).map(t => t.score)),
    byPost: groupCount(list, 'post')
  }
}

/* ---------------- 物联 ---------------- */

export function deviceSummary(communityId = null) {
  const list = scopeFilter(communityId ? devices.filter(d => d.communityId === communityId) : devices)
  const online = list.filter(d => d.status === '在线').length
  const al = communityId ? alarms.filter(a => a.communityId === communityId) : alarms
  return {
    total: list.length,
    online,
    offline: list.filter(d => d.status === '离线').length,
    fault: list.filter(d => d.status === '故障').length,
    alarm: list.filter(d => d.status === '告警').length,
    onlineRate: list.length ? (online / list.length) * 100 : 0,
    alarmTotal: al.length,
    alarmOpen: al.filter(a => a.status === '未处理').length,
    byType: groupCount(list, 'type')
  }
}

/* ---------------- 人力 ---------------- */

export function hrSummary() {
  const list = employees
  const by = s => list.filter(e => e.status === s).length
  return {
    total: list.length,
    onJob: by('在职'),
    probation: by('试用'),
    left: by('离职'),
    byType: groupCount(list, 'empType'),
    byPosition: groupCount(list, 'position'),
    payroll: list.filter(e => e.status !== '离职').reduce((s, e) => s + (e.monthlySalary || 0), 0)
  }
}

/* ---------------- 通用 ---------------- */

export function groupCount(list, key) {
  const m = new Map()
  for (const x of list) {
    const k = x[key] ?? '未分类'
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

export function avg(arr) {
  if (!arr.length) return 0
  return arr.reduce((s, x) => s + x, 0) / arr.length
}

export function hoursBetween(a, b) {
  if (!a || !b) return 0
  const t1 = new Date(String(a).replace(' ', 'T'))
  const t2 = new Date(String(b).replace(' ', 'T'))
  return (t2 - t1) / 3600000
}

/* ==================================================================
 * 参考数据（同步）
 * 下拉选项、字典这类静态数据不需要 loading，页面统一从这里取，
 * 不再 import '@/mock'
 * ================================================================== */
export {
  buildings, communities, feeItems, inspectTemplates, metrics, orgs
}
export const buildingsOf = communityId =>
  communityId ? buildings.filter(b => b.communityId === communityId) : buildings

/* 去重取值：把某字段的现有取值作为筛选项（原型没有独立字典表） */
export function distinct(list, key) {
  return [...new Set(list.map(x => x[key]).filter(v => v !== '' && v != null))]
}
/**
 * 房屋使用状态（2026-11-02 改）：按现场《房屋状态》看板统一成六态。
 *
 * 旧值是「自住 / 出租 / 空置 / 装修中 / 限制使用」——它把**居住关系**（自住/出租）
 * 和**进度**（空置/装修中）混在一个字段里，所以两件事永远没法同时表达。
 * 六态是"交付 → 装修 → 入住"一条线上的档位，居住关系改由 `tenantId` 派生（有租客 = 出租）。
 *
 * 「限制使用」不再单独成档：房子还在但没人正常住，归「空置房」。
 * 顺序即页面展示顺序：先住在里面的，再在路上的，最后空着的。
 */
export const HOUSE_USE_STATUS = ['已入住', '装修未入住', '正在装修', '已交房未装修', '未交房', '空置房']
/** 用途：公寓是 2026-11-02 新增（旧改公寓按住宅标准计费） */
export const HOUSE_USAGE = ['住宅', '公寓', '商业']
/**
 * 交付状态（2026-11-02 收紧）：只有两档。
 * 旧代码在房屋表单里写的是「已交付 / 未交付 / 待交付」，而数据与契约里只有「已交付 / 未交房」——
 * 于是新建一套「未交付」的房子，`isDelivered` 判成已交付，当天就能计费。
 * 这里收敛成常量，页面不再各写各的。
 */
export const HOUSE_DELIVER_STATUS = ['已交付', '未交房']
/** 未交房不计费、不可出租 —— 这两个判断在好几处要用，别各写各的 */
export const isDelivered = h => h?.useStatus !== '未交房' && h?.deliverStatus !== '未交房'
/** 有人住：已入住（自住或出租都算） */
export const isOccupied = h => h?.useStatus === '已入住'
/** 可出租：装修完能住进去的两档；毛坯（已交房未装修）要租客自己装，不进"可出租"候选 */
export const RENTABLE_STATUS = ['空置房', '装修未入住']

export const houseUsageOpts = () => HOUSE_USAGE.slice()
export const houseDeliverOpts = () => HOUSE_DELIVER_STATUS.slice()
export const houseTypeOpts = () => distinct(houses, 'houseType')
/* 不是 distinct：某个状态当前 0 套时，筛选下拉里也得能选到（否则用户以为没这个状态） */
export const houseUseStatusOpts = () => HOUSE_USE_STATUS.slice()
export const ownerTypeOpts = () => distinct(owners, 'ownerType')
export const creditLevelOpts = () => distinct(owners, 'creditLevel')
/** 业主下拉（全量 682 条过筛太慢，原型只取前 N 条 + 关键字搜索走 queryOwners） */
export const ownerOptions = (limit = 200) => owners.slice(0, limit)
/** 员工下拉（工资表关键字联想用，正式版改接口搜索） */
export const employeeOptions = (limit = 60) => employees.slice(0, limit)

/* ==================================================================
 * 异步查询层（A 级交互：分页 / 筛选 / 加载态）
 *
 * 约定：
 *   1. 页面只 await 本段函数，禁止在页面里 filter 原始数组
 *   2. 入参统一 { pageNo, size, filters }，出参统一 { rows, total }
 *   3. 内部是「同步过滤 + 固定延时」，将来换真接口只改本段，页面零改动
 * ================================================================== */

export const PAGE_SIZES = [20, 50, 100]
const LATENCY = 180   // 模拟网络往返，保证加载态可见；改 0 即瞬时返回

/* ---- 异常态注入（供 /shell/states 演示，默认关闭）----
   原型原本只有 resolve 分支，接口失败会被 useListQuery 当成「无数据」处理。
   这里补 reject 分支：页面才能真正区分 空数据 / 加载失败 / 无权限 / 会话过期。 */
const FAIL_TEXT = {
  timeout: '请求超时，请稍后重试',
  server: '服务暂时不可用（错误码 500），已记录',
  denied: '暂无查看权限，如需开通请联系管理员',
  expired: '登录已过期，请重新登录'
}
const FAIL_CODE = { timeout: 504, server: 500, denied: 403, expired: 401 }
let FAIL_MODE = 'off'   // off | timeout | server | denied | expired
export const setFailMode = mode => { FAIL_MODE = FAIL_MODE === mode ? 'off' : mode; return FAIL_MODE }
export const getFailMode = () => FAIL_MODE

const delay = fn => new Promise((resolve, reject) => setTimeout(() => {
  if (FAIL_MODE !== 'off') {
    const e = new Error(FAIL_TEXT[FAIL_MODE] || '数据加载失败')
    e.code = FAIL_CODE[FAIL_MODE] || 500
    e.mock = true
    return reject(e)
  }
  resolve(fn())
}, LATENCY))

/** 等值：筛选值为空则跳过该条件 */
const eq = (row, v, key) => v === '' || v == null || row[key] === v
/** 包含：命中任一字段即通过，extra 用于拼接入主表不存在的关联字段（如业主名） */
const kwHit = (row, kw, keys, extra = '') => {
  const k = (kw ?? '').toString().trim()
  if (!k) return true
  if (keys.some(key => String(row[key] ?? '').includes(k))) return true
  return extra.includes(k)
}
/** 分页切片 */
function paged(list, pageNo = 1, size = 20) {
  const start = (pageNo - 1) * size
  return { rows: list.slice(start, start + size), total: list.length }
}

/** 日期归一：Date / 'YYYY-MM-DD HH:mm' / 'YYYY-MM-DD' → 'YYYY-MM-DD' */
function toDay(v) {
  if (!v) return ''
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  return String(v).slice(0, 10)
}
/** 日期区间：filters.range = [start, end]，任一端为空则跳过 */
const between = (v, range) => {
  if (!range || !range[0] || !range[1]) return true
  const d = String(v ?? '').slice(0, 10)
  if (!d) return false
  return d >= toDay(range[0]) && d <= toDay(range[1])
}

const OWNER_NAME = new Map(owners.map(o => [o.ownerId, o.name]))
const ownerNameOf = id => OWNER_NAME.get(id) || ''
/** 业主姓名：列表页展示用，避免在页面里再 import owners */
export const ownerName = id => OWNER_NAME.get(id) || '—'
/** 房屋名称：账单/工单列表展示用（原始表只有 houseId） */
const HOUSE_NAME = new Map(houses.map(h => [h.houseId, h.fullName]))
export const houseName = id => HOUSE_NAME.get(id) || id

/* ==================================================================
 * 楼栋责任范围（楼栋管家）· 2026-10-29
 * 口径：业主资料、租户信息与欠费催缴按「责任范围」隔离，防止跨楼栋看到敏感信息。
 * 粒度：楼栋为主 / 单元可拆 / 房屋例外 ——
 *   `buildingStewards` 是责任台账（支持移交、留痕、一栋多楼管）；
 *   `houses.stewardEmpId` 是快照（列表与账单直接读，不用每次 join 推导）。
 * ================================================================== */

let STEWARD_BINDINGS = buildingStewards.map(x => ({ ...x }))
/** 房屋级例外：个别房屋单独指定楼管（如商业裙楼），优先于单元/楼栋责任 */
const HOUSE_EXCEPTION = new Map()
let STEWARD_OF_HOUSE = new Map()
let HOUSES_OF_STEWARD = new Map()
const STEWARD_LOG = []

function _rebuildStewardIndex() {
  const unitOf = new Map()
  const bldOf = new Map()
  for (const r of STEWARD_BINDINGS) {
    if (r.unitId) unitOf.set(`${r.buildingId}|${r.unitId}`, r.empId)
    else bldOf.set(r.buildingId, r.empId)
  }
  STEWARD_OF_HOUSE = new Map()
  HOUSES_OF_STEWARD = new Map()
  for (const h of houses) {
    const empId = HOUSE_EXCEPTION.get(h.houseId) || unitOf.get(`${h.buildingId}|${h.unitId}`) || bldOf.get(h.buildingId) || ''
    h.stewardEmpId = empId
    STEWARD_OF_HOUSE.set(h.houseId, empId)
    if (!empId) continue
    if (!HOUSES_OF_STEWARD.has(empId)) HOUSES_OF_STEWARD.set(empId, new Set())
    HOUSES_OF_STEWARD.get(empId).add(h.houseId)
  }
  for (const b of buildings) b.stewardEmpId = bldOf.get(b.buildingId) || ''
}
_rebuildStewardIndex()

export const stewardOfHouse = houseId => STEWARD_OF_HOUSE.get(houseId) || ''
export const housesOfSteward = empId => [...(HOUSES_OF_STEWARD.get(empId) || [])]
/** 责任人姓名（列表展示用） */
export const stewardNameOf = empId => (EMP_ROWS.find(e => e.empId === empId) || {}).name || ''

/** 房屋级例外：单独指定（不传 empId = 取消例外，回到楼栋/单元责任） */
export function setHouseSteward(houseId, empId = '') {
  const h = houses.find(x => x.houseId === houseId)
  if (!h) throw new Error('房屋不存在')
  if (empId) HOUSE_EXCEPTION.set(houseId, empId)
  else HOUSE_EXCEPTION.delete(houseId)
  _rebuildStewardIndex()
  return stewardOfHouse(houseId)
}

/**
 * 新建 / 编辑房屋（真实落库，内存态）。
 * 新增时必须带 单元：houseId 由「项目 + 楼栋 + 单元 + 房号」拼出，否则与台账对不上。
 */
export function saveHouse(payload = {}, houseId = '') {
  const communityId = payload.communityId || ''
  const buildingId = payload.buildingId || ''
  const unitId = payload.unitId || ''
  const room = String(payload.room || '').trim()
  if (!communityId || !buildingId || !room) throw new Error('项目 / 楼栋 / 房号必填')
  if (!houseId && !unitId) throw new Error('请选择单元（房号需与单元组合成唯一房屋编号）')
  if (!/^\d{4}$/.test(room)) throw new Error('房号为 4 位数字')
  const b = buildings.find(x => x.buildingId === buildingId)
  if (!b) throw new Error('楼栋不存在')
  /* 交付 × 使用 必须自洽：六态是「交付 → 装修 → 入住」一条线，跨档组合一定是填错了。
     不拦的后果很实在——「未交房 + 已入住」的房子会立刻进入计费与出租候选。 */
  const uStatus = payload.useStatus || '空置房'
  const dStatus = payload.deliverStatus || '已交付'
  if (!HOUSE_USE_STATUS.includes(uStatus)) throw new Error(`使用状态只能是 ${HOUSE_USE_STATUS.join(' / ')}`)
  if (!HOUSE_DELIVER_STATUS.includes(dStatus)) throw new Error(`交付状态只能是 ${HOUSE_DELIVER_STATUS.join(' / ')}`)
  if (dStatus === '未交房' && uStatus !== '未交房') throw new Error('交付状态为「未交房」时，使用状态只能是「未交房」')
  if (uStatus === '未交房' && dStatus !== '未交房') throw new Error('使用状态「未交房」需同时把交付状态置为「未交房」')
  const uid = unitId || (houses.find(h => h.houseId === houseId) || {}).unitId || ''
  const newId = houseId || ('H' + String(communityId).slice(-2) + buildingId.slice(1, 3) + String(uid).slice(3, 4) + room)
  if (!houseId && houses.some(h => h.houseId === newId)) throw new Error('该房号已存在，请核对单元与房号')
  const u = units.find(x => x.unitId === uid)
  const fullName = `${communityName(communityId)} ${b.name}${u ? u.name : ''}${room}`
  const base = {
    ...payload,
    houseId: newId, communityId, buildingId, unitId: uid, room,
    floor: Number(payload.floor) || Number(room.slice(0, 2)),
    seq: Number(room.slice(2, 4)),
    fullName, shortName: `${communityId}-${buildingId.slice(1, 3)}${String(uid).slice(3, 4)}-${room}`,
    chargeArea: payload.chargeArea || payload.area
  }
  const i = houses.findIndex(h => h.houseId === newId)
  if (i >= 0) houses[i] = { ...houses[i], ...base }
  else houses.push({ ...base, ownerId: payload.ownerId || '', tenantId: '', checkinDate: '', certNo: payload.certNo || '' })
  HOUSE_NAME.set(newId, fullName)
  if (payload.stewardEmpId !== undefined) setHouseSteward(newId, payload.stewardEmpId)
  else _rebuildStewardIndex()
  return { houseId: newId, created: i < 0 }
}

/** 楼栋管家候选（在职） */
export const stewardOptions = () =>
  EMP_ROWS.filter(e => e.position === '楼栋管家' && e.status !== '离职')
    .map(e => ({ empId: e.empId, name: e.name, label: `${e.name} · ${e.position} · ${orgNameOf(e.orgId)}`, orgId: e.orgId }))
/** 楼栋当前责任人（单元级优先） */
export const stewardOfBuilding = (buildingId, unitId = '') => {
  const u = unitId && STEWARD_BINDINGS.find(r => r.buildingId === buildingId && r.unitId === unitId)
  if (u) return u
  return STEWARD_BINDINGS.find(r => r.buildingId === buildingId && !r.unitId) || null
}

/** 责任范围列表：一行 = 一条责任绑定（整栋或某单元）；未绑定的楼栋也列出来，便于发现漏配 */
export function stewardRows(filters = {}) {
  const out = []
  const today = '2026-10-21'
  for (const b of buildings) {
    if (filters.communityId && b.communityId !== filters.communityId) continue
    const bHouses = houses.filter(h => h.buildingId === b.buildingId)
    const unitRows = STEWARD_BINDINGS.filter(r => r.buildingId === b.buildingId && r.unitId)
    const head = STEWARD_BINDINGS.find(r => r.buildingId === b.buildingId && !r.unitId)
    const splitUnits = new Set(unitRows.map(r => r.unitId))
    const baseHouses = bHouses.filter(h => !splitUnits.has(h.unitId))
    const pack = (housesOfRow, binding) => {
      const debtHouses = new Set()
      let debt = 0
      for (const h of housesOfRow) {
        const bs = BILL_ROWS.filter(x => x.houseId === h.houseId && isDebt(x))
        if (bs.length) { debtHouses.add(h.houseId); debt += bs.reduce((n, x) => n + (x.unpaid || 0), 0) }
      }
      return {
        houses: housesOfRow.length,
        tenants: TENANT_ROWS.filter(t => t.live && housesOfRow.some(h => h.houseId === t.houseId)).length,
        debtHouses: debtHouses.size,
        debtAmount: Math.round(debt * 100) / 100,
        empId: binding ? binding.empId : '',
        empName: binding ? binding.empName : '',
        from: binding ? binding.from : '',
        stewardId: binding ? binding.stewardId : '',
        days: binding && binding.from ? daysBetween(binding.from) : null
      }
    }
    if (head) out.push({ key: `${b.buildingId}|`, buildingId: b.buildingId, buildingName: b.name, communityId: b.communityId, communityName: communityName(b.communityId), unitId: '', scopeType: '楼栋', ...pack(baseHouses, head) })
    for (const r of unitRows) {
      const hs = bHouses.filter(h => h.unitId === r.unitId)
      const unitName = (units.find(u => u.unitId === r.unitId) || {}).name || r.unitId
      out.push({ key: `${b.buildingId}|${r.unitId}`, buildingId: b.buildingId, buildingName: b.name, communityId: b.communityId, communityName: communityName(b.communityId), unitId: r.unitId, unitName, scopeType: '单元', ...pack(hs, r) })
    }
    if (!head && !unitRows.length) {
      out.push({ key: `${b.buildingId}|`, buildingId: b.buildingId, buildingName: b.name, communityId: b.communityId, communityName: communityName(b.communityId), unitId: '', scopeType: '未分配', ...pack(bHouses, null), uncovered: true })
    }
  }
  const kw = (filters.kw || '').trim()
  const list = out.filter(r => (!filters.empId || r.empId === filters.empId) &&
    (!kw || `${r.buildingName}${r.communityName}${r.empName}`.includes(kw)))
  return list.sort((a, b) => (a.communityId.localeCompare(b.communityId)) || a.buildingId.localeCompare(b.buildingId) || String(a.unitId).localeCompare(String(b.unitId)))
}

export function queryStewards({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => paged(stewardRows(filters), pageNo, size))
}

/** 责任范围 KPI：楼栋覆盖率、人均户数、未分配、跨楼管共管数 */
export function stewardSummary() {
  const rows = stewardRows()
  const bld = new Set(rows.filter(r => r.empId).map(r => r.buildingId))
  const uncovered = rows.filter(r => !r.empId)
  const emps = new Map()
  for (const r of rows) {
    if (!r.empId) continue
    const cur = emps.get(r.empId) || { empId: r.empId, name: r.empName, houses: 0, buildings: new Set(), debt: 0 }
    cur.houses += r.houses
    cur.buildings.add(r.buildingId)
    cur.debt += r.debtAmount
    emps.set(r.empId, cur)
  }
  const staff = [...emps.values()].map(x => ({ ...x, buildingCount: x.buildings.size }))
  return {
    buildings: new Set(rows.map(r => r.buildingId)).size,
    covered: bld.size,
    coverage: rows.length ? Math.round(bld.size / new Set(rows.map(r => r.buildingId)).size * 1000) / 10 : 0,
    stewards: staff.length,
    avgHouses: staff.length ? Math.round(staff.reduce((n, x) => n + x.houses, 0) / staff.length) : 0,
    uncovered: uncovered.length,
    splitUnits: rows.filter(r => r.scopeType === '单元').length,
    staff: staff.sort((a, b) => b.houses - a.houses)
  }
}

/** 设置 / 调整责任范围：写台账 + 重建房屋快照（单元级传 unitId，整栋传空） */
export function assignSteward({ buildingId, unitId = '', empId, operator = '项目经理' } = {}) {
  const b = buildings.find(x => x.buildingId === buildingId)
  if (!b) throw new Error('楼栋不存在')
  const emp = empId ? EMP_ROWS.find(e => e.empId === empId) : null
  if (empId && !emp) throw new Error('责任人不存在')
  const i = STEWARD_BINDINGS.findIndex(r => r.buildingId === buildingId && (r.unitId || '') === (unitId || ''))
  const before = i >= 0 ? { ...STEWARD_BINDINGS[i] } : null
  if (!empId) {
    if (i < 0) return { changed: false }
    STEWARD_BINDINGS.splice(i, 1)
  } else if (i >= 0) {
    STEWARD_BINDINGS[i] = { ...STEWARD_BINDINGS[i], empId: emp.empId, empName: emp.name, from: '2026-10-21' }
  } else {
    STEWARD_BINDINGS.push({
      stewardId: 'BS' + String(STEWARD_BINDINGS.length + 1).padStart(4, '0'),
      buildingId, unitId: unitId || '', communityId: b.communityId,
      empId: emp.empId, empName: emp.name,
      scopeType: unitId ? '单元' : '楼栋', from: '2026-10-21', note: ''
    })
  }
  _rebuildStewardIndex()
  STEWARD_LOG.unshift({
    at: _now(), action: empId ? '调整责任范围' : '解除责任范围', by: operator,
    memo: `${communityName(b.communityId)} ${b.name}${unitId ? (units.find(u => u.unitId === unitId)?.name || unitId) : '整栋'}：${before ? before.empName : '未分配'} → ${emp ? emp.name : '未分配'}`
  })
  return { changed: true, before, after: stewardOfBuilding(buildingId, unitId) }
}

/**
 * 责任移交：把某楼管名下（可限定项目）的全部责任范围转给另一人。
 * 由项目经理执行 —— 楼管离职/调岗时必做，否则那几栋的业主要么没人管、要么谁都看不到。
 */
export function transferStewards({ fromEmpId, toEmpId, communityId = '', operator = '项目经理', note = '' } = {}) {
  const from = EMP_ROWS.find(e => e.empId === fromEmpId)
  const to = EMP_ROWS.find(e => e.empId === toEmpId)
  if (!from || !to) throw new Error('请选择移交双方')
  if (from.empId === to.empId) throw new Error('移交双方不能是同一人')
  const hit = STEWARD_BINDINGS.filter(r => r.empId === fromEmpId && (!communityId || r.communityId === communityId))
  if (!hit.length) throw new Error(`${from.name} 名下没有可移交的责任范围`)
  const houseCount = houses.filter(h => h.stewardEmpId === fromEmpId && (!communityId || h.communityId === communityId)).length
  for (const r of hit) {
    r.empId = to.empId
    r.empName = to.name
    r.from = '2026-10-21'
  }
  _rebuildStewardIndex()
  STEWARD_LOG.unshift({
    at: _now(), action: '责任移交', by: operator,
    memo: `${from.name} → ${to.name}：${hit.length} 条责任范围（${hit.filter(r => !r.unitId).length} 栋 / ${hit.filter(r => r.unitId).length} 单元），${houseCount} 户${communityId ? '（限 ' + communityName(communityId) + '）' : ''}${note ? ' · ' + note : ''}`
  })
  return { moved: hit.length, houses: houseCount, from: from.name, to: to.name }
}

export const stewardLogs = () => STEWARD_LOG.slice(0, 20)

/** 当前登录角色能看到几个楼栋（页面上提示"我的责任范围"用） */
export const myStewardScope = () => {
  const s = currentScope()
  if (s.mode !== '责任范围') return null
  return {
    empId: s.empId, empName: s.anchorName,
    houses: (s.houseIds || new Set()).size,
    buildings: new Set(houses.filter(h => (s.houseIds || new Set()).has(h.houseId)).map(h => h.buildingId)).size,
    communities: [...(s.communityIds || [])].map(id => communityName(id))
  }
}

/* ---------------- 房屋 ---------------- */
export function queryHouses({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const list = scopeFilter(houses, { house: h => h.houseId }).filter(h =>
      eq(h, filters.communityId, 'communityId') &&
      eq(h, filters.buildingId, 'buildingId') &&
      eq(h, filters.usage, 'usage') &&
      eq(h, filters.useStatus, 'useStatus') &&
      eq(h, filters.stewardEmpId, 'stewardEmpId') &&
      kwHit(h, filters.kw, ['room', 'fullName', 'houseId'], ownerNameOf(h.ownerId))
    )
    return paged(list, pageNo, size)
  })
}

/** 房屋详情：一次取全关联数据，供详情抽屉使用 */
export function getHouseDetail(houseId) {
  return delay(() => {
    const house = houses.find(h => h.houseId === houseId)
    if (!house) return null
    return {
      house,
      owner: owners.find(o => o.ownerId === house.ownerId) || null,
      community: communities.find(c => c.communityId === house.communityId) || null,
      building: buildings.find(b => b.buildingId === house.buildingId) || null,
      bills: billsOfHouse(house.houseId),
      workOrders: workOrders.filter(w => w.houseId === house.houseId),
      parkings: parkings.filter(p => p.ownerId === house.ownerId),
      members: members.filter(m => m.houseId === house.houseId),
      tenants: tenants.filter(t => t.houseId === house.houseId)
    }
  })
}

/* ---------------- 业主 ---------------- */
export function queryOwners({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    assertInScope({ communityId: filters.communityId, buildingId: filters.buildingId, unitId: filters.unitId })
    const vf = OWNER_VF[filters.vf]
    const list = scopeFilter(OWNER_ROWS, { communities: o => OWNER_SCOPE.get(o.ownerId)?.communities || new Set(), house: o => OWNER_SCOPE.get(o.ownerId)?.houses || new Set() }).filter(o =>
      ownerInScope(o, 'communities', filters.communityId) &&
      ownerInScope(o, 'buildings', filters.buildingId) &&
      ownerInScope(o, 'units', filters.unitId) &&
      eq(o, filters.ownerType, 'ownerType') &&
      eq(o, filters.creditLevel, 'creditLevel') &&
      /* 标签筛选必须在这里做：分页之后再筛，看到的永远是"本页里有这个标签的" */
      (!filters.tagId || (o.tagIds || []).includes(filters.tagId)) &&
      (!vf || vf(o)) &&
      kwHit(o, filters.kw, ['name', 'phone', 'ownerId'], o.houseNames.join(' '))
    )
    const page = paged(list, pageNo, size)
    /* 列表只回掩码：明文必须逐条揭示（会写访问日志），导出走 prepareExport 的脱敏分支。
       画像三项与手机/证件同一条规矩——它们在列表页也不给明文。 */
    return { ...page, rows: redactList(page.rows, ['phone', 'idCard', 'economicLevel', 'politicalStatus', 'negativeNotes']) }
  })
}

/* ---------------- 业务聚合（驾驶舱专用，口径唯一） ---------------- */

/** 欠费账龄分桶：口径 = 未缴/部分缴/逾期 且 unpaid>0，按 overdueDays 归桶 */
export function agingBuckets(communityId = null) {
  const list = communityId ? bills.filter(b => b.communityId === communityId) : bills
  const b = [
    { name: '未到期', max: 0, n: 0 }, { name: '1–30 天', max: 30, n: 0 },
    { name: '31–90 天', max: 90, n: 0 }, { name: '91–180 天', max: 180, n: 0 },
    { name: '180 天以上', max: 1e9, n: 0 }
  ]
  for (const x of list) {
    if (!(x.unpaid > 0) || !DEBT_STATUS.includes(x.status)) continue
    const d = x.overdueDays || 0
    const hit = b.find(k => d <= k.max) || b[b.length - 1]
    hit.n++
  }
  return b
}

/** 项目维度费用汇总（费用驾驶舱排行表） */
export function feeByProject() {
  return communities.map(c => ({ name: c.name, ...feeSummary(c.communityId) }))
}

/** 车位管理费到期分桶：daysBetween > 0 已过期，负数 = 剩余天数 */
export function parkingExpireBuckets() {
  const b = ['已过期', '30天内', '90天内', '半年内', '一年以上'].map(name => ({ name, n: 0 }))
  for (const p of parkings) {
    const d = daysBetween(p.expireDate)
    if (d === null) continue
    if (d > 0) b[0].n++
    else if (d >= -30) b[1].n++
    else if (d >= -90) b[2].n++
    else if (d >= -180) b[3].n++
    else b[4].n++
  }
  return b
}
export const parkingTotal = () => parkings.length

/* ---------------- 车位 / 车辆 ---------------- */
// 注：原「车位车牌绑定」页（/a/parking）已并入 /a/vehicles，
// 其 queryParkings / parkingBindSummary / vehicleOfPlate 一并收归下方的
// queryParkingVehicles / parkingSummary / getParkingDetail，口径统一为单一来源。

/** 收银台左栏：无关键字 = 演示对象 + 欠费 Top5；有关键字 = 姓名/手机/房号
 *  可选 buildingId / unitId：按楼栋/单元收窄（业主名下任一房屋落在范围内即可） */
const HOUSE_BY_ID = new Map(houses.map(h => [h.houseId, h]))

/** 收银台「楼栋」下拉：跨项目，标签带项目名，避免不同项目的「1栋」重名 */
export function cashierBuildingOpts(communityId = '') {
  return buildings
    .filter(b => !communityId || b.communityId === communityId)
    .map(b => ({
      value: b.buildingId,
      label: `${communityName(b.communityId)} ${b.name}`,
      communityId: b.communityId,
      houseCount: b.houseCount
    }))
}

/** 收银台「单元」下拉：必须先选楼栋 */
export const cashierUnitOpts = buildingId =>
  (buildingId ? units.filter(u => u.buildingId === buildingId) : [])
    .map(u => ({ value: u.unitId, label: u.name, housePerFloor: u.housePerFloor }))

export function cashierOwnerList(kw = '', { buildingId = '', unitId = '' } = {}) {
  const k = (kw || '').trim()
  const inScopeHouse = h => !!h && (unitId ? h.unitId === unitId : (buildingId ? h.buildingId === buildingId : true))
  const scoped = o => (!buildingId && !unitId) || o.houseIds.some(id => inScopeHouse(HOUSE_BY_ID.get(id)))
  /** 该业主在范围内的第一个房号，用作排序键 */
  const roomKey = o => o.houseIds.map(id => HOUSE_BY_ID.get(id))
    .filter(inScopeHouse).map(h => h.fullName).sort()[0] || ''

  if (k) {
    /* 租户到场代缴时报的是自己的名字：命中在住租户也要能定位到业主 */
    const tenantOwnerIds = new Set(
      TENANT_ROWS.filter(t => t.live && (t.name.includes(k) || t.phone.includes(k))).map(t => t.ownerId)
    )
    return owners
      .filter(o => scoped(o) && (
        o.name.includes(k) || o.phone.includes(k) ||
        o.houseIds.some(h => h.includes(k)) || tenantOwnerIds.has(o.ownerId)
      ))
      .slice(0, 12)
  }
  // 选了楼栋/单元：按房号顺序列出范围内业主（单栋最多 44 户，留 60 上限兜底）
  if (buildingId || unitId) {
    return owners.filter(scoped).sort((a, b) => roomKey(a).localeCompare(roomKey(b))).slice(0, 60)
  }
  const demo = demoOwnerList(4)
  const top = [...owners]
    .map(o => ({ o, d: debtOf(billsOfOwner(o.ownerId)) }))
    .filter(x => x.d > 0)
    .sort((a, b) => b.d - a.d)
    .slice(0, 5)
    .map(x => x.o)
  const ids = new Set(demo.map(o => o.ownerId))
  return [...demo, ...top.filter(o => !ids.has(o.ownerId))]
}

/** 收银台：某位业主在指定楼栋/单元下的房屋（用于左栏显示房号、以及按范围排序） */
export function cashierOwnerRoom(ownerId, { buildingId = '', unitId = '' } = {}) {
  const o = owners.find(x => x.ownerId === ownerId)
  if (!o) return ''
  const list = o.houseIds.map(id => HOUSE_BY_ID.get(id)).filter(Boolean)
    .filter(h => (unitId ? h.unitId === unitId : (buildingId ? h.buildingId === buildingId : true)))
    .map(h => h.fullName).sort()
  return list[0] || ''
}

/** 工资表：口径统一放这里（在职 · 组织 · 关键字 → 薪酬明细行） */
export function payrollRows({ orgId = '', kw = '', paidIds = [] } = {}) {
  return employees
    .filter(e => e.status !== '离职')
    .filter(e => !orgId || e.orgId === orgId)
    .filter(e => !kw || e.name.includes(kw))
    .map(e => {
      const base = e.baseSalary || 0
      const monthly = e.monthlySalary || base
      const perf = Math.max(0, Math.round((monthly - base) * 100) / 100)
      const hourly = base / 21.75 / 8
      const ot = Math.round(hourly * (e.attendance?.overtimeHours || 0) * 1.5 * 100) / 100
      const gross = Math.round((monthly + ot) * 100) / 100
      const social = e.socialSecurity ? Math.round(base * 0.105 * 100) / 100 : 0
      const fund = e.socialSecurity ? Math.round(base * 0.07 * 100) / 100 : 0
      const taxable = Math.max(0, gross - social - fund - 5000)
      const tax = Math.round(taxable * 0.03 * 100) / 100
      const net = Math.round((gross - social - fund - tax) * 100) / 100
      return { ...e, base, perf, ot, gross, social, fund, tax, net, paid: paidIds.includes(e.empId) }
    })
}

/* ==================================================================
 * 工资表：核算快照（契约 payrolls 域，2026-10-30）
 * 原型这边也必须有「批次 + 状态」，否则页面上的核算锁定 / 提交发放 / 审批 / 冲正
 * 全是假动作——点完刷新就回原样，看着能用，其实什么都没发生。
 * 口径与契约一致：金额只由这里算；已核算不可改；提交人不能审批自己的单。
 * ================================================================== */

const _pay2 = n => Math.round((Number(n) || 0) * 100) / 100
const PAYROLL_PERIODS = new Map()
const PAYROLL_ROWS = new Map()
let _PAY_BOOT = false
let _PAY_ACCESS_SEQ = 0

const _payStatusOf = r => (r.reversedAt ? '已冲正' : ((PAYROLL_PERIODS.get(r.period) || {}).status || r.status))
const _payOut = r => ({
  ...r,
  status: _payStatusOf(r),
  submittedBy: (PAYROLL_PERIODS.get(r.period) || {}).submittedBy || ''
})

function _paySeed(period, status, batchNo, paidAt) {
  const prefix = 'PR' + period.slice(2, 4) + period.slice(5, 7)
  payrollRows().forEach((r, i) => {
    const id = `${prefix}-${String(i + 1).padStart(4, '0')}`
    const card = String(r.bankCard || '')
    PAYROLL_ROWS.set(id, {
      payrollId: id, period, batchNo,
      empId: r.empId, empNo: r.empNo, empName: r.name,
      orgId: r.orgId, orgName: ORG_OF.get(r.orgId)?.name || '',
      position: r.position, level: r.level, empType: r.empType,
      base: r.base, performance: r.perf, overtime: r.ot, allowance: 0,
      grossPay: r.gross,
      socialInsurance: r.social, housingFund: r.fund, tax: r.tax, otherDeduction: 0,
      deductionTotal: _pay2(r.social + r.fund + r.tax),
      netPay: r.net,
      status, paidAt, paidBy: paidAt ? '何淑珍' : '',
      reversedAt: '', reverseReason: '',
      submittedBy: status === '已发放' ? '杜若曦' : '',
      bankCardMasked: '**** **** **** ' + card.slice(-4),
      bankCardTail: card.slice(-4),
      formulaVersion: 'v1'
    })
  })
  PAYROLL_PERIODS.set(period, {
    period, status, batchNo, paidAt,
    paidBy: paidAt ? '何淑珍' : '',
    submittedBy: status === '已发放' ? '杜若曦' : '',
    approvedBy: status === '已发放' ? '何淑珍' : '',
    payDate: status === '已发放' ? '2026-10-10' : '',
    events: status === '已发放'
      ? [
        { at: '2026-10-08 09:30', action: '生成工资表', operator: '系统', note: '按 9 月考勤与绩效核算' },
        { at: '2026-10-08 15:10', action: '核算锁定', operator: '何淑珍', note: '' },
        { at: '2026-10-09 10:05', action: '提交发放', operator: '杜若曦', note: `代发批次 ${batchNo}` },
        { at: '2026-10-09 16:40', action: '审批通过', operator: '何淑珍', note: '' },
        { at: '2026-10-10 14:20', action: '发放完成', operator: '何淑珍', note: '银企直连回执成功' }
      ]
      : [{ at: '2026-10-21 09:00', action: '生成工资表', operator: '系统', note: '按 10 月考勤与绩效核算' }]
  })
}

function _payInit() {
  if (_PAY_BOOT) return
  _PAY_BOOT = true
  _paySeed('2026-09', '已发放', 'GZ-2026-09-01', '2026-10-10 14:20')
  _paySeed('2026-10', '草稿', '', '')
}

export const latestPayrollPeriod = () => [...PAYROLL_PERIODS.keys()].sort().pop() || ''

function _payPeriodMeta(period) {
  const s = payrollSummaryOf(period)
  const st = PAYROLL_PERIODS.get(period) || {}
  return {
    period, status: st.status || '', employeeCount: s.employeeCount, netTotal: s.netTotal,
    batchNo: st.batchNo || '', generatedAt: (st.events?.[0] || {}).at || '', paidAt: st.paidAt || ''
  }
}

export function queryPayrolls({ period = '', pageNo = 1, size = 20, filters = {} } = {}) {
  _payInit()
  return delay(() => {
    const p = period || latestPayrollPeriod()
    const ids = filters.orgId ? descOf(filters.orgId) : null
    const list = [...PAYROLL_ROWS.values()]
      .filter(r => r.period === p)
      .filter(r => !ids || ids.has(r.orgId))
      .map(_payOut)
      .filter(r => !filters.status || r.status === filters.status)
      .filter(r => !filters.kw || [r.empName, r.empNo, r.position, r.orgName]
        .some(v => String(v ?? '').includes(filters.kw)))
      .sort((a, b) => String(a.empNo).localeCompare(String(b.empNo)))
    return paged(list, pageNo, size)
  })
}

export function payrollSummaryOf(period = '') {
  _payInit()
  const p = period || latestPayrollPeriod()
  const rows = [...PAYROLL_ROWS.values()].filter(r => r.period === p).map(_payOut)
  const alive = rows.filter(r => r.status !== '已冲正')
  const reversed = rows.filter(r => r.status === '已冲正')
  const byStatus = {}
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1
  const st = PAYROLL_PERIODS.get(p) || {}
  return {
    period: p, batchNo: st.batchNo || '', status: st.status || '',
    employeeCount: rows.length,
    grossTotal: _pay2(alive.reduce((s, r) => s + r.grossPay, 0)),
    deductionTotal: _pay2(alive.reduce((s, r) => s + r.deductionTotal, 0)),
    /* 已冲正的钱已经退回去了，不算在实发里 */
    netTotal: _pay2(alive.reduce((s, r) => s + r.netPay, 0)),
    reversedCount: reversed.length,
    reversedAmount: _pay2(reversed.reduce((s, r) => s + r.netPay, 0)),
    byStatus
  }
}

export function payrollPeriods() {
  _payInit()
  return [...PAYROLL_PERIODS.keys()].sort().reverse().map(_payPeriodMeta)
}

export function payrollDetailOf(payrollId) {
  _payInit()
  const r = PAYROLL_ROWS.get(payrollId)
  if (!r) throw new Error('工资条不存在')
  const st = PAYROLL_PERIODS.get(r.period) || {}
  return {
    payroll: _payOut(r),
    calc: {
      gross: [
        { label: '基本工资', amount: r.base },
        { label: '绩效', amount: r.performance, note: '月度应发 − 基本工资' },
        { label: '加班费', amount: r.overtime, note: '基本工资 / 21.75 / 8 × 加班小时 × 1.5' },
        { label: '补贴', amount: r.allowance, note: r.allowance ? '' : '本期无' }
      ],
      deductions: [
        { label: '社保（个人）', amount: r.socialInsurance, note: '基本工资 × 10.5%' },
        { label: '公积金（个人）', amount: r.housingFund, note: '基本工资 × 7%' },
        { label: '个人所得税', amount: r.tax, note: '应纳税所得额 × 3%（简化速算）' },
        { label: '其他扣款', amount: r.otherDeduction, note: r.otherDeduction ? '宿舍费 / 工装' : '本期无' }
      ],
      netPay: r.netPay
    },
    bankCard: { masked: r.bankCardMasked, tail: r.bankCardTail, revealable: canViewSensitive() },
    timeline: [...(st.events || [])]
  }
}

export function generatePayroll({ period = '', overwrite = false } = {}) {
  _payInit()
  const st = PAYROLL_PERIODS.get(period)
  if (st && st.status !== '草稿') {
    throw new Error(`${period} 当前状态「${st.status}」，不能重算；已发放的请先冲正`)
  }
  if (st && !overwrite) throw new Error(`${period} 工资表已存在，重算需要确认覆盖`)
  if (st) for (const [id, r] of [...PAYROLL_ROWS]) if (r.period === period) PAYROLL_ROWS.delete(id)
  _paySeed(period, '草稿', '', '')
  const n = [...PAYROLL_ROWS.values()].filter(r => r.period === period).length
  if (st) PAYROLL_PERIODS.get(period).events = [{ at: _now(), action: '重新核算', operator: _accessWho().name, note: `${n} 人` }]
  return { period, employeeCount: n, overwritten: !!st, summary: payrollSummaryOf(period) }
}

export function confirmPayroll(period) {
  _payInit()
  const st = PAYROLL_PERIODS.get(period)
  if (!st) throw new Error(`${period} 没有工资表`)
  if (st.status !== '草稿') throw new Error(`${period} 当前状态「${st.status}」，只有草稿可以核算`)
  st.status = '已核算'
  st.events.push({ at: _now(), action: '核算锁定', operator: _accessWho().name, note: '' })
  return _payPeriodMeta(period)
}

export function submitPayrollPay(period, { payDate = '', remark = '' } = {}) {
  _payInit()
  const st = PAYROLL_PERIODS.get(period)
  if (!st) throw new Error(`${period} 没有工资表`)
  if (!payDate) throw new Error('请选择发放日期')
  if (st.status !== '已核算') throw new Error(`${period} 当前状态「${st.status}」，需要先核算锁定`)
  st.status = '待发放审批'
  st.batchNo = `GZ-${period}-01`
  st.payDate = payDate
  st.submittedBy = _accessWho().name
  st.events.push({
    at: _now(), action: '提交发放', operator: st.submittedBy,
    note: `代发批次 ${st.batchNo} · 发放日 ${payDate}${remark ? ' · ' + remark : ''}`
  })
  return _payPeriodMeta(period)
}

export function approvePayrollPay(period, { decision = 'approve', reason = '' } = {}) {
  _payInit()
  const st = PAYROLL_PERIODS.get(period)
  if (!st) throw new Error(`${period} 没有工资表`)
  if (st.status !== '待发放审批') throw new Error(`${period} 当前状态「${st.status}」，没有待审批的发放单`)
  /* 双人原则：一个人既能核算又能批准，"谁批的"永远写的是同一个人 */
  const who = _accessWho().name
  if (st.submittedBy === who) throw new Error(`发放单由 ${st.submittedBy} 提交，不能由本人审批（请切换角色）`)
  if (decision === 'reject') {
    const why = String(reason || '').trim()
    if (why.length < 4) throw new Error('驳回要写原因（至少 4 个字）')
    st.status = '已核算'
    st.batchNo = ''
    st.events.push({ at: _now(), action: '审批驳回', operator: who, note: why })
    return _payPeriodMeta(period)
  }
  st.status = '已发放'
  st.approvedBy = who
  st.paidBy = who
  st.paidAt = _now()
  for (const r of PAYROLL_ROWS.values()) {
    if (r.period === period && !r.reversedAt) { r.paidAt = st.paidAt; r.paidBy = who }
  }
  st.events.push({ at: st.paidAt, action: '发放完成', operator: who, note: '银企直连回执成功' })
  return _payPeriodMeta(period)
}

export function reversePayroll(payrollId, reason = '') {
  _payInit()
  const r = PAYROLL_ROWS.get(payrollId)
  if (!r) throw new Error('工资条不存在')
  const st = _payStatusOf(r)
  if (st !== '已发放') throw new Error(`${payrollId} 当前状态「${st}」，只有已发放的工资条可以冲正`)
  const why = String(reason || '').trim()
  if (why.length < 10) throw new Error('冲正原因至少 10 个字（这笔要留档）')
  r.reversedAt = _now()
  r.reverseReason = why
  const pst = PAYROLL_PERIODS.get(r.period)
  if (pst) pst.events.push({ at: r.reversedAt, action: '单笔冲正', operator: _accessWho().name, note: `${r.empName} · ${why}` })
  return _payOut(r)
}

/**
 * 揭示银行卡完整卡号。
 * 原型样例里银行卡本身就是掩码（`6222****9381`），没有完整卡号可揭示——
 * 这里把原值回给页面并说明，不伪造一个 19 位号码充数。
 */
export function revealPayrollBankCard(payrollId, reason = '') {
  _payInit()
  const r = PAYROLL_ROWS.get(payrollId)
  if (!r) throw new Error('工资条不存在')
  if (!canViewSensitive()) throw new Error('无「敏感字段明文」权限，请联系财务主管开通')
  const why = String(reason || '').trim()
  if (why.length < 4) throw new Error('请填写揭示原因（至少 4 个字）')
  _PAY_ACCESS_SEQ++
  const whose = _accessWho()
  return {
    payrollId, empName: r.empName,
    bankCard: r.bankCardMasked,
    reason: why, operator: whose.name, shownAt: _now(),
    accessLogId: 'AL' + String(900000 + _PAY_ACCESS_SEQ).padStart(6, '0'),
    note: '原型样例未存完整卡号'
  }
}

/** 业主 360：固定演示对象（与数据集剧本一致） */
export const demoOwnerList = (n = 4) => owners.slice(0, n)/** 家庭成员 / 租客 */
export const membersOfOwner = ownerId => members.filter(m => m.ownerId === ownerId)
export const tenantOfHouse = houseId => tenants.find(t => t.houseId === houseId) || null
export const tenantsOfHouses = houseIds => tenants.filter(t => houseIds.includes(t.houseId))

/** 工单详情：默认取演示工单 WO000001 */
export const getWorkOrder = (woId = 'WO000001') =>
  workOrders.find(w => w.woId === woId) || workOrders[0]
/** 维修类岗位人员（派单候选人） */
export function repairCandidates(limit = 20) {
  const list = employees.filter(e =>
    ['水电工', '维修工', '工程主管', '综合维修'].some(p => (e.position || '').includes(p))
  )
  return (list.length ? list : employees.slice(0, 10)).slice(0, limit)
}

/** 某车位/车牌的通行记录 */
export const passRecordsOf = (parkId, plateNo) =>
  passRecords.filter(x => x.parkId === parkId || (plateNo && x.plateNo === plateNo))
    .sort((a, b) => (a.passTime < b.passTime ? 1 : -1))

export const vehiclesOfHouse = ownerId => vehicles.filter(v => v.ownerId === ownerId)

/* ---------------- 账单 / 缴费 ---------------- */
/**
 * 账单筛选谓词：列表与「范围小计」共用一份，避免两处口径漂移。
 * 2026-10-29 去树后新增 subjectType（房屋 / 车位）——原树的「车位账单」分支改由筛选承接。
 */
function _billHit(filters = {}) {
  const vf = BILL_VF[filters.vf]
  return b =>
    eq(b, filters.communityId, 'communityId') &&
    eq(b, filters.buildingId, 'buildingId') &&
    eq(b, filters.unitId, 'unitId') &&
    eq(b, filters.subjectType, 'subjectType') &&
    eq(b, filters.period, 'period') &&
    eq(b, filters.status, 'status') &&
    eq(b, filters.itemId, 'itemId') &&
    (!vf || vf(b)) &&
    kwHit(b, filters.kw, ['billId', 'itemName'], b.ownerName || ownerNameOf(b.ownerId))
}

export function queryBills({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    assertInScope({ communityId: filters.communityId, buildingId: filters.buildingId, unitId: filters.unitId })
    const list = scopeFilter(BILL_ROWS, { house: b => b.houseId }).filter(_billHit(filters))
      // 同账期必须返回 0 保持稳定排序，否则种子里的「房屋 / 车位」混排会被打乱成清一色车位账单
      .sort((a, b) => (a.period === b.period ? 0 : (a.period < b.period ? 1 : -1)))
    return paged(list, pageNo, size)
  })
}

/**
 * 当前筛选范围的小计（去树后替代原来挂在树节点上的金额）。
 * 回答的是「这个范围欠多少」——按楼栋盘点欠费的场景由它承接，而不是靠树。
 */
export function billScopeSummary(filters = {}) {
  const list = scopeFilter(BILL_ROWS, { house: b => b.houseId }).filter(_billHit(filters))
  const r2 = n => Math.round(n * 100) / 100
  return {
    count: list.length,
    payable: r2(list.reduce((s, b) => s + (b.payable || 0), 0)),
    unpaid: r2(list.reduce((s, b) => s + (b.unpaid || 0), 0)),
    debtCount: list.filter(b => (b.unpaid || 0) > 0).length,
    overdueCount: list.filter(b => (b.overdueDays || 0) > 0).length
  }
}

export const paymentsOfOwner = ownerId => payments.filter(p => p.ownerId === ownerId)

/* ---------------- 工单 ---------------- */
/** 工单筛选谓词：列表与「范围小计」共用；nohouse 承接原树的「公共 / 非入户工单」分支 */
function _woHit(filters = {}) {
  const vf = WO_VF[filters.vf]
  return w =>
    eq(w, filters.communityId, 'communityId') &&
    eq(w, filters.buildingId, 'buildingId') &&
    eq(w, filters.unitId, 'unitId') &&
    eq(w, filters.status, 'status') &&
    eq(w, filters.type, 'type') &&
    eq(w, filters.priority, 'priority') &&
    (filters.nohouse ? !w.houseId : true) &&
    (!vf || vf(w)) &&
    kwHit(w, filters.kw, ['woNo', 'title', 'assignee'], w.ownerName || '')
}

export function queryWorkOrders({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    assertInScope({ communityId: filters.communityId, buildingId: filters.buildingId, unitId: filters.unitId })
    const list = scopeFilter(WO_ROWS, { emp: w => w.assignee, org: w => orgOfEmpName(w.assignee), house: w => w.houseId })
      .filter(_woHit(filters))
    return paged(list, pageNo, size)
  })
}

/** 当前筛选范围的小计：单数 / 未闭环 / 超时 / 待派单 */
export function woScopeSummary(filters = {}) {
  const list = scopeFilter(WO_ROWS, { emp: w => w.assignee, org: w => orgOfEmpName(w.assignee), house: w => w.houseId })
    .filter(_woHit(filters))
  return {
    count: list.length,
    open: list.filter(w => WO_OPEN.includes(w.status)).length,
    overdue: list.filter(w => w.isOverdue).length,
    pending: list.filter(w => w.status === '待派单').length,
    nohouse: list.filter(w => !w.houseId).length
  }
}

/**
 * 工单按楼栋分布（报表中心「工单按楼栋」用）。
 * 去树后主管「哪栋报修集中」这个诉求不能靠列表树看，改由这张报表回答。
 */
export function woBuildingRows(filters = {}) {
  const list = scopeFilter(WO_ROWS, { emp: w => w.assignee, org: w => orgOfEmpName(w.assignee), house: w => w.houseId })
    .filter(w => w.houseId)
    .filter(w => (!filters.communityId || w.communityId === filters.communityId))
  const map = new Map()
  for (const w of list) {
    const key = w.buildingId || '未知'
    const cur = map.get(key) || {
      buildingId: key,
      buildingName: (BUILDING_OF.get(key) || {}).name || key,
      communityName: communityName(w.communityId),
      count: 0, open: 0, overdue: 0, urgent: 0, houses: new Set(), types: {}
    }
    cur.count++
    if (WO_OPEN.includes(w.status)) cur.open++
    if (w.isOverdue) cur.overdue++
    if (w.priority === '特急' || w.priority === '紧急') cur.urgent++
    if (w.houseId) cur.houses.add(w.houseId)
    cur.types[w.type] = (cur.types[w.type] || 0) + 1
    map.set(key, cur)
  }
  return [...map.values()]
    .map(x => ({
      ...x,
      houseCount: x.houses.size,
      perHundred: x.houses.size ? Math.round(x.count / x.houses.size * 1000) / 10 : 0,
      topType: Object.entries(x.types).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    }))
    .sort((a, b) => b.count - a.count)
}

/* ---------------- L4 详情页（列表页详情抽屉用） ---------------- */

/** 业主档案详情：业主 + 房产 + 车位 + 车辆 + 欠费 */
export function getOwnerDetail(ownerId) {
  return delay(() => ownerProfile(ownerId))
}
/** 账单详情：账单 + 房屋 + 业主 + 缴费流水 */
export function getBillDetail(billId) {
  return delay(() => {
    const bill = bills.find(b => b.billId === billId)
    if (!bill) return null
    return {
      bill,
      house: houses.find(h => h.houseId === bill.houseId) || null,
      owner: owners.find(o => o.ownerId === bill.ownerId) || null,
      payments: payments.filter(p => p.billId === bill.billId)
    }
  })
}
/** 设备详情：设备 + 该设备告警 */
export function getDeviceDetail(deviceId) {
  return delay(() => {
    const device = devices.find(d => d.deviceId === deviceId)
    if (!device) return null
    return {
      device,
      community: communities.find(c => c.communityId === device.communityId) || null,
      alarms: alarms.filter(a => a.deviceId === deviceId)
    }
  })
}

/* ---------------- 巡检 ---------------- */
/** 未处理告警（按等级排序取前 N 条）—— 物联驾驶舱用 */
export function openAlarmList(limit = 8) {
  const LV = { 紧急: 0, 重要: 1, 一般: 2, 提示: 3 }
  return alarms.filter(a => a.status === '未处理')
    .slice()
    .sort((a, b) => (LV[a.level] ?? 9) - (LV[b.level] ?? 9))
    .slice(0, limit)
}
/** 设备类型构成（物联驾驶舱饼图） */
export const deviceTypeCount = () => groupCount(devices, 'type')
/** 工单来源构成（工作台） */
export const woSourceCount = () => groupCount(workOrders, 'source')

export function queryInspectTasks({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const list = scopeFilter(inspectTasks, { emp: t => t.executor, org: orgOfTask }).filter(t =>
      eq(t, filters.communityId, 'communityId') &&
      eq(t, filters.status, 'status') &&
      eq(t, filters.post, 'post') &&
      eq(t, filters.taskType, 'taskType') &&
      kwHit(t, filters.kw, ['taskId', 'planName', 'executor'])
    )
    // 列表要显示项目名，统一在数据层补（原始表只有 communityId）
    return paged(list.map(t => ({ ...t, communityName: communityName(t.communityId) })), pageNo, size)
  })
}

/** 巡检执行页：任务 + 模板 + 今日待办（原先在页面里拼装，收归此处） */
export function inspectExecData(taskId = 'IT00006') {
  const task = inspectTasks.find(t => t.taskId === taskId) || inspectTasks[0]
  const template = inspectTemplates.find(t => t.templateId === task.templateId) || inspectTemplates[0]
  const community = communities.find(c => c.communityId === task.communityId) || null
  const todayTasks = inspectTasks
    .filter(t => ['待执行', '执行中', '逾期'].includes(t.status) || t.taskId === task.taskId)
    /* 监督任务排前面：组长打开作业台先看到自己的核验任务 */
    .sort((a, b) => (b.taskType === '监督' ? 1 : 0) - (a.taskType === '监督' ? 1 : 0))
    .slice(0, 10)
  return { task, template, communityName: community?.name || '-', todayTasks }
}

/* ---------------- 设备 / 告警 ---------------- */
export function queryDevices({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const list = scopeFilter(devices).filter(d =>
      eq(d, filters.communityId, 'communityId') &&
      eq(d, filters.type, 'type') &&
      eq(d, filters.status, 'status') &&
      kwHit(d, filters.kw, ['deviceCode', 'name', 'location'])
    )
    return paged(list, pageNo, size)
  })
}

export function queryAlarms({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const list = alarms.filter(a =>
      eq(a, filters.communityId, 'communityId') &&
      eq(a, filters.level, 'level') &&
      eq(a, filters.status, 'status') &&
      kwHit(a, filters.kw, ['alarmId', 'deviceName', 'content'])
    )
    return paged(list.map(a => ({ ...a, communityName: communityName(a.communityId) })), pageNo, size)
  })
}

/* ---------------- 员工 ---------------- */
export function queryEmployees({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const list = employees.filter(e =>
      eq(e, filters.status, 'status') &&
      eq(e, filters.empType, 'empType') &&
      eq(e, filters.orgId, 'orgId') &&
      eq(e, filters.position, 'position') &&
      kwHit(e, filters.kw, ['name', 'phone', 'empNo'])
    )
    const page = paged(list, pageNo, size)
    /* 员工手机 / 证件 / 紧急联系电话同属敏感：列表只回掩码，明文走揭示接口。
       紧急联系人电话也是个人号码，员工档案列表一次几十行，一样不能下发明文。 */
    return { ...page, rows: redactList(page.rows, ['phone', 'idCard', 'emergencyPhone']) }
  })
}

/* ==================================================================
 * C 域 · 通讯录（2026-11-06 第 66 批）
 *
 * 通讯录不是"员工档案的简版"，是**另一件事**：
 *   档案回答"这个人的薪资、证件、合同、紧急联系人是什么"（HR 用）；
 *   通讯录回答"这个人在哪个部门、怎么联系"（所有人用）。
 *
 * 所以它是**独立权限位**（`c.contacts.view`）而不是复用 `c.employees.view`：
 * 让全员看档案等于把 120 人的薪资表发出去；而按岗位逐个开通讯录，
 * 结果就是"想找个人还得先问 HR"。
 *
 * 四条口径：
 *   ① **只取在职**（含试用，排除离职）—— 给离职的人打电话是这类工具最常见的错误；
 *   ② **手机号不脱敏**：同事之间看全号。这条与员工档案的"揭示留痕"相反，
 *      因为在档案里看手机是"查个人信息"，在通讯录里看手机就是它的用途本身；
 *   ③ **字段白名单**：姓名 / 岗位 / 部门 / 手机 / 性别。薪资、证件、银行卡、
 *      紧急联系人一律不出现在返回里（不是页面不显示，是**数据层不给**）；
 *   ④ 不带座机 / 分机 / 邮箱 —— 数据模型里也没有，不为了"看起来全"造字段。
 * ================================================================== */

const CONTACT_PERM = 'c.contacts.view'
export const canViewContacts = () => _hasPerm(CONTACT_PERM)

/** 通讯录字段白名单。**只在这里列一次**，页面按它渲染，接口按它返回 */
export const CONTACT_FIELDS = ['empId', 'name', 'position', 'orgId', 'phone', 'gender']

const _ctActive = () => employees.filter(e => e.status !== '离职')

const _orgOf = orgId => orgs.find(o => o.orgId === orgId) || null
const _orgNameOf = orgId => (_orgOf(orgId) || {}).name || '—'

/** 部门的全部下级 orgId（含自己） */
function _orgSubtree(orgId) {
  const out = new Set([orgId])
  let added = true
  let guard = 0
  while (added && guard++ < 12) {
    added = false
    for (const o of orgs) {
      if (o.parentId && out.has(o.parentId) && !out.has(o.orgId)) { out.add(o.orgId); added = true }
    }
  }
  return out
}

/**
 * 部门树 + 人数。`totalCount` 含下级 —— 集团节点显示 118 人，
 * 点进去才按部门分开看，这样"哪个部门人多"一眼能看出来。
 */
export function contactTree() {
  const active = _ctActive()
  const direct = new Map()
  for (const e of active) direct.set(e.orgId, (direct.get(e.orgId) || 0) + 1)

  const build = (parentId) => {
    const list = orgs.filter(o => (o.parentId || '') === parentId)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    return list.map(o => {
      const children = build(o.orgId)
      const self = direct.get(o.orgId) || 0
      const totalCount = self + children.reduce((s, c) => s + c.totalCount, 0)
      return {
        orgId: o.orgId, name: o.name, type: o.type,
        directCount: self, totalCount, children
      }
    })
  }
  /* 只留有人的节点：组织树是按管理口径建的，班组层面不一定有直属员工，
     把二十多个 0 人节点全铺出来，找一个部门要点开三层还全是空的 */
  const prune = list => list
    .filter(n => n.totalCount > 0)
    .map(n => ({ ...n, children: prune(n.children || []) }))
  return prune(build(''))
}

/** 某部门的直属人员（不含下级）；页面分组显示用 */
function _contactRowOf(e) {
  return {
    empId: e.empId,
    name: e.name,
    position: e.position || '—',
    orgId: e.orgId,
    orgName: _orgNameOf(e.orgId),
    /* **明文**：同事之间不需要脱敏，见文件头第 ② 条 */
    phone: e.phone || '',
    gender: e.gender || ''
  }
}

/**
 * 通讯录查询。
 * @param {{orgId?:string, kw?:string, includeSub?:boolean}} opt
 * @returns {{rows:Array, groups:Array, total:number}}
 */
export function queryContacts({ orgId = '', kw = '', includeSub = true } = {}) {
  return delay(() => {
    if (!canViewContacts()) {
      throw Object.assign(new Error(`当前角色没有查看通讯录的权限（${CONTACT_PERM}）`), { code: 403 })
    }
    const k = String(kw || '').trim()
    let list = _ctActive()
    if (orgId) {
      const ids = includeSub ? _orgSubtree(orgId) : new Set([orgId])
      list = list.filter(e => ids.has(e.orgId))
    }
    if (k) {
      /* 手机号支持搜后 4 位 —— 前台记不住完整号码，但记得尾巴 */
      list = list.filter(e =>
        `${e.name}${e.position}${e.phone}${_orgNameOf(e.orgId)}`.includes(k) ||
        (k.length >= 4 && String(e.phone || '').endsWith(k))
      )
    }
    const rows = list.map(_contactRowOf)
      .sort((a, b) => a.orgName.localeCompare(b.orgName, 'zh') || a.name.localeCompare(b.name, 'zh'))

    /* 按部门分组：卡片墙上一堆人，不分部门等于没有结构 */
    const m = new Map()
    for (const r of rows) {
      if (!m.has(r.orgId)) m.set(r.orgId, { orgId: r.orgId, orgName: r.orgName, rows: [] })
      m.get(r.orgId).rows.push(r)
    }
    const groups = [...m.values()].sort((a, b) => b.rows.length - a.rows.length)
    return { rows, groups, total: rows.length }
  })
}

/** 顶部三个数：在职人数、部门数、有手机号的人数 */
export function contactStats() {
  const active = _ctActive()
  return {
    total: active.length,
    orgCount: new Set(active.map(e => e.orgId)).size,
    withPhone: active.filter(e => e.phone).length
  }
}

/** 当前登录人（页面高亮"我"） */
export function contactMe() {
  const me = currentOperator()
  return { empId: me.empId || '', name: me.name || '' }
}

/* ==================================================================
 * L4 第二批（21–28 页）：缴费流水 / 收费科目 / 巡检计划 / 巡检任务 /
 * 告警中心 / 车辆管理 / 通行记录 / 房屋台账
 * 同上：页面只 await 本段函数
 * ================================================================== */

/* 关联索引（一次性构建，避免每行都做全表 find） */
const HOUSE_COMMUNITY = new Map(houses.map(h => [h.houseId, h.communityId]))
const BILL_OF = new Map(bills.map(b => [b.billId, b]))
const PARKING_OF = new Map(parkings.map(p => [p.parkId, p]))
const PLAN_OF = new Map(inspectPlans.map(p => [p.planId, p]))
const DEVICE_OF = new Map(devices.map(d => [d.deviceId, d]))
const BUILDING_OF = new Map(buildings.map(b => [b.buildingId, b]))
const COMMUNITY_OF = new Map(communities.map(c => [c.communityId, c]))
const communityName = id => COMMUNITY_OF.get(id)?.name || '-'

/**
 * 只带 houseId 的实体（缴费流水 / 工单）向上派生楼栋与单元 —— 与房屋台账同源，避免两棵树口径打架。
 * units 表自带 name，因此不复用 houseTree 里的 unitLabel（那个函数定义在文件后半段，此处用会踩 TDZ）。
 */
const UNIT_OF = new Map(units.map(u => [u.unitId, u]))
const unitNameOf = id => UNIT_OF.get(id)?.name || id || '-'
const HOUSE_SPACE = new Map(houses.map(h => [h.houseId, h]))

// 车库区域口径：车位台账（26）与车行流水（27）共用同一套层级 —— 上移到此，供两处树构建复用
const ZONE_LABEL = { B1: 'B1 地下一层', B2: 'B2 地下二层', G: '地面' }
const zoneLabelOf = z => ZONE_LABEL[z] || z || '-'
/** 项目下拉：合同 / 公告页的「所属项目」筛选用（集团级合同 communityId 为空，另走虚拟节点） */
export const communityOpts = () => communities.map(c => ({ id: c.communityId, name: c.name }))

/**
 * 账单/流水的「承载对象」：有房屋显示房屋，无房屋（车位管理费一类挂在 parkId 上）显示车位号。
 * 放在数据层，避免各页对空 houseId 各写一套兜底。
 */
export const subjectLabel = (houseId, parkId) => {
  if (houseId) return HOUSE_NAME.get(houseId) || houseId
  const p = PARKING_OF.get(parkId)
  return p ? `车位 ${p.parkNo}` : '—'
}

/* ---------------- 21 · 缴费流水 ---------------- */

/** 缴费流水行：补上项目（来自房屋）与科目（来自账单），列表页不再自己 join */
const payRow = p => {
  const bill = BILL_OF.get(p.billId)
  /* 临时收费的流水没有账单、外部缴费人也没有房屋，所以先看流水自己带的 communityId */
  const cid = p.communityId || HOUSE_COMMUNITY.get(p.houseId) || bill?.communityId || ''
  const hs = HOUSE_SPACE.get(p.houseId)
  return {
    ...p,
    communityId: cid,
    communityName: communityName(cid),
    buildingId: hs?.buildingId || '',
    buildingName: hs ? (BUILDING_OF.get(hs.buildingId)?.name || hs.buildingId) : '',
    unitId: hs?.unitId || '',
    unitName: hs ? unitNameOf(hs.unitId) : '',
    /** house = 房屋类账单（可上溯到单元）；park = 车位管理费（无楼栋，只能落到项目） */
    subjectType: p.houseId ? 'house' : (bill?.parkId ? 'park' : ''),
    ownerName: ownerNameOf(p.ownerId),
    /** 车位管理费类流水没有 houseId，统一落到「车位 xxx」；
        临时收费没有承载房屋，承载对象是「付款方」 */
    subject: p.tempChargeId
      ? `临时 · ${p.tempPartyName || '—'}`
      : subjectLabel(p.houseId, bill?.parkId),
    itemName: bill?.itemName || p.tempItemName || '',
    period: bill?.period || '',
    /** 临时收费标记：流水页据此显示「临时」标签并按它筛选 */
    isTemp: !!p.tempChargeId,
    /* 收据与发票是**两个独立状态**（第 64 批）：只开收据的笔数不少，
       合成一个「已开票」会让台账查不出"还差一张发票"。老数据没有这个字段，兜底"未开具" */
    receiptStatus: p.receiptStatus || '未开具',
    receiptNo: p.receiptNo || '',
    /* 组合支付：这一笔实际由哪几种方式组成。老数据没有 splits，_splitsOf 用 method 兜底 */
    splits: _splitsOf(p),
    splitCount: _splitsOf(p).length
  }
}
const PAY_ROWS = payments.map(payRow)

/* ---------- 21 页三栏骨架（P1 升级）：树轴 项目 → 楼栋 → 单元 ---------- */

// parkonly 供「车位收费」分支复用；其余四个是收银对账视角
const PAY_VF = {
  parkonly: p => p.subjectType === 'park',
  /* 组合支付时 method 只存金额最大的一笔，光看它会漏掉"现金 + 微信"里的现金 */
  cash: p => _splitsOf(p).some(s => s.method === '现金'),
  uninvoiced: p => p.invoiceStatus === '未开票',
  red: p => p.invoiceStatus === '已冲红',
  deposit: p => p.channel === '预存抵扣',
  temp: p => !!p.isTemp,
  unreceipted: p => (p.receiptStatus || '未开具') === '未开具'
}

/**
 * 缴费流水树：项目 → 楼栋 → 单元。
 * 车位管理费没有 houseId、上溯不到楼栋，单独在项目下挂一个「车位收费」分支——
 * 不挂的话这部分流水（约占三成）在树视图里会凭空消失。
 */
export function payTree() {
  const roots = []
  const idx = new Map()
  const mk = (id, type, label, patch) => ({ id, type, label, n: 0, amount: 0, children: [], patch })
  for (const p of PAY_ROWS) {
    let c = idx.get(p.communityId)
    if (!c) {
      c = Object.assign(mk(p.communityId, 'community', communityName(p.communityId),
        { communityId: p.communityId, buildingId: '', unitId: '', vf: '' }), { _map: new Map(), _park: null })
      idx.set(p.communityId, c); roots.push(c)
    }
    let host
    if (p.subjectType === 'park') {
      if (!c._park) {
        c._park = mk(`${p.communityId}:__park`, 'park', '车位收费（无楼栋）',
          { communityId: p.communityId, buildingId: '', unitId: '', vf: 'parkonly' })
        c.children.push(c._park)
      }
      host = c._park
    } else {
      let b = c._map.get(p.buildingId)
      if (!b) {
        b = Object.assign(mk(p.buildingId, 'building', p.buildingName || p.buildingId,
          { communityId: p.communityId, buildingId: p.buildingId, unitId: '', vf: '' }), { _map: new Map() })
        c.children.push(b); c._map.set(p.buildingId, b)
      }
      let u = b._map.get(p.unitId)
      if (!u) {
        u = mk(p.unitId, 'unit', p.unitName || p.unitId,
          { communityId: p.communityId, buildingId: p.buildingId, unitId: p.unitId, vf: '' })
        b.children.push(u); b._map.set(p.unitId, u)
      }
      host = u
    }
    host.n++
    host.amount += p.amount || 0
  }
  const tidy = node => {
    if (node.children.length) {
      node.children.forEach(tidy)
      // 车位分支排到楼栋之后，读起来是「楼栋…楼栋…车位」
      node.children.sort((a, b) => (a.type === b.type ? (a.id < b.id ? -1 : 1) : (a.type === 'park' ? 1 : -1)))
      node.n = node.children.reduce((s, x) => s + x.n, 0)
      node.amount = node.children.reduce((s, x) => s + x.amount, 0)
    }
    delete node._map
    delete node._park
    return node
  }
  return roots.map(tidy)
}

export const payVirtualNodes = () => Object.entries(PAY_VF)
  .filter(([key]) => key !== 'parkonly')
  .map(([key, hit]) => ({
    key,
    label: { cash: '现金收款', uninvoiced: '未开票', red: '已冲红', deposit: '预存抵扣' }[key],
    n: PAY_ROWS.filter(hit).length,
    patch: { vf: key, communityId: '', buildingId: '', unitId: '' }
  }))

/* ---------- 18 页三栏骨架（P1 升级）：账单树轴 项目 → 楼栋 → 单元 ---------- */

/** 账单行：与缴费流水共用同一套空间派生（HOUSE_SPACE），保证两棵树口径一致 */
/** 账单派生行：补空间字段。写成函数以便写操作后重建（_syncBillRow） */
const billRow = b => {
  const hs = HOUSE_SPACE.get(b.houseId)
  return {
    ...b,
    buildingId: hs?.buildingId || '',
    buildingName: hs ? (BUILDING_OF.get(hs.buildingId)?.name || hs.buildingId) : '',
    unitId: hs?.unitId || '',
    unitName: hs ? unitNameOf(hs.unitId) : '',
    subjectType: b.houseId ? 'house' : (b.parkId ? 'park' : '')
  }
}
const BILL_ROWS = bills.map(billRow)

// parkonly 供「车位账单」分支复用；其余四个是催缴视角
const BILL_VF = {
  parkonly: b => b.subjectType === 'park',
  debt: b => (b.unpaid || 0) > 0,
  overdue: b => (b.overdueDays || 0) > 0,
  unpaid: b => b.status === '未缴',
  part: b => b.status === '部分缴'
}

/** 账单树：与缴费流水树同构（项目 → 楼栋 → 单元 + 车位分支），聚合应收与欠费 */
export function billTree() {
  const roots = []
  const idx = new Map()
  const mk = (id, type, label, patch) => ({ id, type, label, n: 0, payable: 0, unpaid: 0, debt: 0, children: [], patch })
  for (const b of BILL_ROWS) {
    let c = idx.get(b.communityId)
    if (!c) {
      c = Object.assign(mk(b.communityId, 'community', communityName(b.communityId),
        { communityId: b.communityId, buildingId: '', unitId: '', vf: '' }), { _map: new Map(), _park: null })
      idx.set(b.communityId, c); roots.push(c)
    }
    let host
    if (b.subjectType === 'park') {
      if (!c._park) {
        c._park = mk(`${b.communityId}:__park`, 'park', '车位账单（无楼栋）',
          { communityId: b.communityId, buildingId: '', unitId: '', vf: 'parkonly' })
        c.children.push(c._park)
      }
      host = c._park
    } else {
      let bd = c._map.get(b.buildingId)
      if (!bd) {
        bd = Object.assign(mk(b.buildingId, 'building', b.buildingName || b.buildingId,
          { communityId: b.communityId, buildingId: b.buildingId, unitId: '', vf: '' }), { _map: new Map() })
        c.children.push(bd); c._map.set(b.buildingId, bd)
      }
      let u = bd._map.get(b.unitId)
      if (!u) {
        u = mk(b.unitId, 'unit', b.unitName || b.unitId,
          { communityId: b.communityId, buildingId: b.buildingId, unitId: b.unitId, vf: '' })
        bd.children.push(u); bd._map.set(b.unitId, u)
      }
      host = u
    }
    host.n++
    host.payable += b.payable || 0
    host.unpaid += b.unpaid || 0
    if ((b.unpaid || 0) > 0) host.debt++
  }
  const tidy = node => {
    if (node.children.length) {
      node.children.forEach(tidy)
      node.children.sort((a, b) => (a.type === b.type ? (a.id < b.id ? -1 : 1) : (a.type === 'park' ? 1 : -1)))
      node.n = node.children.reduce((s, x) => s + x.n, 0)
      node.payable = node.children.reduce((s, x) => s + x.payable, 0)
      node.unpaid = node.children.reduce((s, x) => s + x.unpaid, 0)
      node.debt = node.children.reduce((s, x) => s + x.debt, 0)
    }
    delete node._map
    delete node._park
    return node
  }
  return roots.map(tidy)
}

export const billVirtualNodes = () => Object.entries(BILL_VF)
  .filter(([key]) => key !== 'parkonly')
  .map(([key, hit]) => ({
    key,
    label: { debt: '有欠费', overdue: '已逾期', unpaid: '未缴', part: '部分缴' }[key],
    n: BILL_ROWS.filter(hit).length,
    patch: { vf: key, communityId: '', buildingId: '', unitId: '' }
  }))

/** 账单全量口径（当前页小计改由页面算，这里给全量，避免数字随翻页漂移） */
export function billQuerySummary() {
  return {
    total: BILL_ROWS.length,
    payable: BILL_ROWS.reduce((s, b) => s + (b.payable || 0), 0),
    unpaid: BILL_ROWS.reduce((s, b) => s + (b.unpaid || 0), 0),
    debtCount: BILL_ROWS.filter(b => (b.unpaid || 0) > 0).length,
    overdueCount: BILL_ROWS.filter(b => (b.overdueDays || 0) > 0).length
  }
}

/* ---------- 19 页三栏骨架（P1 升级）：工单树轴 项目 → 楼栋 → 单元 ---------- */

/** 工单行：只有入户维修类（约两成）带 houseId，公共区域 / 投诉 / 咨询类没有房屋归属 */
const WO_ROWS = workOrders.map(w => {
  const hs = HOUSE_SPACE.get(w.houseId)
  return {
    ...w,
    buildingId: hs?.buildingId || '',
    buildingName: hs ? (BUILDING_OF.get(hs.buildingId)?.name || hs.buildingId) : '',
    unitId: hs?.unitId || '',
    unitName: hs ? unitNameOf(hs.unitId) : '',
    subjectType: w.houseId ? 'house' : 'public'
  }
})

const WO_OPEN = ['待派单', '已派单', '处理中', '待确认']
// nohouse 供「公共/非入户」分支复用；其余四个是工单管理视角
const WO_VF = {
  nohouse: w => !w.houseId,
  business: w => w.type === '商业服务',
  pending: w => w.status === '待派单',
  overdue: w => !!w.isOverdue,
  urgent: w => w.priority === '特急' || w.priority === '紧急',
  open: w => WO_OPEN.includes(w.status),
  /* 完工未评价：业主端只在「已完工 且 无评分」时给评价入口，
     所以后台这个视图与业主能评的范围必须是同一个条件 —— 否则催评催不到人 */
  unrated: w => w.status === '已完工' && !(Number(w.score) > 0)
}

/** 工单树：项目 → 楼栋 → 单元；无房屋的公共/投诉类挂在项目下的「公共/非入户」分支 */
export function woTree() {
  const roots = []
  const idx = new Map()
  const mk = (id, type, label, patch) => ({ id, type, label, n: 0, overdue: 0, open: 0, children: [], patch })
  for (const w of WO_ROWS) {
    let c = idx.get(w.communityId)
    if (!c) {
      c = Object.assign(mk(w.communityId, 'community', communityName(w.communityId),
        { communityId: w.communityId, buildingId: '', unitId: '', vf: '' }), { _map: new Map(), _pub: null })
      idx.set(w.communityId, c); roots.push(c)
    }
    let host
    if (!w.houseId) {
      if (!c._pub) {
        c._pub = mk(`${w.communityId}:__pub`, 'public', '公共 / 非入户工单',
          { communityId: w.communityId, buildingId: '', unitId: '', vf: 'nohouse' })
        c.children.push(c._pub)
      }
      host = c._pub
    } else {
      let bd = c._map.get(w.buildingId)
      if (!bd) {
        bd = Object.assign(mk(w.buildingId, 'building', w.buildingName || w.buildingId,
          { communityId: w.communityId, buildingId: w.buildingId, unitId: '', vf: '' }), { _map: new Map() })
        c.children.push(bd); c._map.set(w.buildingId, bd)
      }
      let u = bd._map.get(w.unitId)
      if (!u) {
        u = mk(w.unitId, 'unit', w.unitName || w.unitId,
          { communityId: w.communityId, buildingId: w.buildingId, unitId: w.unitId, vf: '' })
        bd.children.push(u); bd._map.set(w.unitId, u)
      }
      host = u
    }
    host.n++
    if (w.isOverdue) host.overdue++
    if (WO_OPEN.includes(w.status)) host.open++
  }
  const tidy = node => {
    if (node.children.length) {
      node.children.forEach(tidy)
      node.children.sort((a, b) => (a.type === b.type ? (a.id < b.id ? -1 : 1) : (a.type === 'public' ? 1 : -1)))
      node.n = node.children.reduce((s, x) => s + x.n, 0)
      node.overdue = node.children.reduce((s, x) => s + x.overdue, 0)
      node.open = node.children.reduce((s, x) => s + x.open, 0)
    }
    delete node._map
    delete node._pub
    return node
  }
  return roots.map(tidy)
}

export const woVirtualNodes = () => Object.entries(WO_VF)
  .filter(([key]) => key !== 'nohouse')
  .map(([key, hit]) => ({
    key,
    label: {
      business: '商业服务（收费）',
      pending: '待派单', overdue: '已超时', urgent: '紧急及以上', open: '未闭环',
      unrated: '完工未评价'
    }[key],
    n: WO_ROWS.filter(hit).length,
    patch: { vf: key, communityId: '', buildingId: '', unitId: '' }
  }))

/**
 * 评价标签：**固定五项**（2026-11-13 定）。
 * 业主端、员工端、后台读同一份，避免三端各写一套、
 * 最后"准时上门"在报表里拼不出一个词。
 */
export const WO_EVAL_TAGS = ['准时上门', '讲解清楚', '收拾干净', '收费透明', '态度好']

/**
 * 满意度。
 *
 * 三条口径写死在这里：
 *   ① **未评价（score=0）不参与均值** —— 拿 0 分去平均，满意度会被一群"没评"的单拉垮；
 *   ② 参评率 = 已评价 ÷ 可评单（已完工 + 已评价 + 已关闭），
 *      分母不含待派单/处理中，那些还没到能评的阶段；
 *   ③ 差评 = 1~2 星，要能单独拉名单去回访，不混在"平均 4.3 分"里。
 */
export function woSatisfaction({ communityId = '', from = '', to = '' } = {}) {
  const hit = w => (!communityId || w.communityId === communityId)
    && (!from || String(w.createTime).slice(0, 7) >= from)
    && (!to || String(w.createTime).slice(0, 7) <= to)
  const list = WO_ROWS.filter(hit)
  const rated = list.filter(w => Number(w.score) > 0)
  const rateable = list.filter(w => ['已完工', '已评价', '已关闭'].includes(w.status))
  const avg = rated.length
    ? Math.round(rated.reduce((sum, w) => sum + Number(w.score), 0) / rated.length * 100) / 100
    : 0
  const dist = [1, 2, 3, 4, 5].map(n => ({ score: n, n: rated.filter(w => Number(w.score) === n).length }))
  const tagMap = new Map()
  for (const w of rated) for (const t of (w.evalTags || [])) tagMap.set(t, (tagMap.get(t) || 0) + 1)
  const byStaff = new Map()
  for (const w of rated) {
    if (!w.assignee) continue
    const cur = byStaff.get(w.assignee) || { name: w.assignee, count: 0, sum: 0, low: 0 }
    cur.count += 1
    cur.sum += Number(w.score)
    if (Number(w.score) <= 2) cur.low += 1
    byStaff.set(w.assignee, cur)
  }
  return {
    total: list.length,
    rateable: rateable.length,
    ratedCount: rated.length,
    unratedCount: rateable.filter(w => !(Number(w.score) > 0)).length,
    evalRate: rateable.length ? Math.round(rated.length / rateable.length * 10000) / 100 : 0,
    avg,
    lowCount: rated.filter(w => Number(w.score) <= 2).length,
    /* 差评名单：平均分看不出"哪位业主很不满"，这里直接给单号 */
    lowList: rated.filter(w => Number(w.score) <= 2)
      .sort((a, b) => Number(a.score) - Number(b.score))
      .slice(0, 10)
      .map(w => ({ woId: w.woId, woNo: w.woNo, score: Number(w.score), assignee: w.assignee, evaluate: w.evaluate || '', ownerName: w.ownerName })),
    dist,
    tags: [...tagMap.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    byStaff: [...byStaff.values()]
      .map(x => ({ name: x.name, count: x.count, avg: Math.round(x.sum / x.count * 100) / 100, low: x.low }))
      .sort((a, b) => b.avg - a.avg)
  }
}

export function woQuerySummary() {
  return {
    total: WO_ROWS.length,
    open: WO_ROWS.filter(w => WO_OPEN.includes(w.status)).length,
    /* 2026-10-30 口径更正：原按自然小时算超时（种子里 isOverdue 就是这么来的），
       现统一走 SLA 工作日历 —— 周五 17:00 的单 24h 到期是周一 17:00，不是周六。
       KPI 与列表「SLA 剩余」列必须同源，否则同一页两个数。 */
    overdue: WO_ROWS.filter(w => {
      /* 只统计「还在办且已超时」的单：已结单的迟到单不占这个数，否则 KPI 与列表列里显示的「已结单」打架 */
      if (SLA_DONE_STATUS.includes(w.status) || SLA_EXCLUDE_STATUS.includes(w.status)) return false
      const s = woSlaState(w)
      return !!s && s.breached
    }).length,
    pending: WO_ROWS.filter(w => w.status === '待派单').length,
    ...(() => {
      const sat = woSatisfaction()
      return { avgScore: sat.avg, evalRate: sat.evalRate, unrated: sat.unratedCount }
    })()
  }
}

/** 缴费流水筛选谓词：列表与「范围小计」共用；subjectType 承接原树的「车位收费」分支 */
function _payHit(filters = {}) {
  const vf = PAY_VF[filters.vf]
  return p =>
    eq(p, filters.communityId, 'communityId') &&
    eq(p, filters.buildingId, 'buildingId') &&
    eq(p, filters.unitId, 'unitId') &&
    eq(p, filters.subjectType, 'subjectType') &&
    (!vf || vf(p)) &&
    eq(p, filters.method, 'method') &&
    eq(p, filters.channel, 'channel') &&
    eq(p, filters.invoiceStatus, 'invoiceStatus') &&
    between(p.payTime, filters.range) &&
    kwHit(p, filters.kw, ['payId', 'transNo', 'operator', 'itemName', 'method', 'channel'],
      `${p.ownerName} ${p.subject}`)
}

export function queryPayments({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    assertInScope({ communityId: filters.communityId, buildingId: filters.buildingId, unitId: filters.unitId })
    const list = scopeFilter(PAY_ROWS, { house: p => p.houseId }).filter(_payHit(filters))
      .sort((a, b) => (a.payTime < b.payTime ? 1 : -1))
    return paged(list, pageNo, size)
  })
}

/** 当前筛选范围的小计：笔数 + 金额（去树后替代树节点上的金额） */
export function payScopeSummary(filters = {}) {
  const list = scopeFilter(PAY_ROWS, { house: p => p.houseId }).filter(_payHit(filters))
  return {
    count: list.length,
    amount: Math.round(list.reduce((s, p) => s + (p.amount || 0), 0) * 100) / 100,
    cash: list.filter(p => p.method === '现金').length,
    uninvoiced: list.filter(p => p.invoiceStatus === '未开票').length
  }
}

/** 流水详情：流水 → 账单 → 房屋 → 业主，四层关联 */
export function getPaymentDetail(payId) {
  return delay(() => {
    const payment = PAY_ROWS.find(p => p.payId === payId)
    if (!payment) return null
    return {
      payment,
      bill: BILL_OF.get(payment.billId) || null,
      house: houses.find(h => h.houseId === payment.houseId) || null,
      owner: owners.find(o => o.ownerId === payment.ownerId) || null,
      /** 同账单的其他流水（部分缴场景会有多条） */
      siblings: PAY_ROWS.filter(p => p.billId === payment.billId && p.payId !== payId),
      /** 该流水的退款记录：契约详情里有 refunds[]，本地必须同形，否则页面两边跑两套 */
      refunds: REFUND_ROWS.filter(r => r.payId === payId)
    }
  })
}

/** 流水 KPI：口径统一（今日 / 本月 / 渠道构成） */
export function paymentSummary() {
  const today = '2026-10-21'
  const month = '2026-10'
  const sum = list => list.reduce((s, p) => s + (p.amount || 0), 0)
  return {
    total: PAY_ROWS.length,
    amount: sum(PAY_ROWS),
    todayCount: PAY_ROWS.filter(p => String(p.payTime).slice(0, 10) === today).length,
    todayAmount: sum(PAY_ROWS.filter(p => String(p.payTime).slice(0, 10) === today)),
    monthCount: PAY_ROWS.filter(p => String(p.payTime).slice(0, 7) === month).length,
    monthAmount: sum(PAY_ROWS.filter(p => String(p.payTime).slice(0, 7) === month)),
    /** 现金收款笔数：与虚拟节点同源（PAY_VF.cash），收银对账要直接读，不能靠 byMethod 数组反查 */
    cashCount: PAY_ROWS.filter(p => p.method === '现金').length,
    cashAmount: sum(PAY_ROWS.filter(p => p.method === '现金')),
    byChannel: groupCount(PAY_ROWS, 'channel'),
    byMethod: groupCount(PAY_ROWS, 'method'),
    invoiced: PAY_ROWS.filter(p => p.invoiceStatus === '已开票').length
  }
}
export const payMethodOpts = () => distinct(payments, 'method')
export const payChannelOpts = () => distinct(payments, 'channel')
export const invoiceStatusOpts = () => distinct(payments, 'invoiceStatus')

/* ---------------- 22 · 收费科目 ---------------- */

/** 科目行：挂上账单聚合（应收 / 实收 / 收缴率），口径复用 feeSummary 的定义 */
/**
 * 科目行。
 *
 * 2026-11-13 清理了一处重复：`feeItems.category`（常规服务费/公摊/代收/能耗/押金/经营性/工本费）
 * 是**第三套分类**，与费用分类字典、与「一级/二级」都对不上 —— 删掉，
 * 分类只认 `feeItemCategoryMap` 挂到字典二级。
 *
 * 新增 `direction`：billable（可开单的收入科目）/ liability（押金类负债）。
 * 押金混在收入科目里统计，科目页的"应收/收缴率"会把它算进去 —— 押金根本没有应收。
 *
 * 新增 `priceMode`：standard（科目价就是成交价）/ reference（只是参考价，
 * 真实价在价目表或账单快照里，水电就是这一类）。
 */
export function feeItemRows() {
  return feeItems.map(it => {
    const list = bills.filter(b => b.itemId === it.itemId)
    const s = feeSummaryOf(list)
    return {
      ...it,
      ...s,
      direction: it.direction || 'billable',
      directionName: it.direction === 'liability' ? '负债（押金）' : '收入科目',
      priceMode: it.priceMode || 'standard'
    }
  })
}
function feeSummaryOf(list) {
  const valid = effectiveBills(list)
  const receivable = valid.reduce((s, b) => s + (b.payable || 0), 0)
  const received = valid.reduce((s, b) => s + (b.paidAmount || 0), 0)
  return {
    billCount: list.length,
    receivable,
    received,
    debt: debtOf(valid),
    rate: receivable ? (received / receivable) * 100 : 0,
    openCount: valid.filter(isDebt).length
  }
}
/** 方向选项（筛选与表单共用） */
export const FEE_ITEM_DIRECTIONS = [
  { value: 'billable', label: '收入科目' },
  { value: 'liability', label: '负债（押金）' }
]

export function queryFeeItems({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const list = feeItemRows().filter(i =>
      eq(i, filters.direction, 'direction') &&
      eq(i, filters.status, 'status') &&
      eq(i, filters.calcType, 'calcType') &&
      kwHit(i, filters.kw, ['itemId', 'name', 'remark'])
    )
    return paged(list, pageNo, size)
  })
}
/** 科目详情：科目 + 科目级汇总 + 最近账单 */
export function getFeeItemDetail(itemId) {
  return delay(() => {
    const item = feeItems.find(i => i.itemId === itemId)
    if (!item) return null
    const list = bills.filter(b => b.itemId === itemId)
    return {
      item,
      stat: feeSummaryOf(list),
      recentBills: list.slice(-8).reverse(),
      /** 各项目用量：同一科目在不同项目的应收差异 */
      byCommunity: communities.map(c => ({
        name: c.name, ...feeSummaryOf(list.filter(b => b.communityId === c.communityId))
      }))
    }
  })
}
export const feeCategoryOpts = () => distinct(feeItems, 'category')
export const feeCalcTypeOpts = () => distinct(feeItems, 'calcType')

/* ---------------- 23 · 巡检计划 ---------------- */

const planRow = p => {
  const ts = inspectTasks.filter(t => t.planId === p.planId)
  return {
    ...p,
    communityName: communityName(p.communityId),
    templateName: inspectTemplates.find(t => t.templateId === p.templateId)?.name || '-',
    taskCount: ts.length,
    doneCount: ts.filter(t => t.status === '已完成').length,
    overdueCount: ts.filter(t => t.status === '逾期').length,
    issueCount: ts.reduce((s, t) => s + (t.issueCount || 0), 0)
  }
}
const PLAN_ROWS = inspectPlans.map(planRow)

/** 写操作同步到派生行 PLAN_ROWS（列表 / 详情 / 汇总都读派生行） */
function _syncPlanRow(p, { insert = false } = {}) {
  const derived = planRow(p)
  const i = PLAN_ROWS.findIndex(r => r.planId === p.planId)
  if (i >= 0) PLAN_ROWS.splice(i, 1, derived)
  else if (insert) PLAN_ROWS.unshift(derived)
  else PLAN_ROWS.push(derived)
  return derived
}

export function queryInspectPlans({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const list = PLAN_ROWS.filter(p =>
      eq(p, filters.communityId, 'communityId') &&
      eq(p, filters.taskType, 'taskType') &&
      eq(p, filters.post, 'post') &&
      eq(p, filters.cycle, 'cycle') &&
      eq(p, filters.status, 'status') &&
      kwHit(p, filters.kw, ['planId', 'name', 'executor'])
    )
    return paged(list, pageNo, size)
  })
}
/** 计划详情：计划 + 模板 + 近 10 条任务 */
export function getInspectPlanDetail(planId) {
  return delay(() => {
    const plan = PLAN_ROWS.find(p => p.planId === planId)
    if (!plan) return null
    return {
      plan,
      template: inspectTemplates.find(t => t.templateId === plan.templateId) || null,
      community: COMMUNITY_OF.get(plan.communityId) || null,
      tasks: inspectTasks.filter(t => t.planId === planId).slice(0, 10)
    }
  })
}
export function inspectPlanSummary() {
  return {
    total: PLAN_ROWS.length,
    enabled: PLAN_ROWS.filter(p => p.status === '启用').length,
    stopped: PLAN_ROWS.filter(p => p.status !== '启用').length,
    taskTotal: PLAN_ROWS.reduce((s, p) => s + p.taskCount, 0),
    byCycle: groupCount(inspectPlans, 'cycle'),
    byPost: groupCount(inspectPlans, 'post')
  }
}
export const planPostOpts = () => distinct(inspectPlans, 'post')
export const planCycleOpts = () => distinct(inspectPlans, 'cycle')

/* ---------------- 24 · 巡检任务 ---------------- */

/** 任务详情：任务 → 模板 → 计划 → 项目，巡检执行页与列表页共用 */
export function getInspectTaskDetail(taskId) {
  return delay(() => {
    const task = inspectTasks.find(t => t.taskId === taskId)
    if (!task) return null
    return {
      task,
      template: inspectTemplates.find(t => t.templateId === task.templateId) || null,
      plan: PLAN_OF.get(task.planId) || null,
      community: COMMUNITY_OF.get(task.communityId) || null,
      /** 监督任务：被检班组与责任员工（用于展示「谁的问题」） */
      targetDept: task.targetDept ? orgs.find(o => o.orgId === task.targetDept) || null : null,
      hitEmployees: (task.issueItems || []).map(i => i.responsibleName).filter(Boolean),
      /** 已转工单时回连工单 */
      workOrder: task.refWoId ? workOrders.find(w => w.woId === task.refWoId) || null : null
    }
  })
}
/** 巡检任务类型：执行 = 一线作业；监督 = 部门经理核验下属达标情况 */
export const INSPECT_TASK_TYPES = ['执行', '监督']
export const taskPostOpts = () => distinct(inspectTasks, 'post')
export const taskStatusOpts = () => distinct(inspectTasks, 'status')

/* ---------------- 25 · 告警中心 ---------------- */

export function getAlarmDetail(alarmId) {
  return delay(() => {
    const alarm = alarms.find(a => a.alarmId === alarmId)
    if (!alarm) return null
    const device = DEVICE_OF.get(alarm.deviceId) || null
    return {
      alarm,
      device,
      community: COMMUNITY_OF.get(alarm.communityId) || null,
      /** 同设备的其他告警（判断是否为重复告警） */
      siblings: alarms.filter(a => a.deviceId === alarm.deviceId && a.alarmId !== alarmId).slice(0, 8)
    }
  })
}
export function alarmSummary() {
  const by = s => alarms.filter(a => a.status === s).length
  return {
    total: alarms.length,
    open: by('未处理'),
    handling: by('处理中'),
    closed: by('已关闭'),
    urgent: alarms.filter(a => a.level === '紧急').length,
    toWo: alarms.filter(a => a.dispatchWoId).length,
    byLevel: groupCount(alarms, 'level'),
    byType: groupCount(alarms, 'type')
  }
}
export const alarmTypeOpts = () => distinct(alarms, 'type')
export const alarmStatusOpts = () => distinct(alarms, 'status')
export const alarmLevelOpts = () => ['紧急', '重要', '一般', '提示']

/* ---------------- 26 · 车辆管理 ---------------- */

const vehicleRow = v => ({
  ...v,
  communityName: communityName(v.communityId),
  parkNo: PARKING_OF.get(v.parkId)?.parkNo || '-',
  ownerName: ownerNameOf(v.ownerId)
})
const VEHICLE_ROWS = vehicles.map(vehicleRow)

export function queryVehicles({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const list = VEHICLE_ROWS.filter(v =>
      eq(v, filters.communityId, 'communityId') &&
      eq(v, filters.vehicleType, 'vehicleType') &&
      eq(v, filters.authStatus, 'authStatus') &&
      eq(v, filters.inOutType, 'inOutType') &&
      kwHit(v, filters.kw, ['plateNo', 'brand', 'cardNo', 'ownerName', 'parkNo'])
    )
    return paged(list, pageNo, size)
  })
}
/** 车辆详情：车辆 + 业主 + 绑定车位 + 最近通行 */
export function getVehicleDetail(vehicleId) {
  return delay(() => {
    const vehicle = VEHICLE_ROWS.find(v => v.vehicleId === vehicleId)
    if (!vehicle) return null
    return {
      vehicle,
      owner: owners.find(o => o.ownerId === vehicle.ownerId) || null,
      parking: PARKING_OF.get(vehicle.parkId) || null,
      passes: passRecords
        .filter(p => p.plateNo === vehicle.plateNo)
        .sort((a, b) => (a.passTime < b.passTime ? 1 : -1))
        .slice(0, 10)
    }
  })
}
export function vehicleSummary() {
  return {
    total: vehicles.length,
    normal: VEHICLE_ROWS.filter(v => v.authStatus === '正常').length,
    abnormal: VEHICLE_ROWS.filter(v => v.authStatus !== '正常').length,
    monthly: VEHICLE_ROWS.filter(v => v.inOutType === '月卡').length,
    byType: groupCount(vehicles, 'vehicleType'),
    byAuth: groupCount(vehicles, 'authStatus'),
    byInOut: groupCount(vehicles, 'inOutType')
  }
}
export const vehicleTypeOpts = () => distinct(vehicles, 'vehicleType')
export const authStatusOpts = () => distinct(vehicles, 'authStatus')
export const inOutTypeOpts = () => distinct(vehicles, 'inOutType')

/* ---------------- 27 · 通行记录 ---------------- */

// 车行流水的车库归属不在自己身上，必须经 parkId 反查车位 —— 与车位台账同源，避免两棵树口径打架
const passRow = p => {
  const zone = PARKING_OF.get(p.parkId)?.zone || ''
  return {
    ...p,
    zone,
    zoneLabel: zoneLabelOf(zone),
    communityName: communityName(p.communityId),
    ownerName: ownerNameOf(p.ownerId),
    vehicleType: p.vehicleType || (vehicles.find(v => v.plateNo === p.plateNo)?.vehicleType ?? '')
  }
}
const PASS_ROWS = passRecords.map(passRow)

/** 车库区域候选：原树第二层，去树后落到筛选 */
export const passZoneOpts = () => [...new Set(PASS_ROWS.map(p => p.zone).filter(Boolean))]

function _passHit(filters = {}) {
  const vf = PASS_VF[filters.vf]
  return p =>
    eq(p, filters.communityId, 'communityId') &&
    eq(p, filters.zone, 'zone') &&
    (!vf || vf(p)) &&
    eq(p, filters.direction, 'direction') &&
    eq(p, filters.gate, 'gate') &&
    eq(p, filters.channel, 'channel') &&
    between(p.passTime, filters.range) &&
    kwHit(p, filters.kw, ['plateNo', 'parkNo', 'gate', 'ownerName', 'channel', 'operator', 'vehicleType'])
}

/** 当前筛选范围小计：进 / 出 / 临停收费 */
export function passScopeSummary(filters = {}) {
  const list = PASS_ROWS.filter(_passHit(filters))
  return {
    count: list.length,
    inCount: list.filter(p => p.direction === '入场').length,
    outCount: list.filter(p => p.direction === '出场').length,
    fee: Math.round(list.reduce((s, p) => s + (p.fee || 0), 0) * 100) / 100
  }
}

export function queryPassRecords({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const list = PASS_ROWS.filter(_passHit(filters))
      .sort((a, b) => (a.passTime < b.passTime ? 1 : -1))
    return paged(list, pageNo, size)
  })
}
/** 通行详情：记录 + 车辆 + 业主 + 同车牌最近记录（看一次进出的成对流水） */
export function getPassRecordDetail(passId) {
  return delay(() => {
    const record = PASS_ROWS.find(p => p.passId === passId)
    if (!record) return null
    return {
      record,
      vehicle: vehicles.find(v => v.plateNo === record.plateNo) || null,
      owner: owners.find(o => o.ownerId === record.ownerId) || null,
      parking: PARKING_OF.get(record.parkId) || null,
      siblings: PASS_ROWS.filter(p => p.plateNo === record.plateNo && p.passId !== passId).slice(0, 10)
    }
  })
}
export function passSummary() {
  const today = '2026-10-21'
  return {
    total: PASS_ROWS.length,
    inCount: PASS_ROWS.filter(p => p.direction === '入场').length,
    outCount: PASS_ROWS.filter(p => p.direction === '出场').length,
    todayCount: PASS_ROWS.filter(p => String(p.passTime).slice(0, 10) === today).length,
    feeTotal: PASS_ROWS.reduce((s, p) => s + (p.fee || 0), 0),
    /** 人工抬杆数：与虚拟节点同源（PASS_VF.manual），对账场景要直接读，不能靠 byChannel 数组反查 */
    manualCount: PASS_ROWS.filter(p => p.channel === '人工').length,
    byGate: groupCount(passRecords, 'gate'),
    byChannel: groupCount(passRecords, 'channel')
  }
}
export const passDirectionOpts = () => distinct(passRecords, 'direction')
export const passGateOpts = () => distinct(passRecords, 'gate')
export const passChannelOpts = () => distinct(passRecords, 'channel')

/* ---------- 27 页三栏骨架（P1 升级）：树轴 项目 → 车库区域 ---------- */

// 车行流水的第一诉求是「按车库对账」，四个虚拟节点都是对账/风控视角
const PASS_VF = {
  manual: p => p.channel === '人工',
  paid: p => (p.fee || 0) > 0,
  longstay: p => (p.stayMinutes || 0) >= 360,
  etc: p => p.channel === 'ETC'
}

/** 通行树：项目 → 车库区域。道闸不进树 —— 5 个道闸跨项目复用，进树会产生同名重复叶子 */
export function passTree() {
  const roots = []
  const idx = new Map()
  for (const p of PASS_ROWS) {
    let c = idx.get(p.communityId)
    if (!c) {
      c = {
        id: p.communityId, type: 'community', label: communityName(p.communityId),
        n: 0, fee: 0, children: [], _map: new Map(),
        patch: { communityId: p.communityId, zone: '', vf: '' }
      }
      idx.set(p.communityId, c); roots.push(c)
    }
    let z = c._map.get(p.zone)
    if (!z) {
      z = {
        id: `${p.communityId}:${p.zone}`, type: 'zone', label: zoneLabelOf(p.zone),
        n: 0, fee: 0, children: [],
        patch: { communityId: p.communityId, zone: p.zone, vf: '' }
      }
      c.children.push(z); c._map.set(p.zone, z)
    }
    z.n++
    z.fee += p.fee || 0
  }
  const tidy = node => {
    if (node.children.length) {
      node.children.forEach(tidy)
      node.n = node.children.reduce((s, x) => s + x.n, 0)
      node.fee = node.children.reduce((s, x) => s + x.fee, 0)
    }
    delete node._map
    return node
  }
  return roots.map(tidy)
}

export const passVirtualNodes = () => Object.entries(PASS_VF).map(([key, hit]) => ({
  key,
  label: { manual: '人工放行', paid: '临停收费', longstay: '停留 ≥6 小时', etc: 'ETC 通行' }[key],
  n: PASS_ROWS.filter(hit).length,
  patch: { vf: key, communityId: '', zone: '' }
}))

/* ---------------- 28 · 房屋台账 ---------------- */

/** 房屋台账行：补项目名与欠费（台账要一眼看出哪些房在欠费） */
const houseRow = h => {
  const hb = billsOfHouse(h.houseId)
  return {
    ...h,
    communityName: communityName(h.communityId),
    buildingName: BUILDING_OF.get(h.buildingId)?.name || '-',
    ownerName: ownerNameOf(h.ownerId),
    debt: debtOf(hb),
    openBills: hb.filter(isDebt).length
  }
}
const HOUSE_ROWS = houses.map(houseRow)

/** 虚拟节点命中：与列表 total 同源（都基于 HOUSE_ROWS），避免树上的数字和列表对不上 */
const HOUSE_VF = {
  /* 「空置」在业务口语里包含毛坯没人住，所以虚拟视图取三档之和；
     顶部的「空置房」KPI 只数 useStatus === '空置房' 那一档，两个数不一样是正常的 */
  empty: h => ['空置房', '已交房未装修', '装修未入住'].includes(h.useStatus),
  debt: h => h.debt > 0,
  decorating: h => h.useStatus === '正在装修',
  undelivered: h => h.useStatus === '未交房',
  unlicensed: h => h.propertyStatus === '未办理' || h.propertyStatus === '办理中'
}
export const houseVirtualNodes = () =>
  Object.entries(HOUSE_VF).map(([key, hit]) => ({
    key, label: VF_LABEL[key], n: HOUSE_ROWS.filter(hit).length,
    patch: { vf: key, communityId: '', buildingId: '', unitId: '', floor: '' }
  }))

export function queryHouseLedger({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const vf = HOUSE_VF[filters.vf]
    const list = scopeFilter(HOUSE_ROWS, { house: h => h.houseId }).filter(h =>
      eq(h, filters.communityId, 'communityId') &&
      eq(h, filters.buildingId, 'buildingId') &&
      eq(h, filters.unitId, 'unitId') &&
      eq(h, filters.floor, 'floor') &&
      eq(h, filters.stewardEmpId, 'stewardEmpId') &&
      eq(h, filters.usage, 'usage') &&
      eq(h, filters.houseType, 'houseType') &&
      eq(h, filters.useStatus, 'useStatus') &&
      (!vf || vf(h)) &&
      kwHit(h, filters.kw, ['room', 'fullName', 'houseId'], `${ownerNameOf(h.ownerId)}`)
    )
    return paged(list, pageNo, size)
  })
}
export function houseLedgerSummary() {
  const use = s => HOUSE_ROWS.filter(h => h.useStatus === s).length
  /* 六态逐档计数 + 两个组合口径：
     · occupied —— 已入住（自住与出租都算；居住关系改看 tenantId）
     · rent —— 已入住里挂了租客的
     · emptyAll —— 业务口语里的"空置"：空置房 + 已交房未装修 + 装修未入住
     · occupancyRate —— 入住率的分母是**已交付**房屋，未交房不算（还没到谈入住的时候） */
  const delivered = HOUSE_ROWS.filter(isDelivered).length
  const occupied = use('已入住')
  return {
    total: HOUSE_ROWS.length,
    delivered,
    undelivered: use('未交房'),
    occupied,
    selfUse: HOUSE_ROWS.filter(h => h.useStatus === '已入住' && !h.tenantId).length,
    rent: HOUSE_ROWS.filter(h => h.useStatus === '已入住' && h.tenantId).length,
    empty: use('空置房'),
    emptyAll: ['空置房', '已交房未装修', '装修未入住'].reduce((s, k) => s + use(k), 0),
    decorating: use('正在装修'),
    renovating: use('装修未入住'),
    deliveredRaw: use('已交房未装修'),
    occupancyRate: delivered ? Math.round(occupied / delivered * 1000) / 10 : 0,
    debtHouses: HOUSE_ROWS.filter(h => h.debt > 0).length,
    byUsage: groupCount(houses, 'usage'),
    byUseStatus: groupCount(houses, 'useStatus')
  }
}

/* ==================================================================
 * IA 段：空间树 / 范围 / 虚拟节点 / 跨页锚点
 * 三页（房屋台账 · 业主档案 · 车位与车辆）共用同一套骨架：
 *   树只管「范围」，筛选栏只管「属性」，两者 AND
 * 约定：树节点统一带 patch（= 要写回 query 的筛选片段），页面不自行拼条件
 * ================================================================== */

const VF_LABEL = { empty: '空置', debt: '欠费', decorating: '装修中', unlicensed: '未办证' }

/** 单元标签：unitId 形如 U01101，第 4 位是单元号 */
const unitLabel = id => `${Number(String(id).charAt(3)) || 1}单元`

/**
 * 空间树：项目 → 楼栋 → 单元
 * 房间不进树（736 个叶子会让滚动条失控），楼层改由列表侧的楼层条承载
 */
export function houseTree() {
  const roots = []
  const idx = new Map()
  for (const h of HOUSE_ROWS) {
    let c = idx.get(h.communityId)
    if (!c) {
      c = {
        id: h.communityId, type: 'community', label: communityName(h.communityId),
        n: 0, empty: 0, debt: 0, children: [], _map: new Map(),
        patch: { communityId: h.communityId, buildingId: '', unitId: '' }
      }
      idx.set(h.communityId, c); roots.push(c)
    }
    let b = c._map.get(h.buildingId)
    if (!b) {
      b = {
        id: h.buildingId, type: 'building', label: BUILDING_OF.get(h.buildingId)?.name || h.buildingId,
        n: 0, empty: 0, debt: 0, children: [], _map: new Map(),
        patch: { communityId: h.communityId, buildingId: h.buildingId, unitId: '' }
      }
      c.children.push(b); c._map.set(h.buildingId, b)
    }
    let u = b._map.get(h.unitId)
    if (!u) {
      u = {
        id: h.unitId, type: 'unit', label: unitLabel(h.unitId),
        n: 0, empty: 0, debt: 0, children: [],
        patch: { communityId: h.communityId, buildingId: h.buildingId, unitId: h.unitId }
      }
      b.children.push(u); b._map.set(h.unitId, u)
    }
    u.n++
    if (['空置房', '已交房未装修', '装修未入住'].includes(h.useStatus)) u.empty++
    if (h.debt > 0) u.debt++
  }
  const tidy = node => {
    if (node.children.length) {
      node.children.forEach(tidy)
      node.children.sort((a, b) => (a.id < b.id ? -1 : 1))
      node.n = node.children.reduce((s, x) => s + x.n, 0)
      node.empty = node.children.reduce((s, x) => s + x.empty, 0)
      node.debt = node.children.reduce((s, x) => s + x.debt, 0)
    }
    delete node._map
    return node
  }
  return roots.map(tidy)
}

/** 树内检索用的附加词：节点名之外，还能按「业主名 / 房号」命中到单元 */
export function houseTreeSearchKeys() {
  const acc = {}
  const add = (id, s) => { acc[id] = (acc[id] ? acc[id] + ' ' : '') + s }
  for (const h of HOUSE_ROWS) {
    const txt = `${h.room} ${h.shortName} ${h.ownerName}`
    add(h.unitId, txt); add(h.buildingId, txt); add(h.communityId, txt)
  }
  return acc
}

/** 楼层热力：只在楼栋 / 单元范围下有意义，范围宽于楼栋时返回空（页面据此隐藏整条） */
export function houseFloorStats(scope = {}) {
  const { communityId = '', buildingId = '', unitId = '' } = scope
  if (!buildingId && !unitId) return []
  const list = HOUSE_ROWS.filter(h =>
    eq(h, communityId, 'communityId') && eq(h, buildingId, 'buildingId') && eq(h, unitId, 'unitId')
  )
  const map = new Map()
  for (const h of list) {
    const f = map.get(h.floor) || { floor: h.floor, n: 0, empty: 0, debt: 0 }
    f.n++
    if (['空置房', '已交房未装修', '装修未入住'].includes(h.useStatus)) f.empty++
    if (h.debt > 0) f.debt++
    map.set(h.floor, f)
  }
  return [...map.values()].sort((a, b) => a.floor - b.floor)
    .map(f => ({ ...f, ratio: f.n ? f.empty / f.n : 0 }))
}

/* ---------------- 业主：双轴（空间 / 权属） ---------------- */

/** 业主行：补名下房屋名 / 车位数 / 欠费，列表不用再二次查 */
const OWNER_ROWS = owners.map(o => {
  const hs = houses.filter(h => o.houseIds.includes(h.houseId))
  const bs = bills.filter(b => o.houseIds.includes(b.houseId) && isDebt(b))
  return {
    ...o,
    houseNames: hs.map(h => h.fullName),
    houseCount: hs.length,
    parkCount: (o.parkIds || []).length,
    debt: bs.reduce((s, b) => s + (b.unpaid || 0), 0)
  }
})

/** 业主 → 所属空间集合（一人多房时会命中多个项目 / 楼栋 / 单元） */
const OWNER_SCOPE = new Map(owners.map(o => {
  const hs = houses.filter(h => o.houseIds.includes(h.houseId))
  return [o.ownerId, {
    communities: new Set(hs.map(h => h.communityId)),
    buildings: new Set(hs.map(h => h.buildingId)),
    units: new Set(hs.map(h => h.unitId)),
    houses: new Set(hs.map(h => h.houseId))
  }]
}))
const ownerInScope = (o, key, id) => !id || OWNER_SCOPE.get(o.ownerId)?.[key].has(id)

/**
 * 业主行同步：OWNER_ROWS / OWNER_SCOPE 都是模块级派生结构，
 * 合并（房屋过户）与拆分（新增业主）只改 owners 原数组不会反映到列表，必须显式同步。
 */
function _syncOwnerRow(owner, { insert = false } = {}) {
  const id = owner.ownerId
  const hs = houses.filter(h => (owner.houseIds || []).includes(h.houseId))
  const bs = bills.filter(b => (owner.houseIds || []).includes(b.houseId) && isDebt(b))
  const row = {
    ...owner,
    houseNames: hs.map(h => h.fullName),
    houseCount: hs.length,
    parkCount: (owner.parkIds || []).length,
    debt: bs.reduce((s, b) => s + (b.unpaid || 0), 0)
  }
  const i = OWNER_ROWS.findIndex(r => r.ownerId === id)
  if (i >= 0) OWNER_ROWS.splice(i, 1, row)
  else if (insert) OWNER_ROWS.push(row)
  OWNER_SCOPE.set(id, {
    houses: new Set(hs.map(h => h.houseId)),
    communities: new Set(hs.map(h => h.communityId)),
    buildings: new Set(hs.map(h => h.buildingId)),
    units: new Set(hs.map(h => h.unitId))
  })
}

const OWNER_VF = {
  multi: o => (o.houseIds || []).length > 1,
  withPark: o => (o.parkIds || []).length > 0,
  noPark: o => !(o.parkIds || []).length,
  uncertified: o => !o.certified
}
export const ownerVirtualNodes = () => Object.entries(OWNER_VF).map(([key, hit]) => ({
  key,
  label: { multi: '一人多房', withPark: '有车位', noPark: '无车位', uncertified: '未认证' }[key],
  n: owners.filter(hit).length,
  patch: { vf: key, communityId: '', buildingId: '', unitId: '' }
}))

/** 权属轴：不走空间树，按「人」的属性分组（默认不展开，空间轴是默认轴） */
export function ownerTree() {
  const credit = distinct(owners, 'creditLevel')
  return [
    ...Object.entries(OWNER_VF).map(([key, hit]) => ({
      id: key, label: { multi: '一人多房', withPark: '有车位', noPark: '无车位', uncertified: '未认证' }[key],
      n: owners.filter(hit).length,
      patch: { vf: key, communityId: '', buildingId: '', unitId: '', creditLevel: '' }
    })),
    {
      id: 'credit', label: '信用等级', n: owners.length,
      patch: { vf: '', communityId: '', buildingId: '', unitId: '', creditLevel: '' },
      children: credit.map(lv => ({
        id: `credit:${lv}`, label: `${lv} 级`, n: owners.filter(o => o.creditLevel === lv).length,
        patch: { vf: '', communityId: '', buildingId: '', unitId: '', creditLevel: lv }
      }))
    }
  ]
}

/* ---------------- 车位与车辆：以「车位」为行，车辆作为列 ---------------- */

const PV_ROWS = parkings.map(p => {
  const v = vehicles.find(x => x.parkId === p.parkId) || null
  // daysBetween = 今天 - 到期日，所以「30 天内到期」= n ∈ [-30, 0]
  const n = daysBetween(p.expireDate)
  return {
    ...p,
    zoneLabel: ZONE_LABEL[p.zone] || p.zone,
    communityName: communityName(p.communityId),
    bound: !!v,
    expiring: n !== null && n <= 0 && n >= -30,
    vehicleId: v?.vehicleId || '',
    plateNo: v?.plateNo || p.plateNo || '',
    ownerName: ownerNameOf(p.ownerId) || ownerNameOf(v?.ownerId) || '—',
    authStatus: v?.authStatus || '—',
    vehicleType: v?.vehicleType || '—',
    inOutType: v?.inOutType || '—'
  }
})

/** 车位树：项目 → 区域 → 产权状态（车位号不进树，640 个叶子同样会失控，改走关键字） */
export function parkTree() {
  const roots = []
  const idx = new Map()
  for (const p of PV_ROWS) {
    let c = idx.get(p.communityId)
    if (!c) {
      c = {
        id: p.communityId, type: 'community', label: communityName(p.communityId),
        n: 0, bound: 0, idle: 0, children: [], _map: new Map(),
        patch: { communityId: p.communityId, zone: '', status: '', vf: '' }
      }
      idx.set(p.communityId, c); roots.push(c)
    }
    let z = c._map.get(p.zone)
    if (!z) {
      z = {
        id: `${p.communityId}:${p.zone}`, type: 'zone', label: ZONE_LABEL[p.zone] || p.zone,
        n: 0, bound: 0, idle: 0, children: [], _map: new Map(),
        patch: { communityId: p.communityId, zone: p.zone, status: '', vf: '' }
      }
      c.children.push(z); c._map.set(p.zone, z)
    }
    let s = z._map.get(p.status)
    if (!s) {
      s = {
        id: `${p.communityId}:${p.zone}:${p.status}`, type: 'status', label: p.status,
        n: 0, bound: 0, idle: 0, children: [],
        patch: { communityId: p.communityId, zone: p.zone, status: p.status, vf: '' }
      }
      z.children.push(s); z._map.set(p.status, s)
    }
    s.n++
    if (p.bound) s.bound++
    if (p.status === '闲置') s.idle++
  }
  const tidy = node => {
    if (node.children.length) {
      node.children.forEach(tidy)
      node.n = node.children.reduce((s2, x) => s2 + x.n, 0)
      node.bound = node.children.reduce((s2, x) => s2 + x.bound, 0)
      node.idle = node.children.reduce((s2, x) => s2 + x.idle, 0)
    }
    delete node._map
    return node
  }
  return roots.map(tidy)
}

const PARK_VF = {
  bound: p => p.bound,
  idle: p => p.status === '闲置',
  disabled: p => p.status === '不可用',
  expiring: p => { const d = daysBetween(p.expireDate); return d !== null && d <= 0 && d >= -30 }
}
export const parkVirtualNodes = () => Object.entries(PARK_VF).map(([key, hit]) => ({
  key,
  label: { bound: '已绑定车辆', idle: '闲置车位', disabled: '不可用', expiring: '30 天内到期' }[key],
  n: PV_ROWS.filter(hit).length,
  patch: { vf: key, communityId: '', zone: '', status: '' }
}))

export function queryParkingVehicles({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const vf = PARK_VF[filters.vf]
    const list = PV_ROWS.filter(p =>
      eq(p, filters.communityId, 'communityId') &&
      eq(p, filters.zone, 'zone') &&
      eq(p, filters.status, 'status') &&
      eq(p, filters.bindStatus, 'bindStatus') &&
      eq(p, filters.ownerId, 'ownerId') &&
      eq(p, filters.vehicleType, 'vehicleType') &&
      eq(p, filters.authStatus, 'authStatus') &&
      (!vf || vf(p)) &&
      kwHit(p, filters.kw, ['parkNo', 'plateNo', 'ownerName', 'cardNo'])
    )
    return paged(list, pageNo, size)
  })
}
/**
 * 车位与车辆 KPI（原「车位车牌绑定」页的 parkingBindSummary 已并入此处）
 * 口径说明：bound / unbound 按「有没有车」，idle / disabled 按「产权状态」——
 * 两者不是同一维度：unbound(192) = idle(158) + disabled(34)，页面只展示其中一组。
 */
export function parkingSummary() {
  return {
    total: PV_ROWS.length,
    bound: PV_ROWS.filter(p => p.bound).length,
    unbound: PV_ROWS.filter(p => !p.bound).length,
    idle: PV_ROWS.filter(p => p.status === '闲置').length,
    disabled: PV_ROWS.filter(p => p.status === '不可用').length,
    expiring: PV_ROWS.filter(PARK_VF.expiring).length
  }
}

/* ---------------- 换绑留痕（真表 · H2） ----------------
 * 以前是 parkingBindLogs(parking, vehicle) 现算出来的，提交换绑只往 detailData 里 push 一条，
 * **刷新即丢**。业主端已经能自助换绑，后台看不见记录 = 出纠纷时无法举证。
 * 现在改真表：换绑、解绑、客服重置都落一条，记录区把「真表 + 两条派生说明」拼起来。
 */
const PARK_CHANGE_LOGS = []
let _PARK_LOG_SEQ = 0

const PARK_CHANGE_SOURCE = ['业主自助', '物业代操作', '物业重置']
const PARK_VENDOR_STATUS = ['待同步', '已同步', '失败']

const parkMonthOf = at => String(at || '').slice(0, 7)
const _parkNowMonth = () => String(TODAY).slice(0, 7)

/** 车位写权限：换绑、解绑、重置次数都走这一个码 */
export const canEditVehicles = () => _hasPerm('a.vehicles.edit')

/** 每车位每月上限：读系统参数，读不到按 1 次兜底 */
export function parkPlateLimit() {
  const p = PARAMS.find(x => x.key === 'park.plateChangeLimit')
  const n = Number(p?.value)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function _parkLogRow(r) {
  return {
    ...r,
    sourceType: r.source === '业主自助' ? 'warning' : (r.source === '物业重置' ? 'info' : ''),
    vendorType: r.vendorStatus === '已同步' ? 'success' : (r.vendorStatus === '失败' ? 'danger' : 'warning')
  }
}

/** 本月已换次数：以「最后一次重置」为界，重置之前的记录不计入 */
export function parkMonthChangeCount(parkId) {
  const month = _parkNowMonth()
  const mine = PARK_CHANGE_LOGS
    .filter(r => r.parkId === parkId && parkMonthOf(r.at) === month)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
  const lastReset = [...mine].reverse().find(r => r.source === '物业重置')
  const from = lastReset ? mine.indexOf(lastReset) + 1 : 0
  return mine.slice(from).filter(r => r.source !== '物业重置').length
}

export function parkingLogsOf(parkId) {
  return PARK_CHANGE_LOGS
    .filter(r => r.parkId === parkId)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map(_parkLogRow)
}

/** 写一条换绑/解绑/重置记录。页面提交后调它，别再往 detailData 里 push。 */
export function addParkingChangeLog(rec = {}) {
  const parking = PV_ROWS.find(p => p.parkId === rec.parkId)
  if (!parking) throw new Error('车位不存在')
  _PARK_LOG_SEQ += 1
  const row = {
    logId: 'PL' + String(_PARK_LOG_SEQ).padStart(5, '0'),
    parkId: parking.parkId,
    parkNo: parking.parkNo,
    fromPlate: rec.fromPlate || '',
    toPlate: rec.toPlate || '',
    source: PARK_CHANGE_SOURCE.includes(rec.source) ? rec.source : '物业代操作',
    operatorName: rec.operatorName || currentOperator().name || '—',
    vendorStatus: PARK_VENDOR_STATUS.includes(rec.vendorStatus) ? rec.vendorStatus : '待同步',
    at: rec.at || `${TODAY} ${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`,
    reason: rec.reason || ''
  }
  PARK_CHANGE_LOGS.push(row)
  // 变更同步到车位本体 + 车辆表，否则详情页读完还是老车牌（这里才是唯一真源）
  if (rec.source !== '物业重置') {
    const vi = vehicles.findIndex(v => v.parkId === parking.parkId)
    if (row.toPlate) {
      parking.plateNo = row.toPlate
      parking.bindStatus = '已绑定'
      parking.bound = true
      if (vi >= 0) {
        vehicles[vi].plateNo = row.toPlate
        vehicles[vi].authStatus = '待审核'
      } else {
        const maxId = vehicles.reduce((m, v) => Math.max(m, Number(String(v.vehicleId).replace(/\D/g, '')) || 0), 0)
        vehicles.push({
          vehicleId: 'VH' + String(maxId + 1).padStart(5, '0'),
          plateNo: row.toPlate,
          ownerId: parking.ownerId || '',
          parkId: parking.parkId,
          communityId: parking.communityId || '',
          vehicleType: '小型车',
          brand: '—',
          color: '—',
          cardNo: '—',
          authStatus: '待审核',
          inOutType: '月卡'
        })
      }
    } else if (row.fromPlate) {
      parking.plateNo = ''
      parking.bindStatus = '未绑定'
      parking.bound = false
      if (vi >= 0) vehicles.splice(vi, 1)
    }
  }
  return _parkLogRow({ ...row })
}

/** 客服兜底：把本月已换次数清零（记一条重置日志，可追溯） */
export function resetParkMonthChanges(parkId, reason = '') {
  const parking = PV_ROWS.find(p => p.parkId === parkId)
  if (!parking) throw new Error('车位不存在')
  if (!_hasPerm('a.vehicles.edit')) throw new Error('当前角色没有重置换绑次数的权限（a.vehicles.edit）')
  const used = parkMonthChangeCount(parkId)
  if (!used) throw new Error('本月还没有换绑记录，无需重置')
  if (!String(reason).trim()) throw new Error('请填写重置原因')
  return addParkingChangeLog({
    parkId,
    source: '物业重置',
    operatorName: currentOperator().name,
    vendorStatus: '已同步',
    reason: `${reason}（重置前本月 ${used} 次）`
  })
}

/** 换绑留痕：真表记录在前，交付 / 授权两条派生说明在后 */
export function parkingBindLogs(parking, vehicle) {
  if (!parking) return []
  const logs = parkingLogsOf(parking.parkId).map(r => ({
    title: r.source === '物业重置'
      ? '客服重置本月换绑次数'
      : (r.toPlate ? `换绑 ${r.fromPlate || '—'} → ${r.toPlate}` : `解除绑定 ${r.fromPlate || '—'}`),
    memo: [
      r.at,
      r.source,
      r.operatorName,
      r.reason,
      r.source === '物业重置' ? '' : `厂商${r.vendorStatus}`
    ].filter(Boolean).join(' · '),
    done: r.vendorStatus === '已同步',
    source: r.source,
    vendorStatus: r.vendorStatus,
    at: r.at,
    operatorName: r.operatorName,
    reason: r.reason,
    logId: r.logId,
    fromPlate: r.fromPlate,
    toPlate: r.toPlate
  }))
  if (vehicle) {
    logs.push({ title: `授权状态 ${vehicle.authStatus} · ${vehicle.inOutType}`, memo: '道闸白名单已下发', done: true })
  } else {
    logs.push({ title: '尚未绑定车牌', memo: '可直接用于新业主 / 租户分配', done: false })
  }
  if (parking.expireDate) {
    logs.push({
      title: `管理费续期至 ${parking.expireDate}`,
      memo: parking.expiring ? '即将到期 · 待收银台缴费后自动展期' : '收银台缴费后自动展期',
      done: false
    })
  }
  return logs
}

/**
 * 种子：让详情页一打开就有可看的换绑记录。
 * 关键一点：**最新一条的 toPlate 必须是该车位当前车牌** ——
 * 否则记录写「换成 川A·T3M9」，详情里却是 川B·JK3YA，一眼就能看出是假数据。
 */
function _seedParkChangeLogs() {
  if (PARK_CHANGE_LOGS.length) return
  const bound = PV_ROWS.filter(p => p.bound && p.plateNo).slice(0, 4)
  // 每个车位两条：本月一条（to = 当前车牌）、上月一条（历史换手），来源一真一记
  const plan = [
    { source: '业主自助', operatorName: '业主本人（业主端）', at: '2026-10-20 09:12', reason: '车辆更换', vendor: '待同步' },
    { source: '物业代操作', operatorName: '物业前台 · 王芳', at: '2026-09-27 15:20', reason: '二手过户', vendor: '已同步' }
  ]
  bound.forEach((p, pi) => {
    /* 两条记录要首尾相接：上月 A → B，本月 B → 当前车牌。
       若不接续，时间线读起来就是两段互不相关的事。 */
    const mid = '川A·' + String(3000 + pi * 61).slice(-4)
    const first = '川A·' + String(5000 + pi * 43).slice(-4)
    plan.forEach((x, xi) => {
      // 只有前两个车位保留两条，其余只留本月那条，避免时间线太长
      if (pi > 1 && xi === 1) return
      _PARK_LOG_SEQ += 1
      PARK_CHANGE_LOGS.push({
        logId: 'PL' + String(_PARK_LOG_SEQ).padStart(5, '0'),
        parkId: p.parkId,
        parkNo: p.parkNo,
        fromPlate: xi === 0 ? mid : first,
        toPlate: xi === 0 ? p.plateNo : mid,
        source: x.source,
        operatorName: x.operatorName,
        vendorStatus: x.vendor,
        at: x.at,
        reason: x.reason
      })
    })
  })
}

/** 车位详情：车位 + 车辆 + 业主 + 最近通行 + 换绑留痕（闲置车位没有车辆，只显示车位段） */
export function getParkingDetail(parkId) {
  return delay(() => {
    const parking = PV_ROWS.find(p => p.parkId === parkId)
    if (!parking) return null
    const vehicle = vehicles.find(v => v.parkId === parkId) || null
    const owner = owners.find(o => o.ownerId === (vehicle?.ownerId || parking.ownerId)) || null
    return {
      parking, vehicle, owner,
      // 车牌优先、parkId 兜底：换绑后车牌变了，历史通行仍按车位能召回
      passes: passRecordsOf(parkId, vehicle?.plateNo || parking.plateNo).slice(0, 10),
      bindLogs: parkingBindLogs(parking, vehicle),
      // H2：本月已换 / 上限 / 还能换几次，页面顶部直接用
      monthChanges: parkMonthChangeCount(parkId),
      plateLimit: parkPlateLimit(),
      changeLeft: Math.max(0, parkPlateLimit() - parkMonthChangeCount(parkId))
    }
  })
}
export const parkZoneOpts = () => distinct(parkings, 'zone')
export const parkStatusOpts = () => distinct(parkings, 'status')
export const parkBindStatusOpts = () => distinct(parkings, 'bindStatus')
export const parkCategoryOpts = () => distinct(parkings, 'category')

_seedParkChangeLogs()

/* ---------------- 跨页锚点：focus 协议 ---------------- */

/**
 * 把 (实体类型, id) 解析成目标页能直接落地的范围
 * 约定：房屋与车位之间没有直接外键，房 → 车位 只能经业主中转（UI 上必须标注）
 */
export function focusLocation(type, id) {
  if (type === 'house') {
    const h = HOUSE_ROWS.find(x => x.houseId === id)
    return h ? { ...h, communityId: h.communityId, buildingId: h.buildingId, unitId: h.unitId } : null
  }
  if (type === 'owner') {
    const o = owners.find(x => x.ownerId === id)
    if (!o) return null
    const first = houses.find(h => h.ownerId === id)
    return {
      ownerId: id, communityId: first?.communityId || '', buildingId: first?.buildingId || '',
      unitId: first?.unitId || '', parkId: (o.parkIds || [])[0] || ''
    }
  }
  if (type === 'vehicle') {
    const v = VEHICLE_ROWS.find(x => x.vehicleId === id)
    if (!v) return null
    const p = PARKING_OF.get(v.parkId)
    return {
      vehicleId: id, parkId: v.parkId, communityId: p?.communityId || v.communityId || '',
      zone: p?.zone || '', status: p?.status || '', ownerId: v.ownerId
    }
  }
  if (type === 'park') {
    const p = PV_ROWS.find(x => x.parkId === id)
    return p ? { parkId: id, communityId: p.communityId, zone: p.zone, status: p.status, ownerId: p.ownerId } : null
  }
  return null
}

/* ==================================================================
 * 补充批次（2026-10-22 · L4 收尾）：租户 / 合同 / 公告 / 品质检查记录
 * 数据来自 seed_dataset.py 的独立随机流 SEED+31，既有 22 张表零改动
 * ================================================================== */

/* ---------------- 29 · 租户管理（P4：业主维护 + 物业核验补充） ----------------
 * 业务口径（2026-10-29 确认）：
 *   ① 租户由业主出租产生，租户信息（含新增）主要由业主在小程序维护；
 *      物业可代为补充或修正，且保存即生效，不需要业主二次确认。
 *   ② 物业不是出租方：不签租约、不掌握租金 → 后台不展示、不统计租金（rent 字段保留，仅供业主端）。
 *   ③ 物业侧的价值是「这套房现在住着谁」：核验、补全、失效（搬离），服务门禁人脸 / 通知触达 / 上门服务。
 *   ④ 补充动作要能在「租户到场代缴物业费」的收银台流程里完成 —— 见 tenantsOfOwner()。
 * 字段口径：source（业主自助 / 物业补录）、verifyStatus（待核验 / 已核验 / 信息不全）、status（在住 / 已搬离）。
 */

/**
 * 租客类型（2026-11-02）：个人 / 公司。
 *
 * 为什么必须分两套字段而不是"公司名塞进姓名框"：
 * 公司的身份凭证是统一社会信用代码，不是身份证；核验核的是营业执照，不是人脸；
 * 门禁人脸录的是**经办人**，不是"公司"。混在一张表里，最后每列都在装两种东西。
 */
export const TENANT_TYPES = ['个人', '公司']
export const BUSINESS_CATEGORIES = ['餐饮', '零售', '教育培训', '生活服务', '办公', '医疗健康', '其他']
export const LEASE_PURPOSES = ['经营', '办公', '仓储', '宿舍']

/* 统一社会信用代码（GB 32100-2015）：31 位字符集 + 加权校验。
   字符集刻意去掉 I O S V Z —— 它们和 1 0 5 视觉上分不清，纸质执照上最容易抄错。 */
const CC_CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY'
const CC_W = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]

/** 信用代码校验：长度 / 字符集 / 校验位三步，任一步不过返回具体原因 */
export function creditCodeCheck(code) {
  const v = String(code || '').trim().toUpperCase()
  if (!v) return '统一社会信用代码必填'
  if (v.length !== 18) return '统一社会信用代码应为 18 位'
  const bad = [...v].find(c => !CC_CHARS.includes(c))
  if (bad) return `统一社会信用代码含非法字符「${bad}」（不含 I O S V Z）`
  const sum = [...v.slice(0, 17)].reduce((acc, c, i) => acc + CC_CHARS.indexOf(c) * CC_W[i], 0)
  const check = 31 - (sum % 31)
  const expect = CC_CHARS[check === 31 ? 0 : check]
  if (v[17] !== expect) return `统一社会信用代码校验位不对（应为 ${expect}）`
  return ''
}

/** 个人：门禁与触达要用到的 8 项（租金不参与） */
const TENANT_REQUIRED_PERSON = [
  ['name', '姓名'], ['phone', '手机号'], ['idCard', '证件号'],
  ['certified', '实名认证'], ['faceRegistered', '人脸录入'],
  ['relation', '与业主关系'], ['residents', '居住人数'], ['emergencyContact', '紧急联系人']
]
/** 公司：主体资质 + 经办人（法定代表人电话用于紧急联络，经办人是日常对接人） */
const TENANT_REQUIRED_COMPANY = [
  ['companyName', '公司名称'], ['creditCode', '统一社会信用代码'],
  ['legalPerson', '法定代表人'], ['legalPersonPhone', '法人电话'],
  ['agentName', '经办人'], ['agentPhone', '经办人手机'],
  ['businessCategory', '经营类目'], ['regAddress', '注册地址']
]
/** 物业可补充 / 修正的字段（其余为业主维护，后台只读） */
export const TENANT_EDITABLE = [
  /* 个人 */
  'name', 'phone', 'idCard', 'secondPhone', 'relation', 'residents',
  'emergencyContact', 'vehicles', 'pets', 'specialCare', 'remark',
  /* 公司（2026-11-02） */
  'companyName', 'creditCode', 'legalPerson', 'legalPersonPhone',
  'agentName', 'agentPhone', 'agentIdCard', 'businessCategory',
  'leasePurpose', 'regAddress', 'establishDate', 'employeeCount'
]
export const TENANT_FIELD_LABEL = {
  name: '姓名 / 主体名称', phone: '手机号', idCard: '证件号', secondPhone: '第二联系电话',
  relation: '与业主关系', residents: '居住人数', emergencyContact: '紧急联系人',
  vehicles: '车辆信息', pets: '养宠', specialCare: '特殊人群', remark: '备注',
  companyName: '公司名称', creditCode: '统一社会信用代码', legalPerson: '法定代表人',
  legalPersonPhone: '法人电话', agentName: '经办人', agentPhone: '经办人手机',
  agentIdCard: '经办人证件', businessCategory: '经营类目', leasePurpose: '承租用途',
  regAddress: '注册地址', establishDate: '成立日期', employeeCount: '员工人数'
}
/** 业主维护、物业只读的字段（涉及产权与合同，改动需业主在移动端操作） */
export const TENANT_OWNER_FIELDS = [
  { key: 'houseName', label: '承租房屋' },
  { key: 'leaseStart', label: '起租日' },
  { key: 'leaseEnd', label: '到期日' },
  { key: 'ownerName', label: '产权业主' }
]

export const TENANT_VERIFY_STATUS = ['待核验', '已核验', '信息不全']
/* 「企业承租」只给公司租户用：公司跟业主之间没有亲属/朋友关系，硬塞「其他」会丢信息 */
export const TENANT_RELATIONS = ['承租人', '业主亲属', '业主朋友', '企业宿舍', '企业承租', '其他']
export const TENANT_SPECIAL_CARE = ['老人', '儿童', '残障', '孕产']

/**
 * 核验门槛（5 项）：物业能补、且确实影响"这套房住的是谁"的字段。
 * 实名 / 人脸属核验结果，不在此列；**紧急联系人降级为完整度项**——
 * 它不是身份核验的必要条件，卡在门槛里会让批量核验几乎全失败（实测 4/4 都被它挡住）。
 *
 * 公司另有一套门槛：公司名 + 信用代码 + 法人 + 经办人 + 经办人手机。
 * 公司没有"与业主关系 / 居住人数"这些概念，拿个人那套去量，公司租户永远补不满。
 */
const TENANT_BASIC_PERSON = TENANT_REQUIRED_PERSON
  .filter(([k]) => !['certified', 'faceRegistered', 'emergencyContact'].includes(k))
const TENANT_BASIC_COMPANY = ['companyName', 'creditCode', 'legalPerson', 'agentName', 'agentPhone']

/**
 * 完整度计算：页面与列表必须调同一个函数。
 * 之前抽屉里自己写了一套 8 项，api 里又一套 —— 两处阈值稍有不同就会出现
 * 「列表说 62%、抽屉说 75%」这种没法解释的差。
 */
export const computeTenantFill = t => {
  const isCo = (t?.tenantType || '个人') === '公司'
  const req = isCo ? TENANT_REQUIRED_COMPANY : TENANT_REQUIRED_PERSON
  const basicKeys = isCo ? TENANT_BASIC_COMPANY : TENANT_BASIC_PERSON.map(([k]) => k)
  const empty = k => {
    const v = t[k]
    return (k === 'certified' || k === 'faceRegistered') ? !v : !String(v ?? '').trim()
  }
  const missing = req.filter(([k]) => empty(k)).map(([, label]) => label)
  const missingBasic = req.filter(([k]) => basicKeys.includes(k) && empty(k)).map(([, label]) => label)
  const total = req.length
  /* 核验前置：公司必须有营业执照影像件。单列，不进 8 项分母（见 TENANT_FILE_RULES 注释） */
  const licenseRequired = isCo
  const licenseCount = (t?.licenseFiles || []).length
  return {
    total,
    filled: total - missing.length,
    missing,
    basicTotal: basicKeys.length,
    basicFilled: basicKeys.length - missingBasic.length,
    missingBasic,
    licenseRequired,
    licenseCount,
    licenseReady: !licenseRequired || licenseCount > 0,
    rate: Math.round((total - missing.length) / total * 1000) / 10
  }
}
const _tenantFill = t => computeTenantFill(t)

/**
 * 营业执照影像件（2026-11-02）：公司核验的**依据**，不是装饰。
 *
 * 为什么不放进「完整度 8 项」：完整度衡量的是"信息填全没有"，影像件是"能不能核验"。
 * 混进去会同时改掉全部公司的完整度分母，列表人数、KPI、既有断言跟着漂，
 * 而业务上它们本来就是两件事 —— 所以单列成核验前置。
 */
export const TENANT_FILE_RULES = {
  maxCount: 3,
  maxSizeMB: 5,
  accept: 'image/jpeg,image/png,image/webp,application/pdf',
  types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  typeText: 'JPG / PNG / WEBP / PDF'
}
const TENANT_LICENSE_LABEL = '营业执照影像件'

/** 影像件摘要：页面只读这里，不自己算 */
export const licenseSummary = t => {
  const files = t?.licenseFiles || []
  return {
    count: files.length,
    required: (t?.tenantType || '个人') === '公司',
    ready: (t?.tenantType || '个人') !== '公司' || files.length > 0,
    maxCount: TENANT_FILE_RULES.maxCount,
    text: files.length ? `${files.length} 张` : '未上传'
  }
}

const _fileErr = msg => Object.assign(new Error(msg), { code: 42204 })

/**
 * 影像件校验（格式 / 大小 / 张数 / 重复）——**只校验不落库**。
 * 为什么要单独拆出来：新登记的公司租户在表单里就要能选执照，
 * 但那时 tenantId 还不存在，文件只能先挂在表单上，保存时随主体一次写入。
 */
export function checkTenantFile(file = {}, existing = []) {
  const name = String(file.name || '').trim()
  if (!name) return '文件名不能为空'
  const type = String(file.type || '').toLowerCase()
  if (!TENANT_FILE_RULES.types.includes(type)) {
    return `只支持 ${TENANT_FILE_RULES.typeText}，当前文件是 ${type || '未知格式'}`
  }
  const size = Number(file.size) || 0
  if (!size) return '文件是空的，请重新选择'
  if (size > TENANT_FILE_RULES.maxSizeMB * 1024 * 1024) {
    return `单张不能超过 ${TENANT_FILE_RULES.maxSizeMB} MB（当前 ${(size / 1024 / 1024).toFixed(1)} MB）`
  }
  const list = existing || []
  if (list.length >= TENANT_FILE_RULES.maxCount) {
    return `最多 ${TENANT_FILE_RULES.maxCount} 张（正本 / 副本 / 变更页足够），请先删掉一张`
  }
  if (list.some(f => f.name === name && Number(f.size) === size)) return '这张已经传过了'
  return ''
}

/** 生成一条影像件元数据（不落库，供表单暂存与接口共用） */
export function buildLicenseFile(file = {}, operator = '物业前台', seq = 1) {
  return {
    fileId: `LF${String(Date.now()).slice(-6)}${String(seq).padStart(2, '0')}`,
    name: String(file.name || '').trim(),
    size: Number(file.size) || 0,
    type: String(file.type || '').toLowerCase(),
    uploadedAt: _now(),
    uploadedBy: operator
  }
}

/**
 * 登记一张影像件。
 * 原型没有对象存储：这里只登记元数据（名称/大小/类型），预览由页面用 blob URL 自己生成，
 * 刷新即还原 —— 但校验、留痕、核验前置三件事都按真接口的口径做，将来换实现只改这一个函数。
 */
export function addTenantLicenseFile(tenantId, file = {}, operator = '物业前台') {
  const raw = tenants.find(x => x.tenantId === tenantId)
  if (!raw) throw new Error('租户不存在')
  if ((raw.status || '在住') !== '在住') throw new Error('已搬离的租户记录不可修改')
  if ((raw.tenantType || '个人') !== '公司') throw new Error('只有公司租户需要营业执照影像件')
  const files = raw.licenseFiles || []
  const bad = checkTenantFile(file, files)
  if (bad) throw _fileErr(bad)
  const rec = buildLicenseFile(file, operator, files.length + 1)
  raw.licenseFiles = [...files, rec]
  raw.updatedBy = operator
  raw.updatedAt = _now()
  _pushTenantHistory(tenantId, {
    action: '上传营业执照影像件', by: operator, at: rec.uploadedAt,
    memo: `${rec.name}（${(rec.size / 1024 / 1024).toFixed(2)} MB）· 共 ${raw.licenseFiles.length} 张`, done: true
  })
  return { file: rec, files: [...raw.licenseFiles], row: _syncTenantRow(tenantId) }
}

/** 删除一张影像件：已核验的租户删到 0 张要说明后果（核验依据没了） */
export function removeTenantLicenseFile(tenantId, fileId, operator = '物业前台') {
  const raw = tenants.find(x => x.tenantId === tenantId)
  if (!raw) throw new Error('租户不存在')
  if ((raw.status || '在住') !== '在住') throw new Error('已搬离的租户记录不可修改')
  const files = raw.licenseFiles || []
  const hit = files.find(f => f.fileId === fileId)
  if (!hit) throw new Error(TENANT_LICENSE_LABEL + '不存在或已被删除')
  raw.licenseFiles = files.filter(f => f.fileId !== fileId)
  raw.updatedBy = operator
  raw.updatedAt = _now()
  _pushTenantHistory(tenantId, {
    action: '删除营业执照影像件', by: operator, at: raw.updatedAt,
    memo: `${hit.name}${raw.licenseFiles.length ? '' : '（已无影像件，核验依据缺失）'}`, done: true
  })
  return { files: [...raw.licenseFiles], row: _syncTenantRow(tenantId) }
}

/** 运行期操作记录（原型不落库，刷新还原） */
const TENANT_HISTORY = new Map()
const _pushTenantHistory = (id, entry) => {
  const list = TENANT_HISTORY.get(id) || []
  list.unshift(entry)
  TENANT_HISTORY.set(id, list)
}

/** 租户行：房屋 / 业主 / 届满天数 / 核验 / 完整度全部同源派生（不改原始数据） */
function _tenantRow(t) {
  const h = HOUSE_ROWS.find(x => x.houseId === t.houseId)
  const left = daysBetween(t.leaseEnd) === null ? null : -daysBetween(t.leaseEnd)
  const months = Math.round((new Date(t.leaseEnd) - new Date(t.leaseStart)) / 2628000000)
  const status = t.status || '在住'
  const row = {
    ...t,
    status,
    live: status === '在住',
    source: t.source || '业主自助',
    verifyStatus: t.verifyStatus || '待核验',
    tenantType: t.tenantType || '个人',
    /* 公司字段一律给空串，不要 undefined：模板里 `row.creditCode` 直接渲染会显示 undefined */
    companyName: t.companyName || '',
    creditCode: t.creditCode || '',
    legalPerson: t.legalPerson || '',
    legalPersonPhone: t.legalPersonPhone || '',
    agentName: t.agentName || '',
    agentPhone: t.agentPhone || '',
    agentIdCard: t.agentIdCard || '',
    businessCategory: t.businessCategory || '',
    leasePurpose: t.leasePurpose || '',
    regAddress: t.regAddress || '',
    establishDate: t.establishDate || '',
    employeeCount: t.employeeCount || 0,
    licenseFiles: (t.licenseFiles || []).map(f => ({ ...f })),
    relation: t.relation || '承租人',
    residents: t.residents || 1,
    emergencyContact: t.emergencyContact || '',
    secondPhone: t.secondPhone || '',
    vehicles: t.vehicles || '',
    pets: !!t.pets,
    specialCare: t.specialCare || [],
    remark: t.remark || '',
    communityId: h?.communityId || '',
    communityName: h?.communityName || '-',
    buildingId: h?.buildingId || '',
    buildingName: h?.buildingName || '-',
    unitId: h?.unitId || '',
    houseName: h?.fullName || t.houseId,
    roomText: String(h?.fullName || '').replace(/^\S+\s+/, ''),
    houseUsage: h?.usage || '-',
    ownerName: ownerNameOf(t.ownerId),
    ownerPhone: owners.find(o => o.ownerId === t.ownerId)?.phone || '',
    leftDays: left,
    months,
    /* 届满只是「提醒业主确认续租/退租」的信号，不等于搬离（搬离必须物业确认） */
    expiring: left !== null && left >= 0 && left <= 90,
    expired: left !== null && left < 0,
    updatedBy: t.updatedBy || '',
    updatedAt: t.updatedAt || ''
  }
  row.completeness = _tenantFill(row)
  return row
}

const TENANT_ROWS = tenants.map(t => _tenantRow(t))

/** 单条派生行重建：写操作后必须走这里，否则「保存成功但列表不变」 */
function _syncTenantRow(tenantId) {
  const raw = tenants.find(x => x.tenantId === tenantId)
  if (!raw) return null
  const row = _tenantRow(raw)
  const i = TENANT_ROWS.findIndex(x => x.tenantId === tenantId)
  if (i >= 0) TENANT_ROWS.splice(i, 1, row)
  else TENANT_ROWS.push(row)
  return row
}

/** 快捷视图：状态与范围是两个正交维度，可叠加（这是取消左树的直接收益） */
const TENANT_VF = {
  pending: t => t.live && t.verifyStatus === '待核验',
  incomplete: t => t.live && t.verifyStatus === '信息不全',
  uncertified: t => t.live && !t.certified,
  noface: t => t.live && !t.faceRegistered,
  expiring: t => t.live && t.expiring,
  moved: t => !t.live
}

export const tenantQuickViews = () => {
  const list = [
    { key: '', label: '全部在住', hit: t => t.live },
    { key: 'pending', label: '待核验', hit: TENANT_VF.pending },
    { key: 'incomplete', label: '信息不全', hit: TENANT_VF.incomplete },
    { key: 'uncertified', label: '未实名', hit: TENANT_VF.uncertified },
    { key: 'noface', label: '未录人脸', hit: TENANT_VF.noface },
    { key: 'expiring', label: '90 天内届满', hit: TENANT_VF.expiring },
    { key: 'moved', label: '已搬离', hit: TENANT_VF.moved }
  ]
  return list.map(v => ({ key: v.key, label: v.label, n: TENANT_ROWS.filter(v.hit).length }))
}

export const tenantVerifyStatusOpts = () => TENANT_VERIFY_STATUS
export const tenantSourceOpts = () => ['业主自助', '物业补录']

/**
 * 租户列表
 * filters: { vf, communityId, buildingId, unitId, verifyStatus, source, ownerId, kw }
 * 默认只出「在住」；选 moved 才看历史。排序按租期届满升序（最急的在前）。
 */
export function queryTenants({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    assertInScope({ communityId: filters.communityId, buildingId: filters.buildingId, unitId: filters.unitId })
    const vf = filters.vf ? (TENANT_VF[filters.vf] || (() => false)) : null
    const list = scopeFilter(TENANT_ROWS, { house: t => t.houseId }).filter(t =>
      (vf ? vf(t) : t.live) &&
      eq(t, filters.communityId, 'communityId') &&
      eq(t, filters.buildingId, 'buildingId') &&
      eq(t, filters.unitId, 'unitId') &&
      eq(t, filters.verifyStatus, 'verifyStatus') &&
      eq(t, filters.source, 'source') &&
      eq(t, filters.ownerId, 'ownerId') &&
      kwHit(t, filters.kw, ['name', 'phone', 'tenantId', 'houseName', 'ownerName'])
    ).sort((a, b) => {
      const la = a.leftDays == null ? 9e9 : a.leftDays
      const lb = b.leftDays == null ? 9e9 : b.leftDays
      return la - lb || a.houseName.localeCompare(b.houseName)
    })
    const page = paged(list, pageNo, size)
    return { ...page, rows: redactList(page.rows) }
  })
}

/** 物业侧 KPI（租金不进任何指标） */
export function tenantSummary() {
  const live = TENANT_ROWS.filter(t => t.live)
  const rate = live.length ? live.reduce((s, t) => s + t.completeness.rate, 0) / live.length : 0
  return {
    total: TENANT_ROWS.length,
    live: live.length,
    moved: TENANT_ROWS.length - live.length,
    pending: live.filter(TENANT_VF.pending).length,
    incomplete: live.filter(TENANT_VF.incomplete).length,
    uncertified: live.filter(TENANT_VF.uncertified).length,
    noface: live.filter(TENANT_VF.noface).length,
    expiring: live.filter(TENANT_VF.expiring).length,
    avgRate: Math.round(rate * 10) / 10,
    /* 完整度最低的几个人：给前台一个"先补谁"的抓手 */
    weakest: [...live].sort((a, b) => a.completeness.rate - b.completeness.rate).slice(0, 3)
      .map(t => ({ tenantId: t.tenantId, name: t.name, rate: t.completeness.rate }))
  }
}

/** 某业主名下的在住租户（收银台「租户代缴」场景用） */
export const tenantsOfOwner = ownerId => TENANT_ROWS.filter(t => t.live && t.ownerId === ownerId)

/** 某房屋的在住租户（房屋台账 / 账单详情可复用） */
export const liveTenantOfHouse = houseId =>
  TENANT_ROWS.find(t => t.live && t.houseId === houseId) || null

/** 租户详情：在住信息 + 补充信息 + 房屋/业主 + 该房账单 + 操作记录 */
export function getTenantDetail(tenantId) {
  return delay(() => {
    const tenant = TENANT_ROWS.find(t => t.tenantId === tenantId)
    if (!tenant) return null
    const house = HOUSE_ROWS.find(h => h.houseId === tenant.houseId) || null
    const owner = owners.find(o => o.ownerId === tenant.ownerId) || null
    const hb = billsOfHouse(tenant.houseId)
    return {
      tenant,
      house,
      owner,
      bills: hb.slice(0, 8),
      debt: house?.debt || 0,
      completeness: tenant.completeness,
      history: tenantHistoryOf(tenantId)
    }
  })
}

/** 操作记录：业主登记 → 物业补充/核验 → 门禁 → 搬离（运行期记录在前） */
export function tenantHistoryOf(tenantId) {
  const t = TENANT_ROWS.find(x => x.tenantId === tenantId)
  if (!t) return []
  const base = [
    { action: '业主登记', by: `${t.ownerName}（业主小程序）`, at: `${t.leaseStart} 09:00`, memo: `承租 ${t.houseName} · 租期 ${t.leaseStart} ~ ${t.leaseEnd}`, done: true },
    {
      action: t.verifyStatus === '已核验' ? '物业核验通过' : (t.verifyStatus === '信息不全' ? '信息不全，待补充' : '待物业核验'),
      by: t.verifyStatus === '已核验' ? '物业前台' : '—',
      at: t.verifyStatus === '已核验' ? `${t.leaseStart} 15:20` : '',
      memo: t.verifyStatus === '已核验' ? '证件与在住情况已现场/线上核验' : (t.completeness.missing.length ? `缺：${t.completeness.missing.join('、')}` : '等待核验'),
      done: t.verifyStatus === '已核验'
    },
    {
      action: t.faceRegistered ? '门禁与人脸已授权' : '门禁人脸未授权',
      by: t.faceRegistered ? '物业前台' : '—',
      at: '',
      memo: t.faceRegistered ? '可刷脸/刷卡通行，通知按在住人触达' : (t.certified ? '待录入人脸' : '需先完成实名认证'),
      done: !!t.faceRegistered
    },
    {
      action: t.live ? '在住' : '已搬离',
      by: t.live ? '—' : (t.updatedBy || '物业前台'),
      at: t.live ? '' : (t.moveOutAt || ''),
      memo: t.live ? `租期到期日 ${t.leaseEnd}（届满仅提醒，不自动改变在住状态）` : (t.moveOutReason || '业主/租户退租'),
      done: !t.live
    }
  ]
  return [...(TENANT_HISTORY.get(tenantId) || []), ...base]
}

/** 物业补充 / 修正：保存即生效，逐字段留痕（谁在什么时候把什么从 X 改成 Y） */
/** 手机号：11 位大陆号。空值不拦（选填字段），一旦填了就必须对 */
const _phoneOk = v => !v || /^1[3-9]\d{9}$/.test(String(v).trim())

/**
 * 写前校验：只校验**这次真的在改**的字段。
 * 全量校验会让历史数据里某个空字段卡住所有保存动作 —— 用户改个备注都存不了，
 * 却被告知"公司名不能为空"，那是更难解释的问题。
 */
function _validateTenantPatch(raw, patch) {
  const has = k => patch[k] !== undefined
  const val = k => String(patch[k] ?? '').trim()
  for (const k of ['phone', 'secondPhone', 'agentPhone', 'legalPersonPhone']) {
    if (has(k) && !_phoneOk(val(k))) return `${TENANT_FIELD_LABEL[k]}应为 11 位手机号`
  }
  if (has('creditCode')) {
    const err = creditCodeCheck(val('creditCode'))
    if (err) return err
  }
  if (has('establishDate') && val('establishDate')) {
    const v = val('establishDate')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return '成立日期格式应为 YYYY-MM-DD'
    if (v > _now().slice(0, 10)) return '成立日期不能晚于今天'
  }
  if (has('businessCategory') && val('businessCategory')
      && !BUSINESS_CATEGORIES.includes(val('businessCategory'))) {
    return `经营类目只能是 ${BUSINESS_CATEGORIES.join(' / ')}`
  }
  if (has('leasePurpose') && val('leasePurpose') && !LEASE_PURPOSES.includes(val('leasePurpose'))) {
    return `承租用途只能是 ${LEASE_PURPOSES.join(' / ')}`
  }
  if (has('employeeCount') && val('employeeCount')) {
    const n = Number(val('employeeCount'))
    if (!Number.isFinite(n) || n < 1 || n > 9999) return '员工人数应在 1–9999 之间'
  }
  if (has('companyName') && (raw.tenantType === '公司') && val('companyName').length < 2) {
    return '公司名称至少 2 个字'
  }
  return ''
}

export function supplementTenant(tenantId, patch = {}, operator = '物业前台') {
  const raw = tenants.find(x => x.tenantId === tenantId)
  if (!raw) throw new Error('租户不存在')
  if ((raw.status || '在住') !== '在住') throw new Error('已搬离的租户记录不可修改')
  const keys = TENANT_EDITABLE.filter(k => k in patch)
  if (!keys.length) throw new Error('没有可保存的字段')
  const invalid = _validateTenantPatch(raw, patch)
  if (invalid) throw Object.assign(new Error(invalid), { code: 42201 })
  /* 公司名是主体名称：改公司名必须同步 name，否则列表显示旧名、详情显示新名 */
  if (keys.includes('companyName') && (raw.tenantType || '个人') === '公司') {
    patch = { ...patch, name: patch.companyName }
  }
  const changes = []
  for (const k of keys) {
    const next = patch[k]
    const prev = raw[k] ?? ''
    const same = Array.isArray(next)
      ? JSON.stringify(next || []) === JSON.stringify(prev || [])
      : (typeof next === 'boolean' ? !!prev === next : String(prev ?? '') === String(next ?? ''))
    if (same) continue
    changes.push({ field: k, label: TENANT_FIELD_LABEL[k] || k, from: prev, to: next })
    raw[k] = next
  }
  if (!changes.length) return { tenantId, changes: [], row: _syncTenantRow(tenantId) }
  raw.updatedBy = operator
  raw.updatedAt = _now()
  let row = _syncTenantRow(tenantId)
  /* 补全后仍未核验的，自动从「信息不全」回到「待核验」——仍需现场核验才算过 */
  if (raw.verifyStatus === '信息不全' && !row.completeness.missing.length) {
    raw.verifyStatus = '待核验'
    row = _syncTenantRow(tenantId)
  }
  _pushTenantHistory(tenantId, {
    action: '物业补充',
    by: operator,
    at: raw.updatedAt,
    memo: changes.map(c => `${c.label}：${c.from === '' || c.from == null ? '空' : c.from} → ${c.to === '' || c.to == null ? '空' : c.to}`).join('；'),
    done: true
  })
  return { tenantId, changes, row }
}

/** 物业核验：通过 → 已核验；不通过 → 信息不全（并记录原因） */
export function verifyTenant(tenantId, { verifier = '物业前台', pass = true, note = '' } = {}) {
  const raw = tenants.find(x => x.tenantId === tenantId)
  if (!raw) throw new Error('租户不存在')
  if ((raw.status || '在住') !== '在住') throw new Error('已搬离的租户不能核验')
  const basic = _tenantFill(raw).missingBasic
  if (pass && basic.length) {
    throw new Error(`还有 ${basic.length} 项基础信息缺失（${basic.join('、')}），补全后再核验`)
  }
  /* 公司核的是营业执照，不是人脸：没有影像件就等于没看过原件 */
  if (pass && (raw.tenantType || '个人') === '公司' && !(raw.licenseFiles || []).length) {
    throw Object.assign(
      new Error('公司租户核验前需先上传营业执照影像件（正本或副本）'),
      { code: 42203 }
    )
  }
  raw.verifyStatus = pass ? '已核验' : '信息不全'
  /* 核验通过 = 证件与在住情况已核对 → 实名认证成立（人脸另行录入） */
  if (pass) raw.certified = true
  raw.verifiedBy = verifier
  raw.verifiedAt = _now()
  raw.updatedBy = verifier
  raw.updatedAt = raw.verifiedAt
  _pushTenantHistory(tenantId, {
    action: pass ? '物业核验通过' : '核验不通过',
    by: verifier,
    at: raw.verifiedAt,
    memo: pass ? '证件与在住情况核验通过，可开通门禁' : (note || '信息与现场不符，退回补充'),
    done: true
  })
  return _syncTenantRow(tenantId)
}

/**
 * 录入人脸（门禁授权）：核验通过后由物业现场采集。
 * 校验口径：未核验 / 未实名不给录 —— 门禁是安全边界，不能靠租户自己声明。
 */
export function registerTenantFace(tenantId, { operator = '物业前台' } = {}) {
  const raw = tenants.find(x => x.tenantId === tenantId)
  if (!raw) throw new Error('租户不存在')
  if ((raw.status || '在住') !== '在住') throw new Error('已搬离的租户不能录入人脸')
  if (raw.verifyStatus !== '已核验') throw new Error('请先完成物业核验，再录入人脸')
  if (!raw.certified) throw new Error('未实名认证，不能录入人脸')
  if (raw.faceRegistered) throw new Error('该租户已录入人脸')
  raw.faceRegistered = true
  raw.updatedBy = operator
  raw.updatedAt = _now()
  _pushTenantHistory(tenantId, {
    action: '录入人脸 · 门禁授权', by: operator, at: raw.updatedAt,
    memo: '人脸采集完成，可刷脸通行；通知按在住人触达', done: true
  })
  return _syncTenantRow(tenantId)
}

/** 标记搬离：状态失效 + 停用门禁人脸 + 释放房屋的 tenantId（记录保留，可回溯） */
export function moveOutTenant(tenantId, { date = '', reason = '', operator = '物业前台' } = {}) {
  const raw = tenants.find(x => x.tenantId === tenantId)
  if (!raw) throw new Error('租户不存在')
  if ((raw.status || '在住') === '已搬离') throw new Error('该租户已标记搬离')
  raw.status = '已搬离'
  raw.moveOutAt = date || _now().slice(0, 10)
  raw.moveOutReason = reason || '业主/租户退租'
  raw.faceRegistered = false
  raw.updatedBy = operator
  raw.updatedAt = _now()
  const house = houses.find(h => h.houseId === raw.houseId)
  if (house && house.tenantId === raw.tenantId) house.tenantId = ''
  _pushTenantHistory(tenantId, {
    action: '标记搬离',
    by: operator,
    at: `${raw.moveOutAt} 10:00`,
    memo: `${raw.moveOutReason} · 门禁与人脸已停用 · 房屋 ${raw.houseId} 已释放在住关系`,
    done: true
  })
  return _syncTenantRow(tenantId)
}

/**
 * 换承租主体（2026-11-02）：个人 ↔ 公司。
 *
 * 为什么允许换，而不是"搬离后重新登记"：换主体在现实里真会发生（个体户注册成公司、
 * 公司注销后由经办人个人续租）。重新登记会把同一段租约、同一条核验记录劈成两条，
 * 追溯时"这套房到底谁住过"对不上。
 *
 * 但换主体有**代价**，一次做完，不留半截状态：
 *   ① 撤销人脸：人脸属于自然人，公司主体没有脸；
 *   ② 复位核验：换主体等于换证件，核过的证不再作数；
 *   ③ 清空另一套字段：个人租户里躺着公司名，列表与报表都会算错；
 *   ④ 迁移联系人：个人→公司把证件带进经办人；公司→个人把经办人带成承租人；
 *   ⑤ 影像件清空：旧主体的执照不能当新主体的凭证。
 */
export const CHANGE_TYPE_REASONS = [
  '个体户注册为公司，租约转由公司承继',
  '公司注销，由原经办人个人续租',
  '原登记主体类型填错，予以纠正',
  '公司变更名称与主体，重新备案'
]
export function changeTenantType(tenantId, { toType, reason = '', operator = '物业前台', patch = {} } = {}) {
  const raw = tenants.find(x => x.tenantId === tenantId)
  if (!raw) throw new Error('租户不存在')
  if ((raw.status || '在住') !== '在住') throw new Error('已搬离的租户不能换承租主体，请重新登记')
  const from = raw.tenantType || '个人'
  if (!TENANT_TYPES.includes(toType)) throw new Error('目标类型只能是「个人」或「公司」')
  if (toType === from) throw Object.assign(new Error(`该租户已经是「${toType}」，无需转换`), { code: 40921 })
  const why = String(reason || '').trim()
  if (why.length < 4) {
    throw new Error('换承租主体要写清原因（至少 4 个字）——这条记录将来要用来解释"为什么换过"')
  }
  const need = msg => Object.assign(new Error(msg), { code: 42203 })
  const oldName = raw.name
  let migrated = ''

  if (toType === '公司') {
    const companyName = String(patch.companyName ?? '').trim()
    if (companyName.length < 2) throw need('换为公司要先把公司名称填上（至少 2 个字）')
    const cc = String(patch.creditCode ?? '').trim().toUpperCase()
    const ccErr = creditCodeCheck(cc)
    if (ccErr) throw need(ccErr)
    /* 迁移：原承租人的手机是这家公司的对外电话，证件是经办人证件（门禁人脸要落在人身上） */
    const agentName = String(patch.agentName ?? raw.name ?? '').trim()
    const agentPhone = String(patch.agentPhone ?? raw.phone ?? '').trim()
    const carried = []
    if (raw.idCard) { patch.agentIdCard = patch.agentIdCard || raw.idCard; carried.push('证件号→经办人证件') }
    if (raw.phone) carried.push('手机→对外电话')
    if (raw.name) carried.push('姓名→经办人')
    Object.assign(raw, {
      tenantType: '公司',
      name: companyName, companyName, creditCode: cc,
      phone: String(patch.phone ?? raw.phone ?? '').trim(),
      idCard: '',
      relation: '企业承租',
      legalPerson: String(patch.legalPerson ?? '').trim(),
      legalPersonPhone: String(patch.legalPersonPhone ?? '').trim(),
      agentName, agentPhone,
      agentIdCard: String(patch.agentIdCard ?? '').trim(),
      businessCategory: patch.businessCategory ?? '',
      leasePurpose: patch.leasePurpose ?? '',
      regAddress: String(patch.regAddress ?? '').trim(),
      establishDate: patch.establishDate ?? '',
      employeeCount: Number(patch.employeeCount) || Number(raw.residents) || 1,
      residents: Number(patch.employeeCount) || Number(raw.residents) || 1,
      /* 表单里若已选好执照，随主体一起写入；没有就空着，核验会拦住 */
      licenseFiles: _cleanLicenseFiles(patch.licenseFiles || [], operator)
    })
    migrated = carried.join('、')
  } else {
    const name = String(patch.name ?? raw.agentName ?? '').trim()
    if (name.length < 2) throw need('换为个人要先把姓名填上（至少 2 个字）')
    const phone = String(patch.phone ?? raw.agentPhone ?? raw.phone ?? '').trim()
    if (!/^1[3-9]\d{9}$/.test(phone)) throw need('换为个人要留一个 11 位手机号，否则现场联系不上')
    const idCard = String(patch.idCard ?? raw.agentIdCard ?? '').trim()
    const carried = []
    if (raw.agentName) carried.push('经办人→承租人')
    if (raw.agentPhone) carried.push('经办人手机→联系手机')
    if (raw.agentIdCard) carried.push('经办人证件→证件号')
    Object.assign(raw, {
      tenantType: '个人',
      name, phone, idCard,
      relation: patch.relation || '承租人',
      residents: Number(patch.residents) || 1,
      companyName: '', creditCode: '', legalPerson: '', legalPersonPhone: '',
      agentName: '', agentPhone: '', agentIdCard: '',
      businessCategory: '', leasePurpose: '', regAddress: '', establishDate: '',
      employeeCount: 0,
      licenseFiles: []
    })
    migrated = carried.join('、')
  }

  /* 换主体 = 换证件：人脸与核验都要重来 */
  raw.faceRegistered = false
  raw.certified = false
  raw.verifyStatus = '待核验'
  raw.verifiedBy = ''
  raw.verifiedAt = ''
  raw.typeChangedFrom = from
  raw.typeChangeReason = why
  raw.updatedBy = operator
  raw.updatedAt = _now()
  _pushTenantHistory(tenantId, {
    action: '变更承租主体',
    by: operator,
    at: raw.updatedAt,
    memo: `${from} → ${toType}（${oldName} → ${raw.name}）· 原因：${why}`
      + ` · 已撤销人脸授权、核验状态复位为待核验`
      + (migrated ? ` · 迁移：${migrated}` : ''),
    done: true
  })
  return _syncTenantRow(tenantId)
}

/** 表单带上来的影像件：逐张复核（前端可以绕过，接口不能信） */function _cleanLicenseFiles(list, operator) {
  const out = []
  for (const f of list || []) {
    const bad = checkTenantFile(f, out)
    if (bad) throw Object.assign(new Error(bad), { code: 42204 })
    out.push({
      fileId: f.fileId || `LF${String(Date.now()).slice(-6)}${String(out.length + 1).padStart(2, '0')}`,
      name: String(f.name || '').trim(),
      size: Number(f.size) || 0,
      type: String(f.type || '').toLowerCase(),
      uploadedAt: f.uploadedAt || _now(),
      uploadedBy: f.uploadedBy || operator
    })
  }
  return out
}

/** 业主自助登记（原型取数用）：保存为「业主自助 + 待核验」，物业随后核验 */
export function registerTenantByOwner(p = {}, operator = '业主小程序') {
  const house = HOUSE_ROWS.find(h => h.houseId === p.houseId)
  if (!house) throw new Error('请选择承租房屋')
  if (liveTenantOfHouse(p.houseId)) throw new Error('该房屋已有在住租户，请先标记原租户搬离')
  if (!isDelivered(house)) throw new Error(`${house.fullName} 尚未交房，不能出租`)
  const type = p.tenantType === '公司' ? '公司' : '个人'
  /* 个人按证件号去重；公司按统一社会信用代码去重 —— 同一家公司通常只能有一条在住租约，
     否则"这家公司租了几套房"要靠人肉数。确实有多套需求的，走一条租约 + 多房分摊。 */
  if (type === '个人' && p.idCard) {
    assertUnique(TENANT_ROWS.filter(t => t.live), 'idCard', p.idCard, { label: '证件号' })
  }
  if (type === '公司' && p.creditCode) {
    const cc = creditCodeCheck(p.creditCode)
    if (cc) throw Object.assign(new Error(cc), { code: 42201 })
  }
  if (type === '公司') {
    for (const [k, label] of [['legalPerson', '法定代表人'], ['agentName', '经办人']]) {
      if (!String(p[k] || '').trim()) throw Object.assign(new Error(`${label}必填`), { code: 42201 })
    }
    for (const [k, label] of [['legalPersonPhone', '法人电话'], ['agentPhone', '经办人手机']]) {
      if (!_phoneOk(p[k])) throw Object.assign(new Error(`${label}应为 11 位手机号`), { code: 42201 })
    }
  }
  const id = nextId(tenants, 'TN', 'tenantId')
  const isCo = type === '公司'
  const t = {
    tenantId: id, tenantType: type,
    /* 公司：name 就是公司名（列表主标题统一）；个人：就是姓名 */
    name: isCo ? p.companyName : p.name,
    phone: p.phone, idCard: isCo ? '' : (p.idCard || ''),
    houseId: p.houseId, ownerId: house.ownerId,
    leaseStart: p.leaseStart || '', leaseEnd: p.leaseEnd || '',
    /* 租金仅业主端可见，后台不展示；此处保留字段以维持数据结构 */
    rent: Number(p.rent) || 0,
    certified: !!p.certified, faceRegistered: !!p.faceRegistered,
    source: p.source || '业主自助',
    verifyStatus: '待核验',
    relation: isCo ? '企业承租' : (p.relation || '承租人'),
    residents: Number(p.residents) || 1,
    status: '在住',
    updatedBy: operator, updatedAt: _now()
  }
  if (isCo) {
    Object.assign(t, {
      companyName: p.companyName, creditCode: String(p.creditCode || '').trim().toUpperCase(),
      legalPerson: p.legalPerson || '', legalPersonPhone: p.legalPersonPhone || '',
      agentName: p.agentName || '', agentPhone: p.agentPhone || '', agentIdCard: p.agentIdCard || '',
      businessCategory: p.businessCategory || '', leasePurpose: p.leasePurpose || '',
      regAddress: p.regAddress || '', establishDate: p.establishDate || '',
      employeeCount: Number(p.employeeCount) || Number(p.residents) || 1,
      /* 营业执照影像件随主体一起登记：登记当场就能传，不用等保存完再进补充页 */
      licenseFiles: _cleanLicenseFiles(p.licenseFiles, operator)
    })
  }
  tenants.unshift(t)
  house.tenantId = id
  /* 租出去就是「已入住」：六态里没有"出租"这一档，居住关系看 tenantId */
  const rawHouse = houses.find(h => h.houseId === house.houseId)
  if (rawHouse) rawHouse.useStatus = '已入住'
  _pushTenantHistory(id, {
    action: p.source === '物业补录' ? '物业代业主登记' : '业主登记',
    by: operator, at: _now(),
    memo: `承租 ${house.fullName} · 租期 ${t.leaseStart} ~ ${t.leaseEnd}`, done: true
  })
  return _syncTenantRow(id)
}

/* ---------------- 30 · 合同管理 ---------------- */

/**
 * 合同期间月数。按 30.44 天/月折算（一年 365.25 ÷ 12），取整。
 * 为什么不让页面自己算：合同列表、经营页、报表三处各算一份，月数差 1 个月就年化差 8%。
 */
export function contractMonthsOf(c = {}) {
  const a = String(c.startDate || '').slice(0, 10)
  const b = String(c.endDate || '').slice(0, 10)
  if (!a || !b) return 0
  const days = (new Date(b) - new Date(a)) / 86400000
  if (!Number.isFinite(days) || days <= 0) return 0
  return Math.max(1, Math.round(days / 30.44))
}

/* ==================================================================
 * 批 4 · 合同收支方向 / 类型两级 / 公共收益台账（2026-11-13）
 * ------------------------------------------------------------
 * 「方向」和「是否计入收入」是两个维度，不能互相代替：
 *   方向看**合同类型** —— 租赁 / 物业服务是收入，外包 / 采购 / 劳动是支出；
 *   是否计入收入看 incomeCategory —— 6 份物业服务合同标了「不计入」，
 *   意思是钱已经按物业费账单收过了，合同只登记、不再重复计一笔收入。
 *
 * 拿 incomeCategory === '不计入' 当"支出"，会把 322 万物业服务合同算进成本，
 * 成本虚增、利润虚减，而且报表上看不出错在哪 —— 因为两个字段本来都叫"不计入"。
 * ================================================================ */

export const CONTRACT_DIRECTIONS = ['收入', '支出']

/**
 * 合同分类字典（2026-11-14 定稿）：6 个一级主项 + 21 个子类。
 *
 * 11-14 只加了一个子类：采购协议 / 服务采购（保洁·绿化·秩序·垃圾清运共 19 份
 * 外包合同从「劳动合同/劳务协议」迁过来，见 scripts/migrate-service-procurement.mjs）。
 *
 * 之前是「数据里出现过什么就是什么」（5 个一级、22 个各页各叫的子类），
 * 结果是新建合同时选项取决于已有数据、报表口径也跟着数据漂。
 * 现在这一份是**配置**：表单、筛选、方向判断、报表分类都读它。
 *
 * 两条口径：
 *   ① **方向看一级主项** —— 劳动合同 / 运维服务 / 采购协议是支出，
 *      物业服务协议 / 多种经营 / 租赁协议是收入；
 *   ② **是否计入收入仍看 incomeCategory** —— 物业服务协议里的 6 份标「不计入」，
 *      钱已按物业费账单收过，合同只登记、不重复计一笔收入。
 */
export const CONTRACT_TYPE_TREE = [
  { type: '劳动合同', direction: '支出', subs: ['员工劳动合同', '劳务协议'] },
  { type: '物业服务协议', direction: '收入', subs: ['项目物业服务合同', '补充协议'] },
  { type: '运维服务', direction: '支出', subs: ['电梯维保', '消防系统运维', '监控维保', '设施设备检修', '供水供电设施维保'] },
  { type: '多种经营', direction: '收入', subs: ['广告合作', '场地联营', '便民服务合作', '转供电', '转供水', '转供气'] },
  { type: '租赁协议', direction: '收入', subs: ['房屋租赁', '车位租赁', '场地租赁', '设备租赁'] },
  { type: '采购协议', direction: '支出', subs: ['物资采购', '耗材采购', '设备采购', '服务采购'] }
]

export const CONTRACT_TYPES = CONTRACT_TYPE_TREE.map(t => t.type)
export const contractSubtypesOf = type =>
  (CONTRACT_TYPE_TREE.find(t => t.type === type) || { subs: [] }).subs
export const contractDirectionOfType = type =>
  (CONTRACT_TYPE_TREE.find(t => t.type === type) || {}).direction || '收入'

/** 方向：认不出的类型按收入处理（宁可少算成本，也不要凭一个陌生类型虚增支出） */
export const contractDirectionOf = c => contractDirectionOfType(c?.type)

/** 这笔合同额是否构成一笔收入。false = 已经在别处计过（物业费账单），或本来就是支出 */
export const contractCountsInRevenue = c =>
  contractDirectionOf(c) === '收入' && (c?.incomeCategory || '') !== '不计入'

/**
 * 类型 → 分类字典二级（合同的钱最终要落到收支分项里，不能各页各起名字）。
 *
 * 服务外包（保洁/绿化/秩序/垃圾清运）走过来两步：
 *   ① 2026-11-13 之前没有对应类型，暂挂「劳动合同/劳务协议」；
 *   ② 2026-11-14 在「采购协议」下加了「服务采购」，19 份合同已迁过去
 *      （`scripts/migrate-service-procurement.mjs`，幂等）。
 * 迁移后仍按**合同名**细分成 保洁外包 / 绿化养护 / 秩序维护 —— 一个「服务采购」
 * 撑不起三类成本，报表上看不出钱花在哪。
 *
 * 为什么挂在「采购协议」而不是新开第七个一级：客户明确只要六类；服务外包在
 * 资金性质上确实是「按合同采购一项服务」，方向同为支出，进收支分项不受影响。
 */
const CONTRACT_CATEGORY_OF = {
  '劳动合同/员工劳动合同': 'EXP_LABOR_SALARY',
  '劳动合同/劳务协议': 'EXP_LABOR_OUTSOURCE',
  '物业服务协议/项目物业服务合同': 'INC_MAIN_PROPERTY',
  '物业服务协议/补充协议': 'INC_MAIN_PROPERTY',
  '运维服务/电梯维保': 'EXP_CON_ELEV',
  '运维服务/消防系统运维': 'EXP_CON_FIRE',
  '运维服务/监控维保': 'EXP_CON_PROJECT',
  '运维服务/设施设备检修': 'EXP_CON_PROJECT',
  '运维服务/供水供电设施维保': 'EXP_CON_ELEV',
  '多种经营/广告合作': 'INC_MULTI_AD',
  '多种经营/场地联营': 'INC_MULTI_VENUE',
  '多种经营/便民服务合作': 'INC_MULTI_SELF',
  '多种经营/转供电': 'INC_OTHER_UTILITY',
  '多种经营/转供水': 'INC_OTHER_UTILITY',
  '多种经营/转供气': 'INC_OTHER_UTILITY',
  '租赁协议/房屋租赁': 'INC_MULTI_VENUE',
  '租赁协议/车位租赁': 'INC_MULTI_VENUE',
  '租赁协议/场地租赁': 'INC_MULTI_VENUE',
  '租赁协议/设备租赁': 'INC_MULTI_SELF',
  '采购协议/物资采购': 'EXP_OP_REPAIR',
  '采购协议/耗材采购': 'EXP_OP_OFFICE',
  '采购协议/设备采购': 'EXP_CON_PROJECT',
  '采购协议/服务采购': 'EXP_CON_SERVICE'
}

/** 服务外包按合同名细分到三个二级科目（顺序即优先级） */
const OUTSOURCE_CATEGORY_OF = [
  { re: /绿化|养护/, code: 'EXP_CON_GREEN' },
  { re: /秩序|安保|保安|门岗/, code: 'EXP_CON_SECURITY' },
  { re: /保洁|垃圾清运|清掏|消杀|环境/, code: 'EXP_CON_SERVICE' }
]

/** 整包服务的关键词：存量里还挂在「劳务协议」上的老合同靠它兜底 */
const SERVICE_OUTSOURCE_HINT = /保洁|绿化|秩序|安保|保安|垃圾清运|清掏|消杀/

const outsourceCategoryOf = name => {
  const s = String(name || '')
  const hit = OUTSOURCE_CATEGORY_OF.find(x => x.re.test(s))
  return hit ? hit.code : ''
}

export const contractCategoryOf = c => {
  const key = `${c?.type}/${c?.subtype}`
  // 服务外包：按名字细分；名字认不出就落到「保洁外包」（字典里最贴近的一项）
  if (key === '采购协议/服务采购') {
    return outsourceCategoryOf(c?.name) || 'EXP_CON_SERVICE'
  }
  // 存量兜底：还没迁过来的「劳务协议」如果名字是整包服务，别算进人力成本
  if (key === '劳动合同/劳务协议' && SERVICE_OUTSOURCE_HINT.test(String(c?.name || ''))) {
    return outsourceCategoryOf(c?.name) || 'EXP_CON_SERVICE'
  }
  return CONTRACT_CATEGORY_OF[key]
    || (contractDirectionOf(c) === '支出' ? 'EXP_OP_OTHER' : 'INC_MULTI_VENUE')
}

/** 分类名称（页面显示用；取不到就显原始码，不吞掉） */
export const contractCategoryName = code =>
  (feeCategories.find(f => f.code === code) || {}).name || code || '未分类'

/** 合同类型两级树：方向 → 一级类型 → 二级子类型，带份数（筛选联动与侧栏共用） */
export function contractTypeTree(direction = '') {
  const rows = CONTRACT_ROWS.filter(c => !direction || c.direction === direction)
  const map = new Map()
  for (const c of rows) {
    if (!map.has(c.type)) map.set(c.type, { type: c.type, count: 0, subs: new Map() })
    const t = map.get(c.type)
    t.count += 1
    t.subs.set(c.subtype, (t.subs.get(c.subtype) || 0) + 1)
  }
  return [...map.values()].map(t => ({
    type: t.type,
    count: t.count,
    subs: [...t.subs.entries()].map(([subtype, count]) => ({ subtype, count }))
      .sort((a, b) => b.count - a.count)
  })).sort((a, b) => b.count - a.count)
}

/**
 * 公共收益台账（行）。
 * 口径只有一条：**公共收益归全体业主**，物业只能按合同分成拿服务费。
 * 所以台账同时给"合同额 / 归业主 / 归物业"三个数 —— 只给合同额，
 * 汇报时会被当成公司收入，而这笔钱大部分不是公司的。
 */
export function publicRevenueRows({ communityId = '', year = '' } = {}) {
  return CONTRACT_ROWS
    .filter(c => (Number(c.publicRevenue) || 0) > 0)
    .filter(c => !communityId || c.communityId === communityId)
    .filter(c => !year || (String(c.startDate).slice(0, 4) <= year && String(c.endDate).slice(0, 4) >= year))
    .map(c => {
      const pub = Math.min(Number(c.publicRevenue) || 0, Number(c.amount) || 0)
      return {
        ...c,
        publicRevenue: pub,
        ownerShare: pub,
        companyShare: Math.round((Number(c.amount) - pub) * 100) / 100,
        publicRate: c.amount ? Math.round(pub / c.amount * 10000) / 100 : 0,
        annualOwner: c.annualPublicRevenue || 0,
        annualCompany: Math.round((Number(c.annualRevenue) || 0) * 100) / 100
      }
    })
    .sort((a, b) => b.annualOwner - a.annualOwner)
}

export function publicRevenueSummary({ communityId = '', year = '' } = {}) {
  const rows = publicRevenueRows({ communityId, year })
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100
  const sum = k => r2(rows.reduce((s, x) => s + (Number(x[k]) || 0), 0))
  const byCommunity = new Map()
  for (const r of rows) {
    const k = r.communityName
    const cur = byCommunity.get(k) || { communityName: k, count: 0, amount: 0, ownerShare: 0, companyShare: 0, annualOwner: 0 }
    cur.count += 1
    cur.amount = r2(cur.amount + r.amount)
    cur.ownerShare = r2(cur.ownerShare + r.ownerShare)
    cur.companyShare = r2(cur.companyShare + r.companyShare)
    cur.annualOwner = r2(cur.annualOwner + r.annualOwner)
    byCommunity.set(k, cur)
  }
  return {
    count: rows.length,
    amount: sum('amount'),
    ownerShare: sum('ownerShare'),
    companyShare: sum('companyShare'),
    annualOwner: sum('annualOwner'),
    annualCompany: sum('annualCompany'),
    avgRate: sum('amount') ? Math.round(sum('ownerShare') / sum('amount') * 10000) / 100 : 0,
    byCommunity: [...byCommunity.values()].sort((a, b) => b.ownerShare - a.ownerShare)
  }
}

/** 台账可选年份：合同跨年，按覆盖年份给 */
export function publicRevenueYears() {
  const ys = new Set()
  for (const c of CONTRACT_ROWS) {
    if (!(Number(c.publicRevenue) > 0)) continue
    const s = Number(String(c.startDate).slice(0, 4))
    const e = Number(String(c.endDate).slice(0, 4))
    for (let y = s; y <= e; y++) if (y) ys.add(String(y))
  }
  return [...ys].sort().reverse()
}

/**
 * 年化的**商业合作收入** = (合同金额 − 公共收益) ÷ 期间月数 × 12。
 *
 * 三条硬约束都写在这里，不交给调用方判断：
 *   ① 只有 `incomeCategory=多种经营` 才有值 —— 62 份支出合同算进收入会凭空多出上千万；
 *   ② 公共收益按「归业主的部分」扣，方向与合同里的分成条款一致；
 *   ③ 期间总额年化 —— 36 个月的合同不年化会让当年虚高 3 倍。
 */
export function annualRevenueOf(c = {}) {
  if ((c.incomeCategory || '') !== '多种经营') return 0
  const m = contractMonthsOf(c)
  if (!m) return 0
  const amount = Number(c.amount) || 0
  const pub = Math.min(Number(c.publicRevenue) || 0, amount)
  return Math.round((amount - pub) / m * 12 * 100) / 100
}

/** 合同行 + 派生字段。派生值只在读的时候算，写回不落库（落库就会和原始值打架） */
function _contractRow(c) {
  const categoryId = contractCategoryOf(c)
  return {
    ...c,
    communityName: c.communityId ? communityName(c.communityId) : '集团 / 全项目',
    /* 批 4：方向与分类都是派生的 —— 85 份合同没有 direction 字段，
       但方向由类型唯一确定，存一份冗余只会给以后的写操作留下"改了类型没改方向"的坑 */
    direction: contractDirectionOf(c),
    countsInRevenue: contractCountsInRevenue(c),
    categoryId,
    categoryName: contractCategoryName(categoryId),
    // 剩余天数：正数=还在履约，负数=已过期
    restDays: daysBetween(c.endDate) === null ? null : -daysBetween(c.endDate),
    contractMonths: contractMonthsOf(c),
    annualRevenue: annualRevenueOf(c),
    annualPublicRevenue: (() => {
      if ((c.incomeCategory || '') !== '多种经营') return 0
      const m = contractMonthsOf(c)
      if (!m) return 0
      return Math.round(Math.min(Number(c.publicRevenue) || 0, Number(c.amount) || 0) / m * 12 * 100) / 100
    })()
  }
}
const CONTRACT_ROWS = contracts.map(_contractRow)

const CONTRACT_VF = {
  expiring: c => c.status === '即将到期',
  expired: c => c.status === '已到期',
  /* 待审批 + 待生效：都还没进入履行，都是"要盯"的；合同没有草稿态（新建即待审批） */
  pending: c => c.status === '待审批' || c.status === '待生效',
  big: c => c.amount >= 300000,
  group: c => !c.communityId
}

export function contractTree() {
  const roots = []
  const idx = new Map()
  for (const c of CONTRACT_ROWS) {
    let t = idx.get(c.type)
    if (!t) {
      t = { id: 'T:' + c.type, type: 'ctype', label: c.type, n: 0, children: [], _map: new Map(),
        patch: { ctype: c.type, csub: '', vf: '' } }
      idx.set(c.type, t); roots.push(t)
    }
    let s = t._map.get(c.subtype)
    if (!s) {
      s = { id: `T:${c.type}:${c.subtype}`, type: 'csub', label: c.subtype, n: 0, children: [],
        patch: { ctype: c.type, csub: c.subtype, vf: '' } }
      t.children.push(s); t._map.set(c.subtype, s)
    }
    s.n++
  }
  const tidy = n => {
    if (n.children.length) { n.children.forEach(tidy); n.n = n.children.reduce((s2, x) => s2 + x.n, 0) }
    delete n._map
    return n
  }
  return roots.map(tidy)
}
export const contractVirtualNodes = () => Object.entries(CONTRACT_VF).map(([key, hit]) => ({
  key,
  label: { expiring: '90 天内到期', expired: '已到期', pending: '待审批 / 草稿', big: '大额合同 ≥ 30 万', group: '集团级合同' }[key],
  n: CONTRACT_ROWS.filter(hit).length,
  patch: { vf: key, ctype: '', csub: '' }
}))

export function queryContracts({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const vf = CONTRACT_VF[filters.vf]
    const list = scopeFilter(CONTRACT_ROWS).filter(c =>
      (!filters.direction || c.direction === filters.direction) &&
      eq(c, filters.ctype, 'type') &&
      eq(c, filters.csub, 'subtype') &&
      eq(c, filters.communityId, 'communityId') &&
      eq(c, filters.status, 'status') &&
      eq(c, filters.incomeCategory, 'incomeCategory') &&
      eq(c, filters.categoryId, 'categoryId') &&
      (!vf || vf(c)) &&
      kwHit(c, filters.kw, ['contractNo', 'name', 'partyB', 'contact', 'owner', 'subtype'])
    )
    return paged(list, pageNo, size)
  })
}
export function contractSummary(direction = '') {
  const rows = direction ? CONTRACT_ROWS.filter(c => c.direction === direction) : CONTRACT_ROWS
  const st = s => rows.filter(c => c.status === s).length
  const ops = rows.filter(c => c.incomeCategory === '多种经营')
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100
  const amountOf = list => r2(list.reduce((s, c) => s + (Number(c.amount) || 0), 0))
  const income = rows.filter(c => c.direction === '收入')
  const expense = rows.filter(c => c.direction === '支出')
  return {
    total: rows.length,
    amount: Math.round(rows.reduce((s, c) => s + c.amount, 0)),
    running: st('履行中'),
    expiring: rows.filter(CONTRACT_VF.expiring).length,
    expired: rows.filter(CONTRACT_VF.expired).length,
    pending: rows.filter(CONTRACT_VF.pending).length,
    /* 经营口径：合同规模 ≠ 收入规模。这四项让「85 份 / 1567 万」不再被误读成收入 */
    operationCount: ops.length,
    operationAmount: r2(ops.reduce((s, c) => s + (c.annualRevenue || 0), 0)),
    publicRevenue: r2(ops.reduce((s, c) => s + (c.annualPublicRevenue || 0), 0)),
    expenseCount: rows.filter(c => c.incomeCategory === '不计入').length,
    mainCount: rows.filter(c => c.incomeCategory === '主营业务').length,

    /* 批 4：收支分列。合同总额 1567 万里有 1064 万是支出，混在一起看会以为公司收了 1567 万 */
    incomeCount: income.length,
    incomeAmount: amountOf(income),
    /* 「计入收入」的只有 17 份：另 6 份物业服务合同的钱已按账单收过，合同不再重复计 */
    incomeCountedCount: income.filter(c => c.countsInRevenue).length,
    incomeCountedAmount: amountOf(income.filter(c => c.countsInRevenue)),
    expenseTotalCount: expense.length,
    expenseTotalAmount: amountOf(expense),
    netAmount: r2(amountOf(income) - amountOf(expense))
  }
}
/**
 * 某份合同的审批单（倒序）。含新建审批与每次变更审批 —— 都用 bizId=contractId 挂，
 * 靠 changeId 区分是哪一次变更。
 */
export const contractApprovalsOf = contractId =>
  approvals
    .filter(a => a.bizType === '合同审批' && a.bizId === contractId)
    .slice()
    .sort((a, b) => String(b.applyTime).localeCompare(String(a.applyTime)))

/** 在途的那一张（列表显示「卡在哪个节点」用；已通过的历史单不占位） */
export const contractApprovalOf = contractId =>
  approvals.find(a => a.bizType === '合同审批' && a.bizId === contractId
    && ['待审批', '审批中'].includes(a.status)) || null

/** 合同详情：相对方可能是供应商 / 业主 / 员工（refType 决定展示哪一段） */
export function getContractDetail(contractId) {
  return delay(() => {
    const contract = CONTRACT_ROWS.find(c => c.contractId === contractId)
    if (!contract) return null
    let ref = null
    if (contract.refType === 'house') ref = HOUSE_ROWS.find(h => h.houseId === contract.refId)
    else if (contract.refType === 'parking') ref = PARKING_OF.get(contract.refId)
    else if (contract.refType === 'employee') ref = employees.find(e => e.empId === contract.refId)
    return {
      contract, ref,
      /* 审批单：以前详情不返回它，于是「待审批的合同点进去看不到流程」，只能去待办中心翻 */
      approvals: contractApprovalsOf(contractId),
      timeline: [
        { title: `签订 · ${contract.signDate}`, memo: `${contract.partyB} · 附件 ${contract.attachments} 份`, done: true },
        { title: `生效 · ${contract.startDate}`, memo: `合同金额 ¥${contract.amount} · ${contract.payCycle}`, done: d(contract.startDate) <= new Date() },
        { title: `到期 · ${contract.endDate}`,
          memo: contract.status === '已到期' ? '已到期 · 待续签或终止' : (contract.status === '即将到期' ? `剩余 ${contract.restDays} 天 · 待发起续签审批` : `剩余 ${contract.restDays} 天`),
          done: false }
      ]
    }
  })
}
const d = s => new Date(String(s).slice(0, 10))
/* 类型下拉读**字典**而不是 distinct(contracts)：新建合同时，还没人用过的类型也得能选 */
export const contractTypeOpts = () => [...CONTRACT_TYPES]
export const contractStatusOpts = () => distinct(contracts, 'status')

/* ---------------- 31 · 公告通知 ---------------- */

const NOTICE_ROWS = notices.map(n => ({
  ...n,
  communityName: n.communityId ? communityName(n.communityId) : '全部项目',
  readRate: n.targetHouses ? Math.round((n.readCount / n.targetHouses) * 1000) / 10 : 0,
  channelText: n.channels.join(' / ')
}))
/**
 * 把 notices 的写操作同步到派生行 NOTICE_ROWS。
 * 列表 / 树 / 汇总 / 详情全部读派生行，只改原数组会导致「保存成功但列表不变」。
 */
function _syncNoticeRow(n, { insert = false } = {}) {
  const derived = {
    ...n,
    communityName: n.communityId ? communityName(n.communityId) : '全部项目',
    readRate: n.targetHouses ? Math.round((n.readCount / n.targetHouses) * 1000) / 10 : 0,
    channelText: n.channels.join(' / ')
  }
  const i = NOTICE_ROWS.findIndex(r => r.noticeId === n.noticeId)
  if (i >= 0) NOTICE_ROWS.splice(i, 1, derived)
  else if (insert) NOTICE_ROWS.unshift(derived)
  else NOTICE_ROWS.push(derived)
  return derived
}
const NOTICE_VF = {
  published: n => n.status === '已发布',
  pending: n => n.status === '草稿' || n.status === '待审核',
  expired: n => n.status === '已过期',
  top: n => !!n.top,
  lowRead: n => n.status === '已发布' && n.readRate < 60
}

export function noticeTree() {
  const roots = []
  const idx = new Map()
  for (const n of NOTICE_ROWS) {
    let t = idx.get(n.type)
    if (!t) {
      t = { id: 'N:' + n.type, type: 'ntype', label: n.type, n: 0, children: [], _map: new Map(),
        patch: { ntype: n.type, communityId: '', vf: '' } }
      idx.set(n.type, t); roots.push(t)
    }
    const ckey = n.communityId || 'ALL'
    let c = t._map.get(ckey)
    if (!c) {
      c = { id: `N:${n.type}:${ckey}`, type: 'ncom', label: n.communityName, n: 0, children: [],
        patch: { ntype: n.type, communityId: n.communityId, vf: '' } }
      t.children.push(c); t._map.set(ckey, c)
    }
    c.n++
  }
  const tidy = n => {
    if (n.children.length) { n.children.forEach(tidy); n.n = n.children.reduce((s, x) => s + x.n, 0) }
    delete n._map
    return n
  }
  return roots.map(tidy)
}
export const noticeVirtualNodes = () => Object.entries(NOTICE_VF).map(([key, hit]) => ({
  key,
  label: { published: '已发布', pending: '草稿 / 待审核', expired: '已过期', top: '置顶公告', lowRead: '触达率 < 60%' }[key],
  n: NOTICE_ROWS.filter(hit).length,
  patch: { vf: key, ntype: '', communityId: '' }
}))

export function queryNotices({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const vf = NOTICE_VF[filters.vf]
    const list = NOTICE_ROWS.filter(n =>
      eq(n, filters.ntype, 'type') &&
      eq(n, filters.communityId, 'communityId') &&
      eq(n, filters.status, 'status') &&
      (!vf || vf(n)) &&
      kwHit(n, filters.kw, ['title', 'noticeId', 'publisher', 'content'])
    )
    return paged(list, pageNo, size)
  })
}
export function noticeSummary() {
  const pub = NOTICE_ROWS.filter(NOTICE_VF.published)
  const rate = pub.length ? pub.reduce((s, n) => s + n.readRate, 0) / pub.length : 0
  return {
    total: NOTICE_ROWS.length,
    published: pub.length,
    pending: NOTICE_ROWS.filter(NOTICE_VF.pending).length,
    expired: NOTICE_ROWS.filter(NOTICE_VF.expired).length,
    avgReadRate: Math.round(rate * 10) / 10,
    lowRead: NOTICE_ROWS.filter(NOTICE_VF.lowRead).length
  }
}
export function getNoticeDetail(noticeId) {
  return delay(() => {
    const notice = NOTICE_ROWS.find(n => n.noticeId === noticeId)
    if (!notice) return null
    return {
      notice,
      unreached: Math.max(0, notice.targetHouses - notice.readCount),
      timeline: [
        { title: `起草 · ${notice.publisher}`, memo: `${notice.communityName} · ${notice.attachments} 个附件`, done: true },
        { title: notice.auditBy ? `审核通过 · ${notice.auditBy}` : '待审核', memo: notice.auditTime || '尚未提交审核', done: !!notice.auditBy },
        { title: `发布 · ${notice.publishTime}`, memo: `${notice.channelText} · 覆盖 ${notice.targetHouses} 户`, done: notice.status === '已发布' || notice.status === '已过期' },
        { title: `触达 ${notice.readRate}%`, memo: `已读 ${notice.readCount} 户 · 未读 ${Math.max(0, notice.targetHouses - notice.readCount)} 户`, done: false }
      ]
    }
  })
}
export const noticeTypeOpts = () => distinct(notices, 'type')
export const noticeStatusOpts = () => distinct(notices, 'status')

/* ---------------- 32 · 品质检查记录 ---------------- */

const QC_GROUPS = ['环境保洁', '秩序维护', '工程设施', '客户服务']
const QC_ROWS = qualityChecks.map(q => ({
  ...q,
  communityName: communityName(q.communityId),
  /* 老记录没有 sourceType，列表「来源」列统一显示为现场抽查 */
  sourceType: q.sourceType || '现场抽查',
  overdue: q.status === '已超时',
  month: q.checkDate.slice(0, 7)
}))
const QC_VF = {
  rectifying: q => q.status === '整改中',
  overdue: q => q.status === '已超时',
  recheck: q => q.status === '待复核',
  unqualified: q => q.grade === '不合格' || q.veto,
  recent: q => daysBetween(q.checkDate) !== null && daysBetween(q.checkDate) <= 30
}

/** 同步品质派生行（列表 / 左树 / 汇总都读 QC_ROWS，只改源表会出现「转了工单但列表不变」） */
function _syncQualityRow(q) {
  const derived = {
    ...q,
    communityName: communityName(q.communityId),
    sourceType: q.sourceType || '现场抽查',
    overdue: q.status === '已超时',
    month: q.checkDate.slice(0, 7)
  }
  const i = QC_ROWS.findIndex(x => x.checkId === q.checkId)
  if (i >= 0) QC_ROWS.splice(i, 1, derived)
  else QC_ROWS.unshift(derived)
}

export function qualityTree() {
  const roots = []
  const idx = new Map()
  for (const q of QC_ROWS) {
    let c = idx.get(q.communityId)
    if (!c) {
      c = { id: 'Q:' + q.communityId, type: 'community', label: q.communityName, n: 0, children: [], _map: new Map(),
        patch: { communityId: q.communityId, area: '', vf: '' } }
      idx.set(q.communityId, c); roots.push(c)
    }
    let a = c._map.get(q.area)
    if (!a) {
      a = { id: `Q:${q.communityId}:${q.area}`, type: 'area', label: q.area, n: 0, children: [],
        patch: { communityId: q.communityId, area: q.area, vf: '' } }
      c.children.push(a); c._map.set(q.area, a)
    }
    a.n++
  }
  const tidy = n => {
    if (n.children.length) { n.children.forEach(tidy); n.n = n.children.reduce((s, x) => s + x.n, 0) }
    delete n._map
    return n
  }
  return roots.map(tidy)
}
export const qualityVirtualNodes = () => Object.entries(QC_VF).map(([key, hit]) => ({
  key,
  label: { rectifying: '整改中', overdue: '整改已超时', recheck: '待复核', unqualified: '不合格 / 一票否决', recent: '近 30 天' }[key],
  n: QC_ROWS.filter(hit).length,
  patch: { vf: key, communityId: '', area: '' }
}))

/** 品质记录筛选谓词：列表与「范围小计」共用 */
function _qcHit(filters = {}) {
  const vf = QC_VF[filters.vf]
  return q =>
    eq(q, filters.communityId, 'communityId') &&
    eq(q, filters.area, 'area') &&
    eq(q, filters.type, 'type') &&
    eq(q, filters.grade, 'grade') &&
    eq(q, filters.status, 'status') &&
    eq(q, filters.sourceType, 'sourceType') &&
    (!vf || vf(q)) &&
    kwHit(q, filters.kw, ['checkNo', 'checker', 'area', 'communityName'])
}

/** 当前筛选范围小计：条数 / 平均分 / 不合格 / 整改中 */
export function qcScopeSummary(filters = {}) {
  const list = QC_ROWS.filter(_qcHit(filters))
  const avg = list.length ? Math.round(list.reduce((s, q) => s + q.score, 0) / list.length * 10) / 10 : 0
  return {
    count: list.length,
    avgScore: avg,
    unqualified: list.filter(q => q.grade === '不合格' || q.veto).length,
    rectifying: list.filter(q => q.status === '整改中').length,
    overdue: list.filter(q => q.status === '已超时').length
  }
}

export function queryQualityChecks({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const list = QC_ROWS.filter(_qcHit(filters))
    return paged(list, pageNo, size)
  })
}
export function qualitySummary() {
  const avg = QC_ROWS.reduce((s, q) => s + q.score, 0) / (QC_ROWS.length || 1)
  return {
    total: QC_ROWS.length,
    avgScore: Math.round(avg * 10) / 10,
    qualified: QC_ROWS.filter(q => q.grade !== '不合格').length,
    rectifying: QC_ROWS.filter(QC_VF.rectifying).length,
    overdue: QC_ROWS.filter(QC_VF.overdue).length,
    recheck: QC_ROWS.filter(QC_VF.recheck).length,
    veto: QC_ROWS.filter(q => q.veto).length
  }
}
/** 整改项：按扣分数派生（原型阶段不另建整改单实体，避免与 workOrders 口径打架） */
function rectifyItems(q) {
  if (!q.deductCount) return []
  const out = []
  for (let i = 0; i < q.deductCount; i++) {
    const done = i < q.rectifyDone
    out.push({
      idx: i + 1,
      group: QC_GROUPS[i % QC_GROUPS.length],
      item: `${q.area} · 第 ${i + 1} 项`,
      reason: ['现场杂物堆放', '设施表面污渍', '记录填写不完整', '警示标识缺失', '照明损坏未更换',
               '消防通道被占用', '绿化带裸露', '岗亭登记缺项', '设备房未上锁', '电梯轿厢广告破损'][i % 10],
      level: q.veto && i === 0 ? '一票否决' : (i % 3 === 0 ? '严重' : i % 3 === 1 ? '一般' : '轻微'),
      done
    })
  }
  return out
}
export function getQualityCheckDetail(checkId) {
  return delay(() => {
    const check = QC_ROWS.find(q => q.checkId === checkId)
    if (!check) return null
    return {
      check,
      items: rectifyItems(check),
      timeline: [
        { title: `现场检查 · ${check.checker}`, memo: `${check.communityName} · ${check.area} · ${check.type}检查`, done: true },
        { title: `评分 ${check.score} 分（${check.grade}）`, memo: `扣分项 ${check.deductCount} 项${check.veto ? ' · 触发一票否决' : ''}`, done: true },
        { title: `整改单 ${check.rectifyCount} 项`, memo: `已闭环 ${check.rectifyDone} 项 · 期限 ${check.dueDate}`, done: check.rectifyCount > 0 && check.rectifyDone >= check.rectifyCount },
        { title: check.recheck ? '已安排下轮抽查' : '未安排复查', memo: check.recheck ? '上轮问题本轮加权复查，防止回潮' : '可在整改闭环后发起复查', done: !!check.recheck }
      ]
    }
  })
}
export const qualityAreaOpts = () => distinct(qualityChecks, 'area')
export const qualityTypeOpts = () => distinct(qualityChecks, 'type')
export const qualityGradeOpts = () => ['优秀', '良好', '合格', '不合格']
export const qualityStatusOpts = () => distinct(qualityChecks, 'status')

/* ---------------- 补充批次的跨页锚点 ---------------- */
/** 在 focusLocation 之外补四个新实体的落地范围，供 /a/tenants /c/contracts /c/notices /f/quality-records 使用 */
export function focusExtra(type, id) {
  if (type === 'tenant') {
    const t = TENANT_ROWS.find(x => x.tenantId === id)
    return t ? { communityId: t.communityId, buildingId: t.buildingId, unitId: t.unitId, houseId: t.houseId, ownerId: t.ownerId } : null
  }
  if (type === 'contract') {
    const c = CONTRACT_ROWS.find(x => x.contractId === id)
    return c ? { ctype: c.type, csub: c.subtype, communityId: c.communityId } : null
  }
  if (type === 'notice') {
    const n = NOTICE_ROWS.find(x => x.noticeId === id)
    return n ? { ntype: n.type, communityId: n.communityId } : null
  }
  if (type === 'check') {
    const q = QC_ROWS.find(x => x.checkId === id)
    return q ? { communityId: q.communityId, area: q.area } : null
  }
  if (type === 'pass') {
    const p = PASS_ROWS.find(x => x.passId === id)
    return p ? { communityId: p.communityId, zone: p.zone, passId: id } : null
  }
  if (type === 'pay') {
    const p = PAY_ROWS.find(x => x.payId === id)
    return p ? { communityId: p.communityId, buildingId: p.buildingId, unitId: p.unitId, payId: id } : null
  }
  if (type === 'wo') {
    const w = WO_ROWS.find(x => x.woId === id)
    return w ? { communityId: w.communityId, buildingId: w.buildingId, unitId: w.unitId, woId: id } : null
  }
  if (type === 'bill') {
    const b = bills.find(x => x.billId === id)
    if (!b) return null
    const hs = HOUSE_SPACE.get(b.houseId)
    return { communityId: b.communityId, buildingId: hs?.buildingId || '', unitId: hs?.unitId || '', billId: id }
  }
  return null
}

/* ==================================================================
 * E 域 · 组织与权限（2026-10-22 新增）
 * 模型（用户已拍板）：纯 RBAC —— 人 → 角色 → 权限；数据权限按项目级六档（2026-10-29 增「责任范围」）
 * 员工表不存 roleId / 班组：由岗位反推，避免为原型改动既有 120 条员工数据
 * ================================================================== */

const ORG_OF = new Map(orgs.map(o => [o.orgId, o]))

/** 岗位 → 角色（roles.positions 反查） */
const ROLE_OF_POS = new Map()
for (const r of roles) for (const p of r.positions || []) ROLE_OF_POS.set(p, r.roleId)
const ROLE_OF = new Map(roles.map(r => [r.roleId, r]))

/** 岗位 → 班组（项目部下 T1 客服 / T2 工程 / T3 安保 / T4 环境）；总部职能岗 → 部门 */
const TEAM_BY_POS = {
  客服主管: 'T1', 客服专员: 'T1', 收银员: 'T1',
  工程主管: 'T2', 维修工: 'T2',
  安保主管: 'T3', 保安: 'T3',
  环境主管: 'T4', 保洁员: 'T4', 绿化员: 'T4'
}
const DEPT_BY_POS = {
  财务主管: 'O-FIN', 会计: 'O-FIN', 收银员: 'O-FIN',
  人事专员: 'O-HR', 品质专员: 'O-QS', 工程主管: 'O-ENG', 维修工: 'O-ENG'
}
const isProject = id => /^O-P\d+$/.test(id || '')

/** 员工的实际归属：项目部员工落到班组，总部员工落到职能部门，其余留在原组织 */
export function teamOf(e) {
  if (isProject(e.orgId)) {
    const t = TEAM_BY_POS[e.position]
    return t ? `${e.orgId}-${t}` : ''
  }
  return DEPT_BY_POS[e.position] || ''
}

/** 组织全路径：集团 / 总部职能中心 / 财务管理部 */
export function orgPathOf(orgId) {
  const chain = []
  let cur = ORG_OF.get(orgId)
  while (cur) {
    chain.unshift(cur.name)
    cur = cur.parentId ? ORG_OF.get(cur.parentId) : null
  }
  return chain.join(' / ')
}
/** 子树 id 集合（含自身），用于点任意层级都能看到下级成员 */
const DESC_CACHE = new Map()
function descOf(orgId) {
  if (!orgId) return null
  if (DESC_CACHE.has(orgId)) return DESC_CACHE.get(orgId)
  const out = []
  const walk = id => {
    out.push(id)
    for (const o of orgs) if (o.parentId === id) walk(o.orgId)
  }
  walk(orgId)
  const set = new Set(out)
  DESC_CACHE.set(orgId, set)
  return set
}

/**
 * 员工 → 角色。纯岗位映射会误判：数据里项目部也挂「总经理」岗位（6 人），
 * 但集团总经理只应有一位，项目部的一律按项目经理算，否则会出现 7 个人都能看全部项目。
 */
const roleOfEmp = e =>
  ROLE_OF.get(e.position === '总经理' && isProject(e.orgId) ? 'R-PM' : (ROLE_OF_POS.get(e.position) || '')) || null

/** 调整角色后的覆盖（优先于岗位反推）；内存态，刷新还原 */
const EMP_ROLE_OVERRIDE = new Map()

/** 档案版本号（乐观锁）：写操作后 +1；刷新页面回到 1 */
const EMP_VER = new Map()
const empVerOf = empId => EMP_VER.get(empId) || 1

const empRow = e => {
  const orgId = teamOf(e) || e.orgId
  const overridden = EMP_ROLE_OVERRIDE.get(e.empId)
  const role = (overridden && ROLE_OF.get(overridden)) || roleOfEmp(e)
  const cl = daysBetween(e.contractEnd)
  return {
    ...e,
    orgId,
    /* 人事档案上的组织（人挂项目部）与实际归属（班组/部门）分开存：
       合成一个的话，班组调整会顺手改掉档案归属，人力对不上花名册 */
    homeOrgId: e.orgId,
    orgName: ORG_OF.get(orgId)?.name || '-',
    orgPath: orgPathOf(orgId),
    projName: isProject(e.orgId) ? (ORG_OF.get(e.orgId)?.name || '') : '总部职能',
    roleId: role?.roleId || '',
    roleName: role?.name || '未分配',
    permCount: role?.perms.length || 0,
    dataScope: role?.dataScope || '',
    scopeLevel: role?.scope || '',
    contractLeft: cl === null ? null : -cl,
    contractExpired: cl === null ? false : -cl < 0,
    /* 30 天内到期：劳动合同不续签要提前一个月通知，等到过期才提醒，赔偿金已经产生了 */
    contractExpiring: cl !== null && -cl >= 0 && -cl <= 30 && e.status !== '离职',
    noSocial: !e.socialSecurity,
    lateHeavy: (e.attendance?.late || 0) >= 3,
    _ver: empVerOf(e.empId)
  }
}
const EMP_ROWS = employees.map(empRow)

/** 虚拟视图：围绕「谁能看到什么」，而非泛泛的人员状态 */
const EMP_VF = {
  onjob: e => e.status === '在职',
  probation: e => e.status === '试用',
  selfOnly: e => e.dataScope === '仅本人',
  deptOnly: e => e.dataScope === '本部门',
  groupAll: e => e.dataScope === '全部项目'
}
export const orgVirtualNodes = () => {
  const label = {
    onjob: '在职', probation: '试用待转正', selfOnly: '仅本人数据范围',
    deptOnly: '本部门数据范围', groupAll: '可见全部项目'
  }
  return [{ key: 'all', label: '全部成员', n: EMP_ROWS.length, patch: { orgId: '', vf: '' } }]
    .concat(Object.keys(EMP_VF).map(key => ({
      key, label: label[key], n: EMP_ROWS.filter(EMP_VF[key]).length,
      patch: { orgId: '', vf: key }
    })))
}

/** 组织树：集团 → 中心/项目部 → 部门 → 班组；n 为子树人数（含下级） */
export function orgTree() {
  const subtreeCount = orgId => {
    const ids = descOf(orgId)
    return ids ? EMP_ROWS.filter(e => ids.has(e.orgId)).length : 0
  }
  const build = parentId => orgs
    .filter(o => (o.parentId || '') === parentId)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(o => {
      const kids = build(o.orgId)
      return {
        id: o.orgId,
        label: o.name,
        type: o.type,
        n: subtreeCount(o.orgId),
        leader: o.leader,
        children: kids.length ? kids : undefined,
        patch: { orgId: o.orgId, vf: '' }
      }
    })
  /** 根取「集团」的下级：el-tree 默认折叠，返回单根会让进页面只看到一个节点 */
  return build('O-ROOT')
}

/** 组织扁平行（含两列人数）：列表 / 新增 / 修改共用同一份构行逻辑 */
function _orgRowOf(o) {
  const self = new Map()
  for (const e of EMP_ROWS) self.set(e.orgId, (self.get(e.orgId) || 0) + 1)
  const ids = descOf(o.orgId)
  return {
    orgId: o.orgId, name: o.name, parentId: o.parentId || '', type: o.type,
    leader: o.leader || '', sort: o.sort || 0,
    /* 负责人列表随组织行一起下发：组织树与维护表要能一次看到"谁是正职、谁在代理"，
       再去逐个查是 N+1 次请求 */
    leaders: leadersOf(o.orgId),
    headcount: ids ? EMP_ROWS.filter(e => ids.has(e.orgId)).length : 0,
    selfHeadcount: self.get(o.orgId) || 0
  }
}

/**
 * 组织扁平列表（契约 `GET /orgs`）：节点 + 上级 + 人数，建树留给前端。
 * 返回树的接口在"按某部门下所有班组筛人"时还得先摊平一次，所以这里给平的。
 */
export function orgRows({ type = '', parentId = '', kw = '' } = {}) {
  return orgs
    .filter(o => !type || o.type === type)
    .filter(o => !parentId || (o.parentId || '') === parentId)
    .filter(o => !kw || [o.name, o.leader, o.orgId].join(' ').includes(kw))
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(_orgRowOf)
}

/** 组织类错误：带上业务码，页面才好区分「重名」与「不能这么改」 */
function _orgErr(msg, code) {
  const e = new Error(msg)
  e.code = code
  return e
}

/**
 * 改名 / 改上级 / 改负责人之后，员工行上缓存的 `orgName` / `orgPath` 会变成旧值。
 * 一个人 120 条，重算一遍很便宜；不重算的结果是「组织叫客服一组，成员列表还写着客服二组」。
 */
function _refreshEmpOrgLabels() {
  for (const e of EMP_ROWS) {
    e.orgName = ORG_OF.get(e.orgId)?.name || '-'
    e.orgPath = orgPathOf(e.orgId)
  }
}

/**
 * 新增组织（契约 `POST /orgs`）：只能建 部门 / 班组。
 * 集团与项目要伴随立项/设立一整套动作（合同、人员、账套），不是一个"新增组织"能建的。
 */
export function createOrg({ name = '', type = '', parentId = '', leader = '', leaderEmpId = '', sort } = {}) {
  const n = String(name).trim()
  if (n.length < 2) throw _orgErr('组织名称至少 2 个字', 42201)
  if (!['部门', '班组'].includes(type)) {
    throw _orgErr('只能新增 部门 / 班组；集团与项目由立项流程创建', 42201)
  }
  const parent = ORG_OF.get(parentId)
  if (!parent) throw _orgErr('上级组织不存在', 404)
  if (orgs.some(o => (o.parentId || '') === parentId && o.name === n)) {
    throw _orgErr(`「${parent.name}」下已有「${n}」，同级不能重名`, 40902)
  }
  /* orgId 服务端生成：前端生成的话，两个人同时新增会撞号，而 orgId 是员工、账套、报表的引用键 */
  let id
  if (type === '班组') {
    let k = orgs.filter(o => o.parentId === parentId && o.type === '班组').length + 1
    id = `${parentId}-T${k}`
    while (ORG_OF.has(id)) id = `${parentId}-T${++k}`
  } else {
    let k = orgs.filter(o => o.type === '部门').length + 1
    id = 'O-D' + String(k).padStart(2, '0')
    while (ORG_OF.has(id)) id = 'O-D' + String(++k).padStart(2, '0')
  }
  const rec = { orgId: id, name: n, parentId, type, leader: String(leader || ''), sort: Number(sort) || 99 }
  orgs.push(rec)
  ORG_OF.set(id, rec)
  DESC_CACHE.clear()
  /* 负责人走关系表：建组织时顺手指定正职，避免"先建出来再去补负责人" */
  if (leaderEmpId) saveOrgLeader({ orgId: id, empId: leaderEmpId, duty: '正职' })
  track('org_create', { orgId: id, type })
  return _orgRowOf(rec)
}

/**
 * 修改组织（契约 `PATCH /orgs/{orgId}`）。
 * 三条不让改：**类型**（班组改部门，下面的人从"走排班"变"走职能"，等于重挂一批人）、
 * **集团改上级**、**挂到自己的下级下面**（成环后整棵子树从组织树消失，但列表里人还在）。
 */
export function updateOrg(orgId, { name, type, parentId, leader, sort } = {}) {
  const o = ORG_OF.get(orgId)
  if (!o) throw _orgErr('组织不存在', 404)
  if (type !== undefined) {
    throw _orgErr('不能改组织类型：改类型会让下面所有人的归属语义整体变化，走组织调整单据', 42201)
  }
  if (parentId !== undefined && parentId !== o.parentId) {
    if (orgId === 'O-ROOT') throw _orgErr('集团节点不能改上级', 42201)
    if (!ORG_OF.has(parentId)) throw _orgErr('上级组织不存在', 404)
    if (descOf(orgId).has(parentId)) {
      throw _orgErr('不能把组织挂到它自己的下级下面——会形成环，下面的人就从组织架构里消失了', 42201)
    }
  }
  if (name !== undefined) {
    const n = String(name).trim()
    if (n.length < 2) throw _orgErr('组织名称至少 2 个字', 42201)
    const pid = parentId !== undefined ? parentId : (o.parentId || '')
    if (orgs.some(x => x.orgId !== orgId && (x.parentId || '') === pid && x.name === n)) {
      throw _orgErr(`同级已有「${n}」`, 40902)
    }
    o.name = n
  }
  /* leader 是遗留入参：负责人已经走关系表（/orgs/{id}/leaders），
     这里只为兼容老调用方保留，页面不再传 —— 直接改这个字段会让组织树显示
     与审批解析（读关系表）对不上。 */
  if (leader !== undefined) o.leader = String(leader)
  if (sort !== undefined) o.sort = Number(sort) || 0
  if (parentId !== undefined) o.parentId = parentId
  DESC_CACHE.clear()   /* 移动后子树缓存失效 */
  _refreshEmpOrgLabels()
  track('org_update', { orgId, moved: parentId !== undefined })
  return _orgRowOf(o)
}

/** 成员列表（Tab1） */
export function queryOrgMembers({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const ids = descOf(filters.orgId)
    const vf = EMP_VF[filters.vf]
    const list = EMP_ROWS.filter(e =>
      (!ids || ids.has(e.orgId)) &&
      eq(e, filters.roleId, 'roleId') &&
      eq(e, filters.status, 'status') &&
      eq(e, filters.empType, 'empType') &&
      eq(e, filters.dataScope, 'dataScope') &&
      (!vf || vf(e)) &&
      kwHit(e, filters.kw, ['name', 'empNo', 'position', 'phone', 'roleName', 'orgName'])
    )
    return paged(list, pageNo, size)
  })
}

/* ---------------- 角色与权限（Tab2） ---------------- */

const ROLE_ROWS = roles.map(r => {
  const users = EMP_ROWS.filter(e => e.roleId === r.roleId)
  const scopeText = {
    全部项目: `全部 ${communities.length} 个项目`,
    指定项目: '指定项目',
    本项目: '所在项目部',
    本部门: '本班组 / 部门',
    仅本人: '仅本人产生的数据'
  }[r.dataScope] || r.dataScope
  return {
    ...r,
    userCount: users.length,
    permCount: r.perms.length,
    communityNames: (r.communities || []).map(id => communityName(id)),
    scopeText,
    domains: [...new Set(r.perms.map(c => c.split('.')[0]))].sort()
      .map(d => permissions.find(p => p.domain === d)?.domainName || d),
    /** 权限覆盖度：占全部权限位的比例，用于横向比较角色的权限大小 */
    coverage: Math.round((r.perms.length / permissions.length) * 100)
  }
})
export const roleRows = () => ROLE_ROWS

/** 权限矩阵：按域 → 功能 → 操作展开，roleId 为空时返回全量字典（不带勾选） */
export function permissionMatrix(roleId) {
  // 读 rbac 的「生效权限」（含 E2 保存的覆盖表），否则保存后抽屉仍显示旧勾选
  const has = roleId ? permCodesOfRole(roleId) : new Set()
  const groups = []
  for (const p of permissions) {
    let g = groups.find(x => x.domain === p.domain)
    if (!g) groups.push((g = { domain: p.domain, domainName: p.domainName, funcs: [] }))
    let f = g.funcs.find(x => x.func === p.func)
    if (!f) g.funcs.push((f = { func: p.func, funcName: p.funcName, route: p.route, ops: [] }))
    f.ops.push({ code: p.code, opName: p.opName, on: has.has(p.code) })
  }
  return {
    groups,
    total: permissions.length,
    granted: has.size,
    coverage: Math.round((has.size / permissions.length) * 100)
  }
}

/**
 * E2 保存权限矩阵后，把「生效权限」回写到角色派生行（ROLE_ROWS）。
 * 不调用它会出现：侧栏菜单已按新权限收紧，但角色列表 / 抽屉仍显示旧的「已授权 50/50」。
 */
export function syncRolePermsRow(roleId) {
  const i = ROLE_ROWS.findIndex(x => x.roleId === roleId)
  if (i < 0) return null
  const eff = [...permCodesOfRole(roleId)]
  const row = {
    ...ROLE_ROWS[i],
    perms: eff,
    permCount: eff.length,
    domains: [...new Set(eff.map(c => c.split('.')[0]))].sort()
      .map(d => permissions.find(p => p.domain === d)?.domainName || d),
    coverage: Math.round((eff.length / permissions.length) * 100)
  }
  ROLE_ROWS.splice(i, 1, row)
  return { ...row }
}

/** 角色详情：权限矩阵 + 成员样本 + 可见范围说明 */
export function getRoleDetail(roleId) {
  const r = ROLE_ROWS.find(x => x.roleId === roleId)
  if (!r) return null
  const matrix = permissionMatrix(roleId)
  return {
    role: r,
    matrix,
    members: EMP_ROWS.filter(e => e.roleId === roleId).slice(0, 6)
      .map(e => ({ empId: e.empId, name: e.name, position: e.position, orgName: e.orgName })),
    visible: r.dataScope === '指定项目'
      ? r.communityNames.join('、')
      : (r.dataScope === '全部项目' ? `全部 ${communities.length} 个项目` : r.scopeText),
    /** 按域统计已授权数，抽屉里可直接看出「这个角色主要管哪几个域」 */
    byDomain: matrix.groups.map(g => ({
      domainName: g.domainName,
      granted: g.funcs.reduce((s, f) => s + f.ops.filter(o => o.on).length, 0),
      total: g.funcs.reduce((s, f) => s + f.ops.length, 0)
    }))
  }
}

/** 成员详情（Tab1 抽屉）：档案 + 角色 + 可见范围 */
export function getMemberDetail(empId) {
  const e = EMP_ROWS.find(x => x.empId === empId)
  if (!e) return null
  const role = ROLE_OF.get(e.roleId)
  return {
    member: e,
    role: role ? ROLE_ROWS.find(r => r.roleId === role.roleId) : null,
    matrix: permissionMatrix(e.roleId),
    org: { path: e.orgPath, name: e.orgName, leader: ORG_OF.get(e.orgId)?.leader || '' },
    /** 合同剩余天数：负值即已过期未续签 */
    contract: { start: e.contractStart, end: e.contractEnd, left: e.contractLeft },
    attendance: e.attendance
  }
}

/* ---------------- 汇总与筛选项 ---------------- */

export function orgSummary() {
  const count = f => EMP_ROWS.filter(f).length
  return {
    total: EMP_ROWS.length,
    onjob: count(EMP_VF.onjob),
    probation: count(EMP_VF.probation),
    left: count(e => e.status === '离职'),
    orgCount: orgs.length,
    teamCount: orgs.filter(o => o.type === '班组').length,
    roleCount: roles.length,
    permCount: permissions.length,
    noRole: count(e => !e.roleId),
    selfOnly: count(EMP_VF.selfOnly),
    deptOnly: count(EMP_VF.deptOnly),
    groupAll: count(EMP_VF.groupAll),
    contractExpired: count(e => e.contractExpired),
    contractExpiring: count(e => e.contractExpiring)
  }
}

export const roleOpts = () => ROLE_ROWS.map(r => ({ value: r.roleId, label: r.name }))

/* ---------------- 员工域 · 契约接口的原型实现（2026-10-30） ----------------
   适配层 src/api/employees.js 在 mock 模式下转发到这里。三条与契约对齐的口径：
   ① **不返回薪资**：行里的 baseSalary / monthlySalary / bankCard 由适配层剥掉；
   ② **组织归属拆两个字段**：homeOrgId（档案）/ orgId（岗位反推的实际归属）；
   ③ **离职即收权**：离职员工 roleId 为空——人走了权限还在，是最常见的一类越权。
*/

/** 选人池：只回在职（试用也算）；不含手机证件——选人不需要看人事档案 */
export function employeeOptionRows({ teamId = '', kw = '', size = 50 } = {}) {
  return EMP_ROWS
    .filter(e => e.status !== '离职')
    .filter(e => !teamId || teamOf(e) === teamId || e.orgId === teamId)
    .filter(e => !kw || String(e.name).includes(kw))
    .slice(0, size)
    .map(e => ({
      empId: e.empId, name: e.name, label: `${e.name} · ${e.position}`,
      position: e.position, teamId: teamOf(e), orgName: e.orgName,
      status: e.status, assignable: true
    }))
}

/** 员工详情（契约形状）：角色 + 组织路径 + 合同 + 出勤；工资条只给 null，不给 0 */
export function employeeDetailOf(empId) {
  const e = EMP_ROWS.find(x => x.empId === empId)
  if (!e) return null
  const role = ROLE_OF.get(e.roleId)
  const roleRow = ROLE_ROWS.find(r => r.roleId === e.roleId)
  return {
    employee: e,
    role: role ? {
      roleId: role.roleId, name: role.name, scope: role.scope,
      dataScope: role.dataScope, permCount: role.perms.length,
      domains: roleRow?.domains || []
    } : {},
    org: {
      name: e.orgName, path: e.orgPath,
      leader: ORG_OF.get(e.orgId)?.leader || '',
      teamId: teamOf(employees.find(x => x.empId === empId) || {})
    },
    contract: { start: e.contractStart, end: e.contractEnd, daysLeft: e.contractLeft, expired: e.contractExpired },
    attendance: e.attendance,
    certificates: e.certificates || [],
    related: { contracts: 0, payrollRecords: null }
  }
}

/** 薪资字段：员工域一律剥掉（适配层统一调用，页面拿不到就不会去显示） */
const PAY_FIELDS = ['baseSalary', 'monthlySalary', 'bankCard']
export const stripPayFields = e => {
  const o = { ...e }
  for (const k of PAY_FIELDS) delete o[k]
  return o
}

/** 紧急联系人：与本人关系。用枚举而不是自由文本 —— 真出事时"该找谁"靠这一栏判断 */
export const EMPLOYEE_RELATION_OPTS = ['配偶', '父亲', '母亲', '子女', '兄弟姐妹', '其他']

const EMP_EDITABLE_FIELDS = [
  'position', 'level', 'empType', 'status', 'contractStart', 'contractEnd',
  'phone', 'idCard', 'socialSecurity', 'regularDate', 'score', 'certificates', 'manager',
  /* 2026-11-04：紧急联系人与联系方式。员工档案缺这一项，出事先找不到人 —— 这项和薪资不同，越权风险低但漏了代价高 */
  'emergencyContact', 'emergencyRelation', 'emergencyPhone'
]
/** 明确拒绝，不静默忽略：静默忽略的结果是页面提示"保存成功"，实际什么都没改 */
const EMP_READONLY_FIELDS = {
  roleId: '角色走「调整角色」（要留"谁把谁提成主管"的痕迹）',
  orgId: '组织调动是调岗单据（调出/调入确认 + 生效日），不是一个字段',
  homeOrgId: '同上：组织调动走调岗单据',
  empNo: '工号不可改：考勤机、工资代发、社保申报都按工号对账',
  baseSalary: '薪酬属工资域，改薪资必须走审批',
  monthlySalary: '薪酬属工资域，改薪资必须走审批',
  bankCard: '银行卡属工资域'
}

/** 修改档案（整包 patch）：人事档案是一张表单一次改多项，逐字段提交会让版本号推进两次 */
export function updateEmployeeProfile(empId, { patch = {}, ver, reason = '' } = {}) {
  const raw = employees.find(x => x.empId === empId)
  if (!raw) throw new Error('员工不存在')
  const rejected = Object.keys(patch).filter(k => EMP_READONLY_FIELDS[k])
  if (rejected.length) throw new Error(`${rejected.join('、')} 不能在这里改：${EMP_READONLY_FIELDS[rejected[0]]}`)
  const unknown = Object.keys(patch).filter(k => !EMP_EDITABLE_FIELDS.includes(k))
  if (unknown.length) throw new Error(`字段 ${unknown.join('、')} 不支持修改`)
  if (ver !== undefined && Number(ver) !== empVerOf(empId)) throw new Error('该员工档案已被他人修改，请刷新后重试')
  if (patch.phone !== undefined) {
    const dup = employees.find(x => x.empId !== empId && x.phone === String(patch.phone))
    if (dup) throw new Error(`手机号「${patch.phone}」已被 ${dup.empId} 占用`)
  }
  /* 紧急联系人：格式与成对校验。
     这两项填错等于没填 —— 真出事时打不通、或者打过去不知道该找谁。
     人员档案里这一栏存在的唯一目的就是应急，所以不完整的值不落库。 */
  const ecName = patch.emergencyContact !== undefined ? String(patch.emergencyContact).trim() : String(raw.emergencyContact || '').trim()
  const ecPhone = patch.emergencyPhone !== undefined ? String(patch.emergencyPhone).trim() : String(raw.emergencyPhone || '').trim()
  const ecRel = patch.emergencyRelation !== undefined ? String(patch.emergencyRelation).trim() : String(raw.emergencyRelation || '').trim()
  if (ecPhone && !PHONE_RE.test(ecPhone)) throw new Error('紧急联系电话应为 11 位手机号')
  if (ecRel && !EMPLOYEE_RELATION_OPTS.includes(ecRel)) {
    throw new Error(`与本人关系只能是 ${EMPLOYEE_RELATION_OPTS.join(' / ')}`)
  }
  if (ecPhone && !ecName) throw new Error('填了紧急联系电话，请一并填写联系人姓名（只有号码等于找不到人）')
  if (ecName && !ecPhone) throw new Error('填了紧急联系人，请一并填写联系电话')
  if ((ecName || ecPhone) && !ecRel) throw new Error('请选择紧急联系人与本人的关系')
  const sensitive = ['phone', 'idCard'].filter(k => patch[k] !== undefined && String(patch[k]) !== String(raw[k]))
  if (sensitive.length && String(reason).trim().length < 4) {
    throw new Error(`修改${sensitive.map(k => (k === 'phone' ? '手机号' : '证件号')).join('、')}必须填写原因（至少 4 个字）`)
  }
  const before = empRow(raw)
  const posChanged = patch.position !== undefined && patch.position !== raw.position
  for (const k of EMP_EDITABLE_FIELDS) if (patch[k] !== undefined) raw[k] = patch[k]
  /* 调岗后必须清掉上一任的覆盖角色，否则人去了工程组，系统还让他批客服的假 */
  if (posChanged) EMP_ROLE_OVERRIDE.delete(empId)
  EMP_VER.set(empId, empVerOf(empId) + 1)
  const i = EMP_ROWS.findIndex(x => x.empId === empId)
  if (i >= 0) EMP_ROWS.splice(i, 1, empRow(raw))
  const after = i >= 0 ? EMP_ROWS[i] : empRow(raw)
  const out = { ...after }
  if (before.roleId !== after.roleId || before.roleName !== after.roleName) {
    out.roleRecalculated = {
      from: before.roleName, to: after.roleName,
      reason: posChanged ? '岗位变更，已清除角色覆盖并按新岗位重算' : '状态变更，角色已按规则重算'
    }
  }
  return out
}

/**
 * 揭示员工手机 / 证件明文。与业主 / 租户同一套规矩：无 a.sensitive.view 直接抛错（不静默降级），
 * 每次揭示写一条访问日志。原因必填——不写原因，日志里全是"查看详情"，等于没审计。
 */
export function revealEmployeeSensitive(empId, fields = ['phone'], reason = '') {
  const raw = employees.find(x => x.empId === empId)
  if (!raw) throw new Error('员工不存在')
  const why = String(reason || '').trim()
  if (why.length < 4) throw new Error('请填写揭示原因（至少 4 个字）')
  const LABEL = { phone: '手机号', idCard: '证件号' }
  const list = [...new Set(fields)].filter(f => LABEL[f])
  if (!list.length) throw new Error('只支持揭示 phone / idCard')
  for (const f of list) {
    revealSensitive({
      entityType: '员工', entityId: empId, entityName: raw.name,
      field: f, value: raw[f], source: '/c/employee', memo: why
    })
  }
  const who = _accessWho()
  return {
    empId,
    fields: list.map(f => ({ field: f, label: LABEL[f], value: raw[f] })),
    reason: why, operator: who.name, shownAt: _now(),
    accessLogId: ACCESS_LOGS[0]?.logId || ''
  }
}

/* ---------------- 页面级权限 ---------------- */
// 判定内核在 utils/rbac.js（只依赖 permissions / roles 两张字典表）。
// 这里做一层转出口，页面 / 组件仍可从 api.js 取用，无需知道内核在哪；
// 路由守卫必须 import '@/utils/rbac' 而不是这里，否则首屏会把整个 mock 打进主包。

export {
  permCodesOfRole, permCodeOfPath, permLabel, roleSwitchOpts, roleNameOf, permCountOfRole
} from '@/utils/rbac'
export const empStatusOpts = () => distinct(employees, 'status')
export const empTypeOpts = () => distinct(employees, 'empType')
export const empPositionOpts = () => distinct(employees, 'position')
export const dataScopeOpts = () => ['全部项目', '指定项目', '本项目', '本部门', '责任范围', '仅本人']
export const orgTypeOpts = () => distinct(orgs, 'type')

/* ---------------- 角色树 / 数据范围树（Tab2 / Tab3 的左树） ---------------- */

/** Tab2：适用层级 → 角色。叶子是角色，点开直接看权限矩阵 */
export function roleTree() {
  return ['集团', '项目'].map(scope => {
    const list = ROLE_ROWS.filter(r => r.scope === scope)
    return {
      id: `scope-${scope}`,
      label: scope === '集团' ? '集团级角色' : '项目级角色',
      n: list.length,
      children: list.map(r => ({
        id: r.roleId, label: r.name, n: r.userCount, patch: { roleId: r.roleId, vf: '' }
      })),
      patch: { scope, roleId: '', vf: '' }
    }
  })
}

const ROLE_VF = {
  crossDomain: r => (r.domains || []).length >= 3,
  bigPerm: r => r.permCount >= 20,
  readonly: r => r.permCount > 0 && r.perms.every(c => c.endsWith('.view')),
  wideScope: r => ['全部项目', '指定项目'].includes(r.dataScope)
}
export const roleVirtualNodes = () => {
  const label = {
    crossDomain: '跨域角色（≥3 个业务域）', bigPerm: '高权限（≥20 个权限位）',
    readonly: '纯只读角色', wideScope: '可跨项目查看'
  }
  return [{ key: 'all', label: '全部角色', n: ROLE_ROWS.length, patch: { scope: '', roleId: '', vf: '' } }]
    .concat(Object.keys(ROLE_VF).map(key => ({
      key, label: label[key], n: ROLE_ROWS.filter(ROLE_VF[key]).length,
      patch: { scope: '', roleId: '', vf: key }
    })))
}

/** Tab3：数据范围六档 → 角色。左树本身就是「谁能看到什么」的答案 */
export function dataScopeTree() {
  return dataScopeOpts().map(ds => {
    const list = ROLE_ROWS.filter(r => r.dataScope === ds)
    return {
      id: `ds-${ds}`,
      label: ds,
      n: list.reduce((s, r) => s + r.userCount, 0),
      children: list.map(r => ({
        id: r.roleId, label: r.name, n: r.userCount, patch: { dataScope: ds, roleId: r.roleId, vf: '' }
      })),
      patch: { dataScope: ds, roleId: '', vf: '' }
    }
  })
}
export const scopeVirtualNodes = () => {
  const def = [
    ['wide', '跨项目可见', r => ['全部项目', '指定项目'].includes(r.dataScope)],
    ['proj', '仅本项目', r => r.dataScope === '本项目'],
    ['narrow', '受限（本部门 / 仅本人）', r => ['本部门', '仅本人'].includes(r.dataScope)],
    ['bigTeam', '影响人数 ≥ 15', r => r.userCount >= 15]
  ]
  return [{ key: 'all', label: '全部角色', n: ROLE_ROWS.length, patch: { dataScope: '', roleId: '', vf: '' } }]
    .concat(def.map(([key, label, hit]) => ({
      key, label, n: ROLE_ROWS.filter(hit).length, patch: { dataScope: '', roleId: '', vf: key }
    })))
}
/* ---------------- 表单页下拉（新增 / 编辑表单共用） ----------------
   页面禁止 import '@/mock'，所有候选数据一律由本段提供 */

/** 房屋下拉：label = 完整房号（项目 楼栋单元房号），value = houseId
 *  onlyVacant 用于租约「只选可出租房屋」：只有「空置房 / 装修未入住」算可出租 ——
 *  未交房不能租、正在装修不能租、毛坯（已交房未装修）要租客自己装，也不进候选。 */
export function houseOptions(n = 300, { onlyVacant = false, communityId = '' } = {}) {
  return houses
    .filter(h => (!communityId || h.communityId === communityId))
    .filter(h => !onlyVacant || RENTABLE_STATUS.includes(h.useStatus))
    .slice(0, n)
    .map(h => ({
      houseId: h.houseId, label: h.fullName, room: h.room, buildingId: h.buildingId,
      communityId: h.communityId,
      ownerId: h.ownerId || '', ownerName: ownerName(h.ownerId), useStatus: h.useStatus, area: h.area,
      phone: _OWNER_OF.get(h.ownerId || '')?.phone || ''
    }))
}

/** 员工下拉（合同责任人 / 归属部门负责人） */
export function empOptions(n = 300) {
  return employees.slice(0, n).map(e => ({ empId: e.empId, label: `${e.name} · ${e.position || ''}`, orgId: e.orgId || '' }))
}

/** 组织下拉（合同归属部门 / 项目） */
export function orgOptions() {
  return orgs.map(o => ({ orgId: o.orgId, label: o.name, parentId: o.parentId || '' }))
}

/** 合同子类型：按主类型过滤（type 切换时联动），读同一份字典 */
export function contractSubtypeOpts(type = '') {
  if (!type) return CONTRACT_TYPE_TREE.flatMap(t => t.subs)
  return [...contractSubtypesOf(type)]
}
/** 合同付款周期 */
export const contractPayCycleOpts = () => distinct(contracts, 'payCycle')
/** 账单账期（倒序，报表筛选用） */
export const billPeriodOpts = () => [...new Set(bills.map(b => b.period))].filter(Boolean).sort().reverse()
/** 设备类型 / 状态（新增设备表单用） */
export const deviceTypeOpts = () => distinct(devices, 'type')
export const deviceStatusOpts = () => ['在线', '离线', '故障', '停用']
/** 车位下拉：车辆绑定车位用，label = 车位号 + 项目 */
export function parkOptions(n = 300, { communityId = '' } = {}) {
  return parkings
    .filter(p => !communityId || p.communityId === communityId)
    .slice(0, n)
    .map(p => ({ parkId: p.parkId, label: `${p.parkNo} · ${communityName(p.communityId)}`, ownerId: p.ownerId || '' }))
}
/** 巡检模板下拉 */
export const templateOptions = () => inspectTemplates.map(t => ({ templateId: t.templateId, label: t.name }))

/** 新增记录的编号生成：沿用现有编号规则，避免手写 id 冲突 */
function nextId(list, prefix, key, width = 5) {
  const max = list.reduce((m, x) => Math.max(m, Number(String(x[key]).replace(/\D/g, '')) || 0), 0)
  return prefix + String(max + 1).padStart(width, '0')
}
export const nextOwnerId = () => nextId(owners, 'OW', 'ownerId')
export const nextTenantId = () => nextId(tenants, 'TN', 'tenantId')
export const nextHouseId = () => nextId(houses, 'H', 'houseId', 10)
export const nextContractNo = y => `HT-${y}-${String(contracts.length + 1).padStart(4, '0')}`

/* ---------------- 报表取数（/e/reports 专用，口径同驾驶舱） ---------------- */

/** 按房屋聚合欠费（一次性建索引，避免 O(房屋 × 账单)） */
const DEBT_BY_HOUSE = (() => {
  const m = new Map()
  for (const b of bills) {
    if (!b.houseId || !isDebt(b)) continue
    const cur = m.get(b.houseId) || { n: 0, sum: 0, max: 0 }
    cur.n++
    cur.sum += b.unpaid || 0
    cur.max = Math.max(cur.max, b.overdueDays || 0)
    m.set(b.houseId, cur)
  }
  return m
})()

/** 未收费房屋：房屋维度，给出欠费笔数、欠费金额、最长逾期天数 */
export function queryUnpaidHouses({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const list = houses.map(h => {
      const d = DEBT_BY_HOUSE.get(h.houseId) || { n: 0, sum: 0, max: 0 }
      const hs = HOUSE_SPACE.get(h.houseId)
      return {
        houseId: h.houseId, fullName: h.fullName, communityId: h.communityId,
        buildingId: hs?.buildingId || '', unitId: hs?.unitId || '',
        communityName: communityName(h.communityId), buildingName: BUILDING_OF.get(h.buildingId)?.name || h.buildingId,
        ownerId: h.ownerId || '', ownerName: ownerName(h.ownerId), useStatus: h.useStatus, area: h.area,
        debtCount: d.n, debt: d.sum, maxOverdue: d.max
      }
    }).filter(x =>
      x.debt > 0 &&
      eq(x, filters.communityId, 'communityId') &&
      eq(x, filters.buildingId, 'buildingId') &&
      eq(x, filters.unitId, 'unitId') &&
      kwHit(x, filters.kw, ['fullName', 'ownerName', 'houseId'])
    ).sort((a, b) => b.debt - a.debt)
    return paged(list, pageNo, size)
  })
}

/* 汇总类报表把「聚合」与「取数」分开：聚合是同步的，合计行才能与列表同源 */

/**
 * 商业服务收入（工单口径）。
 *
 * 为什么单算而不是混进账单：账单是**应收制**（先出账再收钱），工单是**完工确认**——
 * 服务没做完就不该有应收。所以只统计已完成（已完工 / 已评价 / 已关闭）的单，
 * 金额取工单上的**快照**（字典改价不回溯），成本也取快照。
 */
const CS_DONE_STATUS = ['已完工', '已评价', '已关闭']
export function commercialServiceRevenue(filters = {}) {
  const m2 = n => Math.round((Number(n) || 0) * 100) / 100
  let count = 0
  let income = 0
  let paid = 0
  let cost = 0
  for (const w of workOrders) {
    if (w.type !== '商业服务') continue
    if (!CS_DONE_STATUS.includes(w.status)) continue
    if (filters.communityId && w.communityId !== filters.communityId) continue
    count += 1
    income += w.totalFee || 0
    if (w.payStatus === '已支付' || w.payStatus === '已挂账') paid += w.totalFee || 0
    cost += w.serviceCost || 0
  }
  return { count, income: m2(income), paid: m2(paid), unpaid: m2(income - paid), cost: m2(cost), profit: m2(income - cost) }
}

/* ---------------- 多种经营收入（2026-11-02） ----------------
 * 公司收入结构里，「多种经营」是与「主营业务（物业费）」并列的一大类，由两个分项构成：
 *
 *   商业服务收入  ← 收费工单（完工确认制：服务没做完不产生收入）
 *   商业合作收入  ← 经营性合同（年化：合同金额 − 归业主的公共收益）
 *
 * 两个分项的**时间口径不一样**，这是不能合并成一张明细表的原因：
 * 工单看「完工那一刻」，合同看「合同期内每月摊多少」。硬凑一张表必然一半列空着。
 */

/** 合同是否在当年产生收入：草稿/待审批/待生效还没开始，已终止不再产生 */
const COOP_COUNTED_STATUS = ['履行中', '即将到期', '已到期']
/** 当年与合同期重叠的月数（0–12）。10 月签的 12 个月合同，当年只能计 3 个月 */
export function yearCoverMonths(c = {}, year = Number(String(TODAY).slice(0, 4))) {
  const ys = new Date(`${year}-01-01`)
  const ye = new Date(`${year}-12-31`)
  const s = new Date(String(c.startDate || '').slice(0, 10))
  const e = new Date(String(c.endDate || '').slice(0, 10))
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0
  const from = s > ys ? s : ys
  const to = e < ye ? e : ye
  if (to < from) return 0
  const days = (to - from) / 86400000
  return Math.min(12, Math.round(days / 30.44 * 10) / 10)
}

/**
 * 商业合作收入（合同口径）。
 * 计入金额 = 年化商业合作收入 × 当年覆盖月数 ÷ 12 —— 只算年化不乘覆盖比例，
 * 10 月刚签的 12 个月合同会把整年收入记进今年。
 */
export function commercialCooperationRevenue(filters = {}) {
  const year = filters.year || Number(String(TODAY).slice(0, 4))
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100
  let count = 0
  let income = 0
  let publicRevenue = 0
  let annualTotal = 0
  for (const c of CONTRACT_ROWS) {
    if (c.incomeCategory !== '多种经营') continue
    if (!COOP_COUNTED_STATUS.includes(c.status)) continue
    if (filters.communityId && c.communityId !== filters.communityId) continue
    const cover = yearCoverMonths(c, year)
    if (!cover) continue
    count += 1
    annualTotal += c.annualRevenue || 0
    income += (c.annualRevenue || 0) * cover / 12
    publicRevenue += (c.annualPublicRevenue || 0) * cover / 12
  }
  return {
    count,
    income: r2(income),
    publicRevenue: r2(publicRevenue),
    annualTotal: r2(annualTotal)
  }
}

/** 收入分项的统一形状：两个分项的字段不同，页面要能并排画 */
export function multiRevenue(filters = {}) {
  const cs = commercialServiceRevenue(filters)
  const co = commercialCooperationRevenue(filters)
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100
  const total = r2(cs.income + co.income)
  return {
    total,
    service: { key: 'service', name: '商业服务收入', count: cs.count, income: cs.income, cost: cs.cost, profit: cs.profit },
    cooperation: { key: 'cooperation', name: '商业合作收入', count: co.count, income: co.income, publicRevenue: co.publicRevenue, annualTotal: co.annualTotal },
    /* 占比用于画饼与写"多种经营占公司收入 x%"——分母由 companyRevenue 给 */
    share: { service: total ? Math.round(cs.income / total * 1000) / 10 : 0, cooperation: total ? Math.round(co.income / total * 1000) / 10 : 0 }
  }
}

/**
 * 月度趋势：两个分项各自按月聚合。
 * 商业服务按**完工月**入账；商业合作按**合同期内每月摊**（annualRevenue ÷ 12），
 * 所以同一份 3 年广告合同会在 36 个月里各出现一次，这才是"收入"而不是"签约额"。
 */
export function multiRevenueMonthly(filters = {}, months = 12) {
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100
  const year = filters.year || Number(String(TODAY).slice(0, 4))
  const buckets = []
  for (let m = 1; m <= 12; m += 1) {
    buckets.push({ month: `${m}月`, key: `${year}-${String(m).padStart(2, '0')}`, service: 0, cooperation: 0 })
  }
  const idx = new Map(buckets.map(b => [b.key, b]))

  for (const w of workOrders) {
    if (w.type !== '商业服务') continue
    if (!CS_DONE_STATUS.includes(w.status)) continue
    if (filters.communityId && w.communityId !== filters.communityId) continue
    const t = String(w.finishTime || w.createTime || '')
    const k = t.slice(0, 7)
    const b = idx.get(k)
    if (b) b.service += w.totalFee || 0
  }

  for (const c of CONTRACT_ROWS) {
    if (c.incomeCategory !== '多种经营') continue
    if (!COOP_COUNTED_STATUS.includes(c.status)) continue
    if (filters.communityId && c.communityId !== filters.communityId) continue
    /* 按「该月与合同期的重叠天数 ÷ 365」摊，而不是"这个月覆盖就记一整月" ——
       后者在合同起止不在月初时会多算半个月，12 个月加起来与汇总对不上（实测差 3.5%） */
    const s = new Date(String(c.startDate || '').slice(0, 10))
    const e = new Date(String(c.endDate || '').slice(0, 10))
    for (const b of buckets) {
      const ms = new Date(`${b.key}-01`)
      const me = new Date(`${b.key}-01`)
      me.setMonth(me.getMonth() + 1)
      me.setDate(0)                       // 当月最后一天
      const from = s > ms ? s : ms
      const to = e < me ? e : me
      if (to < from) continue
      const days = (to - from) / 86400000 + 1
      b.cooperation += (c.annualRevenue || 0) * (days / 365)
    }
  }

  return buckets
    .map(b => ({ ...b, service: r2(b.service), cooperation: r2(b.cooperation), total: r2(b.service + b.cooperation) }))
    .slice(-months)
}

/** 项目排行：按「项目」把两个分项加起来，一家项目一种柱子 */
export function multiRevenueByProject(filters = {}) {
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100
  const m = new Map()
  const touch = id => {
    const key = id || '__all__'
    if (!m.has(key)) {
      m.set(key, {
        communityId: id || '',
        communityName: id ? communityName(id) : '集团 / 全项目',
        service: 0, cooperation: 0
      })
    }
    return m.get(key)
  }
  for (const w of workOrders) {
    if (w.type !== '商业服务') continue
    if (!CS_DONE_STATUS.includes(w.status)) continue
    if (filters.communityId && w.communityId !== filters.communityId) continue
    touch(w.communityId).service += w.totalFee || 0
  }
  for (const c of CONTRACT_ROWS) {
    if (c.incomeCategory !== '多种经营') continue
    if (!COOP_COUNTED_STATUS.includes(c.status)) continue
    if (filters.communityId && c.communityId !== filters.communityId) continue
    const cover = yearCoverMonths(c, filters.year || Number(String(TODAY).slice(0, 4)))
    if (!cover) continue
    touch(c.communityId).cooperation += (c.annualRevenue || 0) * cover / 12
  }
  return [...m.values()]
    .map(x => ({ ...x, service: r2(x.service), cooperation: r2(x.cooperation), total: r2(x.service + x.cooperation) }))
    .sort((a, b) => b.total - a.total)
}

/** 商业服务明细（经营页下钻用）：只回已完工、参与收入计算的单 */
export function multiRevenueServiceOrders(filters = {}) {
  return workOrders
    .filter(w => w.type === '商业服务')
    .filter(w => CS_DONE_STATUS.includes(w.status))
    .filter(w => !filters.communityId || w.communityId === filters.communityId)
    .map(w => ({
      woId: w.woId, woNo: w.woNo, title: w.title,
      customer: w.ownerName || '—',
      communityName: communityName(w.communityId),
      serviceName: w.serviceName || w.category, category: w.category,
      priceCode: w.priceCode || '',
      finishTime: w.finishTime || '',
      income: w.totalFee || 0,
      cost: w.serviceCost || 0,
      profit: Math.round(((w.totalFee || 0) - (w.serviceCost || 0)) * 100) / 100,
      payStatus: w.payStatus || ''
    }))
    .sort((a, b) => String(b.finishTime).localeCompare(String(a.finishTime)))
}

/** 商业合作明细（经营页下钻用）：只回计入当年的经营合同 */
export function multiRevenueContracts(filters = {}) {
  const year = filters.year || Number(String(TODAY).slice(0, 4))
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100
  return CONTRACT_ROWS
    .filter(c => c.incomeCategory === '多种经营')
    .filter(c => COOP_COUNTED_STATUS.includes(c.status))
    .filter(c => !filters.communityId || c.communityId === filters.communityId)
    .map(c => {
      const cover = yearCoverMonths(c, year)
      return {
        contractId: c.contractId, contractNo: c.contractNo, name: c.name,
        type: c.type, subtype: c.subtype,
        partyB: c.partyB, communityName: c.communityName,
        amount: c.amount, publicRevenue: c.publicRevenue || 0,
        publicRevenueNote: c.publicRevenueNote || '',
        contractMonths: c.contractMonths,
        annualRevenue: c.annualRevenue,
        coverMonths: cover,
        /* 计入当年的金额：年化 × 覆盖月数 / 12，跨年合同不会挤进签约当年 */
        income: r2((c.annualRevenue || 0) * cover / 12),
        startDate: c.startDate, endDate: c.endDate, status: c.status
      }
    })
    .filter(x => x.coverMonths > 0)
    .sort((a, b) => b.income - a.income)
}

/**
 * 公司收入结构：主营业务（账单实收）+ 多种经营。
 *
 * 注意：商业服务的「生成服务账单」按钮目前是演示态，**没有真的写 BILLS**，
 * 所以这里不会与账单口径重复计算。将来真接了账单，这一行必须改成"扣掉已入账部分"，
 * 否则同一笔钱会在主营业务与多种经营里各出现一次。
 */
export function companyRevenue(filters = {}) {
  const fee = feeSummary(filters.communityId || null)
  const multi = multiRevenue(filters)
  /* 临时收费（摆摊费一类）：**计入收入但不进收缴率** ——
     它有实收、没有应收，塞进收缴率的分母会让收缴率凭空下降。 */
  const temp = tempChargeIncome(filters)
  const main = Math.round((fee.received || 0) * 100) / 100
  const total = Math.round((main + multi.total + temp.total) * 100) / 100
  return {
    main,
    multi: multi.total,
    temp: temp.total,
    total,
    multiRatio: total ? Math.round(multi.total / total * 1000) / 10 : 0,
    tempRatio: total ? Math.round(temp.total / total * 1000) / 10 : 0
  }
}

/** 营业报表：按「项目 × 科目」汇总应收 / 已收 / 未收与收缴率 */
function businessRows(filters = {}) {
  const m = new Map()
  for (const b of scopeFilter(bills, { house: b => b.houseId })) {
    if (!isEffectiveBill(b)) continue      // 作废 / 减免不计入应收与收缴率
    if (filters.communityId && b.communityId !== filters.communityId) continue
    const key = `${b.communityId}|${b.itemId}`
    const cur = m.get(key) || {
      key, communityId: b.communityId, communityName: communityName(b.communityId),
      itemId: b.itemId, itemName: b.itemName, count: 0, payable: 0, paid: 0, unpaid: 0
    }
    cur.count++
    cur.payable += b.payable || 0
    cur.paid += b.paidAmount || 0
    cur.unpaid += b.unpaid || 0
    m.set(key, cur)
  }
  const rows = [...m.values()]
    .map(x => ({ ...x, rate: x.payable > 0 ? Math.round((x.paid / x.payable) * 1000) / 10 : null }))
    .filter(x => kwHit(x, filters.kw, ['itemName', 'communityName']))
    .sort((a, b) => b.payable - a.payable)

  /* 商业服务单独一行：它是工单收入，不是账单科目。
     并入同一张报表是为了「物业全年收益」只有一处口径；但要能一眼看出它来自工单。 */
  /* 多种经营三段：一个小计 + 两个分项（rowLevel 决定行样式）。
     放在同一张报表而不是单开一页，是因为财务做月报时"收入合计"必须在同一张表里能加出来；
     但两段的口径完全不同，所以必须能一眼从行层级看出来谁是谁的明细。 */
  const cs = commercialServiceRevenue(filters)
  const co = commercialCooperationRevenue(filters)
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100
  const multiTotal = r2(cs.income + co.income)
  const multiPaid = r2(cs.paid + co.income)          // 合同收入按履约确认，不产生"应收未收"
  const cid = filters.communityId || ''
  const cname = cid ? communityName(cid) : '全部项目'
  /* 临时收费单独一行：它既不是账单科目、也不是经营合同，但同时要能加进"收入合计"。
     `rate` 给 null 是**故意的** —— 没有应收就没有收缴率，给它 0 或 100 都是错的。 */
  const tc = tempChargeIncome(filters)
  if (tc.total > 0 && kwHit({ itemName: '临时收费收入', communityName: cname }, filters.kw, ['itemName', 'communityName'])) {
    rows.push({
      key: 'TC|临时收费' + cid, communityId: cid, communityName: cname,
      itemId: 'TC', itemName: '临时收费收入', rowLevel: 1, isTemp: true,
      count: tc.count, payable: tc.total, paid: tc.total, unpaid: 0,
      rate: null, cost: 0, profit: tc.total,
      /* 让报表页能显示"不计入收缴率"的说明，而不是显示一个空的百分比 */
      rateNote: '不计入收缴率'
    })
    for (const it of tc.byItem) {
      rows.push({
        key: `TC|${it.itemName}` + cid, communityId: cid, communityName: cname,
        itemId: 'TC-' + it.itemName, itemName: '其中：' + it.itemName, rowLevel: 2, isTemp: true,
        count: it.count, payable: it.amount, paid: it.amount, unpaid: 0,
        rate: null, cost: 0, profit: it.amount, rateNote: '不计入收缴率'
      })
    }
  }

  if (multiTotal > 0 && kwHit({ itemName: '多种经营收入', communityName: cname }, filters.kw, ['itemName', 'communityName'])) {
    rows.push({
      key: 'MR|多种经营' + cid, communityId: cid, communityName: cname,
      itemId: 'MR', itemName: '多种经营收入', rowLevel: 1, isMulti: true,
      count: cs.count + co.count, payable: multiTotal, paid: multiPaid,
      unpaid: r2(multiTotal - multiPaid),
      rate: multiTotal > 0 ? Math.round((multiPaid / multiTotal) * 1000) / 10 : null,
      cost: r2(cs.cost), profit: r2(cs.profit), publicRevenue: co.publicRevenue
    })
    rows.push({
      key: 'MR|服务' + cid, communityId: cid, communityName: cname,
      itemId: 'MR-S', itemName: '其中：商业服务', rowLevel: 2, isService: true,
      count: cs.count, payable: cs.income, paid: cs.paid, unpaid: cs.unpaid,
      rate: cs.income > 0 ? Math.round((cs.paid / cs.income) * 1000) / 10 : null,
      cost: cs.cost, profit: cs.profit
    })
    rows.push({
      key: 'MR|合作' + cid, communityId: cid, communityName: cname,
      itemId: 'MR-C', itemName: '其中：商业合作', rowLevel: 2, isCoop: true,
      count: co.count, payable: co.income, paid: co.income, unpaid: 0,
      rate: co.income > 0 ? 100 : null,
      cost: 0, profit: co.income, publicRevenue: co.publicRevenue
    })
  }
  return rows
}
export function queryBusiness({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => paged(businessRows(filters), pageNo, size))
}

/**
 * 多种经营收入表：按「项目 × 分项」铺平，一行一个分项。
 *
 * 为什么不做成"项目一行、两个分项两列"：分项的口径字段不一样
 * （商业服务有成本毛利、商业合作有公共收益），合并成列会有一半格子空着，
 * 而且以后加第三个分项（比如场地临时租赁）就要改表结构。
 */
export function multiRevenueReportRows(filters = {}) {
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100
  const total = multiRevenue(filters).total
  const rows = []
  for (const p of multiRevenueByProject(filters)) {
    if (p.service === 0 && p.cooperation === 0) continue
    if (!kwHit(p, filters.kw, ['communityName'])) continue
    if (p.service > 0) {
      const list = multiRevenueServiceOrders({ communityId: p.communityId })
      const cost = r2(list.reduce((s, x) => s + x.cost, 0))
      rows.push({
        key: `${p.communityId}|service`,
        communityId: p.communityId, communityName: p.communityName,
        itemName: '商业服务', count: list.length,
        income: p.service, publicRevenue: 0, cost, profit: r2(p.service - cost),
        share: total ? Math.round(p.service / total * 1000) / 10 : 0
      })
    }
    if (p.cooperation > 0) {
      const list = multiRevenueContracts({ communityId: p.communityId, year: filters.year })
      rows.push({
        key: `${p.communityId}|coop`,
        communityId: p.communityId, communityName: p.communityName,
        itemName: '商业合作', count: list.length,
        income: p.cooperation,
        publicRevenue: r2(list.reduce((s, x) => s + x.publicRevenue / (x.contractMonths || 1) * 12 * (x.coverMonths / 12), 0)),
        /* 合同没有成本字段：毛利一列对商业合作不成立，给 0 并在报表 note 里写清 */
        cost: 0, profit: p.cooperation,
        share: total ? Math.round(p.cooperation / total * 1000) / 10 : 0
      })
    }
  }
  return rows.sort((a, b) => b.income - a.income)
}

export function queryMultiRevenueReport({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => paged(multiRevenueReportRows(filters), pageNo, size))
}


/** 报修汇总：按「项目 × 工单类型」汇总数量、完工量、超时量与平均时长 */
function repairRows(filters = {}) {
  const m = new Map()
  for (const w of workOrders) {
    if (filters.communityId && w.communityId !== filters.communityId) continue
    const key = `${w.communityId}|${w.type}`
    const cur = m.get(key) || {
      key, communityId: w.communityId, communityName: communityName(w.communityId),
      type: w.type, count: 0, done: 0, overdue: 0, hours: 0, hourBase: 0,
      income: 0, cost: 0
    }
    cur.count++
    if (['已完成', '已评价'].includes(w.status)) cur.done++
    if (w.isOverdue) cur.overdue++
    if (w.durationHours) { cur.hours += w.durationHours; cur.hourBase++ }
    /* 商业服务才产生收入；公共区域维修免费（成本走运营），这里不计收入 */
    if (w.type === '商业服务' && CS_DONE_STATUS.includes(w.status)) {
      cur.income += w.totalFee || 0
      cur.cost += w.serviceCost || 0
    }
    m.set(key, cur)
  }
  return [...m.values()]
    .map(x => ({
      ...x,
      avgHours: x.hourBase ? Math.round((x.hours / x.hourBase) * 10) / 10 : null,
      income: Math.round(x.income * 100) / 100,
      cost: Math.round(x.cost * 100) / 100,
      profit: Math.round((x.income - x.cost) * 100) / 100
    }))
    .filter(x => kwHit(x, filters.kw, ['type', 'communityName']))
    .sort((a, b) => b.count - a.count)
}
export function queryRepairSummary({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => paged(repairRows(filters), pageNo, size))
}

/* ---------------- 装修押金（唯一押金场景） ---------------- */
// 押金口径（2026-11-13 升级）：押金**不止装修一种**，但都进同一张台账。
//
//   类型（depositTypes 字典）决定三件事：要不要工期 / 要不要验收 / 金额是否固定。
//   装修押金：要工期、要验收、金额固定 3000；
//   门禁卡、车牌：不要工期不要验收，按数量收，退卡即退；
//   履约保证金、租约押金：金额按合同/租约定（不固定），要验收但不设工期。
//
// 余额 balance = amount − refundAmount − deductAmount；在账 = 尚未结清。
// 押金是**负债**：收取时进现金不进收入，只有扣款部分才转收入（见 depositLedger）。

export const DEPOSIT_STATUS = ['在押', '装修中', '已逾期', '待退款', '已退还', '部分扣除', '已没收']
export const depositStatusOpts = () => DEPOSIT_STATUS.map(v => ({ value: v, label: v }))

/* ---------------- 押金类型字典 ---------------- */
export function depositTypeRows({ enabledOnly = false } = {}) {
  return depositTypes
    .filter(t => !enabledOnly || t.enabled)
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(t => ({ ...t }))
}
export const depositTypeOpts = () =>
  depositTypeRows({ enabledOnly: true }).map(t => ({
    value: t.name,
    label: t.standardAmount > 0 ? `${t.name}（${t.standardAmount} 元）` : `${t.name}（金额按约定）`,
    typeId: t.typeId, standardAmount: t.standardAmount, needDates: t.needDates,
    needCheck: t.needCheck, allowPartial: t.allowPartial, byQuantity: t.byQuantity
  }))
export const depositTypeOf = name => depositTypes.find(t => t.name === name) || null

export function saveDepositType(rec = {}) {
  assertFeeConfigPerm()
  const name = String(rec.name || '').trim()
  if (name.length < 2) throw new Error('名称至少 2 个字')
  if (depositTypes.some(t => t.name === name && t.typeId !== rec.typeId)) throw new Error(`「${name}」已存在`)
  const payload = {
    name,
    standardAmount: Number(rec.standardAmount) || 0,
    needDates: !!rec.needDates,
    needCheck: !!rec.needCheck,
    allowPartial: rec.allowPartial === undefined ? true : !!rec.allowPartial,
    byQuantity: !!rec.byQuantity,
    sort: Number(rec.sort) || 0,
    desc: String(rec.desc || '')
  }
  if (payload.standardAmount < 0) throw new Error('标准金额不能为负')
  if (rec.typeId) {
    const t = depositTypes.find(x => x.typeId === rec.typeId)
    if (!t) throw new Error('押金类型不存在')
    Object.assign(t, payload)
    return { ...t }
  }
  const seq = depositTypes.reduce((m, t) => Math.max(m, Number(String(t.typeId).replace(/\D/g, '')) || 0), 0) + 1
  const row = { typeId: 'DT' + String(seq).padStart(2, '0'), enabled: true, ...payload, sort: payload.sort || seq * 10 }
  depositTypes.push(row)
  return { ...row }
}

export function toggleDepositType(typeId, enabled) {
  assertFeeConfigPerm()
  const t = depositTypes.find(x => x.typeId === typeId)
  if (!t) throw new Error('押金类型不存在')
  /* 停用前看有没有在押记录：停用只是不给新收，历史仍要能退 */
  const live = decorationDeposits.filter(d => d.type === t.name && (d.balance || 0) > 0).length
  if (!enabled && live > 0 && !t._confirm) {
    throw new Error(`「${t.name}」还有 ${live} 笔在账押金，停用后只能退不能新收 —— 确认后再停用`)
  }
  t.enabled = !!enabled
  return { ...t, live }
}

const DEPOSIT_VF = {
  /** 在账：钱还在物业手里 */
  onhand: d => (d.balance || 0) > 0,
  /** 逾期未退：超过申请工期仍未验收 */
  overdue: d => d.status === '已逾期',
  /** 待退款：验收通过、钱还没退 */
  toRefund: d => d.status === '待退款',
  /** 已结清：已退还 / 部分扣除 / 已没收 */
  settled: d => ['已退还', '部分扣除', '已没收'].includes(d.status),
  /** 有扣除：验收时扣了钱（部分扣除或全额没收） */
  deducted: d => (d.deductAmount || 0) > 0
}
export const depositVirtualNodes = () => {
  const label = {
    onhand: '在账（未结清）', overdue: '逾期未验收', toRefund: '待退款',
    settled: '已结清', deducted: '有扣款'
  }
  return [{ key: 'all', label: '全部押金', n: decorationDeposits.length, patch: { vf: '' } }]
    .concat(Object.keys(DEPOSIT_VF).map(key => ({
      key, label: label[key], n: decorationDeposits.filter(DEPOSIT_VF[key]).length, patch: { vf: key }
    })))
}

function depositRows(filters = {}) {
  return decorationDeposits.filter(d =>
    eq(d, filters.communityId, 'communityId') &&
    eq(d, filters.type, 'type') &&
    eq(d, filters.status, 'status') &&
    between(d.paidDate, filters.range) &&
    (!filters.vf || (DEPOSIT_VF[filters.vf] || (() => true))(d)) &&
    kwHit(d, filters.kw, ['depositId', 'applyNo', 'houseName', 'ownerName', 'phone'])
  ).sort((a, b) => (b.paidDate || '').localeCompare(a.paidDate || ''))
}
export function queryDeposits({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => paged(depositRows(filters), pageNo, size))
}

/** 押金汇总：收 / 退 / 扣 / 在账 四项必须自洽（收 = 退 + 扣 + 在账） */
export function depositSummary(filters = {}) {
  const list = depositRows(filters)
  const sum = k => list.reduce((s, d) => s + (d[k] || 0), 0)
  return {
    count: list.length,
    payable: sum('amount'),
    paid: sum('refundAmount'),
    unpaid: sum('balance'),
    deduct: sum('deductAmount'),
    overdueCount: list.filter(DEPOSIT_VF.overdue).length,
    overdueAmount: list.filter(DEPOSIT_VF.overdue).reduce((s, d) => s + (d.balance || 0), 0),
    /* 按类型拆在账：押金是负债，报表要能回答"欠谁的钱、欠多少"，
       只给一个总数，换类型（比如新收履约保证金）时看不出结构变化 */
    byType: (() => {
      const m = new Map()
      for (const d of list) {
        const cur = m.get(d.type || '未分类') || { type: d.type || '未分类', count: 0, amount: 0, balance: 0 }
        cur.count += 1
        cur.amount = Math.round((cur.amount + (d.amount || 0)) * 100) / 100
        cur.balance = Math.round((cur.balance + (d.balance || 0)) * 100) / 100
        m.set(d.type || '未分类', cur)
      }
      return [...m.values()].sort((a, b) => b.balance - a.balance)
    })()
  }
}

/** 报表合计行：与列表同口径，避免「表内加总 ≠ 合计行」 */
export function reportSummary(code, filters = {}) {
  if (code === 'fee-detail' || code === 'debt-detail') {
    const vf = code === 'debt-detail' ? 'debt' : (filters.vf || '')
    const list = scopeFilter(BILL_ROWS, { house: b => b.houseId }).filter(b =>
      eq(b, filters.communityId, 'communityId') &&
      eq(b, filters.period, 'period') &&
      eq(b, filters.itemId, 'itemId') &&
      (!vf || BILL_VF[vf](b))
    )
    return {
      count: list.length,
      payable: list.reduce((s, b) => s + (b.payable || 0), 0),
      paid: list.reduce((s, b) => s + (b.paidAmount || 0), 0),
      unpaid: list.reduce((s, b) => s + (b.unpaid || 0), 0)
    }
  }
  if (code === 'unpaid-house') {
    const list = houses.map(h => DEBT_BY_HOUSE.get(h.houseId))
      .filter(d => d && d.sum > 0)
    return { count: list.length, payable: 0, paid: 0, unpaid: list.reduce((s, d) => s + d.sum, 0) }
  }
  if (code === 'pay-detail') {
    const list = payments.filter(p => !filters.communityId || p.communityId === filters.communityId)
    return { count: list.length, payable: 0, paid: list.reduce((s, p) => s + (p.amount || 0), 0), unpaid: 0 }
  }
  if (code === 'deposit') {
    const s = depositSummary(filters)
    return { count: s.count, payable: s.payable, paid: s.paid, unpaid: s.unpaid, deduct: s.deduct }
  }
  if (code === 'multi-revenue') {
    const list = multiRevenueReportRows(filters)
    const r2 = n => Math.round((Number(n) || 0) * 100) / 100
    const sum = k => r2(list.reduce((s2, x) => s2 + (x[k] || 0), 0))
    return { count: list.length, income: sum('income'), publicRevenue: sum('publicRevenue'), profit: sum('profit') }
  }
  if (code === 'inspect') {
    const s = inspectReportSummary(filters)
    return { count: s.count, payable: s.planned, paid: s.doneRate, unpaid: s.issues, deduct: s.late }
  }
  if (code === 'dept-quality') {
    const rows = deptQualityRows(filters)
    const n = rows.length || 1
    return {
      count: rows.length,
      payable: rows.reduce((s, r) => s + r.planned, 0),
      paid: Math.round(rows.reduce((s, r) => s + r.weighted, 0) / n * 10) / 10,
      unpaid: rows.reduce((s, r) => s + r.selfIssues + r.crossIssues, 0),
      deduct: rows.reduce((s, r) => s + r.conflicts, 0)
    }
  }
  if (code === 'wo-by-building') {
    const rows = woBuildingRows(filters)
    return {
      count: rows.length,
      payable: rows.reduce((s, r) => s + r.count, 0),
      paid: rows.reduce((s, r) => s + r.open, 0),
      unpaid: rows.reduce((s, r) => s + r.overdue, 0)
    }
  }
  if (code === 'sup-finding') {
    const s = supFindingSummary(filters)
    return {
      count: s.supervisors,
      payable: s.planned,
      paid: s.issues,
      unpaid: s.conflicts,
      deduct: s.crossMissed
    }
  }
  if (code === 'business') {
    const list = businessRows(filters)
    const r2 = n => Math.round((Number(n) || 0) * 100) / 100
    const sum = k => r2(list.reduce((s2, x) => s2 + (x[k] || 0), 0))
    return {
      count: list.reduce((s2, x) => s2 + (x.count || 0), 0),
      payable: sum('payable'), paid: sum('paid'), unpaid: sum('unpaid'),
      /* 单独给一项：多种经营收入是"公司收入结构"里的一类，合计行里要能单独读出来 */
      multiRevenue: r2(list.filter(x => x.isMulti).reduce((s2, x) => s2 + (x.payable || 0), 0)),
      serviceRevenue: r2(list.filter(x => x.isService).reduce((s2, x) => s2 + (x.payable || 0), 0)),
      coopRevenue: r2(list.filter(x => x.isCoop).reduce((s2, x) => s2 + (x.payable || 0), 0))
    }
  }
  if (code === 'repair-summary') {
    const list = repairRows(filters)
    const m2 = n => Math.round((Number(n) || 0) * 100) / 100
    return {
      count: list.reduce((s, x) => s + x.count, 0),
      payable: list.reduce((s, x) => s + x.done, 0),      // 复用字段位：done（旧口径，保留兼容）
      paid: list.reduce((s, x) => s + x.overdue, 0),      // 复用字段位：overdue
      unpaid: 0,
      /* 商业服务收入三项：只出现在「商业服务」这一行，其余类型为 0 */
      income: m2(list.reduce((s, x) => s + (x.income || 0), 0)),
      cost: m2(list.reduce((s, x) => s + (x.cost || 0), 0)),
      profit: m2(list.reduce((s, x) => s + (x.profit || 0), 0))
    }
  }
  return { count: 0, payable: 0, paid: 0, unpaid: 0 }
}

/** Tab2 / Tab3 共用的角色行过滤（11 条不需要分页，直接取全量后过滤） */
export function filterRoles({ scope = '', roleId = '', dataScope = '', vf = '', kw = '' } = {}) {
  const hit = ROLE_VF[vf]
  return ROLE_ROWS.filter(r =>
    (!scope || r.scope === scope) &&
    (!roleId || r.roleId === roleId) &&
    (!dataScope || r.dataScope === dataScope) &&
    (!hit || hit(r)) &&
    (!kw || `${r.name}${r.roleId}${r.desc}`.toLowerCase().includes(String(kw).toLowerCase()))
  )
}
/* ================= 收尾轮 · 第 1 批：工单发起 / 待办中心 / 审批处理 / 转工单 ============ */
// 数据来自 SEED+61 补充表（approvals 等）；所有写操作为内存态，刷新还原（与既有约定一致）

export const DATA_DATE = '2026-10-21'          // 数据集基准日：逾期、账期判断统一以此为「今天」

const _OWNER_OF = new Map(owners.map(o => [o.ownerId, o]))
const _HOUSE_OF = new Map(houses.map(h => [h.houseId, h]))
const _HOUSE_CM = new Map(houses.map(h => [h.houseId, h.communityId]))
const _now = () => {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* ---------------- 商业服务项目（字典 · 2026-11-02） ----------------
 * 为什么要这一层：以前「入户维修」既是工单类型、又靠工单数据 distinct 出分类，价格另存在
 * repairPrices.json 里只能手工改 —— 三处口径靠人记。现在收成一张可维护的字典：
 *
 *   ① 类型只留两条维修线：公共区域维修（免费）/ 商业服务（收费）；
 *   ② **两套分类维度不混用**：公共按「设施部位」（电梯、给排水、土建…），
 *      商业服务按「维修品类」（水管漏水、空调不制冷…）。混用的后果是「电梯异常」和
 *      「下水道堵塞」并列在同一个下拉里 —— 一个是位置，一个是工种，根本不是一个维度；
 *   ③ 项目带 服务价格（材料+人工）与 成本价（材料成本+人工成本），改价留痕，
 *      **已完工工单按快照不回溯**（价格是下的那一刻的价，不是今天改的价）。
 *
 * 字段只增不改：`code / material / labor / unit / minutes` 被业主端小程序与员工端 APP
 * 按名索引（@pc/mock/repairPrices.json），改名会直接断链，三处金额一致就破了。
 */
export const SERVICE_ITEM_PERM_VIEW = 'f.serviceItems.view'
export const SERVICE_ITEM_PERM_EDIT = 'f.serviceItems.edit'
export const canViewServiceItems = () => _hasPerm(SERVICE_ITEM_PERM_VIEW)
export const canEditServiceItems = () => _hasPerm(SERVICE_ITEM_PERM_EDIT)

/* 多种经营收入：收入结构比收缴数据更敏感 —— 收银员看收缴就够了，不必看经营毛利 */
export const canViewMultiRevenue = () => _hasPerm('b.multiRevenue.view')
/* 审批流配置改的是全公司规则（谁审、几级、金额阈值），不是普通业务操作 */
export const canViewOaFlow = () => _hasPerm('e.oaFlow.view')
export const canEditOaFlow = () => _hasPerm('e.oaFlow.edit')
/* 工时积分：会记的人（工程主管/项目经理）与只会看的人（客服）分开 */
export const canViewLaborPoints = () => _hasPerm('f.woPoints.view')
export const canEditLaborPoints = () => _hasPerm('f.woPoints.edit')

/** 工单类型：只有前两条是维修线（产生费用），其余三条不产生费用 */
export const WO_TYPES = ['公共区域维修', '商业服务', '投诉建议', '咨询', '报事', '其他']
/** 维修线类型（表单要按它切字段组） */
export const WO_REPAIR_TYPES = ['公共区域维修', '商业服务']
export const isEmptyWoType = t => !WO_REPAIR_TYPES.includes(t)

/** 公共区域维修的分类：设施部位维度。内置 9 项，可停用排序，不开放新增（新增部位要评审） */
const PUBLIC_CATS = (repairPrices.publicCategories || []).map(c => ({ ...c }))
export const publicCategoryOpts = () =>
  PUBLIC_CATS.filter(c => c.enabled).sort((a, b) => a.sort - b.sort)
    .map(c => ({ value: c.name, label: c.name, desc: c.desc }))
export const PUBLIC_CATEGORY_NAMES = PUBLIC_CATS.map(c => c.name)

/** 商业服务分类与项目（内存态：改价/启停当次会话生效，刷新还原） */
const SERVICE_CATS = (repairPrices.serviceCategories || []).map(c => ({ ...c }))
const SERVICE_ITEMS = (repairPrices.items || []).map(i => ({ ...i }))
const SERVICE_ADDONS = (repairPrices.addons || []).map(i => ({ ...i }))
const SERVICE_LOG = new Map()
/** 维修师傅小时成本：改这一项只影响新算的成本，不动对外报价 */
export const LABOR_HOUR_COST = Number(repairPrices.laborHourCost) || 48

export const serviceCategoryRows = ({ enabled = null } = {}) =>
  SERVICE_CATS
    .filter(c => enabled === null || c.enabled === enabled)
    .sort((a, b) => a.sort - b.sort)
    .map(c => ({ ...c, itemCount: SERVICE_ITEMS.filter(i => i.category === c.name).length }))

/** 终态之外的工单都算在途：停用项目前要先确认没人在等这一单 */
const WO_CLOSED_STATUS = ['已完工', '已评价', '已关闭', '已取消']
const _isInFlight = w => !WO_CLOSED_STATUS.includes(w.status)

/** 项目引用与收入：收入只算已结清的单（已支付 / 已挂账），未支付算在途 */
const _itemUsage = () => {
  const m = new Map()
  for (const w of workOrders) {
    const code = w.priceCode
    if (!code) continue
    const cur = m.get(code) || { count: 0, inFlight: 0, paid: 0, income: 0, cost: 0 }
    cur.count += 1
    if (_isInFlight(w)) cur.inFlight += 1
    const settled = w.payStatus === '已支付' || w.payStatus === '已挂账'
    if (settled) {
      cur.paid += 1
      cur.income += (w.totalFee || 0)
    }
    m.set(code, cur)
  }
  return m
}

const _svcR2 = n => Math.round((Number(n) || 0) * 100) / 100

/** 服务项目行：成本与毛利是派生值，页面不自己算 */
function _serviceRow(it, usage) {
  const u = usage.get(it.code) || { count: 0, inFlight: 0, income: 0 }
  const profit = _svcR2(it.price - it.cost)
  /* 已完工单据按当时的价快照，字典改价不回溯 —— 所以成本用当前口径反算只作参考 */
  const cost = u.income ? _svcR2(u.income * (it.price ? it.cost / it.price : 0)) : 0
  return {
    ...it,
    usedCount: u.count,
    inFlight: u.inFlight,
    income: _svcR2(u.income),
    estCost: cost,
    estProfit: _svcR2(u.income - cost),
    profit,
    margin: it.price ? Math.round(profit / it.price * 1000) / 10 : 0,
    updatedBy: (SERVICE_LOG.get(it.code) || [])[0]?.by || '物业管理员',
    updatedAt: (SERVICE_LOG.get(it.code) || [])[0]?.at || repairPrices.version
  }
}

/** 项目列表（维护页）：默认全部，可选择只看在售 */
export function serviceItemRows({ category = '', enabled = null, kw = '' } = {}) {
  const usage = _itemUsage()
  const k = String(kw || '').trim()
  return SERVICE_ITEMS
    .filter(i => !category || i.category === category)
    .filter(i => enabled === null || !!i.enabled === enabled)
    .filter(i => !k || i.name.includes(k) || i.code.includes(k) || i.category.includes(k))
    .sort((a, b) => a.sort - b.sort)
    .map(i => _serviceRow(i, usage))
}

export const getServiceItem = code => {
  const it = SERVICE_ITEMS.find(i => i.code === code)
  return it ? _serviceRow(it, _itemUsage()) : null
}

/** 维护页 KPI：数字必须与列表同源（同一个 usage 快照） */
export function serviceItemSummary() {
  const usage = _itemUsage()
  const rows = SERVICE_ITEMS.map(i => _serviceRow(i, usage))
  const income = _svcR2(rows.reduce((s, r) => s + r.income, 0))
  const cost = _svcR2(rows.reduce((s, r) => s + r.estCost, 0))
  const settledAll = [...usage.values()].reduce((s, u) => s + u.paid, 0)
  return {
    total: rows.length,
    enabled: rows.filter(r => r.enabled).length,
    disabled: rows.filter(r => !r.enabled).length,
    categories: SERVICE_CATS.length,
    used: rows.filter(r => r.usedCount > 0).length,
    orders: rows.reduce((s, r) => s + r.usedCount, 0),
    settled: settledAll,
    income,
    cost,
    profit: _svcR2(income - cost),
    margin: income ? Math.round((income - cost) / income * 1000) / 10 : 0
  }
}

/** 工单表单用：在售项目（可再按分类过滤） */
export const serviceItemOptions = (category = '') =>
  SERVICE_ITEMS
    .filter(i => i.enabled && (!category || i.category === category))
    .sort((a, b) => a.sort - b.sort)
    .map(i => ({
      /* name 与 label 都给：下拉用 label，费用卡与工单标题用 name（少一个字就渲染成空白项） */
      code: i.code, name: i.name, label: i.name, category: i.category,
      price: i.price, cost: i.cost, material: i.material, labor: i.labor,
      unit: i.unit, minutes: i.minutes
    }))

export const serviceItemHistory = code => (SERVICE_LOG.get(code) || []).slice()
const _pushSvcLog = (code, entry) => {
  const list = SERVICE_LOG.get(code) || []
  list.unshift(entry)
  SERVICE_LOG.set(code, list)
}

/**
 * 新增 / 编辑服务项目。
 * price 与 cost **由服务端算**（material+labor、materialCost+laborCost），
 * 页面把"服务价格"和"成本价"当展示字段 —— 允许直接填合计再反推拆分，
 * 就是下一次「列表 125 / 详情 124.99」的来源。
 */
export function saveServiceItem(p = {}, code = '', operator = '物业管理员') {
  const name = String(p.name || '').trim()
  const category = String(p.category || '').trim()
  if (name.length < 2) throw Object.assign(new Error('项目名称至少 2 个字'), { code: 42201 })
  if (name.length > 30) throw Object.assign(new Error('项目名称不超过 30 个字'), { code: 42201 })
  const cat = SERVICE_CATS.find(c => c.name === category)
  if (!cat) throw Object.assign(new Error('项目分类不存在，请先在分类里选择'), { code: 42201 })
  if (!cat.enabled) throw Object.assign(new Error(`分类「${category}」已停用，不能新增项目`), { code: 40925 })

  const num = (v, label) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error(`${label}必须是不小于 0 的数字`), { code: 42201 })
    return _svcR2(n)
  }
  const material = num(p.material, '材料费')
  const labor = num(p.labor, '人工费')
  const materialCost = num(p.materialCost, '材料成本')
  const laborCost = num(p.laborCost, '人工成本')
  const price = _svcR2(material + labor)
  const cost = _svcR2(materialCost + laborCost)
  if (price <= 0) throw Object.assign(new Error('服务价格不能为 0：材料费与人工费至少填一项'), { code: 42205 })
  if (materialCost > material) {
    throw Object.assign(new Error(`材料成本（${materialCost}）不能高于材料费（${material}）——那等于材料在亏本卖`), { code: 42205 })
  }
  if (cost >= price) {
    throw Object.assign(new Error(`成本价（${cost}）不低于服务价格（${price}），这一项启用就亏本`), { code: 42206 })
  }

  const dup = SERVICE_ITEMS.find(i => i.category === category && i.name === name && i.code !== code)
  if (dup) throw Object.assign(new Error(`「${category}」下已有同名项目（${dup.code}）`), { code: 40923 })

  const minutes = Math.max(0, Number(p.minutes) || 0)
  if (code) {
    const it = SERVICE_ITEMS.find(i => i.code === code)
    if (!it) throw Object.assign(new Error('服务项目不存在'), { code: 40401 })
    const before = { material: it.material, labor: it.labor, materialCost: it.materialCost, laborCost: it.laborCost }
    const diff = []
    if (before.material !== material) diff.push(`材料费 ${before.material} → ${material}`)
    if (before.labor !== labor) diff.push(`人工费 ${before.labor} → ${labor}`)
    if (before.materialCost !== materialCost) diff.push(`材料成本 ${before.materialCost} → ${materialCost}`)
    if (before.laborCost !== laborCost) diff.push(`人工成本 ${before.laborCost} → ${laborCost}`)
    if (it.name !== name) diff.push(`名称「${it.name}」→「${name}」`)
    if (it.category !== category) diff.push(`分类「${it.category}」→「${category}」`)
    Object.assign(it, {
      name, category, minutes, material, labor, materialCost, laborCost, price, cost,
      trade: p.trade || it.trade, unit: p.unit || it.unit, desc: p.desc ?? it.desc,
      sort: Number(p.sort) || it.sort
    })
    if (diff.length) {
      const priceChanged = before.material !== material || before.labor !== labor
        || before.materialCost !== materialCost || before.laborCost !== laborCost
      _pushSvcLog(code, { action: priceChanged ? '改价' : '编辑', by: operator, at: _now(), memo: diff.join('；') })
    }
    return { ...it, _changed: diff.length }
  }

  const seq = SERVICE_ITEMS.length + 1
  const newCode = 'SI' + String(seq).padStart(4, '0')
  const it = {
    code: newCode, category, name, trade: p.trade || '综合',
    material, labor, price, materialCost, laborCost, cost,
    unit: p.unit || '次', minutes, enabled: true,
    sort: Number(p.sort) || (seq * 10), desc: p.desc || ''
  }
  SERVICE_ITEMS.push(it)
  _pushSvcLog(newCode, { action: '新增', by: operator, at: _now(), memo: `${category} · ${name} · 服务价 ${price} / 成本 ${cost}` })
  return { ...it, _changed: 1 }
}

/** 启用 / 停用：停用不删（历史工单还引着它），但先看有没有在途单 */
export function toggleServiceItem(code, enabled, operator = '物业管理员') {
  const it = SERVICE_ITEMS.find(i => i.code === code)
  if (!it) throw Object.assign(new Error('服务项目不存在'), { code: 40401 })
  if (!enabled) {
    const u = _itemUsage().get(code)
    if (u && u.inFlight > 0) {
      throw Object.assign(
        new Error(`还有 ${u.inFlight} 张在途工单在用「${it.name}」，先结单或换项目再停用`),
        { code: 40924 }
      )
    }
  }
  it.enabled = !!enabled
  _pushSvcLog(code, {
    action: enabled ? '启用' : '停用', by: operator, at: _now(),
    memo: enabled ? '重新在售，工单表单可选' : '停止新打；历史工单与已完工单据不受影响'
  })
  return { ...it }
}

/* ---------------- 公共区域工时积分（2026-11-02） ----------------
 * 为什么只有公共区域有积分**、商业服务没有**：商业服务按人工费提成（`commissionOf`），
 * 已经直接给钱；再叠一层积分等于同一件事发两次奖，师傅会挑单。
 * 公共区域维修免费、也没有提成，是典型的"干了没好处"的活 —— 积分就是它的激励入口。
 *
 * 本期**只做记录**，绩效折算不实现。但三样东西先摆好，否则以后接不上：
 *   ① 规则版本（ruleVersion）：将来调权重/基准分，历史积分按旧版本算，不回溯；
 *   ② 归属期间（period，YYYY-MM）：绩效按自然月核算，积分必须能按期间聚合；
 *   ③ 结算状态（待结算 / 已结算 / 已作废）：结算后不允许再改，否则月末结完还能改数。
 *
 * 绩效折算的接口形状（**未实现，仅占位**）：
 *   perfScore(empId, period) = Σ ledger.points × 折算系数 ÷ 基准
 * 折算系数与基准要等考核办法定，所以这里只留 `PERF_CONVERSION` 的结构，不写假算法。
 */
export const LABOR_POINT_RULE = {
  version: 'POINT-2026-11-01',
  basePerHour: 10,
  /* 部位权重：体现"同样 1 小时，风险与技能要求不同"。
     电梯困人 30 分钟和绿化浇水 30 分钟不该同分。 */
  weights: {
    电梯: 1.5,
    公共设备: 1.4,
    配电: 1.3,
    给排水: 1.2,
    道闸门禁: 1.2,
    土建: 1.1,
    公区照明: 1.0,
    门窗五金: 1.0,
    环境其他: 0.8
  }
}

/** 绩效折算（**本期不实现**）：把结构留在这儿，接的时候不用改数据模型 */
export const PERF_CONVERSION = {
  implemented: false,
  ruleVersion: LABOR_POINT_RULE.version,
  note: '积分 → 绩效分的折算系数与基准分尚未确定；本期只记录积分并按月归属，绩效侧读取 laborPointSummary() 即可',
  /* 预留：绩效核算读取的口径。真实实现时由考核办法决定，不要在这里写死比例 */
  basis: 'period',
  expectedInput: ['empId', 'period', 'points']
}

export const laborPointWeight = category => LABOR_POINT_RULE.weights[category] ?? 1

/** 积分 = 工时 × 基准分/时 × 部位权重。四舍五入到 1 位小数（0.1 分足够，不玩精度） */
export function calcLaborPoints({ category = '', hours = 0 } = {}) {
  const h = Math.max(0, Number(hours) || 0)
  const w = laborPointWeight(category)
  const points = Math.round(h * LABOR_POINT_RULE.basePerHour * w * 10) / 10
  return { hours: Math.round(h * 100) / 100, weight: w, points, ruleVersion: LABOR_POINT_RULE.version }
}

const _periodOf = t => String(t || '').slice(0, 7)

/** 积分流水（内存态）：绩效侧将来按 empId + period 聚合，这张表就是唯一来源 */
const LABOR_POINT_LEDGER = []

/**
 * 工单上只有 assignee 姓名，没有 empId；绩效要按人汇总，必须落到工号。
 * 反查按姓名——原型数据里没有重名，真实系统应该由派单时就带上 empId。
 */
function _empIdByName(name = '') {
  const e = employees.find(x => x.name === name)
  return e ? e.empId : ''
}

/* 种子里的历史积分也要进流水：否则首次记录之前，「期间汇总」是空的，
   绩效侧读到的是一张只有今天数据的表。 */
for (const w of workOrders) {
  if (!w.laborPoints) continue
  LABOR_POINT_LEDGER.push({
    ledgerId: 'PL' + String(LABOR_POINT_LEDGER.length + 1).padStart(5, '0'),
    empId: _empIdByName(w.assignee),
    empName: w.assignee || '',
    woId: w.woId, woNo: w.woNo,
    communityId: w.communityId,
    category: w.category,
    hours: w.laborHours || 0,
    weight: w.laborPointWeight || 1,
    points: w.laborPoints,
    period: w.pointsPeriod || String(w.finishTime || w.createTime || '').slice(0, 7),
    ruleVersion: w.pointRuleVersion || LABOR_POINT_RULE.version,
    status: w.pointsStatus || '待结算',
    beforePoints: 0,
    at: w.pointsAt || w.finishTime || w.createTime,
    by: w.pointsBy || '工程主管',
    remark: '种子数据回填'
  })
}

/** 竣工态才能记积分：没完工先记，等于给没干完的活先发分 */
const POINT_ALLOWED_STATUS = ['已完工', '已评价', '已关闭']

/**
 * 记录工时积分。
 * 校验顺序刻意从"这单该不该有积分"开始，先拦住类型不对的，再去管数值。
 */
export function saveLaborPoints(woId, { hours, operator = '工程主管', remark = '' } = {}) {
  const w = workOrders.find(x => x.woId === woId)
  if (!w) throw Object.assign(new Error('工单不存在'), { code: 40401 })
  if (w.type !== '公共区域维修') {
    throw Object.assign(
      new Error('只有公共区域维修记录工时积分 —— 商业服务按人工费提成，重复激励会让师傅挑单'),
      { code: 42210 }
    )
  }
  if (!w.assignee) throw Object.assign(new Error('还没派单，先派单再记工时'), { code: 42210 })
  if (!POINT_ALLOWED_STATUS.includes(w.status)) {
    throw Object.assign(new Error(`工单当前「${w.status}」，完工后才能记工时积分`), { code: 40926 })
  }
  if (w.pointsStatus === '已结算') {
    throw Object.assign(new Error(`${w.pointsPeriod} 已结算，积分不能再改（要改走冲正）`), { code: 40927 })
  }
  const h = Number(hours)
  if (!Number.isFinite(h) || h <= 0) throw Object.assign(new Error('工时必须大于 0'), { code: 42210 })
  if (h > 24) throw Object.assign(new Error('单张工单工时不能超过 24 小时，跨天的请拆单'), { code: 42210 })

  const calc = calcLaborPoints({ category: w.category, hours: h })
  const period = _periodOf(w.finishTime || w.createTime || _now())
  const before = w.laborPoints || 0

  w.laborHours = calc.hours
  w.laborPoints = calc.points
  w.laborPointWeight = calc.weight
  w.pointRuleVersion = calc.ruleVersion
  w.pointsPeriod = period
  w.pointsStatus = '待结算'
  w.pointsBy = operator
  w.pointsAt = _now()

  /* 流水：同一张单重复记录时，旧的那条标记为「已作废」而不是删掉——
     绩效争议时要能看见"改过几次、改成什么" */
  for (const e of LABOR_POINT_LEDGER) {
    if (e.woId === woId && e.status !== '已作废') e.status = '已作废'
  }
  const rec = {
    ledgerId: 'PL' + String(LABOR_POINT_LEDGER.length + 1).padStart(5, '0'),
    empId: w.assigneeEmpId || _empIdByName(w.assignee),
    empName: w.assignee || '',
    woId, woNo: w.woNo,
    communityId: w.communityId,
    category: w.category,
    hours: calc.hours,
    weight: calc.weight,
    points: calc.points,
    period,
    ruleVersion: calc.ruleVersion,
    /* 绩效折算未实现：结算状态先停在「待结算」，由月度绩效核算去推进 */
    status: '待结算',
    beforePoints: before,
    at: _now(),
    by: operator,
    remark
  }
  LABOR_POINT_LEDGER.unshift(rec)
  return { workOrder: { ...w }, ledger: { ...rec } }
}

/** 某张单的积分流水（含已作废，用来看修改痕迹） */
export const laborPointLedgerOf = woId =>
  LABOR_POINT_LEDGER.filter(e => e.woId === woId).map(e => ({ ...e }))

/**
 * 期间积分汇总 —— **绩效侧的唯一读取口**。
 * 按 empId + period 聚合有效流水（排除已作废），返回明细供绩效核算展开。
 * 本期没有调用方（绩效功能未开），但函数与数据结构先定下来。
 */
export function laborPointSummary({ empId = '', period = '' } = {}) {
  const list = LABOR_POINT_LEDGER.filter(e =>
    e.status !== '已作废'
    && (!empId || e.empId === empId)
    && (!period || e.period === period)
  )
  const m = new Map()
  for (const e of list) {
    const key = e.empId + '|' + e.period
    const cur = m.get(key) || { empId: e.empId, empName: e.empName, period: e.period, orders: 0, hours: 0, points: 0 }
    cur.orders += 1
    cur.hours = Math.round((cur.hours + e.hours) * 100) / 100
    cur.points = Math.round((cur.points + e.points) * 10) / 10
    m.set(key, cur)
  }
  return [...m.values()].sort((a, b) => b.points - a.points)
}

/** 全公司期间积分（工单列表/看板用）：总单数、总工时、总积分 */
export function laborPointOverview(period = '') {
  const list = LABOR_POINT_LEDGER.filter(e => e.status !== '已作废' && (!period || e.period === period))
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100
  return {
    orders: list.length,
    hours: r2(list.reduce((s, e) => s + e.hours, 0)),
    points: Math.round(list.reduce((s, e) => s + e.points, 0) * 10) / 10,
    people: new Set(list.map(e => e.empId || e.empName)).size,
    period: period || '全部'
  }
}

/* ---------------- 工单发起（F1） ---------------- */

/* 类型与分类改成字典驱动（2026-11-02）：原来是从工单数据 distinct 出来，
   数据里有什么就能选什么、公共与入户还共用同一批分类 —— 见下方「商业服务项目」段 */
export const woTypeOpts = () => WO_TYPES.slice()
export const woCategoryOpts = (type = '') => {
  if (type === '公共区域维修') return publicCategoryOpts().map(c => c.value)
  if (type === '商业服务') return serviceCategoryRows().filter(c => c.enabled).map(c => c.name)
  return []
}
export const woPriorityOpts = () => ['特急', '紧急', '普通']
export const woSourceOpts = () => ['客服代客', '业主 App', '小程序', '电话', '巡检发现', '设备告警']

let WO_SEQ = workOrders.length
/** 发起工单：写入内存（当次会话内在工单列表可见，刷新还原） */
export function createWorkOrder(p = {}) {
  const type = p.type || '报事'
  const isBiz = type === '商业服务'
  const isPublicRepair = type === '公共区域维修'
  /* 两条维修线各有硬约束：商业服务必须落在具体项目上（价格与服务范围都在项目里），
     公共区域必须落在设施部位上（不然「报修分类」又会退回自由文本） */
  let service = null
  if (isBiz) {
    if (!p.serviceCode) {
      throw Object.assign(new Error('商业服务工单要选服务项目：价格与服务范围都写在项目里'), { code: 42207 })
    }
    service = getServiceItem(p.serviceCode)
    if (!service) throw Object.assign(new Error('服务项目不存在'), { code: 40401 })
    if (!service.enabled) {
      throw Object.assign(new Error(`「${service.name}」已停用，请另选项目或先启用`), { code: 40924 })
    }
  }
  if (isPublicRepair && !String(p.category || '').trim()) {
    throw Object.assign(new Error('公共区域维修要选设施部位（电梯 / 给排水 / 土建…）'), { code: 42207 })
  }
  WO_SEQ += 1
  const house = _HOUSE_OF.get(p.houseId) || null
  const owner = _OWNER_OF.get(p.ownerId) || null
  const wo = {
    woId: 'WO' + String(WO_SEQ).padStart(6, '0'),
    woNo: 'BX' + new Date().getFullYear() + String(WO_SEQ).padStart(5, '0'),    // 与既有 BX202600001 同格式
    communityId: p.communityId || house?.communityId || 'P01',
    houseId: p.houseId || '', houseName: p.houseName || house?.fullName || '',
    ownerId: p.ownerId || '', ownerName: owner?.name || p.ownerName || '',
    ownerPhone: owner?.phone || p.phone || '',
    type, category: service ? service.category : (p.category || ''),
    source: p.source || '客服代客', priority: p.priority || '普通',
    status: '待派单', title: p.title || '', description: p.description || '',
    images: p.images || 0, createTime: _now(), dispatchMode: p.assignee ? '手动派单' : '待派单',
    assignee: p.assignee || '', assigneePhone: '', acceptTime: '', arriveTime: '', finishTime: '',
    durationHours: 0, slaHours: p.priority === '特急' ? 4 : (p.priority === '紧急' ? 8 : 24),
    isOverdue: false,
    /* 费用按项目快照：字典以后再改价，这张单的金额不变（毛利才算得准） */
    feeType: service ? '收费' : '免费',
    materialFee: service ? service.material : 0,
    laborFee: service ? service.labor : 0,
    totalFee: service ? service.price : 0,
    serviceCost: service ? service.cost : 0,
    priceCode: service ? service.code : '',
    serviceName: service ? service.name : '',
    payStatus: service ? '未支付' : '无需支付',
    score: 0, evalTags: [], evaluate: '',
    remark: p.remark || '', isPublic: isPublicRepair,
    _isNew: true                                   // 内存态标记：列表可高亮「本次新增」
  }
  // 列表页读的是 WO_ROWS（带空间字段的派生行），因此两处都要写，否则新单看不见
  const hs = HOUSE_SPACE.get(wo.houseId)
  WO_ROWS.unshift({
    ...wo,
    buildingId: hs?.buildingId || '',
    buildingName: hs ? (BUILDING_OF.get(hs.buildingId)?.name || hs.buildingId) : '',
    unitId: hs?.unitId || '',
    unitName: hs ? unitNameOf(hs.unitId) : '',
    subjectType: wo.houseId ? 'house' : 'public'
  })
  workOrders.unshift(wo)
  return wo
}

/** F3 告警转工单：生成公共区域维修工单并回写告警关联 */
export function createWoFromAlarm(alarmId) {
  const a = alarms.find(x => x.alarmId === alarmId)
  if (!a) throw new Error('告警不存在')
  if (a.dispatchWoId) throw new Error('该告警已生成工单：' + a.dispatchWoId)
  const wo = createWorkOrder({
    communityId: a.communityId, type: '公共区域维修', category: '公共设备',
    source: '设备告警', priority: a.level === '紧急' ? '紧急' : '普通',
    title: `${a.deviceName} ${a.type}`, description: `由告警 ${a.alarmId} 自动生成：${a.content}`,
    feeType: '免费', remark: `来源告警 ${a.alarmId}`
  })
  a.dispatchWoId = wo.woId
  a.status = '处理中'
  a.handleTime = _now()
  return wo
}

/** F2 品质整改转工单：整改项落到工单表，记录整改单号便于追溯 */
export function createWoFromQuality(checkId, item = '') {
  const q = qualityChecks.find(x => x.checkId === checkId)
  if (!q) throw new Error('检查记录不存在')
  const wo = createWorkOrder({
    communityId: q.communityId, type: '公共区域维修', category: '品质整改',
    source: '巡检发现', priority: q.grade === '不合格' ? '紧急' : '普通',
    title: `品质整改：${q.area}${item ? ' · ' + item : ''}`,
    description: `来源检查记录 ${q.checkNo}（得分 ${q.score} / ${q.grade}），整改项 ${q.rectifyCount} 项，要求 ${q.dueDate} 前完成`,
    feeType: '免费', remark: `来源 ${q.checkNo}`
  })
  q.rectifyWoIds = [...(q.rectifyWoIds || []), wo.woId]
  if (q.status === '待复核') q.status = '整改中'
  _syncQualityRow(q)          // 列表 / 汇总读派生行，不同步会出现「生成了工单但列表还是待复核」
  return wo
}

/* ---------------- 待办中心（C1） ---------------- */

export const TODO_TYPES = [
  { key: 'approval', label: '待我审批', route: '/c/approval' },
  { key: 'workorder', label: '工单待派', route: '/f/workorders' },
  { key: 'alarm', label: '告警待处理', route: '/d/alarms' },
  { key: 'quality', label: '品质待复核', route: '/f/quality-records' },
  { key: 'debt', label: '欠费待催缴', route: '/b/bills' },
  { key: 'deposit', label: '押金逾期', route: '/b/deposits' }
]

/** 六类待办聚合：统一结构 { id, type, title, desc, level, due, communityName, bizId, route } */
export function todoRows({ communityId = '', types = [], level = '', kw = '' } = {}) {
  const out = []
  for (const a of approvals) {
    if (!['待审批', '审批中'].includes(a.status)) continue
    out.push({
      id: a.approvalId, type: 'approval', typeLabel: '待我审批',
      title: a.title, desc: `${a.bizType} · ${a.applicant} 提交 · 当前节点「${a.currentNode}」`,
      level: a.urgency === '紧急' ? '紧急' : (a.waitHours > 48 ? '重要' : '一般'),
      due: a.applyTime, communityName: a.communityName, bizId: a.approvalId,
      route: `/c/approval/${a.approvalId}`, extra: `等待 ${a.waitHours} 小时`
    })
  }
  for (const w of workOrders) {
    if (w.status !== '待派单' && !w.isOverdue) continue
    if (!['待派单', '已派单', '处理中', '待确认'].includes(w.status)) continue
    out.push({
      id: w.woId, type: 'workorder', typeLabel: '工单待办',
      title: `${w.woNo} ${w.title}`, desc: `${w.type} · ${w.houseName || '公共区域'} · ${w.status}`,
      level: w.priority === '特急' ? '紧急' : (w.isOverdue ? '重要' : '一般'),
      due: w.createTime, communityName: communityName(w.communityId), bizId: w.woId,
      route: `/f/wo-detail?id=${w.woId}`, extra: w.isOverdue ? '已超时' : '待派单'
    })
  }
  for (const a of alarms) {
    if (a.status === '已关闭') continue
    out.push({
      id: a.alarmId, type: 'alarm', typeLabel: '告警待处理',
      title: `${a.deviceName} ${a.type}`, desc: a.content,
      level: a.level === '紧急' ? '紧急' : (a.level === '重要' ? '重要' : '一般'),
      due: a.occurTime, communityName: communityName(a.communityId), bizId: a.alarmId,
      route: `/d/alarms?focus=alarm:${a.alarmId}&open=1`, extra: a.status
    })
  }
  for (const q of qualityChecks) {
    if (['已闭环'].includes(q.status)) continue
    const overdue = q.dueDate < DATA_DATE
    if (!overdue && q.status !== '待复核') continue
    out.push({
      id: q.checkId, type: 'quality', typeLabel: '品质待复核',
      title: `${q.area} ${q.type}检查（${q.score} 分）`, desc: `检查人 ${q.checker} · 整改 ${q.rectifyDone}/${q.rectifyCount} 项`,
      level: overdue ? '重要' : '一般', due: q.dueDate,
      communityName: communityName(q.communityId), bizId: q.checkId,
      route: `/f/quality-records?focus=check:${q.checkId}&open=1`, extra: overdue ? '已超期' : q.status
    })
  }
  // 欠费按房屋聚合：避免 898 笔账单刷屏，取欠费金额 Top 80
  const debtMap = new Map()
  for (const b of bills) {
    if (!isDebt(b)) continue
    const cur = debtMap.get(b.houseId) || { houseId: b.houseId, houseName: houseName(b.houseId), communityId: b.communityId, sum: 0, cnt: 0, max: 0 }
    cur.sum += b.unpaid; cur.cnt++; cur.max = Math.max(cur.max, b.overdueDays)
    debtMap.set(b.houseId, cur)
  }
  for (const d of [...debtMap.values()].sort((a, b) => b.sum - a.sum).slice(0, 80)) {
    out.push({
      id: d.houseId, type: 'debt', typeLabel: '欠费待催缴',
      title: `${d.houseName} 欠费 ¥${Math.round(d.sum).toLocaleString()}`,
      desc: `${d.cnt} 笔未结清 · 最长逾期 ${d.max} 天`,
      level: d.max > 180 ? '紧急' : (d.max > 60 ? '重要' : '一般'),
      due: '', communityName: communityName(d.communityId), bizId: d.houseId,
      route: `/b/bills?focus=house:${d.houseId}&open=1`, extra: `逾期 ${d.max} 天`
    })
  }
  for (const d of decorationDeposits) {
    if (d.status !== '已逾期') continue
    out.push({
      id: d.depositId, type: 'deposit', typeLabel: '押金逾期',
      title: `${d.houseName} 装修超期未验收`, desc: `押金 ¥${d.amount} · 超期 ${d.overdueDays} 天`,
      level: d.overdueDays > 90 ? '重要' : '一般', due: d.planEndDate,
      communityName: d.communityName, bizId: d.depositId,
      route: `/b/deposits?focus=deposit:${d.depositId}&open=1`, extra: `超期 ${d.overdueDays} 天`
    })
  }
  const types_ = types.length ? types : null
  return out
    .filter(x => (!communityId || x.communityName === communityName(communityId)))
    .filter(x => (!types_ || types_.includes(x.type)))
    .filter(x => (!level || x.level === level))
    .filter(x => !kw || `${x.title}${x.desc}${x.communityName}`.toLowerCase().includes(String(kw).toLowerCase()))
    .sort((a, b) => {
      const w = { 紧急: 0, 重要: 1, 一般: 2 }
      return (w[a.level] - w[b.level]) || String(b.due).localeCompare(String(a.due))
    })
}

export function queryTodos({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => paged(scopeFilter(todoRows(filters), { communities: todoComm }), pageNo, size))
}

/** 待办概览：六类各多少条，紧急多少条 */
export function todoSummary() {
  const rows = scopeFilter(todoRows(), { communities: todoComm })
  const byType = {}
  for (const t of TODO_TYPES) byType[t.key] = rows.filter(r => r.type === t.key).length
  return { total: rows.length, urgent: rows.filter(r => r.level === '紧急').length, byType }
}

/* ---------------- 审批处理（C1） ---------------- */

export const APPROVAL_STATUS = ['待审批', '审批中', '已通过', '已驳回', '已撤回']

/** 审批业务类型：从数据里取，避免写死枚举漏掉运行时新增的「合同审批」 */
export const approvalBizTypeOpts = () => [...new Set(approvals.map(a => a.bizType))]

export function queryApprovals({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const { bizType = '', status = '', communityId = '', kw = '' } = filters
    const list = scopeFilter(approvals).filter(a =>
      (!bizType || a.bizType === bizType) &&
      (!status || a.status === status) &&
      (!communityId || a.communityId === communityId) &&
      (!kw || `${a.title}${a.approvalNo}${a.applicant}`.toLowerCase().includes(String(kw).toLowerCase()))
    )
    return paged(list, pageNo, size)
  })
}

export function getApproval(approvalId) {
  return delay(() => approvals.find(a => a.approvalId === approvalId) || null)
}

/**
 * 审批动作：同意 / 驳回 / 转办 / 加签（内存态）
 * 同意 → 当前节点置为同意并推进下一节点；最后一个节点同意后整单通过
 * 转办 → 当前节点处理人改为被转办人，状态转「审批中」
 * 加签 → 在当前节点后插入一个「加签审批」节点，状态转「审批中」
 */
export function approvalAction(approvalId, action, { comment = '', to = '' } = {}) {
  const a = approvals.find(x => x.approvalId === approvalId)
  if (!a) throw new Error('审批单不存在')
  if (!['待审批', '审批中'].includes(a.status)) throw new Error('该审批单已结束，无法处理')
  const idx = a.flow.findIndex(n => n.action === '待处理')
  if (idx < 0) throw new Error('没有待处理节点')
  const node = a.flow[idx]
  const time = _now()
  const me = currentOperator()
  const approvers = Array.isArray(node.approvers) ? node.approvers : []
  const isSign = approvers.length > 0
  const mode = node.signMode || 'single'

  /* 会签节点先找"我这一份"。原型只有角色没有真实登录身份，角色反推出的人
     常常不在名单里 —— 这时按第一份待处理代签，并在意见里注明是谁代的：
     既不能让单据卡死，也不能假装是本人签的。 */
  let mine = null
  let proxy = ''
  if (isSign) {
    mine = approvers.find(p => p.action === '待处理' && p.name === me.name) || null
    if (!mine) {
      mine = approvers.find(p => p.action === '待处理') || null
      if (mine) proxy = `（代 ${mine.name} 处理）`
    }
  }
  const pendingOf = () => approvers.filter(p => p.action === '待处理')

  if (action === '驳回') {
    if (isSign && mine) {
      mine.action = '驳回'; mine.time = time
      mine.comment = (comment || '不符合要求') + proxy
    }
    node.action = '驳回'
    node.handler = mine?.name || node.handler || me.name
    node.time = time
    node.comment = comment || '不符合要求'
    /* 会签里一人驳回即整单驳回，剩下的不用再签 —— 但保留"已跳过"痕迹，
       否则后面几个人会像凭空消失一样 */
    for (const p of approvers) {
      if (p.action === '待处理') { p.action = '已跳过'; p.comment = '同节点已驳回' }
    }
    a.status = '已驳回'; a.currentNode = '已完成'
  } else if (action === '转办') {
    if (!to) throw new Error('请选择转办人')
    if (isSign && mine) {
      mine.name = to
      mine.action = '待处理'
      mine.comment = `转办自 ${me.name}${comment ? '：' + comment : ''}`
      a.status = '审批中'; a.currentNode = `${node.node}（${to}）`
    } else {
      node.handler = to; node.time = time; node.comment = `转办给 ${to}${comment ? '：' + comment : ''}`
      node.action = '转办'
      a.status = '审批中'; a.currentNode = `${node.node}（${to}）`
    }
  } else if (action === '加签') {
    if (!to) throw new Error('请选择加签人')
    if (isSign) {
      /* 会签节点加签 = 往名单里再加一个必须签的人，而不是插一级新节点 */
      if (mine) { mine.action = '同意'; mine.time = time; mine.comment = (comment || '同意') + proxy }
      approvers.push({ name: to, empId: '', duty: '', action: '待处理', time: '', comment: `加签自 ${me.name}` })
      a.status = '审批中'; a.currentNode = `${node.node}（加签 ${to}）`
      node.handler = to
    } else {
      node.handler = node.handler || '当前处理人'; node.time = time
      node.action = '同意'; node.comment = comment || '同意，已加签'
      a.flow.splice(idx + 1, 0, { node: `加签审批（${to}）`, handler: to, action: '待处理', time: '', comment: '' })
      a.status = '审批中'; a.currentNode = `加签审批（${to}）`
    }
  } else {
    if (isSign) {
      if (mine) { mine.action = '同意'; mine.time = time; mine.comment = (comment || '同意') + proxy }
    } else {
      node.action = '同意'; node.handler = node.handler || '当前处理人'; node.time = time
      node.comment = comment || '同意'
    }
    const pending = isSign ? pendingOf() : []
    /* 单人 / 或签（任一人同意即过）/ 会签（全部签完才过） */
    const passed = !isSign || mode === 'any' || pending.length === 0
    if (!passed) {
      a.status = '审批中'
      const done = approvers.filter(p => p.action !== '待处理').length
      a.currentNode = `${node.node}（会签 ${done}/${approvers.length}）`
      node.handler = pending[0].name
    } else {
      if (isSign) {
        node.action = '同意'
        node.handler = mine?.name || approvers[0]?.name || ''
        node.time = time
        node.comment = mode === 'any' && approvers.length > 1
          ? '或签：一人同意即通过'
          : `会签：${approvers.length} 人全部同意`
        if (mode === 'any') {
          for (const p of approvers) {
            if (p.action === '待处理') { p.action = '已跳过'; p.comment = '或签，他人已同意' }
          }
        }
      }
      const next = a.flow[idx + 1]
      if (next) { next.action = '待处理'; a.status = '审批中'; a.currentNode = next.node }
      else { a.status = '已通过'; a.currentNode = '已完成' }
    }
  }
  // 合同域回写：审批通过/驳回后同步合同与变更单（C4）
  _applyContractApproval(a, action)
  // 计划域回写：审批结果决定计划能否进入执行（2026-11-03）
  _applyPlanApproval(a, action)
  // 报销域回写（2026-11-13）：批了不落 expenses，支出归集就永远收不到这笔钱
  _applyExpenseApproval(a, action)
  return a
}

/** 转办 / 加签的候选人：主管及以上 */
export const approvalCandidates = () => employees
  .filter(e => e.status === '在职' && /主管|经理|总监/.test(e.position))
  .slice(0, 40).map(e => ({ empId: e.empId, name: e.name, position: e.position }))

/* ================= OA 审批底座（2026-11-03） =================
 * 与「业务实体 + 审批单」的区别：OA 单据**没有业务实体**，表单内容就存在审批单的 formData 里。
 * 所以这里不新建表 —— 复用 approvals，只是多带一个 formData、bizId 留空。
 *
 * 这样待办中心、超时计算、同意/驳回/转办/加签全部白得，不用重写一套。
 *
 * 本期边界：**批准即结束，不落业务结果**。
 * 费用报销批了不生成付款单、请假批了不进考勤、采购批了不建采购单 ——
 * 每个"落结果"都要动别的域的状态机，单独排批。
 */

/** 流程配置（可改；改配置只影响新单，在途单沿用发起时的 flow 快照） */
const OA_FLOWS = OA_FLOW_DEFS.map(f => ({ ...f, baseNodes: [...f.baseNodes], overNodes: [...f.overNodes] }))

export const oaFlows = () => OA_FLOWS.map(f => ({
  ...f,
  /* 在途单数：改配置时得让人知道有多少单在用旧流程 */
  inFlight: approvals.filter(a => a.bizType === f.bizType && ['待审批', '审批中'].includes(a.status)).length
}))

export const oaFlowOf = bizType => OA_FLOWS.find(f => f.bizType === bizType) || null

/**
 * 当前角色对应的"人"。
 * 系统里只有角色没有登录人（原型），审批单要落一个具体提报人，
 * 所以按角色名映射到岗位，取该岗位第一个在职员工。
 */
const ROLE_TO_POSITION = {
  集团总经理: '总经理',
  项目经理: '项目经理',
  客服专员: '客服专员',
  收银员: '收银员',
  财务专员: '会计',
  财务主管: '财务主管',
  工程维修: '维修工',
  品质督导: '品质专员',
  人事专员: '人事专员',
  楼栋管家: '客服专员',
  部门经理: '客服主管',
  环境保洁: '保洁员',
  秩序维护员: '保安',
  只读观察员: '客服专员'
}

export function currentOperator() {
  const pos = ROLE_TO_POSITION[currentRoleName.value] || '客服专员'
  const e = employees.find(x => x.position === pos && x.status !== '离职')
    || employees.find(x => x.status !== '离职')
    || employees[0]
  return {
    empId: e.empId, name: e.name, position: e.position, level: e.level,
    orgId: e.orgId, orgName: orgNameOf(e.orgId), manager: e.manager || '',
    roleName: currentRoleName.value
  }
}

/** 岗位代码 → 具体人（财务 / 法务 / 合同初审 / 总经理 / 行政） */
const ROLE_POSITION_MAP = {
  finance: ['财务主管', '会计'],
  legal: ['会计'],          /* 数据里没有法务岗，先用总部职能人员代；真实系统应配法务岗 */
  contract: ['会计'],
  gm: ['总经理'],
  admin: ['人事专员', '人事主管']
}

/**
 * 把节点的「审批人来源」解析成具体人。
 * 解析不出来时返回空串（审批页显示"待指派"），不编造一个人名。
 */
function _resolveAssignee(node, applicant) {
  switch (node.assigneeType) {
    case 'orgLeader': {
      /* 走关系表：在期正职优先，正职空缺才落到在期代理；副职不参与审批 */
      return orgLeaderOf(applicant.orgId)?.name || ''
    }
    case 'projectManager': {
      /* 组织上下文可能是班组（计划按提报部门解析），也可能是项目部（人事归属）。
         一路沿 parentId 往上找 type==='项目' 的节点；总部职能部门找不到项目 → 集团总经理。
         以前只看 applicant.orgId 是不是项目，班组一进来就直接回落到总经理，班组计划会跳过项目经理。 */
      let org = orgs.find(o => o.orgId === applicant.orgId)
      for (let i = 0; org && org.type !== '项目' && org.parentId && i < 8; i++) {
        org = orgs.find(o => o.orgId === org.parentId)
      }
      if (org && org.type === '项目') return orgLeaderOf(org.orgId)?.name || ''
      return orgLeaderOf('O-ROOT')?.name || ''
    }
    case 'directSuperior':
      return applicant.manager || orgLeaderOf(applicant.orgId)?.name || ''
    case 'role': {
      const poss = ROLE_POSITION_MAP[node.roleCode] || []
      const e = employees.find(x => poss.includes(x.position) && x.status !== '离职')
      return e?.name || ''
    }
    case 'deptHead': {
      return orgLeaderOf(node.orgId)?.name || ''
    }
    default:
      return ''
  }
}

/**
 * 自审绕过：解析出来的审批人等于申请人时，沿组织链向上找第一个不是自己的负责人。
 *
 * 不加这条会死锁：部门负责人给自己提的请假 / 计划，第一节点「部门负责人审批」
 * 解析到的就是他本人，单子停在待审批没人能动。这是通用规则，不是计划管理专属 ——
 * 只是多部门主管出现之后，撞上的概率从"偶尔"变成"每个月的计划都撞"。
 * 返回 note 便于详情页说明"为什么这级换人了"，不静默改审批人。
 */
function _skipSelf(handler, applicant) {
  if (!handler || handler !== applicant.name) return { name: handler, note: '', selfTop: false }
  let cur = ORG_OF.get(applicant.orgId)
  const seen = new Set([applicant.orgId])
  for (let i = 0; cur && cur.parentId && i < 8; i++) {
    if (seen.has(cur.parentId)) break
    seen.add(cur.parentId)
    cur = ORG_OF.get(cur.parentId)
    /* 同样走关系表：上级部门的在期正职 / 代理 */
    const l = orgLeaderOf(cur.orgId)?.name || ''
    if (l && l !== applicant.name) {
      return { name: l, note: `原审批人为本人，已跳升至${cur.name}负责人`, selfTop: false }
    }
  }
  /* 走到顶都没找到别人 = 申请人自己就是最高负责人（集团总经理提报总部计划就是这样）。
     这时候不能返回空串：空串会让节点挂成"待指派"，单子永远没人能签。
     标记 selfTop，由 createOaRequest 把这一级记为自动通过。 */
  return { name: '', note: '申请人即最高审批人，本节点自动通过', selfTop: true }
}

/**
 * 解析一个节点的**全部**审批人（会签 / 或签用）。
 *
 * 只有「部门负责人」这一种来源支持多签：对象是**本部门所有在期负责人**
 * （正职 + 副职 + 代理），并**排除申请人本人** —— 自己不能给自己签。
 * 排除后一个不剩（部门只有申请人一个负责人），沿组织链向上找，
 * 而不是让单据停在"自己审自己"。
 *
 * 其他来源（项目经理 / 指定岗位 / 直属上级）天然只有一个对象，
 * 就算配了会签也等价于单人，这里统一退回单值解析。
 */
function _resolveAssignees(node, applicant) {
  const mode = node.signMode || 'single'
  if (mode === 'single' || node.assigneeType !== 'orgLeader') {
    const s = _skipSelf(_resolveAssignee(node, applicant), applicant)
    if (s.name) return [{ name: s.name, empId: '', duty: '', note: s.note, selfTop: false }]
    /* 申请人就是最高负责人：把人名留成他自己并打上 selfTop，
       createOaRequest 据此把这一级记为"自动通过"，而不是挂成待指派 */
    if (s.selfTop) {
      return [{ name: applicant.name, empId: applicant.empId || '', duty: '', note: s.note, selfTop: true }]
    }
    return []
  }
  const same = activeLeadersOf(applicant.orgId).filter(r => r.name !== applicant.name)
  if (same.length) {
    return same.map(r => ({ name: r.name, empId: r.empId, duty: r.duty, note: '' }))
  }
  let cur = ORG_OF.get(applicant.orgId)
  const seen = new Set([applicant.orgId])
  for (let i = 0; cur && cur.parentId && i < 8; i++) {
    if (seen.has(cur.parentId)) break
    seen.add(cur.parentId)
    cur = ORG_OF.get(cur.parentId)
    const up = activeLeadersOf(cur.orgId).filter(r => r.name !== applicant.name)
    if (up.length) {
      return up.map(r => ({
        name: r.name, empId: r.empId, duty: r.duty,
        note: `本部门没有其他负责人，已跳升至${cur.name}`
      }))
    }
  }
  return []
}

/** 按金额选节点：≤ 阈值走 baseNodes，> 阈值走 overNodes（没配 overNodes 就还是 baseNodes） */
export function oaNodesFor(bizType, amount = 0) {
  const f = oaFlowOf(bizType)
  if (!f) return []
  const over = Number(f.amountThreshold) > 0 && Number(amount) > Number(f.amountThreshold)
  return (over && f.overNodes.length ? f.overNodes : f.baseNodes).map(n => ({ ...n }))
}

/** 表单校验：必填、数值范围、结束时间晚于开始 */
/** 明细行小计：总价 = 单价 × 本次采购数量（不取用户填的值，防止手改总价） */
export const oaItemTotal = row => Math.round((Number(row?.buyQty) || 0) * (Number(row?.price) || 0) * 100) / 100
export const oaItemsTotal = (rows = []) =>
  Math.round(rows.reduce((s, r) => s + oaItemTotal(r), 0) * 100) / 100

export function oaFormCheck(bizType, formData = {}) {
  const def = oaFormOf(bizType)
  if (!def) return `未知单据类型：${bizType}`
  /* noForm = 自带业务实体（合同 / 计划），内容不在动态表单里，字段校验交给业务侧 */
  if (def.noForm || !(def.fields || []).length) return ''
  for (const f of def.fields) {
    const v = formData[f.key]
    const empty = v === undefined || v === null || String(v).trim() === ''
    if (f.required && empty) return `请填写${f.label}`
    if (empty) continue
    if (f.type === 'number' || f.type === 'money') {
      const n = Number(v)
      if (!Number.isFinite(n)) return `${f.label}必须是数字`
      if (f.min !== undefined && n < f.min) return `${f.label}不能小于 ${f.min}`
      if (f.max !== undefined && n > f.max) return `${f.label}不能大于 ${f.max}`
    }
    if (f.type === 'items') {
      if (!Array.isArray(v)) return `${f.label}格式不正确`
      for (let i = 0; i < v.length; i++) {
        const r = v[i] || {}
        const no = `第 ${i + 1} 行`
        if (!String(r.name || '').trim()) return `${no}：请填写物品名称`
        if (!(Number(r.buyQty) > 0)) return `${no}：本次采购数量必须大于 0`
        if (!(Number(r.price) > 0)) return `${no}：单价必须大于 0`
        /* 需求 − 库存 = 可采购上限。超了不硬拦（急件常先买），但必须写清原因，
           否则审批人只看到"多买了 3 个"，不知道是库存不准还是临时加量 */
        const need = Number(r.needQty)
        const stock = Number(r.stockQty) || 0
        if (Number.isFinite(need) && need > 0) {
          const cap = Math.max(0, need - stock)
          if (Number(r.buyQty) > cap && !String(r.note || '').trim()) {
            return `${no}：本次采购 ${r.buyQty} 超过「需求 ${need} − 库存 ${stock}」的可采购量，请在备注里说明`
          }
        }
      }
    }
    if (f.maxlength && String(v).length > f.maxlength) return `${f.label}不超过 ${f.maxlength} 字`
    if (f.type === 'select' && f.options && !f.options.includes(v)) return `${f.label}取值不合法`
  }
  /* 派生金额：报销金额必须是明细合计。两处不一致时，审批人无法判断该信哪个 */
  for (const f of def.fields) {
    if (!f.derived || f.derived !== 'items') continue
    const rows = Array.isArray(formData.items) ? formData.items : []
    const expect = oaItemsTotal(rows)
    const got = Number(formData[f.key])
    if (Number.isFinite(got) && Math.abs(got - expect) > 0.01) {
      return `${f.label}应等于明细合计 ¥${expect.toFixed(2)}（当前 ¥${got.toFixed(2)}）`
    }
  }
  for (const f of def.fields) {
    if (f.role !== 'periodEnd') continue
    const start = formData[f.after]
    const end = formData[f.key]
    if (start && end && String(end) <= String(start)) return `${f.label}必须晚于开始时间`
  }
  return ''
}

/** 摘要：列表与待办里显示的短标题，不能让 8 个字段全冲上来 */
function _oaSummary(def, formData = {}) {
  const parts = (def?.summaryKeys || [])
    .map(k => {
      const f = def.fields.find(x => x.key === k)
      const v = formData[k]
      if (v === undefined || v === null || v === '') return ''
      if (f?.type === 'money') return `¥${Number(v).toLocaleString('zh-CN')}`
      return String(v)
    })
    .filter(Boolean)
  return parts.join(' · ')
}

/**
 * 发起 OA 申请。
 * 生成一条 approvals 记录（bizId 留空 = 无业务实体），flow 按当前配置解析成人名。
 *
 * `orgScopeId` 覆盖**审批人的组织上下文**：合同 / 计划这类自带业务实体的单据，
 * 上级要按"业务属于哪个组织"解析，不能按提报人的人事归属解析 ——
 * 一人管两个部门时，同一人提两个部门的计划，项目经理不是同一个。
 * 不传则等同于人事归属（旧行为，其余单据不受影响）。
 */
export function createOaRequest({
  bizType, formData = {}, urgency = '', files = [],
  bizId = '', title = '', orgScopeId = ''
} = {}) {
  const def = oaFormOf(bizType)
  if (!def) throw Object.assign(new Error(`不支持的单据类型：${bizType}`), { code: 42211 })
  /* 派生字段先算一遍再校验：页面漏同步（点了添加行没触发 watch）不该让用户看到"金额不等于合计" */
  const data = { ...formData }
  for (const f of def.fields || []) {
    if (f.derived === 'items') data[f.key] = oaItemsTotal(Array.isArray(data.items) ? data.items : [])
  }
  const bad = oaFormCheck(bizType, data)
  if (bad) throw Object.assign(new Error(bad), { code: 42211 })

  const base = currentOperator()
  /* 组织上下文可以是班组（计划按提报部门），审批人解析用它；人事归属另存一列 */
  const applicant = orgScopeId ? { ...base, orgId: orgScopeId, orgName: orgNameOf(orgScopeId) } : base
  const amountField = (def.fields || []).find(f => f.role === 'amount')
  const amount = amountField ? Number(data[amountField.key]) || 0 : 0
  const nodes = oaNodesFor(bizType, amount)
  if (!nodes.length) throw Object.assign(new Error('该单据没有配置审批流，请先在流程配置里设置节点'), { code: 42212 })

  APPROVAL_SEQ += 1
  /* 节点先算出来：第一级如果解析成"申请人本人即最高负责人"，直接记自动通过，
     并把 currentNode 落到下一个真正待办的节点上（否则待办列表里挂着一个谁也点不动的节点）。 */
  const flow = nodes.map((n, i) => {
    const list = _resolveAssignees(n, applicant)
    const auto = i === 0 && list.length === 1 && list[0].selfTop
    const at = _now()
    return {
      node: n.name,
      signMode: n.signMode || 'single',
      /* handler 保留为"第一个审批人"，老页面与老数据都读它；
         会签的完整名单在 approvers 里，单人时数组长度 1 */
      handler: list[0]?.name || '',
      approvers: list.map(p => ({
        name: p.name, empId: p.empId || '', duty: p.duty || '',
        action: auto ? '同意' : '待处理', time: auto ? at : '', comment: auto ? '自动通过' : ''
      })),
      action: auto ? '同意' : '待处理',
      time: auto ? at : '',
      comment: auto ? '申请人即最高审批人，自动通过' : '',
      limitHours: n.limitHours || 24,
      /* 自动通过时 comment 已经写明原因，skipNote 再写一遍会在时间线上重复两行 */
      skipNote: auto ? '' : (list[0]?.note || '')
    }
  })
  const pending = flow.find(f => f.action === '待处理')

  const ap = {
    approvalId: 'AP' + String(APPROVAL_SEQ).padStart(5, '0'),
    approvalNo: 'SP-' + String(TODAY).slice(0, 4) + '-' + String(APPROVAL_SEQ).padStart(4, '0'),
    bizType,
    bizId,                                       /* 空 = 无业务实体；合同 / 计划带自己的主键 */
    changeId: '',
    title: title || `${bizType} · ${_oaSummary(def, data)}`,
    formData: { ...data },
    files: [...files],
    communityId: data.communityId || (orgs.find(o => o.orgId === base.orgId)?.type === '项目' ? base.orgId.replace('O-', '') : ''),
    communityName: '',
    amount,
    applicant: base.name,
    applicantRole: base.position,
    applicantEmpId: base.empId,
    applicantOrgId: base.orgId,                  /* 人事归属：工资、考勤按这个 */
    applicantOrgName: base.orgName,
    scopeOrgId: orgScopeId || '',                /* 业务归属：审批链按这个解析 */
    scopeOrgName: orgScopeId ? orgNameOf(orgScopeId) : '',
    applyTime: _now(),
    status: '待审批',
    currentNode: (pending || flow[flow.length - 1] || {}).node || '',
    urgency: urgency || def.urgentDefault || '普通',
    waitHours: 0,
    flow,
    _isNew: true
  }
  ap.communityName = ap.communityId ? communityName(ap.communityId) : '集团 / 全项目'
  approvals.unshift(ap)
  return { ...ap }
}

/** 我的申请：提报人 = 当前操作人 */
export function queryOaRequests({ mineOnly = true, status = '', bizType = '', kw = '', pageNo = 1, size = 20 } = {}) {
  const me = currentOperator()
  const list = approvals
    .filter(a => OA_FORM_DEFS.some(f => f.bizType === a.bizType))   /* 只回 OA 单据，不含合同审批等业务单 */
    .filter(a => !mineOnly || a.applicant === me.name)
    .filter(a => !status || a.status === status)
    .filter(a => !bizType || a.bizType === bizType)
    .filter(a => !kw || `${a.title}${a.approvalNo}`.toLowerCase().includes(String(kw).toLowerCase()))
    .map(a => ({
      ...a,
      /* 已办时长：一条单等了多久，比"提交时间"更能说明问题 */
      waitText: ['待审批', '审批中'].includes(a.status) ? `已等 ${a.waitHours} 小时` : a.status
    }))
  return paged(list, pageNo, size)
}

/**
 * 撤回：默认只有「待审批」（还没人动过）才能撤 —— 审批中说明有人已在处理。
 *
 * `allowInFlight` 是给**计划**开的口子：月度计划一级过了、二级还没处理时，
 * 提报人发现任务写错要改，是很正常的动作。报销单不能这么干（钱已经批了一级），
 * 所以做成显式开关而不是放宽全局规则。
 */
export function withdrawOaRequest(approvalId, reason = '', { allowInFlight = false } = {}) {
  const a = approvals.find(x => x.approvalId === approvalId)
  if (!a) throw Object.assign(new Error('审批单不存在'), { code: 40401 })
  const canWithdraw = a.status === '待审批' || (allowInFlight && a.status === '审批中')
  if (!canWithdraw) {
    throw Object.assign(new Error(`当前「${a.status}」，只有还没人处理的单子可以撤回`), { code: 40928 })
  }
  const first = a.flow.find(n => n.action === '待处理')
  if (first) {
    first.action = '撤回'
    first.handler = a.applicant
    first.time = _now()
    first.comment = reason || '申请人撤回'
    /* 会签节点撤回时，名单里还没签的也要标掉，否则后面显示"2/2 待签"却整单已撤回 */
    for (const p of (first.approvers || [])) {
      if (p.action === '待处理') { p.action = '撤回'; p.comment = reason || '申请人撤回' }
    }
  }
  /* 已经批过的节点保留原文（谁批的、什么时候批的不能抹掉），只把未处理的节点标撤回 */
  a.status = '已撤回'
  a.currentNode = '已完成'
  return { ...a }
}

/**
 * 改流程配置。
 * **只影响新单**：在途单的 flow 是发起时的快照，改配置回头改会让"批到一半换规则"。
 */
export function updateOaFlow(bizType, patch = {}) {
  const f = oaFlowOf(bizType)
  if (!f) throw Object.assign(new Error('单据类型不存在'), { code: 40401 })
  const clean = nodes => (nodes || []).map((n, i) => ({
    key: n.key || 'n' + (i + 1),
    name: String(n.name || '').trim() || `节点 ${i + 1}`,
    assigneeType: n.assigneeType || 'orgLeader',
    roleCode: n.roleCode || '',
    orgId: n.orgId || '',
    /* 签署方式：只有「部门负责人」来源真正生效，其他来源等价于单人 */
    signMode: ['single', 'all', 'any'].includes(n.signMode) ? n.signMode : 'single',
    limitHours: Math.max(1, Number(n.limitHours) || 24),
    allowReject: n.allowReject !== false
  }))
  if (patch.baseNodes) {
    const list = clean(patch.baseNodes)
    if (!list.length) throw Object.assign(new Error('至少保留一个审批节点，否则提交即通过'), { code: 42212 })
    f.baseNodes = list
  }
  if (patch.overNodes !== undefined) f.overNodes = clean(patch.overNodes)
  if (patch.amountThreshold !== undefined) f.amountThreshold = Math.max(0, Number(patch.amountThreshold) || 0)
  if (patch.note !== undefined) f.note = String(patch.note)
  /* overNodes 有值但阈值是 0 时，overNodes 永远走不到 —— 直接拦，别让人以为配好了 */
  if (f.overNodes.length && !f.amountThreshold) {
    throw Object.assign(new Error('配了金额分支节点，但阈值是 0，这套节点永远走不到'), { code: 42212 })
  }
  return { ...f }
}

/** 发起页 KPI：我这月提了多少、在途几单、平均多久批完 */
export function oaSummary() {
  const me = currentOperator()
  const mine = approvals.filter(a => a.applicant === me.name
    && OA_FORM_DEFS.some(f => f.bizType === a.bizType))
  const live = mine.filter(a => ['待审批', '审批中'].includes(a.status))
  return {
    total: mine.length,
    live: live.length,
    draft: 0,
    done: mine.filter(a => ['已通过', '已驳回', '已撤回'].includes(a.status)).length,
    types: new Set(mine.map(a => a.bizType)).size
  }
}

/** 提交前预览审批路径：申请人提交前要知道「会经过谁」，否则只能等结果 */
export function oaPreviewFlow(bizType, amount = 0) {
  const me = currentOperator()
  return oaNodesFor(bizType, amount).map(n => ({
    node: n.name,
    handler: _resolveAssignee(n, me) || '待指派',
    limitHours: n.limitHours || 24
  }))
}

/** 审批单里展示 formData：按表单定义给出 label + 值，页面不自己映射 */
export function oaFieldRows(approval) {
  const def = OA_FORM_DEFS.find(f => f.bizType === approval?.bizType)
  if (!def) return []
  return def.fields.map(f => {
    const raw = approval.formData?.[f.key]
    /* 明细不能直接塞进详情表：value 是数组，渲染出来会是 [object Object] */
    const value = f.type === 'items'
      ? (Array.isArray(raw) && raw.length
        ? `${raw.length} 项：${raw.slice(0, 3).map(r => r.name).join('、')}${raw.length > 3 ? ' 等' : ''} · 合计 ¥${oaItemsTotal(raw).toFixed(2)}`
        : '')
      : (raw ?? '')
    return { key: f.key, label: f.label, type: f.type, unit: f.unit || '', value, items: f.type === 'items' ? raw : undefined }
  }).filter(r => r.value !== '' && r.value !== null && r.value !== undefined)
}


/* ================= 收尾轮 · 第 2 批：催缴工作台 / 票据 / 装修押金台账 ================ */

/* ---------------- B1 欠费催缴工作台 ---------------- */

export const COLLECT_METHODS = ['短信', '电话', '上门', '律师函', '公告催缴']
export const COLLECT_STATUS = ['已发送', '已送达', '已承诺还款', '已还款', '联系无效']

/**
 * 欠费池：按房屋聚合账单（不按账单逐条催），取该房屋所有未结清账单
 * 口径与报表「未收费房屋」同源：isDebt(b) 且 unpaid > 0
 */
function debtPoolRows({ communityId = '', period = '', minDays = null, minAmount = null, kw = '' } = {}) {
  const map = new Map()
  for (const b of bills) {
    if (!isDebt(b)) continue
    if (communityId && b.communityId !== communityId) continue
    if (period && b.period !== period) continue
    const cur = map.get(b.houseId) || {
      houseId: b.houseId, houseName: houseName(b.houseId), communityId: b.communityId,
      communityName: communityName(b.communityId), ownerId: b.ownerId,
      ownerName: ownerName(b.ownerId), phone: _OWNER_OF.get(b.ownerId)?.phone || '',
      /* 催缴责任人 = 房屋楼管（P5 责任范围）：谁的楼栋谁跟，主管看汇总 */
      stewardEmpId: stewardOfHouse(b.houseId), stewardName: stewardNameOf(stewardOfHouse(b.houseId)),
      sum: 0, count: 0, maxDays: 0, periods: []
    }
    cur.sum = Math.round((cur.sum + (b.unpaid || 0)) * 100) / 100
    cur.count++
    cur.maxDays = Math.max(cur.maxDays, b.overdueDays || 0)
    if (!cur.periods.includes(b.period)) cur.periods.push(b.period)
    map.set(b.houseId, cur)
  }
  return [...map.values()]
    .filter(x => (minDays === null || x.maxDays >= minDays))
    .filter(x => (minAmount === null || x.sum >= minAmount))
    .filter(x => !kw || `${x.houseName}${x.ownerName}${x.phone}`.includes(kw))
    .sort((a, b) => b.maxDays - a.maxDays || b.sum - a.sum)
}

export function queryDebtPool({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => paged(scopeFilter(debtPoolRows(filters), { house: r => r.houseId }), pageNo, size))
}

/** 催缴工作台概览：欠费户数 / 金额 / 账龄分布 / 已催缴覆盖率 */
export function collectionSummary() {
  const pool = scopeFilter(debtPoolRows(), { house: r => r.houseId })
  const done = new Set(collectionRecords.map(r => r.houseId))
  const buckets = [
    { label: '1–30 天', n: 0, amt: 0 }, { label: '31–90 天', n: 0, amt: 0 },
    { label: '91–180 天', n: 0, amt: 0 }, { label: '180 天以上', n: 0, amt: 0 }
  ]
  for (const x of pool) {
    const i = x.maxDays <= 30 ? 0 : (x.maxDays <= 90 ? 1 : (x.maxDays <= 180 ? 2 : 3))
    buckets[i].n++; buckets[i].amt += x.sum
  }
  return {
    houseCount: pool.length,
    amount: Math.round(pool.reduce((s, x) => s + x.sum, 0) * 100) / 100,
    billCount: pool.reduce((s, x) => s + x.count, 0),
    covered: pool.filter(x => done.has(x.houseId)).length,
    recordCount: collectionRecords.length,
    buckets
  }
}

export function queryCollectionRecords({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const { houseId = '', method = '', status = '', batchNo = '', kw = '' } = filters
    const list = collectionRecords.filter(r =>
      (!houseId || r.houseId === houseId) &&
      (!method || r.method === method) &&
      (!status || r.status === status) &&
      (!batchNo || r.batchNo === batchNo) &&
      (!kw || `${r.houseName}${r.ownerName}${r.phone}${r.batchNo}`.includes(kw))
    )
    return paged(list, pageNo, size)
  })
}

let CR_SEQ = collectionRecords.length
let BATCH_SEQ = 3                                  // 种子已生成 1–3 轮
/** 生成催缴单：按勾选房屋批量创建催缴记录（内存态） */
export function createCollection({ houseIds = [], method = '短信', note = '' } = {}) {
  if (!houseIds.length) throw new Error('请先勾选需要催缴的房屋')
  const pool = debtPoolRows()
  const picked = pool.filter(x => houseIds.includes(x.houseId))
  if (!picked.length) throw new Error('所选房屋均已结清，无需催缴')
  BATCH_SEQ += 1
  const batchNo = 'CJ' + new Date().getFullYear() + String(BATCH_SEQ).padStart(2, '0')
  const time = _now()
  const created = []
  for (const p of picked) {
    CR_SEQ += 1
    const rec = {
      recordId: 'CR' + String(CR_SEQ).padStart(5, '0'),
      batchNo, round: BATCH_SEQ, billId: '', period: p.periods.slice().sort().reverse()[0] || '',
      communityId: p.communityId, communityName: p.communityName,
      houseId: p.houseId, houseName: p.houseName, ownerId: p.ownerId, ownerName: p.ownerName,
      phone: p.phone, itemName: '物业服务费等', amount: p.sum, overdueDays: p.maxDays,
      method, status: '已发送', operator: '当前登录人', collectTime: time,
      promiseDate: null, remark: note || '批量生成催缴单', _isNew: true
    }
    collectionRecords.unshift(rec)
    created.push(rec)
  }
  return { batchNo, count: created.length, amount: Math.round(created.reduce((s, r) => s + r.amount, 0) * 100) / 100, records: created }
}

/* ---------------- B2 发票与收据 ---------------- */

export const INVOICE_TYPES = ['电子发票', '增值税普通发票', '收据']

export function queryInvoices({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const { type = '', status = '', communityId = '', kw = '' } = filters
    const list = invoices.filter(v =>
      (!type || v.type === type) &&
      (!status || v.status === status) &&
      (!communityId || v.communityId === communityId) &&
      (!kw || `${v.invoiceNo}${v.ownerName}${v.houseName}${v.payId}`.includes(kw))
    )
    return paged(list, pageNo, size)
  })
}

export function invoiceSummary() {
  const issued = invoices.filter(v => v.status === '已开具')
  return {
    count: invoices.length,
    amount: Math.round(invoices.reduce((s, v) => s + v.amount, 0) * 100) / 100,
    tax: Math.round(invoices.reduce((s, v) => s + (v.taxAmount || 0), 0) * 100) / 100,
    redCount: invoices.filter(v => v.status === '已红冲').length,
    failCount: invoices.filter(v => v.status === '开具失败').length,
    receiptCount: invoices.filter(v => v.type === '收据').length,
    onlineRate: invoices.length ? Math.round(invoices.filter(v => v.channel === '线上自助').length / invoices.length * 1000) / 10 : 0,
    issuedAmount: Math.round(issued.reduce((s, v) => s + v.amount, 0) * 100) / 100
  }
}

let IV_SEQ = invoices.length
/**
 * 开票：单张或批量（内存态），并回写缴费流水的开票状态。
 *
 * 第 61 批接了「开票信息」与「费用项目」：
 *   - `profileId` 指定抬头档案。**不传就按房主兜底** —— 用户的口径是
 *     「默认开给房主，有租户信息时可切」，所以这里不能强制必填；
 *   - `itemName` 是票据上的项目名称，可以从字典选，也可以是手打的任意文字
 *     （控制不了的临时收费不该被字典卡住）；
 *   - 税率按**费用项目的默认税率**算，不再写死 6%。收据一律 0 ——
 *     收据不是发票，不产生税额，按 6% 算什么都不对。
 */
export function issueInvoice(payIds, types = '电子发票', opts = {}) {
  const ids = Array.isArray(payIds) ? payIds : [payIds]
  if (!ids.length) throw new Error('请先选择需要开票的收款记录')

  /* 一次可以两种都开：`issueInvoice(ids, ['收据', '电子发票'])`。
     收银台一次点击要出两张票，分两次调用会出现"收据开成功、发票失败"的半截状态 */
  const list = (Array.isArray(types) ? types : [types]).filter(t => INVOICE_TYPES.includes(t))
  if (!list.length) throw new Error(`票据类型只能是 ${INVOICE_TYPES.join(' / ')}`)

  const profileId = String(opts.profileId || '')
  const itemName = String(opts.itemName || '').trim()
  const buyerTitle = String(opts.buyerTitle || '').trim()
  const buyerTaxNo = String(opts.buyerTaxNo || '').trim()
  const prof = profileId ? INVOICE_PROFILES.find(x => x.profileId === profileId) : null
  if (profileId && !prof) throw _invErr('所选开票信息不存在（可能已被停用）', 40401)

  const created = []
  const skipped = []

  for (const pid of ids) {
    const p = payments.find(x => x.payId === pid)
    if (!p) { skipped.push(pid); continue }
    const bill = BILL_OF.get(p.billId)

    for (const type of list) {
      const isReceipt = type === '收据'
      /* 两个状态各自独立判：只开了收据的流水，发票仍然可以开 */
      const done = isReceipt
        ? (p.receiptStatus === '已开具')
        : (p.invoiceStatus === '已开票')
      if (done) { if (!skipped.includes(pid)) skipped.push(pid); continue }

      IV_SEQ += 1
      const amt = p.amount || 0
      /* 项目名取**这一笔的实际科目**，不再写死「物业服务费」 ——
         临时收费开出来写"物业服务费"是错的，账单开出来写"摆摊费"也是错的 */
      const name = itemName || bill?.itemName || p.tempItemName || '物业服务费'
      const item = invoiceItemOf(name)
      const rate = Number(item ? item.taxRate : 6)
      const cid = p.communityId || _HOUSE_CM.get(p.houseId) || bill?.communityId || 'P01'

      const inv = {
        invoiceId: 'IV' + String(IV_SEQ).padStart(6, '0'),
        invoiceNo: isReceipt ? 'SJ' + String(10000000 + IV_SEQ) : '0264' + String(10000000 + IV_SEQ),
        type,
        isReceipt,
        status: '已开具',
        payId: p.payId,
        billId: p.billId,
        tempChargeId: p.tempChargeId || '',
        communityId: cid,
        communityName: communityName(cid),
        houseId: p.houseId || '',
        houseName: p.houseId ? houseName(p.houseId) : '',
        ownerId: p.ownerId || '',
        ownerName: p.ownerId ? ownerName(p.ownerId) : (p.tempPartyName || ''),
        /* 购买方三档：手填 > 档案 > 房主。外来缴费人没有档案也没有房主，只能手填 */
        profileId: prof ? prof.profileId : '',
        buyerType: prof ? prof.titleType : (buyerTitle ? '个人' : '个人'),
        buyerTitle: prof ? prof.title : (buyerTitle || ownerName(p.ownerId) || p.tempPartyName || ''),
        buyerTaxNo: prof ? prof.taxNo : buyerTaxNo,
        itemName: name,
        amount: amt,
        /* 收据不产生税额 —— 它不是增值税扣税凭证 */
        taxAmount: isReceipt ? 0 : Math.round(amt * rate) / 100,
        taxRate: isReceipt ? 0 : rate,
        /* 收据要能追溯"这笔钱是怎么收的"，打印模板上要显示 */
        payMethodText: payMethodText(p),
        issueTime: _now(),
        issuer: currentOperator().name,
        channel: '前台开具',
        redReason: '', redTime: '', failReason: '', _isNew: true
      }
      invoices.unshift(inv)

      if (isReceipt) {
        p.receiptStatus = '已开具'
        p.receiptNo = inv.invoiceNo
      } else {
        p.invoiceStatus = '已开票'
        p.invoiceNo = inv.invoiceNo
      }
      _syncPayRow(p)
      created.push(inv)
    }
  }
  if (!created.length) {
    throw new Error(list.length > 1 ? '所选记录的收据与发票都已开具' : '所选记录已开过该票据或不存在')
  }
  return {
    created, skipped, count: created.length,
    receipts: created.filter(x => x.isReceipt),
    invoices: created.filter(x => !x.isReceipt)
  }
}

/**
 * 领取一笔流水已开的票据。收银台结果卡与流水详情都用它，
 * 免得两处各写一套「收据在不在、发票在不在」的判断。
 */
export function paymentTickets(payId) {
  const list = invoices.filter(x => x.payId === payId && x.status === '已开具')
  return {
    receipt: list.find(x => x.isReceipt || x.type === '收据') || null,
    invoice: list.find(x => !(x.isReceipt || x.type === '收据')) || null
  }
}

/**
 * 金额大写（收据上「合计人民币（大写）」那一栏）。
 * 收据不写大写是可以被财务打回的 —— 手写凭证的行业习惯，打印也一样。
 */
export function amountInWords(n) {
  const num = Math.round((Number(n) || 0) * 100)
  if (num === 0) return '零元整'
  const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
  const units = ['', '拾', '佰', '仟']
  const bigUnits = ['', '万', '亿', '万亿']
  const intPart = Math.floor(num / 100)
  const jiao = Math.floor(num / 10) % 10
  const fen = num % 10

  let out = ''
  if (intPart > 0) {
    const groups = []
    let rest = intPart
    while (rest > 0) { groups.push(rest % 10000); rest = Math.floor(rest / 10000) }
    for (let g = groups.length - 1; g >= 0; g--) {
      const seg = groups[g]
      let segText = ''
      let zero = false
      for (let i = 3; i >= 0; i--) {
        const d = Math.floor(seg / Math.pow(10, i)) % 10
        if (d === 0) { zero = true; continue }
        if (zero && segText) segText += '零'
        zero = false
        segText += digits[d] + units[i]
      }
      if (segText) out += segText + bigUnits[g]
      /* 中间整段为零（如 100000005）要补一个「零」，否则读成"壹亿伍元" */
      else if (out && g > 0) out += '零'
    }
    out = out.replace(/零+$/, '') + '元'
  }
  if (jiao === 0 && fen === 0) return out + '整'
  if (jiao === 0) return `${out}零${digits[fen]}分`
  if (fen === 0) return `${out}${digits[jiao]}角整`
  return `${out}${digits[jiao]}角${digits[fen]}分`
}

/** 红冲：必须填原因，红冲后流水回到「未开票」 */
export function redInvoice(invoiceId, reason = '') {
  const v = invoices.find(x => x.invoiceId === invoiceId)
  if (!v) throw new Error('票据不存在')
  if (v.status !== '已开具') throw new Error('只有「已开具」的票据可以红冲')
  if (!reason) throw new Error('请填写红冲原因')
  v.status = '已红冲'; v.redReason = reason
  v.redTime = _now().slice(0, 10)
  const p = payments.find(x => x.payId === v.payId)
  if (p) { p.invoiceStatus = '未开票'; p.invoiceNo = ''; _syncPayRow(p) }
  return v
}

/** 待开票：已收款但未开票的流水（开票页的默认数据源） */
export function pendingInvoiceRows({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const { kw = '', communityId = '' } = filters
    const list = payments
      .filter(p => p.invoiceStatus !== '已开票')
      .filter(p => !communityId || (_HOUSE_CM.get(p.houseId) || 'P01') === communityId)
      .filter(p => !kw || `${p.payId}${p.billId}${ownerName(p.ownerId)}${p.transNo}`.includes(kw))
      .map(p => {
        const cid = p.communityId || _HOUSE_CM.get(p.houseId) || 'P01'
        return {
          payId: p.payId, billId: p.billId, amount: p.amount, method: p.method,
          payTime: p.payTime, transNo: p.transNo, channel: p.channel,
          houseId: p.houseId || '', houseName: p.houseId ? houseName(p.houseId) : '',
          ownerId: p.ownerId || '',
          /* 临时收费没有业主，付款方是流水上的快照 */
          ownerName: p.ownerId ? ownerName(p.ownerId) : (p.tempPartyName || '外来缴费人'),
          isTemp: !!p.tempChargeId,
          tempPartyName: p.tempPartyName || '',
          itemName: (BILL_OF.get(p.billId) || {}).itemName || p.tempItemName || '',
          communityId: cid,
          communityName: communityName(cid),
          invoiceStatus: p.invoiceStatus || '未开票',
          /* 收据是独立状态：只开了收据的流水仍在这里（还差一张发票） */
          receiptStatus: p.receiptStatus || '未开具'
        }
      })
    return paged(list, pageNo, size)
  })
}

/* ==================================================================
 * B5 · 开票设置（2026-11-06 第 61 批）
 *
 * 三张表，解决三件不同的事：
 *   ① 开票信息（抬头档案）：抬头 / 税号 / 开户行 / 地址电话 / 联系人。
 *      **手动填写是常态**，能从业主或租户带出来只是省事 ——
 *      所以「带入」只预填表单，**不自动建档**。否则 682 个业主会变成
 *      682 条没人维护的档案，真正的常用抬头反而被淹没。
 *   ② 费用项目：票据上「项目名称」的词条。默认 5 项（摆摊费 / 场地租用 /
 *      赔偿款 / 押金 / 其他），**允许自由填写**（不入字典），也允许新增词条。
 *   ③ 票据模板：1 套通用版式 + 参数可调（纸张 / 边距 / 字号 / 份数 / 套打偏移）。
 *
 * 四条口径（后端实现时别丢）：
 *   · 档案存的是**抬头快照**。业主后来改名不回写档案 —— 票据一旦开出，
 *     抬头就不能变（税务要求）；改了档案会让"当时开的什么"说不清。
 *     要跟着改，页面上点「从来源重新带入」显式覆盖，并留痕。
 *   · **押金与赔偿款税率 0**：押金是代收不是收入（退还时冲回），
 *     赔偿款不征增值税。这不是可配项，是两个真实的税务口径，
 *     把它们和"其他"混成 6% 会让账做不平。
 *   · 模板只有 **1 套**：多套的代价是每张票据都要选版式，
 *     而现在只有一种纸（241×140 连续纸）。真出现第二种纸再加。
 *   · 票据上的金额要同时给**小写与大写**。大写不是装饰 ——
 *     手写票据时代沿下来的防篡改手段，财务退单最常挑的就是这一条。
 * ================================================================== */

export const INVOICE_SET_PERM = 'b.invoiceSet.edit'
export const canEditInvoiceSet = () => _hasPerm(INVOICE_SET_PERM)

const _invErr = (msg, code) => Object.assign(new Error(msg), { code })
const _invR2 = n => Math.round((Number(n) || 0) * 100) / 100

/* ---------------- ① 费用项目 ---------------- */

/**
 * 内置五项。`taxRate` 是默认税率，开票时可按单项覆盖 ——
 * 同一个"场地租用"，租会议室是 9%，租广告位可能按 6%，一刀切会出错。
 */
const INVOICE_ITEM_SPECS = [
  ['摆摊费', 6, '现代服务 · 其他现代服务', '外来摊贩按次 / 按天收取，与物业费无关'],
  ['场地租用', 9, '不动产经营租赁', '公共区域、大堂、车位的场地对外出租'],
  ['赔偿款', 0, '不征税项目', '损坏赔偿、违约金；不征增值税，开收据即可'],
  ['押金', 0, '代收款项', '装修 / 门禁卡押金；代收不确认收入，退还时冲回'],
  ['其他', 6, '现代服务 · 其他现代服务', '未列明的临时收费，开票时写清具体事由']
]

const INVOICE_ITEMS = []
let INV_ITEM_SEQ = 0
function _invItemSeed(name, taxRate, taxClass, remark) {
  INV_ITEM_SEQ += 1
  const rec = {
    itemId: 'II' + String(INV_ITEM_SEQ).padStart(2, '0'),
    name, taxRate: Number(taxRate) || 0, taxClass,
    builtin: true, enabled: true, sort: INV_ITEM_SEQ * 10,
    remark, createdAt: '2026-01-01 00:00', updatedAt: '2026-01-01 00:00'
  }
  INVOICE_ITEMS.push(rec)
  return rec
}
for (const [n, r, c, m] of INVOICE_ITEM_SPECS) _invItemSeed(n, r, c, m)

/** 被多少张票据用过（改名不回写历史票据，所以按名称统计，按 itemId 会统计成 0） */
const _invItemUsage = () => {
  const m = new Map()
  for (const v of invoices) m.set(v.itemName, (m.get(v.itemName) || 0) + 1)
  return m
}

/** 费用项目列表：选择弹层只要启用中的；维护页传 includeDisabled */
export function invoiceItemRows({ kw = '', includeDisabled = true } = {}) {
  const use = _invItemUsage()
  return INVOICE_ITEMS
    .filter(i => includeDisabled || i.enabled)
    .filter(i => !kw || `${i.name}${i.taxClass}`.includes(kw))
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(i => ({ ...i, usageCount: use.get(i.name) || 0 }))
}

export const invoiceItemOpts = () => invoiceItemRows({ includeDisabled: false })
  .map(i => ({ value: i.name, label: i.name, taxRate: i.taxRate, taxClass: i.taxClass }))

export const invoiceItemOf = name => INVOICE_ITEMS.find(i => i.name === name) || null

/**
 * 开票项目名的**全部**候选：收费科目在前，费用项目在后。
 *
 * 为什么要把两个表合起来：账单开票的项目名是「物业服务费 / 水费」这类**收费科目**，
 * 而第 61 批加的「摆摊费 / 场地租用」是**临时收费**的项目。只给后者，
 * 物业费开票时默认值"物业服务费"不在选项里，看着像数据错了。
 * 去重按名称（同名取科目那条，税率以科目为准）。
 */
export const invoiceItemNameOpts = () => {
  const out = []
  const seen = new Set()
  for (const f of feeItems) {
    if (!f.name || seen.has(f.name)) continue
    seen.add(f.name)
    out.push({ value: f.name, label: f.name, taxRate: Number(f.taxRate) || 0, taxClass: f.category || '', from: 'fee' })
  }
  for (const i of INVOICE_ITEMS.filter(x => x.enabled)) {
    if (seen.has(i.name)) continue
    seen.add(i.name)
    out.push({ value: i.name, label: i.name, taxRate: i.taxRate, taxClass: i.taxClass, from: 'item' })
  }
  return out
}

export function saveInvoiceItem({ itemId = '', name = '', taxRate = 6, taxClass = '', remark = '', enabled = true } = {}) {
  assertPerm(INVOICE_SET_PERM, `维护费用项目需要「开票设置」操作权限（${INVOICE_SET_PERM}）`)
  const n = String(name || '').trim()
  if (!n) throw _invErr('项目名称不能为空')
  if (n.length > 20) throw _invErr('项目名称不超过 20 字（票据上放不下）')
  const rate = Number(taxRate)
  if (![0, 3, 5, 6, 9, 13].includes(rate)) {
    throw _invErr(`税率只能是 0 / 3 / 5 / 6 / 9 / 13，当前填的是 ${taxRate}`)
  }
  const dup = INVOICE_ITEMS.find(i => i.name === n && i.itemId !== itemId)
  if (dup) throw _invErr(`费用项目「${n}」已经存在`, 40902)

  const t = _now()
  if (itemId) {
    const it = INVOICE_ITEMS.find(i => i.itemId === itemId)
    if (!it) throw _invErr('费用项目不存在', 40401)
    /* 内置项可以改名，但改完就不再是"摆摊费"了 —— 允许，因为业务口径会变；
       只禁止删除（历史票据要靠名称追） */
    Object.assign(it, { name: n, taxRate: rate, taxClass: String(taxClass || '').trim(), remark: String(remark || '').trim(), enabled: !!enabled, updatedAt: t })
    return { ...it, usageCount: _invItemUsage().get(it.name) || 0 }
  }
  INV_ITEM_SEQ += 1
  const rec = {
    itemId: 'II' + String(INV_ITEM_SEQ).padStart(2, '0'),
    name: n, taxRate: rate, taxClass: String(taxClass || '').trim(),
    remark: String(remark || '').trim(), builtin: false, enabled: !!enabled,
    sort: INVOICE_ITEMS.reduce((m, i) => Math.max(m, i.sort || 0), 0) + 10,
    createdAt: t, updatedAt: t
  }
  INVOICE_ITEMS.push(rec)
  return { ...rec, usageCount: 0 }
}

/** 停用不删除：历史票据上写的是名称，删了以后"这个项目还在不在字典里"就查不清了 */
export function toggleInvoiceItem(itemId, enabled) {
  assertPerm(INVOICE_SET_PERM, `维护费用项目需要「开票设置」操作权限（${INVOICE_SET_PERM}）`)
  const it = INVOICE_ITEMS.find(i => i.itemId === itemId)
  if (!it) throw _invErr('费用项目不存在', 40401)
  const used = _invItemUsage().get(it.name) || 0
  if (!enabled && used > 0 && it.builtin) {
    throw _invErr(`「${it.name}」已被 ${used} 张票据使用，内置项目不能停用`, 40927)
  }
  it.enabled = !!enabled
  it.updatedAt = _now()
  return { ...it, usageCount: used }
}

/* ---------------- ② 开票信息（抬头档案） ---------------- */

export const INVOICE_TITLE_TYPES = ['个人', '企业']
export const INVOICE_SOURCES = ['手动', '业主', '租户']

const INVOICE_PROFILES = []
let INV_PROFILE_SEQ = 0

const _invProfileNo = () => 'IP' + String(INV_PROFILE_SEQ).padStart(4, '0')

/** 税号校验：企业必须 15–20 位（统一社会信用代码固定 18 位）；个人可空 */
const _taxNoOk = v => /^[0-9A-Z]{15,20}$/.test(String(v || '').trim())

function _invProfileSeed(p) {
  INV_PROFILE_SEQ += 1
  const rec = {
    profileId: _invProfileNo(),
    titleType: p.titleType || '个人',
    title: p.title,
    taxNo: p.taxNo || '',
    bankName: p.bankName || '',
    bankAccount: p.bankAccount || '',
    regAddress: p.regAddress || '',
    regPhone: p.regPhone || '',
    contactName: p.contactName || '',
    contactPhone: p.contactPhone || '',
    contactEmail: p.contactEmail || '',
    sourceType: p.sourceType || '手动',
    sourceId: p.sourceId || '',
    sourceName: p.sourceName || '',
    houseId: p.houseId || '',
    isDefault: !!p.isDefault,
    enabled: true,
    remark: p.remark || '',
    createdAt: p.createdAt || '2026-10-12 10:00',
    updatedAt: p.updatedAt || '2026-10-12 10:00',
    createdBy: p.createdBy || '财务部'
  }
  INVOICE_PROFILES.push(rec)
  return rec
}

export function invoiceProfileRows({ kw = '', titleType = '', sourceType = '', enabled = null } = {}) {
  const use = _invProfileUsage()
  return INVOICE_PROFILES
    .filter(p => (enabled === null || enabled === '' ? true : p.enabled === enabled))
    .filter(p => !titleType || p.titleType === titleType)
    .filter(p => !sourceType || p.sourceType === sourceType)
    .filter(p => !kw || `${p.title}${p.taxNo}${p.contactName}${p.contactPhone}${p.sourceName}`.includes(kw))
    .slice()
    .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || String(a.title).localeCompare(String(b.title), 'zh'))
    .map(p => ({ ...p, usageCount: use.get(p.profileId) || 0 }))
}

const _invProfileUsage = () => {
  const m = new Map()
  for (const v of invoices) if (v.profileId) m.set(v.profileId, (m.get(v.profileId) || 0) + 1)
  return m
}

export const invoiceProfileOf = id => {
  const p = INVOICE_PROFILES.find(x => x.profileId === id)
  return p ? { ...p, usageCount: _invProfileUsage().get(id) || 0 } : null
}

export function invoiceProfileStats() {
  return {
    total: INVOICE_PROFILES.length,
    personal: INVOICE_PROFILES.filter(p => p.titleType === '个人').length,
    company: INVOICE_PROFILES.filter(p => p.titleType === '企业').length,
    manual: INVOICE_PROFILES.filter(p => p.sourceType === '手动').length,
    fromOwner: INVOICE_PROFILES.filter(p => p.sourceType === '业主').length,
    fromTenant: INVOICE_PROFILES.filter(p => p.sourceType === '租户').length,
    disabled: INVOICE_PROFILES.filter(p => !p.enabled).length
  }
}

/**
 * 从业主带入 → 返回**草稿**，不落库。
 * 个人抬头不需要税号；身份证号也不当税号用（个人开票凭姓名即可），
 * 所以这里只带姓名和手机，税号留空让人自己决定填不填。
 */
export function invoiceProfileFromOwner(ownerId) {
  const o = owners.find(x => x.ownerId === ownerId)
  if (!o) throw _invErr('业主不存在', 40401)
  const h = houses.find(x => x.ownerId === ownerId)
  return {
    profileId: '', titleType: '个人', title: o.name, taxNo: '',
    contactName: o.name, contactPhone: o.phone || '',
    contactEmail: o.email || '',
    sourceType: '业主', sourceId: o.ownerId, sourceName: o.name,
    houseId: h ? h.houseId : '',
    remark: `从业主档案带入（${o.ownerId}）`
  }
}

/**
 * 从租户带入 → 草稿。企业租户把已有的工商信息一起带出来
 * （名称 / 统一社会信用代码 / 注册地址），这些字段租户档案里本来就有，
 * 让人再抄一遍是最没道理的重复劳动。
 */
export function invoiceProfileFromTenant(tenantId) {
  const t = tenants.find(x => x.tenantId === tenantId)
  if (!t) throw _invErr('租户不存在', 40401)
  const isCompany = t.tenantType === '公司' || !!t.creditCode
  if (isCompany) {
    return {
      profileId: '', titleType: '企业',
      title: t.companyName || t.name,
      taxNo: t.creditCode || '',
      regAddress: t.regAddress || '',
      regPhone: t.phone || '',
      contactName: t.agentName || t.legalPerson || t.name,
      contactPhone: t.agentPhone || t.legalPersonPhone || t.phone || '',
      contactEmail: '',
      sourceType: '租户', sourceId: t.tenantId, sourceName: t.companyName || t.name,
      houseId: t.houseId || '',
      remark: `从企业租户档案带入（${t.tenantId}）`
    }
  }
  return {
    profileId: '', titleType: '个人', title: t.name, taxNo: '',
    contactName: t.name, contactPhone: t.phone || '', contactEmail: '',
    sourceType: '租户', sourceId: t.tenantId, sourceName: t.name,
    houseId: t.houseId || '',
    remark: `从租户档案带入（${t.tenantId}）`
  }
}

/**
 * 某个房屋的开票信息候选：业主的在前，在住租户在后。
 * 收银台开票时默认选第一条 —— 用户的原话是「默认开给房主，
 * 有租户信息时可切」，所以顺序就是优先级。
 *//** 带入用的人选：业主 682 人只回前 50（下拉里翻 682 条没人受得了），关键字可缩小 */
export const invoiceOwnerOpts = (kw = '') => {
  const k = String(kw || '').trim()
  const list = k ? owners.filter(o => `${o.name}${o.phone}`.includes(k)) : owners
  return list.slice(0, 50).map(o => {
    const h = houses.find(x => x.ownerId === o.ownerId)
    return {
      value: o.ownerId, label: o.name, phone: o.phone,
      houseName: h ? h.fullName : '',
      /* 临时收费建单要按房屋带出项目，靠名字匹配项目名太脆（楼栋命名一改就断） */
      houseId: h ? h.houseId : '', communityId: h ? h.communityId : ''
    }
  })
}

/** 带入用的租户：只在住（搬走的人不会再开票） */
export const invoiceTenantOpts = (kw = '') => {
  const k = String(kw || '').trim()
  return tenants
    .filter(t => t.status === '在住')
    .filter(t => !k || `${t.name}${t.companyName || ''}${t.phone}`.includes(k))
    .slice(0, 50)
    .map(t => ({
      value: t.tenantId,
      label: t.tenantType === '公司' ? (t.companyName || t.name) : t.name,
      tenantType: t.tenantType,
      creditCode: t.creditCode || '',
      phone: t.phone,
      houseName: houses.find(x => x.houseId === t.houseId)?.fullName || '',
      houseId: t.houseId || '',
      communityId: HOUSE_COMMUNITY.get(t.houseId) || ''
    }))
}

export function invoiceProfilesOfHouse(houseId) {
  const h = houses.find(x => x.houseId === houseId)
  if (!h) return []
  const out = []
  const byOwner = INVOICE_PROFILES.filter(p => p.enabled && p.sourceType === '业主' && p.sourceId === h.ownerId)
  const ownerName = (owners.find(o => o.ownerId === h.ownerId) || {}).name || ''
  const tenantIds = tenants.filter(t => t.houseId === houseId && t.status === '在住').map(t => t.tenantId)
  const byTenant = INVOICE_PROFILES.filter(p => p.enabled && p.sourceType === '租户' && tenantIds.includes(p.sourceId))
  out.push(...byOwner.map(p => ({ ...p, roleLabel: '房主' })))
  out.push(...byTenant.map(p => ({ ...p, roleLabel: '租户' })))
  /* 没有档案时给一条"临时抬头"占位：直接手填，不拦人 */
  if (!out.length) {
    out.push({
      profileId: '', titleType: '个人', title: ownerName, taxNo: '',
      roleLabel: '房主', sourceType: '业主', sourceId: h.ownerId, _adhoc: true
    })
  }
  return out
}

export function saveInvoiceProfile(payload = {}) {
  assertPerm(INVOICE_SET_PERM, `维护开票信息需要「开票设置」操作权限（${INVOICE_SET_PERM}）`)
  const title = String(payload.title || '').trim()
  if (!title) throw _invErr('发票抬头不能为空')
  if (title.length > 60) throw _invErr('发票抬头不超过 60 字')
  const titleType = INVOICE_TITLE_TYPES.includes(payload.titleType) ? payload.titleType : '个人'
  const taxNo = String(payload.taxNo || '').trim().toUpperCase()
  if (titleType === '企业' && !taxNo) throw _invErr('企业抬头必须填纳税人识别号（开票要用）')
  if (taxNo && !_taxNoOk(taxNo)) throw _invErr('纳税人识别号应为 15–20 位数字或大写字母')
  const dup = INVOICE_PROFILES.find(p => p.title === title && p.taxNo === taxNo && p.profileId !== (payload.profileId || ''))
  if (dup) throw _invErr(`抬头「${title}」${taxNo ? `（${taxNo}）` : ''}已经存在`, 40902)

  const t = _now()
  const common = {
    titleType, title, taxNo,
    bankName: String(payload.bankName || '').trim(),
    bankAccount: String(payload.bankAccount || '').trim(),
    regAddress: String(payload.regAddress || '').trim(),
    regPhone: String(payload.regPhone || '').trim(),
    contactName: String(payload.contactName || '').trim(),
    contactPhone: String(payload.contactPhone || '').trim(),
    contactEmail: String(payload.contactEmail || '').trim(),
    sourceType: INVOICE_SOURCES.includes(payload.sourceType) ? payload.sourceType : '手动',
    sourceId: String(payload.sourceId || ''),
    sourceName: String(payload.sourceName || ''),
    houseId: String(payload.houseId || ''),
    enabled: payload.enabled !== false,
    remark: String(payload.remark || '').trim(),
    updatedAt: t
  }

  if (payload.profileId) {
    const p = INVOICE_PROFILES.find(x => x.profileId === payload.profileId)
    if (!p) throw _invErr('开票信息不存在', 40401)
    Object.assign(p, common)
    if (payload.isDefault) _setDefaultProfile(p.profileId)
    return { ...p, usageCount: _invProfileUsage().get(p.profileId) || 0 }
  }
  INV_PROFILE_SEQ += 1
  const rec = {
    profileId: _invProfileNo(), ...common,
    isDefault: !!payload.isDefault,
    createdAt: t, createdBy: '当前登录人'
  }
  INVOICE_PROFILES.push(rec)
  if (rec.isDefault) _setDefaultProfile(rec.profileId)
  return { ...rec, usageCount: 0 }
}

/** 默认抬头全库唯一：收银台"默认开给房主"要的是确定的一个，不能有并列 */
function _setDefaultProfile(profileId) {
  for (const p of INVOICE_PROFILES) p.isDefault = p.profileId === profileId
}

export function setDefaultInvoiceProfile(profileId) {
  assertPerm(INVOICE_SET_PERM, `维护开票信息需要「开票设置」操作权限（${INVOICE_SET_PERM}）`)
  const p = INVOICE_PROFILES.find(x => x.profileId === profileId)
  if (!p) throw _invErr('开票信息不存在', 40401)
  if (!p.enabled) throw _invErr('已停用的抬头不能设为默认', 40927)
  _setDefaultProfile(profileId)
  return invoiceProfileOf(profileId)
}

export function toggleInvoiceProfile(profileId, enabled) {
  assertPerm(INVOICE_SET_PERM, `维护开票信息需要「开票设置」操作权限（${INVOICE_SET_PERM}）`)
  const p = INVOICE_PROFILES.find(x => x.profileId === profileId)
  if (!p) throw _invErr('开票信息不存在', 40401)
  p.enabled = !!enabled
  p.updatedAt = _now()
  if (!p.enabled && p.isDefault) p.isDefault = false
  return invoiceProfileOf(profileId)
}

/** 从来源重新带入：显式覆盖，覆盖前把旧值留在 remark 里，事后能说清改了什么 */
export function refreshProfileFromSource(profileId) {
  assertPerm(INVOICE_SET_PERM, `维护开票信息需要「开票设置」操作权限（${INVOICE_SET_PERM}）`)
  const p = INVOICE_PROFILES.find(x => x.profileId === profileId)
  if (!p) throw _invErr('开票信息不存在', 40401)
  if (!p.sourceId || p.sourceType === '手动') throw _invErr('这条是手工填写的，没有可带入的来源', 40928)
  const draft = p.sourceType === '业主'
    ? invoiceProfileFromOwner(p.sourceId)
    : invoiceProfileFromTenant(p.sourceId)
  const before = p.title
  p.title = draft.title
  p.titleType = draft.titleType
  p.taxNo = draft.taxNo || p.taxNo
  p.contactName = draft.contactName || p.contactName
  p.contactPhone = draft.contactPhone || p.contactPhone
  p.regAddress = draft.regAddress || p.regAddress
  p.updatedAt = _now()
  return { ...invoiceProfileOf(profileId), _before: before }
}

/* ---------------- ③ 票据模板（1 套，参数可调） ---------------- */

export const INVOICE_TPL_DEFAULT = {
  tplId: 'IT01',
  name: '通用收款票据模板',
  title: '收 款 收 据',
  paper: { width: 241, height: 140 },
  margin: { top: 12, right: 10, bottom: 8, left: 10 },
  offset: { x: 0, y: 0 },
  font: { family: '宋体', size: 10, lineHeight: 1.7 },
  copies: 3,
  copyTitles: ['存根联', '客户联', '财务联'],
  showStub: true,
  showQr: false,
  footerLeft: '收款人：',
  footerRight: '复核：',
  note: '本收据仅作收款凭证，不作报销凭证。',
  updatedAt: '2026-11-01 09:00',
  updatedBy: '财务部'
}

let INVOICE_TPL = JSON.parse(JSON.stringify(INVOICE_TPL_DEFAULT))

export const invoiceTplGet = () => JSON.parse(JSON.stringify(INVOICE_TPL))

export const INVOICE_FONT_FAMILIES = ['宋体', '仿宋', '黑体', '楷体']
export const INVOICE_PAPER_PRESETS = [
  { name: '241 × 140（常见针打收据，三联）', width: 241, height: 140 },
  { name: '241 × 93（针打小票，单联）', width: 241, height: 93 },
  { name: '210 × 140（A5 横向）', width: 210, height: 140 },
  { name: 'A4（激光 / 喷墨）', width: 210, height: 297 }
]

export function invoiceTplCheck(patch = {}) {
  const errs = []
  const w = Number(patch.paper?.width)
  const h = Number(patch.paper?.height)
  if (!(w >= 100 && w <= 420)) errs.push('纸张宽度应在 100–420mm（241 是针打连续纸的标准宽）')
  if (!(h >= 60 && h <= 297)) errs.push('纸张高度应在 60–297mm')
  const m = patch.margin || {}
  for (const k of ['top', 'right', 'bottom', 'left']) {
    const v = Number(m[k])
    if (!(v >= 0 && v <= 60)) errs.push(`页边距「${k}」应在 0–60mm`)
  }
  if (Number(m.left) + Number(m.right) >= w - 40) errs.push('左右边距太大，内容区宽度不足 40mm')
  if (Number(m.top) + Number(m.bottom) >= h - 30) errs.push('上下边距太大，内容区高度不足 30mm')
  const size = Number(patch.font?.size)
  if (!(size >= 6 && size <= 16)) errs.push('字号应在 6–16pt（针打低于 6pt 会糊，高于 16pt 一页放不下）')
  const lh = Number(patch.font?.lineHeight)
  if (!(lh >= 1 && lh <= 3)) errs.push('行高倍数应在 1.0–3.0')
  const copies = Number(patch.copies)
  if (!(copies >= 1 && copies <= 4)) errs.push('联数应为 1–4（再多针打一次过不去）')
  if (!String(patch.title || '').trim()) errs.push('票据标题不能为空')
  if (!['宋体', '仿宋', '黑体', '楷体'].includes(patch.font?.family)) errs.push('字体只能选宋体 / 仿宋 / 黑体 / 楷体（针打自带字库就这几套）')
  return { ok: errs.length === 0, errs }
}

export function saveInvoiceTpl(patch = {}) {
  assertPerm(INVOICE_SET_PERM, `维护票据模板需要「开票设置」操作权限（${INVOICE_SET_PERM}）`)
  const draft = {
    ...invoiceTplGet(),
    ...patch,
    paper: { ...INVOICE_TPL.paper, ...(patch.paper || {}) },
    margin: { ...INVOICE_TPL.margin, ...(patch.margin || {}) },
    offset: { ...INVOICE_TPL.offset, ...(patch.offset || {}) },
    font: { ...INVOICE_TPL.font, ...(patch.font || {}) }
  }
  const chk = invoiceTplCheck(draft)
  if (!chk.ok) throw _invErr(`模板参数不合法：${chk.errs.join('；')}`, 42213)
  draft.copies = Number(draft.copies)
  draft.copyTitles = (draft.copyTitles || []).slice(0, draft.copies)
  while (draft.copyTitles.length < draft.copies) draft.copyTitles.push(`第 ${draft.copyTitles.length + 1} 联`)
  draft.updatedAt = _now()
  draft.updatedBy = '当前登录人'
  INVOICE_TPL = draft
  return invoiceTplGet()
}

export function resetInvoiceTpl() {
  assertPerm(INVOICE_SET_PERM, `维护票据模板需要「开票设置」操作权限（${INVOICE_SET_PERM}）`)
  INVOICE_TPL = JSON.parse(JSON.stringify(INVOICE_TPL_DEFAULT))
  INVOICE_TPL.updatedAt = _now()
  INVOICE_TPL.updatedBy = '当前登录人'
  return invoiceTplGet()
}

/* ---------------- 金额大写（票据上必须有） ---------------- */

const _RMB_D = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const _RMB_U = ['', '拾', '佰', '仟']
const _RMB_S = ['', '万', '亿', '万亿']

function _rmbSection(n) {
  let s = ''
  let zero = false
  for (let i = 3; i >= 0; i--) {
    const d = Math.floor(n / Math.pow(10, i)) % 10
    if (d === 0) {
      if (s) zero = true
    } else {
      if (zero) { s += '零'; zero = false }
      s += _RMB_D[d] + _RMB_U[i]
    }
  }
  return s
}

/** 金额转人民币大写：票据上小写与大写必须一致，财务退单最常挑这一条 */
export function rmbUpper(value) {
  const num = Math.round((Number(value) || 0) * 100)
  if (!Number.isFinite(num) || num < 0) return ''
  if (num === 0) return '零元整'
  const yuan = Math.floor(num / 100)
  const jiao = Math.floor((num % 100) / 10)
  const fen = num % 10

  let out = ''
  if (yuan > 0) {
    const secs = []
    let y = yuan
    while (y > 0) { secs.push(y % 10000); y = Math.floor(y / 10000) }
    for (let i = secs.length - 1; i >= 0; i--) {
      const sec = secs[i]
      if (sec === 0) {
        if (out && !out.endsWith('零')) out += '零'
        continue
      }
      if (out && !out.endsWith('零') && sec < 1000) out += '零'
      out += _rmbSection(sec) + _RMB_S[i]
    }
    out = out.replace(/零+$/, '') + '元'
  } else {
    out = '零元'
  }
  if (jiao === 0 && fen === 0) return out + '整'
  if (jiao > 0) out += _RMB_D[jiao] + '角'
  else out += '零'
  if (fen > 0) out += _RMB_D[fen] + '分'
  else out += '整'
  return out
}

/* ---------------- 种子 ---------------- */

/* 个人抬头：从真实业主里挑，来源记业主 id —— 演示"带入"后的档案长什么样 */
;(function _seedInvoiceProfiles() {
  const pickOwner = (idx) => owners[idx]
  const personal = [
    [pickOwner(3), true, '经常来前台开票，已存为默认'],
    [pickOwner(27), false, ''],
    [pickOwner(101), false, '']
  ]
  for (const [o, isDef, remark] of personal) {
    if (!o) continue
    const h = houses.find(x => x.ownerId === o.ownerId)
    _invProfileSeed({
      titleType: '个人', title: o.name,
      contactName: o.name, contactPhone: o.phone,
      sourceType: '业主', sourceId: o.ownerId, sourceName: o.name,
      houseId: h ? h.houseId : '', isDefault: !!isDef, remark
    })
  }

  /* 企业抬头：从真实企业租户带出工商信息 —— 名称/税号/注册地址本来就在档案里 */
  const companies = tenants.filter(t => t.tenantType === '公司' && t.creditCode).slice(0, 4)
  for (const t of companies) {
    _invProfileSeed({
      titleType: '企业', title: t.companyName || t.name,
      taxNo: t.creditCode, regAddress: t.regAddress, regPhone: t.phone,
      contactName: t.agentName || t.legalPerson || t.name,
      contactPhone: t.agentPhone || t.phone,
      sourceType: '租户', sourceId: t.tenantId, sourceName: t.companyName || t.name,
      houseId: t.houseId,
      remark: `企业承租，开票信息从租户档案带入`
    })
  }

  /* 纯手工档：临时收费遇到的单位，业主表里根本没有 */
  _invProfileSeed({
    titleType: '企业', title: '成都锦江夜市管理有限公司',
    taxNo: '91510104MA6C8X2K3P', regAddress: '成都市锦江区东大街 88 号',
    regPhone: '028-86661234',
    contactName: '刘敏', contactPhone: '13880001234',
    sourceType: '手动', remark: '摆摊费月结客户，与业主无关'
  })
  _invProfileSeed({
    titleType: '企业', title: '四川会展服务有限公司',
    taxNo: '91510100MA61YQ7N2B', regAddress: '成都市武侯区人民南路四段 1 号',
    contactName: '陈立', contactPhone: '13908012345',
    sourceType: '手动', remark: '场地租用，按次开票'
  })
  _invProfileSeed({
    titleType: '个人', title: '王秀兰', contactName: '王秀兰', contactPhone: '13550123456',
    sourceType: '手动', remark: '临时摊位个人缴费'
  })
})()

/* ---------------- B4 装修押金台账（写操作） ---------------- */

let DP_SEQ = decorationDeposits.length
/**
 * 登记押金（内存态）。
 * 2026-11-13 改为**按类型驱动**：只有 needDates 的类型（装修）才要求开工/计划完工，
 * 门禁卡、履约保证金、租约押金填工期没有意义 —— 之前表单把这三类也卡在"请填写开工日期"上。
 */
export function createDeposit(p = {}) {
  const h = _HOUSE_OF.get(p.houseId)
  if (!h) throw new Error('请选择押金所属房屋')
  const def = depositTypeOf(p.type || '装修押金')
  if (!def) throw new Error('押金类型不存在')
  if (!def.enabled) throw new Error(`押金类型「${def.name}」已停用，不能新收`)
  const ow = _OWNER_OF.get(p.ownerId || h.ownerId) || null

  const qty = Math.max(1, Number(p.quantity) || 1)
  const amount = def.standardAmount > 0
    ? Math.round(def.standardAmount * qty * 100) / 100
    : Math.round((Number(p.amount) || 0) * 100) / 100
  if (amount <= 0) throw new Error(def.standardAmount > 0 ? '押金金额必须大于 0' : `「${def.name}」金额不固定，请按合同/租约填写`)

  if (def.needDates) {
    if (!p.startDate || !p.planEndDate) throw new Error('该类型需要工期：请填写开工日期与计划完工日期')
    if (p.planEndDate <= p.startDate) throw new Error('计划完工日期必须晚于开工日期')
  }

  DP_SEQ += 1
  const prefix = { 装修押金: 'ZX', 门禁卡押金: 'MJ', 非机动车牌押金: 'CP', 履约保证金: 'LY', 租约押金: 'ZY' }[def.name] || 'YJ'
  const rec = {
    depositId: 'DP' + String(DP_SEQ).padStart(5, '0'),
    applyNo: prefix + new Date().getFullYear() + '-' + String(DP_SEQ).padStart(4, '0'),
    communityId: h.communityId, communityName: communityName(h.communityId),
    houseId: h.houseId, houseName: h.fullName,
    ownerId: ow?.ownerId || '', ownerName: ow?.name || p.ownerName || '',
    phone: ow?.phone || p.phone || '',
    type: def.name, quantity: def.byQuantity ? qty : 1, amount,
    paidDate: p.paidDate || _now().slice(0, 10),
    startDate: def.needDates ? p.startDate : '',
    planEndDate: def.needDates ? p.planEndDate : '',
    checkDate: null,
    /* 装修要开工，所以进「装修中」；其余类型收进来就是「在押」，不需要一个假的施工状态 */
    status: def.needDates ? '装修中' : '在押',
    deductAmount: 0, deductReason: '',
    refundAmount: 0, refundDate: null, balance: amount, overdueDays: 0,
    operator: p.operator || '当前登录人', remark: p.remark || '', _isNew: true
  }
  decorationDeposits.unshift(rec)
  track('deposit_create', { type: def.name, amount })
  return rec
}

/** 验收：填验收日与扣款金额 / 原因；扣款不得超过押金总额 */
export function checkDeposit(depositId, { checkDate = '', deductAmount = 0, deductReason = '' } = {}) {
  const d = decorationDeposits.find(x => x.depositId === depositId)
  if (!d) throw new Error('押金记录不存在')
  const def = depositTypeOf(d.type)
  if (def && !def.needCheck) throw new Error(`「${d.type}」不需要验收：退卡/退牌时直接办理退款即可`)
  if (!['装修中', '已逾期', '在押'].includes(d.status)) throw new Error(`当前状态「${d.status}」不能验收`)
  if (!checkDate) throw new Error('请填写验收日期')
  const deduct = Number(deductAmount) || 0
  if (deduct < 0 || deduct > d.amount) throw new Error('扣款金额不得为负且不得超过押金总额')
  if (deduct > 0 && !deductReason) throw new Error('有扣款时必须填写扣款原因')
  d.checkDate = checkDate
  d.deductAmount = Math.round(deduct * 100) / 100
  d.deductReason = deduct ? deductReason : ''
  // 验收通过不等于钱已退：无扣款时进入「待退款」，由退款动作最终置「已退还」
  d.status = deduct >= d.amount ? '已没收' : (deduct > 0 ? '部分扣除' : '待退款')
  d.overdueDays = d.planEndDate && checkDate > d.planEndDate
    ? Math.round((new Date(checkDate) - new Date(d.planEndDate)) / 86400000) : 0
  return d
}

/** 退款：验收通过后退余额（可部分退），退完置「已退还」 */
export function refundDeposit(depositId, { refundAmount = null, refundDate = '' } = {}) {
  const d = decorationDeposits.find(x => x.depositId === depositId)
  if (!d) throw new Error('押金记录不存在')
  const def = depositTypeOf(d.type)
  /* 只有"需要验收"的类型才卡验收：门禁卡、车牌退卡即退，
     硬卡一道"请先验收"会让前台每退一张卡都得造一条验收记录 */
  if ((!def || def.needCheck) && !d.checkDate) throw new Error('请先完成验收')
  const can = Math.round((d.amount - d.deductAmount - d.refundAmount) * 100) / 100
  if (can <= 0) throw new Error('该押金已无余额可退')
  const amt = refundAmount === null ? can : Number(refundAmount)
  if (amt <= 0 || amt > can) throw new Error(`退款金额应在 0 ~ ${can} 之间`)
  if (def && def.allowPartial === false && Math.abs(amt - can) > 0.01) {
    throw new Error(`「${d.type}」不支持部分退：应一次退清 ¥${can}`)
  }
  d.refundAmount = Math.round((d.refundAmount + amt) * 100) / 100
  d.balance = Math.round((d.amount - d.refundAmount - d.deductAmount) * 100) / 100
  d.refundDate = refundDate || _now().slice(0, 10)
  if (d.balance <= 0) d.status = d.deductAmount > 0 ? '部分扣除' : '已退还'
  return d
}

/** 装修押金详情（抽屉用） */
export function getDepositDetail(depositId) {
  return delay(() => {
    const d = decorationDeposits.find(x => x.depositId === depositId)
    if (!d) return null
    const bills_ = bills.filter(b => b.houseId === d.houseId).slice(0, 5)
    return {
      ...d,
      refundable: Math.round((d.amount - d.deductAmount - d.refundAmount) * 100) / 100,
      timeline: [
        { title: '收取押金', time: d.paidDate, memo: `¥${d.amount} · ${d.operator}`, done: true },
        { title: '开工', time: d.startDate, memo: `计划完工 ${d.planEndDate}`, done: true },
        { title: '验收', time: d.checkDate || '', memo: d.checkDate ? (d.deductAmount ? `扣款 ¥${d.deductAmount} · ${d.deductReason}` : '验收通过') : '待验收', done: !!d.checkDate },
        { title: '退款', time: d.refundDate || '', memo: d.refundDate ? `¥${d.refundAmount}` : '待退款', done: !!d.refundDate }
      ],
      recentBills: bills_
    }
  })
}

/* ================= 收尾轮 · 第 3 批：抄表公摊 / 考勤 / 系统配置 / 导入向导 ============= */

/* ---------------- B3 抄表与公摊 ---------------- */

export const METER_STATUS = ['正常', '故障', '已停用']
export const READING_STATUS = ['待录入', '待复核', '已计费']
export const METER_PERIODS = () => [...new Set(meterReadings.map(r => r.period))].sort().reverse()

export function queryMeterReadings({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const { communityId = '', period = '', type = '', status = '', abnormal = '', kw = '' } = filters
    const list = meterReadings.filter(r =>
      (!communityId || r.communityId === communityId) &&
      (!period || r.period === period) &&
      (!type || r.type === type) &&
      (!status || r.status === status) &&
      (!abnormal || (abnormal === 'yes' ? r.abnormal : !r.abnormal)) &&
      (!kw || `${r.houseName}${r.meterNo}${r.ownerName}`.includes(kw))
    )
    return paged(list, pageNo, size)
  })
}

export function meterSummary(period = METER_PERIODS()[0]) {
  const list = meterReadings.filter(r => r.period === period)
  const water = list.filter(r => r.type === '水表')
  const elec = list.filter(r => r.type === '电表')
  const sum = l => Math.round(l.reduce((s, r) => s + (r.usage || 0), 0) * 100) / 100
  return {
    period,
    meterCount: new Set(list.map(r => r.meterId)).size,
    readingCount: list.length,
    pending: list.filter(r => r.status === '待录入').length,
    review: list.filter(r => r.status === '待复核').length,
    billed: list.filter(r => r.status === '已计费').length,
    abnormal: list.filter(r => r.abnormal).length,
    waterUsage: sum(water), elecUsage: sum(elec)
  }
}

/** 录入 / 修改抄表读数：自动算用量；与上次相比波动超阈值标异常 */
/** 表具量程上限（超出即为录入错误，拒绝保存） */
export const METER_CAP = { 水表: 99999, 电表: 999999 }

export function saveReading(readingId, currentReading) {
  const r = meterReadings.find(x => x.readingId === readingId)
  if (!r) throw new Error('抄表记录不存在')
  const cur = Number(currentReading)
  if (Number.isNaN(cur)) throw new Error('请输入有效的本期读数')
  if (cur < r.lastReading) throw new Error(`本期读数不得小于上期读数（${r.lastReading}）`)
  const cap = METER_CAP[r.type] || 99999
  if (cur > cap) throw new Error(`本期读数超出${r.type}量程（上限 ${cap}），请核对后重新录入`)
  r.currentReading = cur
  r.usage = Math.round((cur - r.lastReading) * 100) / 100
  r.status = '待复核'
  r.reader = '当前登录人'
  r.abnormal = r.usage > (r.type === '电表' ? 330 : 24)
  return r
}

/** 批量复核：通过的置「已计费」 */
export function approveReadings(ids) {
  const list = meterReadings.filter(r => ids.includes(r.readingId))
  if (!list.length) throw new Error('请先选择需要复核的记录')
  for (const r of list) if (r.status === '待复核') r.status = '已计费'
  return list.length
}

/**
 * 公摊计算：按「项目 × 账期」把公共用量的差额分摊到户
 * 口径：公摊量 = 总表用量 - 分户用量合计（差量为管线损耗与公共区域用电，按建筑面积分摊）
 */
export function computeShare({ communityId = '', period = METER_PERIODS()[0] } = {}) {
  // 口径：水、电分别归集，再合并分摊（单位不同，不能相加）
  //   公共用量 = 分户合计 × 8%（管线损耗 + 公共区域），为演示固定系数；正式实现应取总表与分表的实际差额
  const rs = meterReadings.filter(r => r.period === period && (!communityId || r.communityId === communityId))
  const hs = houses.filter(h => !communityId || h.communityId === communityId)
  const areaTotal = hs.reduce((s, h) => s + (h.area || 0), 0)
  const waterUsage = Math.round(rs.filter(r => r.type === '水表').reduce((s, r) => s + (r.usage || 0), 0) * 100) / 100
  const elecUsage = Math.round(rs.filter(r => r.type === '电表').reduce((s, r) => s + (r.usage || 0), 0) * 100) / 100
  const priceWater = 0.62                                   // 元/吨，与 feeItems 水费一致
  const priceElec = 0.68                                    // 元/度，与 feeItems 电费一致
  const pubWater = Math.round(waterUsage * 0.08 * 100) / 100
  const pubElec = Math.round(elecUsage * 0.08 * 100) / 100
  const amtWater = Math.round(pubWater * priceWater * 100) / 100
  const amtElec = Math.round(pubElec * priceElec * 100) / 100
  const rows = hs.map(h => {
    const share = areaTotal ? h.area / areaTotal : 0
    return {
      houseId: h.houseId, houseName: h.fullName, communityId: h.communityId,
      communityName: communityName(h.communityId), area: h.area,
      shareRate: Math.round(share * 10000) / 100,
      shareWater: Math.round(pubWater * share * 100) / 100,
      shareElec: Math.round(pubElec * share * 100) / 100,
      shareAmount: Math.round((amtWater + amtElec) * share * 100) / 100
    }
  }).sort((a, b) => b.shareAmount - a.shareAmount)
  const publicAmount = Math.round(rows.reduce((s, r) => s + r.shareAmount, 0) * 100) / 100
  return {
    period, communityId, meterCount: rs.length,
    waterUsage, elecUsage, pubWater, pubElec, priceWater, priceElec,
    amtWater, amtElec, publicAmount, areaTotal, houseCount: hs.length, rows
  }
}

let BILL_SEQ_SHARE = 0
let PAY_SEQ = payments.reduce((m, p) => Math.max(m, +String(p.payId).replace(/\D/g, '') || 0), 0)
/** 生成公摊账单（内存态）：按分摊结果写入 bills，科目为「公共能耗分摊」 */
export function generateShareBills({ communityId = '', period = METER_PERIODS()[0] } = {}) {
  const calc = computeShare({ communityId, period })
  if (!calc.rows.length) throw new Error('没有可生成账单的房屋')
  let n = 0
  for (const r of calc.rows) {
    if (r.shareAmount <= 0) continue
    BILL_SEQ_SHARE += 1
    bills.push({
      billId: 'BL-SH' + String(BILL_SEQ_SHARE).padStart(6, '0'),
      period, status: '未缴', paidAmount: 0, payTime: '', payMethod: '', invoiceNo: '',
      lateFee: 0, discount: 0, communityId: r.communityId, houseId: r.houseId,
      ownerId: (houses.find(h => h.houseId === r.houseId) || {}).ownerId || '',
      // 科目 ID 必须按名称反查：硬编码曾把公摊账挂到 FI07（车位管理服务费）名下，
      // 导致「收费科目」报表把 736 笔公摊账算进车位费，公共能耗分摊反而为零
      itemId: (feeItems.find(i => i.name === '公共能耗分摊') || {}).itemId || 'FI03',
      itemName: '公共能耗分摊', amount: r.shareAmount,
      quantity: Math.round((r.shareWater + r.shareElec) * 100) / 100,
      price: calc.priceWater, unit: '吨/度',
      // 分摊构成：便于账单详情回溯水、电各自用量
      shareWater: r.shareWater, shareElec: r.shareElec, shareRate: r.shareRate,
      createTime: _now().slice(0, 10), dueDate: _now().slice(0, 10),
      payable: r.shareAmount, unpaid: r.shareAmount, overdueDays: 0, _isNew: true
    })
    n++
  }
  if (!n) throw new Error('分摊金额为 0，未生成账单')
  // bills 与 BILL_ROWS 是两份数据：只 push 原数组会让账单列表页看不到刚生成的账单
  for (const b of bills) if (b._isNew) { _syncBillRow(b, { insert: true }); delete b._isNew }
  return { count: n, amount: Math.round(calc.rows.reduce((s, r) => s + r.shareAmount, 0) * 100) / 100, period }
}

/* ==================================================================
 * 批 3 · 抄表推单（2026-11-13）
 * ------------------------------------------------------------
 * 原来「复核通过」只是把状态改成「已计费」—— 没有账单、没有金额、没有应收，
 * 等于表抄了一堆、钱一分没收。这里把最后一段接上：
 *   读数（已复核）→ 用量 × 业态价 → 水电账单 → 业主缴费 → 进收入与日结
 *
 * 三类项目模式必须分开，混着推会出两类错账：
 *   meter 抄表 → 系统出账（本函数）
 *   card  插卡 → 物业代充，业主先买量，本来就没有账单
 *   none  自缴 → 国网/水司直收，系统只留用量
 * 对 card / none 的项目推单，等于凭空给业主开一张不该缴的账单。
 *
 * 单价走 utilityPriceOf（按业态取价），不用 feeItems 上的 4.2 / 0.62 ——
 * 那两个数字是"住宅参考价"，拿它给商业户出账，每户每月都少收。
 * ================================================================ */

const METER_ITEM_ID = { 电表: 'FI06', 水表: 'FI05' }
const UTIL_MODE_TEXT = { meter: '抄表出账', card: '物业代充（插卡买量）', none: '业主自缴（系统不收费）' }

const _mR2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
/** 账期次月 10 日为缴费截止：抄表在月初，给业主 10 天 */
const _dueDateOf = period => {
  const [y, m] = String(period).split('-').map(Number)
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-10`
}

/**
 * 推单预览：每条读数能不能出账、出多少钱、为什么不能出。
 * 页面拿它渲染表格，也拿 blocking 决定「生成账单」按钮是否可用。
 */
export function meterBillPreview({ period = METER_PERIODS()[0], communityId = '' } = {}) {
  const rs = meterReadings.filter(r => r.period === period && (!communityId || r.communityId === communityId))
  const rows = rs.map(r => {
    const mode = communityUtilityOf(r.communityId)[r.type === '电表' ? 'elec' : 'water']
    let price = 0
    let priceErr = ''
    if (mode === 'meter') {
      try { price = utilityPriceOf(r.houseId, r.type).price } catch (e) { priceErr = e.message }
    }
    const usage = Number(r.usage) || 0
    const amount = price > 0 ? _mR2(usage * price) : 0

    /* blocking = 必须解决才能出账；info = 只是说明为什么这行不出账 */
    const blocking = []
    if (mode === 'meter') {
      if (r.status === '待录入') blocking.push('未抄表')
      else if (r.status === '待复核') blocking.push('待复核')
      if (!price) blocking.push(priceErr || '该项目没有对应的水电价')
    }
    const info = []
    if (mode !== 'meter') info.push(UTIL_MODE_TEXT[mode])
    if (r.billId) info.push(`已推单 ${r.billId}`)
    if (mode === 'meter' && !r.billId && usage <= 0) info.push('用量为 0，不出账')

    const billable = mode === 'meter' && !r.billId && usage > 0 && blocking.length === 0
    return { ...r, mode, price, amount, billable, blocking, info }
  })

  const billable = rows.filter(r => r.billable)
  const sumOf = list => _mR2(list.reduce((s, r) => s + r.amount, 0))
  const water = billable.filter(r => r.type === '水表')
  const elec = billable.filter(r => r.type === '电表')
  const blocking = rows.filter(r => r.blocking.length)

  return {
    period, communityId, total: rows.length,
    billableCount: billable.length,
    amount: sumOf(billable),
    waterCount: water.length, waterAmount: sumOf(water), waterUsage: _mR2(water.reduce((s, r) => s + (r.usage || 0), 0)),
    elecCount: elec.length, elecAmount: sumOf(elec), elecUsage: _mR2(elec.reduce((s, r) => s + (r.usage || 0), 0)),
    billedCount: rows.filter(r => r.billId).length,
    blockingCount: blocking.length,
    blockingTop: blocking.slice(0, 3).map(r => `${r.houseName} ${r.type}：${r.blocking.join('、')}`),
    byMode: {
      card: rows.filter(r => r.mode === 'card').length,
      none: rows.filter(r => r.mode === 'none').length
    },
    rows
  }
}

let BILL_SEQ_METER = 0

/**
 * 生成水电账单（幂等）。
 *
 * `allowPartial=false`（默认）：有 blocking 就整批拒绝 —— 只出一半，
 *   另一半户这个月没有应收，收缴率的分母凭空少一截，且没人发现少了谁。
 * `allowPartial=true`：抄表分批进行时用（先出抄完的楼栋），
 *   必须由操作人显式确认"知道会跳过 N 户"，不能默默少出。
 * 已推单的（billId 有值）不算 blocking，重复点只是提示"已推过"。
 */
export function generateMeterBills({ period = METER_PERIODS()[0], communityId = '', allowPartial = false } = {}) {
  const pv = meterBillPreview({ period, communityId })
  if (pv.blockingCount && !allowPartial) {
    throw new Error(`还有 ${pv.blockingCount} 条读数不能出账：${pv.blockingTop.join('；')}${pv.blockingCount > 3 ? ' 等' : ''}。请先补抄 / 复核，或改为「仅推已抄完的」`)
  }
  const todo = pv.rows.filter(r => r.billable)
  if (!todo.length) {
    throw new Error(pv.billedCount ? `${period} 已全部推过单，无需重复生成` : '没有可出账的读数（用量为 0 或项目为代充/自缴）')
  }

  const created = []
  for (const r of todo) {
    const itemId = METER_ITEM_ID[r.type]
    const item = feeItems.find(i => i.itemId === itemId)
    if (!item) throw new Error(`收费科目缺失：${r.type} 对应的 ${itemId}`)

    BILL_SEQ_METER += 1
    const b = {
      billId: 'BL-MT' + String(BILL_SEQ_METER).padStart(6, '0'),
      period, status: '未缴', paidAmount: 0, payTime: '', payMethod: '', invoiceNo: '',
      lateFee: 0, discount: 0,
      communityId: r.communityId, houseId: r.houseId,
      ownerId: (houses.find(h => h.houseId === r.houseId) || {}).ownerId || '',
      itemId, itemName: item.name,
      amount: r.amount, quantity: r.usage, price: r.price, unit: r.unit,
      /* 抄表账必须能追回读数：业主质疑"这个月怎么用了 80 度"时，
         账单 → readingId → 上期/本期读数，一条链走完 */
      readingId: r.readingId, meterNo: r.meterNo,
      createTime: TODAY, dueDate: _dueDateOf(period),
      payable: r.amount, unpaid: r.amount, overdueDays: 0, _isNew: true
    }
    bills.push(b)
    r.billId = b.billId
    const rec = meterReadings.find(x => x.readingId === r.readingId)
    if (rec) rec.billId = b.billId
    created.push(b)
  }
  for (const b of created) { _syncBillRow(b, { insert: true }); delete b._isNew }

  return {
    period, count: created.length, amount: _mR2(created.reduce((s, b) => s + b.amount, 0)),
    waterCount: created.filter(b => b.itemId === 'FI05').length,
    elecCount: created.filter(b => b.itemId === 'FI06').length,
    skipped: pv.blockingCount
  }
}

/* ---------------- C3 考勤 ---------------- */

export const SHIFTS = ['行政班', '早班', '晚班', '轮班']
export const ATTENDANCE_STATUS = ['正常', '待确认', '异常']
export const ATTENDANCE_MONTHS = () => [...new Set(attendance.map(a => a.month))].sort().reverse()

export function queryAttendance({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const { month = '', communityId = '', position = '', status = '', shift = '', kw = '' } = filters
    const list = attendance.filter(a =>
      (!month || a.month === month) &&
      (!communityId || a.communityId === communityId) &&
      (!position || a.position === position) &&
      (!status || a.status === status) &&
      (!shift || a.shift === shift) &&
      (!kw || `${a.empName}${a.empNo}${a.position}`.includes(kw))
    )
    return paged(list, pageNo, size)
  })
}

export function attendanceSummary(month = ATTENDANCE_MONTHS()[0]) {
  const list = attendance.filter(a => a.month === month)
  const rate = list.length
    ? Math.round(list.reduce((s, a) => s + (a.attRate || 0), 0) / list.length * 10) / 10 : 0
  return {
    month, headcount: list.length,
    avgRate: rate,
    late: list.reduce((s, a) => s + a.late, 0),
    absent: list.reduce((s, a) => s + a.absent, 0),
    leave: list.reduce((s, a) => s + a.leaveDays, 0),
    overtime: list.reduce((s, a) => s + a.overtimeHours, 0),
    abnormal: list.filter(a => a.status === '异常').length,
    appeal: list.filter(a => a.appealCount > 0).length
  }
}

/** 调整班次（内存态） */
export function saveShift(attId, shift) {
  const a = attendance.find(x => x.attId === attId)
  if (!a) throw new Error('考勤记录不存在')
  if (!SHIFTS.includes(shift)) throw new Error('班次不合法')
  a.shift = shift
  return a
}

/** 考勤申诉处理：通过则冲抵异常，驳回则保留 */
export function handleAppeal(attId, pass, memo = '') {
  const a = attendance.find(x => x.attId === attId)
  if (!a) throw new Error('考勤记录不存在')
  if (!a.appealCount) throw new Error('该记录没有申诉')
  a.appealResult = pass ? '申诉通过' : '申诉驳回'
  a.appealMemo = memo || (pass ? '情况属实，已冲抵' : '证据不足，维持原记录')
  if (pass) { a.status = '正常'; a.late = 0; a.absent = 0; a.earlyLeave = 0 }
  return a
}

/* ---------------- E3 系统配置 ---------------- */

/** 字典域清单：直接读 utils/dict.js 的 MAP，保证页面与状态标签同源 */
export function dictDomains() {
  return DICT_MAP.map(([domain, map]) => ({
    domain, count: Object.keys(map).length,
    items: Object.entries(map).map(([value, type]) => ({ value, type }))
  }))
}

/** 新增字典项（内存态）：影响全站状态标签配色 */
export function addDictItem(domain, value, type) {
  const d = dictMapRaw()[domain]
  if (!d) throw new Error('字典域不存在')
  if (!value || !type) throw new Error('状态值与语义必填')
  if (d[value]) throw new Error('该状态值已存在')
  d[value] = type
  return { domain, value, type }
}

/** 系统参数：原型阶段为内存态，改动立即体现在 KPI 与校验提示上 */
const PARAMS = [
  { key: 'bill.generateDay', name: '账单生成日', value: '1', unit: '号', group: '计费', desc: '每月几号生成当月账单' },
  { key: 'bill.dueDays', name: '账单账期', value: '15', unit: '天', group: '计费', desc: '生成后多少天内应缴清' },
  { key: 'fee.lateFeeRate', name: '违约金日利率', value: '0.05', unit: '%', group: '计费', desc: '逾期每日加收比例' },
  { key: 'collect.autoDays', name: '自动催缴触发', value: '30', unit: '天', group: '催缴', desc: '逾期多少天后自动进入催缴池' },
  { key: 'wo.slaHours', name: '工单默认 SLA', value: '24', unit: '小时', group: '现场', desc: '普通优先级工单完成时限' },
  { key: 'deposit.decorationBase', name: '装修押金基准', value: '3000', unit: '元', group: '押金', desc: '90–140㎡ 房屋的押金收取标准' },
  { key: 'export.maxRows', name: '导出单次上限', value: '50000', unit: '条', group: '导出', desc: '超过则走异步任务并分页导出' },
  { key: 'login.sessionHours', name: '会话有效期', value: '8', unit: '小时', group: '安全', desc: '超时后需重新登录' },
  // 2026-11-10（H1）：业主端自助换绑的上限。阈值必须在后台可配，
  // 写死在 06 的 PLATE_LIMIT 里，改一次要发一次版。
  { key: 'park.plateChangeLimit', name: '车牌换绑次数', value: '1', unit: '次/月', group: '车位', desc: '每车位每自然月业主可自助换绑的次数' },
  { key: 'park.plateChangeWindow', name: '换绑计数周期', value: '自然月', unit: '', group: '车位', desc: '自然月 = 每月 1 日重置' }
]
export const paramRows = () => PARAMS.map(p => ({ ...p }))
export function saveParam(key, value) {
  const p = PARAMS.find(x => x.key === key)
  if (!p) throw new Error('参数不存在')
  if (String(value).trim() === '') throw new Error('参数值不得为空')
  p.value = String(value)
  return p
}

export function queryOperationLogs({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const { module = '', result = '', kw = '', days = 7 } = filters
    const from = new Date(Date.now() - Number(days || 7) * 86400000).toISOString().slice(0, 10)
    const list = operationLogs.filter(l =>
      (!module || l.module === module) &&
      (!result || l.result === result) &&
      (!kw || `${l.operator}${l.action}${l.target}${l.ip}`.includes(kw)) &&
      (l.time >= from)
    )
    return paged(list, pageNo, size)
  })
}
export function logSummary() {
  const list = operationLogs
  return {
    total: list.length,
    fail: list.filter(l => l.result === '失败').length,
    today: list.filter(l => l.time.slice(0, 10) === _now().slice(0, 10)).length,
    modules: [...new Set(list.map(l => l.module))].length,
    operators: new Set(list.map(l => l.operator)).size
  }
}

/* ---------------- X1 导入向导 ---------------- */

export const IMPORT_TYPES = [
  { key: 'owners', name: '业主档案', tpl: '业主导入模板.csv', required: ['姓名', '手机号', '房屋'], desc: '一次导入业主与房屋绑定关系' },
  { key: 'bills', name: '账单', tpl: '账单导入模板.csv', required: ['房屋', '科目', '账期', '应收金额'], desc: '历史欠费批量建档' },
  { key: 'feeItems', name: '收费科目', tpl: '科目导入模板.csv', required: ['科目名称', '计费方式', '单价'], desc: '科目与单价批量维护' },
  { key: 'houses', name: '房屋', tpl: '房屋导入模板.csv', required: ['楼栋', '单元', '房号', '建筑面积'], desc: '交付批次批量建档' }
]

/** 模板：走下载中心生成（页面不再同步下载文件） */
export function importTemplate(typeKey) {
  const t = IMPORT_TYPES.find(x => x.key === typeKey)
  if (!t) throw new Error('导入类型不存在')
  return { name: t.tpl, header: t.required.join(',') + '\n' + t.required.map(k => k === '房屋' ? '翡翠城 1栋1单元0101' : ('示例' + k)).join(',') }
}

/**
 * 模拟解析：按类型生成成功率与失败明细（原型不真正写库）
 * 真实实现：后端解析 → 返回 { total, success, failed, errors[] }
 */
export function simulateImport(typeKey, rowCount = 200) {
  const t = IMPORT_TYPES.find(x => x.key === typeKey)
  if (!t) throw new Error('导入类型不存在')
  const errors = [
    { row: 3, field: '手机号', value: '1380013', reason: '手机号格式不正确，应为 11 位' },
    { row: 7, field: '房屋', value: '翡翠城 9栋9单元9999', reason: '房屋不存在，请先建档' },
    { row: 12, field: '账期', value: '2026-13', reason: '账期格式应为 YYYY-MM' },
    { row: 18, field: '应收金额', value: '-100', reason: '金额不得为负数' },
    { row: 24, field: '姓名', value: '', reason: '必填项为空' }
  ]
  const total = Number(rowCount) || 200
  const failed = errors.length
  return {
    type: t.name, total, success: total - failed, failed,
    errors, batchNo: 'IMP' + Date.now().toString().slice(-8)
  }
}

/* ================= 收尾轮 · 第 4 批（长尾） ================= */

/* ---------------- A1 家庭成员 / 同住人（业主下挂） ---------------- */

export const MEMBER_RELATIONS = ['配偶', '子女', '父母', '兄弟姐妹', '朋友', '其他']
export const MEMBER_ACCESS = ['人脸', '门禁卡', 'App 开门', '未授权']

/** 门禁授权：数据里没有该字段时按已有特征派生，保证演示可读（内存态可改） */
export function accessOf(m) {
  if (!m) return '未授权'
  if (m.access) return m.access
  if (m.faceRegistered) return '人脸'
  if (m.isOwnerAppUser) return 'App 开门'
  return '未授权'
}
export function memberRows(ownerId) {
  return members.filter(m => m.ownerId === ownerId).map(m => ({ ...m, access: accessOf(m) }))
}
export function memberSummary(ownerId) {
  const list = memberRows(ownerId)
  return {
    total: list.length,
    certified: list.filter(m => m.certified).length,
    faced: list.filter(m => m.faceRegistered).length,
    granted: list.filter(m => accessOf(m) !== '未授权').length
  }
}

let MEMBER_SEQ = members.length
/**
 * 新增 / 编辑家庭成员（内存态）
 * 口径：成员挂在业主下（同住人），与「是否允许无房业主 / 是否合并建档」（Q3）无关
 */
export function saveMember(payload) {
  const d = payload || {}
  const name = String(d.name || '').trim()
  if (!name) throw new Error('请填写成员姓名')
  if (d.phone && !/^1[3-9]\d{9}$/.test(d.phone)) throw new Error('手机号格式不正确，应为 11 位')
  if (d.idCard && !idCardValid(d.idCard)) throw new Error('证件号格式不正确：身份证 18 位 / 护照 / 港澳台通行证')

  if (d.memberId) {
    const m = members.find(x => x.memberId === d.memberId)
    if (!m) throw new Error('成员不存在')
    Object.assign(m, {
      name, relation: d.relation || m.relation, phone: d.phone || '',
      idCard: d.idCard || '', certified: !!d.certified, faceRegistered: !!d.faceRegistered,
      isOwnerAppUser: !!d.isOwnerAppUser, remark: d.remark || '', access: d.access || accessOf(m)
    })
    return { ...m }
  }
  MEMBER_SEQ += 1
  const row = {
    memberId: 'MB' + String(MEMBER_SEQ).padStart(5, '0'),
    ownerId: d.ownerId, name, relation: d.relation || '其他', phone: d.phone || '',
    idCard: d.idCard || '', certified: !!d.certified, faceRegistered: !!d.faceRegistered,
    isOwnerAppUser: !!d.isOwnerAppUser, remark: d.remark || '',
    access: d.access || (d.faceRegistered ? '人脸' : '未授权'),
    _isNew: true
  }
  members.push(row)
  return { ...row }
}

export function removeMember(memberId) {
  const i = members.findIndex(m => m.memberId === memberId)
  if (i < 0) throw new Error('成员不存在')
  const [m] = members.splice(i, 1)
  return { ...m }
}

/** 门禁授权：单独动作，落 operationLogs 便于审计回溯 */
export function setMemberAccess(memberId, access) {
  const m = members.find(x => x.memberId === memberId)
  if (!m) throw new Error('成员不存在')
  if (!MEMBER_ACCESS.includes(access)) throw new Error('授权方式不合法')
  m.access = access
  if (access === '人脸') m.faceRegistered = true
  return { ...m, access }
}

/* ---------------- C2 公告：新建 / 撤回 / 编辑重发 ---------------- */

export const NOTICE_TYPES = ['收费通知', '停水停电', '安全提示', '维修施工', '政策公告', '社区活动']
export const NOTICE_CHANNELS = ['App 推送', '微信公众号', '短信', '公告栏', '上门告知']
export const NOTICE_SCOPES = [
  { value: 'ALL', label: '全部项目' },
  { value: 'P01', label: '翡翠城' },
  { value: 'P02', label: '锦绣家园' },
  { value: 'P03', label: '滨江华府' }
]

let NOTICE_SEQ = notices.length
function _noticeHouseCount(scope) {
  if (!scope || scope === 'ALL') return houses.length
  return houses.filter(h => h.communityId === scope).length
}

/**
 * 新建公告（内存态）
 * 口径：定时发布 = 状态「待审核」+ 计划发布时间；立即发布 = 走审核后置「已发布」
 */
export function createNotice(payload) {
  const d = payload || {}
  const title = String(d.title || '').trim()
  if (!title) throw new Error('请填写公告标题')
  if (String(d.content || '').trim().length < 10) throw new Error('公告正文不少于 10 个字')
  if (!d.channels?.length) throw new Error('请至少选择一个发布渠道')
  NOTICE_SEQ += 1
  const now = _now()
  const scheduled = !!d.scheduledAt
  const row = {
    noticeId: 'NT' + String(NOTICE_SEQ).padStart(4, '0'),
    title, type: d.type || '政策公告', content: d.content,
    communityId: (d.communityId === 'ALL' ? '' : (d.communityId || 'P01')),
    channels: [...d.channels],
    publisher: '当前登录人', publisherEmpId: 'EM0001',
    publishTime: scheduled ? '' : now,
    scheduledAt: scheduled ? d.scheduledAt : '',
    status: scheduled ? '待审核' : (d.submitAudit === false ? '已发布' : '待审核'),
    targetHouses: _noticeHouseCount(d.communityId), readCount: 0,
    top: !!d.top, auditBy: '', auditTime: '', attachments: 0,
    _isNew: true
  }
  notices.unshift(row)
  return { ..._syncNoticeRow(row, { insert: true }) }
}

/** 编辑（草稿 / 已撤回可编辑；已发布仅允许改标题以外的补充字段，原型放开） */
export function updateNotice(id, payload) {
  const n = notices.find(x => x.noticeId === id)
  if (!n) throw new Error('公告不存在')
  if (!['草稿', '已撤回', '待审核'].includes(n.status)) throw new Error('已发布 / 已过期的公告不可编辑，请先撤回')
  Object.assign(n, {
    title: payload.title || n.title,
    type: payload.type || n.type,
    content: payload.content ?? n.content,
    channels: payload.channels?.length ? [...payload.channels] : n.channels,
    communityId: payload.communityId || n.communityId,
    scheduledAt: payload.scheduledAt ?? n.scheduledAt,
    top: payload.top ?? n.top
  })
  n.targetHouses = _noticeHouseCount(n.communityId)
  return { ..._syncNoticeRow(n) }
}

/** 撤回：仅「已发布」可撤回，撤回后回到「已撤回」，可编辑重发 */
export function withdrawNotice(id, reason = '') {
  const n = notices.find(x => x.noticeId === id)
  if (!n) throw new Error('公告不存在')
  if (n.status !== '已发布') throw new Error(`当前状态「${n.status}」不可撤回`)
  n.status = '已撤回'
  n.withdrawTime = _now()
  n.withdrawReason = reason || '内容有误，撤回修改'
  /* **已读不清零**：业主确实看过，撤个公告就把数字抹掉就是伪造台账。
     重新发布时才归零——那是新一轮推送，重新计数合理 */
  return { ..._syncNoticeRow(n) }
}

/** 重发：已撤回 / 草稿 → 待审核（或直发） */
export function republishNotice(id, { submitAudit = true } = {}) {
  const n = notices.find(x => x.noticeId === id)
  if (!n) throw new Error('公告不存在')
  if (!['已撤回', '草稿', '待审核'].includes(n.status)) throw new Error(`当前状态「${n.status}」不可重发`)
  n.status = submitAudit ? '待审核' : '已发布'
  n.publishTime = submitAudit ? '' : _now()
  n.auditBy = ''
  n.auditTime = ''
  n.withdrawReason = ''
  n.readCount = 0
  return { ..._syncNoticeRow(n) }
}

export function noticeBoardSummary() {
  const c = s => notices.filter(n => n.status === s).length
  return {
    total: notices.length, published: c('已发布'), pending: c('待审核'),
    draft: c('草稿'), withdrawn: c('已撤回'), expired: c('已过期'),
    readRate: notices.filter(n => n.status === '已发布').length
      ? Math.round(notices.filter(n => n.status === '已发布').reduce((s, n) => s + (n.readCount || 0), 0) /
        notices.filter(n => n.status === '已发布').reduce((s, n) => s + (n.targetHouses || 1), 0) * 1000) / 10
      : 0
  }
}

/* ---------------- F4 巡检报表（计划完成率 / 异常项分布 / 转单） ---------------- */

/**
 * 巡检报表行：按「计划 × 项目」聚合巡检任务
 * 口径：完成率 = 已完成 / 应执行（应执行不含「已取消」）；异常项 = issueCount 合计；转单 = 关联工单数
 */
export function inspectReportRows({ communityId = '', post = '', kw = '' } = {}) {
  const byKey = new Map()
  for (const t of inspectTasks) {
    if (communityId && t.communityId !== communityId) continue
    if (post && t.post !== post) continue
    const key = `${t.planId}|${t.communityId}`
    let r = byKey.get(key)
    if (!r) {
      r = {
        planId: t.planId, planName: t.planName, post: t.post,
        communityId: t.communityId, communityName: communityName(t.communityId),
        executor: t.executor, planned: 0, done: 0, late: 0, issues: 0, photos: 0,
        avgDuration: 0, transferred: 0
      }
      byKey.set(key, r)
    }
    r.planned += 1
    if (t.status === '已完成') { r.done += 1; r.avgDuration += t.duration || 0 }
    if (t.status === '逾期未做' || t.status === '超时完成') r.late += 1
    r.issues += t.issueCount || 0
    r.photos += t.photos || 0
  }
  const rows = [...byKey.values()].map(r => ({
    ...r,
    undone: r.planned - r.done,
    doneRate: r.planned ? Math.round(r.done / r.planned * 1000) / 10 : 0,
    avgDuration: r.done ? Math.round(r.avgDuration / r.done) : 0,
    // 转单：以「巡检任务 → 工单」的关联为准（workOrders.source === '巡检' 且同项目同岗位）
    transferred: workOrders.filter(w => w.communityId === r.communityId && w.source === '巡检').length
      ? Math.round(workOrders.filter(w => w.communityId === r.communityId && w.source === '巡检').length *
        (r.issues / Math.max(1, [...byKey.values()].filter(x => x.communityId === r.communityId).reduce((s, x) => s + x.issues, 0))))
      : 0
  })).sort((a, b) => b.issues - a.issues || a.doneRate - b.doneRate)

  if (kw) {
    const k = String(kw).trim()
    return rows.filter(r => `${r.planName}${r.executor}${r.post}${r.communityName}`.includes(k))
  }
  return rows
}

export function queryInspectReport({ pageNo = 1, size = 50, filters = {} } = {}) {
  return delay(() => paged(inspectReportRows(filters), pageNo, size))
}

export function inspectReportSummary({ communityId = '', post = '', kw = '' } = {}) {
  const rows = inspectReportRows({ communityId, post, kw })
  const planned = rows.reduce((s, r) => s + r.planned, 0)
  const done = rows.reduce((s, r) => s + r.done, 0)
  return {
    count: rows.length,
    planned,
    doneRate: planned ? Math.round(done / planned * 1000) / 10 : 0,
    issues: rows.reduce((s, r) => s + r.issues, 0),
    late: rows.reduce((s, r) => s + r.late, 0),
    transferred: rows.reduce((s, r) => s + r.transferred, 0)
  }
}

/* ---------------- F5 新建巡检计划 ---------------- */

export const PLAN_CYCLES = ['每日', '每周', '每旬', '每月', '每季']
export const PLAN_POSTS = ['保洁', '保安', '工程', '环境', '客服']

let PLAN_SEQ = inspectPlans.length
export function createInspectPlan(payload) {
  const d = payload || {}
  const name = String(d.name || '').trim()
  if (!name) throw new Error('请填写计划名称')
  if (!d.templateId) throw new Error('请选择检查模板')
  if (!d.executor) throw new Error('请指定执行人')
  const tpl = inspectTemplates.find(t => t.templateId === d.templateId)
  if (!tpl) throw new Error('检查模板不存在')
  /* 口径守卫：执行计划只能挂执行模板、监督计划只能挂监督模板，
     且监督模板的「被检岗位」必须与计划一致，否则考核会归错部门 */
  const taskType = d.taskType || (tpl.type === '监督' ? '监督' : '执行')
  if ((tpl.type || '执行') !== taskType) {
    throw new Error(`「${tpl.name}」是${tpl.type}模板，不能用于${taskType}计划`)
  }
  if (taskType === '监督') {
    if (!d.targetPost) throw new Error('请选择被检岗位')
    if (tpl.targetPost && d.targetPost !== tpl.targetPost) {
      throw new Error(`模板「${tpl.name}」用于「${tpl.targetPost}」岗位，与被检岗位「${d.targetPost}」不一致`)
    }
    if (!d.targetDept) throw new Error('请选择被检班组')
  }
  PLAN_SEQ += 1
  const row = {
    planId: 'IP' + String(PLAN_SEQ).padStart(2, '0'),
    name, post: d.post || (tpl?.post || '保洁'),
    cycle: d.cycle || '每日', templateId: d.templateId,
    communityId: d.communityId || 'P01',
    executor: d.executor, items: tpl?.fields?.length || d.items || 6,
    status: d.status || '启用',
    taskType,
    targetPost: taskType === '监督' ? d.targetPost : '',
    targetDept: taskType === '监督' ? d.targetDept : '',
    startDate: d.startDate || _now().slice(0, 10),
    endDate: d.endDate || '',
    remark: d.remark || '',
    _isNew: true
  }
  inspectPlans.push(row)
  return { ..._syncPlanRow(row, { insert: true }) }
}
export function updateInspectPlan(id, payload) {
  const p = inspectPlans.find(x => x.planId === id)
  if (!p) throw new Error('巡检计划不存在')
  /* 与新建同一套口径守卫：类型与模板必须匹配，监督计划还要求被检岗位 / 班组 */
  const nextType = payload.taskType || p.taskType || '执行'
  const nextTpl = inspectTemplates.find(t => t.templateId === (payload.templateId || p.templateId))
  if (nextTpl && (nextTpl.type || '执行') !== nextType) {
    throw new Error(`「${nextTpl.name}」是${nextTpl.type}模板，不能用于${nextType}计划`)
  }
  const nextPost = payload.targetPost ?? p.targetPost ?? ''
  if (nextType === '监督') {
    if (!nextPost) throw new Error('请选择被检岗位')
    if (nextTpl?.targetPost && nextPost !== nextTpl.targetPost) {
      throw new Error(`模板「${nextTpl.name}」用于「${nextTpl.targetPost}」岗位，与被检岗位「${nextPost}」不一致`)
    }
    if (!(payload.targetDept ?? p.targetDept)) throw new Error('请选择被检班组')
  }
  Object.assign(p, {
    name: payload.name || p.name, post: payload.post || p.post, cycle: payload.cycle || p.cycle,
    templateId: payload.templateId || p.templateId, executor: payload.executor || p.executor,
    status: payload.status || p.status, startDate: payload.startDate ?? p.startDate,
    endDate: payload.endDate ?? p.endDate, remark: payload.remark ?? p.remark,
    /* P1：任务类型与监督对象也要落库，否则改完类型列表还是老样子 */
    taskType: payload.taskType || p.taskType || '执行',
    targetPost: payload.targetPost ?? p.targetPost ?? '',
    targetDept: payload.targetDept ?? p.targetDept ?? '',
    communityId: payload.communityId || p.communityId,
    items: payload.items ?? p.items
  })
  return { ..._syncPlanRow(p) }
}
export const inspectPostOpts = () => [...new Set(inspectTasks.map(t => t.post))]
export const inspectTemplateOpts = () => inspectTemplates.map(t => ({ id: t.templateId, name: `${t.name}（${t.fields.length} 项）`, post: t.post }))
export const employeeOpts = () => employees.filter(e => e.status === '在职').map(e => ({ id: e.name, name: `${e.name} · ${e.position}` }))
export const positionOpts = () => [...new Set(employees.map(e => e.position))].filter(Boolean).sort()

/* ---------------- D1 设备编辑 + 维保记录 ---------------- */

export const MAINTAIN_TYPES = ['日常保养', '故障维修', '定期巡检', '更换配件']
export const MAINTAIN_STATUS = ['待派工', '进行中', '已完成', '已取消']

export function maintenanceOfDevice(deviceId) {
  return maintenanceRecords.filter(r => r.deviceId === deviceId)
    .sort((a, b) => String(b.planDate).localeCompare(String(a.planDate)))
}
export function maintenanceSummary(deviceId) {
  const list = maintenanceOfDevice(deviceId)
  const c = s => list.filter(r => r.status === s).length
  return {
    total: list.length, todo: c('待派工'), doing: c('进行中'), done: c('已完成'),
    cost: Math.round(list.filter(r => r.status === '已完成').reduce((s, r) => s + (r.cost || 0), 0) * 100) / 100,
    lastDate: list.filter(r => r.actualDate).map(r => r.actualDate).sort().pop() || ''
  }
}
let MR_SEQ = maintenanceRecords.length
export function addMaintenance(payload) {
  const d = payload || {}
  if (!d.deviceId) throw new Error('请选择设备')
  if (!d.type) throw new Error('请选择维保类型')
  if (!d.planDate) throw new Error('请选择计划日期')
  MR_SEQ += 1
  const dev = devices.find(x => x.deviceId === d.deviceId)
  const row = {
    recordId: 'MR' + String(MR_SEQ).padStart(5, '0'),
    deviceId: d.deviceId, deviceName: dev?.deviceName || d.deviceName || '', deviceCode: dev?.deviceCode || '',
    communityId: dev?.communityId || d.communityId || '', communityName: dev?.communityName || communityName(d.communityId || ''),
    type: d.type, planDate: d.planDate, actualDate: d.actualDate || '',
    vendor: d.vendor || '', engineer: d.engineer || '', cost: Number(d.cost) || 0,
    result: d.result || '', status: d.status || '待派工', nextDate: d.nextDate || '', remark: d.remark || '',
    _isNew: true
  }
  maintenanceRecords.unshift(row)
  return { ...row }
}
export function finishMaintenance(id, { result = '', cost = 0, nextDate = '' } = {}) {
  const r = maintenanceRecords.find(x => x.recordId === id)
  if (!r) throw new Error('维保记录不存在')
  if (r.status === '已完成') throw new Error('该记录已完成')
  r.status = '已完成'
  r.actualDate = _now().slice(0, 10)
  r.result = result || '现场处理完毕，设备恢复正常'
  r.cost = Number(cost) || 0
  r.nextDate = nextDate || ''
  return { ...r }
}

/** D1：设备档案编辑（内存态） */
export function updateDevice(id, payload) {
  const d = devices.find(x => x.deviceId === id)
  if (!d) throw new Error('设备不存在')
  const p = payload || {}
  Object.assign(d, {
    deviceCode: p.deviceCode || d.deviceCode,
    name: p.name || d.name,
    type: p.type || d.type,
    communityId: p.communityId || d.communityId,
    location: p.location ?? d.location,
    brand: p.brand ?? d.brand,
    model: p.model ?? d.model,
    vendor: p.vendor ?? d.vendor,
    ip: p.ip ?? d.ip,
    firmware: p.firmware ?? d.firmware,
    installDate: p.installDate || d.installDate,
    maintainCycle: p.maintainCycle || d.maintainCycle,
    nextMaintain: p.nextMaintain || d.nextMaintain,
    status: p.status || d.status
  })
  return { ...d }
}

/* ---------------- E1 新增成员 / 新增角色 ---------------- */

let EMP_SEQ = employees.length
/** 同步成员派生行（列表 / 组织树 / 汇总都读 EMP_ROWS） */
function _syncEmpRow(e, { insert = false } = {}) {
  const derived = empRow(e)
  const i = EMP_ROWS.findIndex(x => x.empId === e.empId)
  if (i >= 0) EMP_ROWS.splice(i, 1, derived)
  else if (insert) EMP_ROWS.unshift(derived)
  else EMP_ROWS.push(derived)
  return derived
}
export function createEmployee(payload) {
  const d = payload || {}
  if (!String(d.name || '').trim()) throw new Error('请填写姓名')
  if (!d.position) throw new Error('请选择岗位')
  if (!d.orgId) throw new Error('请选择所属组织')
  if (d.phone && !/^1[3-9]\d{9}$/.test(d.phone)) throw new Error('手机号格式不正确，应为 11 位')
  EMP_SEQ += 1
  const row = {
    empId: 'EM' + String(EMP_SEQ).padStart(4, '0'),
    empNo: 'P' + String(EMP_SEQ).padStart(4, '0'),
    name: String(d.name).trim(), orgId: d.orgId,
    orgName: (orgs.find(o => o.orgId === d.orgId) || {}).name || '',
    position: d.position, phone: d.phone || '', email: d.email || '',
    hireDate: d.hireDate || _now().slice(0, 10), status: d.status || '在职',
    communityId: d.communityId || '', idCard: d.idCard || '',
    certificates: [], attendance: { late: 0, leaveDays: 0, overtimeHours: 0 },
    _isNew: true
  }
  employees.push(row)
  return { ..._syncEmpRow(row, { insert: true }) }
}

let ROLE_SEQ = roles.length
/** 同步角色派生行（列表 / 权限矩阵 / 角色树都读 ROLE_ROWS） */
function _syncRoleRow(r, { insert = false } = {}) {
  const users = EMP_ROWS.filter(e => e.roleId === r.roleId)
  const scopeText = {
    全部项目: `全部 ${communities.length} 个项目`,
    指定项目: '指定项目',
    本项目: '所在项目部',
    本部门: '本班组 / 部门',
    仅本人: '仅本人产生的数据'
  }[r.dataScope] || r.dataScope
  const derived = {
    ...r,
    userCount: users.length,
    permCount: (r.perms || []).length,
    communityNames: (r.communities || []).map(id => communityName(id)),
    scopeText,
    domains: [...new Set((r.perms || []).map(c => c.split('.')[0]))].sort()
      .map(d => permissions.find(p => p.domain === d)?.domainName || d),
    coverage: Math.round(((r.perms || []).length / permissions.length) * 100)
  }
  const i = ROLE_ROWS.findIndex(x => x.roleId === r.roleId)
  if (i >= 0) ROLE_ROWS.splice(i, 1, derived)
  else if (insert) ROLE_ROWS.unshift(derived)
  else ROLE_ROWS.push(derived)
  return derived
}

export function createRole(payload) {
  const d = payload || {}
  const name = String(d.name || '').trim()
  if (!name) throw new Error('请填写角色名称')
  if (roles.some(r => r.name === name)) throw new Error('角色名称已存在')
  ROLE_SEQ += 1
  const row = {
    roleId: 'R-C' + String(ROLE_SEQ).padStart(2, '0'),
    name,
    scope: d.scope || '项目级',
    dataScope: d.dataScope || '本项目',
    communities: d.communities || [],
    positions: d.positions || [],
    desc: d.desc || '',
    perms: d.perms || [],
    builtin: false,
    _isNew: true
  }
  roles.push(row)
  return { ..._syncRoleRow(row, { insert: true }) }
}
export const permCodeOpts = () => permissions.map(p => ({
  code: p.code, label: `${p.domainName} · ${p.funcName} · ${p.opName}`, domain: p.domain, domainName: p.domainName
}))
export const dataScopeOptsOf = () => ['全部项目', '指定项目', '本项目', '本部门', '责任范围', '仅本人']

/* ---------------- B5 预存与抵扣 ---------------- */

export const PREPAY_STATUS = ['正常', '冻结', '已销户']
export const PREPAY_METHODS = ['微信', '支付宝', '现金', 'POS', '银行转账']

/** 预存流水：内存态，刷新还原（mock 表本身不带流水） */
const PREPAY_LOGS = []
let PL_SEQ = 0

export function queryPrepayAccounts({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const { communityId = '', status = '', kw = '' } = filters
    const list = prepayAccounts.filter(a =>
      (!communityId || a.communityId === communityId) &&
      (!status || a.status === status) &&
      (!kw || `${a.ownerName}${a.phone}${a.houseName}${a.accountId}`.includes(kw))
    )
    return paged(list, pageNo, size)
  })
}

export function prepaySummary() {
  const live = prepayAccounts.filter(a => a.status !== '已销户')
  return {
    count: prepayAccounts.length,
    live: live.length,
    balance: Math.round(live.reduce((s, a) => s + (a.balance || 0), 0) * 100) / 100,
    recharge: Math.round(prepayAccounts.reduce((s, a) => s + (a.totalRecharge || 0), 0) * 100) / 100,
    deduct: Math.round(prepayAccounts.reduce((s, a) => s + (a.totalDeduct || 0), 0) * 100) / 100,
    auto: prepayAccounts.filter(a => a.autoDeduct).length,
    frozen: prepayAccounts.filter(a => a.status === '冻结').length,
    low: live.filter(a => a.balance < 100).length
  }
}

/** 充值：**已停用**（2026-11-13 取消预存账户体系）。水电改走「抄表推单 → 账单缴费」，不再先存钱后扣费 */
export function recharge() {
  throw new Error('预存账户体系已停用：不再受理充值，水电请按账单缴纳')
}

/** 余额抵扣：**已停用**（2026-11-13 取消预存账户体系）—— 抵扣入口已下线，只留退款出口 */
export function deductPrepay() {
  throw new Error('预存账户体系已停用：抵扣入口已下线，存量余额请到「预存清退」退还')
}

export function prepayLogs(accountId) {
  return PREPAY_LOGS.filter(l => !accountId || l.accountId === accountId)
}

/** 自动抵扣：**已停用**。账户只退不再扣，开关留着只会让人以为还能用 */
export function toggleAutoDeduct() {
  throw new Error('预存账户体系已停用：自动抵扣已关闭，不再提供该开关')
}

export const prepayAccountOf = houseId => prepayAccounts.find(a => a.houseId === houseId) || null

/* ==================================================================
 * B6 · 收银台收款 + 组合支付（2026-11-06 第 62 批）
 *
 * 本批之前收银台是**假销账**：只改账单行的 status / paidAmount / unpaid，
 * 一条 payment 都没写。后果是日结拿不到这笔钱、开票池里也没有它、
 * 报表口径自然对不上 —— 界面上"收款成功"了，账上什么都没发生。
 *
 * 现在补上真实链路：**写流水 → 销账 → 回写账单**，三步一起，缺一步账就不平。
 *
 * 组合支付的口径：
 *   ① 一笔收款最多 **3 种**方式。再多，对账时分不清是系统错还是人填错；
 *   ② 同一种方式只能一行（两行现金合成一行，否则日结会出现两条"现金"）；
 *   ③ 各方式金额合计**必须等于实收**，差一分都不让提交 —— 收银台宁可多问一句；
 *   ④ **预存抵扣可以与其他方式组合**，固定排第一行，先抵余额再补差；
 *   ⑤ 挂账不进组合：挂账是"没收到钱"，塞进金额行会让实收虚高。
 *
 * 分摊：一笔收款可能覆盖多张账单，而 payment 是「一条流水对一张账单」
 * （开票、催缴、账单详情都按这个口径查）。所以按账单应收比例把各方式拆开，
 * 每条 payment 带自己的 `splits`，加起来正好是整笔的 —— 日结按 splits 汇总就不会重复计。
 *
 * 老数据没有 `splits`（3300 多条种子流水），统一用 `method` 兜底，
 * 见 `_splitsOf`：**这是唯一的分支点**，别在页面里再判断一次。
 * ================================================================== */

export const PAY_METHODS = ENUM.payMethod
export const PAY_SPLIT_MAX = 3

const _cash2 = n => Math.round((Number(n) || 0) * 100) / 100

/** 一条流水实际拆成了哪几种方式；老数据没有 splits 就用 method 兜底 */
export function _splitsOf(p) {
  if (Array.isArray(p && p.splits) && p.splits.length) return p.splits
  return p && p.method ? [{ method: p.method, amount: Number(p.amount) || 0 }] : []
}

/** 组合支付的展示文本：`现金 200 + 微信支付 122.39`，列表与详情共用 */
export function payMethodText(p) {
  const rows = _splitsOf(p)
  if (!rows.length) return p && p.method ? p.method : '—'
  if (rows.length === 1) return rows[0].method
  return rows.map(s => `${s.method} ${_cash2(s.amount)}`).join(' + ')
}

/**
 * 组合支付校验。**返回错误清单而不是抛第一个** —— 收银台要一次说清所有问题，
 * 改一处试一次会让人在窗口前排队。
 */
export function paySplitCheck(splits = [], total = 0) {
  const errs = []
  const rows = (Array.isArray(splits) ? splits : [])
    .filter(s => s && s.method)
    .map(s => ({ method: s.method, amount: _cash2(s.amount) }))

  /* 全额减免（实收 0）：没有现金进来，就不该要求"选一种收款方式"。
     以前这里一律要求金额 > 0，结果是「政策性全免」这种最常见的情形反而收不了款 */
  const targetEarly = _cash2(total)
  if (targetEarly <= 0.001) {
    const positive = rows.filter(s => s.amount > 0)
    return {
      rows: [], sum: 0, total: 0, diff: 0,
      ok: positive.length === 0,
      msg: positive.length ? '本次实收为 0（全额减免），不要再填收款金额' : ''
    }
  }

  if (!rows.length) errs.push('请至少选择一种收款方式')
  if (rows.length > PAY_SPLIT_MAX) errs.push(`最多 ${PAY_SPLIT_MAX} 种收款方式（再多对账时分不清是系统错还是人填错）`)

  const seen = new Set()
  for (const s of rows) {
    if (!PAY_METHODS.includes(s.method)) errs.push(`不支持的收款方式「${s.method}」`)
    if (!(s.amount > 0)) errs.push(`「${s.method}」的金额必须大于 0`)
    if (seen.has(s.method)) errs.push(`「${s.method}」出现了两次，同一种方式请合成一行`)
    seen.add(s.method)
  }

  const sum = _cash2(rows.reduce((a, s) => a + s.amount, 0))
  const target = _cash2(total)
  const diff = _cash2(target - sum)
  if (rows.length && Math.abs(diff) > 0.01) {
    errs.push(diff > 0
      ? `已分配 ¥${sum}，还差 ¥${diff} 未分配`
      : `已分配 ¥${sum}，超出 ¥${_cash2(-diff)}`)
  }
  return { rows, sum, total: target, diff, ok: errs.length === 0, msg: errs.join('；') }
}

/** 按权重把一组金额拆成 n 份（分到「分」为单位，最后一份兜底差额） */
function _allocSplits(splits, weights) {
  const cents = splits.map(s => Math.round(s.amount * 100))
  const totalW = weights.reduce((a, w) => a + w, 0) || 1
  return weights.map((w, i) => {
    const isLast = i === weights.length - 1
    const row = splits.map((s, j) => {
      const take = isLast ? cents[j] : Math.round(s.amount * 100 * w / totalW)
      cents[j] -= take
      return { method: s.method, amount: take / 100 }
    }).filter(x => x.amount > 0.004)
    /* 舍入会让这一条的合计差几分，补到最大的一笔上 —— 否则每条流水的
       splits 加起来不等于它自己的 amount，开票金额就会飘 */
    const sum = _cash2(row.reduce((a, r) => a + r.amount, 0))
    const diff = _cash2(w - sum)
    if (Math.abs(diff) > 0.004 && row.length) {
      const big = row.reduce((m, r) => (r.amount > m.amount ? r : m), row[0])
      big.amount = _cash2(big.amount + diff)
    }
    return row
  })
}

let _PAY_BATCH_SEQ = 0
const _payBatchNo = day => {
  _PAY_BATCH_SEQ += 1
  return `SK${String(day).replace(/-/g, '')}-${String(_PAY_BATCH_SEQ).padStart(3, '0')}`
}

const _payErr = (msg, code) => Object.assign(new Error(msg), { code: code || 42201 })

/**
 * 收银台收款。
 *
 * @param {{billIds:string[], splits:{method:string,amount:number}[], discount?:number,
 *          remark?:string, operator?:string, at?:string}} payload
 */
export function payBills({ billIds = [], splits = [], discount = 0, waiveReasonId = '', waiveNote = '', remark = '', operator = '当前登录人', at = '' } = {}) {
  const ids = Array.isArray(billIds) ? billIds : [billIds]
  if (!ids.length) throw _payErr('请先勾选要收款的账单')

  const list = ids.map(id => bills.find(b => b.billId === id))
  const missIdx = list.findIndex(b => !b)
  if (missIdx >= 0) throw _payErr(`账单 ${ids[missIdx]} 不存在`, 40401)

  const dead = list.find(b => !isDebt(b))
  if (dead) throw _payErr(`账单 ${dead.billId} 当前不是欠费状态（${dead.status}），请刷新后重试`, 40926)

  const owners = [...new Set(list.map(b => b.ownerId))]
  if (owners.length > 1) throw _payErr('一次收款只能针对同一位业主，不同业主请分开收', 42201)

  const unpaidSum = _cash2(list.reduce((s, b) => s + (b.unpaid || 0), 0))
  const disc = _cash2(discount)
  if (disc < 0) throw _payErr('减免金额不能为负')
  if (disc > unpaidSum + 0.01) throw _payErr(`减免 ¥${disc} 超过应缴 ¥${unpaidSum}`)
  const received = _cash2(unpaidSum - disc)

  /* 减免必须落到受控原因上（2026-11-13）。
     以前这里只收一个金额，报表要按原因统计减免时发现压根没采集 ——
     前台填了 800 块减免，事后只看到"让利 800"，说不清为什么让。
     规则与 createPrepayCollect 保持一致，两个入口不能两套口径。 */
  const waiveReason = disc > 0
    ? waiveReasons.find(r => r.reasonId === waiveReasonId)
    : null
  if (disc > 0) {
    if (!waiveReasonId) throw _payErr('减免必须选择原因 —— 报表要按原因统计，也必须能追溯到依据', 42214)
    if (!waiveReason) throw _payErr('减免原因不存在', 42215)
    if (!waiveReason.enabled) throw _payErr(`减免原因「${waiveReason.name}」已停用，请换一条或先在字典里启用`, 42216)
    /* 范围：指定项目的减免不能用在别的项目上 */
    const scopeIds = waiveReason.communityIds || []
    if (waiveReason.scope === '指定项目') {
      const bad = list.find(b => !scopeIds.includes((houses.find(h => h.houseId === b.houseId) || {}).communityId))
      if (bad) {
        throw _payErr(`「${waiveReason.name}」只适用于指定项目，当前账单（${houseName(bad.houseId)}）不在范围内`, 42217)
      }
    }
    /* 免审额度：超过就要写依据。不硬拦 —— 现场收了钱再补审批是常态，
       但必须留痕，否则审计问"谁同意让 5000"时答不上来 */
    const limit = Number(waiveReason.approveAbove) || 0
    if (limit > 0 && disc > limit && !String(waiveNote || '').trim()) {
      throw _payErr(`减免 ¥${_cash2(disc)} 超过「${waiveReason.name}」的免审额度 ¥${_cash2(limit)}，必须填写依据（审批单号 / 会议纪要）`, 42218)
    }
  }

  const chk = paySplitCheck(splits, received)
  if (!chk.ok) throw _payErr(chk.msg, 42212)
  /* 预存账户体系已停用（批 3）。前端下拉里已经没有这一项，
     但旧页面/旧链接仍可能传进来：留着不拦，就会又扣一次预存余额。
     业务码用 42212（参数不合法）而不是 40929 —— 40929 在别处是「额度用完 /
     部门模板重复」，同一个码背两种意思，排查时只会被带偏；契约侧也是 42212。 */
  if (chk.rows.some(s => s.method === '预存抵扣')) {
    throw _payErr('预存账户已停用，不能再抵扣；请改用现金 / 微信 / POS 等方式，存量余额走「预存清退」退还', 42212)
  }

  /* 每条账单的实收：按应缴比例分减免，最后一条兜底 */
  const weights = list.map(b => b.unpaid || 0)
  const discParts = []
  {
    let left = Math.round(disc * 100)
    const totalW = weights.reduce((a, w) => a + w, 0) || 1
    weights.forEach((w, i) => {
      const isLast = i === weights.length - 1
      const c = isLast ? left : Math.round(disc * 100 * w / totalW)
      left -= c
      discParts.push(c / 100)
    })
  }
  const billReceived = list.map((b, i) => _cash2((b.unpaid || 0) - discParts[i]))
  const billSplits = _allocSplits(chk.rows, billReceived)

  /* 预存抵扣的整段校验与扣款已随「取消预存账户体系」一起移除（批 3）。
     留着是两套口径并存：账上余额不动、账单却被抵掉，日结里就找不到这笔钱的来源。 */

  /* ---- 写入 ----
     时间用**数据集当下**（TODAY）的日期 + 真实时分：种子数据全在 2026-10-21，
     新收款若记成真实今天（11 月），当天的日结页会一条都看不到，看着像没收上钱 */
  const time = at || _now().replace(/^\d{4}-\d{2}-\d{2}/, TODAY)
  const day = time.slice(0, 10)
  const batchNo = _payBatchNo(day)
  const created = []

  let writtenOff = 0
  for (let i = 0; i < list.length; i++) {
    const b = list[i]
    const mine = billSplits[i]
    /* 金额为 0 但减免 > 0 的账单**也要核销**：
       全额减免时没有现金流，`mine` 为空，原来这里直接 continue，
       于是钱没收到、账单也没销掉，业主下个月还会被催缴 */
    if (!mine.length && !(billReceived[i] > 0) && !(discParts[i] > 0)) continue
    writtenOff += 1
    if (!mine.length) {
      /* 纯减免：不生成收款流水（没有现金），只销账 */
      b.paidAmount = _cash2((b.paidAmount || 0) + billReceived[i])
      b.discount = _cash2((b.discount || 0) + discParts[i])
      b.unpaid = 0
      b.status = '已缴'
      b.payTime = time
      b.payMethod = '减免'
      b.overdueDays = 0
      if (discParts[i] > 0 && waiveReason) {
        b.discountReasonId = waiveReason.reasonId
        b.discountReason = waiveReason.name
        b.waiveNote = String(waiveNote || '').trim()
        b.waiveOverLimit = (Number(waiveReason.approveAbove) || 0) > 0 && disc > Number(waiveReason.approveAbove)
      }
      _syncBillRow(b)
      if (b.period && isReceivableItem(b.itemId) && discParts[i] > 0) {
        _MTX_SEQ += 1
        MATRIX_TX.push({
          txId: 'MT' + String(_MTX_SEQ).padStart(6, '0'),
          houseId: b.houseId, itemId: b.itemId, period: b.period,
          amount: discParts[i], source: 'waive', billId: b.billId, at: time,
          reasonId: waiveReason?.reasonId || '', reasonName: waiveReason?.name || ''
        })
      }
      continue
    }

    PAY_SEQ += 1
    const pay = {
      payId: 'PM' + String(PAY_SEQ).padStart(6, '0'),
      billId: b.billId,
      houseId: b.houseId,
      ownerId: b.ownerId,
      amount: billReceived[i],
      /* method 保留为「金额最大的一笔」：老报表、日结旧逻辑、导出都还在读它，
         拆掉等于让所有下游同时改 */
      method: mine.reduce((m, s) => (s.amount > m.amount ? s : m), mine[0]).method,
      splits: mine.map(s => ({ method: s.method, amount: _cash2(s.amount) })),
      payTime: time,
      transNo: 'TXN' + String(Date.now()).slice(-10) + String(i).padStart(2, '0'),
      operator,
      invoiceStatus: '未开票',
      invoiceNo: '',
      channel: '前台收款',
      batchNo,
      remark: String(remark || '').trim(),
      _isNew: true
    }
    payments.unshift(pay)
    _syncPayRow(pay, { insert: true })
    created.push(pay)

    /* 销账：paidAmount 加实收、discount 单独记（不能并进 paidAmount，
       否则"减免了多少"事后查不出来），unpaid 归零 */
    b.paidAmount = _cash2((b.paidAmount || 0) + billReceived[i])
    b.discount = _cash2((b.discount || 0) + discParts[i])
    if (discParts[i] > 0 && waiveReason) {
      b.discountReasonId = waiveReason.reasonId
      b.discountReason = waiveReason.name
      b.waiveNote = String(waiveNote || '').trim()
      b.waiveOverLimit = (Number(waiveReason.approveAbove) || 0) > 0 && disc > Number(waiveReason.approveAbove)
    }
    b.unpaid = 0
    b.status = '已缴'
    b.payTime = time
    b.payMethod = pay.method
    b.overdueDays = 0
    _syncBillRow(b)

    /* 账单缴清即落应收矩阵（批 3）。
       之前矩阵的"已收"只有 createPrepay* 在写 —— 走账单缴费的这户，
       收缴率永远不涨，账单列表已缴、报表却说没收钱。两个入口必须落同一张表。 */
    if (b.period && isReceivableItem(b.itemId)) {
      _MTX_SEQ += 1
      MATRIX_TX.push({
        txId: 'MT' + String(_MTX_SEQ).padStart(6, '0'),
        houseId: b.houseId, itemId: b.itemId, period: b.period,
        amount: billReceived[i], source: 'bill', billId: b.billId, at: time
      })
      if (discParts[i] > 0) {
        _MTX_SEQ += 1
        MATRIX_TX.push({
          txId: 'MT' + String(_MTX_SEQ).padStart(6, '0'),
          houseId: b.houseId, itemId: b.itemId, period: b.period,
          amount: discParts[i], source: 'waive', billId: b.billId, at: time,
          /* 原因随流水一起落：报表按原因汇总，账单可能被后续红冲，流水是最终依据 */
          reasonId: waiveReason?.reasonId || '', reasonName: waiveReason?.name || ''
        })
      }
    }
  }

  track('cashier_pay', { batchNo, count: created.length, amount: received, splits: chk.rows.length })

  return {
    batchNo,
    count: writtenOff,
    paymentCount: created.length,
    payable: unpaidSum,
    discount: disc,
    waiveReasonId: waiveReason?.reasonId || '',
    waiveReasonName: waiveReason?.name || '',
    received,
    splits: chk.rows,
    payments: created,
    prepay: [],
    methodText: chk.rows.length > 1
      ? chk.rows.map(s => `${s.method} ${_cash2(s.amount)}`).join(' + ')
      : (chk.rows[0] ? chk.rows[0].method : '全额减免（无现金收款）')
  }
}

/** 某房屋的预存可用余额（收银台抵扣行要显示） */
export const prepayBalanceOf = houseId => {
  const a = prepayAccounts.find(x => x.houseId === houseId)
  return a && a.status === '正常' ? _cash2(a.balance) : 0
}

/* ==================================================================
 * 预存余额清退（批 3 · 2026-11-13）
 * ------------------------------------------------------------
 * 预存账户体系**停用**，但账上的钱不能跟着消失 —— 137 个账户、几十万在账余额，
 * 直接删页面等于让这笔钱既不是收入、也不在负债里，审计一问就哑。
 *
 * 所以这里只做一件事：**把存量余额退还给业主**，账户随之销户、永久留档。
 *   · 不再充值（充值入口已下线，recharge 只保留给历史单据回放）
 *   · 不再抵扣（PAY_METHODS 里已去掉「预存抵扣」，payBills 会直接拒绝）
 *   · 余额 → 退款流水（PREPAY_LOGS，type=退款）→ 账户置「已销户」
 * ================================================================ */

/** 清退进度：还有多少户、多少钱没退 */
export function prepayClearanceSummary() {
  const live = prepayAccounts.filter(a => a.status !== '已销户')
  const pending = live.filter(a => _cash2(a.balance) > 0)
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
  return {
    accounts: prepayAccounts.length,
    live: live.length,
    closed: prepayAccounts.length - live.length,
    pending: pending.length,
    balance: r2(pending.reduce((s, a) => s + _cash2(a.balance), 0)),
    /* 已销户账户里仍挂着余额的，说明当年是人工作废而不是退款 —— 要单列出来核对 */
    closedWithBalance: prepayAccounts.filter(a => a.status === '已销户' && _cash2(a.balance) > 0).length
  }
}

/**
 * 退还某账户的全部余额并销户。
 * 必须整额退：留 0.01 元的账户永远关不掉，而部分退款要和业主重新对一次账。
 */
export function refundPrepay(accountId, { method = '现金', remark = '', operator = '' } = {}) {
  /* 退款是资金动作，跟收款同一个权限位：能收钱的人才能退钱 */
  assertPerm('b.cashier.edit', '缺少权限位 b.cashier.edit：无权做退款')
  const acc = prepayAccounts.find(a => a.accountId === accountId)
  if (!acc) throw new Error('预存账户不存在')
  if (acc.status === '已销户') throw new Error(`账户 ${acc.accountId} 已销户，不能重复退款`)
  const amt = _cash2(acc.balance)
  if (!(amt > 0)) throw new Error('该账户余额为 0，无需退款')

  const time = `${TODAY} ${new Date().toTimeString().slice(0, 5)}`
  const who = operator || currentOperator().name || '财务'

  PL_SEQ += 1
  PREPAY_LOGS.unshift({
    logId: 'PL' + String(PL_SEQ).padStart(6, '0'),
    accountId: acc.accountId, type: '退款', amount: -amt, balance: 0,
    method, time, operator: who,
    remark: String(remark || '').trim() || `预存余额清退（原余额 ¥${amt}）`
  })

  acc.balance = 0
  acc.status = '已销户'
  acc.refundAmount = amt
  acc.refundDate = TODAY
  acc.refundMethod = method
  acc.refundBy = who

  track('prepay_refund', { accountId, amount: amt, method })
  return { accountId: acc.accountId, houseName: acc.houseName, amount: amt, method, at: time }
}

/* ==================================================================
 * B6 域 · 临时收费（2026-11-06 第 63 批）
 *
 * 「摆摊费」这类钱与业务无关：没有应收、不挂房屋、也不进账单。
 * 硬塞进 bills 会有两个后果，都是隐性的：
 *   ① 收缴率的分母被污染 —— 收缴率是「应收 vs 实收」，而临时收费压根没有"应收"
 *      这一步，进了分母只会让收缴率凭空下降，没人能解释；
 *   ② 账单页出现一堆没有房屋、没有业主的怪行，催缴、账龄、欠费排行全部要加豁免。
 *
 * 所以独立成表，只做三件事：
 *   ① 建单（对象三选一：业主 / 租户 / 外部单位或个人）；
 *   ② 收款（写一条 payments，`channel='临时收费'`，日结能看见、开票池能开票）；
 *   ③ 计入收入（按科目汇总进营业收入，但**不进收缴率**）。
 *
 * 与账单的关系：零。没有 billId、不改 bills、不生成应收。
 * 与流水的关系：收款后写一条 payment，`billId` 为空、`tempChargeId` 指回单据。
 *
 * 对象三选一不是"统一成一张人脸"：业主/租户能挂上房屋，是为了扫码开票和
 * 以后对账时能说清"3 号楼那位业主的场地费"；外来摊贩没有档案，只能记名字和电话。
 * ================================================================== */

const TC_PERM_VIEW = 'b.tempCharges.view'
const TC_PERM_EDIT = 'b.tempCharges.edit'

export const canViewTempCharges = () => _hasPerm(TC_PERM_VIEW)
export const canEditTempCharges = () => _hasPerm(TC_PERM_EDIT)

/** 付款方类型。`外部` = 单位或个人，不要求有业主/租户档案 */
export const TEMP_CHARGE_PARTY = ['业主', '租户', '外部']
export const TEMP_CHARGE_STATUS = ['待收款', '已收款', '已作废']

/**
 * 收费事由预设。**不是白名单** —— 事由可以自由填写，
 * 这五个只是"用得最多的几个"，省一遍打字。
 * 与开票的「费用项目」同源（`invoiceItemOpts()`），因为发票上写的项目名就是它。
 */
export const TEMP_CHARGE_REASONS = ['摆摊费', '场地租用', '赔偿款', '押金', '其他']

let TC_SEQ = 0
const TEMP_CHARGES = []

const _tcR2 = n => Math.round((Number(n) || 0) * 100) / 100
const _tcError = (msg, code = 42212) => Object.assign(new Error(msg), { code })

/** 编号 `LSF{日期}-{当日序号}`。**不是主键**，chargeId 才是 */
function _tcNextNo(day) {
  const d = String(day || TODAY).replace(/-/g, '')
  const n = TEMP_CHARGES.filter(x => String(x.chargeNo || '').startsWith(`LSF${d}`)).length
  return `LSF${d}-${String(n + 1).padStart(3, '0')}`
}

const _tcOf = chargeId => TEMP_CHARGES.find(x => x.chargeId === chargeId) || null

/** 派生行：付款方展示名、项目名、状态色一次算好，页面不再各写一套 */
function _tcRowOf(x) {
  const cm = communities.find(c => c.communityId === x.communityId)
  return {
    ...x,
    amount: _tcR2(x.amount),
    communityName: cm ? cm.name : '—',
    houseName: x.houseId ? houseName(x.houseId) : '',
    /** 业主/租户显示档案名 + 房屋；外部只显示手填的名字 */
    partyLabel: x.partyType === '外部'
      ? `${x.partyName}${x.partyPhone ? ' · ' + x.partyPhone : ''}`
      : `${x.partyName}${x.houseId ? ' · ' + houseName(x.houseId) : ''}`,
    statusType: x.status === '已收款' ? 'success' : (x.status === '已作废' ? 'info' : 'warning'),
    /* 临时收费**永远不进收缴率**：这里显式给 false，防止以后有人顺手把它加进分母 */
    countsInCollectionRate: false,
    countsInIncome: x.status === '已收款'
  }
}

/**
 * 建单 / 改单。
 * **只有「待收款」能改** —— 收了钱再改金额，等于让流水与单据对不上，
 * 而流水是已经进了日结的。要改先作废重开。
 */
export function saveTempCharge(payload = {}, chargeId = '') {
  if (!canEditTempCharges()) throw _tcError(`当前角色没有维护临时收费的权限（${TC_PERM_EDIT}）`, 403)

  const partyType = TEMP_CHARGE_PARTY.includes(payload.partyType) ? payload.partyType : ''
  if (!partyType) throw _tcError(`付款方类型只能是 ${TEMP_CHARGE_PARTY.join(' / ')}`)

  const partyName = String(payload.partyName || '').trim()
  if (!partyName) throw _tcError(partyType === '外部' ? '请填写缴费单位或个人名称' : '请选择付款方')
  if (partyName.length > 40) throw _tcError('付款方名称不超过 40 字')

  let ownerId = ''
  let tenantId = ''
  let houseId = ''
  if (partyType === '业主') {
    const o = owners.find(x => x.ownerId === payload.ownerId)
    if (!o) throw _tcError('选择的业主不存在', 40401)
    ownerId = o.ownerId
    houseId = String(payload.houseId || (o.houseIds || [])[0] || '')
  } else if (partyType === '租户') {
    const t = tenants.find(x => x.tenantId === payload.tenantId)
    if (!t) throw _tcError('选择的租户不存在', 40401)
    tenantId = t.tenantId
    houseId = String(t.houseId || payload.houseId || '')
  } else {
    houseId = String(payload.houseId || '')
  }

  /* 项目必填：收入报表按项目统计，没有项目的收入只能进「集团」，等于查不出来源 */
  const communityId = String(payload.communityId || (houseId ? (HOUSE_COMMUNITY.get(houseId) || '') : ''))
  if (!communityId) throw _tcError('请选择所属项目（收入要按项目入账）')
  if (!communities.some(c => c.communityId === communityId)) throw _tcError('所属项目不存在', 40401)

  const reason = String(payload.reason || '').trim()
  if (!reason) throw _tcError('请填写收费事由')
  if (reason.length > 40) throw _tcError('收费事由不超过 40 字')

  /* 收入科目默认等于事由：发票上写的就是它，让人填两遍没意义 */
  const itemName = String(payload.itemName || reason).trim().slice(0, 20)

  const amount = _tcR2(payload.amount)
  if (!(amount > 0)) throw _tcError('收费金额必须大于 0')
  if (amount > 1000000) throw _tcError('单笔金额不能超过 100 万，超过请拆单或走合同')

  const partyPhone = String(payload.partyPhone || '').trim()
  if (partyPhone && !/^1\d{10}$/.test(partyPhone)) throw _tcError('联系电话应为 11 位手机号')
  const remark = String(payload.remark || '').trim()
  if (remark.length > 120) throw _tcError('备注不超过 120 字')

  const now = _now().replace(/^\d{4}-\d{2}-\d{2}/, TODAY)

  if (chargeId) {
    const cur = _tcOf(chargeId)
    if (!cur) throw _tcError('临时收费单不存在', 40401)
    if (cur.status !== '待收款') throw _tcError(`「${cur.status}」的单据不能修改，需先作废重开`, 40927)
    Object.assign(cur, {
      partyType, partyName, partyPhone, ownerId, tenantId, houseId, communityId,
      reason, itemName, amount, remark, updatedAt: now
    })
    return _tcRowOf(cur)
  }

  TC_SEQ += 1
  const rec = {
    chargeId: 'TC' + String(TC_SEQ).padStart(5, '0'),
    chargeNo: _tcNextNo(TODAY),
    partyType, partyName, partyPhone, ownerId, tenantId, houseId, communityId,
    reason, itemName, amount,
    status: '待收款',
    method: '', splits: [], payTime: '', payId: '', batchNo: '',
    operator: '', remark,
    createdAt: now, createdBy: currentOperator().name,
    voidReason: '', voidAt: '', voidBy: ''
  }
  TEMP_CHARGES.unshift(rec)
  return _tcRowOf(rec)
}

/**
 * 收款。**先校验再写**，任何一步失败都不留半截。
 *
 * 写一条 `payments`：`billId` 为空、`tempChargeId` 指回单据 —— 日结按 splits
 * 展开就能看到这笔钱，开票池也能拿它开票（临时收费照样要发票）。
 */
export function payTempCharge(chargeId, { splits = [], remark = '', operator = '', at = '' } = {}) {
  if (!canEditTempCharges()) throw _tcError(`当前角色没有收款的权限（${TC_PERM_EDIT}）`, 403)
  const c = _tcOf(chargeId)
  if (!c) throw _tcError('临时收费单不存在', 40401)
  if (c.status === '已收款') throw _tcError('这笔已经收过款了，请刷新后查看', 40926)
  if (c.status === '已作废') throw _tcError('已作废的单据不能收款', 40927)

  const chk = paySplitCheck(splits, c.amount)
  if (!chk.ok) throw _tcError(chk.msg, 42212)

  const time = at || _now().replace(/^\d{4}-\d{2}-\d{2}/, TODAY)
  const day = time.slice(0, 10)
  const batchNo = _payBatchNo(day)

  PAY_SEQ += 1
  const pay = {
    payId: 'PM' + String(PAY_SEQ).padStart(6, '0'),
    billId: '',
    tempChargeId: c.chargeId,
    tempChargeNo: c.chargeNo,
    /* 冗余三个快照：payRow 是模块顶层生成的，读不到后面的 TEMP_CHARGES（TDZ），
       而且单据作废/改名后流水也该显示当时的样子 */
    tempItemName: c.itemName,
    tempPartyName: c.partyName,
    houseId: c.houseId || '',
    ownerId: c.ownerId || '',
    communityId: c.communityId,
    amount: c.amount,
    method: chk.rows.reduce((m, s) => (s.amount > m.amount ? s : m), chk.rows[0]).method,
    splits: chk.rows.map(s => ({ method: s.method, amount: _tcR2(s.amount) })),
    payTime: time,
    transNo: 'TXN' + String(Date.now()).slice(-10) + 'T',
    operator: operator || currentOperator().name,
    invoiceStatus: '未开票',
    invoiceNo: '',
    /* 第 64 批：收据与发票是**两个独立状态** —— 只开收据的笔数不少，
       合成一个「已开票」会让台账查不出"还差一张发票" */
    receiptStatus: '未开具',
    receiptNo: '',
    channel: '临时收费',
    batchNo,
    remark: String(remark || '').trim(),
    _isNew: true
  }
  PAY_SEQ -= 0
  payments.unshift(pay)
  _syncPayRow(pay, { insert: true })

  Object.assign(c, {
    status: '已收款',
    method: pay.method,
    splits: pay.splits,
    payTime: time,
    payId: pay.payId,
    batchNo,
    operator: pay.operator
  })

  track('temp_charge_pay', { chargeId: c.chargeId, amount: c.amount, splits: chk.rows.length })
  return { charge: _tcRowOf(c), payment: pay, methodText: payMethodText(pay) }
}

/**
 * 作废。**只有「待收款」能作废**；已收款的要走退款（本期不做），
 * 直接作废会让日结里那笔钱凭空消失，而且找不到凭据。
 */
export function voidTempCharge(chargeId, reason = '') {
  if (!canEditTempCharges()) throw _tcError(`当前角色没有维护临时收费的权限（${TC_PERM_EDIT}）`, 403)
  const c = _tcOf(chargeId)
  if (!c) throw _tcError('临时收费单不存在', 40401)
  if (c.status === '已收款') throw _tcError('已收款的单据不能作废，需走退款流程', 40927)
  if (c.status === '已作废') throw _tcError('这张单已经作废了', 40928)
  const why = String(reason || '').trim()
  if (!why) throw _tcError('作废必须写原因 —— 台账要能解释这张单为什么没收钱')
  c.status = '已作废'
  c.voidReason = why.slice(0, 60)
  c.voidAt = _now().replace(/^\d{4}-\d{2}-\d{2}/, TODAY)
  c.voidBy = currentOperator().name
  return _tcRowOf(c)
}

/* ---------------- 读 ---------------- */

export function queryTempCharges({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    assertInScope({ communityId: filters.communityId })
    const list = TEMP_CHARGES
      .filter(x => eq(x, filters.communityId, 'communityId'))
      .filter(x => eq(x, filters.partyType, 'partyType'))
      .filter(x => eq(x, filters.status, 'status'))
      .filter(x => eq(x, filters.itemName, 'itemName'))
      .filter(x => !filters.range || between(x.payTime || x.createdAt, filters.range))
      .filter(x => kwHit(x, filters.kw, ['chargeNo', 'partyName', 'partyPhone', 'reason', 'itemName'],
        `${x.operator || ''}`))
      .map(_tcRowOf)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    return paged(list, pageNo, size)
  })
}

export function getTempCharge(chargeId) {
  return delay(() => {
    const c = _tcOf(chargeId)
    if (!c) return null
    const row = _tcRowOf(c)
    return { ...row, payment: c.payId ? (payments.find(p => p.payId === c.payId) || null) : null }
  })
}

/** 台账顶部四个数：待收、本月已收、累计已收、已作废 */
/**
 * 收银台散客模式用：最近 N 笔临时收费（默认只看「外部」）。
 * 同步返回 —— 收银台要在切到散客的瞬间就把名单摆出来（同一个摊位一天来两趟很常见，
 * 前台得能当场看到"这个名刚才是不是已经交过了"）。
 */
export function recentTempCharges({ partyType = '外部', limit = 6 } = {}) {
  return TEMP_CHARGES
    .filter(x => !partyType || x.partyType === partyType)
    .map(_tcRowOf)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit)
}

export function tempChargeStats() {
  const month = TODAY.slice(0, 7)
  const paid = TEMP_CHARGES.filter(x => x.status === '已收款')
  return {
    total: TEMP_CHARGES.length,
    pending: TEMP_CHARGES.filter(x => x.status === '待收款').length,
    pendingAmount: _tcR2(TEMP_CHARGES.filter(x => x.status === '待收款').reduce((s, x) => s + x.amount, 0)),
    paidCount: paid.length,
    paidAmount: _tcR2(paid.reduce((s, x) => s + x.amount, 0)),
    monthAmount: _tcR2(paid.filter(x => String(x.payTime).startsWith(month)).reduce((s, x) => s + x.amount, 0)),
    voided: TEMP_CHARGES.filter(x => x.status === '已作废').length,
    external: TEMP_CHARGES.filter(x => x.partyType === '外部').length
  }
}

/**
 * 临时收费收入（**只算已收款**）。
 *
 * 这是「计入收入」的取数口：`companyRevenue` 与营业报表都从这里拿，
 * 不收第二遍 —— 两处各算一次，迟早会差几分钱，然后没人说得清谁对。
 *
 * 注意：**不进收缴率**。收缴率的定义是「应收 vs 实收」，而临时收费没有应收。
 */
export function tempChargeIncome(filters = {}) {
  const list = TEMP_CHARGES
    .filter(x => x.status === '已收款')
    .filter(x => !filters.communityId || x.communityId === filters.communityId)
    .filter(x => !filters.year || String(x.payTime).slice(0, 4) === String(filters.year))
  const byItem = new Map()
  for (const x of list) {
    const k = x.itemName || '其他'
    const cur = byItem.get(k) || { itemName: k, count: 0, amount: 0 }
    cur.count += 1
    cur.amount = _tcR2(cur.amount + x.amount)
    byItem.set(k, cur)
  }
  return {
    count: list.length,
    total: _tcR2(list.reduce((s, x) => s + x.amount, 0)),
    byItem: [...byItem.values()].sort((a, b) => b.amount - a.amount),
    /** 显式声明：这部分钱不进收缴率分母 */
    countsInCollectionRate: false
  }
}

/** 台账的下拉选项：事由、科目（与开票费用项目同源） */
export const tempChargeReasonOpts = () => {
  const items = invoiceItemOpts().map(x => x.value)
  const all = [...new Set([...TEMP_CHARGE_REASONS, ...items])]
  return all.map(v => ({ value: v, label: v }))
}

/* ---------------- 种子 ----------------
 * 独立随机流（LCG），不碰全局 Math.random —— 重跑数据集要能复现。
 * 状态分布：已收款 6 / 待收款 5 / 已作废 1。
 * **已收款的会同时写 payments**（channel='临时收费'），否则日结与台账两个口径
 * 一开始就对不上，后面谁都不敢信这个数。
 */
function _tcRand(seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

function _tcSeed() {
  const rng = _tcRand(20261106 + 63)
  const pick = list => list[Math.floor(rng() * list.length) % list.length]
  const int = (a, b) => a + Math.floor(rng() * (b - a + 1))

  /* 外部缴费人：摆摊、场地、赔偿，名字来自真实场景，不是"张三李四" */
  const outside = [
    ['陈记糖油果子', '13800002101', '摆摊费'], ['王姐手工艺品摊', '13800002102', '摆摊费'],
    ['李师傅修鞋配钥匙', '13800002103', '摆摊费'], ['鲜果时光（临时摊位）', '13800002104', '摆摊费'],
    ['社区便民集市 · 周三场', '13800002105', '场地租用'],
    ['阳光健身（小区中庭推广）', '13800002106', '场地租用'],
    ['罗记卤味', '13800002107', '摆摊费'],
    ['临时仓库存放（3 号楼架空层）', '13800002108', '场地租用'],
    ['快递柜占地费（丰巢）', '', '场地租用'],
    ['电动车充电桩场地费', '13800002109', '场地租用'],
    ['装修垃圾清运费（2-301）', '13800002110', '赔偿款'],
    ['公共区域损坏赔偿（电梯门）', '', '赔偿款']
  ]
  const reasons = ['摆摊费', '场地租用', '赔偿款', '押金', '其他']

  const cmIds = communities.map(c => c.communityId)
  const months = ['2026-09', '2026-10']

  const mk = (spec, i) => {
    const [partyName, partyPhone, reason] = spec
    const communityId = pick(cmIds)
    const day = `${pick(months)}-${String(int(1, 20)).padStart(2, '0')}`
    const amount = _tcR2(reason === '场地租用' ? int(300, 2400) : (reason === '赔偿款' ? int(120, 900) : int(50, 400)))
    TC_SEQ += 1
    return {
      chargeId: 'TC' + String(TC_SEQ).padStart(5, '0'),
      chargeNo: `LSF${day.replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`,
      partyType: '外部', partyName, partyPhone,
      ownerId: '', tenantId: '', houseId: '', communityId,
      reason, itemName: reason === '其他' ? '其他收入' : reason, amount,
      status: '待收款', method: '', splits: [], payTime: '', payId: '', batchNo: '',
      operator: '', remark: '',
      createdAt: `${day} ${String(int(9, 17)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}`,
      createdBy: '张丽（收银员）',
      voidReason: '', voidAt: '', voidBy: ''
    }
  }

  /* 6 条外部 + 3 条业主 + 2 条租户 = 11 条，前 6 条设为已收款 */
  const recs = outside.slice(0, 6).map((s, i) => mk(s, i))

  const ownerPool = owners.filter(o => (o.houseIds || []).length).slice(0, 400)
  for (let i = 0; i < 3; i++) {
    const o = pick(ownerPool)
    const hid = (o.houseIds || [])[0]
    const cid = HOUSE_COMMUNITY.get(hid) || cmIds[0]
    const reason = pick(['场地租用', '押金', '其他'])
    TC_SEQ += 1
    const day = `${pick(months)}-${String(int(1, 20)).padStart(2, '0')}`
    recs.push({
      chargeId: 'TC' + String(TC_SEQ).padStart(5, '0'),
      chargeNo: `LSF${day.replace(/-/g, '')}-${String(6 + i + 1).padStart(3, '0')}`,
      partyType: '业主', partyName: o.name, partyPhone: o.phone || '',
      ownerId: o.ownerId, tenantId: '', houseId: hid, communityId: cid,
      reason, itemName: reason, amount: _tcR2(int(200, 1500)),
      status: '待收款', method: '', splits: [], payTime: '', payId: '', batchNo: '',
      operator: '', remark: '业主自用场地',
      createdAt: `${day} 10:${String(int(10, 50)).padStart(2, '0')}`,
      createdBy: '张丽（收银员）',
      voidReason: '', voidAt: '', voidBy: ''
    })
  }

  const tenantPool = tenants.filter(t => t.status === '在住' && t.houseId).slice(0, 200)
  for (let i = 0; i < 2; i++) {
    const t = pick(tenantPool)
    if (!t) break
    const reason = pick(reasons)
    TC_SEQ += 1
    const day = `${pick(months)}-${String(int(1, 20)).padStart(2, '0')}`
    recs.push({
      chargeId: 'TC' + String(TC_SEQ).padStart(5, '0'),
      chargeNo: `LSF${day.replace(/-/g, '')}-${String(9 + i + 1).padStart(3, '0')}`,
      partyType: '租户',
      partyName: t.tenantType === '公司' ? (t.companyName || t.name) : t.name,
      partyPhone: t.phone || '',
      ownerId: '', tenantId: t.tenantId, houseId: t.houseId,
      communityId: HOUSE_COMMUNITY.get(t.houseId) || cmIds[0],
      reason, itemName: reason, amount: _tcR2(int(100, 800)),
      status: '待收款', method: '', splits: [], payTime: '', payId: '', batchNo: '',
      operator: '', remark: '',
      createdAt: `${day} 15:${String(int(10, 50)).padStart(2, '0')}`,
      createdBy: '张丽（收银员）',
      voidReason: '', voidAt: '', voidBy: ''
    })
  }

  /* 前 6 条已收款：写 payments，让日结、流水、收入三处一开始就同源。
     日期都在 10-20 及以前 —— 10-21 是「今天」，留空才能验证"当场收一笔"的链路 */
  const methods = ['微信支付', '现金', '支付宝']
  for (let i = 0; i < 6; i++) {
    const c = recs[i]
    const m = methods[i % methods.length]
    const payTime = `${String(c.createdAt).slice(0, 10)} ${String(c.createdAt).slice(11)}`
    PAY_SEQ += 1
    const pay = {
      payId: 'PM' + String(PAY_SEQ).padStart(6, '0'),
      billId: '',
      tempChargeId: c.chargeId, tempChargeNo: c.chargeNo,
      tempItemName: c.itemName, tempPartyName: c.partyName,
      houseId: c.houseId || '', ownerId: c.ownerId || '', communityId: c.communityId,
      amount: c.amount,
      method: m,
      splits: [{ method: m, amount: c.amount }],
      payTime, transNo: 'TXN' + String(9000000000 + i),
      operator: '张丽（收银员）',
      invoiceStatus: '未开票', invoiceNo: '',
      receiptStatus: '未开具', receiptNo: '',
      channel: '临时收费', batchNo: `SK${payTime.slice(0, 10).replace(/-/g, '')}-T${String(i + 1).padStart(3, '0')}`,
      remark: '', _isNew: true
    }
    payments.unshift(pay)
    payments.sort((a, b) => (a.payTime < b.payTime ? 1 : -1))
    _syncPayRow(pay, { insert: true })
    /* 往后的单不抢前面已排好的顺序：这里直接改 c 的收款字段 */
    c.status = '已收款'
    c.method = m
    c.splits = pay.splits
    c.payTime = payTime
    c.payId = pay.payId
    c.batchNo = pay.batchNo
    c.operator = pay.operator
  }

  /* 最后一条作废，演示台账要能解释"为什么没收钱" */
  const last = recs[recs.length - 1]
  last.status = '已作废'
  last.voidReason = '缴费人取消，改为下周再来'
  last.voidAt = `${String(last.createdAt).slice(0, 10)} 17:30`
  last.voidBy = '张丽（收银员）'
  last.paidCount = undefined

  for (const r of recs) TEMP_CHARGES.push(r)
  TEMP_CHARGES.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

_tcSeed()

/* ---------------- A3 业主合并 / 拆分（含 X3 批量回执） ---------------- */

/**
 * 合并校验：只有「同一人（同名 + 同证件号或同手机号）」才允许合并
 * 返回 { ok: [], blocked: [{ ownerId, name, reason }] }
 */
export function checkMergeOwners(mainId, ids, { force = false } = {}) {
  const main = owners.find(o => o.ownerId === mainId)
  if (!main) throw new Error('主业主不存在')
  const ok = []
  const blocked = []
  for (const id of ids) {
    if (id === mainId) continue
    const o = owners.find(x => x.ownerId === id)
    if (!o) { blocked.push({ ownerId: id, name: id, reason: '业主不存在' }); continue }
    const sameName = o.name === main.name
    const samePerson = sameName &&
      ((o.idCard && main.idCard && o.idCard === main.idCard) || (o.phone && o.phone === main.phone))
    if (samePerson) { ok.push(o); continue }
    // 强制合并：仅同名且人工确认时放行（重复档案常因证件号缺失而无法自动判定）
    if (force && sameName) { ok.push(o); continue }
    blocked.push({
      ownerId: id, name: o.name,
      reason: sameName ? '同名但证件号 / 手机号不一致，勾选「人工确认」后可合并' : '姓名不一致，不能合并'
    })
  }
  return { main, ok, blocked }
}

/**
 * 合并：把被合并业主的房屋、车位过户到主业主，被合并方置为「已合并」并清空关联
 * 口径：只做「一人多房 / 一人多车位」的归并，不动账单与缴费流水（历史留存原业主名下）
 */
export function mergeOwners(mainId, ids, { force = false } = {}) {
  const { main, ok, blocked } = checkMergeOwners(mainId, ids, { force })
  if (!ok.length) throw new Error('没有可合并的业主：需为同名且证件号或手机号一致')
  let houseCount = 0
  let parkCount = 0
  for (const o of ok) {
    o._mergedHouses = [...(o.houseIds || [])]
    for (const hid of [...(o.houseIds || [])]) {
      if (!main.houseIds.includes(hid)) { main.houseIds.push(hid); houseCount++ }
      const h = houses.find(x => x.houseId === hid)
      if (h) h.ownerId = main.ownerId
    }
    for (const pid of [...(o.parkIds || [])]) {
      if (!main.parkIds.includes(pid)) { main.parkIds.push(pid); parkCount++ }
      const p = parkings.find(x => x.parkId === pid)
      if (p) p.ownerId = main.ownerId
    }
    o.houseIds = []
    o.parkIds = []
    o.ownerType = '已合并'
    o.remark = `已于 ${_now().slice(0, 10)} 合并至 ${main.ownerId}（${main.name}）`
    o._merged = true
    _syncOwnerRow(o)
  }
  main.remark = (main.remark ? main.remark + '；' : '') + `合并 ${ok.length} 条重复档案`
  // 房屋台账的「业主」列读 HOUSE_ROWS（含 ownerName），必须重建，否则合并后仍显示旧业主
  for (const o of ok) for (const hid of o._mergedHouses || []) {
    const h = houses.find(x => x.houseId === hid)
    if (h) _syncHouseRow(h)
  }
  _syncOwnerRow(main)
  return {
    main: { ...main }, merged: ok.length, houses: houseCount, parkings: parkCount, blocked,
    message: `已合并 ${ok.length} 条档案，过户 ${houseCount} 套房屋 / ${parkCount} 个车位` +
      (blocked.length ? `；${blocked.length} 条被拦截` : '')
  }
}

let OWNER_SEQ = owners.length
/**
 * 拆分：把指定房屋从原业主名下拆出，落到新业主（产权变更后）
 * 口径：拆分必须至少保留 1 套房屋在原业主名下；车位跟随房屋一起过户（同项目）
 */
export function splitOwnerHouses(ownerId, houseIds, { newOwnerName = '', phone = '' } = {}) {
  const o = owners.find(x => x.ownerId === ownerId)
  if (!o) throw new Error('原业主不存在')
  const hs = (o.houseIds || []).filter(id => houseIds.includes(id))
  if (!hs.length) throw new Error('请至少选择一套要拆出的房屋')
  if (hs.length === o.houseIds.length) throw new Error('不能把全部房屋拆出，原业主至少保留 1 套')
  const name = String(newOwnerName || '').trim()
  if (!name) throw new Error('请填写新业主姓名')
  OWNER_SEQ += 1
  const nid = 'OW' + String(OWNER_SEQ).padStart(5, '0')
  const newOwner = {
    ownerId: nid, name, phone: phone || '', idCard: '', gender: '', birthday: '',
    ownerType: '业主', certified: false, faceRegistered: false, appRegistered: false,
    wechatBound: false, email: '', emergencyContact: '', emergencyPhone: '',
    houseIds: [...hs], parkIds: [], tagIds: [], creditLevel: 'B',
    registerDate: _now().slice(0, 10), remark: `由 ${o.ownerId}（${o.name}）产权变更拆分而来`, _isNew: true
  }
  owners.push(newOwner)
  o.houseIds = o.houseIds.filter(id => !hs.includes(id))
  for (const hid of hs) {
    const h = houses.find(x => x.houseId === hid)
    if (h) h.ownerId = nid
  }
  o.remark = (o.remark ? o.remark + '；' : '') + `已拆出 ${hs.length} 套至 ${nid}`
  // 房屋的业主列读 HOUSE_ROWS（含 ownerName），只改 houses.ownerId 列表不刷新
  for (const hid of hs) { const h = houses.find(x => x.houseId === hid); if (h) _syncHouseRow(h) }
  _syncOwnerRow(newOwner, { insert: true })
  _syncOwnerRow(o)
  return { newOwnerId: nid, name, houses: hs.length, from: { ...o } }
}

// 业主名下房屋沿用文件顶部的 housesOfOwner（按 houses.ownerId 过滤，拆分过户后自动正确）

/* ==================================================================
 * X2 详情抽屉内联编辑：单字段更新（内存态，刷新还原）
 * 口径：只放开「改了不影响账目与权属」的字段；校验沿用 utils/rules 的正则口径；
 *       改完同步对应派生行（OWNER_ROWS / HOUSE_ROWS / WO_ROWS），否则列表不刷新。
 * ================================================================ */
const PHONE_RE = /^1[3-9]\d{9}$/
const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/* ---- 派生行同步：账单 / 房屋 / 缴费流水（第 9 批体检补齐）----
 * BILL_ROWS / HOUSE_ROWS / PAY_ROWS 都是浅拷贝派生行，写操作改原数组后必须重建，
 * 否则出现「催缴台还显示欠费、账单列表却已缴」这类同会话数字不一致。 */
function _syncBillRow(b, { insert = false } = {}) {
  const derived = billRow(b)
  const i = BILL_ROWS.findIndex(x => x.billId === b.billId)
  if (i >= 0) BILL_ROWS.splice(i, 1, derived)
  else if (insert) BILL_ROWS.unshift(derived)
  else BILL_ROWS.push(derived)
}

function _syncHouseRow(h, { insert = false } = {}) {
  const derived = houseRow(h)
  const i = HOUSE_ROWS.findIndex(x => x.houseId === h.houseId)
  if (i >= 0) HOUSE_ROWS.splice(i, 1, derived)
  else if (insert) HOUSE_ROWS.unshift(derived)
  else HOUSE_ROWS.push(derived)
}

function _syncPayRow(p, { insert = false } = {}) {
  const derived = payRow(p)
  const i = PAY_ROWS.findIndex(x => x.payId === p.payId)
  if (i >= 0) PAY_ROWS.splice(i, 1, derived)
  else if (insert) PAY_ROWS.unshift(derived)
  else PAY_ROWS.push(derived)
}

/** 业主：姓名 / 手机号 / 邮箱 / 应急联系人 / 信用等级 / 备注 */
const OWNER_EDITABLE = {
  name: { label: '姓名', check: v => (v ? '' : '姓名不能为空') },
  phone: { label: '手机号', check: v => (PHONE_RE.test(v) ? '' : '手机号格式不正确，应为 11 位数字') },
  email: { label: '邮箱', check: v => (!v || MAIL_RE.test(v) ? '' : '邮箱格式不正确') },
  emergencyContact: { label: '应急联系人' },
  emergencyPhone: { label: '应急联系电话', check: v => (!v || PHONE_RE.test(v) ? '' : '联系电话应为 11 位手机号') },
  creditLevel: { label: '信用等级', check: v => (['A', 'B', 'C'].includes(v) ? '' : '信用等级只能为 A / B / C') },
  remark: { label: '备注' },
  /* ---------- 客户画像（2026-11-02）· 枚举字段都做白名单校验，脏值进不了库 ---------- */
  ownerCategory: { label: '业主分类', check: v => (OWNER_CATEGORY.includes(v) ? '' : `业主分类只能是 ${OWNER_CATEGORY.join(' / ')}`) },
  economicLevel: { label: '家庭经济状况', check: v => (!v || ECON_LEVELS.includes(v) ? '' : '经济状况取值非法') },
  politicalStatus: { label: '政治面貌', check: v => (!v || POLITICAL_STATUS.includes(v) ? '' : '政治面貌取值非法') },
  weddingDate: { label: '结婚纪念日', check: v => (!v || /^\d{4}-\d{2}-\d{2}$/.test(v) ? '' : '结婚纪念日格式应为 YYYY-MM-DD') },
  employer: { label: '单位名称' },
  jobTitle: { label: '职务' },
  occupation: { label: '职业' },
  workAddress: { label: '工作地址' },
  hobbies: { label: '兴趣爱好' },
  pets: { label: '宠物信息' },
  positiveNotes: { label: '正面信息' },
  negativeNotes: { label: '负面信息' }
}
export const OWNER_CATEGORY = ['常住', '候鸟', '投资', '出租业主']
export const ECON_LEVELS = ['优渥', '良好', '一般', '困难']
export const POLITICAL_STATUS = ['中共党员', '共青团员', '群众', '民主党派']
export const OWNER_PROFILE_GROUPS = [
  { key: 'live', label: '居住与分类', fields: ['ownerCategory', 'weddingDate'] },
  { key: 'work', label: '职业与经济', fields: ['employer', 'jobTitle', 'occupation', 'workAddress', 'economicLevel'] },
  { key: 'prefer', label: '偏好', fields: ['hobbies', 'pets'] },
  { key: 'note', label: '评价', fields: ['positiveNotes', 'negativeNotes'] }
]
export const ownerEditableFields = () => Object.entries(OWNER_EDITABLE).map(([k, v]) => ({ field: k, label: v.label }))
export function updateOwnerField(ownerId, field, value, ver) {
  const o = owners.find(x => x.ownerId === ownerId)
  if (!o) throw new Error('业主不存在')
  const cfg = OWNER_EDITABLE[field]
  if (!cfg) throw new Error('该字段不支持内联编辑')
  const v = String(value ?? '').trim()
  if (cfg.check) { const e = cfg.check(v); if (e) throw new Error(e) }
  /* 并发：两个人同时改同一条时，后提交的拿到 409，由页面提示刷新（不静默覆盖） */
  checkVersion(o, ver)
  /* 唯一：手机号在业主档案里不允许重复（同号视为同一人，应走合并） */
  if (field === 'phone') assertUnique(owners, 'phone', v, { idKey: 'ownerId', excludeId: ownerId, label: '手机号' })
  o[field] = v
  bumpVersion(o)
  _syncOwnerRow(o)
  return { ...o }
}

/**
 * 业主档案整单保存（2026-11-13）。
 *
 * 之前这个表单是纯内存态：onSave 只做 400ms 延迟，新增/编辑都不落库 ——
 * 于是"在档案页给业主打标签"做了也白做，回列表就没了。
 * 这里补上写库：编辑整单覆盖，新增取 nextOwnerId；枚举字段逐个白名单校验，
 * 脏值进库后筛选与报表会出现"未知分类"，而且没人知道是哪条进来的。
 *
 * 人脸状态不在这里：它只能由「人脸核验」回写，表单改了就是绕过核验。
 */
export function saveOwnerProfile(payload = {}, ownerId = '') {
  const p = payload || {}
  const name = String(p.name || '').trim()
  if (name.length < 2 || name.length > 20) throw new Error('姓名应为 2–20 个字符')
  const phone = String(p.phone || '').trim()
  if (!PHONE_RE.test(phone)) throw new Error('手机号格式不正确，应为 11 位数字')
  assertUnique(owners, 'phone', phone, { idKey: 'ownerId', excludeId: ownerId, label: '手机号' })

  const checkEnum = (v, list, label) => {
    if (v && !list.includes(v)) throw new Error(`${label}只能是 ${list.join(' / ')}`)
  }
  checkEnum(p.ownerCategory, OWNER_CATEGORY, '业主分类')
  checkEnum(p.economicLevel, ECON_LEVELS, '家庭经济状况')
  checkEnum(p.politicalStatus, POLITICAL_STATUS, '政治面貌')
  if (p.weddingDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.weddingDate))) {
    throw new Error('结婚纪念日格式应为 YYYY-MM-DD')
  }

  /* 标签只收字典里存在的 id：词条被删/传错值时静默丢掉，别把孤儿 id 写进业主表 */
  const tagIds = [...new Set((p.tagIds || []).filter(tid => ownerTags.some(t => t.tagId === tid)))]
  const houseIds = [...new Set((p.houseIds || []).filter(hid => houses.some(h => h.houseId === hid)))]
  const base = {
    name, phone,
    idCard: String(p.idCard || '').trim(),
    gender: p.gender || '', birthday: p.birthday || '',
    ownerType: p.ownerType || '业主',
    creditLevel: p.creditLevel || 'A',
    registerDate: p.registerDate || TODAY,
    houseIds,
    emergencyContact: String(p.emergencyContact || '').trim(),
    emergencyPhone: String(p.emergencyPhone || '').trim(),
    email: String(p.email || '').trim(),
    certified: !!p.certified,
    appRegistered: !!p.appRegistered,
    remark: String(p.remark || ''),
    tagIds,
    ownerCategory: p.ownerCategory || '',
    economicLevel: p.economicLevel || '',
    politicalStatus: p.politicalStatus || '',
    occupation: String(p.occupation || '').trim(),
    employer: String(p.employer || '').trim(),
    weddingDate: p.weddingDate || '',
    negativeNotes: String(p.negativeNotes || '')
  }

  if (ownerId) {
    const o = owners.find(x => x.ownerId === ownerId)
    if (!o) throw new Error('业主不存在')
    Object.assign(o, base)
    bumpVersion(o)
    _syncOwnerRow(o)
    track('owner_update', { ownerId, tags: tagIds.length })
    return { ...o, tagIds: [...o.tagIds] }
  }

  const rec = {
    ownerId: nextOwnerId(),
    ...base,
    parkIds: [],
    faceRegistered: false,
    wechatBound: false
  }
  owners.unshift(rec)
  _syncOwnerRow(rec, { insert: true })
  track('owner_create', { ownerId: rec.ownerId })
  return { ...rec, tagIds: [...rec.tagIds] }
}

/** 房屋：使用状态 / 产权状态 / 装修情况 / 朝向 / 备注（不动面积与权属，避免影响账单口径） */
const HOUSE_PROPERTY_STATUS = ['已办证', '办理中', '未办理', '抵押中']
export const HOUSE_USE_OPTS = HOUSE_USE_STATUS
export const HOUSE_USAGE_OPTS = HOUSE_USAGE
export const HOUSE_PROPERTY_OPTS = HOUSE_PROPERTY_STATUS
const HOUSE_EDITABLE = {
  useStatus: { label: '使用状态', check: v => (HOUSE_USE_STATUS.includes(v) ? '' : `使用状态只能是 ${HOUSE_USE_STATUS.join(' / ')}`) },
  usage: { label: '用途', check: v => (HOUSE_USAGE.includes(v) ? '' : `用途只能是 ${HOUSE_USAGE.join(' / ')}`) },
  propertyStatus: { label: '产权状态', check: v => (HOUSE_PROPERTY_STATUS.includes(v) ? '' : '产权状态取值不合法') },
  decoration: { label: '装修情况' },
  /* 客户画像补充（2026-11-02）：交付日期与违规装修挂在房屋上 */
  deliverDate: { label: '交房日期', check: v => (!v || /^\d{4}-\d{2}-\d{2}$/.test(v) ? '' : '交房日期格式应为 YYYY-MM-DD') },
  decorationViolation: { label: '是否违规装修', check: v => (['无', '疑似', '已认定', '已整改'].includes(v) ? '' : '违规装修取值只能是 无 / 疑似 / 已认定 / 已整改') },
  decorationResult: { label: '违规处理结果' },
  orientation: { label: '朝向' },
  certNo: { label: '产权证号' },
  remark: { label: '备注' }
}
export function updateHouseField(houseId, field, value) {
  const h = houses.find(x => x.houseId === houseId)
  if (!h) throw new Error('房屋不存在')
  const cfg = HOUSE_EDITABLE[field]
  if (!cfg) throw new Error('该字段不支持内联编辑')
  const v = String(value ?? '').trim()
  if (cfg.check) { const e = cfg.check(v); if (e) throw new Error(e) }
  /* 内联改使用状态也要守住交付的边界：未交房的房子不能被标成已入住 / 正在装修，
     否则这套房当天就进计费与可出租候选，而它连钥匙都还没交。 */
  if (field === 'useStatus') {
    if (h.deliverStatus === '未交房' && v !== '未交房') {
      throw new Error(`${h.fullName} 还未交房，使用状态只能是「未交房」；请先在编辑页把交付状态改为「已交付」`)
    }
    if (v === '未交房' && h.deliverStatus !== '未交房') {
      throw new Error('「未交房」要连交付状态一起改：请到编辑页把交付状态改为「未交房」')
    }
  }
  h[field] = v
  const i = HOUSE_ROWS.findIndex(r => r.houseId === houseId)
  if (i >= 0) HOUSE_ROWS.splice(i, 1, houseRow(h))
  return { ...h }
}

/** 工单：优先级 / 处理人 / 备注（状态流转仍走列表操作，不放开，避免跳过流程节点） */
const WO_PRIORITY = ['特急', '紧急', '普通']
export const WO_PRIORITY_OPTS = WO_PRIORITY
const WO_EDITABLE = {
  priority: { label: '优先级', check: v => (WO_PRIORITY.includes(v) ? '' : '优先级只能为 特急 / 紧急 / 普通') },
  assignee: { label: '处理人', check: v => (v ? '' : '处理人不能为空') },
  remark: { label: '处理备注' }
}
function _syncWoRow(w) {
  const i = WO_ROWS.findIndex(r => r.woId === w.woId)
  if (i < 0) return
  const hs = HOUSE_SPACE.get(w.houseId)
  WO_ROWS.splice(i, 1, {
    ...w,
    buildingId: hs?.buildingId || '',
    buildingName: hs ? (BUILDING_OF.get(hs.buildingId)?.name || hs.buildingId) : '',
    unitId: hs?.unitId || '',
    unitName: hs ? unitNameOf(hs.unitId) : '',
    subjectType: w.houseId ? 'house' : 'public'
  })
}
export function updateWorkOrderField(woId, field, value) {
  const w = workOrders.find(x => x.woId === woId)
  if (!w) throw new Error('工单不存在')
  const cfg = WO_EDITABLE[field]
  if (!cfg) throw new Error('该字段不支持内联编辑')
  const v = String(value ?? '').trim()
  if (cfg.check) { const e = cfg.check(v); if (e) throw new Error(e) }
  if (WO_CLOSED.includes(w.status)) throw new Error(`工单「${w.status}」不可修改`)
  w[field] = v
  _syncWoRow(w)
  return { ...w }
}

/**
 * X3 批量操作：对勾选的多条工单改优先级 / 指派处理人
 * 口径：已关闭 / 已取消的工单不参与批量修改（状态流转必须走流程节点）；
 *       逐条执行、逐条收口，失败的单条不影响其他，回执给出成功数与失败原因。
 */
const WO_CLOSED = ['已关闭', '已取消']
export function batchUpdateWorkOrders(ids, patch = {}) {
  const fields = Object.keys(patch).filter(k => WO_EDITABLE[k] && patch[k] !== '' && patch[k] != null)
  if (!fields.length) throw new Error('请先选择要批量修改的内容')
  const ok = []
  const failed = []
  for (const id of ids) {
    const w = workOrders.find(x => x.woId === id)
    if (!w) { failed.push({ woId: id, woNo: id, reason: '工单不存在' }); continue }
    if (WO_CLOSED.includes(w.status)) { failed.push({ woId: id, woNo: w.woNo, reason: `状态「${w.status}」不可修改` }); continue }
    try {
      for (const f of fields) {
        const v = String(patch[f]).trim()
        const e = WO_EDITABLE[f].check?.(v)
        if (e) throw new Error(e)
        w[f] = v
      }
      _syncWoRow(w)
      ok.push({ woId: w.woId, woNo: w.woNo })
    } catch (e) {
      failed.push({ woId: id, woNo: w.woNo, reason: e.message })
    }
  }
  if (!ok.length) throw new Error(`没有可修改的工单：${failed[0]?.reason || '全部被拦截'}`)
  return {
    ok, failed,
    message: `已更新 ${ok.length} 条工单${failed.length ? `，${failed.length} 条被拦截` : ''}`
  }
}

/* ================= 收尾轮 · C4 合同审批流 =================
 * Q2 口径（2026-10-23 确认）：租约不走审批，本条流程只覆盖经营合同（劳动 / 外包 / 物业服务 / 采购）。
 * 新建合同 → 生成「合同审批」审批单，合同停在「待审批」；审批通过才转「待生效 / 履行中」。
 * 履约变更（续签 / 金额 / 期限 / 主体 / 提前终止）→ 生成变更单 + 审批单，通过后才回写合同并留痕。
 */

export const CONTRACT_CHANGE_TYPES = ['续签', '金额变更', '期限变更', '主体变更', '提前终止']

const CONTRACT_CHANGE_ROWS = []
let CHANGE_SEQ = 0
let APPROVAL_SEQ = approvals.reduce((m, a) => Math.max(m, +String(a.approvalId).replace(/\D/g, '') || 0), 0)

/** 合同派生行同步（列表 / 左树 / 汇总都读 CONTRACT_ROWS） */
function _syncContractRow(c, { insert = false } = {}) {
  /* 派生字段统一走 _contractRow：新增 / 变更后不重算年化，列表会显示旧值 */
  const derived = _contractRow(c)
  const i = CONTRACT_ROWS.findIndex(x => x.contractId === c.contractId)
  if (i >= 0) CONTRACT_ROWS.splice(i, 1, derived)
  else if (insert) CONTRACT_ROWS.unshift(derived)
  else CONTRACT_ROWS.push(derived)
}

/** 建审批单：≥30 万走三级（初审 → 法务 → 总经理），否则两级 */
function _newContractApproval(c, change = null) {
  APPROVAL_SEQ += 1
  const nodes = c.amount >= 300000
    ? ['合同初审', '法务复核', '总经理审批']
    : ['合同初审', '部门负责人审批']
  const ap = {
    approvalId: 'AP' + String(APPROVAL_SEQ).padStart(5, '0'),
    approvalNo: 'SP-2026-' + String(APPROVAL_SEQ).padStart(4, '0'),
    bizType: '合同审批',
    bizId: c.contractId,
    changeId: change ? change.changeId : '',
    title: change ? `${change.type}审批：${c.name}` : `新建合同审批：${c.name}`,
    communityId: c.communityId || '',
    communityName: c.communityId ? communityName(c.communityId) : '集团 / 全项目',
    amount: change ? (change.after.amount || c.amount) : c.amount,
    applicant: '系统操作员', applicantRole: '合同管理员',
    applyTime: _now(), status: '待审批', currentNode: nodes[0],
    urgency: c.amount >= 300000 ? '重要' : '普通', waitHours: 0,
    flow: nodes.map(n => ({ node: n, handler: '', action: '待处理', time: '', comment: '' }))
  }
  approvals.unshift(ap)
  return ap
}

/** 收入分类选项（三值；顺序即表单顺序：先主营、再经营、最后支出） */
export const CONTRACT_INCOME_CATEGORIES = ['主营业务', '多种经营', '不计入']

/** 按合同类型给的默认收入分类——只是省一次手点，用户随时可改 */
export function defaultIncomeCategory(type = '', subtype = '') {
  /* 租赁协议与多种经营都是经营收入；物业服务协议的补充协议通常是对物业费的补充约定，
     钱已经按账单收过，所以默认「不计入」，真正的收入仍走账单 */
  if (type === '租赁协议' || type === '多种经营') return '多种经营'
  if (type === '物业服务协议' && subtype === '项目物业服务合同') return '主营业务'
  return '不计入'
}

/**
 * 公共收益金额的规则校验（表单与接口共用一套）。
 * 三个错法都拦：分类不对却填了、超过合同金额、负数。
 */
export function contractIncomeCheck(p = {}) {
  const amt = Number(p.amount) || 0
  const cat = String(p.incomeCategory || '')
  const pub = Number(p.publicRevenue) || 0
  if (!cat) return '请选择收入分类（主营 / 多种经营 / 不计入）'
  if (!CONTRACT_INCOME_CATEGORIES.includes(cat)) return `收入分类只能是 ${CONTRACT_INCOME_CATEGORIES.join(' / ')}`
  if (pub < 0) return '公共收益金额不能为负数'
  if (cat !== '多种经营' && pub > 0) {
    return `「${cat}」的合同不该填公共收益金额 —— 公共收益只来自经营共有部位（广告位 / 商铺 / 公共车位）`
  }
  if (pub > amt) return `公共收益金额（${pub}）不能大于合同金额（${amt}）：归业主的部分不可能超过合同总额`
  return ''
}

/** 新建合同：落库（待审批）+ 生成审批单 */
export function createContract(d = {}) {
  const bad = contractIncomeCheck({
    amount: d.amount,
    incomeCategory: d.incomeCategory || defaultIncomeCategory(d.type, d.subtype),
    publicRevenue: d.publicRevenue
  })
  if (bad) throw Object.assign(new Error(bad), { code: 42208 })
  const seq = contracts.reduce((m, c) => Math.max(m, +String(c.contractId).replace(/\D/g, '') || 0), 0) + 1
  const c = {
    contractId: 'CT' + String(seq).padStart(4, '0'),
    contractNo: d.contractNo || nextContractNo(new Date().getFullYear()),
    name: d.name, type: d.type, subtype: d.subtype,
    communityId: d.communityId || '', orgId: d.orgId || '',
    partyB: d.partyB, contact: d.contact || '', phone: d.phone || '',
    amount: Number(d.amount) || 0, payCycle: d.payCycle || '月付',
    incomeCategory: d.incomeCategory || defaultIncomeCategory(d.type, d.subtype),
    publicRevenue: Number(d.publicRevenue) || 0,
    publicRevenueNote: d.publicRevenueNote || '',
    signDate: d.signDate || '', startDate: d.startDate || '', endDate: d.endDate || '',
    status: '待审批', owner: d.owner || '系统操作员', ownerEmpId: d.ownerEmpId || '',
    attachments: Number(d.attachments) || 0, refType: 'none', refId: '',
    remark: d.remark || '', _isNew: true
  }
  contracts.push(c)
  _syncContractRow(c, { insert: true })
  return { contract: { ...c }, approval: _newContractApproval(c) }
}

/** 履约变更：只登记变更单 + 审批单，审批通过后才回写合同（不允许直接改原合同） */
export function submitContractChange(contractId, { type, patch = {}, reason = '' } = {}) {
  const c = contracts.find(x => x.contractId === contractId)
  if (!c) throw new Error('合同不存在')
  if (!type) throw new Error('请选择变更类型')
  if (['已终止', '已到期'].includes(c.status)) throw new Error(`合同状态「${c.status}」，不能再发起变更`)
  if (c.changePending) throw new Error('该合同已有变更在审批中，请先处理完')
  const before = { name: c.name, amount: c.amount, partyB: c.partyB, startDate: c.startDate, endDate: c.endDate }
  const after = { ...before }
  for (const k of Object.keys(patch)) {
    const v = patch[k]
    if (v !== undefined && v !== null && v !== '') after[k] = k === 'amount' ? Number(v) : v
  }
  if (type !== '提前终止' && JSON.stringify(before) === JSON.stringify(after)) {
    throw new Error('变更内容与原合同一致，无需发起审批')
  }
  CHANGE_SEQ += 1
  const change = {
    changeId: 'CH' + String(CHANGE_SEQ).padStart(4, '0'),
    changeNo: 'BG-2026-' + String(CHANGE_SEQ).padStart(3, '0'),
    contractId, contractName: c.name, type, before, after,
    reason: reason || '未填写变更原因',
    applicant: '系统操作员', applyTime: _now(), status: '待审批', approvalId: ''
  }
  const ap = _newContractApproval(c, change)
  change.approvalId = ap.approvalId
  CONTRACT_CHANGE_ROWS.unshift(change)
  c.changePending = true
  _syncContractRow(c)
  return { change: { ...change }, approval: ap }
}

/** 某合同的变更记录（新的在前） */
export const contractChanges = contractId =>
  CONTRACT_CHANGE_ROWS.filter(x => x.contractId === contractId)
    .sort((a, b) => String(b.applyTime).localeCompare(String(a.applyTime)))

/** 待处理的合同变更数（列表页提示用） */
export const pendingContractChanges = () => CONTRACT_CHANGE_ROWS.filter(x => x.status === '待审批').length

/**
 * 审批单流转到合同域后的副作用：
 * 同意到最后一个节点 → 新合同转「待生效 / 履行中」、变更单「已生效」并回写合同；驳回 → 变更单「已驳回」、新合同退回「草稿」。
 */
/* ---------------- 报销域回写（2026-11-13） ----------------
 * 这一段以前是空的：「批准即结束」写了好几个版本，结果 OA 报销批完之后，
 * expenses 里没有这笔、支出归集看不到、财务报表永远少一块。
 *
 * 两条口径：
 *   ① 审批通过 → 落一张 **待付款** 的报销单（不是已付款）。付款日才确认支出，
 *      批了没付就记支出等于提前确认成本；
 *   ② 幂等：同一张审批单只落一次（a._expenseId 记下来），
 *      重复点「同意」不会生成两张报销单。
 */
const EXPENSE_CATEGORY_BY_TYPE = {
  办公费: 'EXP_OP_OFFICE',
  差旅费: 'EXP_OP_TRAVEL',
  招待费: 'EXP_OP_ENTERTAIN',
  维修材料: 'EXP_OP_REPAIR',
  其他: 'EXP_OP_OTHER'
}

function _applyExpenseApproval(a, action) {
  if (a.bizType !== '费用报销') return
  if (a.status !== '已通过') return
  if (a._expenseId) return
  const fd = a.formData || {}
  const period = String(fd.happenDate || TODAY).slice(0, 7)
  const amount = Math.round((Number(fd.amount) || oaItemsTotal(fd.items || [])) * 100) / 100
  if (!(amount > 0)) return
  const seq = expenses.reduce((m, x) => Math.max(m, Number(String(x.expenseId).replace(/\D/g, '')) || 0), 0) + 1
  const rows = Array.isArray(fd.items) ? fd.items.map(r => ({
    ...r, total: oaItemTotal(r)
  })) : []
  const rec = {
    expenseId: 'EX' + String(seq).padStart(4, '0'),
    applyNo: `EXP-${period.replace('-', '')}-${String(seq).padStart(3, '0')}`,
    expenseType: fd.expenseType || '其他',
    categoryId: EXPENSE_CATEGORY_BY_TYPE[fd.expenseType] || 'EXP_OP_OTHER',
    amount,
    happenDate: fd.happenDate || TODAY,
    period,
    communityId: fd.communityId || a.communityId || '',
    communityName: communityName(fd.communityId || a.communityId || ''),
    applicant: a.applicant || currentOperator().name,
    status: '待付款',
    payDate: '',
    invoiceCount: Number(fd.invoiceCount) || 0,
    reason: fd.reason || `${fd.expenseType || '费用'}报销`,
    items: rows,
    approvalId: a.approvalId,
    source: 'OA',
    createdAt: _now()
  }
  expenses.unshift(rec)
  a._expenseId = rec.expenseId
  track('expense_from_oa', { approvalId: a.approvalId, amount })
}

/** 待付款的报销单：批了没付的钱，支出归集要单独提示 */
export function pendingExpenses() {
  return expenses.filter(x => x.status === '待付款')
    .slice()
    .sort((a, b) => String(a.happenDate).localeCompare(String(b.happenDate)))
    .map(x => ({ ...x }))
}

/**
 * 确认付款：只有付了款才进支出。
 * 不做"审批通过即付款"的自动转换 —— 财务实际打款日期与审批日期经常差半个月，
 * 按审批日确认成本会让当月的支出结构失真。
 */
export function payExpense(expenseId, { payDate = '', remark = '' } = {}) {
  const x = expenses.find(e => e.expenseId === expenseId)
  if (!x) throw new Error('报销单不存在')
  if (x.status === '已付款') throw new Error('该报销单已付款')
  x.status = '已付款'
  x.payDate = payDate || TODAY
  if (remark) x.payRemark = String(remark).slice(0, 60)
  return { ...x }
}

function _applyContractApproval(a, action) {
  if (a.bizType !== '合同审批') return
  const c = contracts.find(x => x.contractId === a.bizId)
  if (!c) return
  const change = a.changeId ? CONTRACT_CHANGE_ROWS.find(x => x.changeId === a.changeId) : null
  if (action === '驳回') {
    if (change) { change.status = '已驳回'; change.auditTime = _now(); c.changePending = false }
    else c.status = '草稿'
    _syncContractRow(c)
    return
  }
  if (a.status !== '已通过') return          // 中间节点同意，业务单不动
  if (change) {
    change.status = '已生效'; change.auditTime = _now()
    Object.assign(c, change.after)
    c.changePending = false
    c.status = change.type === '提前终止' ? '已终止' : '履行中'
  } else {
    c.status = daysBetween(c.startDate) < 0 ? '待生效' : '履行中'
  }
  _syncContractRow(c)
}

/* 演示数据：给 3 份履约中的经营合同补「已生效」的变更记录（内存态，不动种子文件） */
for (const c of contracts.filter(x => x.status === '履行中' && x.type !== '租赁').slice(0, 3)) {
  CHANGE_SEQ += 1
  CONTRACT_CHANGE_ROWS.push({
    changeId: 'CH' + String(CHANGE_SEQ).padStart(4, '0'),
    changeNo: 'BG-2026-' + String(CHANGE_SEQ).padStart(3, '0'),
    contractId: c.contractId, contractName: c.name,
    type: ['续签', '金额变更', '期限变更'][CHANGE_SEQ % 3],
    before: { amount: Math.round(c.amount * 0.92), partyB: c.partyB, endDate: c.endDate },
    after: { amount: c.amount, partyB: c.partyB, endDate: c.endDate },
    reason: ['原合同到期，按原条款续签一年', '服务范围扩大，按补充协议调价', '甲方场地交付延期，顺延到期日'][CHANGE_SEQ % 3],
    applicant: c.owner || '系统操作员', applyTime: `2026-0${(CHANGE_SEQ % 3) + 7}-1${CHANGE_SEQ % 3} 10:20`,
    status: '已生效', approvalId: '', auditTime: `2026-0${(CHANGE_SEQ % 3) + 7}-1${CHANGE_SEQ % 3} 16:40`
  })
}

/* ================= 收尾轮 · E4 行级数据过滤 =================
 * Q8 口径（2026-10-23 确认）：五档真正生效，不再只做展示；2026-10-29 增第六档「责任范围」。
 * 原型没有「个人登录」，用该角色首位在职员工作为锚点解析「本项目 / 本部门 / 仅本人」。
 * 规则：
 *   全部项目 → 不过滤
 *   指定项目 → 行归属项目 ∈ 角色白名单
 *   本项目   → 行归属项目 = 锚点员工所在项目（组织 ID 前缀 O-P01 直接映射）
 *   本部门   → 行归属项目 ∈ 锚点员工所在部门及其下级班组覆盖的项目
 *   仅本人   → 有经手人字段的列表（工单处理人 / 巡检执行人）只看本人；没有经手人字段的
 *              资产与费用类列表，按锚点所属项目收窄（与 E 域说明一致，避免整页空白）
 */

/** 组织 → 所属项目：O-P01 / O-P01-T2 都归 P01；总部职能中心无项目 */
export function communityOfOrg(orgId) {
  const m = /^O-(P\d{2})/.exec(String(orgId || ''))
  return m ? m[1] : ''
}

/** 当前角色的数据范围（每次调用现算，切角色立刻生效） */
/** 员工姓名 → 所在组织（班组级）。同名取第一条；用于「本部门」按经手人组织过滤 */
const ORG_OF_EMP_NAME = new Map(EMP_ROWS.map(e => [e.name, e.orgId]))
export const orgOfEmpName = name => ORG_OF_EMP_NAME.get(name) || ''

/**
 * 巡检任务的归属班组：任务自带 executorOrgId 优先（由执行计划的「岗位 + 项目」推导），
 * 缺失时才退回按执行人姓名反查。执行人是计划上的运营设定值、未必在员工名册里，
 * 只靠姓名反查会让整批任务在「本部门」视图里丢失（P0-5 实测踩到）。
 */
export const orgOfTask = t =>
  t.executorOrgId || orgOfEmpName(t.executor) || `O-${t.communityId}-T1`

export function currentScope() {
  const role = ROLE_OF.get(currentRoleId.value)
  if (!role) return { roleId: '', roleName: '', mode: '全部项目', communityIds: null, empId: '', anchorName: '', orgName: '', hint: '' }
  const emps = EMP_ROWS.filter(e => e.roleId === role.roleId && e.status !== '离职')
  // 锚点规则：优先取挂在项目部（组织 ID 能映射到项目）的员工，避免锚在总部导致整页空白；
  // 「仅本人」取该角色经手单据最多的一位，保证这个视角有可看数据。
  const projectEmps = emps.filter(e => communityOfOrg(e.orgId))
  const workload = e => workOrders.filter(w => w.assignee === e.name).length * 2
    + inspectTasks.filter(t => t.executor === e.name).length
  const anchor = role.dataScope === '仅本人'
    ? [...emps].sort((a, b) => workload(b) - workload(a))[0]
    : (projectEmps[0] || emps[0])
  const org = anchor ? orgs.find(o => o.orgId === anchor.orgId) : null
  const orgIds = new Set()
  const collect = id => { orgIds.add(id); orgs.filter(o => o.parentId === id).forEach(o => collect(o.orgId)) }
  if (anchor) collect(anchor.orgId)
  const deptCommunities = [...new Set([...orgIds].map(communityOfOrg).filter(Boolean))]
  const myCommunity = communityOfOrg(anchor?.orgId)
  const base = {
    roleId: role.roleId, roleName: role.name, mode: role.dataScope,
    anchorName: anchor?.name || '', orgName: org?.name || '',
    communityIds: null, empId: anchor?.empId || ''
  }
  if (role.dataScope === '责任范围') {
    const hs = HOUSES_OF_STEWARD.get(anchor?.empId) || new Set()
    const comms = new Set()
    for (const h of houses) if (hs.has(h.houseId)) comms.add(h.communityId)
    return { ...base, houseIds: hs, communityIds: comms }
  }
  if (role.dataScope === '指定项目') return { ...base, communityIds: new Set(role.communities || []) }
  if (role.dataScope === '本项目') return { ...base, communityIds: new Set(myCommunity ? [myCommunity] : []) }
  // 「本部门」= 该组长所在班组子树。orgIds 用于巡检/工单这类有「经手人组织」的行，
  // communityIds 只作资产与费用类（没有组织维度）的兜底收窄，避免整页空白。
  if (role.dataScope === '本部门') return { ...base, orgIds, communityIds: new Set(deptCommunities) }
  if (role.dataScope === '仅本人') return { ...base, communityIds: new Set(myCommunity ? [myCommunity] : []) }
  return { ...base, mode: '全部项目', communityIds: null }
}

/** 当前范围的说明文案，页面顶部可直接展示 */
export function scopeHint() {
  const s = currentScope()
  if (s.mode === '全部项目') return '全部项目：不受项目限制'
  const names = [...(s.communityIds || [])].map(id => communityName(id)).join('、') || '无可用项目'
  if (s.mode === '仅本人') return `仅本人：${s.anchorName || '—'} 经手的工单 / 巡检任务；资产与费用按 ${names} 收窄`
  if (s.mode === '本项目') return `本项目：${names}（锚点 ${s.anchorName || '—'}）`
  if (s.mode === '本部门') return `本部门：${s.orgName || '—'}（只看本班组经手；资产与费用按 ${names} 收窄）`
  return `指定项目：${names}`
}

/**
 * 通用行过滤。
 * communities: 返回行所属项目（字符串）或项目集合（Set）
 * emp: 「仅本人」时用于取行的经手人（姓名），不传则退回按项目收窄
 */
export function scopeFilter(list, { communities: getComm = r => r.communityId, emp = null, org = null, house = null } = {}) {
  const s = currentScope()
  if (s.mode === '全部项目') return list
  if (s.mode === '仅本人' && emp) return list.filter(r => emp(r) === s.anchorName)
  /* 责任范围：只有落在该楼管责任范围内的房屋才可见（默认拒绝，不按项目放宽） */
  if (s.mode === '责任范围') {
    const ids = s.houseIds || new Set()
    if (house) {
      return list.filter(r => {
        const v = house(r)
        if (v instanceof Set) { for (const x of v) if (ids.has(x)) return true; return false }
        return ids.has(v)
      })
    }
    /* 没有房屋维度的实体（合同/公告等），退回按项目收窄 */
    return list.filter(r => (s.communityIds || new Set()).has(getComm(r)))
  }
  // 「本部门」优先按组织子树过滤（组长只看本班组经手的单据），没传 org 时退回按项目收窄
  if (s.mode === '本部门' && org && s.orgIds && s.orgIds.size) {
    return list.filter(r => s.orgIds.has(org(r)))
  }
  const ids = s.communityIds || new Set()
  return list.filter(r => {
    const v = getComm(r)
    if (v instanceof Set) { for (const x of v) if (ids.has(x)) return true; return false }
    return ids.has(v)
  })
}

/** 待办行只有 communityName，转成 id 再过滤 */
const CID_OF_NAME = new Map(communities.map(c => [c.name, c.id]))
const todoComm = r => CID_OF_NAME.get(r.communityName) || ''

/* ================= 收尾轮 · B 级占位补齐（2026-10-23） =================
 * 六处原本「仅提示」的动作改成真实写操作（内存态 + 回执）：
 * 调整角色 / 提醒实名认证 / 公告补推未读 / 下载合同附件（页面侧走下载中心）/ 发起整改 / 安排复查
 */

/** 调整成员角色：写覆盖表 → 重建该员工派生行 → 受影响的两个角色重算人数 */
export function updateEmployeeRole(empId, roleId) {
  const e = employees.find(x => x.empId === empId)
  if (!e) throw new Error('员工不存在')
  const r = ROLE_OF.get(roleId)
  if (!r) throw new Error('角色不存在')
  const before = empRow(e)
  if (before.roleId === roleId) throw new Error(`该成员已是「${r.name}」，无需调整`)
  EMP_ROLE_OVERRIDE.set(empId, roleId)
  const i = EMP_ROWS.findIndex(x => x.empId === empId)
  if (i >= 0) EMP_ROWS.splice(i, 1, empRow(e))
  for (const rid of [before.roleId, roleId]) {
    if (!rid) continue
    const j = ROLE_ROWS.findIndex(x => x.roleId === rid)
    if (j >= 0) {
      ROLE_ROWS.splice(j, 1, { ...ROLE_ROWS[j], userCount: EMP_ROWS.filter(x => x.roleId === rid).length })
    }
  }
  return {
    empId, name: e.name, roleId, roleName: r.name,
    from: before.roleName, fromRoleId: before.roleId,
    permCount: r.perms.length, dataScope: r.dataScope
  }
}

/** 提醒实名认证：记录提醒时间（短信 + 站内信），详情页按钮变「已提醒」 */
const TENANT_REMIND = new Map()
export function remindTenantAuth(tenantId) {
  const t = tenants.find(x => x.tenantId === tenantId)
  if (!t) throw new Error('租户不存在')
  if (t.certified) throw new Error('该租户已完成实名认证')
  const at = _now()
  TENANT_REMIND.set(tenantId, at)
  return { at, name: t.name, phone: t.phone, channels: ['短信', '站内信'] }
}
export const tenantRemindAt = tenantId => TENANT_REMIND.get(tenantId) || ''

/** 公告补推未读：按「覆盖户数 - 已读」计算补推人数，累计记录 */
export function repushNotice(noticeId) {
  const n = notices.find(x => x.noticeId === noticeId)
  if (!n) throw new Error('公告不存在')
  if (!['已发布', '已过期'].includes(n.status)) throw new Error(`公告状态「${n.status}」，不能补推`)
  const unread = Math.max(0, (n.targetHouses || 0) - (n.readCount || 0))
  if (!unread) throw new Error('没有未读业主，无需补推')
  n.repushCount = (n.repushCount || 0) + unread
  n.repushAt = _now()
  _syncNoticeRow(n)
  return { unread, at: n.repushAt, channels: n.channels, total: n.repushCount }
}

/** 发起整改：只改状态与整改开始时间，不建工单（建工单走 createWoFromQuality） */
export function startQualityRectify(checkId) {
  const q = qualityChecks.find(x => x.checkId === checkId)
  if (!q) throw new Error('检查记录不存在')
  if (['整改中', '已闭环'].includes(q.status)) throw new Error(`当前状态「${q.status}」，无需再次发起`)
  q.status = '整改中'
  q.rectifyStartAt = _now()
  _syncQualityRow(q)
  return { checkId, status: q.status, at: q.rectifyStartAt, count: q.rectifyCount }
}

/** 安排复查：置复查标记与复查日期（默认 +7 天） */
export function scheduleQualityRecheck(checkId, days = 7) {
  const q = qualityChecks.find(x => x.checkId === checkId)
  if (!q) throw new Error('检查记录不存在')
  if (q.recheck) throw new Error('该记录已安排复查')
  const d = new Date()
  d.setDate(d.getDate() + days)
  q.recheck = true
  q.recheckDate = d.toISOString().slice(0, 10)
  _syncQualityRow(q)
  return { checkId, recheckDate: q.recheckDate, days }
}

/** 合同附件清单（原型无真实文件，下载中心按份数生成清单） */
export function contractAttachmentRows(contractId) {
  const c = CONTRACT_ROWS.find(x => x.contractId === contractId)
  if (!c) throw new Error('合同不存在')
  const n = Number(c.attachments) || 0
  if (!n) throw new Error('该合同未上传附件')
  const kinds = ['合同正本', '补充协议', '报价单', '资质证明', '验收单']
  return Array.from({ length: n }, (_, i) => ({
    no: i + 1,
    name: `${c.name} · ${kinds[i % kinds.length]}`,
    file: `${c.contractNo}-${String(i + 1).padStart(2, '0')}.pdf`,
    size: `${(0.6 + i * 0.35).toFixed(1)} MB`,
    uploadAt: c.signDate || c.startDate || ''
  }))
}

/* ================= P1 · 巡检模板管理 =================
 * 口径（2026-10-29 确认）：执行模板与监督模板**统一由品质督导维护**，其他角色只读。
 * 执行模板告诉一线「做什么、什么算合格」；监督模板告诉部门经理「查下属哪些方面」。
 * 模板是公司级标准，不按项目隔离（不带 communityId），部门经理对模板只读。
 */

export const TPL_TYPES = ['执行', '监督']
/** 检查项采集方式：与 seed 里的字段类型保持一致 */
export const TPL_FIELD_TYPES = ['拍照', '扫码', '单选', '评分', '文本']

/** 模板启停（内存态，刷新还原） */
const TPL_STATUS = new Map()
export const tplStatusOf = t => TPL_STATUS.get(t.templateId) || '启用'

/** 引用该模板的计划（决定能否停用 / 删除） */
const plansOfTemplate = id => inspectPlans.filter(p => p.templateId === id)

/** 模板的「适用岗位」：执行看 post，监督看 targetPost（被检岗位） */
const applyPostOf = t => (t.type === '监督' ? t.targetPost : t.post) || ''

/** 模板列表：按类型 / 岗位 / 状态 / 关键字过滤，并补「被引用」统计 */
export function inspectTemplateRows(filters = {}) {
  const kw = String(filters.kw || '').trim()
  return inspectTemplates
    .filter(t => !filters.type || (t.type || '执行') === filters.type)
    .filter(t => !filters.post || applyPostOf(t) === filters.post)
    .filter(t => !filters.status || tplStatusOf(t) === filters.status)
    .filter(t => !kw || [t.name, t.templateId, t.version, applyPostOf(t)].some(v => String(v || '').includes(kw)))
    .map(t => {
      const ps = plansOfTemplate(t.templateId)
      const fields = t.fields || []
      return {
        ...t,
        /* fields 必须浅拷贝出一份新数组：检查项是原地 push/splice 修改的，
           直接透传原数组会让调用方的 computed 认为「值没变」而不重渲染
           （实测：列表已变 6 项、编辑弹窗内表格仍停在 5 项） */
        fields: fields.map(f => ({ ...f, options: f.options ? [...f.options] : undefined })),
        type: t.type || '执行',
        applyPost: applyPostOf(t),
        status: tplStatusOf(t),
        fieldCount: fields.length,
        requiredCount: fields.filter(f => f.required).length,
        planCount: ps.length,
        taskCount: inspectTasks.filter(k => k.templateId === t.templateId).length
      }
    })
}

/** 模板汇总：两类各多少、检查项总量、被引用比例 */
export function inspectTemplateSummary() {
  const rows = inspectTemplateRows()
  const fields = rows.reduce((s, t) => s + t.fieldCount, 0)
  const used = rows.filter(t => t.planCount > 0).length
  return {
    total: rows.length,
    exec: rows.filter(t => t.type === '执行').length,
    sup: rows.filter(t => t.type === '监督').length,
    fields,
    used,
    unused: rows.length - used
  }
}

/** 模板详情：模板 + 引用它的计划（列表页抽屉用） */
export function getInspectTemplateDetail(templateId) {
  const t = inspectTemplates.find(x => x.templateId === templateId)
  if (!t) return null
  return {
    template: { ...t, type: t.type || '执行', applyPost: applyPostOf(t), status: tplStatusOf(t) },
    plans: plansOfTemplate(templateId).map(p => ({
      planId: p.planId, name: p.name, taskType: p.taskType || '执行',
      communityName: communityName(p.communityId), executor: p.executor, status: p.status
    }))
  }
}

/** 岗位 / 班组 / 组长选项（计划表单与模板表单共用） */
export const tplPostOpts = filterType => {
  const src = filterType === '监督'
    ? inspectTemplates.filter(t => (t.type || '执行') === '监督').map(t => t.targetPost)
    : inspectTemplates.filter(t => (t.type || '执行') === '执行').map(t => t.post)
  return [...new Set(src.filter(Boolean))].sort()
}
/** 被检班组：组织树里的班组节点 */
export const inspectTargetDeptOpts = () =>
  orgs.filter(o => o.type === '班组').map(o => ({
    id: o.orgId, name: `${o.name}（${o.leader || '无组长'}）`, communityId: communityOfOrg(o.orgId)
  }))
/** 组长池：四个主管岗位的在职员工（监督计划的执行人只能从这里选） */
export const deptManagerOpts = () =>
  employees
    .filter(e => e.status === '在职' && DEPT_MANAGER_POSTS.includes(e.position))
    .map(e => ({
      id: e.name, name: `${e.name} · ${e.position}`,
      post: e.position.replace('主管', ''), communityId: communityOfOrg(e.orgId) || ''
    }))

/** 四个组长岗位（与 roles.json 的部门经理 positions 一致） */
export const DEPT_MANAGER_POSTS = ['客服主管', '工程主管', '安保主管', '环境主管']

let TPL_SEQ = inspectTemplates.length

/** 模板表单校验：名称 / 类型 / 适用岗位 / 至少一个检查项 */
function _validateTpl(d, { isNew = true } = {}) {
  const name = String(d.name || '').trim()
  if (!name) throw new Error('请填写模板名称')
  if (!TPL_TYPES.includes(d.type)) throw new Error('请选择模板类型（执行 / 监督）')
  const post = String(d.applyPost || '').trim()
  if (!post) throw new Error(d.type === '监督' ? '请选择被检岗位' : '请选择适用岗位')
  if (isNew && !(d.fields || []).length) throw new Error('至少添加一个检查项')
  const dup = inspectTemplates.find(t => t.name === name && t.templateId !== d.templateId)
  if (dup) throw new Error(`模板名称「${name}」已存在`)
  if (!/^v?\d+(\.\d+)?$/.test(String(d.version || 'v1.0'))) throw new Error('版本号格式如 v1.0')
}

/** 新建模板 */
export function createInspectTemplate(d = {}) {
  _validateTpl(d, { isNew: true })
  TPL_SEQ += 1
  const t = {
    templateId: 'TP-N' + String(TPL_SEQ).padStart(3, '0'),
    name: String(d.name).trim(),
    type: d.type,
    post: d.type === '监督' ? '' : d.applyPost,
    targetPost: d.type === '监督' ? d.applyPost : '',
    version: d.version || 'v1.0',
    fields: (d.fields || []).map(f => ({ ...f })),
    _isNew: true
  }
  inspectTemplates.push(t)
  return { ...t, status: '启用' }
}

/** 编辑模板基本信息（类型不可改：改类型会让已生成的计划与任务口径错乱） */
export function updateInspectTemplate(templateId, d = {}) {
  const t = inspectTemplates.find(x => x.templateId === templateId)
  if (!t) throw new Error('模板不存在')
  if (d.type && d.type !== (t.type || '执行')) {
    throw new Error('模板类型不可修改，请新建一个模板')
  }
  _validateTpl({ ...d, type: t.type || '执行', templateId }, { isNew: false })
  t.name = String(d.name).trim()
  if ((t.type || '执行') === '监督') t.targetPost = d.applyPost
  else t.post = d.applyPost
  t.version = d.version || t.version
  if (Array.isArray(d.fields)) t.fields = d.fields.map(f => ({ ...f }))
  return { ...t }
}

/** 启用 / 停用：停用不影响历史任务；有启用中计划引用时给提示 */
export function setTemplateStatus(templateId, status) {
  const t = inspectTemplates.find(x => x.templateId === templateId)
  if (!t) throw new Error('模板不存在')
  if (!['启用', '停用'].includes(status)) throw new Error('状态只能是启用或停用')
  if (status === '停用') {
    const live = plansOfTemplate(templateId).filter(p => p.status === '启用')
    if (live.length) throw new Error(`还有 ${live.length} 个启用中的计划在使用该模板，请先停用计划`)
  }
  TPL_STATUS.set(templateId, status)
  return { templateId, status }
}

/** 检查项：增 / 改 / 删 / 上下移；改动后自动把版本号 +0.1 */
function _tplById(id) {
  const t = inspectTemplates.find(x => x.templateId === id)
  if (!t) throw new Error('模板不存在')
  t.fields = t.fields || []
  return t
}
function _bumpVersion(t) {
  const m = /^v?(\d+)\.(\d+)$/.exec(t.version || 'v1.0')
  t.version = m ? `v${m[1]}.${Number(m[2]) + 1}` : 'v1.1'
}
function _checkField(f) {
  const label = String(f.label || '').trim()
  if (!label) throw new Error('请填写检查项名称')
  if (!TPL_FIELD_TYPES.includes(f.type)) throw new Error('请选择采集方式')
  if (f.type === '单选' && !(f.options || []).filter(Boolean).length) throw new Error('「单选」需要至少一个选项')
  if (f.type === '拍照' && !String(f.standard || '').trim()) throw new Error('「拍照」需要填写合格标准')
  return { ...f, label }
}

export function addTemplateField(templateId, field) {
  const t = _tplById(templateId)
  const f = _checkField(field)
  if (t.fields.some(x => x.label === f.label)) throw new Error(`检查项「${f.label}」已存在`)
  t.fields.push(f)
  _bumpVersion(t)
  return { ...t }
}
export function updateTemplateField(templateId, index, field) {
  const t = _tplById(templateId)
  if (!t.fields[index]) throw new Error('检查项不存在')
  const f = _checkField(field)
  t.fields.splice(index, 1, f)
  _bumpVersion(t)
  return { ...t }
}
export function removeTemplateField(templateId, index) {
  const t = _tplById(templateId)
  if (!t.fields[index]) throw new Error('检查项不存在')
  if (t.fields.length <= 1) throw new Error('模板至少保留一个检查项')
  t.fields.splice(index, 1)
  _bumpVersion(t)
  return { ...t }
}
export function moveTemplateField(templateId, index, dir) {
  const t = _tplById(templateId)
  const to = index + (dir === 'up' ? -1 : 1)
  if (to < 0 || to >= t.fields.length) throw new Error('已经到边界了')
  const [f] = t.fields.splice(index, 1)
  t.fields.splice(to, 0, f)
  return { ...t }
}

/** 删除模板：被计划引用时不允许删（改停用） */
export function deleteInspectTemplate(templateId) {
  const t = inspectTemplates.find(x => x.templateId === templateId)
  if (!t) throw new Error('模板不存在')
  const ps = plansOfTemplate(templateId)
  if (ps.length) throw new Error(`还有 ${ps.length} 个计划引用该模板，不能删除；可改为停用`)
  inspectTemplates.splice(inspectTemplates.indexOf(t), 1)
  TPL_STATUS.delete(templateId)
  return { templateId }
}

/** 按类型取模板下拉（计划表单用：选监督就只能选监督模板） */
export const templateOptionsOf = type =>
  inspectTemplates
    .filter(t => !type || (t.type || '执行') === type)
    .map(t => ({
      templateId: t.templateId,
      label: `${t.name}（${(t.fields || []).length} 项）`,
      type: t.type || '执行',
      applyPost: applyPostOf(t),
      count: (t.fields || []).length
    }))

/* ================= P1 · 巡检任务提交（执行 / 监督） =================
 * 移动端作业台提交时统一走这里，避免页面各自拼装状态与问题记录。
 * 监督任务的口径：问题项必须指定责任员工（否则考核归不到人），
 * 并与同一班组当日的执行任务对比，标出「员工报正常、组长查出问题」的冲突。
 */

export const INSPECT_ISSUE_REASONS = ['未达标', '未按时完成', '记录不实', '在岗异常', '安全隐患']

/** 某班组的在职员工（监督任务指定责任员工的候选池） */
export const employeesOfTeam = orgId =>
  EMP_ROWS.filter(e => e.orgId === orgId && e.status !== '离职')

/** 该班组当日「员工申报无异常」的执行任务数（用于冲突判定） */
function _cleanClaimsOn(t) {
  return inspectTasks.filter(x =>
    x.taskType !== '监督' &&
    x.scheduledDate === t.scheduledDate &&
    (x.executorOrgId || '') === (t.targetDept || '') &&
    ['已完成', '已转工单'].includes(x.status) &&
    (x.issueCount || 0) === 0
  )
}

/**
 * 提交巡检结果。
 * payload.items: [{ label, state:'ok'|'ng', reason, note, responsibleName }]
 */
export function submitInspectResult(taskId, payload = {}) {
  const t = inspectTasks.find(x => x.taskId === taskId)
  if (!t) throw new Error('任务不存在')
  if (!['待执行', '执行中', '逾期'].includes(t.status)) throw new Error(`任务状态「${t.status}」，不能重复提交`)
  const rows = payload.items || []
  if (!rows.length) throw new Error('没有可提交的检查项')
  const ng = rows.filter(i => i.state === 'ng')
  const isSup = t.taskType === '监督'

  if (isSup) {
    for (const it of ng) {
      if (!String(it.responsibleName || '').trim()) {
        throw new Error(`问题项「${it.label}」必须指定责任员工后才能提交`)
      }
    }
  } else if (ng.some(i => !String(i.note || '').trim())) {
    throw new Error('异常项必须填写说明（或拍照）')
  }

  const now = _now()
  t.status = '已完成'
  t.doneTime = now
  t.duration = t.duration || 30
  t.itemCount = rows.length
  t.normalCount = rows.length - ng.length
  t.issueCount = ng.length
  t.photos = ng.length + (payload.photos || 0)
  t.score = Math.max(0, 100 - ng.length * (isSup ? 5 : 3))
  t.remark = payload.remark || ''

  if (isSup) {
    t.issueItems = ng.map(i => ({
      item: i.label,
      deduct: 2,
      reason: i.reason || '未达标',
      note: i.note || '',
      responsibleName: i.responsibleName,
      responsibleEmpId: (employeesOfTeam(t.targetDept).find(e => e.name === i.responsibleName) || {}).empId || ''
    }))
    t.hitEmployees = [...new Set(t.issueItems.map(i => i.responsibleName))]
    /* 冲突：本班组当日有「零异常」的执行任务，而组长现场查出问题 —— 这正是防作弊要看的数据 */
    const claims = ng.length ? _cleanClaimsOn(t) : []
    t.conflictFlag = claims.length > 0
    t.conflictTaskIds = claims.map(c => c.taskId)
  }
  return { ...t, conflictCount: (t.conflictTaskIds || []).length }
}

/** 监督任务的「可指定责任员工」候选（按被检班组过滤，排除组长本人） */
export const responsibilityOpts = task =>
  employeesOfTeam(task?.targetDept || '')
    .filter(e => e.name !== task?.executor)
    .map(e => ({ name: e.name, label: `${e.name} · ${e.position}` }))

/** 组织名称（监督任务的被检班组显示用） */
export const orgNameOf = orgId => (orgs.find(o => o.orgId === orgId) || {}).name || orgId || '—'

/* ================= P1 · 品质达标率与扣分分档 =================
 * 口径（2026-10-29 确认）：
 *   达标率 = 检查项合格率 × 70% + 任务完成率 × 30%，权重按岗位可配；
 *   问题处置分「自查 / 被查」两档 —— 自查发现问题对部门扣分轻、对主管记「发现问题数」（正向）；
 *   被品质抽查发现问题对部门扣分重、对主管减分（主管没查出来）。
 * 这样主管主动查对自己有利，防作弊机制才推得下去（否则"多做多错"）。
 */

/** 各岗位默认权重（可配，见 setQualityWeight） */
export const QUALITY_WEIGHTS = {
  环境: { pass: 0.7, done: 0.3 },
  安保: { pass: 0.6, done: 0.4 },
  工程: { pass: 0.8, done: 0.2 },
  客服: { pass: 0.7, done: 0.3 }
}
const WEIGHT_OVERRIDE = new Map()
export const qualityWeightOf = post => {
  const w = WEIGHT_OVERRIDE.get(post) || QUALITY_WEIGHTS[post]
  return w ? { ...w } : { pass: 0.7, done: 0.3 }
}
/** 调整某岗位权重（两者相加须为 1） */
export function setQualityWeight(post, pass, done) {
  const p = Number(pass), d = Number(done)
  if (!(p >= 0 && p <= 1) || !(d >= 0 && d <= 1)) throw new Error('权重须在 0–1 之间')
  if (Math.abs(p + d - 1) > 0.001) throw new Error('合格率与完成率的权重之和必须为 1')
  WEIGHT_OVERRIDE.set(post, { pass: p, done: d })
  return { post, pass: p, done: d }
}
/** 权重表（页面渲染用） */
export const qualityWeightRows = () =>
  Object.keys(QUALITY_WEIGHTS).map(post => ({ post, ...qualityWeightOf(post), customized: WEIGHT_OVERRIDE.has(post) }))

/** 扣分分档：自查轻、被查重 */
export const DEDUCT_RULES = {
  self: { key: 'self', label: '自查发现（组长监督任务）', deptFactor: 0.5, supDelta: 1, note: '部门扣分 ×0.5，主管「发现问题数」+1（正向激励）' },
  cross: { key: 'cross', label: '品质抽查发现', deptFactor: 1.5, supDelta: -1, note: '部门扣分 ×1.5，主管减分（该查没查出来）' }
}
export const deductFactor = source => (DEDUCT_RULES[source] || DEDUCT_RULES.self).deptFactor

/** 班组 → 业务岗位（T1 客服 / T2 工程 / T3 安保 / T4 环境） */
const TEAM_POST = { T1: '客服', T2: '工程', T3: '安保', T4: '环境' }
export const postOfTeam = orgId => TEAM_POST[String(orgId || '').split('-')[2]] || ''

/**
 * 部门达标率。
 * 完成率与合格率只统计「执行任务」（一线作业），发现问题数只统计「监督任务」（组长核验）。
 */
export function deptAchievement({ orgId, post = '', since = '', period = '' } = {}) {
  const p = post || postOfTeam(orgId)
  const w = qualityWeightOf(p)
  /* period（YYYY-MM）优先：评价工作台按自然月归集，跨月不串账 */
  const inRange = t =>
    (!orgId || t.executorOrgId === orgId) &&
    (!period || String(t.scheduledDate || '').slice(0, 7) === period) &&
    (!since || String(t.scheduledDate || '') >= since)
  const execs = inspectTasks.filter(t => t.taskType !== '监督' && inRange(t))
  const sups = inspectTasks.filter(t => t.taskType === '监督' && inRange(t))
  const finished = execs.filter(t => ['已完成', '已转工单'].includes(t.status))
  const planned = execs.length
  const doneRate = planned ? finished.length / planned : 0
  const itemTotal = finished.reduce((s, t) => s + (t.itemCount || 0), 0)
  const itemOk = finished.reduce((s, t) => s + (t.normalCount || 0), 0)
  const passRate = itemTotal ? itemOk / itemTotal : 0
  const selfIssues = sups.reduce((s, t) => s + (t.issueCount || 0), 0)
  const conflicts = sups.filter(t => t.conflictFlag).length
  const weighted = passRate * w.pass + doneRate * w.done
  /* 部门分：加权达标率 - 自查问题扣分（按档轻扣）；被查侧留到 P2 品质评价工作台合并 */
  const deduct = selfIssues * 2 * deductFactor('self')
  return {
    orgId, post: p, weight: w,
    /* 本期既没有执行任务、也没有检查项 → 无数据，不能算成 0 分（否则空部门被判不合格） */
    noData: planned === 0 && itemTotal === 0,
    planned, finished: finished.length, doneRate,
    itemTotal, itemOk, passRate,
    selfIssues, conflicts,
    weighted,
    deptScore: Math.max(0, Math.round(weighted * 100 - deduct)),
    /* 主管考核：发现问题数（正向）+ 查出冲突数 */
    supervisor: { found: selfIssues, conflict: conflicts }
  }
}

/**
 * 有交付数据的班组（达标率 / 评价的候选项）。
 * 只取有「执行」任务的班组：评价算的是完成率与检查项合格率，
 * 只有监督任务的班组没有可评的交付数据，列进来只会平白多几行「本期无任务」。
 */
export const achievementDeptOpts = () => {
  const ids = [...new Set(
    inspectTasks.filter(t => t.taskType !== '监督').map(t => t.executorOrgId).filter(Boolean)
  )].sort()
  return ids.map(id => ({ id, name: orgNameOf(id), post: postOfTeam(id) }))
}

/* ================= P2 · 品质评价（按部门 × 周期） =================
 * 品质督导按自然月对各部门打分：以巡检执行数据为底（完成率 / 合格率 / 发现问题 / 冲突），
 * 再把「品质抽查发现问题」按重档并入扣分，最终生成一条 sourceType='任务评价' 的品质检查记录。
 * 与原有的「现场抽查评分卡」并存，记录列表用「来源」列区分。
 */

export const QUALITY_SOURCES = ['任务评价', '现场抽查']
/** 老记录没有 sourceType，一律视为现场抽查 */
export const qualitySourceOf = q => q.sourceType || '现场抽查'

/** 分数 → 等级（与 qualityChecks 现有字典一致） */
const GRADE_BANDS = [[90, '优秀'], [80, '良好'], [70, '合格'], [0, '不合格']]
export const gradeOfScore = score => (GRADE_BANDS.find(([min]) => Number(score) >= min) || [0, '不合格'])[1]

/** 评价周期：取巡检任务覆盖的自然月（倒序） */
export const qualityPeriodOpts = () => {
  const set = new Set(inspectTasks.map(t => String(t.scheduledDate || '').slice(0, 7)).filter(Boolean))
  return [...set].sort().reverse()
}

/** 已生成的评价记录索引：deptId|period → 记录 */
const evalIndexOf = () => {
  const m = new Map()
  for (const q of qualityChecks) {
    if (qualitySourceOf(q) !== '任务评价') continue
    m.set(`${q.deptId || ''}|${q.period || ''}`, q)
  }
  return m
}

/**
 * 评价依据：部门 × 周期的指标 + 分档扣分。
 * crossIssues 是本期「品质抽查发现问题数」，由品质督导在评价时确认（重档 ×1.5）。
 */
export function qualityEvalBasis({ orgId, period, crossIssues = 0 } = {}) {
  if (!orgId) throw new Error('请选择部门')
  if (!period) throw new Error('请选择评价周期')
  const a = deptAchievement({ orgId, period })
  const selfIssues = a.selfIssues
  const cross = Number(crossIssues) || 0
  /* 自查轻扣（×0.5）、被查重扣（×1.5）；主管侧：自查发现问题记为正向、被查问题记为未发现 */
  const selfDeduct = Math.round(selfIssues * 2 * deductFactor('self') * 10) / 10
  const crossDeduct = Math.round(cross * 2 * deductFactor('cross') * 10) / 10
  const raw = a.weighted * 100
  const score = Math.max(0, Math.round((raw - selfDeduct - crossDeduct) * 10) / 10)
  return {
    ...a, period, selfIssues, crossIssues: cross,
    selfDeduct, crossDeduct, rawScore: Math.round(raw * 10) / 10,
    score, grade: gradeOfScore(score),
    supervisor: { ...a.supervisor, crossMissed: cross }
  }
}

/** 工作台表格：各部门本期指标 + 是否已评价 */
export function qualityEvalRows({ period = '', communityId = '' } = {}) {
  const p = period || qualityPeriodOpts()[0]
  const idx = evalIndexOf()
  return achievementDeptOpts()
    .filter(d => !communityId || communityOfOrg(d.id) === communityId)
    .map(d => {
      const b = qualityEvalBasis({ orgId: d.id, period: p })
      const done = idx.get(`${d.id}|${p}`) || null
      return {
        orgId: d.id, deptName: d.name, post: d.post,
        communityId: communityOfOrg(d.id), communityName: communityName(communityOfOrg(d.id)),
        ...b, evaluable: !b.noData,
        /* 已评价的以记录分为准（记录里含抽查问题扣分），未评价的才是预估分 */
        score: done ? done.score : b.score,
        grade: done ? done.grade : b.grade,
        evaluated: !!done, record: done ? { checkId: done.checkId, checkNo: done.checkNo, score: done.score, grade: done.grade } : null
      }
    })
    /* 有数据的按分数升序（先看问题部门），无数据的排最后 */
    .sort((a, b) => (a.evaluable === b.evaluable ? a.score - b.score : (a.evaluable ? -1 : 1)))
}

/** 评价汇总 */
export function qualityEvalSummary(period = '') {
  const all = qualityEvalRows({ period })
  const rows = all.filter(r => r.evaluable)
  const done = rows.filter(r => r.evaluated)
  const avg = done.length ? done.reduce((s, r) => s + r.score, 0) / done.length : 0
  return {
    period: period || qualityPeriodOpts()[0],
    total: rows.length, done: done.length, pending: rows.length - done.length,
    noData: all.length - rows.length,
    avgScore: Math.round(avg * 10) / 10,
    issues: rows.reduce((s, r) => s + r.selfIssues + r.crossIssues, 0),
    conflicts: rows.reduce((s, r) => s + r.conflicts, 0),
    worst: rows[0] || null
  }
}

let QC_SEQ = qualityChecks.reduce((m, q) => Math.max(m, +String(q.checkId).replace(/\D/g, '') || 0), 0)

/**
 * 生成品质评价记录：同部门同周期只能评一次（要改先删记录）。
 */
export function createQualityEvaluation({ orgId, period, crossIssues = 0, checker = '品质督导', remark = '' } = {}) {
  const b = qualityEvalBasis({ orgId, period, crossIssues })
  if (b.noData) throw new Error('该部门本期没有巡检任务，无法评价')
  const dup = evalIndexOf().get(`${orgId}|${period}`)
  if (dup) throw new Error(`该部门 ${period} 已评价（${dup.checkNo}），不能重复生成`)

  /* 本期涉及的巡检任务：执行侧 + 监督侧，便于追溯 */
  const taskIds = inspectTasks
    .filter(t => t.executorOrgId === orgId && String(t.scheduledDate || '').slice(0, 7) === period)
    .map(t => t.taskId)

  QC_SEQ += 1
  const rec = {
    checkId: 'QCE' + String(QC_SEQ).padStart(4, '0'),
    checkNo: `QZ-${period}-E${String(QC_SEQ).padStart(3, '0')}`,
    communityId: communityOfOrg(orgId),
    area: orgNameOf(orgId),
    type: '月度',
    checker, checkerEmpId: (employees.find(e => e.name === checker) || {}).empId || '',
    checkDate: _now().slice(0, 10),
    score: b.score, grade: b.grade,
    deductCount: b.selfIssues + b.crossIssues,
    veto: false, rectifyCount: 0, rectifyDone: 0, dueDate: '', status: '待复核',
    recheck: false, attachments: 0,
    remark: remark || `任务评价：加权达标率 ${(b.weighted * 100).toFixed(1)}%（自查问题 ${b.selfIssues} / 抽查问题 ${b.crossIssues}）`,
    /* P2 新增字段 */
    sourceType: '任务评价', period, deptId: orgId, taskIds,
    metrics: {
      doneRate: Math.round(b.doneRate * 1000) / 1000,
      passRate: Math.round(b.passRate * 1000) / 1000,
      weighted: Math.round(b.weighted * 1000) / 1000,
      selfIssues: b.selfIssues, crossIssues: b.crossIssues,
      conflicts: b.conflicts, selfDeduct: b.selfDeduct, crossDeduct: b.crossDeduct,
      weight: b.weight
    },
    _isNew: true
  }
  qualityChecks.unshift(rec)
  _syncQualityRow(rec)

  /* 联动（P3）：评价不合格（<70 分）自动开整改单，问题项取本期监督任务查出的问题（带责任员工） */
  let autoRectify = null
  let autoRectifyError = ''
  if (b.grade === '不合格') {
    try {
      autoRectify = createRectifyOrder({
        checkId: rec.checkId, checkNo: rec.checkNo, sourceType: '任务评价',
        communityId: rec.communityId, deptId: orgId, period,
        level: b.score < 60 ? '重大' : '一般',
        items: _autoRectifyItems(orgId, period, b),
        remark: `${period} 品质评价 ${b.score} 分（不合格），系统自动生成整改单`,
        createdBy: checker, autoCreated: true
      })
      rec.dueDate = autoRectify.dueDate
      _syncQualityRow(rec)
    } catch (e) {
      autoRectifyError = e?.message || '自动生成整改单失败'
    }
  }
  return { ...rec, autoRectify, autoRectifyError }
}

/** 删除某条评价记录（重评用），只允许删任务评价，不影响现场抽查；其自动生成的整改单一起清掉 */
export function removeQualityEvaluation(checkId) {
  const i = qualityChecks.findIndex(q => q.checkId === checkId)
  if (i < 0) throw new Error('记录不存在')
  if (qualitySourceOf(qualityChecks[i]) !== '任务评价') throw new Error('只能删除「任务评价」记录')
  qualityChecks.splice(i, 1)
  const j = QC_ROWS.findIndex(x => x.checkId === checkId)
  if (j >= 0) QC_ROWS.splice(j, 1)
  /* 联动清理：不留悬空整改单（否则整改工作台点进去找不到来源记录） */
  let removedRectify = 0
  for (let k = RECTIFY_ROWS.length - 1; k >= 0; k--) {
    if (RECTIFY_ROWS[k].checkId === checkId) {
      RECTIFY_ROWS.splice(k, 1)
      removedRectify++
    }
  }
  return { checkId, removedRectify }
}

/** 报表：部门达标率（品质督导考核用，按部门 × 周期）—— 数组版，汇总直接用 */
export function deptQualityRows(filters = {}) {
  const period = filters.period || qualityPeriodOpts()[0]
  return qualityEvalRows({ period, communityId: filters.communityId })
    .filter(r => r.evaluable && (!filters.post || r.post === filters.post))
    .map(r => ({
      orgId: r.orgId,
      deptName: r.deptName,
      post: r.post,
      communityName: r.communityName,
      planned: r.planned,
      done: r.finished,
      doneRate: Math.round(r.doneRate * 1000) / 10,
      passRate: Math.round(r.passRate * 1000) / 10,
      weighted: Math.round(r.weighted * 1000) / 10,
      selfIssues: r.selfIssues,
      crossIssues: r.crossIssues,
      conflicts: r.conflicts,
      score: r.score,
      grade: r.grade,
      evaluatedText: r.evaluated ? '已评价' : '待评价'
    }))
}

/** 报表：部门达标率 —— 分页版（报表中心走这里） */
export function queryDeptQualityReport({ pageNo = 1, size = 50, filters = {} } = {}) {
  return delay(() => paged(deptQualityRows(filters), pageNo, size))
}

/* ================= P3 · 品质整改闭环（2026-10-29） =================
 * 流程：开单 → 待整改 →（责任部门提交）→ 待复核 →（督导复核）
 *       通过 = 已闭环 / 不通过 = 已退回（可重做再提交，进度归零）
 * 与评价的联动口径：
 *   ① 评价不合格（<70 分）时自动开单，问题项直接取该部门本期监督任务查出的问题（带责任员工）；
 *   ② 整改项进度回写品质记录的 rectifyCount / rectifyDone，全部闭环后记录状态转「已闭环」；
 *   ③ 删除评价时联动删除其生成的整改单，避免留下悬空单号。
 * 这样「评价工作台 / 品质台账 / 整改工作台」看到的永远是同一份进度。
 */

export const RECTIFY_STATUS = ['待整改', '待复核', '已退回', '已闭环']
export const RECTIFY_LEVELS = ['重大', '一般', '轻微']
export const RECTIFY_SOURCES = ['任务评价', '现场抽查', '监督任务', '手动开单']
export const RECTIFY_LIMIT_DAYS = 7          // 默认整改期限（自然日）
/** 复核时限：提交后 3 天未复核记为「复核超时」 */
export const RECHECK_LIMIT_DAYS = 3

const _p2 = n => String(n).padStart(2, '0')
const _todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${_p2(d.getMonth() + 1)}-${_p2(d.getDate())}`
}
const _addDays = (s, n) => {
  const d = new Date(String(s || _todayStr()).slice(0, 10).replace(/-/g, '/'))
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${_p2(d.getMonth() + 1)}-${_p2(d.getDate())}`
}
const _diffDays = (a, b) => {
  const x = new Date(String(a).slice(0, 10).replace(/-/g, '/'))
  const y = new Date(String(b).slice(0, 10).replace(/-/g, '/'))
  return Math.round((x - y) / 86400000)
}

/** 区域 → 责任班组（现场问题默认归属，可在单内改派） */
const _AREA_TEAM = {
  园区外围: 'T3', 地下车库: 'T3', 楼栋大堂: 'T4', 公共区域: 'T4', 绿化带: 'T4',
  电梯机房: 'T2', 设备房: 'T2'
}
/** 班组 → 可被追责的一线岗位（组长本人不进名单） */
const _TEAM_OWNER_POS = { T1: ['客服专员'], T2: ['维修工'], T3: ['保安'], T4: ['保洁员', '绿化员'] }

let RC_SEQ = 0
const RECTIFY_ROWS = []

/**
 * 由既有品质记录派生整改单（76 条现场抽查记录中，有扣分项的才开单）。
 * 静态派生、不消耗 PRNG；问题项沿用评分卡的「整改项」问题库，保证两处看到同一批问题。
 */
;(function seedRectify() {
  const src = qualityChecks
    .filter(q => (q.rectifyCount || 0) > 0 && q.deductCount > 0)
    .slice()
    .sort((a, b) => (a.checkDate === b.checkDate ? String(a.checkId).localeCompare(b.checkId) : (a.checkDate < b.checkDate ? -1 : 1)))
  for (const q of src) {
    RC_SEQ += 1
    const team = _AREA_TEAM[q.area] || 'T4'
    const orgId = `O-${q.communityId}-${team}`
    const posList = _TEAM_OWNER_POS[team] || []
    const pool = EMP_ROWS.filter(e => e.orgId === orgId && posList.includes(e.position) && e.status !== '离职')
    const idx = Number(String(q.checkId).replace(/\D/g, '')) || 1
    const owner = pool.length ? pool[idx % pool.length] : null
    const items = rectifyItems(q).map((it, i) => ({
      no: i + 1,
      desc: `${it.group} · ${it.reason}`,
      require: '按作业标准整改到位，并上传整改后照片',
      done: it.done
    }))
    const closed = q.status === '已闭环'
    const submitted = closed || q.status === '待复核'
    /* 提交时间落在 [今天-2, 今天]：既不会出现「未来提交」，也不会让历史单据整批落进「复核超时」 */
    const _cap = _addDays(_todayStr(), -2)
    const submitDay = !submitted ? '' : (q.dueDate > _todayStr() ? _todayStr() : (q.dueDate < _cap ? _cap : q.dueDate))
    const closeDay = closed ? (submitDay >= _todayStr() ? _todayStr() : _addDays(submitDay, 1)) : ''
    RECTIFY_ROWS.push({
      rectifyId: 'RC' + String(RC_SEQ).padStart(4, '0'),
      rectifyNo: `ZG-${(q.checkDate || '').slice(0, 7)}-${String(RC_SEQ).padStart(4, '0')}`,
      sourceType: q.sourceType || '现场抽查',
      checkId: q.checkId, checkNo: q.checkNo,
      communityId: q.communityId, communityName: communityName(q.communityId),
      deptId: orgId, deptName: orgNameOf(orgId),
      owner: owner ? owner.name : '待指派', ownerEmpId: owner ? owner.empId : '',
      level: q.veto ? '重大' : (q.deductCount >= 6 ? '一般' : '轻微'),
      status: closed ? '已闭环' : (q.status === '待复核' ? '待复核' : '待整改'),
      items,
      issueDesc: items.slice(0, 2).map(i => i.desc).join('；'),
      createdAt: `${q.checkDate} 10:30`,
      dueDate: q.dueDate,
      submitAt: submitted ? `${submitDay} 17:10` : '',
      submitBy: submitted && owner ? owner.name : '',
      submitRemark: submitted ? '已按要求整改并上传现场照片' : '',
      photos: submitted ? 2 : 0,
      recheckBy: closed ? '品质督导' : '',
      recheckAt: closed ? `${closeDay} 09:40` : '',
      recheckResult: closed ? '通过' : '',
      recheckRemark: closed ? '现场复核通过，问题已消除' : '',
      returnAt: '', returnReason: '',
      closedAt: closed ? `${closeDay} 09:40` : '',
      period: (q.checkDate || '').slice(0, 7),
      createdBy: q.checker || '品质督导',
      autoCreated: false
    })
  }
})()

/** 派生字段：进度、超期、剩余天数（不改源数据，列表 / 详情 / KPI 统一从这里取） */
function _rectifyView(r) {
  const doneItems = r.items.filter(i => i.done).length
  const totalItems = r.items.length
  const closed = r.status === '已闭环'
  const waiting = ['待整改', '已退回'].includes(r.status)
  const overdue = waiting && !!r.dueDate && r.dueDate < _todayStr()
  const recheckOverdue = r.status === '待复核' && !!r.submitAt &&
    _diffDays(_todayStr(), r.submitAt.slice(0, 10)) > RECHECK_LIMIT_DAYS
  return {
    ...r, doneItems, totalItems, closed, overdue, recheckOverdue,
    overdueDays: overdue ? _diffDays(_todayStr(), r.dueDate) : 0,
    progress: totalItems ? Math.round(doneItems / totalItems * 100) : 0,
    remainDays: closed ? 0 : (r.dueDate ? _diffDays(r.dueDate, _todayStr()) : 0)
  }
}

/**
 * 列表 / 台账排序：未闭环在前（待整改 → 已退回 → 待复核），同组内按开单时间倒序。
 * 不按「超期天数」排 —— 历史批次（6 月现场抽查）会一直压在首屏，
 * 最新开单反而看不到；超期用红色标记 + 「超期」快捷视图处理。
 */
const _RECTIFY_ORDER = { 待整改: 0, 已退回: 1, 待复核: 2, 已闭环: 3 }
function _rectifySorted() {
  return RECTIFY_ROWS.map(_rectifyView).sort((a, b) => {
    const oa = _RECTIFY_ORDER[a.status] ?? 9
    const ob = _RECTIFY_ORDER[b.status] ?? 9
    if (oa !== ob) return oa - ob
    return String(b.createdAt).localeCompare(String(a.createdAt))
  })
}

const RECTIFY_VF = {
  pending: r => ['待整改', '已退回'].includes(r.status),
  overdue: r => r.overdue,
  recheck: r => r.status === '待复核' || r.recheckOverdue,
  closed: r => r.status === '已闭环',
  auto: r => r.autoCreated
}

/**
 * 整改单数组（页面列表 / 报表共用）
 * filters: { status, vf, communityId, deptId, level, sourceType, checkId, kw }
 */
export function rectifyRows(filters = {}) {
  const hit = RECTIFY_VF[filters.vf]
  return _rectifySorted().filter(r =>
    eq(r, filters.status, 'status') &&
    eq(r, filters.communityId, 'communityId') &&
    eq(r, filters.deptId, 'deptId') &&
    eq(r, filters.level, 'level') &&
    eq(r, filters.sourceType, 'sourceType') &&
    eq(r, filters.checkId, 'checkId') &&
    (!hit || hit(r)) &&
    kwHit(r, filters.kw, ['rectifyNo', 'checkNo', 'deptName', 'owner', 'issueDesc'])
  )
}

export function queryRectifyOrders({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => paged(rectifyRows(filters), pageNo, size))
}

/** 整改 KPI */
export function rectifySummary() {
  const list = _rectifySorted()
  const closed = list.filter(r => r.status === '已闭环')
  const items = list.reduce((s, r) => s + r.totalItems, 0)
  const doneItems = list.reduce((s, r) => s + r.doneItems, 0)
  return {
    total: list.length,
    pending: list.filter(r => ['待整改', '已退回'].includes(r.status)).length,
    returned: list.filter(r => r.status === '已退回').length,
    recheck: list.filter(r => r.status === '待复核').length,
    closed: closed.length,
    overdue: list.filter(r => r.overdue).length,
    recheckOverdue: list.filter(r => r.recheckOverdue).length,
    auto: list.filter(r => r.autoCreated).length,
    items, doneItems,
    closeRate: list.length ? Math.round(closed.length / list.length * 1000) / 10 : 0,
    itemRate: items ? Math.round(doneItems / items * 1000) / 10 : 0
  }
}

/** 整改单详情（含流程时间线） */
export function getRectifyDetail(rectifyId) {
  return delay(() => {
    const r = RECTIFY_ROWS.find(x => x.rectifyId === rectifyId)
    if (!r) return null
    const row = _rectifyView(r)
    const timeline = [
      { title: `开单 · ${row.createdBy}`, memo: `${row.rectifyNo} · ${row.sourceType}${row.checkNo ? ' · 关联 ' + row.checkNo : ''} · 期限 ${row.dueDate}`, done: true, at: row.createdAt },
      {
        title: row.submitAt ? `提交整改 · ${row.submitBy || row.owner}` : '待责任部门提交整改',
        memo: row.submitAt ? `${row.doneItems}/${row.totalItems} 项已处理${row.submitRemark ? ' · ' + row.submitRemark : ''}` : `责任人 ${row.owner} · 剩余 ${Math.max(0, row.remainDays)} 天`,
        done: !!row.submitAt, at: row.submitAt
      },
      {
        title: row.returnAt ? `复核退回 · ${row.recheckBy}` : (row.recheckAt ? `复核通过 · ${row.recheckBy}` : '待品质督导复核'),
        memo: row.returnAt ? (row.returnReason || '未达整改要求，退回重做') : (row.recheckAt ? row.recheckRemark : '提交后 3 天内完成复核'),
        done: !!row.recheckAt || !!row.returnAt, at: row.recheckAt || row.returnAt
      },
      {
        title: row.closed ? '已闭环' : '未闭环',
        memo: row.closed ? `闭环时间 ${row.closedAt}` : (row.overdue ? `已超期 ${row.overdueDays} 天` : `剩余 ${Math.max(0, row.remainDays)} 天`),
        done: !!row.closed, at: row.closedAt
      }
    ]
    return { row, timeline }
  })
}

/** 与品质记录联动：整改项进度回写来源记录（品质台账的「已改/总数」与状态由此保持同步） */
function _syncCheckOfRectify(checkId) {
  if (!checkId) return
  const rec = qualityChecks.find(q => q.checkId === checkId)
  if (!rec) return
  const orders = RECTIFY_ROWS.filter(r => r.checkId === checkId)
  if (!orders.length) return
  const total = orders.reduce((s, r) => s + r.items.length, 0)
  const done = orders.reduce((s, r) => s + r.items.filter(i => i.done).length, 0)
  const allClosed = orders.every(r => r.status === '已闭环')
  rec.rectifyCount = total
  rec.rectifyDone = done
  if (allClosed) {
    rec.status = '已闭环'
  } else if (done >= total) {
    rec.status = '待复核'
  } else if (rec.status !== '已超时') {
    rec.status = '整改中'
  }
  _syncQualityRow(rec)
}

/** 评价不合格时的整改项：直接取该部门本期监督任务查出的问题（带责任员工），查不到才用兜底文案 */
function _autoRectifyItems(orgId, period, b) {
  const found = inspectTasks
    .filter(t => t.taskType === '监督' && t.executorOrgId === orgId && String(t.scheduledDate || '').slice(0, 7) === period)
    .flatMap(t => (t.issueItems || []).map(i => ({ ...i, taskId: t.taskId })))
  const items = found.map((i, k) => ({
    no: k + 1,
    desc: `${i.item}（责任员工 ${i.responsibleName || '待定'}）`,
    require: '按监督模板标准整改到位，并上传整改前后对比照片',
    done: false,
    responsibleName: i.responsibleName || '',
    taskId: i.taskId || ''
  }))
  /* 抽查问题只有数量、没有明细项：按条补占位事项，保证整改项数 = 评价依据里的问题数 */
  for (let k = 0; k < (b.crossIssues || 0); k++) {
    items.push({
      no: items.length + 1,
      desc: `品质抽查问题 ${k + 1}（督导现场指出）`,
      require: '按督导意见整改，整改后由督导复核',
      done: false,
      responsibleName: ''
    })
  }
  if (!items.length) {
    items.push({ no: 1, desc: '本期达标率不达标，需提交书面整改方案', require: '限期提交整改方案并落实', done: false, responsibleName: '' })
  }
  return items
}

/** 新开整改单 */
export function createRectifyOrder(p = {}) {
  const items = (p.items || []).filter(i => String(i.desc || '').trim())
  if (!items.length) throw new Error('整改单至少要有 1 个整改项')
  const check = p.checkId ? qualityChecks.find(q => q.checkId === p.checkId) : null
  const deptId = p.deptId || (check ? `O-${check.communityId}-${_AREA_TEAM[check.area] || 'T4'}` : '')
  const posList = _TEAM_OWNER_POS[String(deptId).split('-')[2]] || []
  const pool = EMP_ROWS.filter(e => e.orgId === deptId && posList.includes(e.position) && e.status !== '离职')
  const owner = p.owner || (pool.length ? pool[0].name : '待指派')
  const ownerEmp = pool.find(e => e.name === owner)

  RC_SEQ += 1
  const now = _now()
  const row = {
    rectifyId: 'RC' + String(RC_SEQ).padStart(4, '0'),
    rectifyNo: `ZG-${now.slice(0, 7)}-${String(RC_SEQ).padStart(4, '0')}`,
    sourceType: p.sourceType || (check ? (check.sourceType || '现场抽查') : '手动开单'),
    checkId: p.checkId || '', checkNo: p.checkNo || (check ? check.checkNo : ''),
    communityId: p.communityId || (check ? check.communityId : ''),
    communityName: communityName(p.communityId || (check ? check.communityId : '')),
    deptId, deptName: orgNameOf(deptId),
    owner, ownerEmpId: ownerEmp ? ownerEmp.empId : '',
    level: RECTIFY_LEVELS.includes(p.level) ? p.level : '一般',
    status: '待整改',
    items: items.map((i, k) => ({
      no: k + 1,
      desc: i.desc,
      require: i.require || '按作业标准整改到位',
      done: false,
      responsibleName: i.responsibleName || '',
      taskId: i.taskId || ''
    })),
    issueDesc: items.slice(0, 2).map(i => i.desc).join('；'),
    createdAt: now,
    dueDate: p.dueDate || _addDays(_todayStr(), RECTIFY_LIMIT_DAYS),
    submitAt: '', submitBy: '', submitRemark: '', photos: 0,
    recheckBy: '', recheckAt: '', recheckResult: '', recheckRemark: '',
    returnAt: '', returnReason: '',
    closedAt: '',
    period: p.period || now.slice(0, 7),
    createdBy: p.createdBy || '品质督导',
    autoCreated: !!p.autoCreated,
    remark: p.remark || ''
  }
  RECTIFY_ROWS.push(row)
  _syncCheckOfRectify(row.checkId)
  return { ...row }
}

/** 责任部门提交整改：全部整改项置为已完成，状态转「待复核」 */
export function submitRectify(rectifyId, { applicant = '', remark = '', photos = 0, itemNos = null } = {}) {
  const r = RECTIFY_ROWS.find(x => x.rectifyId === rectifyId)
  if (!r) throw new Error('整改单不存在')
  if (!['待整改', '已退回'].includes(r.status)) throw new Error(`当前状态「${r.status}」，不能提交整改`)
  if (!r.items.length) throw new Error('该整改单没有整改项')
  if (!String(applicant || r.owner || '').trim()) throw new Error('请填写整改人')
  const picked = Array.isArray(itemNos) && itemNos.length ? new Set(itemNos) : null
  /* 先校验再落状态：部分勾选提交时不能先把 items 改了再抛错（否则留下半截数据） */
  const next = r.items.map(i => ({ ...i, done: picked ? (picked.has(i.no) || i.done) : true }))
  const left = next.filter(i => !i.done).length
  if (left) throw new Error(`还有 ${left} 项未处理，不能提交复核`)
  r.items = next
  r.status = '待复核'
  r.submitAt = _now()
  r.submitBy = applicant || r.owner
  r.submitRemark = remark || '已按要求完成整改'
  r.photos = Number(photos) || r.items.length
  _syncCheckOfRectify(r.checkId)
  return _rectifyView(r)
}

/** 品质督导复核：通过 → 已闭环；不通过 → 已退回（整改项归零，需重做） */
export function recheckRectify(rectifyId, { pass = true, checker = '品质督导', remark = '' } = {}) {
  const r = RECTIFY_ROWS.find(x => x.rectifyId === rectifyId)
  if (!r) throw new Error('整改单不存在')
  if (r.status !== '待复核') throw new Error(`当前状态「${r.status}」，只有「待复核」的整改单可以复核`)
  if (pass && String(r.submitBy || '') === String(checker || '')) {
    throw new Error('整改提交人不能自己复核，请由上级或品质督导复核')
  }
  const now = _now()
  if (pass) {
    r.status = '已闭环'
    r.recheckBy = checker
    r.recheckAt = now
    r.recheckResult = '通过'
    r.recheckRemark = remark || '现场复核通过'
    r.closedAt = now
  } else {
    if (!String(remark || '').trim()) throw new Error('退回必须填写整改意见')
    r.status = '已退回'
    r.recheckBy = checker
    r.recheckAt = ''
    r.recheckResult = '不通过'
    r.returnAt = now
    r.returnReason = remark
    r.items = r.items.map(i => ({ ...i, done: false }))
    r.submitAt = ''
  }
  _syncCheckOfRectify(r.checkId)
  return _rectifyView(r)
}

/** 改派责任部门 / 责任人 / 延期（重大整改单常见动作） */
export function reassignRectify(rectifyId, { deptId = '', owner = '', dueDate = '' } = {}) {
  const r = RECTIFY_ROWS.find(x => x.rectifyId === rectifyId)
  if (!r) throw new Error('整改单不存在')
  if (r.status === '已闭环') throw new Error('已闭环的整改单不能改派')
  if (deptId) {
    r.deptId = deptId
    r.deptName = orgNameOf(deptId)
    const posList = _TEAM_OWNER_POS[String(deptId).split('-')[2]] || []
    const pool = EMP_ROWS.filter(e => e.orgId === deptId && posList.includes(e.position) && e.status !== '离职')
    if (pool.length && !pool.some(e => e.name === owner)) {
      r.owner = pool[0].name
      r.ownerEmpId = pool[0].empId
    }
  }
  if (owner) {
    r.owner = owner
    const emp = EMP_ROWS.find(e => e.name === owner && (!r.deptId || e.orgId === r.deptId))
    r.ownerEmpId = emp ? emp.empId : r.ownerEmpId
  }
  if (dueDate) r.dueDate = dueDate
  return _rectifyView(r)
}

/** 某条品质记录关联的整改单（品质台账 / 评价工作台展示用） */
export const rectifyOfCheck = checkId =>
  _rectifySorted().filter(r => r.checkId === checkId)

/** 部门 / 周期维度的整改进度（评价工作台行内展示） */
export function rectifyProgressOf({ orgId = '', period = '' } = {}) {
  const list = _rectifySorted().filter(r =>
    (!orgId || r.deptId === orgId) && (!period || r.period === period)
  )
  const items = list.reduce((s, r) => s + r.totalItems, 0)
  const done = list.reduce((s, r) => s + r.doneItems, 0)
  return {
    total: list.length,
    closed: list.filter(r => r.status === '已闭环').length,
    overdue: list.filter(r => r.overdue).length,
    items, doneItems: done,
    rate: items ? Math.round(done / items * 1000) / 10 : 0
  }
}

/* ================= P3 · 主管发现问题数（独立考核报表） =================
 * 统计口径（2026-10-29 确认）：
 *   统计对象 = 部门经理（组长）本人提交的「监督」任务，不是一线执行任务；
 *   发现问题数 = 监督任务 issueCount 合计（每条问题都必须指定责任员工，归得到人）；
 *   问题检出率 = 发现问题数 ÷ 检查项总数（查得细不细）；
 *   次均发现问题 = 发现问题数 ÷ 已完成监督任务（查得勤不勤）；
 *   申报冲突 = 下属当日申报「零异常」但组长现场查出问题的次数（防「报喜不报忧」）；
 *   抽查未发现 = 品质督导本期抽查发现、部门自查却未上报的问题数（来自评价记录录入值）；
 *   主动发现率 = 自查问题 ÷（自查问题 + 抽查未发现），越高说明主管越先发现问题。
 */

export const supFindingPeriodOpts = () => {
  const set = new Set(
    inspectTasks.filter(t => t.taskType === '监督').map(t => String(t.scheduledDate || '').slice(0, 7)).filter(Boolean)
  )
  return [...set].sort().reverse()
}

/**
 * 该部门本期的「抽查未发现」数（主管没查出来、被督导查出来的问题）。
 * 优先取任务评价记录里录入的 crossIssues；尚未评价时，按同项目同月「现场抽查」的扣分项
 * 依区域归属班组折算（现场抽查记录只有区域、没有部门），保证报表在评价前也能看。
 */
function _crossMissedOf(orgId, period) {
  const rec = qualityChecks.find(q =>
    qualitySourceOf(q) === '任务评价' && q.deptId === orgId && q.period === period
  )
  if (rec) return Number(rec.metrics?.crossIssues || 0)
  const cm = communityOfOrg(orgId)
  const team = String(orgId || '').split('-')[2] || ''
  return qualityChecks
    .filter(q => qualitySourceOf(q) === '现场抽查' &&
      q.communityId === cm &&
      String(q.checkDate || '').slice(0, 7) === period &&
      (_AREA_TEAM[q.area] || 'T4') === team)
    .reduce((s, q) => s + (q.deductCount || 0), 0)
}

function _supFindingAll({ period = '', communityId = '', post = '', supervisor = '', kw = '' } = {}) {
  const groups = new Map()
  for (const t of inspectTasks) {
    if (t.taskType !== '监督') continue
    if (period && String(t.scheduledDate || '').slice(0, 7) !== period) continue
    if (communityId && t.communityId !== communityId) continue
    const tp = t.targetPost || t.post || ''
    if (post && tp !== post) continue
    if (supervisor && t.executor !== supervisor) continue
    const orgId = t.executorOrgId || ''
    const key = `${t.executor}|${orgId}`
    let g = groups.get(key)
    if (!g) {
      g = { key, supervisor: t.executor, orgId, post: tp, communityId: t.communityId, tasks: [] }
      groups.set(key, g)
    }
    g.tasks.push(t)
  }

  const rows = [...groups.values()].map(g => {
    const done = g.tasks.filter(t => ['已完成', '已转工单'].includes(t.status))
    const issues = done.reduce((s, t) => s + (t.issueCount || 0), 0)
    const itemTotal = done.reduce((s, t) => s + (t.itemCount || 0), 0)
    const conflicts = done.filter(t => t.conflictFlag).length
    const staff = new Set(done.flatMap(t => t.hitEmployees || []))
    const crossMissed = _crossMissedOf(g.orgId, period || (g.tasks[0] ? String(g.tasks[0].scheduledDate).slice(0, 7) : ''))
    const planned = g.tasks.length
    return {
      key: g.key,
      supervisor: g.supervisor,
      orgId: g.orgId,
      deptName: orgNameOf(g.orgId),
      post: g.post,
      communityId: g.communityId,
      communityName: communityName(g.communityId),
      planned,
      done: done.length,
      doneRate: planned ? Math.round(done.length / planned * 1000) / 10 : 0,
      itemTotal,
      issues,
      issueRate: itemTotal ? Math.round(issues / itemTotal * 1000) / 10 : 0,
      perTask: done.length ? Math.round(issues / done.length * 100) / 100 : 0,
      conflicts,
      staffCount: staff.size,
      crossMissed,
      proactive: issues + crossMissed ? Math.round(issues / (issues + crossMissed) * 1000) / 10 : null,
      zeroWeeks: done.filter(t => (t.issueCount || 0) === 0).length
    }
  })
  return rows
    .filter(r => kwHit(r, kw, ['supervisor', 'deptName', 'communityName']))
    .sort((a, b) => (b.issues - a.issues) || (b.perTask - a.perTask))
}

/** 主管维度明细（考核表主表） */
export function supFindingRows(filters = {}) {
  return _supFindingAll(filters).map((r, i) => ({ ...r, rank: i + 1 }))
}

/** 部门维度汇总（同口径，按班组聚合） */
export function supFindingDeptRows(filters = {}) {
  const map = new Map()
  for (const r of _supFindingAll(filters)) {
    let d = map.get(r.orgId)
    if (!d) {
      d = {
        orgId: r.orgId, deptName: r.deptName, post: r.post,
        communityId: r.communityId, communityName: r.communityName,
        supervisors: [], planned: 0, done: 0, issues: 0, itemTotal: 0,
        conflicts: 0, crossMissed: 0
      }
      map.set(r.orgId, d)
    }
    d.supervisors.push(r.supervisor)
    d.planned += r.planned
    d.done += r.done
    d.issues += r.issues
    d.itemTotal += r.itemTotal
    d.conflicts += r.conflicts
    d.crossMissed += r.crossMissed
  }
  return [...map.values()].map(d => ({
    ...d,
    supervisorText: [...new Set(d.supervisors)].join('、'),
    doneRate: d.planned ? Math.round(d.done / d.planned * 1000) / 10 : 0,
    issueRate: d.itemTotal ? Math.round(d.issues / d.itemTotal * 1000) / 10 : 0,
    perTask: d.done ? Math.round(d.issues / d.done * 100) / 100 : 0,
    proactive: d.issues + d.crossMissed ? Math.round(d.issues / (d.issues + d.crossMissed) * 1000) / 10 : null
  })).sort((a, b) => b.issues - a.issues)
}

/** 考核表汇总卡 */
export function supFindingSummary(filters = {}) {
  const rows = _supFindingAll(filters)
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0)
  const done = sum('done')
  const issues = sum('issues')
  const cross = sum('crossMissed')
  return {
    supervisors: rows.length,
    planned: sum('planned'),
    done,
    issues,
    crossMissed: cross,
    conflicts: sum('conflicts'),
    perTask: done ? Math.round(issues / done * 100) / 100 : 0,
    issueRate: sum('itemTotal') ? Math.round(issues / sum('itemTotal') * 1000) / 10 : 0,
    proactive: issues + cross ? Math.round(issues / (issues + cross) * 1000) / 10 : null,
    /* 有问题但没抓到「申报不实」的主管数：监督深度不足的观察项 */
    silent: rows.filter(r => r.issues > 0 && r.conflicts === 0).length,
    zero: rows.filter(r => r.issues === 0).length,
    top: rows[0] || null
  }
}

/** 下钻：某主管某期的监督任务清单（含问题项与责任员工） */
export function supFindingTaskRows({ supervisor = '', orgId = '', period = '' } = {}) {
  return inspectTasks
    .filter(t => t.taskType === '监督' &&
      (!supervisor || t.executor === supervisor) &&
      (!orgId || t.executorOrgId === orgId) &&
      (!period || String(t.scheduledDate || '').slice(0, 7) === period))
    .sort((a, b) => String(b.scheduledDate).localeCompare(String(a.scheduledDate)))
    .map(t => ({
      taskId: t.taskId,
      planName: t.planName,
      scheduledDate: t.scheduledDate,
      doneTime: t.doneTime || '',
      status: t.status,
      itemCount: t.itemCount || 0,
      normalCount: t.normalCount || 0,
      issueCount: t.issueCount || 0,
      conflicts: !!t.conflictFlag,
      issueText: (t.issueItems || []).map(i => `${i.item}（${i.responsibleName || '待定'}）`).join('；'),
      issueItems: t.issueItems || []
    }))
}

export const supFindingPostOpts = () => {
  const set = new Set(inspectTasks.filter(t => t.taskType === '监督').map(t => t.targetPost || t.post).filter(Boolean))
  return [...set].sort()
}
export const supFindingSupervisorOpts = () => {
  const set = new Set(inspectTasks.filter(t => t.taskType === '监督').map(t => t.executor).filter(Boolean))
  return [...set].sort()
}

/** 报表中心：工单按楼栋分布（分页） */
export function queryWoBuildingReport({ pageNo = 1, size = 50, filters = {} } = {}) {
  return delay(() => paged(woBuildingRows(filters), pageNo, size))
}

/** 报表中心：主管发现问题数（分页） */
export function querySupFindingReport({ pageNo = 1, size = 50, filters = {} } = {}) {
  return delay(() => paged(supFindingRows(filters), pageNo, size))
}


/* ==================================================================
 * P6 数据安全：敏感字段分级 · 查看留痕 · 导出范围校验（2026-10-29）
 * ----------------------------------------------------------------
 * 背景（用户口径）：业主 / 租户的姓名、手机、证件属敏感信息，必须逐级管理、
 * 隔离权限；楼管只看自己责任范围，主管看整小区，总部看全部。
 * 范围隔离已由 P5「责任范围」在 scopeFilter 里做掉，本段补第二层：
 *   ① 敏感字段默认**脱敏**展示，明文需要权限位且要「点一下」才临时揭示；
 *   ② 每次揭示写一条访问日志（谁 / 何时 / 看了谁的哪个字段 / 从哪个页面）；
 *   ③ 导出含敏感列一律留痕；无明文权限的角色只能导出**脱敏版**；
 *   ④ 超过「导出留痕阈值」记大额留痕，超过单次上限直接拦截（不产生下载任务）。
 * 日志只在本段内存态里，刷新还原；正式实现落 `data_access_logs` 表。
 * ================================================================== */

/** 敏感字段白名单：只有登记在这里的列才参与脱敏、留痕与导出校验 */
const SENSITIVE_FIELDS = {
  phone: '手机号', mobile: '手机号', emergencyPhone: '应急电话',
  idCard: '证件号', bankAccount: '银行账号',
  /* 客户画像里的三项个人敏感信息（2026-11-02）：经济状况、政治面貌、负面评价。
     它们不进计费也不进考核，但一旦整表下发，就是"整栋楼谁家困难、谁被投诉过"的名单。 */
  economicLevel: '家庭经济状况', politicalStatus: '政治面貌', negativeNotes: '负面信息'
}
export const SENSITIVE_PERM = 'a.sensitive.view'
export const ACCESS_LOG_PERM = 'e.accessLog.view'
/** 超过这个条数的导出记一条「大额导出」留痕（不等于拦截） */
const EXPORT_AUDIT_ROWS = 200

export const isSensitiveField = prop => Object.prototype.hasOwnProperty.call(SENSITIVE_FIELDS, prop)
export const sensitiveLabelOf = prop => SENSITIVE_FIELDS[prop] || ''

/** 按字段类型脱敏（证件号保留前 4 后 4，其余按手机号口径） */
export function maskSensitive(field, v) {
  if (v === null || v === undefined || v === '') return '—'
  /* 枚举 / 评价类：遮蔽整值。对「一般」「群众」保留前后位，等于把答案写脸上 */
  if (['economicLevel', 'politicalStatus', 'negativeNotes'].includes(field)) return '***'
  if (field === 'idCard') return maskId(v)
  if (field === 'bankAccount') return String(v).replace(/^(.{4}).*(.{4})$/, '$1 **** **** $2')
  return maskPhone(v)
}

/** 当前角色是否有「敏感字段明文」权限（角色矩阵里取消该位后立即失效） */
export function canViewSensitive() {
  return permCodesOfRole(currentRoleId.value).has(SENSITIVE_PERM)
}

/** 真实今天（数据集的 TODAY 是 2026-10-21，日志要跟真实操作时间对齐） */
const _realToday = () => {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const _agoDay = n => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  const p = x => String(x).padStart(2, '0')
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, p }
}

/** 操作人快照：取当前角色的代表员工 + 角色名 + 数据范围，写进日志 */
function _accessWho() {
  const s = currentScope()
  return {
    name: s.anchorName || currentRoleName.value || '系统',
    roleName: s.roleName || currentRoleName.value || '',
    orgName: s.orgName || '',
    scopeMode: s.mode || ''
  }
}

const ACCESS_LOGS = []   // 敏感字段查看
const EXPORT_LOGS = []   // 导出（含脱敏与拦截）
let _AL_SEQ = 0
let _EL_SEQ = 0

/**
 * 揭示一次敏感字段明文：有权限才返回原值，同时写访问日志。
 * 无权限时抛错（页面据此提示，不会静默返回空值）。
 */
const SENSITIVE_TABLE = () => ({ 业主: [owners, 'ownerId'], 租户: [tenants, 'tenantId'], 员工: [employees, 'empId'] })
/** 明文回源：列表只带掩码，揭示时必须回到数据源取原值（不信任前端传回来的 value） */
function _plainOf(entityType, entityId, field, fallback) {
  const hit = SENSITIVE_TABLE()[entityType]
  if (!hit) return fallback
  const [rows, idKey] = hit
  const row = rows.find(r => r[idKey] === entityId)
  return (row && row[field]) || fallback
}

export function revealSensitive({ entityType = '', entityId = '', entityName = '', field = 'phone', value = '', source = '', memo = '' } = {}) {
  if (!canViewSensitive()) throw new Error('无「敏感字段明文」权限，请联系项目经理开通')
  const who = _accessWho()
  _AL_SEQ++
  ACCESS_LOGS.unshift(sealLog({
    logId: 'AL' + String(_AL_SEQ).padStart(6, '0'),
    at: _now(), operator: who.name, roleName: who.roleName, orgName: who.orgName,
    scopeMode: who.scopeMode,
    action: '查看明文', entityType, entityId, entityName,
    field, fieldLabel: sensitiveLabelOf(field) || field,
    source, rows: 1, result: '成功', memo
  }))
  track('reveal', { entityType, field, source })
  return _plainOf(entityType, entityId, field, value)
}

function _pushExportLog({ name, source, who, result, rows, field, memo }) {
  // 追加写 + 哈希链：只写不删，任何一条被改，链上后面的 hash 都会对不上
  _EL_SEQ++
  EXPORT_LOGS.unshift(sealLog({
    logId: 'EL' + String(_EL_SEQ).padStart(6, '0'),
    at: _now(), operator: who.name, roleName: who.roleName, orgName: who.orgName,
    scopeMode: who.scopeMode,
    action: '导出数据', entityType: '导出任务', entityId: '', entityName: name,
    field: field || '', fieldLabel: '', source, rows, result, memo
  }))
}

/**
 * 导出前置校验（页面 → 下载中心之间唯一入口，export.js 调用）
 * - 超单次上限：抛错拦截，不产生任务
 * - 含敏感列且无明文权限：自动改脱敏值导出，记「脱敏」留痕
 * - 其余：记「成功」留痕，大额（>200 条）在说明里标注
 * @returns {{columns, rows, masked, count, sensitive}}
 */
export function prepareExport({ name = '', source = '', columns = [], rows = [], filters = {} } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const count = list.length
  const limitParam = PARAMS.find(x => x.key === 'export.maxRows')
  const limit = Number(limitParam?.value) || 50000
  const sensCols = columns.filter(c => isSensitiveField(c.prop))
  const sensLabels = sensCols.map(c => sensitiveLabelOf(c.prop))
  const who = _accessWho()
  const scopeText = who.scopeMode ? `范围：${who.scopeMode}${who.orgName ? ' · ' + who.orgName : ''}` : ''

  if (count > limit) {
    _pushExportLog({ name, source, who, result: '拦截', rows: count, field: sensLabels.join('、'), memo: `超过单次上限 ${limit} 条` })
    throw new Error(`本次 ${count} 条超过单次导出上限 ${limit} 条，请缩小筛选范围后再导出`)
  }

  if (sensCols.length && !canViewSensitive()) {
    const out = list.map(r => {
      const o = { ...r }
      for (const c of sensCols) o[c.prop] = maskSensitive(c.prop, r[c.prop])
      return o
    })
    track('export', { name, count, masked: true, sensitive: sensLabels.length })
    _pushExportLog({
      name, source, who, result: '脱敏', rows: count, field: sensLabels.join('、'),
      memo: `含 ${sensLabels.join('、')}，当前角色无明文权限，已按脱敏值导出${scopeText ? '；' + scopeText : ''}`
    })
    return { columns, rows: out, masked: true, count, sensitive: sensLabels }
  }

  track('export', { name, count, masked: false, sensitive: sensLabels.length })
  const big = count > EXPORT_AUDIT_ROWS
  _pushExportLog({
    name, source, who, result: '成功', rows: count, field: sensLabels.join('、'),
    memo: [
      sensLabels.length ? `含敏感字段 ${sensLabels.join('、')}（明文）` : '',
      big ? `大额导出（>${EXPORT_AUDIT_ROWS} 条）` : '',
      scopeText
    ].filter(Boolean).join('；') || '常规导出'
  })
  return { columns, rows: list, masked: false, count, sensitive: sensLabels }
}

/* ---------------- 数据访问日志（查看 + 导出，统一一个台账） ---------------- */

const _allAccessRows = () =>
  [...ACCESS_LOGS, ...EXPORT_LOGS].sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.logId).localeCompare(String(a.logId)))

export function accessLogRows(filters = {}) {
  const today = _realToday()
  const kw = (filters.kw || '').trim()
  return _allAccessRows().filter(r =>
    (!filters.action || r.action === filters.action) &&
    (!filters.result || r.result === filters.result) &&
    (!filters.operator || r.operator === filters.operator) &&
    (!filters.days || (daysBetween(String(r.at).slice(0, 10), today) ?? 9999) <= Number(filters.days)) &&
    (!kw || `${r.operator}${r.roleName}${r.entityType}${r.entityName}${r.field}${r.fieldLabel}${r.source}${r.memo}`.includes(kw))
  )
}

export function queryAccessLogs({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => paged(accessLogRows(filters), pageNo, size))
}

/** 访问日志 KPI：查看明文 / 涉及人数 / 导出任务 / 脱敏与被拦截 */
export function accessLogSummary(filters = {}) {
  const rows = accessLogRows(filters)
  const reveals = rows.filter(r => r.action === '查看明文')
  const exports = rows.filter(r => r.action === '导出数据')
  return {
    reveals: reveals.length,
    owners: new Set(reveals.map(r => r.entityId).filter(Boolean)).size,
    operators: new Set(rows.map(r => r.operator).filter(Boolean)).size,
    exports: exports.length,
    masked: exports.filter(r => r.result === '脱敏').length,
    blocked: rows.filter(r => r.result === '拦截').length,
    rows: rows.length
  }
}

export const accessActionOpts = () => ['查看明文', '导出数据']
export const accessResultOpts = () => ['成功', '脱敏', '拦截']
export const accessOperatorOpts = () => [...new Set(_allAccessRows().map(r => r.operator).filter(Boolean))]

/**
 * 导出日志（契约 `GET /export-logs`）：只含「导出数据」这一类，且是**文件级**的。
 * 与访问留痕分开的理由：导出是数据外流的主要通道，"谁在什么时候导了多少行出去"
 * 要能单独按结果筛（被拦的那些才最值得看）；混在一张表里，揭示记录会把它淹掉。
 */
export function exportLogRows({ result = '', operator = '', days = 7, kw = '' } = {}) {
  const today = _realToday()
  const k = String(kw || '').trim()
  return EXPORT_LOGS
    .map(r => ({
      logId: r.logId, at: r.at, operator: r.operator, roleName: r.roleName,
      orgName: r.orgName, scopeMode: r.scopeMode,
      name: r.entityName, format: 'xlsx',
      rows: r.rows, result: r.result, memo: r.memo,
      hash: r.hash, prevHash: r.prevHash
    }))
    .filter(r =>
      (!result || r.result === result) &&
      (!operator || r.operator === operator) &&
      (!days || (daysBetween(String(r.at).slice(0, 10), today) ?? 9999) <= Number(days)) &&
      (!k || `${r.operator}${r.roleName}${r.name}${r.memo}${r.scopeMode}`.includes(k)))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.logId).localeCompare(String(a.logId)))
}

/* 静态历史留痕：不消耗 PRNG，只在内存里铺一段可演示的基线数据 */
;(function _seedAccessLogs() {
  if (!owners.length) return
  const pool = EMP_ROWS.filter(e => ['楼栋管家', '收银员', '客服专员', '项目经理'].includes(e.position) && e.status !== '离职')
  if (!pool.length) return
  const roleOf = pos => ({ 楼栋管家: '楼栋管家', 收银员: '收银员', 客服专员: '客服专员', 项目经理: '项目经理' }[pos] || '')
  const stamp = (i) => {
    const back = i < 16 ? 0 : Math.floor(i / 8)
    const { date, p } = _agoDay(back)
    const hh = 9 + (i % 9)
    const mm = (i * 17) % 60
    return `${date} ${p(hh)}:${p(mm)}`
  }
  for (let i = 0; i < 48; i++) {
    const e = pool[(i * 5 + 3) % pool.length]
    const o = owners[(i * 17 + 11) % owners.length]
    const field = i % 4 === 0 ? 'idCard' : 'phone'
    ACCESS_LOGS.push({
      logId: 'AL' + String(2000 + i).padStart(6, '0'),
      at: stamp(i), operator: e.name, roleName: roleOf(e.position), orgName: orgNameOf(e.orgId),
      scopeMode: e.position === '楼栋管家' ? '责任范围' : '本项目',
      action: '查看明文', entityType: '业主', entityId: o.ownerId, entityName: o.name,
      field, fieldLabel: sensitiveLabelOf(field), source: i % 3 === 0 ? '/a/owners' : (i % 3 === 1 ? '/b/collection' : '/a/tenants'),
      rows: 1, result: '成功', memo: ''
    })
  }
  const expSeed = [
    ['导出被拦截', '拦截', '账单查询', 0, '超过单次上限 50000 条'],
    ['导出脱敏', '脱敏', '业主档案', 50, '含 手机号，当前角色无明文权限，已按脱敏值导出'],
    ['导出明文', '成功', '业主档案', 50, '含敏感字段 手机号（明文）'],
    ['导出明文', '成功', '租户管理', 50, '含敏感字段 手机号、证件号（明文）'],
    ['导出明文', '成功', '催缴工作台', 20, '含敏感字段 手机号（明文）'],
    ['导出明文', '成功', '账单查询', 20, '常规导出']
  ]
  expSeed.forEach(([action, result, name, n, memo], i) => {
    const e = pool[(i * 3 + 1) % pool.length]
    EXPORT_LOGS.push({
      logId: 'EL' + String(3000 + i).padStart(6, '0'),
      at: stamp(i * 2 + 5), operator: e.name, roleName: roleOf(e.position), orgName: orgNameOf(e.orgId),
      scopeMode: '本项目', action: '导出数据', entityType: '导出任务', entityId: '', entityName: name,
      field: memo.includes('手机号') ? '手机号' : '', fieldLabel: '', source: '/e/downloads',
      rows: n, result, memo
    })
  })
})()

/* ==================================================================
 * 口径自检（/e/audit）· 2026-10-30
 * ----------------------------------------------------------------
 * 目的：把「欠费口径 / 枚举取值 / 外键完整性 / 权限码引用」这些容易被单点改坏的东西
 * 变成可一键跑的不变量检查，页面上一眼看到红绿。开发阶段这张表应该直接搬成后端单测。
 * 每条 check 返回 { group, name, pass, detail }。
 * ================================================================== */

const _near = (a, b, eps = 0.02) => Math.abs((a || 0) - (b || 0)) <= eps
const _money2 = n => Math.round((n || 0) * 100) / 100
const _enumBad = (rows, key, allowed) => {
  const bad = rows.filter(r => r[key] !== '' && r[key] !== undefined && r[key] !== null && !allowed.includes(r[key]))
  return { pass: bad.length === 0, detail: bad.length ? `${bad.length} 行越界，例如「${bad[0][key]}」` : `${rows.length} 行全部合法` }
}

/** 路由守卫冲突：permCodeOfPath 按 route 精确匹配取第一个 view，同一路由挂两个功能会互相抢 */
function _permRouteIssues() {
  const issues = []
  const byRoute = new Map()
  for (const p of permissions) {
    if (!p.route) continue
    const key = `${p.route}|${p.op}`
    const cur = byRoute.get(key)
    if (cur && cur.func !== p.func) issues.push(`${p.route} 同时挂了 ${cur.func} / ${p.func}`)
    else byRoute.set(key, p)
  }
  const sens = permissions.find(p => p.func === 'sensitive')
  if (sens && sens.route) issues.push('a.sensitive.view 绑了路由，会抢 /a/owners 的页面守卫')
  return issues
}

/** 白名单里的字段必须在真实数据里出现过（防止登记了不存在的列，导出时静默脱敏不到） */
function _sensitiveFieldMiss() {
  const tables = [owners, tenants, employees]
  return ['phone', 'idCard'].filter(k => !tables.some(rows => rows.some(r => r[k] !== undefined && r[k] !== '')))
}

export function auditChecks() {
  const out = []
  const push = (group, name, pass, detail) => out.push({ group, name, pass, detail })

  /* ---------- 1. 金额自洽 ---------- */
  const eff = BILL_ROWS.filter(isEffectiveBill)
  const payable = _money2(eff.reduce((s, b) => s + (b.payable || 0), 0))
  const paid = _money2(eff.reduce((s, b) => s + (b.paidAmount || 0), 0))
  const unpaid = _money2(eff.reduce((s, b) => s + (b.unpaid || 0), 0))
  push('金额口径', '应收 = 已收 + 未收（剔除已作废 / 已减免）', _near(payable, paid + unpaid),
    `应收 ${payable} / 已收 ${paid} + 未收 ${unpaid} = ${_money2(paid + unpaid)}`)

  const debtSum = _money2(eff.filter(isDebt).reduce((s, b) => s + (b.unpaid || 0), 0))
  push('金额口径', '欠费 = 未缴 + 部分缴 + 逾期 三类的未收之和', _near(debtSum, unpaid),
    `欠费 ${debtSum} vs 未收 ${unpaid}`)

  const byStatus = ['未缴', '部分缴', '逾期'].reduce((s, st) =>
    s + eff.filter(b => b.status === st).reduce((n, b) => n + (b.unpaid || 0), 0), 0)
  push('金额口径', '三类欠费分开相加 = 欠费合计', _near(_money2(byStatus), debtSum),
    `${_money2(byStatus)} vs ${debtSum}`)

  const badBill = eff.find(b => !_near(b.payable, (b.paidAmount || 0) + (b.unpaid || 0), 0.01))
  push('金额口径', '逐张账单应收 = 已收 + 未收', !badBill,
    badBill ? `账单 ${badBill.billId}：${badBill.payable} ≠ ${badBill.paidAmount} + ${badBill.unpaid}` : `${eff.length} 张逐条核对通过`)

  const paySum = _money2(PAY_ROWS.reduce((s, p) => s + (p.amount || 0), 0))
  push('金额口径', '缴费流水合计与收银 KPI 同源', paySum > 0, `流水合计 ${paySum}（${PAY_ROWS.length} 笔）`)

  /* ---------- 2. 枚举一致性 ---------- */
  push('枚举一致性', '账单状态 ∈ ENUM.billStatus', ...Object.values(_enumBad(BILL_ROWS, 'status', ENUM.billStatus)))
  push('枚举一致性', '工单状态 ∈ ENUM.woStatus', ...Object.values(_enumBad(WO_ROWS, 'status', ENUM.woStatus)))
  push('枚举一致性', '工单类型 ∈ ENUM.woType', ...Object.values(_enumBad(WO_ROWS, 'type', ENUM.woType)))
  push('枚举一致性', '工单优先级 ∈ ENUM.priority', ...Object.values(_enumBad(WO_ROWS, 'priority', ENUM.priority)))
  push('枚举一致性', '缴费方式 ∈ ENUM.payMethod', ...Object.values(_enumBad(PAY_ROWS, 'method', ENUM.payMethod)))
  push('枚举一致性', '通行方向 ∈ ENUM.passDirection', ...Object.values(_enumBad(PASS_ROWS, 'direction', ENUM.passDirection)))
  push('枚举一致性', '识别方式 ∈ ENUM.passChannel', ...Object.values(_enumBad(PASS_ROWS, 'channel', ENUM.passChannel)))
  push('枚举一致性', '品质状态 ∈ ENUM.qualityStatus', ...Object.values(_enumBad(QC_ROWS, 'status', ENUM.qualityStatus)))
  push('枚举一致性', '租户核验状态 ∈ ENUM.tenantVerify', ...Object.values(_enumBad(TENANT_ROWS, 'verifyStatus', ENUM.tenantVerify)))

  /* ---------- 3. 字典覆盖（有值必须有配色） ---------- */
  const dictOf = Object.fromEntries(DICT_MAP)
  const dictDomains = Object.entries({
    billStatus: ['bill', BILL_ROWS, 'status'],
    woStatus: ['workOrder', WO_ROWS, 'status'],
    qualityStatus: ['quality', QC_ROWS, 'status'],
    tenantVerify: ['tenantVerify', TENANT_ROWS, 'verifyStatus']
  })
  let dictMiss = 0
  const dictDetail = []
  for (const [label, [domain, rows, key]] of dictDomains) {
    const map = dictOf[domain] || {}
    const bad = [...new Set(rows.map(r => r[key]))].filter(v => !map[v])
    if (bad.length) { dictMiss += bad.length; dictDetail.push(`${label}: ${bad.join('、')}`) }
  }
  push('字典覆盖', '每个状态值都有配色（否则标签显示灰色）', dictMiss === 0, dictMiss ? dictDetail.join('；') : '全部命中')

  /* ---------- 4. 外键完整性 ---------- */
  const houseIds = new Set(houses.map(h => h.houseId))
  const empIds = new Set(employees.map(e => e.empId))
  const ownerIds = new Set(owners.map(o => o.ownerId))
  const badBillHouse = BILL_ROWS.filter(b => b.houseId && !houseIds.has(b.houseId))
  push('外键完整性', '账单 houseId → 房屋台账', badBillHouse.length === 0,
    badBillHouse.length ? `${badBillHouse.length} 张账单找不到房屋` : `${BILL_ROWS.length} 张账单全部可回溯`)

  const badSteward = houses.filter(h => h.stewardEmpId && !empIds.has(h.stewardEmpId))
  push('外键完整性', '房屋 stewardEmpId → 员工档案', badSteward.length === 0,
    badSteward.length ? `${badSteward.length} 户责任人在员工表里不存在` : `${houses.length} 户责任人均有效`)

  const badTenant = TENANT_ROWS.filter(t => t.ownerId && !ownerIds.has(t.ownerId))
  push('外键完整性', '租户 ownerId → 业主档案', badTenant.length === 0,
    badTenant.length ? `${badTenant.length} 条租户找不到业主` : `${TENANT_ROWS.length} 条租户均可回溯业主`)

  const noSteward = buildings.filter(b => !b.stewardEmpId)
  push('责任范围', '每栋楼都有责任楼管（否则业主没人管）', noSteward.length === 0,
    noSteward.length ? `${noSteward.map(b => b.name).join('、')} 未分配` : `${buildings.length} 栋全覆盖`)

  const dupBind = (() => {
    const seen = new Set()
    for (const r of STEWARD_BINDINGS) {
      const key = `${r.buildingId}|${r.unitId || ''}`
      if (seen.has(key)) return `重复绑定 ${key}`
      seen.add(key)
    }
    return ''
  })()
  push('责任范围', '同一楼栋（单元）只允许一条有效绑定', !dupBind, dupBind || `${STEWARD_BINDINGS.length} 条绑定无重复`)

  /* ---------- 5. 权限码引用 ---------- */
  const permCodes = new Set(permissions.map(p => p.code))
  const badPerm = []
  for (const r of roles) for (const c of r.perms || []) if (!permCodes.has(c)) badPerm.push(`${r.roleId}:${c}`)
  push('权限一致', '角色引用的权限码都在权限表里', badPerm.length === 0,
    badPerm.length ? `${badPerm.slice(0, 3).join('、')}${badPerm.length > 3 ? ` 等 ${badPerm.length} 个` : ''}` : `${roles.length} 个角色 / ${permCodes.size} 个权限位全部对得上`)

  const badRoute = _permRouteIssues()
  push('权限一致', '同一路由上没有两个功能抢守卫（sensitive 必须无路由）', badRoute.length === 0,
    badRoute.length ? badRoute.slice(0, 4).join('、') : `${permissions.filter(p => p.route).length} 个页面权限码路由唯一`)

  /* 月结的两级授权：会结账的人不一定能推翻封账。
     这条最容易在以后被人"顺手"合并——把反结权限挪回 b 域，财务通配一挂，人人可反结，
     而页面上看不出区别（按钮就在那里）。 */
  const finRoles = roles.filter(r => (r.perms || []).includes(MONTH_CLOSE_PERM))
  const overreach = finRoles.filter(r => (r.perms || []).includes(MONTH_REOPEN_PERM) && !r.perms.includes('e.audit.view')
    && r.roleId !== 'R-FINM' && r.roleId !== 'R-GM')
  push('权限一致', '会结账 ≠ 能反结（反结须显式授权，不被财务通配吃掉）', overreach.length === 0,
    overreach.length
      ? `${overreach.map(r => r.roleId).join('、')} 同时拥有结账与反结，检查是否被通配误授`
      : `${finRoles.length} 个角色可结账，其中 ${finRoles.filter(r => (r.perms || []).includes(MONTH_REOPEN_PERM)).length} 个可反结`)
  /* 反结是**按钮级**权限，不能绑路由：绑了会抢走 /b/month-close 的页面守卫，
     结果是"能进页面的人"和"能反结的人"变成同一批，两级授权退回一级 */
  /* 治理留痕：权限变更日志必须"记差异"，不能只记"保存了一次"。
     这条不变量防的是以后有人图省事改成只记动作——那时日志还在、页面还好看，
     但审计问「谁给这个角色加了这个权限」就答不出来了。 */
  const noDiff = PERM_CHANGES.filter(r => !r.addedCount && !r.removedCount)
  const diffMismatch = PERM_CHANGES.filter(r => r.addedCount !== (r.added || []).length
    || r.removedCount !== (r.removed || []).length)
  push('治理留痕', '权限变更只记有差异的记录，且 +N/-N 与明细条数一致',
    noDiff.length === 0 && diffMismatch.length === 0,
    noDiff.length || diffMismatch.length
      ? `${noDiff.length} 条无差异、${diffMismatch.length} 条计数与明细不符`
      : `${PERM_CHANGES.length} 条变更记录，均含逐条权限明细`)
  const orphanPerm = PERM_CHANGES.flatMap(r => [...(r.added || []), ...(r.removed || [])])
    .filter(c => !permCodes.has(c))
  push('治理留痕', '变更明细里的权限码都存在于权限表（写错码=留了一条假痕）', orphanPerm.length === 0,
    orphanPerm.length ? `未命中：${[...new Set(orphanPerm)].slice(0, 4).join('、')}` : '全部可解析为真实权限位')

  /* 审批链：批准了却没写进权限（或写进去了却没留痕）都是"看起来对、其实断了一环" */
  const approvedNoLog = PERM_REQUESTS.filter(r => r.status === '已通过' && !r.changeId)
  push('治理留痕', '已通过的申请必须生成变更记录（否则批了等于没生效）', approvedNoLog.length === 0,
    approvedNoLog.length ? `${approvedNoLog.map(r => r.reqId).join('、')} 缺变更记录` : `${PERM_REQUESTS.filter(r => r.status === '已通过').length} 条已通过申请均有记录号`)
  /* 双人原则：一个人批不了自己的提权——同一角色提交又批准就是自批 */
  const selfApproved = PERM_REQUESTS.filter(r => r.status === '已通过' && r.approver && r.approver === r.submitBy)
  push('治理留痕', '双人原则：审批人不能是提交人（不能给自己提权）', selfApproved.length === 0,
    selfApproved.length ? `${selfApproved.map(r => r.reqId).join('、')} 由提交人自己批准` : '所有已通过申请均由另一角色批准')
  const badReqDiff = PERM_REQUESTS.filter(r => r.addedCount !== (r.added || []).length
    || r.removedCount !== (r.removed || []).length
    || (r.added || []).concat(r.removed || []).some(c => !permCodes.has(c)))
  push('治理留痕', '申请明细与计数一致，且权限码真实存在', badReqDiff.length === 0,
    badReqDiff.length ? `${badReqDiff.map(r => r.reqId).join('、')} 明细不一致或有未知权限码` : `${PERM_REQUESTS.length} 条申请全部可解析`)

  const reopenPerm = permissions.find(p => p.code === MONTH_REOPEN_PERM)
  const closePagePerm = permissions.find(p => p.route === '/b/month-close')
  const twoLevel = !!reopenPerm && !reopenPerm.route && closePagePerm?.code === 'b.monthClose.view'
  push('权限一致', '月结页有页面守卫，反结是无路由的按钮级权限（两级授权不塌成一级）', twoLevel,
    twoLevel ? 'b.monthClose.view 守页面，e.monthReopen.edit 管反结' : '反结权限绑了路由或页面缺守卫，两级授权失效')

  /* ---------- 6. 敏感字段 ---------- */
  push('数据安全', '敏感字段白名单非空且字段名合法', Object.keys(SENSITIVE_FIELDS).length > 0,
    `覆盖 ${Object.keys(SENSITIVE_FIELDS).join(' / ')}`)
  const badField = _sensitiveFieldMiss()
  push('数据安全', '白名单字段在数据里真实存在', badField.length === 0,
    badField.length ? `未命中：${badField.join('、')}` : 'phone / idCard 均可命中')

  /* ---------- 7. 服务端能力（范围 / 脱敏 / 审计链） ---------- */
  const sample = redactList([{ phone: '13800138001', idCard: '510101199001011231' }])[0]
  const redactOk = sample.phone === '138****8001' && sample.idCard === '5101**********1231' && sample.phoneRedacted
  push('服务端能力', '列表返回值为掩码（明文只走揭示接口）', redactOk,
    redactOk ? `手机 ${sample.phone} / 证件 ${sample.idCard}` : '脱敏未生效，列表在泄露明文')

  const chain = verifyLogChain()
  push('服务端能力', '访问日志哈希链完整（任何一条被改都会断链）', chain.ok,
    chain.ok ? `${chain.total} 条日志链完整，链尾 ${String(chain.tail || '').slice(0, 8)}…` : `第 ${chain.at} 条起断链，日志可能被改动`)

  let guardOk = true
  let guardMsg = '当前角色为全量范围，不做越权拦截（切换成楼管/项目经理后再看本项）'
  const sc = currentScope()
  if (sc.mode !== '全部项目') {
    const outside = communities.map(c => c.communityId).find(id => !(sc.communityIds || new Set()).has(id))
    if (outside) {
      try { assertInScope({ communityId: outside }); guardOk = false; guardMsg = `传 ${outside} 未被拦截` }
      catch (e) { guardOk = e.code === 403; guardMsg = `传范围外项目已被拒绝：${e.message}` }
    } else guardMsg = '当前角色覆盖全部项目，无越权样本可测'
  }
  push('服务端能力', '越权筛选在取数入口被拒绝（403 而非空列表）', guardOk, guardMsg)

  /* ---------- 8. 汇总 ---------- */
  const failed = out.filter(c => !c.pass).length
  return { checks: out, total: out.length, failed, at: _now() }
}

/* ==================================================================
 * 服务端能力模拟（2026-10-30）
 * ----------------------------------------------------------------
 * 原型没有后端，但下面四件事如果只在页面上"演"，开发阶段一定会被问"你后端怎么保证"。
 * 这里把它们放到数据服务层（=将来后端的位置）实现，页面拿到的行为与真实后端一致：
 *   ① 范围强制（越权抛 403）—— 不是页面过滤，是取数入口就拒绝
 *   ② 唯一约束 + 乐观锁（409）—— 并发改同一条会冲突而不是后者覆盖前者
 *   ③ 列表不下发敏感明文（只给掩码，明文走揭示接口并留痕）
 *   ④ 访问日志哈希链（追加写 + prev/hash，可校验是否被改过）
 * ================================================================== */

/* ---------- ① 范围强制 ---------- */
function _forbid(message) {
  const e = new Error(message)
  e.code = 403
  return e
}

/**
 * 越权校验：页面传进来的筛选条件如果落在当前角色数据范围之外，直接拒绝。
 * 注意与 `scopeFilter` 的分工：scopeFilter 是"结果收敛"，这里是"入口拒绝"——
 * 真实后端两者都要（否则拿别人 communityId 一传就能探测数据量）。
 */
export function assertInScope({ communityId = '', buildingId = '', unitId = '' } = {}) {
  const s = currentScope()
  if (s.mode === '全部项目') return true
  const comms = s.communityIds || new Set()
  if (communityId && !comms.has(communityId)) {
    throw _forbid(`无权查看「${communityName(communityId)}」的数据：超出当前数据范围（${s.mode}）`)
  }
  if (buildingId) {
    const b = buildings.find(x => x.buildingId === buildingId)
    if (b && !comms.has(b.communityId)) throw _forbid(`无权查看「${b.name}」的数据：超出当前数据范围`)
    if (s.mode === '责任范围') {
      const ids = s.houseIds || new Set()
      const hit = houses.filter(h => h.buildingId === buildingId && (!unitId || h.unitId === unitId))
      if (!hit.some(h => ids.has(h.houseId))) throw _forbid('该楼栋不在你的责任范围内')
    }
  }
  return true
}

/* ---------- ② 唯一约束 + 乐观锁 ---------- */
const _verOf = row => Number(row && row._ver) || 1
/** 写成功后自增版本号；列表回传时前端带上即可参与冲突检测 */
export function bumpVersion(row) {
  if (!row) return
  row._ver = _verOf(row) + 1
  row.updatedAt = _now()
  return row._ver
}
/** 期望版本与当前不一致 → 409（页面提示"已被他人修改，请刷新"） */
export function checkVersion(row, expected) {
  if (expected === undefined || expected === null || expected === '') return true
  if (Number(expected) !== _verOf(row)) {
    const e = new Error('该记录已被他人修改，请刷新后重试')
    e.code = 409
    throw e
  }
  return true
}
/** 唯一约束：同一张表里某字段不允许重复（空值不参与） */
export function assertUnique(rows, field, value, { excludeId = '', idKey = '', label = '该值' } = {}) {
  const v = String(value ?? '').trim()
  if (!v) return true
  const dup = rows.find(r => String(r[field] ?? '').trim() === v && (!idKey || r[idKey] !== excludeId))
  if (dup) {
    const e = new Error(`${label}「${v}」已存在，不能重复录入`)
    e.code = 409
    throw e
  }
  return true
}

/* ---------- ③ 列表不下发敏感明文 ---------- */
const _redactRow = (row, fields) => {
  if (!row) return row
  const out = { ...row }
  for (const f of fields) {
    if (out[f] !== undefined && out[f] !== null && out[f] !== '') {
      out[f] = maskSensitive(f, out[f])
      out[`${f}Redacted`] = true
    }
  }
  return out
}
/**
 * 列表批量脱敏：列表页是泄露面最大的地方（一次 20~50 行、还能导出），所以**列表不下发明文**。
 * 明文只能通过 `revealSensitive` 单条获取，并留下访问日志。
 * 详情接口仍给明文——详情是"已授权看这一条"的语境，且大量内联编辑依赖它。
 */
function redactList(rows, fields = ['phone', 'idCard']) {
  return rows.map(r => _redactRow(r, fields))
}

/* ---------- ④ 访问日志哈希链 ---------- */
let _LOG_TAIL = ''
function _hash(str) {
  let h1 = 0x811c9dc5, h2 = 0x1000193
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = (h1 ^ c) * 0x01000193 >>> 0
    h2 = (h2 + c * (i + 7)) >>> 0
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'))
}
/** 给一条日志盖链：prev = 上一条的 hash，hash = H(prev + 关键字段) */
function sealLog(log) {
  const payload = [log.logId, log.at, log.operator, log.action, log.entityId, log.field, log.result, log.rows].join('|')
  log.prev = _LOG_TAIL
  log.hash = _hash(_LOG_TAIL + '|' + payload)
  _LOG_TAIL = log.hash
  return log
}
/** 模块加载后按时间顺序给存量日志补齐哈希链（种子日志也要能通过校验） */
export function resealLogs() {
  _LOG_TAIL = ''
  const all = [...ACCESS_LOGS, ...EXPORT_LOGS].sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.logId).localeCompare(String(b.logId)))
  for (const l of all) sealLog(l)
  return all.length
}
/** 链校验：任何一条被改过（操作人 / 对象 / 结果），后面的 hash 都会对不上 */
export function verifyLogChain() {
  const all = [...ACCESS_LOGS, ...EXPORT_LOGS].sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.logId).localeCompare(String(b.logId)))
  let prev = ''
  for (const l of all) {
    const payload = [l.logId, l.at, l.operator, l.action, l.entityId, l.field, l.result, l.rows].join('|')
    const expect = _hash(prev + '|' + payload)
    if (l.hash !== expect) return { ok: false, at: l.logId, total: all.length }
    prev = l.hash
  }
  return { ok: true, total: all.length, tail: prev }
}

/* 模块初始化收尾：给种子访问日志补齐哈希链（必须在所有种子代码之后执行） */
resealLogs()

/* ==================================================================
 * 批量操作（2026-10-30）
 * ----------------------------------------------------------------
 * 楼管一天要处理几十户，逐条点不可用。批量这里有两个共性原则：
 *   ① **部分成功要报清楚**：返回 { ok, failed:[{ id, reason }] }，页面把失败原因原样展示；
 *   ② 每批都留痕（谁、多少条、什么原因），批量改状态是高危动作。
 * ================================================================== */

/** 批量催缴：为选中的欠费账单各生成一条催缴记录（同一批次号） */
export function batchRemindBills(billIds = [], { operator = '物业前台', method = '短信' } = {}) {
  const ids = [...new Set(billIds)]
  if (!ids.length) throw new Error('请先选择账单')
  const batchNo = 'CJ' + new Date().toISOString().slice(2, 7).replace('-', '') + String(collectionRecords.length + 1).padStart(3, '0')
  const ok = []
  const failed = []
  for (const id of ids) {
    const b = BILL_ROWS.find(x => x.billId === id)
    if (!b) { failed.push({ id, reason: '账单不存在' }); continue }
    if (!isDebt(b)) { failed.push({ id, reason: '该账单没有欠费，无需催缴' }); continue }
    collectionRecords.unshift({
      recordId: 'CR' + String(collectionRecords.length + 90001).slice(-5),
      batchNo, round: 1, billId: b.billId, period: b.period,
      communityId: b.communityId, communityName: communityName(b.communityId),
      houseId: b.houseId, houseName: houseName(b.houseId),
      ownerId: b.ownerId, ownerName: ownerName(b.ownerId),
      phone: (_OWNER_OF.get(b.ownerId) || {}).phone || '',
      itemName: b.itemName, amount: b.unpaid || 0, overdueDays: b.overdueDays || 0,
      method, status: '已发送', operator, collectTime: _now(), promiseDate: null,
      remark: '批量催缴'
    })
    ok.push(id)
  }
  track('batch_remind', { total: ids.length, ok: ok.length, failed: failed.length })
  return { ok: ok.length, failed, batchNo, total: ids.length }
}

/** 批量减免：把欠费账单置为「已减免」，未收清零；原因必填（钱的事不能没理由） */
export function batchReduceBills(billIds = [], { reason = '', operator = '项目经理' } = {}) {
  const ids = [...new Set(billIds)]
  if (!ids.length) throw new Error('请先选择账单')
  if (!String(reason).trim()) throw new Error('请填写减免原因')
  const ok = []
  const failed = []
  for (const id of ids) {
    const b = bills.find(x => x.billId === id)
    if (!b) { failed.push({ id, reason: '账单不存在' }); continue }
    if (!isDebt(b)) { failed.push({ id, reason: '该账单已结清或已减免' }); continue }
    const cut = Number(b.unpaid) || 0
    b.discount = (Number(b.discount) || 0) + cut
    b.unpaid = 0
    b.status = '已减免'
    b.reduceReason = reason
    b.reduceBy = operator
    b.reduceAt = _now()
    if (typeof _syncBillRow === 'function') _syncBillRow(b)
    ok.push(id)
  }
  if (ok.length) {
    STEWARD_LOG_unshift_safe({ action: '批量减免', by: operator, memo: `${ok.length} 张账单减免，原因：${reason}` })
  }
  track('batch_reduce', { total: ids.length, ok: ok.length, failed: failed.length })
  return { ok: ok.length, failed, total: ids.length }
}

function STEWARD_LOG_unshift_safe(entry) {
  try { STEWARD_LOG.unshift({ at: _now(), ...entry }) } catch { /* 日志表未就绪时忽略 */ }
}

/** 批量核验：基础 6 项齐全的才通过，缺项的按条返回原因（不做"整批失败"） */
export function batchVerifyTenants(tenantIds = [], { operator = '物业前台' } = {}) {
  const ids = [...new Set(tenantIds)]
  if (!ids.length) throw new Error('请先选择租户')
  const ok = []
  const failed = []
  for (const id of ids) {
    const raw = tenants.find(x => x.tenantId === id)
    if (!raw) { failed.push({ id, name: id, reason: '租户不存在' }); continue }
    if ((raw.status || '在住') !== '在住') { failed.push({ id, name: raw.name, reason: '已搬离' }); continue }
    if (raw.verifyStatus === '已核验') { failed.push({ id, name: raw.name, reason: '已核验过' }); continue }
    const miss = _tenantFill(raw).missingBasic
    if (miss.length) { failed.push({ id, name: raw.name, reason: `缺 ${miss.join('、')}` }); continue }
    if ((raw.tenantType || '个人') === '公司' && !(raw.licenseFiles || []).length) {
      failed.push({ id, name: raw.name, reason: '缺营业执照影像件' }); continue
    }
    raw.verifyStatus = '已核验'
    raw.certified = true
    raw.verifiedBy = operator
    raw.verifiedAt = _now()
    _pushTenantHistory(id, { action: '批量核验', by: operator, at: raw.verifiedAt, memo: '基础信息齐全，批量核验通过', done: true })
    _syncTenantRow(id)
    ok.push(id)
  }
  track('batch_verify', { total: ids.length, ok: ok.length, failed: failed.length })
  return { ok: ok.length, failed, total: ids.length }
}

/* ==================================================================
 * 收费日结 · 退款冲红（C1，2026-10-30）
 * ----------------------------------------------------------------
 * 口径（三条，页面与接口同源）：
 *   ① **退款必须冲回账单**：退款不是「流水上打个标记」，要把对应账单的已收减掉、未收加回来，
 *      否则账单永远显示已缴，欠费报表少一笔——这是最容易漏的一步；
 *   ② **已开票的退款必须红冲发票**：流水 `invoiceStatus` 转「已冲红」，财务据此红冲；
 *   ③ **日结按「实收净额」轧账**：现金按实点、非现金按渠道流水，差异必须留痕（差多少、谁确认）。
 * ================================================================== */

const REFUND_ROWS = []
const DAILY_CLOSES = []
let _RF_SEQ = 0

const _r2 = n => Math.round((n || 0) * 100) / 100
const _dayOf = s => String(s || '').slice(0, 10)

/** 账单状态按「已收 / 未收」重算：退款后必须回落，不能停在「已缴」 */
function _recalcBillStatus(b) {
  const unpaid = _r2(b.unpaid || 0)
  const paid = _r2(b.paidAmount || 0)
  if (unpaid <= 0.01) return '已缴'
  if (paid > 0.01) return '部分缴'
  return (b.overdueDays || 0) > 0 ? '逾期' : '未缴'
}

/**
 * 退款（含全额退款与部分退款）。
 * @param {string} payId 原流水号
 * @param {{amount?:number, reason:string, operator?:string, at?:string}} opt
 */
export function refundPayment(payId, { amount, reason = '', operator = '项目经理', at = '' } = {}) {
  const p = payments.find(x => x.payId === payId)
  if (!p) throw new Error('流水不存在')
  const already = _r2(p.refundAmount || 0)
  const left = _r2((p.amount || 0) - already)
  if (left <= 0) throw new Error('该笔已全额退款，不能重复退款')
  const amt = amount === undefined || amount === null || amount === '' ? left : _r2(Number(amount))
  if (!(amt > 0)) throw new Error('退款金额必须大于 0')
  if (amt > left + 0.01) throw new Error(`退款金额不能超过可退金额 ${left}`)
  if (String(reason).trim().length < 4) throw new Error('请填写退款原因（至少 4 个字）')

  const day = _dayOf(at || _now())
  /* 原路退：按原收款各方式的比例退回去。整笔按最大方式退的话，
     现金那部分会被记成微信退款，日结的现金实点就对不上了 */
  const src = _splitsOf(p)
  const refundSplits = (() => {
    const cents = src.map(x => Math.round(x.amount * 100))
    const total = cents.reduce((a, c) => a + c, 0) || 1
    let leftC = Math.round(amt * 100)
    return src.map((x, i) => {
      const isLast = i === src.length - 1
      const take = isLast ? leftC : Math.round(Math.round(amt * 100) * cents[i] / total)
      leftC -= take
      return { method: x.method, amount: take / 100 }
    }).filter(x => x.amount > 0.004)
  })()
  _RF_SEQ += 1
  const row = {
    refundId: 'RF' + String(_RF_SEQ).padStart(5, '0'),
    refundNo: `TK-${day}-${String(_RF_SEQ).padStart(3, '0')}`,
    payId: p.payId, billId: p.billId, houseId: p.houseId, ownerId: p.ownerId,
    ownerName: ownerName(p.ownerId), houseName: houseName(p.houseId),
    communityId: (houses.find(h => h.houseId === p.houseId) || {}).communityId || '',
    method: refundSplits.reduce((m, x) => (x.amount > m.amount ? x : m), refundSplits[0] || { method: p.method }).method,
    splits: refundSplits.length ? refundSplits : [{ method: p.method, amount: amt }],
    channel: p.channel,
    amount: amt, kind: amt >= left - 0.01 ? '全额' : '部分',
    reason: String(reason).trim(), operator, at: at || _now(),
    invoiceRedFlushed: p.invoiceStatus === '已开票'
  }
  REFUND_ROWS.unshift(row)

  /* ① 流水：累计退款额 + 状态；已开票的同时红冲发票 */
  p.refundAmount = _r2(already + amt)
  p.refundStatus = p.refundAmount >= (p.amount || 0) - 0.01 ? '已全额退款' : '部分退款'
  if (p.invoiceStatus === '已开票') p.invoiceStatus = '已冲红'
  _syncPayRow(p)

  /* ② 账单：已收减、未收加，状态回落 —— 不做这一步，欠费报表会少一笔 */
  const b = bills.find(x => x.billId === p.billId)
  if (b) {
    b.paidAmount = _r2(Math.max(0, (b.paidAmount || 0) - amt))
    b.unpaid = _r2((b.unpaid || 0) + amt)
    b.status = _recalcBillStatus(b)
    b.refunded = _r2((b.refunded || 0) + amt)
    _syncBillRow(b)
  }
  track('refund', { amount: amt, kind: row.kind })
  return row
}

export function refundRows(filters = {}) {
  const kw = String(filters.kw || '').trim()
  return REFUND_ROWS.filter(r =>
    (!filters.communityId || r.communityId === filters.communityId) &&
    (!filters.method || r.method === filters.method) &&
    (!filters.range || (r.at >= filters.range[0] && r.at <= `${filters.range[1]} 23:59`)) &&
    (!kw || `${r.refundNo}${r.ownerName}${r.houseName}${r.reason}${r.operator}`.includes(kw))
  )
}

export function queryRefunds({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => paged(refundRows(filters), pageNo, size))
}

export function refundSummary(filters = {}) {
  const rows = refundRows(filters)
  return {
    count: rows.length,
    amount: _r2(rows.reduce((s, r) => s + r.amount, 0)),
    full: rows.filter(r => r.kind === '全额').length,
    redFlushed: rows.filter(r => r.invoiceRedFlushed).length
  }
}

/** 某个日期可用的日结数据：按收款方式汇总「收款 / 退款 / 净额」 */
export function dailyCloseRows(date = '2026-10-21') {
  const day = _dayOf(date)
  /* 组合支付必须**按方式拆开**再加总：一笔「现金 200 + 微信 122」如果整笔记在
     金额最大的方式下，现金实点会少 200，而对账时又查不出差在哪 */
  const flat = (rows, timeKey) => rows.flatMap(r =>
    _splitsOf(r).map(x => ({ ...r, method: x.method, amount: x.amount, _at: r[timeKey] })))
  const pays = flat(PAY_ROWS.filter(p => _dayOf(p.payTime) === day), 'payTime')
  const refs = flat(REFUND_ROWS.filter(r => _dayOf(r.at) === day), 'at')
  const methods = [...new Set([...pays.map(p => p.method), ...refs.map(r => r.method)])]
    .filter(Boolean).sort()   /* 空渠道不出一行：汇总里出现无名的行比少一行更糟 */
  return methods.map(m => {
    const inRows = pays.filter(p => p.method === m)
    const outRows = refs.filter(r => r.method === m)
    const income = _r2(inRows.reduce((s, p) => s + (p.amount || 0), 0))
    const refund = _r2(outRows.reduce((s, r) => s + r.amount, 0))
    return {
      method: m,
      count: inRows.length, amount: income,
      refundCount: outRows.length, refund,
      net: _r2(income - refund),
      /* 现金要实点，非现金按渠道流水自动对平 */
      mode: m === '现金' ? '实点' : '对流水',
      auto: m !== '现金'
    }
  })
}

/** 日结预览：当日应缴现金 + 差异（未提交前只是预览） */
export function dailyClosePreview(date = '2026-10-21', cashActual = null) {
  const rows = dailyCloseRows(date)
  const cash = rows.find(r => r.method === '现金') || { net: 0, count: 0, refund: 0, amount: 0 }
  const total = _r2(rows.reduce((s, r) => s + r.net, 0))
  const actual = cashActual === null || cashActual === '' || cashActual === undefined ? null : _r2(Number(cashActual))
  const closed = DAILY_CLOSES.find(c => c.date === _dayOf(date)) || null
  return {
    date: _dayOf(date),
    rows,
    cashExpected: cash.net,
    cashActual: actual,
    cashDiff: actual === null ? null : _r2(actual - cash.net),
    totalNet: total,
    count: rows.reduce((s, r) => s + r.count, 0),
    refund: _r2(rows.reduce((s, r) => s + r.refund, 0)),
    closed
  }
}

/**
 * 提交日结：一天只能结一次；有现金差异时必须填说明（钱对不上不能只点「确认」）。
 * 提交后该日期的流水锁定，页面按 `closed` 置灰。
 */
export function submitDailyClose({ date = '2026-10-21', cashActual = null, operator = '收银员', memo = '' } = {}) {
  const day = _dayOf(date)
  if (DAILY_CLOSES.some(c => c.date === day)) throw new Error(`${day} 已日结，不能重复提交`)
  const pre = dailyClosePreview(day, cashActual)
  if (!pre.count && !pre.refund) throw new Error('当日没有收款记录，无需日结')
  if (pre.cashDiff !== null && Math.abs(pre.cashDiff) > 0.01 && String(memo).trim().length < 4) {
    throw new Error('现金存在差异，请填写差异说明（至少 4 个字）')
  }
  const rec = {
    closeId: 'DC' + day.replace(/-/g, '').slice(2),
    closeNo: `RJ-${day.replace(/-/g, '')}-01`,
    date: day,
    count: pre.count,
    amount: _r2(pre.rows.reduce((s, r) => s + r.amount, 0)),
    refund: pre.refund,
    net: pre.totalNet,
    cashExpected: pre.cashExpected,
    cashActual: pre.cashActual === null ? pre.cashExpected : pre.cashActual,
    cashDiff: pre.cashDiff === null ? 0 : pre.cashDiff,
    operator, memo: String(memo).trim(), at: _now(),
    locked: true
  }
  DAILY_CLOSES.unshift(rec)
  track('daily_close', { date: day, net: rec.net, diff: rec.cashDiff })
  return rec
}

export const dailyCloseHistory = () => DAILY_CLOSES.slice(0, 30)
export const isDayClosed = date => DAILY_CLOSES.some(c => c.date === _dayOf(date))

/* ==================================================================
 * 工单 SLA 计时（C3，2026-10-30）
 * ----------------------------------------------------------------
 * 时间要按**工作日历**算，不能按自然小时：周五 17:00 报的单，24h SLA 到期是周一 17:00，不是周六。
 *   工作日 09:00–18:00（9 小时/天）；周六日与节假日不计时。
 * 停表条件：状态为「待业主确认」时不计时（等业主不算我们的处理时长）。
 * 生产上这张日历应落 `sla_calendars` 表；这里以常量表达，接口形状保持不变。
 * ================================================================== */

export const SLA_CALENDAR = {
  workStart: 9, workEnd: 18, hoursPerDay: 9,
  /** 2026 年剩余法定节假日（演示用，实际由系统配置下发） */
  holidays: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'],
  /** 数据集「当下」，与 seed 里的 isOverdue 同源 */
  now: '2026-10-21 18:00'
}
const SLA_POLICY = { 特急: 2, 紧急: 4, 普通: 24, 低: 48 }
/* 工单状态是「待派单 / 已派单 / 处理中 / 待确认 / 已完工 / 已关闭 / 已评价 / 已取消」——
   结束态不是「已完成」，是「已完工 / 已关闭 / 已评价」；「待确认」= 等业主确认，停表；
   「已取消」不计入 SLA（没干活，也没有超时一说）。 */
const SLA_DONE_STATUS = ['已完工', '已关闭', '已评价']
const SLA_PAUSE_STATUS = ['待确认']
const SLA_EXCLUDE_STATUS = ['已取消']

const _parseDT = s => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))
}
const _fmtDT = d => {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const _isWorkDay = d => {
  const w = d.getDay()
  if (w === 0 || w === 6) return false
  return !SLA_CALENDAR.holidays.includes(_dayOf(_fmtDT(d)))
}
/** 从 from 起，前进 hours 个「工作小时」，返回到期时间 */
function _addWorkHours(from, hours) {
  const d = new Date(from.getTime())
  let left = hours
  let guard = 0
  while (left > 0 && guard++ < 2000) {
    if (!_isWorkDay(d)) { d.setDate(d.getDate() + 1); d.setHours(SLA_CALENDAR.workStart, 0, 0, 0); continue }
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), SLA_CALENDAR.workStart, 0, 0, 0)
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), SLA_CALENDAR.workEnd, 0, 0, 0)
    if (d < dayStart) d.setTime(dayStart.getTime())
    if (d >= dayEnd) { d.setDate(d.getDate() + 1); d.setHours(SLA_CALENDAR.workStart, 0, 0, 0); continue }
    const avail = (dayEnd - d) / 3600000
    if (left <= avail) { d.setTime(d.getTime() + left * 3600000); left = 0 }
    else { left -= avail; d.setDate(d.getDate() + 1); d.setHours(SLA_CALENDAR.workStart, 0, 0, 0) }
  }
  return d
}
/** 两个时刻之间的「工作小时」 */
function _workHoursBetween(a, b) {
  if (!a || !b || b <= a) return 0
  let total = 0
  const d = new Date(a.getTime())
  let guard = 0
  while (d < b && guard++ < 2000) {
    if (!_isWorkDay(d)) { d.setDate(d.getDate() + 1); d.setHours(SLA_CALENDAR.workStart, 0, 0, 0); continue }
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), SLA_CALENDAR.workStart, 0, 0, 0)
    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), SLA_CALENDAR.workEnd, 0, 0, 0)
    if (d < dayStart) d.setTime(dayStart.getTime())
    const segEnd = b < dayEnd ? b : dayEnd
    if (segEnd > d) total += (segEnd - d) / 3600000
    if (b <= dayEnd) break
    d.setDate(d.getDate() + 1); d.setHours(SLA_CALENDAR.workStart, 0, 0, 0)
  }
  return Math.round(total * 10) / 10
}

/**
 * 一张工单的 SLA 状态。
 * @returns {{slaHours:number, dueAt:string, usedHours:number, leftHours:number, pct:number,
 *            breached:boolean, paused:boolean, overdueHours:number, finished:boolean}}
 */
export function woSlaState(wo) {
  if (!wo) return null
  const slaHours = Number(wo.slaHours) || SLA_POLICY[wo.priority] || 24
  const created = _parseDT(wo.createTime) || _parseDT(SLA_CALENDAR.now)
  const finished = SLA_DONE_STATUS.includes(wo.status)
  const endAt = finished ? (_parseDT(wo.finishTime) || _parseDT(SLA_CALENDAR.now)) : _parseDT(SLA_CALENDAR.now)
  const paused = SLA_PAUSE_STATUS.includes(wo.status)
  const usedHours = _workHoursBetween(created, endAt)
  const dueAt = _addWorkHours(created, slaHours)
  const leftHours = Math.round((slaHours - usedHours) * 10) / 10
  /* 停表期间不计超时：等业主确认的时间不能算到我们头上 */
  const breached = paused ? false : leftHours < 0
  return {
    slaHours, dueAt: _fmtDT(dueAt), usedHours,
    leftHours: finished ? Math.max(0, leftHours) : leftHours,
    pct: Math.min(100, Math.round(usedHours / slaHours * 1000) / 10),
    breached, paused, finished,
    overdueHours: leftHours < 0 ? Math.abs(leftHours) : 0
  }
}

/** SLA 概览：未闭环里剩余不足 20% / 已超时 各多少 */
export function woSlaSummary(filters = {}) {
  const list = scopeFilter(WO_ROWS, { emp: w => w.assignee, org: w => orgOfEmpName(w.assignee), house: w => w.houseId })
    .filter(_woHit(filters))
    .filter(w => !SLA_DONE_STATUS.includes(w.status) && !SLA_EXCLUDE_STATUS.includes(w.status))
  const states = list.map(w => ({ w, s: woSlaState(w) }))
  return {
    open: list.length,
    urgent: states.filter(x => x.s.leftHours >= 0 && x.s.leftHours <= x.s.slaHours * 0.2).length,
    breached: states.filter(x => x.s.breached).length,
    paused: states.filter(x => x.s.paused).length
  }
}

/* ================= 报表快照（跑批产物） =================
 * 2026-10-30 拍板：欠费账龄 / 收缴率 / 部门达标率这类**派生值不做实时查询**，
 * 由夜间跑批算好落库，页面按「期次」读快照。三条理由：
 *   ① 账龄 = 统计日 − 到期日，实时算会让同一张表每刷新一次变一个数；
 *   ② 审计要能回答「上个月报表当时长什么样」，实时算答不了；
 *   ③ 部门达标率要扫全量巡检明细，实时算会把列表拖到秒级。
 *
 * 期次模型（2026-10-30 拍板）：
 *   - **时点型**（欠费账龄）：月报 = 月末那天 24:00 的余额，年报 = 年末那天；期次只决定「看哪一天的余额」，
 *     不做整期汇总——把余额按天加起来没有业务含义。
 *   - **期间型**（收缴率 / 部门达标率）：月报 = 整月重算，年报 = 整年重算；**不能**由日快照累加，
 *     补录与退款会让「每天的余额相加」≠「整月发生额」。
 *   - 未月结的期次照样能出数，但 `provisional=true`（试算值），`statDate` 落在今天而不是期末。
 *   - 年报拆两张：**余额**走 arrears 的年视图（时点），**发生额**走 collection-rate 的年视图（区间）。
 *
 * 原型里的模拟方式：模块加载时算一遍日/月/年批次并**冻结**，之后改账单不影响已生成批次；
 * 只有点「重算」才会生成新批次——与契约 POST /reports/recalc 同语义。
 * 写操作纪律不变：内存态，刷新还原。
 */

export const REPORT_FORMULA = 'v1.0'
export const REPORT_STAT_DATES = ['2026-10-19', '2026-10-20', '2026-10-21']
export const REPORT_PERIOD_MONTHS = ['2026-08', '2026-09', '2026-10']
export const REPORT_PERIOD_YEARS = ['2026']
/**
 * 已月结记录（内存态）。报表的 provisional 就靠它判断：
 * 已结期次数字冻结，未结期次是试算值。预置 8/9 月已结，10 月待结。
 */
export const MONTH_CLOSES = []
/**
 * 只算「已结账」的**全公司**记录：反结过的记录留着，但不再封锁期间。
 * 项目级结账不改变报表口径——报表是全公司数，单个项目封账不能让它变定稿。
 */
export const isMonthClosed = period =>
  MONTH_CLOSES.some(c => c.period === period && c.status === '已结账' && !c.communityId)
/**
 * 该期间、该范围的封账记录。
 * - 不传 communityId：只看**全公司**结账（汇总口径）；
 * - 传 communityId：本项目结过就算封；**全公司结账覆盖所有项目**——
 *   否则全公司结完，单个项目还能补录，汇总数就对不上了。
 */
const _activeClose = (period, communityId = '') => {
  const list = MONTH_CLOSES.filter(c => c.period === period && c.status === '已结账')
  if (communityId) {
    return list.find(c => c.scope === 'community' && c.communityId === communityId)
      || list.find(c => !c.communityId) || null
  }
  return list.find(c => !c.communityId) || null
}
/** 已月结到哪个月（报表判断试算用；只认全公司口径，没有记录时返回空串） */
export const closedThrough = () =>
  MONTH_CLOSES.filter(c => c.status === '已结账' && !c.communityId)
    .reduce((m, c) => (c.period > m ? c.period : m), '')
export const REPORT_CLOSED_THROUGH = closedThrough()

export const AGING_BUCKETS = ['未到期', '0-30天', '31-90天', '91-180天', '180天以上']
export const REPORT_NAMES = {
  arrears: '欠费账龄统计',
  'collection-rate': '收缴率统计',
  'dept-target': '部门达标率统计'
}
/** 时点型：期次只定位「看哪一天」；其余为期间型 */
export const POINT_REPORTS = ['arrears']
export const PERIOD_TYPES = ['日', '月', '年']
const PT_RAW = { 日: 'day', 月: 'month', 年: 'year' }
export const periodLabelOf = t => PERIOD_TYPES.find(x => PT_RAW[x] === t) || '日'
/** 中文标签 → 内部值（页面用中文做 tab，接口用 day/month/year） */
export const periodRawOf = t => PT_RAW[t] || t

/**
 * 会抛异常的延时封装。
 * `delay()` 里的 fn 一旦抛错，Promise 永远不会 settle（页面卡在 loading）；
 * 报表「该期次没有批次」是业务异常，必须把它变成 reject。
 */
const delayReport = fn => new Promise((resolve, reject) => setTimeout(() => {
  if (getFailMode() !== 'off') {
    const e = new Error('数据加载失败')
    e.code = 500
    e.mock = true
    return reject(e)
  }
  try { resolve(fn()) } catch (e) { reject(e) }
}, 180))

const _r2f = n => Math.round((Number(n) || 0) * 100) / 100
const _r1f = n => Math.round((Number(n) || 0) * 10) / 10
const _pad2 = n => String(n).padStart(2, '0')
const _HOUSE_MAP = new Map(houses.map(h => [h.houseId, h]))
const _BILL_AS_OF = (b, statDate) => String(b.createTime || '').slice(0, 10) <= statDate
const _monthEnd = ym => {
  const [y, m] = String(ym).split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/** 账龄档：统计日 − 到期日；到期日 ≥ 统计日 = 未到期（还没到期的不算逾期） */
const agingOf = (dueDate, statDate) => {
  if (!dueDate) return '未到期'
  const d = daysBetween(dueDate, statDate)
  if (d == null || d <= 0) return '未到期'
  if (d <= 30) return '0-30天'
  if (d <= 90) return '31-90天'
  if (d <= 180) return '91-180天'
  return '180天以上'
}

/** 欠费账龄：楼栋 × 账龄。作废不进表；未到期单列一档 */
function _buildArrears(statDate) {
  const m = new Map()
  for (const b of bills) {
    const h = _HOUSE_MAP.get(b.houseId)
    if (!h) continue                                   /* 车位账单没有楼栋，不进本表 */
    if (!_BILL_AS_OF(b, statDate)) continue
    if (b.status === '已作废') continue
    if ((b.unpaid || 0) <= 0) continue
    const aging = agingOf(b.dueDate, statDate)
    const key = `${h.buildingId}|${aging}`
    const cur = m.get(key) || {
      communityId: h.communityId, communityName: communityName(h.communityId),
      buildingId: h.buildingId, buildingName: BUILDING_OF.get(h.buildingId)?.name || h.buildingId,
      aging, billCount: 0, _houses: new Set(), _owners: new Set(),
      payable: 0, unpaid: 0, _overdueSum: 0, _overdueBase: 0, _items: new Map()
    }
    cur.billCount++
    cur._houses.add(h.houseId)
    if (b.ownerId) cur._owners.add(b.ownerId)
    cur.payable = _r2f(cur.payable + (b.payable || 0))
    cur.unpaid = _r2f(cur.unpaid + (b.unpaid || 0))
    if (aging !== '未到期') { cur._overdueSum += daysBetween(b.dueDate, statDate); cur._overdueBase++ }
    cur._items.set(b.itemName, _r2f((cur._items.get(b.itemName) || 0) + (b.unpaid || 0)))
    m.set(key, cur)
  }
  /* 账龄从最老排到最新：催缴先看欠得最久的，未到期放最后（那部分还不是欠费） */
  const order = Object.fromEntries([...AGING_BUCKETS].reverse().map((k, i) => [k, i]))
  return [...m.values()].map(c => {
    const top = [...c._items.entries()].sort((a, b) => b[1] - a[1])[0]
    return {
      communityId: c.communityId, communityName: c.communityName,
      buildingId: c.buildingId, buildingName: c.buildingName, aging: c.aging,
      billCount: c.billCount, houseCount: c._houses.size, ownerCount: c._owners.size,
      payable: c.payable, unpaid: c.unpaid,
      avgOverdueDays: c._overdueBase ? _r1f(c._overdueSum / c._overdueBase) : 0,
      topItem: top ? top[0] : ''
    }
  }).sort((a, b) => (order[a.aging] - order[b.aging]) || (b.unpaid - a.unpaid))
}

/** 收缴率：账期 × 科目。作废与减免不进分母（减免是公司决策，不是业主欠费） */
function _buildCollection(statDate) {
  const m = new Map()
  for (const b of bills) {
    if (!_BILL_AS_OF(b, statDate)) continue
    const key = `${b.communityId}|${b.period}|${b.itemId}`
    const cur = m.get(key) || {
      communityId: b.communityId, communityName: communityName(b.communityId),
      period: b.period, itemId: b.itemId, itemName: b.itemName,
      billCount: 0, payable: 0, paid: 0, unpaid: 0, reduction: 0, voided: 0
    }
    cur.billCount++
    cur.paid = _r2f(cur.paid + (b.paidAmount || 0))
    if (b.status === '已作废') cur.voided = _r2f(cur.voided + (b.payable || 0))
    else if (b.status === '已减免') cur.reduction = _r2f(cur.reduction + Math.max(0, (b.payable || 0) - (b.paidAmount || 0)))
    else {
      cur.payable = _r2f(cur.payable + (b.payable || 0))
      cur.unpaid = _r2f(cur.unpaid + (b.unpaid || 0))
    }
    m.set(key, cur)
  }
  return [...m.values()]
    .map(x => ({ ...x, rate: x.payable > 0 ? _r2f(x.paid / x.payable * 100) : null }))
    .sort((a, b) => String(b.period).localeCompare(String(a.period)) || (b.payable - a.payable))
}

/** 部门达标率：部门 × 周期。只收有执行任务的班子（没有交付数据的不列，否则被误判 0 分） */
function _buildDeptTarget(statDate) {
  const periods = [...new Set(
    inspectTasks.filter(t => String(t.scheduledDate || '') <= statDate)
      .map(t => String(t.scheduledDate).slice(0, 7))
  )].sort().reverse()
  const out = []
  for (const period of periods) {
    for (const d of achievementDeptOpts()) {
      const a = deptAchievement({ orgId: d.id, period })
      if (!a.planned) continue
      const communityId = communityOfOrg(d.id)
      const evaluated = qualityEvalRows({ period }).some(r => r.orgId === d.id && r.evaluated)
      out.push({
        orgId: d.id, deptName: orgNameOf(d.id), post: a.post,
        communityId, communityName: communityName(communityId), period,
        planned: a.planned, finished: a.finished,
        doneRate: _r2f(a.doneRate * 100), itemTotal: a.itemTotal, itemOk: a.itemOk,
        passRate: _r2f(a.passRate * 100),
        weightPass: a.weight.pass, weightDone: a.weight.done,
        weighted: _r2f(a.weighted * 100),
        selfIssues: a.selfIssues, crossIssues: 0,
        score: a.deptScore, grade: gradeOfScore(a.deptScore),
        evaluated
      })
    }
  }
  return out.sort((a, b) => String(b.period).localeCompare(String(a.period)) || (b.weighted - a.weighted))
}

/** 年报：按部门累加再算比率（不能把 12 个月的达标率取平均，任务量不同权重不同） */
function _aggregateDeptYear(rows, year) {
  const m = new Map()
  for (const r of rows) {
    if (!String(r.period).startsWith(year)) continue
    const cur = m.get(r.orgId) || {
      orgId: r.orgId, period: year, communityId: r.communityId, communityName: r.communityName,
      deptName: r.deptName, post: r.post, weightPass: r.weightPass, weightDone: r.weightDone,
      planned: 0, finished: 0, itemTotal: 0, itemOk: 0, selfIssues: 0, crossIssues: 0, evaluated: r.evaluated
    }
    cur.planned += r.planned
    cur.finished += r.finished
    cur.itemTotal += r.itemTotal
    cur.itemOk += r.itemOk
    cur.selfIssues += r.selfIssues
    cur.crossIssues += r.crossIssues
    m.set(r.orgId, cur)
  }
  return [...m.values()].filter(c => c.planned > 0).map(c => {
    const doneRate = c.planned ? c.finished / c.planned : 0
    const passRate = c.itemTotal ? c.itemOk / c.itemTotal : 0
    const weighted = passRate * c.weightPass + doneRate * c.weightDone
    const score = Math.max(0, _r1f(weighted * 100 - c.selfIssues - c.crossIssues * 3))
    return {
      ...c,
      doneRate: _r2f(doneRate * 100),
      passRate: _r2f(passRate * 100),
      weighted: _r2f(weighted * 100),
      score, grade: gradeOfScore(score)
    }
  }).sort((a, b) => b.weighted - a.weighted)
}

const _sumArrears = rows => ({
  billCount: rows.reduce((s, r) => s + r.billCount, 0),
  payable: _r2f(rows.reduce((s, r) => s + r.payable, 0)),
  unpaid: _r2f(rows.reduce((s, r) => s + r.unpaid, 0)),
  overdueUnpaid: _r2f(rows.filter(r => r.aging !== '未到期').reduce((s, r) => s + r.unpaid, 0))
})
const _sumCollection = rows => {
  const payable = _r2f(rows.reduce((s, r) => s + r.payable, 0))
  const paid = _r2f(rows.reduce((s, r) => s + r.paid, 0))
  return {
    payable, paid,
    unpaid: _r2f(rows.reduce((s, r) => s + r.unpaid, 0)),
    reduction: _r2f(rows.reduce((s, r) => s + r.reduction, 0)),
    rate: payable > 0 ? _r2f(paid / payable * 100) : null
  }
}
const _sumDept = rows => ({
  deptCount: rows.length,
  planned: rows.reduce((s, r) => s + r.planned, 0),
  avgWeighted: rows.length ? _r2f(rows.reduce((s, r) => s + r.weighted, 0) / rows.length) : 0,
  selfIssues: rows.reduce((s, r) => s + r.selfIssues, 0),
  crossIssues: rows.reduce((s, r) => s + r.crossIssues, 0),
  unqualified: rows.filter(r => r.grade === '不合格').length
})
const _BUILDERS = {
  arrears: { build: _buildArrears, sum: _sumArrears },
  'collection-rate': { build: _buildCollection, sum: _sumCollection },
  'dept-target': { build: _buildDeptTarget, sum: _sumDept }
}
const _isPoint = code => POINT_REPORTS.includes(code)

/* ---------------- 期次 ---------------- */
const _periodEnd = (periodType, period) =>
  periodType === 'day' ? period : (periodType === 'month' ? _monthEnd(period) : `${period}-12-31`)
const _isClosed = (periodType, period) => {
  /* 月结是**真实状态**，不是常量：月结页提交后，该月报表重算即转正（provisional=false） */
  if (periodType === 'month') return isMonthClosed(period)
  if (periodType === 'year') return period < String(DATA_DATE).slice(0, 4)
  return period < DATA_DATE
}

function reportSpecOf(code, periodType, period) {
  const end = _periodEnd(periodType, period)
  const statDate = periodType === 'day' ? period : (end > DATA_DATE ? DATA_DATE : end)
  return {
    periodType, period, statDate,
    /* 试算只对月/年有意义：日快照本身就是「那天当时」的数 */
    provisional: periodType === 'day' ? false : !_isClosed(periodType, period)
  }
}

/** 按粒度构建行：时点型三种粒度都是「取那一天」，期间型按月/年筛行或聚合 */
function _buildByPeriod(code, spec) {
  const rows = _BUILDERS[code].build(spec.statDate)
  if (spec.periodType === 'day' || _isPoint(code)) return rows
  if (spec.periodType === 'month') return rows.filter(r => r.period === spec.period)
  if (code === 'collection-rate') return rows.filter(r => String(r.period).startsWith(spec.period))
  return _aggregateDeptYear(rows, spec.period)
}

const REPORT_SNAPSHOTS = new Map()      /* batchNo → { meta, rows, summary } */
const REPORT_TASKS = new Map()          /* taskId → { ..., polls } */

function _createReportSnapshot(code, spec, { status = '成功', message = '' } = {}) {
  const { periodType, period, statDate } = spec
  /* 序号按同粒度同期次递增：日 RPT-20261021-01 / 月 RPT-202610-M01 / 年 RPT-2026-Y01 */
  const seq = [...REPORT_SNAPSHOTS.values()]
    .filter(s => s.meta.periodType === periodType && s.meta.period === period).length + 1
  const batchNo = periodType === 'day'
    ? `RPT-${statDate.replace(/-/g, '')}-${_pad2(seq)}`
    : periodType === 'month'
      ? `RPT-${period.replace(/-/g, '')}-M${_pad2(seq)}`
      : `RPT-${period}-Y${_pad2(seq)}`
  const rows = status === '成功' ? _buildByPeriod(code, spec) : []
  const snap = {
    meta: {
      reportCode: code, reportName: REPORT_NAMES[code],
      periodType, period, statDate,
      provisional: spec.provisional,
      batchNo,
      calcAt: `${DATA_DATE} 02:${_pad2(10 + seq * 3)}`,
      dataCutoff: `${statDate} 23:59`,
      durationMs: 900 + seq * 137,
      formulaVersion: REPORT_FORMULA,
      rowCount: rows.length, partial: false, stale: false, status,
      ...(message ? { message } : {})
    },
    rows,
    summary: status === '成功' ? _BUILDERS[code].sum(rows) : {}
  }
  REPORT_SNAPSHOTS.set(batchNo, snap)
  return snap
}

/* 启动即「跑一次夜批」：日 3 天 / 月 3 期（含 1 期试算）/ 年 1 期；另留一条失败批次 */
for (const d of REPORT_STAT_DATES) for (const code of Object.keys(REPORT_NAMES)) _createReportSnapshot(code, reportSpecOf(code, 'day', d))
for (const ym of REPORT_PERIOD_MONTHS) for (const code of Object.keys(REPORT_NAMES)) _createReportSnapshot(code, reportSpecOf(code, 'month', ym))
for (const y of REPORT_PERIOD_YEARS) for (const code of Object.keys(REPORT_NAMES)) _createReportSnapshot(code, reportSpecOf(code, 'year', y))
_createReportSnapshot('dept-target', reportSpecOf('dept-target', 'day', '2026-10-20'),
  { status: '失败', message: '源数据缺失：P03 巡检明细为空，本批次作废' })

const _snapSort = (a, b) =>
  String(b.meta.statDate).localeCompare(String(a.meta.statDate)) || String(b.meta.batchNo).localeCompare(String(a.meta.batchNo))
/* 列表接口已经把 meta 摊平成行，排序键也摊平——别拿两套结构共用一个比较器（踩过：整页白） */
const _snapSortFlat = (a, b) =>
  String(b.statDate).localeCompare(String(a.statDate)) || String(b.batchNo).localeCompare(String(a.batchNo))
/* 全部成功批次（含被反结作废的）：作废不删除，审计要能查到「当时出过什么数」 */
const _allSnaps = (code, periodType = 'day') => [...REPORT_SNAPSHOTS.values()]
  .filter(s => s.meta.status === '成功' && (!code || s.meta.reportCode === code)
    && s.meta.periodType === periodType).sort(_snapSort)
/* 「成功批次」= 排除已作废：latest 与环比取数都走这里，否则反结后还会拿到作废批次 */
const _successSnaps = (code, periodType = 'day') => _allSnaps(code, periodType).filter(s => !s.meta.voided)

/**
 * 「最新批次」取**包含作废**的那一条：
 * 反结后该期次只剩作废批次，但那个期间仍然是最新期次——用户切到月报就该看到 10 月
 * 并标着「已作废」，而不是莫名其妙跳回 9 月（那会让人以为数据丢了）。
 */
export const latestSnapshot = (code, periodType = 'day') => _allSnaps(code, periodType)[0] || null
const _findSnapshot = (code, periodType, period) => {
  const hit = _allSnaps(code, periodType).filter(s => s.meta.period === period)
  /* 反结后该期次只剩作废批次：仍可读（历史要能翻），但 meta.voided=true 让页面标「已作废」 */
  return hit.find(s => !s.meta.voided) || hit[0] || null
}

/** 环比 / 同比：只给期间型（余额的「环比」是另一个概念） */
function _compareOf(code, spec) {
  if (_isPoint(code) || spec.periodType === 'day') return null
  const back = (periodType, period) => {
    const s = _findSnapshot(code, periodType, period)
    if (!s) return null
    return { period, value: code === 'collection-rate' ? s.summary.rate : s.summary.avgWeighted }
  }
  const [y, m] = spec.periodType === 'month' ? spec.period.split('-') : [spec.period, '']
  /* m 是 1 基月份，上个月的月索引是 m-2（写成 m-1 会算回本月） */
  const prev = spec.periodType === 'month'
    ? back('month', new Date(Date.UTC(+y, +m - 2, 1)).toISOString().slice(0, 7))
    : back('year', String(Number(y) - 1))
  const yoy = spec.periodType === 'month' ? back('month', `${Number(y) - 1}-${m}`) : null
  return {
    prevPeriod: prev?.period || '', prevValue: prev ? prev.value : null,
    yoyPeriod: yoy?.period || '', yoyValue: yoy ? yoy.value : null
  }
}

/** meta 附带 stale / compare，并把粒度翻成中文（内部用 day/month/year） */
/** 主指标：环比/同比比的是这一个数（收缴率 / 平均达标率 / 欠费余额） */
/* 失败批次没有 summary：主指标给 null 而不是 0——0 会被读成"这一期收缴率为 0" */
const _mainMetric = (code, summary = {}) => {
  const v = code === 'collection-rate' ? summary.rate : (code === 'dept-target' ? summary.avgWeighted : summary.unpaid)
  return v === undefined ? null : v
}

const _metaOut = snap => {
  const raw = snap.meta.periodType
  const latest = latestSnapshot(snap.meta.reportCode, raw)
  const behind = latest ? daysBetween(snap.meta.statDate, latest.meta.statDate) : 0
  const cmp = _compareOf(snap.meta.reportCode, { periodType: raw, period: snap.meta.period })
  return {
    ...snap.meta,
    periodType: periodLabelOf(raw),
    /* provisional **实时**按「该期是否已月结」算，用建批次时存的值会错：
       反结后旧批次仍是那份冻结的数，但它已经不是定稿了——状态属于期间，不属于批次 */
    provisional: raw === 'day' ? false : !isMonthClosed(snap.meta.period),
    periodValue: _mainMetric(snap.meta.reportCode, snap.summary),
    stale: behind > 1,
    ...(cmp ? { compare: cmp } : {})
  }
}

/** 统计批次列表（页头下拉与「选历史」用）；latest 供缺省选择 */
export function reportSnapshotList(code = '', periodType = 'day') {
  const rows = [...REPORT_SNAPSHOTS.values()]
    .filter(s => (!code || s.meta.reportCode === code) && s.meta.periodType === periodType)
    .map(s => ({ ..._metaOut(s), message: s.meta.message || '' }))
    .sort(_snapSortFlat)
  const latest = latestSnapshot(code, periodType)
  return { rows, latest: latest ? _metaOut(latest) : null }
}

/** 取批次：期次没有成功批次 → 抛 40402（不能静默回空表） */
export function snapshotOf(code, periodType = 'day', period = '') {
  const hit = period ? _findSnapshot(code, periodType, period) : latestSnapshot(code, periodType)
  if (!hit) {
    const e = new Error(`「${REPORT_NAMES[code] || code}」该期次没有成功批次，请先重算`)
    e.code = 40402
    throw e
  }
  return hit
}

/** 批次是全局算的，越权在读取时按行裁剪（与契约一致） */
const _housesOfBuilding = new Map()
const _housesOfCommunity = new Map()
function _scopeReportRows(rows) {
  return scopeFilter(rows, {
    house: r => {
      if (r.buildingId) {
        if (!_housesOfBuilding.has(r.buildingId)) {
          _housesOfBuilding.set(r.buildingId, new Set(houses.filter(h => h.buildingId === r.buildingId).map(h => h.houseId)))
        }
        return _housesOfBuilding.get(r.buildingId)
      }
      if (!_housesOfCommunity.has(r.communityId)) {
        _housesOfCommunity.set(r.communityId, new Set(houses.filter(h => h.communityId === r.communityId).map(h => h.houseId)))
      }
      return _housesOfCommunity.get(r.communityId)
    }
  })
}

function _rowsOf(code, periodType, period, filters = {}) {
  const snap = snapshotOf(code, periodType, period)
  let rows = _scopeReportRows(snap.rows)
  if (code === 'arrears') {
    rows = rows
      .filter(r => eq(r, filters.communityId, 'communityId'))
      .filter(r => eq(r, filters.buildingId, 'buildingId'))
      .filter(r => eq(r, filters.aging, 'aging'))
      .filter(r => kwHit(r, filters.kw, ['buildingName']))
  } else if (code === 'collection-rate') {
    rows = rows
      .filter(r => eq(r, filters.communityId, 'communityId'))
      .filter(r => eq(r, filters.billPeriod, 'period'))
      .filter(r => eq(r, filters.itemId, 'itemId'))
  } else {
    rows = rows
      .filter(r => eq(r, filters.communityId, 'communityId'))
      .filter(r => eq(r, filters.billPeriod, 'period'))
      .filter(r => eq(r, filters.post, 'post'))
  }
  return rows
}

/**
 * 三类统计报表的统一取数。
 * 返回 `{ rows, total, pageNo, size, meta, summary }`——**与契约响应同形**，
 * http 模式接上后页面不用改（摘要也由接口带回来，不靠页面自己再算一遍）。
 */
export function queryReportRows(code, { pageNo = 1, size = 50, filters = {} } = {}) {
  return delayReport(() => {
    const periodType = filters.periodType || 'day'
    const snap = snapshotOf(code, periodType, filters.period)
    const rows = _rowsOf(code, periodType, filters.period, filters)
    return {
      ...paged(rows, pageNo, size), pageNo, size,
      meta: _metaOut(snap),
      summary: _BUILDERS[code].sum(rows)
    }
  })
}

/** 合计行：口径与列表同源（按当前批次 + 当前筛选重算），不是另算一份 */
export function reportRowsSummary(code, filters = {}) {
  return _BUILDERS[code].sum(_rowsOf(code, filters.periodType || 'day', filters.period, filters))
}

/**
 * 合计行 → 报表配置的通用字段位（count / payable / paid / unpaid / deduct）。
 * **纯函数**：只吃 `summary` 与行数，不碰数据源——因为 http 模式下
 * summary 是接口带回来的，映射逻辑必须两边共用同一份（否则又一次口径分叉）。
 */
export function mapReportSummary(code, summary = {}, rowCount = 0) {
  const s = summary || {}
  if (code === 'arrears') {
    return { count: s.billCount || 0, payable: s.payable || 0, paid: s.overdueUnpaid || 0, unpaid: s.unpaid || 0 }
  }
  if (code === 'collection-rate') {
    return { count: rowCount, payable: s.payable || 0, paid: s.paid || 0, unpaid: s.unpaid || 0, deduct: s.reduction || 0 }
  }
  return {
    count: s.deptCount || 0, payable: s.planned || 0, paid: s.avgWeighted || 0,
    unpaid: s.selfIssues || 0, deduct: s.crossIssues || 0
  }
}

/** 本地模式便捷版：自己取数再映射（页面已在用响应里的 summary，这个留给调试/导出） */
export function reportSummaryMapped(code, filters = {}) {
  const rows = _rowsOf(code, filters.periodType || 'day', filters.period, filters)
  return mapReportSummary(code, _BUILDERS[code].sum(rows), rows.length)
}

/** 触发重算：异步任务，两次轮询后完成并产出新批次 */
export function recalcReport({ code, periodType = 'day', period, note = '' } = {}) {
  return delayReport(() => {
    if (!REPORT_NAMES[code]) throw new Error(`报表代码非法：${code}`)
    const p = period
    if (!p) throw new Error('期次必填')
    if (periodType === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(String(p))) throw new Error('按日重算的期次格式应为 YYYY-MM-DD')
    if (periodType === 'month' && !/^\d{4}-\d{2}$/.test(String(p))) throw new Error('按月重算的期次格式应为 YYYY-MM')
    if (periodType === 'year' && !/^\d{4}$/.test(String(p))) throw new Error('按年重算的期次格式应为 YYYY')
    const running = [...REPORT_TASKS.values()].find(t =>
      t.reportCode === code && t.periodType === periodType && t.period === p && t.status === '运行中')
    /* 幂等：同参数已有运行中的任务就不新建，避免重复点按钮跑出两个批次 */
    if (running) return { ...running, reused: true }
    const seq = REPORT_TASKS.size + 1
    const spec = reportSpecOf(code, periodType, p)
    const task = {
      taskId: `RCL-${DATA_DATE.replace(/-/g, '')}-${_pad2(seq)}`,
      reportCode: code, periodType, period: p, statDate: spec.statDate,
      status: '运行中', progress: 0,
      startedAt: `${DATA_DATE} 09:${_pad2(10 + seq)}`,
      finishedAt: '', batchNo: '', rowCount: 0, message: note, polls: 0, reused: false
    }
    REPORT_TASKS.set(task.taskId, task)
    return { ...task }
  })
}

/** 轮询任务：第 2 次查询完成（模拟跑批耗时，不阻塞页面） */
export function reportRecalcTask(taskId) {
  return delayReport(() => {
    const t = REPORT_TASKS.get(taskId)
    if (!t) {
      const e = new Error('重算任务不存在')
      e.code = 404
      throw e
    }
    if (t.status === '运行中') {
      t.polls++
      if (t.polls < 2) t.progress = 60
      else {
        const snap = _createReportSnapshot(t.reportCode, reportSpecOf(t.reportCode, t.periodType, t.period), { message: t.message })
        Object.assign(t, {
          status: '成功', progress: 100, batchNo: snap.meta.batchNo,
          rowCount: snap.meta.rowCount, finishedAt: `${DATA_DATE} 09:2${t.polls}`
        })
      }
    }
    return { ...t }
  })
}

/* ================= 收费月结（2026-10-30） =================
 * 报表的 `provisional` 到底真不真，就看这一段：
 *   - 已月结的自然月，该月报表重算后 `provisional=false`，数字冻结；
 *   - 未月结的月份照样能出数，但一直挂着「试算」。
 * 口径（与日结一脉相承，但月结结的是**账面**不是现金）：
 *   ① 一个自然月只能结一次，结完锁定；
 *   ② 月结看四组数：收款 / 退款 / 净额、应收 / 已收 / 欠费；
 *   ③ 有未开票或欠费时，说明必填（不能只点确认）；
 *   ④ 结完立刻给该月重新跑一遍报表，生成 `provisional=false` 的新批次，旧批次保留可查。
 */

/**
 * 月结的两个权限位。
 * - 结账：`b.monthClose.edit`（财务口径的角色才有）
 * - 反结：`e.monthReopen.edit`（**刻意在 e 域**：财务对 b 域是通配，反结不该被"管收费"自动授予）
 *
 * 页面按钮与"服务端"读的是同一份判断——只在前端隐藏按钮而接口不校验，
 * 等于把权限做成了 UI 装饰（改个请求就绕过去了）。
 */
export const MONTH_CLOSE_PERM = 'b.monthClose.edit'
export const MONTH_REOPEN_PERM = 'e.monthReopen.edit'
const _hasPerm = code => permCodesOfRole(currentRoleId.value).has(code)
export const canMonthClose = () => _hasPerm(MONTH_CLOSE_PERM)
export const canMonthReopen = () => _hasPerm(MONTH_REOPEN_PERM)

/** 服务端式校验：无权限直接 403/40301，不做"静默成功" */
function assertPerm(code, msg) {
  if (_hasPerm(code)) return
  const e = new Error(msg || '没有该操作的权限')
  e.code = 40301
  throw e
}

const _monthOf = v => String(v || '').slice(0, 7)

/** 某月按收款方式汇总（与日结同一套口径，只是范围从一天变成一个月）；传 communityId 就只看这个项目 */
export function monthCloseRows(period = '2026-10', communityId = '') {
  const inScope = x => !communityId || x.communityId === communityId
  const pays = PAY_ROWS.filter(p => _monthOf(p.payTime) === period && inScope(p))
  const refs = REFUND_ROWS.filter(r => _monthOf(r.at) === period && inScope(r))
  const methods = [...new Set([...pays.map(p => p.method), ...refs.map(r => r.method)])].sort()
  return methods.map(m => {
    const inRows = pays.filter(p => p.method === m)
    const outRows = refs.filter(r => r.method === m)
    const income = _r2(inRows.reduce((s, p) => s + (p.amount || 0), 0))
    const refund = _r2(outRows.reduce((s, r) => s + r.amount, 0))
    return {
      method: m, count: inRows.length, amount: income,
      refundCount: outRows.length, refund, net: _r2(income - refund),
      mode: m === '现金' ? '实点' : '对流水'
    }
  })
}

/** 该项目当期有没有业务（有账单）。没业务的项目不参与全公司结账的前置校验 */
const _hasBiz = (period, communityId) =>
  BILL_ROWS.some(b => b.period === period && b.communityId === communityId && isEffectiveBill(b))

/** 月结预览：账面收支 + 未核销事项 + 是否已结（未提交前只是预览） */
export function monthClosePreview(period = '2026-10', communityId = '') {
  const p = _monthOf(period) || period
  const rows = monthCloseRows(p, communityId)
  const monthBills = BILL_ROWS.filter(b => b.period === p && isEffectiveBill(b)
    && (!communityId || b.communityId === communityId))
  const income = _r2(rows.reduce((s, r) => s + r.amount, 0))
  const refund = _r2(rows.reduce((s, r) => s + r.refund, 0))
  const receivable = _r2(monthBills.reduce((s, b) => s + (b.payable || 0), 0))
  const received = _r2(monthBills.reduce((s, b) => s + (b.paidAmount || 0), 0))
  const debt = _r2(monthBills.reduce((s, b) => s + (b.unpaid || 0), 0))
  const pays = PAY_ROWS.filter(x => _monthOf(x.payTime) === p && (!communityId || x.communityId === communityId))
  const closed = _activeClose(p, communityId)
  const prevPeriod = (() => {
    const [y, m] = p.split('-')
    return new Date(Date.UTC(+y, +m - 2, 1)).toISOString().slice(0, 7)
  })()
  const prev = _activeClose(prevPeriod, communityId)
  /* 全公司结账的硬前置：**有业务的项目**都必须先结。
     汇总前明细不清，等于用总数掩盖某个项目的问题；但当期一笔账都没有的项目不参与，
     否则空项目永远结不掉，全公司就永远结不了。 */
  const unclosedCommunities = communityId ? [] : communities
    .filter(c => !_activeClose(p, c.communityId) && _hasBiz(p, c.communityId))
    .map(c => ({ communityId: c.communityId, name: c.name }))
  return {
    period: p,
    scope: communityId ? 'community' : 'group',
    communityId,
    communityName: communityId ? communityName(communityId) : '',
    unclosedCommunities,
    rows,
    count: rows.reduce((s, r) => s + r.count, 0),
    income, refund, net: _r2(income - refund),
    receivable, received, debt,
    /* 未核销事项：结账前必须让人看见，不能糊过去 */
    uninvoiced: pays.filter(x => x.invoiceStatus === '未开票').length,
    debtBills: monthBills.filter(b => (b.unpaid || 0) > 0).length,
    prevPeriod, prevNet: prev ? prev.net : null,
    closed,
    /** 是否可结：未来月份不能结；已结不能重复结（项目级还要看全公司有没有先结） */
    closable: p <= _monthOf(DATA_DATE) && !closed
  }
}

/**
 * 提交月结。支持按项目分别结账（`communityId`），不传就是全公司结账。
 * 校验顺序刻意按「能不能结 → 明细清没清 → 有没有数 → 说明够不够」来，报错信息直接说缺什么。
 */
export function submitMonthClose({ period = '2026-10', memo = '', operator = '财务·雷志强', communityId = '' } = {}) {
  assertPerm(MONTH_CLOSE_PERM, '月结需要「收费月结」操作权限（b.monthClose.edit）——封账是财务动作')
  const cid = String(communityId || '')
  const pre = monthClosePreview(period, cid)
  if (cid && !communities.some(c => c.communityId === cid)) {
    const e = new Error('项目不存在')
    e.code = 404
    throw e
  }
  if (pre.period > _monthOf(DATA_DATE)) throw new Error(`${pre.period} 还没到，不能提前月结`)
  if (pre.closed) {
    throw new Error(pre.closed.scope === 'community'
      ? `${pre.period} ${pre.communityName} 已月结（${pre.closed.closeNo}），不能重复提交`
      : `${pre.period} 已全公司月结（${pre.closed.closeNo}），不能重复提交`)
  }
  /* 全公司结账的前置：有业务的项目必须先结。汇总前明细不清，等于用总数掩盖某个项目的问题 */
  if (!cid && pre.unclosedCommunities.length) {
    throw new Error(
      `还有 ${pre.unclosedCommunities.length} 个项目未结（${pre.unclosedCommunities.map(c => c.name).join('、')}），` +
      '全公司结账前必须先结清各项目'
    )
  }
  if (!pre.count && !pre.receivable) throw new Error('该月没有收款也没有应收，无需月结')
  const risk = pre.uninvoiced + pre.debtBills
  if (risk > 0 && String(memo).trim().length < 4) {
    throw new Error(`还有 ${pre.uninvoiced} 笔未开票、${pre.debtBills} 笔欠费，请写明处理说明（至少 4 个字）`)
  }
  /* 单号按该期间、该范围的记录数递增：反结后重结是 -02，不覆盖 -01（-01 必须能查） */
  const seq = MONTH_CLOSES.filter(c => c.period === pre.period && (c.communityId || '') === cid).length + 1
  const rec = {
    closeId: 'MC' + pre.period.replace('-', '') + (cid ? '-' + cid : '') + (seq > 1 ? `-${seq}` : ''),
    closeNo: `YJ-${pre.period.replace('-', '')}${cid ? '-' + cid : ''}-${String(seq).padStart(2, '0')}`,
    period: pre.period, status: '已结账',
    scope: cid ? 'community' : 'group',
    communityId: cid, communityName: pre.communityName,
    count: pre.count, income: pre.income, refund: pre.refund, net: pre.net,
    receivable: pre.receivable, received: pre.received, debt: pre.debt,
    uninvoiced: pre.uninvoiced, debtBills: pre.debtBills,
    memo: String(memo).trim(), operator, at: _now(), locked: true,
    reopenedAt: '', reopenReason: '', reopenCount: 0, reversalNo: ''
  }
  MONTH_CLOSES.unshift(rec)
  /* 只有**全公司**结账才重跑报表：报表是全公司口径，单个项目结完就宣布定稿是错的 */
  if (!cid) {
    for (const code of Object.keys(REPORT_NAMES)) {
      _createReportSnapshot(code, reportSpecOf(code, 'month', pre.period), { message: `月结 ${rec.closeNo} 后重算` })
    }
  }
  track('month_close', { period: rec.period, communityId: cid, net: rec.net, debt: rec.debt })
  return rec
}

/**
 * 反结（红冲月结）。
 * 做四件事：记录置「已反结」→ 作废该期报表批次 → 期间恢复可写 → 报表回到试算。
 * **记录不删除**：审计要能查到「谁在什么时候、为什么推翻了一次已封账的结果」。
 * 反结不塞进退款流水（反结不是退款，混进去会让退款统计失真），它有自己的红冲凭证号。
 */
export function reopenMonthClose({ closeId, reason = '', operator = '财务·雷志强' } = {}) {
  assertPerm(MONTH_REOPEN_PERM, '反结需要「月结反结」权限（e.monthReopen.edit），通常只给财务主管')
  const rec = MONTH_CLOSES.find(c => c.closeId === closeId)
  if (!rec) {
    const e = new Error('月结记录不存在')
    e.code = 404
    throw e
  }
  if (rec.status === '已反结') {
    const e = new Error(`${rec.period} 已于 ${rec.reopenedAt} 反结，不能重复反结`)
    e.code = 40905
    throw e
  }
  const r = String(reason).trim()
  if (r.length < 10) {
    const e = new Error('反结原因至少 10 个字：要让别人看懂为什么推翻一次已封账的结果')
    e.code = 42201
    throw e
  }
  rec.status = '已反结'
  rec.reopenedAt = _now()
  rec.reopenReason = r
  rec.reopenCount = (rec.reopenCount || 0) + 1
  rec.reversalNo = `HC-${rec.period.replace('-', '')}${rec.communityId ? '-' + rec.communityId : ''}-${String(rec.reopenCount).padStart(2, '0')}`
  rec.locked = false
  rec.operator = rec.operator || operator
  /* 全公司反结要**级联反结**该期间的项目级结账：只解汇总锁的话，项目明细还锁着，
     反结之后依然补录不了，等于白反 */
  if (!rec.communityId) {
    for (const c of MONTH_CLOSES) {
      if (c.period === rec.period && c.communityId && c.status === '已结账') {
        c.status = '已反结'
        c.reopenedAt = rec.reopenedAt
        c.reopenReason = `随全公司反结级联（${rec.reversalNo}）`
        c.reopenCount = (c.reopenCount || 0) + 1
        c.reversalNo = rec.reversalNo
        c.locked = false
      }
    }
  }
  /* 只有全公司反结才作废报表批次：项目级结账本来就没生成报表 */
  if (!rec.communityId) {
    for (const snap of REPORT_SNAPSHOTS.values()) {
      if (snap.meta.periodType === 'month' && snap.meta.period === rec.period) snap.meta.voided = true
    }
  }
  track('month_reopen', { period: rec.period, communityId: rec.communityId || '', reopenCount: rec.reopenCount })
  return { ...rec }
}

/** 月结记录：按年份 / 状态 / 范围（group 全公司、community 项目）筛 */
export const monthCloseHistory = ({ year = '', status = '', scope = '', communityId = '' } = {}) =>
  [...MONTH_CLOSES]
    .filter(c => !year || String(c.period).startsWith(year))
    .filter(c => !status || c.status === status)
    .filter(c => !scope || (c.scope || 'group') === scope)
    .filter(c => !communityId || c.communityId === communityId)
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))
/** 月结期次可选项：近 6 个月（含当月），倒序；「已结」按当前范围判断 */
export const monthClosePeriodOpts = (communityId = '') => {
  const [y, m] = _monthOf(DATA_DATE).split('-').map(Number)
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    const p = d.toISOString().slice(0, 7)
    return { value: p, label: p + (_activeClose(p, communityId) ? '（已结）' : '（待结）') }
  })
}

/* 预置 8 / 9 月已结。
 * **必须放在文件末尾**：预置要用 monthClosePreview 算真实数字（手写的样例与明细对不上，
 * 而且确实是 bug），而 preview 依赖账单/流水/退款几张大表——放在前面会撞 TDZ
 * （浏览器直接白屏，报 "Cannot access 'x0' before initialization"）。
 */
function _seedMonthClose(period, memo, at) {
  const pre = monthClosePreview(period)
  MONTH_CLOSES.push({
    closeId: 'MC' + period.replace('-', ''),
    closeNo: `YJ-${period.replace('-', '')}-01`,
    period, status: '已结账',
    scope: 'group', communityId: '', communityName: '',
    count: pre.count, income: pre.income, refund: pre.refund, net: pre.net,
    receivable: pre.receivable, received: pre.received, debt: pre.debt,
    uninvoiced: pre.uninvoiced, debtBills: pre.debtBills,
    memo, operator: '财务·雷志强', at, locked: true,
    reopenedAt: '', reopenReason: '', reopenCount: 0, reversalNo: ''
  })
}
_seedMonthClose('2026-08', '正常结账', '2026-09-01 10:12')
_seedMonthClose('2026-09', '9 月欠费已转 10 月催缴', '2026-10-01 10:05')
MONTH_CLOSES.sort((a, b) => String(b.period).localeCompare(String(a.period)))

/* ================= 权限变更日志（2026-10-30） =================
 * 为什么要单独一张日志，而不是塞进 operationLogs：
 *   operationLogs 记的是"谁做了什么动作"（发布公告 / 提交品质检查），粒度到"改了权限"就没了。
 *   审计真正要问的是——**谁在什么时候，给哪个角色，加了哪一个权限**。
 *   只记「保存了一次角色权限」等于没留痕：查不到到底动了哪一位。
 *
 * 三条纪律：
 *   ① 必须记 diff（added / removed），不能只记「保存」；
 *   ② 只增不删：没有任何删除入口，管理员也没有；
 *   ③ **无变化不记**：点开看一眼再保存不算治理事件，记了只是噪音，会把真事件淹掉。
 */

export const PERM_CHANGES = []

/** 权限码 → 中文（"b.monthClose.edit" → "收费月结 · 操作"），日志里给人看 */
export function permLabelOf(code) {
  const p = permissions.find(x => x.code === code)
  if (!p) return code
  return `${p.funcName} · ${p.opName}`
}

/**
 * 记一条权限变更。
 * @returns 新增的记录；**没有变化时返回 null**（调用方据此提示"未改动"）
 */
export function logPermChange({ roleId, roleName, before = [], after = [], reason = '', operator = '' } = {}) {
  const b = new Set(before)
  const a = new Set(after)
  const added = [...a].filter(c => !b.has(c)).sort()
  const removed = [...b].filter(c => !a.has(c)).sort()
  if (!added.length && !removed.length) return null
  const seq = PERM_CHANGES.length + 1
  const rec = {
    /* 与预置的 PC00100x 同段，避免新记录和预置撞号或格式不一致 */
    changeId: 'PC001' + String(seq).padStart(3, '0'),
    roleId, roleName: roleName || roleId,
    added, removed,
    addedCount: added.length, removedCount: removed.length,
    reason: String(reason || '').trim(),
    operator: operator || currentRoleName.value,
    at: _now(),
    /* 原型里的"来源 IP"给个固定内网段，真实系统从请求头取 */
    ip: '10.0.2.' + (20 + (seq % 60)),
    beforeCount: before.length, afterCount: after.length
  }
  PERM_CHANGES.unshift(rec)
  track('perm_change', { roleId, added: added.length, removed: removed.length })
  return rec
}

/** 变更记录（时间倒序）；筛选：角色 / 操作人 / 关键字 */
export function permChangeRows({ roleId = '', operator = '', kw = '' } = {}) {
  return PERM_CHANGES
    .filter(r => !roleId || r.roleId === roleId)
    .filter(r => !operator || r.operator === operator)
    .filter(r => !kw || [r.roleName, r.reason, r.operator, ...r.added, ...r.removed]
      .join(' ').toLowerCase().includes(String(kw).toLowerCase()))
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

export function permChangeStats(filters = {}) {
  const rows = permChangeRows(filters)
  return {
    changes: rows.length,
    roles: new Set(rows.map(r => r.roleId)).size,
    granted: rows.reduce((s, r) => s + r.addedCount, 0),
    revoked: rows.reduce((s, r) => s + r.removedCount, 0),
    operators: new Set(rows.map(r => r.operator)).size,
    lastAt: rows[0]?.at || ''
  }
}

export const permChangeRoleOpts = () =>
  [...new Set(PERM_CHANGES.map(r => r.roleId))]
    .map(id => ({ value: id, label: (roles.find(x => x.roleId === id) || {}).name || id }))
export const permChangeOperatorOpts = () => [...new Set(PERM_CHANGES.map(r => r.operator))].sort()

/* 预置历史：三类典型动作各留一条，页面一进来就有东西看，
   也让「加了什么 / 收回了什么」这个格式有样例可循（不预置的话首屏是空表，看不出设计意图） */
PERM_CHANGES.push(
  {
    changeId: 'PC001005', roleId: 'R-FIN', roleName: '财务专员',
    added: ['b.monthClose.view', 'b.monthClose.edit'], removed: [],
    addedCount: 2, removedCount: 0, beforeCount: 15, afterCount: 17,
    reason: '上线收费月结，财务需要封账能力',
    operator: '总经理·周正', at: '2026-10-21 09:12', ip: '10.0.2.31'
  },
  {
    changeId: 'PC001004', roleId: 'R-STW', roleName: '楼栋管家',
    added: [], removed: ['a.sensitive.view'],
    addedCount: 0, removedCount: 1, beforeCount: 16, afterCount: 15,
    reason: '楼管家只看范围内的联系方式，证件号不该给',
    operator: '人事·周敏', at: '2026-10-20 16:40', ip: '10.0.9.7'
  },
  {
    changeId: 'PC001003', roleId: 'R-QS', roleName: '品质督导',
    added: ['f.supFinding.view', 'f.rectify.view', 'f.rectify.edit'], removed: [],
    addedCount: 3, removedCount: 0, beforeCount: 19, afterCount: 22,
    reason: '整改闭环上线，督导要能开单与复核',
    operator: '总经理·周正', at: '2026-10-19 11:05', ip: '10.0.2.31'
  },
  {
    changeId: 'PC001002', roleId: 'R-CHG', roleName: '收银员',
    added: ['b.dailyClose.view', 'b.dailyClose.edit'], removed: [],
    addedCount: 2, removedCount: 0, beforeCount: 13, afterCount: 15,
    reason: '收银员自己日结，现金实点差异自己说明',
    operator: '财务主管·雷志强', at: '2026-10-18 15:22', ip: '10.0.2.44'
  },
  {
    changeId: 'PC001001', roleId: 'R-CS', roleName: '客服专员',
    added: [], removed: ['a.owners.edit'],
    addedCount: 0, removedCount: 1, beforeCount: 15, afterCount: 14,
    reason: '业主档案改动必须留痕，客服只保留查看',
    operator: '总经理·周正', at: '2026-10-17 10:08', ip: '10.0.2.31'
  }
)

/* ================= 高敏权限变更：先批后生效（2026-10-30） =================
 * 为什么不把所有权限变更都送审：普通权限（看报表、执行巡检）每天要调十几次，
 * 全要审批的结果是审批人闭眼点"通过"——审批变成橡皮章，真正该看的反而没人看。
 * 所以只拦三类：**能看敏感明文、能推翻封账、能改权限或工资本身**。
 *
 * 双人原则（four-eyes）：**提交人不能审批自己提交的申请**。
 * 原型里审批权给总经理与财务主管两个角色，所以：
 *   人事提交 → 总经理或财务主管都能批；总经理提交 → 只能财务主管批；财务主管提交 → 只能总经理批。
 * 一个人的系统里这条规则看着碍事，但它正是「不能给自己提权」的唯一技术保障。
 */

export const PERM_APPROVE_PERM = 'e.permApprove.edit'
export const canApprovePerm = () => permCodesOfRole(currentRoleId.value).has(PERM_APPROVE_PERM)

/**
 * 需要审批的权限（白名单式，宁可少拦不要错拦）：
 * 判断标准只有一个——「拿到它，能不能看到或改到本不该看/改的东西」。
 */
export const SENSITIVE_PERM_RULES = [
  { code: 'a.sensitive.view', why: '能看业主 / 租户的证件号与银行账号明文' },
  { code: 'e.monthReopen.edit', why: '能推翻已封账的月结结果' },
  { code: 'e.org.edit', why: '能改角色权限本身——等于能给自己加任何权限' },
  { code: 'c.payroll.edit', why: '能改工资表' },
  { code: 'a.stewards.edit', why: '能改楼栋责任范围——等于能自己扩大可见范围' }
]

export const riskOfPermCodes = (codes = []) =>
  codes.map(c => SENSITIVE_PERM_RULES.find(r => r.code === c)).filter(Boolean)

/** 审批超时阈值：挂过一天没人处理就该跳出来——审批不是"有空再看"，它挡着别人干活 */
export const PERM_OVERDUE_HOURS = 24

/** 距提交过了多少小时（用 _now() 当"现在"，与样例数据同一时间轴） */
function _permAgeOf(r) {
  const t = Date.parse(String(r.submitAt).replace(' ', 'T') + ':00')
  const now = Date.parse(String(_now()).replace(' ', 'T') + ':00')
  if (Number.isNaN(t) || Number.isNaN(now)) return { ageHours: 0, overdue: false }
  const ageHours = Math.max(0, Math.floor((now - t) / 3600000))
  return { ageHours, overdue: r.status === '待审批' && ageHours >= PERM_OVERDUE_HOURS }
}

/* 预置一条已经挂了几天的申请：没有它，「超时提醒」永远没有可演示的对象 */
export const PERM_REQUESTS = [
  {
    reqId: 'REQ0000', roleId: 'R-CHG', roleName: '收银员',
    before: [], after: [],
    added: ['e.monthReopen.edit'], removed: [],
    addedCount: 1, removedCount: 0,
    risks: [{ code: 'e.monthReopen.edit', why: '能推翻已封账的月结结果' }],
    reason: '收银员需要处理反结后的补录',
    submitBy: '顾悦', submitRoleId: 'R-FINM', submitAt: '2026-10-28 09:00',
    status: '待审批', approver: '', approvedAt: '', approveNote: '', changeId: ''
  }
]
export const PERM_REQUEST_STATUS = ['待审批', '已通过', '已驳回', '已撤回']

const _diffOf = (before, after) => {
  const b = new Set(before)
  const a = new Set(after)
  return {
    added: [...a].filter(c => !b.has(c)).sort(),
    removed: [...b].filter(c => !a.has(c)).sort()
  }
}

/**
 * 提交高敏变更申请。
 * @returns 申请记录；**没有变化**或**不含"新增"高敏项**时返回 null（调用方走"直接生效"）
 *
 * **只看 added，不看 removed**：提权要审批，**降权即时生效**。
 * 发现谁多了不该有的权限时，第一反应是立刻收回——卡在审批队列里等一天，
 * 等于让漏洞多开一天。收紧方向不需要拦，只需要留痕。
 */
export function submitPermRequest({ roleId, roleName, before = [], after = [], reason = '' } = {}) {
  const { added, removed } = _diffOf(before, after)
  if (!added.length && !removed.length) return null
  const risks = riskOfPermCodes(added)
  if (!risks.length) return null
  const seq = PERM_REQUESTS.length + 1
  const rec = {
    reqId: 'REQ' + String(seq).padStart(4, '0'),
    roleId, roleName: roleName || roleId,
    before: [...before], after: [...after],
    added, removed, addedCount: added.length, removedCount: removed.length,
    risks,
    reason: String(reason || '').trim(),
    submitBy: currentRoleName.value, submitRoleId: currentRoleId.value, submitAt: _now(),
    status: '待审批', approver: '', approvedAt: '', approveNote: '', changeId: ''
  }
  PERM_REQUESTS.unshift(rec)
  track('perm_request', { roleId, risks: risks.length })
  return rec
}

/**
 * 保存权限矩阵（契约 `PUT /roles/{roleId}/perms`）：**服务端算 diff**，三条分支。
 * 页面不要自己算 added / removed——两个人同时改一个角色时，
 * 第二个人会把第一个人的改动覆盖掉，而且还看不出来。
 */
export function saveRolePermsFlow({ roleId = '', perms = [], reason = '' } = {}) {
  const role = ROLE_OF.get(roleId)
  if (!role) throw new Error('角色不存在')
  const before = [...permCodesOfRole(roleId)]
  const after = [...new Set(perms)]
  const added = after.filter(c => !before.includes(c)).sort()
  const removed = before.filter(c => !after.includes(c)).sort()
  /* 原样保存不写日志：日志里全是"改过权限"的噪声，真出事时翻不到那一条 */
  if (!added.length && !removed.length) {
    return { roleId, applied: true, noChange: true, diff: { added, removed }, log: null, request: null, effectiveAt: '' }
  }
  const risks = riskOfPermCodes(added)
  if (risks.length) {
    const why = String(reason || '').trim()
    if (why.length < 4) throw new Error('提权申请要写原因（至少 4 个字）')
    const req = submitPermRequest({ roleId, roleName: role.name, before, after, reason: why })
    const log = logPermChange({ roleId, roleName: role.name, before, after, reason: why })
    return { roleId, applied: false, noChange: false, diff: { added, removed }, log, request: req, effectiveAt: '' }
  }
  /* 纯降权 / 普通新增 → 立即生效 */
  setRolePerms(roleId, after)
  syncRolePermsRow(roleId)
  const log = logPermChange({ roleId, roleName: role.name, before, after, reason })
  return {
    roleId, applied: true, noChange: false, diff: { added, removed },
    log, request: null, effectiveAt: (log && log.at) || _now()
  }
}

/** 待审批列表（含已处理的，按提交时间倒序）；审批人看不到自己提交的那条的可批按钮 */
export function permRequestRows({ status = '', roleId = '' } = {}) {
  return PERM_REQUESTS
    .filter(r => !status || r.status === status)
    .filter(r => !roleId || r.roleId === roleId)
    .map(r => ({ ...r, ..._permAgeOf(r) }))
    .sort((a, b) => String(b.submitAt).localeCompare(String(a.submitAt)))
}

export const permRequestStats = () => ({
  pending: PERM_REQUESTS.filter(r => r.status === '待审批').length,
  overdue: PERM_REQUESTS.filter(r => r.status === '待审批' && _permAgeOf(r).overdue).length,
  approved: PERM_REQUESTS.filter(r => r.status === '已通过').length,
  rejected: PERM_REQUESTS.filter(r => r.status === '已驳回').length,
  mine: PERM_REQUESTS.filter(r => r.status === '待审批' && r.submitRoleId === currentRoleId.value).length
})

/** 该申请当前是否能由「我」审批：有审批权 + 状态待审批 + 不是我提交的 */
export const canApproveRequest = req =>
  !!req && req.status === '待审批' && canApprovePerm() && req.submitRoleId !== currentRoleId.value

const _reqOf = reqId => {
  const r = PERM_REQUESTS.find(x => x.reqId === reqId)
  if (!r) {
    const e = new Error('申请不存在')
    e.code = 404
    throw e
  }
  return r
}

/**
 * 审批通过：**先写权限，再记变更日志**。
 * 顺序不能反——先记日志再写权限，中途失败就会留下一条"批准了但没生效"的假痕。
 */
export function approvePermRequest({ reqId, note = '' } = {}) {
  const r = _reqOf(reqId)
  assertPerm(PERM_APPROVE_PERM, '审批需要「权限变更审批」权限（e.permApprove.edit）')
  if (r.status !== '待审批') {
    const e = new Error(`该申请已${r.status}，不能重复审批`)
    e.code = 409
    throw e
  }
  if (r.submitRoleId === currentRoleId.value) {
    const e = new Error('不能审批自己提交的申请：提权与批准必须由两个角色完成（双人原则）')
    e.code = 403
    throw e
  }
  setRolePerms(r.roleId, r.after)
  const change = logPermChange({
    roleId: r.roleId, roleName: r.roleName, before: r.before, after: r.after,
    reason: r.reason || `审批通过 ${r.reqId}`, operator: currentRoleName.value
  })
  Object.assign(r, {
    status: '已通过', approver: currentRoleName.value, approvedAt: _now(),
    approveNote: String(note || '').trim(), changeId: change ? change.changeId : ''
  })
  track('perm_approve', { reqId: r.reqId, roleId: r.roleId })
  return { req: { ...r }, change }
}

/** 驳回：必须写原因（≥4 字）——"不同意"三个字等于没解释 */
export function rejectPermRequest({ reqId, note = '' } = {}) {
  const r = _reqOf(reqId)
  assertPerm(PERM_APPROVE_PERM, '驳回需要「权限变更审批」权限（e.permApprove.edit）')
  if (r.status !== '待审批') {
    const e = new Error(`该申请已${r.status}，不能重复处理`)
    e.code = 409
    throw e
  }
  if (String(note).trim().length < 4) {
    const e = new Error('驳回必须写清原因（至少 4 个字）：申请人要知道为什么被拒')
    e.code = 42201
    throw e
  }
  Object.assign(r, {
    status: '已驳回', approver: currentRoleName.value, approvedAt: _now(),
    approveNote: String(note).trim()
  })
  return { ...r }
}

/** 撤回：只有提交人自己、且还在待审批时能撤 */
export function withdrawPermRequest({ reqId } = {}) {
  const r = _reqOf(reqId)
  if (r.status !== '待审批') {
    const e = new Error(`该申请已${r.status}，不能撤回`)
    e.code = 409
    throw e
  }
  if (r.submitRoleId !== currentRoleId.value) {
    const e = new Error('只能撤回自己提交的申请')
    e.code = 403
    throw e
  }
  Object.assign(r, { status: '已撤回', approvedAt: _now() })
  return { ...r }
}

/* 预置：两条待审批（一条人事提的、一条财务主管提的，正好覆盖"谁批谁"的两种组合） */
PERM_REQUESTS.push(
  {
    reqId: 'REQ0001', roleId: 'R-CS', roleName: '客服专员',
    before: [], after: ['a.sensitive.view'], added: ['a.sensitive.view'], removed: [],
    addedCount: 1, removedCount: 0,
    risks: [{ code: 'a.sensitive.view', why: '能看业主 / 租户的证件号与银行账号明文' }],
    reason: '前台收费要核对业主手机号，脱敏后对不上账',
    submitBy: '财务主管·雷志强', submitRoleId: 'R-FINM', submitAt: '2026-10-21 08:40',
    status: '待审批', approver: '', approvedAt: '', approveNote: '', changeId: ''
  },
  {
    reqId: 'REQ0002', roleId: 'R-CHG', roleName: '收银员',
    before: [], after: ['a.stewards.edit', 'b.payments.view'], added: ['a.stewards.edit', 'b.payments.view'], removed: [],
    addedCount: 2, removedCount: 0,
    risks: [{ code: 'a.stewards.edit', why: '能改楼栋责任范围——等于能自己扩大可见范围' }],
    reason: '收银员要按楼栋筛选欠费，需要调整责任范围',
    submitBy: '人事·周敏', submitRoleId: 'R-HR', submitAt: '2026-10-21 09:15',
    status: '待审批', approver: '', approvedAt: '', approveNote: '', changeId: ''
  },
  {
    reqId: 'REQ0000', roleId: 'R-QS', roleName: '品质督导',
    before: [], after: ['e.org.edit'], added: ['e.org.edit'], removed: [],
    addedCount: 1, removedCount: 0,
    risks: [{ code: 'e.org.edit', why: '能改角色权限本身——等于能给自己加任何权限' }],
    reason: '品质督导想自己维护巡检模板的可见范围',
    submitBy: '人事·周敏', submitRoleId: 'R-HR', submitAt: '2026-10-20 14:02',
    status: '已驳回', approver: '总经理·周正', approvedAt: '2026-10-20 15:30',
    approveNote: '改权限的能力不能给业务岗，模板可见范围用数据范围解决',
    changeId: ''
  }
)

/* ==================================================================
 * H 域 · 组织负责人关系（2026-11-03 第 52 批）
 *
 * 为什么单独一张表：`orgs.leader` 是自由文本，只能表达「一个部门一个负责人」。
 * 现实里三种情况表达不出来：
 *   ① 一个部门多个负责人（正职 + 副职分工）；
 *   ② 正职离任期间由代理顶着，代理有起止日期，到期自动失效；
 *   ③ 一人管多个部门 —— 第 51 批用 `leaderEmpId` 勉强表达了，但一个人的多个
 *      负责关系可能有不同职责（A 部门正职、B 部门代理），单值字段装不下。
 *
 * 三条口径：
 *   ① **正职唯一**：一个部门只能有一个在期正职，多了不知道谁签字；
 *   ② **代理必须填结束日期**：没有到期的代理等于第二个正职，迟早忘了收回；
 *   ③ **副职不参与审批**：副职是分工不是授权。审批只认正职，正职空缺才落到在期代理。
 *
 * `orgs.leader` / `leaderEmpId` 保留为展示快照（种子由关系表回写），不删 ——
 * 二十多处展示代码和契约样例都引着它，删掉是纯风险没有收益。
 * ================================================================== */

export const ORG_DUTY = ['正职', '副职', '代理']
const _DUTY_RANK = { 正职: 0, 代理: 1, 副职: 2 }

const ORG_LEADERS = []
let ORG_LEADER_SEQ = 0

/** 关系是否在期：没填开始日视为一直在任；结束日早于今天视为已结束 */
function _relState(r) {
  if (r.startDate && r.startDate > TODAY) return '未生效'
  if (r.endDate && r.endDate < TODAY) return '已结束'
  return '在期'
}
const _relActive = r => _relState(r) === '在期'

/* 种子：21 个组织的正职从 `leaderEmpId` 迁移过来，再加四条演示数据。
   O-P01-T3 用显式记录覆盖（正职 10/15 离任 + 代理在期），不能同时生成默认正职，
   否则一个部门会有两条在期正职，直接违反「正职唯一」。 */
const _LEADER_SEED_OVERRIDE = new Set(['O-P01-T3'])
const _SEED_ORG_LEADERS = []
for (const o of orgs) {
  if (o.leaderEmpId && !_LEADER_SEED_OVERRIDE.has(o.orgId)) {
    _SEED_ORG_LEADERS.push({ orgId: o.orgId, empId: o.leaderEmpId, duty: '正职', startDate: '', endDate: '', note: '' })
  }
}
_SEED_ORG_LEADERS.push(
  /* 正职离任 → 代理顶上：审批人要自动切到代理，不能还挂着已经离任的人 */
  { orgId: 'O-P01-T3', empId: 'EM0034', duty: '正职', startDate: '2025-06-01', endDate: '2026-10-15', note: '胡建国 10/15 调岗离任' },
  { orgId: 'O-P01-T3', empId: 'EM0036', duty: '代理', startDate: '2026-10-16', endDate: '2026-12-31', note: '正职空缺期间由龚淼然代理，到期自动失效' },
  /* 副职：分工不授权，单签节点轮不到他；但会签节点必须参与 */
  { orgId: 'O-P01-T4', empId: 'EM0052', duty: '副职', startDate: '2026-03-01', endDate: '', note: '分管绿化，不参与单签审批' },
  { orgId: 'O-P01', empId: 'EM0011', duty: '副职', startDate: '2026-02-01', endDate: '', note: '分管工程与采购，采购类会签需与正职共同签署' },
  /* 已过期的代理：留档不删，演示「到期自动失效」 */
  { orgId: 'O-P02-T4', empId: 'EM0054', duty: '代理', startDate: '2026-08-01', endDate: '2026-09-30', note: '钱文博休假期间代理，9/30 已结束' }
)
for (const r of _SEED_ORG_LEADERS) {
  ORG_LEADER_SEQ += 1
  ORG_LEADERS.push({
    id: 'OL' + String(ORG_LEADER_SEQ).padStart(4, '0'),
    orgId: r.orgId, empId: r.empId, duty: r.duty,
    startDate: r.startDate, endDate: r.endDate, note: r.note
  })
}
/* 快照对齐放在 H 域末尾（见文件下方）：这里调用会碰到还没初始化的 const 箭头函数 */

const _empOf = empId => employees.find(e => e.empId === empId) || null

/** 某部门的全部负责人（含已结束 / 未生效，页面要能看见历史与待生效） */
export function leadersOf(orgId) {
  return ORG_LEADERS
    .filter(r => r.orgId === orgId)
    .map(r => {
      const e = _empOf(r.empId) || {}
      const state = _relState(r)
      return {
        ...r,
        name: e.name || r.empId,
        position: e.position || '',
        empStatus: e.status || '',
        state,
        active: state === '在期',
        /* 部门负责人不能是离职员工：离职了关系还在，审批会落到查无此人 */
        warn: e.status === '离职' ? '该员工已离职，建议结束这条负责关系' : ''
      }
    })
    .sort((a, b) => _DUTY_RANK[a.duty] - _DUTY_RANK[b.duty] || String(a.startDate).localeCompare(String(b.startDate)))
}

/** 只取在期负责人（审批解析、计划提报用）。
 * 用 function 声明而不是 const 箭头：种子对齐等早期代码会调它，const 有 TDZ。 */
export function activeLeadersOf(orgId) {
  return leadersOf(orgId).filter(r => r.active)
}

/**
 * 部门当前审批人：在期正职 → 在期代理（结束日期最晚的）→ 空。
 * 副职不参与：副职是分工不是授权，让他批等于把签字权随手给了第二个人。
 */
function _rankingLeader(orgId) {
  const list = activeLeadersOf(orgId)
  const zheng = list.find(r => r.duty === '正职')
  if (zheng) return zheng
  const proxies = list.filter(r => r.duty === '代理')
  if (!proxies.length) return null
  return proxies.sort((a, b) => String(b.endDate || '9999').localeCompare(String(a.endDate || '9999')))[0]
}

/**
 * 部门负责人（兼容旧调用）：
 * 关系表里有记录就以关系表为准；一条都没有时回落到 `leaderEmpId` / `leader`。
 * 回落是为了「刚升级还没补数据」的部门不至于审批人全空，不是长期方案。
 */
export function orgLeaderOf(orgId) {
  const o = ORG_OF.get(orgId)
  if (!o) return null
  const hit = _rankingLeader(orgId)
  if (hit) {
    return {
      orgId, orgName: o.name,
      empId: hit.empId, name: hit.name, position: hit.position,
      duty: hit.duty, endDate: hit.endDate || '', source: 'relation'
    }
  }
  const emp = o.leaderEmpId ? _empOf(o.leaderEmpId) : null
  return {
    orgId, orgName: o.name,
    empId: o.leaderEmpId || '', name: emp?.name || o.leader || '',
    position: emp?.position || '', duty: '', endDate: '', source: 'legacy'
  }
}

/** 我负责的组织（列表 / 计划提报用）：含正职、副职、在期代理 */
export function leadsOf(empId = '') {
  const emp = empId ? _empOf(empId) : currentOperator()
  if (!emp) return []
  const homeOrgId = teamOf(emp) || emp.orgId
  return ORG_LEADERS
    .filter(r => r.empId === emp.empId && _relActive(r))
    .map(r => {
      const o = ORG_OF.get(r.orgId)
      if (!o) return null
      return {
        orgId: o.orgId,
        orgName: o.name,
        orgType: o.type,
        orgPath: orgPathOf(o.orgId),
        projectId: _projectOfOrg(o.orgId),
        headcount: _headcountOf(o.orgId),
        /* isPrimary = 这个部门是不是他的人事主职（工资考勤按主职算），
           与 duty（他在这个部门是正职还是副职/代理）是两件事 */
        isPrimary: o.orgId === homeOrgId,
        duty: r.duty,
        endDate: r.endDate || '',
        dutyNote: r.duty === '正职'
          ? (o.orgId === homeOrgId ? '' : '兼管：不是人事主职部门，工资考勤仍按主职算')
          : (r.duty === '代理'
            ? `代理至 ${r.endDate || '未填'}，到期自动失效`
            : '副职：可提报计划，但不参与该部门审批')
      }
    })
    .filter(Boolean)
    .sort((a, b) => _DUTY_RANK[a.duty] - _DUTY_RANK[b.duty]
      || (a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1)
      || (_ORG_RANK[a.orgType] ?? 9) - (_ORG_RANK[b.orgType] ?? 9))
}

/** 某人负责的组织数（计划页提示用，避免重复算 leadsOf） */
export const leadCountOf = empId => leadsOf(empId).length

/* ---------------- 写 ---------------- */

const _leaderError = (msg, code) => Object.assign(new Error(msg), { code })

function _checkLeader({ orgId, empId, duty, startDate, endDate, id }) {
  if (!ORG_OF.get(orgId)) throw _leaderError('组织不存在', 40401)
  const emp = _empOf(empId)
  if (!emp) throw _leaderError('员工不存在', 40401)
  if (emp.status === '离职') throw _leaderError(`「${emp.name}」已离职，不能设为负责人`, 42213)
  if (!ORG_DUTY.includes(duty)) throw _leaderError('职责只能是正职 / 副职 / 代理', 42214)
  const s = String(startDate || '')
  const e = String(endDate || '')
  if (s && e && e < s) throw _leaderError('结束日期不能早于开始日期', 42213)
  /* 代理必须有结束日期：没有到期的代理等于第二个正职，收回时没人记得 */
  if (duty === '代理' && !e) throw _leaderError('代理必须填结束日期（到期自动失效，不需要人工收回）', 42213)
  /* 正职唯一：同一部门不能有两条在期正职 */
  if (duty === '正职') {
    const clash = ORG_LEADERS.find(r => r.id !== id && r.orgId === orgId && r.duty === '正职' && _relActive(r))
    if (clash) throw _leaderError(`该部门已有在期正职「${_empOf(clash.empId)?.name || clash.empId}」，先把原来的结束掉`, 40927)
  }
  return { startDate: s, endDate: e }
}

/** 新增或修改一条负责关系（id 为空即新增） */
export function saveOrgLeader({ id = '', orgId = '', empId = '', duty = '正职', startDate = '', endDate = '', note = '' } = {}) {
  if (!canEditOrgLeaders()) throw _leaderError('当前角色没有组织维护权限（e.org.edit）', 403)
  const clean = _checkLeader({ orgId, empId, duty, startDate, endDate, id })
  if (id) {
    const r = ORG_LEADERS.find(x => x.id === id)
    if (!r) throw _leaderError('负责关系不存在', 40401)
    Object.assign(r, { orgId, empId, duty, ...clean, note: String(note || '').trim() })
    _syncOrgLeaderSnapshot(orgId)
    return { ...r }
  }
  ORG_LEADER_SEQ += 1
  const rec = {
    id: 'OL' + String(ORG_LEADER_SEQ).padStart(4, '0'),
    orgId, empId, duty, ...clean, note: String(note || '').trim()
  }
  ORG_LEADERS.push(rec)
  _syncOrgLeaderSnapshot(orgId)
  return { ...rec }
}

/**
 * 删除一条负责关系。
 * 允许删掉最后一个负责人（部门可以暂时没有负责人），但返回 `empty` 让页面提示 ——
 * 部门无人负责之后，提报计划与审批解析都会落到上级，用户要知道这个后果。
 */
export function removeOrgLeader(id) {
  if (!canEditOrgLeaders()) throw _leaderError('当前角色没有组织维护权限（e.org.edit）', 403)
  const i = ORG_LEADERS.findIndex(x => x.id === id)
  if (i < 0) throw _leaderError('负责关系不存在', 40401)
  const [rec] = ORG_LEADERS.splice(i, 1)
  _syncOrgLeaderSnapshot(rec.orgId)
  return { ...rec, empty: activeLeadersOf(rec.orgId).length === 0 }
}

/** 整组替换（编辑抽屉保存时一次提交，避免逐条增删跑多次校验） */
export function setOrgLeaders(orgId, list = []) {
  if (!canEditOrgLeaders()) throw _leaderError('当前角色没有组织维护权限（e.org.edit）', 403)
  if (!ORG_OF.get(orgId)) throw _leaderError('组织不存在', 40401)
  const cleaned = list.map((x, i) => {
    const clean = _checkLeader({ ...x, orgId, id: x.id || `tmp-${i}` })
    return {
      id: x.id || '', empId: x.empId, duty: x.duty,
      startDate: clean.startDate, endDate: clean.endDate, note: String(x.note || '').trim()
    }
  })
  /* 组内也要查正职唯一（_checkLeader 只查了已存数据，管不到本次一起提交的两条） */
  const zheng = cleaned.filter(x => x.duty === '正职' && _relActive(x))
  if (zheng.length > 1) throw _leaderError('同一部门只能有一个在期正职', 40927)

  const keep = ORG_LEADERS.filter(r => r.orgId !== orgId)
  const ids = new Set(cleaned.filter(x => x.id).map(x => x.id))
  ORG_LEADERS.length = 0
  ORG_LEADERS.push(...keep.filter(r => !ids.has(r.id) || r.orgId !== orgId))
  for (const x of cleaned) {
    if (x.id) {
      const old = ORG_LEADERS.find(r => r.id === x.id)
      if (old) Object.assign(old, x)
      continue
    }
    ORG_LEADER_SEQ += 1
    ORG_LEADERS.push({ id: 'OL' + String(ORG_LEADER_SEQ).padStart(4, '0'), orgId, ...x })
  }
  _syncOrgLeaderSnapshot(orgId)
  return leadersOf(orgId)
}

/**
 * 把当前正职回写到 `orgs.leader` / `leaderEmpId`（展示快照）。
 * 不写的话组织树、巡检被检班组、成员详情上的「负责人」还是旧名字，
 * 而审批已经按关系表走 —— 同一个部门两个负责人名字，比不显示更糟。
 */
function _syncOrgLeaderSnapshot(orgId) {
  const o = ORG_OF.get(orgId)
  if (!o) return
  const hit = _rankingLeader(orgId)
  if (hit) {
    o.leaderEmpId = hit.empId
    o.leader = hit.name
  } else {
    o.leaderEmpId = ''
    o.leader = ''
  }
}

/**
 * 负责人候选：在职员工全量。
 * 不按「主管及以上」过滤 —— 班组负责人可能就是资深师傅，按岗位卡会把人挡在外面；
 * 真正的约束是「一个部门只能有一个正职」，不是「谁能当负责人」。
 */
export const orgLeaderCandidates = () => employees
  .filter(e => e.status !== '离职')
  .map(e => ({
    empId: e.empId, name: e.name, position: e.position,
    orgId: e.orgId, orgName: orgNameOf(e.orgId), status: e.status
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'zh'))

/** 组织负责人维护权限：沿用组织维护位（改负责人是组织维护的一部分） */
export const canViewOrgLeaders = () => _hasPerm('e.org.view')
export const canEditOrgLeaders = () => _hasPerm('e.org.edit')

/** 汇总：多少个部门有负责人 / 多少空缺 / 多少代理在期 / 多少条已结束（组织页顶部提示用） */
export function orgLeaderSummary() {
  const byOrg = new Map()
  for (const r of ORG_LEADERS) {
    const cur = byOrg.get(r.orgId) || []
    cur.push(r)
    byOrg.set(r.orgId, cur)
  }
  let filled = 0
  let empty = 0
  const multi = []
  for (const o of orgs) {
    const list = (byOrg.get(o.orgId) || []).filter(_relActive)
    if (!list.length) { empty += 1; continue }
    filled += 1
    if (list.length > 1) multi.push({ orgId: o.orgId, name: o.name, count: list.length })
  }
  const active = ORG_LEADERS.filter(_relActive)
  return {
    total: ORG_LEADERS.length,
    filled, empty, multi,
    proxying: active.filter(r => r.duty === '代理').length,
    deputy: active.filter(r => r.duty === '副职').length,
    ended: ORG_LEADERS.filter(r => _relState(r) === '已结束').length,
    multiCount: multi.length
  }
}

/* 种子建好后把快照对齐一次（放在 H 域最末尾，确保所有读取口都已初始化）。
   种子里 O-P01-T3 的正职已离任、代理在期，`orgs.leader` 还是离任的胡建国 ——
   不对齐的话组织树 / 巡检被检班组显示的是离任的人，而审批已经走代理，
   同一个部门两个名字比不显示更糟。 */
for (const o of orgs) _syncOrgLeaderSnapshot(o.orgId)

/* ==================================================================
 * T 域 · 计划模板（2026-11-03 第 54 批）
 *
 * 第 51 批的计划是「部门自己写任务」，模板只给了个起步骨架。实际业务里
 * 考核项是公司统一规定的 —— 项目经理和四个班组各有一套，条目、权重、
 * 评价标准都不该由填报人改。本批把模板做成独立数据。
 *
 * 三个决定：
 *   ① **模板是数据不是代码**：改权重、改条目、改评价标准都在页面上做，
 *      不用改代码发版；
 *   ② **提报时整份拷贝到计划里**（快照）—— 否则 7 月改了权重，
 *      3 月已归档的分数会跟着重算。模板只影响之后新建的计划；
 *   ③ 权重三段式：量化段 + 重点段 = 100%，**段内条目合计必须等于段权重**。
 *      配成 10/10/10/10/10 而段权重 35%，总分基数就飘了，保存时直接拦。
 *      监控段权重恒 0，只扣分不占权重。
 *
 * 本期不做（用户确认）：监控指标的封顶值不做配置、不做校验 ——
 * 只让「评价标准」的文字可编辑，扣多少分由人判断。
 * ================================================================== */

/**
 * 三个分段。
 *
 * 注意：**段权重已经不存在了**（2026-11-05 第 60 批）。以前是「两段各占多少 +
 * 段内再分」，现在是「所有计分项合起来 100%」，只有一个约束。
 * 页面想显示「量化段占多少」时用 `planWeightCheck().qs` 现算，不要另存一份 ——
 * 另存就会出现「改了权重、标题上的百分比没变」。
 */
export const PLAN_SECTIONS = [
  { key: 'q', name: '量化指标', note: '挑战 = 目标 × 105%，否决 = 目标 × 95%' },
  { key: 'm', name: '监控指标', note: '权重恒为 0，只扣分不占权重' },
  { key: 'k', name: '重点工作计划', note: '对照评分表打 1–5 分' }
]

/** 指标方向：收入类越高越好，成本类越低越好。方向错了整行都算反 */
export const PLAN_DIRECTION_OPT = [
  { value: 1, label: '正向', hint: '越高越好，用于收入、及时率' },
  { value: -1, label: '逆向', hint: '越低越好，用于成本、能耗、事故' }
]

const PLAN_PERM_TPL_VIEW = 'f.planTpl.view'
const PLAN_PERM_TPL_EDIT = 'f.planTpl.edit'
export const canViewPlanTpl = () => _hasPerm(PLAN_PERM_TPL_VIEW)
export const canEditPlanTpl = () => _hasPerm(PLAN_PERM_TPL_EDIT)

const PLAN_TPLS = []
let PLAN_TPL_SEQ = 0

/**
 * 模板条目。
 *
 * **模板不存权重**：权重由提报人新建计划时逐项填，审核阶段运营管理部可调。
 * 模板只管「考什么、怎么算分、单位是什么」，管不了「各占多少」——
 * 同一套考核项，不同项目当月的重点本来就不同，写死在模板里等于逼所有人按同一个比例。
 */
function _tplItem(section, name, opt = {}) {
  PLAN_TPL_SEQ += 1
  return {
    itemId: 'PI' + String(PLAN_TPL_SEQ).padStart(4, '0'),
    section,
    name,
    /* 量化的评价标准由目标值算，留空；监控和重点的这条是给人看的规则说明 */
    standard: opt.standard || '',
    direction: opt.direction === -1 ? -1 : 1,
    targetDefault: opt.targetDefault ?? '',
    unit: opt.unit || '',
    enabled: true
  }
}

/* ---------------- 六套内置模板 ----------------
 * 第 60 批起模板里**没有权重**：条目、单位、方向、目标默认值、监控的扣分规则文字由这里定，
 * 「每项占多少」由提报人在计划里填。所以下面每个条目都只有名字和可选配置。
 */
const _TPL_SPECS = [
  {
    tplId: 'PT01', name: '项目经理月度计划', matchType: '项目', matchSuffix: '',
    desc: '项目经理考核：收入与成本五项量化 + 五项监控 + 五项重点工作',
    q: [
      ['物业费清欠', { unit: '元', targetDefault: 383796 }],
      ['车位费收入', { unit: '元', targetDefault: 53040 }],
      ['其他营业收入', { unit: '元', targetDefault: 6810 }],
      ['运行成本控制', { unit: '元', targetDefault: 17296, direction: -1 }],
      ['能耗成本控制', { unit: '元', targetDefault: 38697, direction: -1 }]
    ],
    m: [
      ['主动离职人数', '部门员工每主动离职 1 人，考核总分扣 0.05 分，最高扣 0.2 分'],
      ['培训达标率', '完成值低于 95%，每下降 1 分，考核总分扣 0.05 分，最高扣 0.2 分'],
      ['月度品质检查', '不合格问题整改率 100% 低于达标率，绩效考核降一档'],
      ['有效投诉 0 起', '每发生一起，考核总分扣 0.2 分'],
      ['质量责任事故 0 起', '每发生一起，考核总分扣 0.2 分']
    ],
    k: [
      '客户服务（社区活动、客户信息管理）',
      '房屋及设施设备管理',
      '环境管理',
      '公共秩序管理',
      '重要节点工作'
    ]
  },
  {
    tplId: 'PT02', name: '客服组月度计划', matchType: '班组', matchSuffix: '1',
    desc: '客服班组：三项收入量化 + 五项监控 + 八项重点工作',
    q: [
      ['物业费清欠', { unit: '元', targetDefault: 319830 }],
      ['车位费收入', { unit: '元', targetDefault: 32240 }],
      ['其他营业收入', { unit: '元', targetDefault: 4300 }]
    ],
    m: [
      ['主动离职人数', '部门员工每主动离职 1 人，考核总分扣 0.05 分，最高扣 0.2 分'],
      ['培训达标率', '完成值低于 95%，每下降 1 分，考核总分扣 0.05 分，最高扣 0.2 分'],
      ['月度品质检查', '不合格问题整改率 100% 低于达标率，绩效考核降一档'],
      ['有效投诉 0 起', '每发生一起，考核总分扣 0.2 分'],
      ['质量责任事故 0 起', '每发生一起，考核总分扣 0.2 分']
    ],
    k: [
      '社区文化活动', '员工关怀', '业主恳谈会', '项目《客户画像细分表》',
      '维修资金', '档案管理', '走回访调查', '物业费催缴'
    ]
  },
  {
    tplId: 'PT03', name: '工程组月度计划', matchType: '班组', matchSuffix: '2',
    desc: '工程班组：维修收入与能耗成本两项量化 + 六项监控 + 八项重点工作',
    q: [
      ['有偿维修收入', { unit: '元', targetDefault: 0 }],
      ['能耗成本控制', { unit: '元', targetDefault: 39922.9, direction: -1 }]
    ],
    m: [
      ['年度维保计划完成率', '完成率 100%，低于达标率，考核总分扣 0.2 分'],
      ['主动离职人数', '部门员工每主动离职 1 人，考核总分扣 0.05 分，最高扣 0.2 分'],
      ['培训达标率', '完成值低于 95%，每下降 1 分，考核总分扣 0.05 分，最高扣 0.2 分'],
      ['月度品质检查', '不合格问题整改率 100% 低于达标率，绩效考核降一档'],
      ['有效投诉 0 起', '每发生一起，考核总分扣 0.2 分'],
      ['质量责任事故 0 起', '每发生一起，考核总分扣 0.2 分']
    ],
    k: [
      '园区节日布置拆除', '消防泵房维护', '直饮水系统维护', '电梯年检',
      '景观水系石材维护', '闭路监控系统常规维保', '公区运行能耗抄表', '居民供水管控'
    ]
  },
  {
    tplId: 'PT04', name: '秩序组月度计划', matchType: '班组', matchSuffix: '3',
    desc: '秩序班组：停车与其他收入两项量化 + 五项监控 + 八项重点工作',
    q: [
      ['临时停车收入', { unit: '元', targetDefault: 4000 }],
      ['其他营业收入', { unit: '元', targetDefault: 10 }]
    ],
    m: [
      ['主动离职人数', '部门员工每主动离职 1 人，考核总分扣 0.05 分，最高扣 0.2 分'],
      ['培训达标率', '完成值低于 95%，每下降 1 分，考核总分扣 0.05 分，最高扣 0.2 分'],
      ['月度品质检查', '不合格问题整改率 100% 低于达标率，绩效考核降一档'],
      ['有效投诉 0 起', '每发生一起，考核总分扣 0.2 分'],
      ['质量责任事故 0 起', '每发生一起，考核总分扣 0.2 分']
    ],
    k: [
      '园区管理', '消防管理', '门岗管理', '地库管理',
      '员工关怀', '突发事件演练', '品质提升', '车辆管理'
    ]
  },
  {
    tplId: 'PT05', name: '环境组月度计划', matchType: '班组', matchSuffix: '4',
    desc: '环境班组：家政收入与专项成本两项量化 + 五项监控 + 八项重点工作',
    q: [
      ['家政服务收入', { unit: '元', targetDefault: 300 }],
      ['专项成本控制', { unit: '元', targetDefault: 7200, direction: -1 }]
    ],
    m: [
      ['主动离职人数', '部门员工每主动离职 1 人，考核总分扣 0.05 分，最高扣 0.2 分'],
      ['培训达标率', '完成值低于 95%，每下降 1 分，考核总分扣 0.05 分，最高扣 0.2 分'],
      ['月度品质检查', '不合格问题整改率 100% 低于达标率，绩效考核降一档'],
      ['有效投诉 0 起', '每发生一起，考核总分扣 0.2 分'],
      ['质量责任事故 0 起', '每发生一起，考核总分扣 0.2 分']
    ],
    k: [
      '元宵节活动', '员工关怀', '越冬蚊蝇消杀', '清理地库大仓库、洗拖把间排水沟',
      '保暖套清洗', '地库环境提升', '清洗生活垃圾桶', '清理 2#、3# 楼管井、电井卫生'
    ]
  },
  {
    tplId: 'PT06', name: '职能通用月度计划（兜底）', matchType: '职能', matchSuffix: '',
    desc: '总部职能部门没有收入指标，量化段放部门级关键数据；匹配不到模板时用它兜底',
    q: [
      ['部门预算执行率', { unit: '%', targetDefault: 100 }],
      ['重点工作按期完成率', { unit: '%', targetDefault: 100 }]
    ],
    m: [
      ['主动离职人数', '部门员工每主动离职 1 人，考核总分扣 0.05 分，最高扣 0.2 分'],
      ['培训达标率', '完成值低于 95%，每下降 1 分，考核总分扣 0.05 分，最高扣 0.2 分'],
      ['有效投诉 0 起', '每发生一起，考核总分扣 0.2 分'],
      ['质量责任事故 0 起', '每发生一起，考核总分扣 0.2 分']
    ],
    k: [
      '月度重点工作', '制度与流程维护', '跨部门协同', '团队能力建设',
      '档案与资料归档', '会议与汇报', '临时交办事项'
    ]
  }
]

for (const sp of _TPL_SPECS) {
  const items = []
  for (const [name, opt] of sp.q) items.push(_tplItem('q', name, opt || {}))
  for (const [name, std] of sp.m) items.push(_tplItem('m', name, { standard: std }))
  for (const name of sp.k) items.push(_tplItem('k', name))
  PLAN_TPLS.push({
    tplId: sp.tplId,
    name: sp.name,
    desc: sp.desc || '',
    matchType: sp.matchType,
    matchSuffix: sp.matchSuffix || '',
    enabled: true,
    version: 1,
    items,
    updatedAt: '2026-11-01 09:00',
    updatedBy: '运营管理部'
  })
}

/* ---------------- 校验 ---------------- */

const _tplError = (msg, code) => Object.assign(new Error(msg), { code })

/**
 * 模板完整性校验。**返回错误清单而不是抛异常** —— 页面上要一次把
 * 所有问题都列出来，抛第一个错误会让人改一处试一次。
 *
 * 第 60 批起模板**不再校验权重**：权重已经不在模板里了（改由提报人填、
 * 审核阶段可调）。这里只校验「考什么」是否齐全 —— 名称、适用类型、
 * 量化段和重点段不能是空的。
 */
export function planTplCheck(tpl = {}) {
  const errs = []
  const items = (tpl.items || []).filter(i => i.enabled !== false)

  if (!String(tpl.name || '').trim()) errs.push('模板名称不能为空')
  if (!['项目', '班组', '职能'].includes(tpl.matchType)) errs.push('适用类型只能选项目 / 班组 / 职能')
  if (tpl.matchType === '班组' && !/^[1-4]$/.test(String(tpl.matchSuffix || ''))) {
    errs.push('适用班组要指定是哪一个（T1 客服 / T2 工程 / T3 秩序 / T4 环境）')
  }

  for (const sec of PLAN_SECTIONS) {
    const rows = items.filter(i => i.section === sec.key)
    const noName = rows.filter(i => !String(i.name || '').trim()).length
    if (noName) errs.push(`${sec.name}有 ${noName} 条没填名称`)
    const tooLong = rows.filter(i => String(i.name || '').trim().length > 40).length
    if (tooLong) errs.push(`${sec.name}有 ${tooLong} 条名称超过 40 字`)
    /* 量化段和重点段是计分的主体，一段全空这份计划就没有可评分的内容；
       监控段允许为空（纯扣分项，个别岗位确实不需要） */
    if (sec.key !== 'm' && !rows.length) errs.push(`${sec.name}至少要有一条考核项`)
  }
  return { ok: errs.length === 0, errs }
}

/* ---------------- 读 ---------------- */

function _tplRowOf(t) {
  const items = t.items || []
  const q = items.filter(i => i.section === 'q')
  const m = items.filter(i => i.section === 'm')
  const k = items.filter(i => i.section === 'k')
  const chk = planTplCheck(t)
  return {
    ...t,
    qCount: q.length,
    mCount: m.length,
    kCount: k.length,
    totalCount: q.length + m.length + k.length,
    checkOk: chk.ok,
    checkErrs: chk.errs
  }
}

export function planTplRows({ kw = '', onlyEnabled = false } = {}) {
  return PLAN_TPLS
    .filter(t => !onlyEnabled || t.enabled)
    .filter(t => !kw || `${t.name}${t.desc}${t.items.map(i => i.name).join('')}`.includes(kw))
    .map(_tplRowOf)
}

export function getPlanTpl(tplId) {
  const t = PLAN_TPLS.find(x => x.tplId === tplId)
  if (!t) return null
  return { ..._tplRowOf(t), items: t.items.map(i => ({ ...i })) }
}

/**
 * 按组织自动匹配模板。
 * 项目部 → 项目经理模板；班组按 -T1~-T4 对应客服 / 工程 / 秩序 / 环境；
 * 总部部门没有对应模板，落到「职能通用」兜底。
 * 匹配不到时返回 null，页面提示让人去配，而不是静默给一个空模板。
 */
export function planTplForOrg(orgId) {
  const o = ORG_OF.get(orgId)
  if (!o) return null
  const on = PLAN_TPLS.filter(t => t.enabled)
  if (o.type === '项目') return on.find(t => t.matchType === '项目') || null
  if (o.type === '班组') {
    const sfx = String(orgId).split('-T')[1] || ''
    return on.find(t => t.matchType === '班组' && t.matchSuffix === sfx)
      || on.find(t => t.matchType === '职能') || null
  }
  return on.find(t => t.matchType === '职能') || null
}

/** 下拉选项：给提报表单「换模板」用 */
export const planTplOpts = () => PLAN_TPLS
  .filter(t => t.enabled)
  .map(t => ({
    tplId: t.tplId, name: t.name, matchType: t.matchType,
    label: t.matchType === '班组'
      ? `${t.name}（T${t.matchSuffix}）`
      : t.name
  }))

/* ---------------- 写 ---------------- */

function _cleanTplItems(items = []) {
  const used = new Set()
  return items.map((x, i) => {
    let id = x.itemId || ''
    if (!id || used.has(id)) {
      PLAN_TPL_SEQ += 1
      id = 'PI' + String(PLAN_TPL_SEQ).padStart(4, '0')
    }
    used.add(id)
    return {
      itemId: id,
      section: ['q', 'm', 'k'].includes(x.section) ? x.section : 'k',
      name: String(x.name || '').trim(),
      standard: String(x.standard || '').trim(),
      direction: x.direction === -1 ? -1 : 1,
      targetDefault: x.targetDefault === '' || x.targetDefault === undefined || x.targetDefault === null
        ? '' : Number(x.targetDefault),
      unit: String(x.unit || '').trim(),
      enabled: x.enabled !== false
    }
  })
}

/**
 * 保存模板（新建或改）。
 * 校验不通过**整单拒绝**，不做部分保存 —— 一份缺了「量化指标」的模板
 * 落库之后，用它提报出来的计划就没有可评分的内容，而且是隐性的。
 */
export function savePlanTpl(payload = {}, tplId = '') {
  if (!canEditPlanTpl()) throw _tplError('当前角色没有计划模板维护权限（f.planTpl.edit）', 403)
  const items = _cleanTplItems(payload.items)
  const draft = {
    name: String(payload.name || '').trim(),
    desc: String(payload.desc || '').trim(),
    matchType: payload.matchType || '班组',
    matchSuffix: String(payload.matchSuffix || ''),
    items
  }
  const chk = planTplCheck(draft)
  if (!chk.ok) throw _tplError(chk.errs[0], 42214)

  const me = currentOperator()
  if (tplId) {
    const t = PLAN_TPLS.find(x => x.tplId === tplId)
    if (!t) throw _tplError('模板不存在', 40401)
    Object.assign(t, draft, {
      version: (t.version || 1) + 1,
      updatedAt: _now(),
      updatedBy: me.name
    })
    return getPlanTpl(tplId)
  }

  const same = PLAN_TPLS.find(x => x.matchType === draft.matchType
    && String(x.matchSuffix) === String(draft.matchSuffix))
  if (same) {
    throw _tplError(`已经有一个「${same.name}」管这一类部门了，同一类不能配两个模板`, 40929)
  }
  PLAN_TPL_SEQ += 1
  const t = {
    tplId: 'PT' + String(PLAN_TPLS.length + 1).padStart(2, '0'),
    ...draft,
    enabled: true,
    version: 1,
    updatedAt: _now(),
    updatedBy: me.name
  }
  PLAN_TPLS.push(t)
  return getPlanTpl(t.tplId)
}

/** 启用 / 停用。停用不删除：历史计划还引着它，删了追溯就断 */
export function togglePlanTpl(tplId, enabled) {
  if (!canEditPlanTpl()) throw _tplError('当前角色没有计划模板维护权限（f.planTpl.edit）', 403)
  const t = PLAN_TPLS.find(x => x.tplId === tplId)
  if (!t) throw _tplError('模板不存在', 40401)
  t.enabled = !!enabled
  t.updatedAt = _now()
  t.updatedBy = currentOperator().name
  return getPlanTpl(tplId)
}

/** 模板汇总：列表页顶部 KPI 用 */
export function planTplSummary() {
  const rows = planTplRows()
  return {
    total: rows.length,
    enabled: rows.filter(t => t.enabled).length,
    disabled: rows.filter(t => !t.enabled).length,
    items: rows.reduce((s, t) => s + t.totalCount, 0),
    broken: rows.filter(t => !t.checkOk).length
  }
}

/* ==================================================================
 * G 域 · 部门计划管理（2026-11-03 第 55 批 · 改为模板驱动；11-05 第 60 批 · 权重下放）
 *
 * 第 51 批的计划是「部门自己写任务」，第 54 批把考核项做成了模板。
 * 第 55 批把计划真正接到模板上：**条目由模板铺开**。
 * **第 60 批把权重从模板搬到计划**：模板只定「考什么、怎么算分」，
 * 「每项占多少」由提报人在新建计划时填，审核阶段运营管理部可调。
 * 理由：同一套考核项，不同项目当月的重点本来就不同；写死在模板里，
 * 要么所有人按同一比例，要么运营管理部每个月改一遍模板（还会改坏历史版本）。
 *
 * 结构与口径：
 *   ① 三段：量化（填目标值，自评按公式算）/ 监控（权重 0，直接填扣分）/
 *      重点（对照评分表人工打 1–5 分）；
 *   ② 量化自评：`5 ×（实际 − 否决）/（挑战 − 否决）`，夹在 1–5 之间；
 *      正向 挑战 = 目标×105%、否决 = 目标×95%，逆向镜像；
 *      目标为 0（零容忍/零收入）时公式失效，退回人工打分；
 *   ③ **各项权重合计必须正好 100%**（单一约束，没有"段权重"了），
 *      监控项恒 0；提交审核时卡，草稿不卡（写到一半要能存）；
 *   ④ 加权 = 分数 × 权重/100（权重合计 100，所以自评合计满分就是 5 分）；
 *   ⑤ **月度总得分 = 自评合计 × 20% + 复评合计 × 80%**；
 *   ⑥ 流程：草稿 → 审批中 → 已批准 → 执行中 → 待复评 → 已结案。
 *      审核阶段运营管理部**直接改、改完即通过**（不走驳回），改动记进 reviseLog；
 *      **必须等填报人提交完成情况之后才能复评**（状态卡住，不靠人自觉）。
 *
 * 提报时把模板条目和当时的权重**整份拷贝**成快照（`tplId` / `tplVersion` 一起记），
 * 之后模板改条目、运营管理部改权重都不回写历史 —— 否则调一次权重，已归档的分数会跟着变。
 *
 * 本期不做：绩效工资折算（PLAN_PERF_RESERVE 留了口径）。
 * ================================================================== */

export const PLAN_STATUS = ['草稿', '审批中', '已批准', '已驳回', '执行中', '待复评', '已结案']
export const PLAN_TASK_STATUS = ['未开始', '进行中', '已完成', '延期']

/** 算分常量。改这里就是改全系统的口径，不要在各页面另抄一份 */
export const PLAN_SCORE_RULE = {
  rejectRate: 0.95,
  challengeRate: 1.05,
  min: 1,
  max: 5,
  selfWeight: 0.2,
  reviewWeight: 0.8,
  note: '否决 = 目标 × 95%（逆向 ×105%）；挑战 = 目标 × 105%（逆向 ×95%）；'
    + '自评 = 5 ×（实际 − 否决）/（挑战 − 否决），夹在 1–5；'
    + '月度总得分 = 自评加权合计 × 20% + 复评加权合计 × 80%'
}

/** 评分档位（5 分制）。总分满分是 5，不是 100 —— 别拿百分制的阈值套 */
export const PLAN_GRADE_RULE = [
  { grade: 'A', min: 4.5, label: '优秀' },
  { grade: 'B', min: 3.75, label: '良好' },
  { grade: 'C', min: 3.0, label: '合格' },
  { grade: 'D', min: 0, label: '待改进' }
]

export const PLAN_PERF_RESERVE = {
  enabled: false,
  note: '月度总得分 → 部门绩效工资系数的换算规则本期未定义；接入时在 reviewDeptPlan 写 plan.performanceFactor，'
    + '读取口只开 deptPlanSummary({ orgId, period })，不要让工资页直接读 deptPlans',
  fields: ['totalScore', 'grade', 'planMonth', 'orgId']
}

const PLAN_PERM_VIEW = 'f.plans.view'
const PLAN_PERM_EDIT = 'f.plans.edit'
const PLAN_PERM_EVAL = 'f.plans.eval'
export const canViewDeptPlans = () => _hasPerm(PLAN_PERM_VIEW)
export const canEditDeptPlans = () => _hasPerm(PLAN_PERM_EDIT)
export const canEvalDeptPlans = () => _hasPerm(PLAN_PERM_EVAL)

const _ORG_RANK = { 项目: 0, 部门: 1, 班组: 2, 集团: 3 }

/** 沿组织树向上找所属项目（班组 → 项目部） */
function _projectOfOrg(orgId) {
  let cur = ORG_OF.get(orgId)
  for (let i = 0; cur && i < 8; i++) {
    if (cur.type === '项目') return cur.orgId
    cur = cur.parentId ? ORG_OF.get(cur.parentId) : null
  }
  return ''
}

/** 组织下在职人数（含下级，与组织页同口径） */
function _headcountOf(orgId) {
  const ids = descOf(orgId)
  return ids ? EMP_ROWS.filter(e => ids.has(e.orgId) && e.status !== '离职').length : 0
}

/** 某组织在某月是否已有计划（同月唯一；已驳回的可以重提，故排除） */
function _planOfMonth(planMonth, orgId) {
  return DEPT_PLANS.find(p => p.planMonth === planMonth && p.orgId === orgId && p.status !== '已驳回') || null
}

/**
 * 当前"我"是谁 + 我负责哪几个部门。
 * 计划页所有"我能干什么"的判断都从这里出，不从角色名反推 ——
 * 一人多部门时，角色名反推不出"这次提报哪个部门"。
 */
export function planIdentity() {
  const me = currentOperator()
  const leads = leadsOf(me.empId)
  return {
    empId: me.empId, name: me.name, position: me.position, level: me.level,
    orgId: me.orgId, orgName: me.orgName, roleName: me.roleName,
    leads, leadCount: leads.length
  }
}

/* ---------------- 算分（唯一口径，页面不许自己再算一遍） ---------------- */

const _plan2 = n => Math.round((Number(n) || 0) * 100) / 100

/** 目标值 → 否决值 / 挑战值。逆向指标镜像：成本越低越好，所以挑战比目标低 */
export function planTargetOf(item = {}) {
  const t = Number(item.target)
  const dir = item.direction === -1 ? -1 : 1
  if (!Number.isFinite(t) || t <= 0) return { reject: null, challenge: null, usable: false }
  return {
    reject: _plan2(dir > 0 ? t * PLAN_SCORE_RULE.rejectRate : t * PLAN_SCORE_RULE.challengeRate),
    challenge: _plan2(dir > 0 ? t * PLAN_SCORE_RULE.challengeRate : t * PLAN_SCORE_RULE.rejectRate),
    usable: true
  }
}

/**
 * 自评分。量化项由公式算，重点项人工填，监控项不参与。
 *
 * 下限夹 1 分是个刻意的选择：公式在否决值处算出 0，而规则说"低于否决值记 1 分"，
 * 不夹的话会出现「完成 96 元比 95 元得分更低」的反转。
 */
export function planSelfScoreOf(item = {}) {
  if (item.section !== 'q') return Number(item.selfScore) || 0
  const { reject, challenge, usable } = planTargetOf(item)
  if (!usable) return Number(item.selfScore) || 0          /* 零目标：人工打分 */
  const a = Number(item.actual)
  if (item.actual === '' || item.actual === null || !Number.isFinite(a)) return 0
  const den = Math.abs(challenge - reject)
  if (!den) return 0
  const num = item.direction === -1 ? (reject - a) : (a - reject)
  return Math.min(PLAN_SCORE_RULE.max, Math.max(PLAN_SCORE_RULE.min, 5 * num / den))
}

/** 加权分 = 分数 × 权重/100（权重是百分数：10 表示 10%） */
const _weightedOf = (score, weight) => _plan2((Number(score) || 0) * (Number(weight) || 0) / 100)

/**
 * 一条考核项的四个派生值 + 加权。
 * 监控项没有分数，直接用手填的负数扣分（本期不做封顶校验，模板里只存文字规则）。
 */
export function planItemCalc(item = {}) {
  if (item.section === 'm') {
    return {
      selfScore: null,
      reviewScore: null,
      selfWeighted: _plan2(item.selfWeighted),
      reviewWeighted: _plan2(item.reviewWeighted)
    }
  }
  const self = planSelfScoreOf(item)
  const review = Number(item.reviewScore) || 0
  return {
    selfScore: _plan2(self),
    reviewScore: review ? _plan2(review) : null,
    selfWeighted: _weightedOf(self, item.weight),
    reviewWeighted: review ? _weightedOf(review, item.weight) : 0
  }
}

/** 合计：自评 / 复评 / 总分（20/80 合成） */
export function planTotalsOf(items = []) {
  let self = 0
  let review = 0
  for (const it of items) {
    const c = planItemCalc(it)
    self += c.selfWeighted
    review += c.reviewWeighted
  }
  self = _plan2(self)
  review = _plan2(review)
  return {
    selfTotal: self,
    reviewTotal: review,
    total: _plan2(self * PLAN_SCORE_RULE.selfWeight + review * PLAN_SCORE_RULE.reviewWeight)
  }
}

export function planGradeOf(score) {
  const hit = PLAN_GRADE_RULE.find(g => Number(score) >= g.min)
  return hit ? hit.grade : ''
}

/**
 * 权重校验。**两条规则**（2026-11-05 第 60 批）：
 *   ① 每一项必须是 5 的倍数（业务上只按 5% 调，见 PLAN_WEIGHT_STEP）；
 *   ② 各项合计正好 100%（监控项恒 0，不占权重）。
 *
 * 为什么把 5 的倍数放在合计前面报：两项都错时（比如 12 + 12 + 81 = 105），
 * 先说"合计 105%"会让人去调数字，而真正该先做的是把 12 改成 10 或 15 ——
 * 顺序反了会让人改两轮。
 *
 * 以前是两级：段内合计 = 段权重，且两段合计 100。第 60 批把权重从模板搬到计划后，
 * 段权重这个中间层没有存在意义了 —— 提报人只面对"一共 100 分怎么分给这些条目"。
 *
 * 大于 100 和小于 100 都要给出**具体差多少**：只说"必须是 100%"，
 * 填了 12 项的人得自己一项项加。
 */
export function planWeightCheck(items = []) {
  const sumOf = k => _plan2(items.filter(i => i.section === k).reduce((s, i) => s + (Number(i.weight) || 0), 0))
  const qs = sumOf('q')
  const ks = sumOf('k')
  const ms = sumOf('m')
  const total = _plan2(qs + ks)
  const diff = _plan2(100 - total)
  const scorable = items.filter(i => i.section === 'q' || i.section === 'k')

  const errs = []
  if (ms !== 0) errs.push('监控指标的权重必须为 0（只扣分不占权重）')

  const offStep = scorable.filter(i => !planWeightOnStep(i.weight))
  if (offStep.length) {
    const names = offStep.slice(0, 3).map(i => `「${i.name}」${i.weight}%`).join('、')
    errs.push(`${names}${offStep.length > 3 ? ` 等 ${offStep.length} 项` : ''}不是 ${PLAN_WEIGHT_STEP} 的倍数，权重只能按 ${PLAN_WEIGHT_STEP}% 调`)
  }

  if (!scorable.length) {
    errs.push('至少要有一条量化指标或重点工作，否则没有可计分的内容')
  } else if (Math.abs(diff) > 0.01) {
    errs.push(diff > 0
      ? `各项权重合计 ${total}%，还差 ${diff}% 才到 100%`
      : `各项权重合计 ${total}%，超出 ${_plan2(-diff)}%（必须正好 100%）`)
  }

  /* 每项至少 5%，100% 最多只能分给 20 项。超过就是模板条目太多 ——
     这时候"平均分配"必然有人拿 0，0 权重的考核项等于没考，所以要在这里说清楚 */
  const maxItems = Math.round(PLAN_WEIGHT_TOTAL / PLAN_WEIGHT_STEP)
  if (scorable.length > maxItems) {
    errs.push(`计分项共 ${scorable.length} 条，每项至少 ${PLAN_WEIGHT_STEP}%，最多只能有 ${maxItems} 条（先在模板里合并或删减）`)
  }

  return { qs, ks, ms, total, diff, ok: errs.length === 0, msg: errs.join('；') }
}

/* ---------------- 数据与种子 ---------------- */
const DEPT_PLANS = []
let DEPT_PLAN_SEQ = 0

function _planIdOf(month) {
  DEPT_PLAN_SEQ += 1
  return 'PL' + String(month).replace('-', '') + String(DEPT_PLAN_SEQ).padStart(3, '0')
}

const _PLAN_MONTH = TODAY.slice(0, 7)
const _PLAN_MONTH_PREV = _monthAdd(_PLAN_MONTH, -1)

/** 该月最后一天（计划完成时间默认落月底） */
function _planMonthEnd(month) {
  const [y, m] = String(month).split('-').map(Number)
  const d = new Date(y, m, 0)
  return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function _monthAdd(month, n) {
  const [y, m] = String(month).split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 任务执行状态：由实际完成与完成时间派生，不让用户手选 */
function _taskStatusOf(t) {
  if (t.actual !== '' && t.actual !== null && t.actual !== undefined) return '已完成'
  if (t.selfScore) return '进行中'
  if (t.dueDate && t.dueDate < TODAY) return '延期'
  return '未开始'
}

/** 权重总额。改这里等于改全系统的口径（目前只有这一处需要改） */
export const PLAN_WEIGHT_TOTAL = 100

/**
 * 权重的调整步长：**只能按 5% 调**（2026-11-05 用户补充的口径）。
 *
 * 为什么不是 1%：实际调权重时没人会填 37%，业务上的判断是"这项给 10 还是 15"。
 * 允许 1% 只会让合计凑不齐（99 / 101）变成常态，然后所有人都去找那 1%。
 *
 * 这条规则有三处连锁影响，改步长时三处一起改：
 *   ① `planEvenWeights` 按 5% 为单位分配，不能出 11%/12% 这种预填值；
 *   ② `planWeightCheck` 拦非 5 的倍数（提交审核与审核下发都拦）；
 *   ③ 页面输入框 `step=5 + step-strictly`，手输 12 会自己归到 10 / 15。
 */
export const PLAN_WEIGHT_STEP = 5

/** 权重是不是步长的整数倍（用除法容差判断，避免 15/5=2.9999 这种浮点坑） */
export const planWeightOnStep = n => {
  const v = Number(n)
  if (!Number.isFinite(v)) return false
  return Math.abs(v / PLAN_WEIGHT_STEP - Math.round(v / PLAN_WEIGHT_STEP)) < 1e-9
}

/**
 * 把 100% 平均分给所有计分项（量化 + 重点），监控项置 0。
 *
 * 用途只有两个：模板铺开时给一个**能直接提交的起点**、页面上的「平均分配」按钮。
 * 为什么要有起点：11 个条目从 0 开始填，填到第 8 项才发现加起来 93%，
 * 得回头一个个改；给个 100% 的平均值，改的是"谁该多一点"而不是"怎么凑够 100"。
 *
 * **按 5% 为单位分配**（100/5 = 20 份）：先给每项 floor(20/n) 份，余下的份数给前面几项。
 * 所以 9 项得到 15/15/10/10…，不会出现 11%/12% —— 那种预填值本身就不合规，
 * 一打开表单就红着，比不预填更让人困惑。
 */
export function planEvenWeights(items = []) {
  const rows = items.filter(i => i.section === 'q' || i.section === 'k')
  for (const it of items) {
    if (it.section === 'm') it.weight = 0
  }
  if (!rows.length) return items
  const units = Math.round(PLAN_WEIGHT_TOTAL / PLAN_WEIGHT_STEP)
  const base = Math.floor(units / rows.length)
  let rest = units - base * rows.length
  for (const it of rows) {
    const u = base + (rest > 0 ? 1 : 0)
    if (rest > 0) rest -= 1
    it.weight = u * PLAN_WEIGHT_STEP
  }
  return items
}

/**
 * 按模板铺开成计划条目。**整份拷贝**：模板之后怎么改都不影响这一份。
 * 量化项带目标值默认值，填报人可以改；监控和重点不给目标值。
 * 权重由 `planEvenWeights` 平均预填，提报人再按本月重点调整。
 */
export function planItemsFromTpl(tpl, dueDate) {
  if (!tpl) return []
  const items = tpl.items.filter(i => i.enabled !== false).map((it, i) => ({
    taskId: '',
    itemId: it.itemId,
    section: it.section,
    name: it.name,
    content: '',
    standard: it.standard || '',
    weight: 0,
    direction: it.direction === -1 ? -1 : 1,
    unit: it.unit || '',
    target: it.section === 'q' && it.targetDefault !== '' ? Number(it.targetDefault) : '',
    dueDate,
    files: [],
    actual: '',
    actualNote: '',
    selfScore: null,
    selfWeighted: it.section === 'm' ? 0 : null,
    reviewScore: null,
    reviewWeighted: it.section === 'm' ? 0 : null,
    remark: '',
    progress: 0,
    execStatus: '未开始',
    finishAt: '',
    score: 0,
    evalRemark: '',
    _i: i
  }))
  return planEvenWeights(items)
}

/** 表单"套用模板"用：返回这一版模板铺开的条目（深拷贝） */
export const deptPlanTaskTpl = (orgId, planMonth) => {
  const tpl = planTplForOrg(orgId || '')
  return planItemsFromTpl(tpl, _planMonthEnd(planMonth || _PLAN_MONTH))
}

/**
 * 提报页需要的：模板 + 铺开的条目。
 * `forceTplId` 是运营管理部在提报页手工换的模板 —— 不传就按组织自动匹配。
 * 之前这个参数没有，页面换了模板却还是按组织匹配的条目，等于下拉框是摆设。
 */
export function planTplBundle(orgId, planMonth, forceTplId = '') {
  const forced = forceTplId ? PLAN_TPLS.find(t => t.tplId === forceTplId && t.enabled) : null
  const tpl = forced || planTplForOrg(orgId || '')
  return {
    tpl: tpl ? { tplId: tpl.tplId, name: tpl.name, version: tpl.version } : null,
    items: planItemsFromTpl(tpl, _planMonthEnd(planMonth || _PLAN_MONTH))
  }
}

/**
 * 重点工作项的「计划内容」与「实际完成」文案池（种子用）。
 *
 * 为什么必须填：这两项以前是空的，种子里只给了 selfScore。结果一份**已结案**的计划
 * 在详情页上，重点工作段只有名称和分数、看不到做了什么 —— 评审时被问
 * 「这项凭什么打 4 分」就答不出来，和「量化段缺复评加权」是同一类问题：有分没依据。
 */
const PLAN_K_PLAN = [
  n => `制定「${n}」月度推进表，明确责任人与完成节点`,
  n => `按周跟踪「${n}」进展，月中复盘一次偏差`,
  n => `梳理「${n}」现状问题，形成整改清单并逐项闭环`,
  n => `组织「${n}」相关岗位对齐口径，输出统一执行模板`,
  n => `对「${n}」开展一次专项检查，问题当场交办到人`,
  n => `结合上月问题清单，对「${n}」做一轮回头看`,
  n => `编制「${n}」操作指引，完成一次岗位培训`
]
const PLAN_K_DONE = [
  n => `已完成，推进表下发到 4 个班组，按周跟踪无遗漏`,
  n => `已完成，月中复盘发现 2 处偏差，已调整后续安排`,
  n => `已完成，整改清单 6 项全部闭环，无遗留`,
  n => `已完成，模板已下发各班组统一使用`,
  n => `已完成，检查发现 3 个问题，当日交办并整改完毕`,
  n => `已完成，上月 5 个问题复核通过，新增 1 项纳入下月`,
  n => `已完成，指引已上墙，培训覆盖 12 人并签到留档`
]

/**
 * 造一份计划。仅种子使用 —— 运行时一律走 saveDeptPlan / submitDeptPlan。
 * `q` 是完成质量系数：1.0 达标、1.15 超额、0.8 有缺口。
 */
function _seedPlan(spec) {
  const { planMonth, orgId, status, day, q = 1, review = 0, rejectNote = '' } = spec
  const planId = _planIdOf(planMonth)
  const lead = orgLeaderOf(orgId)
  const emp = employees.find(e => e.empId === lead.empId) || employees[0]
  const dueDate = _planMonthEnd(planMonth)
  const tpl = planTplForOrg(orgId)
  const items = planItemsFromTpl(tpl, dueDate)
  /* 种子也要补 taskId：留空的话所有条目 key 都是 ''，页面按 taskId 取派生值会串行 */
  items.forEach((it, i) => { it.taskId = `${planId}-I${String(i + 1).padStart(2, '0')}` })

  const filled = ['执行中', '待复评', '已结案'].includes(status)
  const partial = false

  items.forEach((it, i) => {
    const noise = 1 + ((i % 5) - 2) * 0.03
    const k = q * noise
    /* 重点工作：计划内容提报时就该写（草稿也有），实际完成要等执行后才填 */
    if (it.section === 'k') {
      it.content = PLAN_K_PLAN[i % PLAN_K_PLAN.length](it.name)
      if (filled) it.actual = PLAN_K_DONE[i % PLAN_K_DONE.length](it.name)
    }
    if (filled || (partial && i % 2 === 0)) {
      if (it.section === 'q') {
        const t = Number(it.target)
        if (Number.isFinite(t) && t > 0) {
          const ratio = it.direction === -1 ? (2 - k) : k
          it.actual = _plan2(t * Math.max(0.7, ratio))
        } else {
          it.selfScore = Math.min(5, Math.max(1, _plan2(5 * k)))
        }
      } else if (it.section === 'k') {
        it.selfScore = Math.min(5, Math.max(1, _plan2(5 * k)))
      } else if (it.section === 'm') {
        it.actual = i % 4 === 0 ? '发生 1 起' : '无'
        it.selfWeighted = i % 4 === 0 ? -0.05 : 0
        /* 复评扣分只在复评之后才有 —— 没复评就显示 -0.05 会让人以为已经评过了 */
        it.reviewWeighted = status === '已结案' && i % 4 === 0 ? -0.05 : 0
      }
    }
  })

  if (status === '已结案') {
    items.forEach((it, i) => {
      if (it.section === 'm') {
        it.reviewWeighted = it.selfWeighted
      } else {
        const base = Number(it.selfScore) || (planItemCalc(it).selfScore || 0)
        it.reviewScore = Math.min(5, Math.max(1, _plan2(base + review + ((i % 3) - 1) * 0.1)))
      }
      it.execStatus = '已完成'
      it.progress = 100
      it.finishAt = `${planMonth}-${String(Math.min(day + 5 + i, 28)).padStart(2, '0')}`
    })
  } else if (filled) {
    items.forEach(it => { it.execStatus = _taskStatusOf(it) })
  }

  /* 草稿刻意演示一次「没凑够 100%」：列表上显示 ⚠ 并写明差多少，
     打开后提交按钮是禁用的。提报中的计划必须闭合，所以只有草稿能出现 95%。 */
  if (spec.weightShort) {
    const last = [...items].reverse().find(i => i.section === 'k')
    if (last) last.weight = _plan2(Math.max(0, last.weight - spec.weightShort))
  }

  const wc = planWeightCheck(items)
  const totals = planTotalsOf(items)
  const submittedAt = `${planMonth}-${String(day).padStart(2, '0')} 09:20`

  const plan = {
    planId,
    planMonth,
    orgId,
    orgName: orgNameOf(orgId),
    orgPath: orgPathOf(orgId),
    orgType: ORG_OF.get(orgId)?.type || '',
    projectId: _projectOfOrg(orgId),
    headcount: _headcountOf(orgId),
    tplId: tpl?.tplId || '',
    tplName: tpl?.name || '',
    tplVersion: tpl?.version || 0,
    submitterEmpId: emp.empId,
    submitterName: emp.name,
    submitterPosition: emp.position,
    submitterDuty: (ORG_LEADERS.find(r => r.orgId === orgId && r.empId === emp.empId && _relActive(r)) || {}).duty || '正职',
    submitterOrgId: emp.orgId,
    submitterOrgName: orgNameOf(emp.orgId),
    submitAt: submittedAt,
    status,
    oaId: '',
    approveAt: '',
    approveBy: '',
    approveNote: status === '已驳回' ? rejectNote : '',
    reviseLog: [],
    items,
    weightTotal: wc.total,
    weightOk: wc.ok,
    finishRate: 0,
    selfTotal: totals.selfTotal,
    reviewTotal: totals.reviewTotal,
    totalScore: status === '已结案' ? totals.total : 0,
    score: status === '已结案' ? totals.total : 0,
    grade: status === '已结案' ? planGradeOf(totals.total) : '',
    evalAt: '',
    evalBy: '',
    summary: '',
    logs: [{ at: submittedAt, by: emp.name, action: '提报计划', note: `以${orgNameOf(orgId)}负责人身份提报（模板 ${tpl?.name || '—'}）` }]
  }
  plan.finishRate = _finishRateOf(plan)
  if (status === '已结案') {
    plan.evalAt = `${_monthAdd(planMonth, 1)}-05 16:30`
    plan.evalBy = orgLeaderOf('O-QS').name
    plan.logs.push({ at: plan.evalAt, by: plan.evalBy, action: '复评完成', note: `总得分 ${plan.totalScore}（${plan.grade}）` })
  }
  if (status === '已驳回') {
    plan.approveAt = `${planMonth}-${String(Math.min(day + 2, 28)).padStart(2, '0')} 11:05`
    plan.approveBy = orgLeaderOf(_projectOfOrg(orgId) || 'O-ROOT').name
    plan.logs.push({ at: plan.approveAt, by: plan.approveBy, action: '审批驳回', note: rejectNote })
  }
  if (['已批准', '执行中', '待复评', '已结案'].includes(status)) {
    plan.approveAt = `${planMonth}-${String(Math.min(day + 1, 28)).padStart(2, '0')} 15:40`
    plan.approveBy = orgLeaderOf('O-QS').name
    plan.logs.push({ at: plan.approveAt, by: plan.approveBy, action: '审核通过', note: '同意执行' })
  }
  DEPT_PLANS.push(plan)
  if (status === '审批中') _seedPlanApproval(plan, submittedAt)
  return plan
}

/** 种子审批单：与 createOaRequest 同结构，节点按流程定义解析（含自审跳升） */
function _seedPlanApproval(plan, submittedAt) {
  const nodes = oaNodesFor('计划审批', 0)
  const emp = employees.find(e => e.empId === plan.submitterEmpId)
  const applicant = {
    empId: emp.empId, name: emp.name, position: emp.position, level: emp.level,
    orgId: plan.orgId, orgName: plan.orgName, manager: emp.manager || '', roleName: currentRoleName.value
  }
  APPROVAL_SEQ += 1
  const ap = {
    approvalId: 'AP' + String(APPROVAL_SEQ).padStart(5, '0'),
    approvalNo: 'SP-' + String(TODAY).slice(0, 4) + '-' + String(APPROVAL_SEQ).padStart(4, '0'),
    bizType: '计划审批',
    bizId: plan.planId,
    changeId: '',
    title: `计划审批 · ${plan.orgName} ${Number(plan.planMonth.slice(5))} 月工作计划（${plan.items.length} 项）`,
    formData: {
      planMonth: plan.planMonth, orgName: plan.orgName,
      taskCount: plan.items.length, weightTotal: plan.weightTotal
    },
    files: [],
    communityId: plan.projectId ? plan.projectId.replace('O-', '') : '',
    communityName: plan.projectId ? communityName(plan.projectId.replace('O-', '')) : '集团 / 全项目',
    amount: 0,
    applicant: emp.name,
    applicantRole: emp.position,
    applicantEmpId: emp.empId,
    applicantOrgId: emp.orgId,
    applicantOrgName: orgNameOf(emp.orgId),
    scopeOrgId: plan.orgId,
    scopeOrgName: plan.orgName,
    applyTime: submittedAt,
    status: '审批中',
    currentNode: nodes[1]?.name || '运营管理部复核',
    urgency: '普通',
    waitHours: 6,
    flow: nodes.map((n, i) => {
      const s = _skipSelf(_resolveAssignee(n, applicant), applicant)
      return i === 0
        ? {
            node: n.name, handler: s.name, action: '同意', time: submittedAt,
            comment: '任务与权重无异议，同意执行', limitHours: n.limitHours, skipNote: s.note
          }
        : { node: n.name, handler: s.name, action: '待处理', time: '', comment: '', limitHours: n.limitHours, skipNote: s.note }
    }),
    _isNew: true
  }
  approvals.unshift(ap)
  plan.oaId = ap.approvalId
  plan.logs.push({ at: submittedAt, by: emp.name, action: '提交审批', note: ap.approvalNo })
}

/* 种子：覆盖 7 种状态 + 上月归档供统计对比 */
const _SEED_SPECS = [
  { planMonth: _PLAN_MONTH, orgId: 'O-P01', status: '审批中', day: 3, q: 1 },
  { planMonth: _PLAN_MONTH, orgId: 'O-P02', status: '执行中', day: 4, q: 0.95 },
  { planMonth: _PLAN_MONTH, orgId: 'O-P03', status: '已批准', day: 6, q: 1 },
  { planMonth: _PLAN_MONTH, orgId: 'O-P01-T2', status: '执行中', day: 2, q: 1.1 },
  { planMonth: _PLAN_MONTH, orgId: 'O-P02-T4', status: '草稿', day: 8, q: 1, weightShort: 5 },
  { planMonth: _PLAN_MONTH, orgId: 'O-P01-T1', status: '执行中', day: 5, q: 1.02 },
  { planMonth: _PLAN_MONTH, orgId: 'O-P01-T3', status: '待复评', day: 2, q: 1.05 },
  {
    planMonth: _PLAN_MONTH, orgId: 'O-P03-T1', status: '已驳回', day: 3, q: 1,
    rejectNote: '量化指标目标值低于去年同期，请按实际应收重新核定后重报'
  },
  { planMonth: _PLAN_MONTH, orgId: 'O-QS', status: '已结案', day: 1, q: 1.05, review: 0 },
  { planMonth: _PLAN_MONTH_PREV, orgId: 'O-P01', status: '已结案', day: 2, q: 1, review: -0.1 },
  { planMonth: _PLAN_MONTH_PREV, orgId: 'O-P02', status: '已结案', day: 3, q: 1.08, review: 0 },
  { planMonth: _PLAN_MONTH_PREV, orgId: 'O-P03', status: '已结案', day: 3, q: 0.88, review: -0.2 },
  { planMonth: _PLAN_MONTH_PREV, orgId: 'O-P01-T2', status: '已结案', day: 2, q: 0.95, review: -0.05 },
  { planMonth: _PLAN_MONTH_PREV, orgId: 'O-P01-T3', status: '已结案', day: 4, q: 1.02, review: 0 },
  { planMonth: _PLAN_MONTH_PREV, orgId: 'O-P02-T4', status: '已结案', day: 5, q: 1.04, review: 0 },
  { planMonth: _PLAN_MONTH_PREV, orgId: 'O-P03-T1', status: '已结案', day: 5, q: 0.82, review: -0.3 },
  { planMonth: _PLAN_MONTH_PREV, orgId: 'O-QS', status: '已结案', day: 1, q: 1.1, review: 0 }
]
_SEED_SPECS.forEach(_seedPlan)

/** 审批结果回写计划状态：与合同审批同一套（approvalAction 末尾调用），不做双向写 */
function _applyPlanApproval(a, action) {
  if (a.bizType !== '计划审批' || !a.bizId) return
  const p = DEPT_PLANS.find(x => x.planId === a.bizId)
  if (!p || p.status !== '审批中') return
  const last = a.flow[a.flow.length - 1]
  if (a.status === '已通过') {
    p.status = '已批准'
    p.approveAt = _now()
    p.approveBy = last?.handler || currentOperator().name
    p.approveNote = ''
    p.logs.push({ at: p.approveAt, by: p.approveBy, action: '审核通过', note: '全部节点同意，计划进入执行' })
  } else if (action === '驳回') {
    p.status = '已驳回'
    p.approveAt = _now()
    p.approveBy = last?.handler || currentOperator().name
    p.approveNote = last?.comment || '审批驳回'
    p.logs.push({ at: p.approveAt, by: p.approveBy, action: '审批驳回', note: p.approveNote })
  }
}

/* ---------------- 读 ---------------- */

/**
 * 完成率：按自评加权分折算（合计满分 5 分），不是任务条数占比。
 * 监控项是负数扣分，不参与完成率。
 */
function _finishRateOf(plan) {
  const items = plan.items || []
  const scored = items.filter(i => i.section !== 'm')
  if (!scored.length) return 0
  const sum = scored.reduce((s, i) => s + planItemCalc(i).selfWeighted, 0)
  return Math.round(Math.min(100, sum / 5 * 100) * 10) / 10
}

/**
 * 派生一行。分数、合计、完成率每次都重算，不落库 ——
 * 落库就会出现"改了实际值、分数没变"。
 * `myOrgIds` 传进来才算 `mine`：总经理能看全部计划，但不能替所有部门改。
 */
function _planRowOf(p, myOrgIds = null) {
  const items = (p.items || []).map(it => ({
    ...it,
    execStatus: _taskStatusOf(it),
    ...planItemCalc(it)
  }))
  const wc = planWeightCheck(items)
  const totals = planTotalsOf(items)
  const mine = myOrgIds ? myOrgIds.has(p.orgId) : true
  const editable = ['草稿', '已驳回'].includes(p.status)
  const running = ['已批准', '执行中'].includes(p.status)
  const done = p.status === '已结案'
  return {
    ...p,
    mine,
    items,
    tasks: items,
    weightTotal: wc.total,
    weightQs: wc.qs,
    weightKs: wc.ks,
    weightDiff: wc.diff,
    weightOk: wc.ok,
    weightMsg: wc.msg,
    finishRate: _finishRateOf({ ...p, items }),
    doneCount: items.filter(t => t.execStatus === '已完成').length,
    lateCount: items.filter(t => t.execStatus === '延期').length,
    taskCount: items.length,
    itemCount: items.length,
    qCount: items.filter(t => t.section === 'q').length,
    kCount: items.filter(t => t.section === 'k').length,
    mCount: items.filter(t => t.section === 'm').length,
    selfTotal: totals.selfTotal,
    reviewTotal: totals.reviewTotal,
    totalScore: done ? totals.total : 0,
    score: done ? totals.total : 0,
    grade: done ? planGradeOf(totals.total) : '',
    canEdit: editable && mine,
    canSubmit: editable && mine,
    canProgress: running,
    canResult: running,
    canReview: p.status === '待复评',
    canClose: running,
    canWithdraw: p.status === '审批中' && mine
  }
}

/** 当前人负责的组织 id 集合（列表 / 详情共用，避免逐行重复算 leadsOf） */
function _myOrgIds() {
  return new Set(leadsOf(currentOperator().empId).map(l => l.orgId))
}

export function deptPlanRows({ planMonth = '', orgId = '', projectId = '', status = '', kw = '' } = {}) {
  const mineIds = _myOrgIds()
  return DEPT_PLANS
    .filter(p => !planMonth || p.planMonth === planMonth)
    .filter(p => !orgId || p.orgId === orgId)
    .filter(p => !projectId || p.projectId === projectId)
    .filter(p => !status || p.status === status)
    .filter(p => !kw || `${p.orgName}${p.submitterName}${p.planId}${(p.items || []).map(t => t.name).join('')}`.includes(kw))
    .map(p => _planRowOf(p, mineIds))
    .sort((a, b) => (a.planMonth === b.planMonth ? a.orgPath.localeCompare(b.orgPath) : b.planMonth.localeCompare(a.planMonth)))
}

export function getDeptPlan(planId) {
  const p = DEPT_PLANS.find(x => x.planId === planId)
  if (!p) return null
  const row = _planRowOf(p, _myOrgIds())
  const ap = p.oaId ? approvals.find(a => a.approvalId === p.oaId) || null : null
  return {
    ...row,
    approval: ap,
    reviseLog: [...(p.reviseLog || [])].sort((a, b) => String(b.at).localeCompare(String(a.at))),
    logs: [...(p.logs || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)))
  }
}

/** 可选的计划月份：前 2 个月 ~ 下 1 个月 */
export const planMonthOpts = () => {
  const out = []
  for (let i = -2; i <= 1; i++) out.push(_monthAdd(_PLAN_MONTH, i))
  return out.sort((a, b) => b.localeCompare(a))
}

export const planProjectOpts = () =>
  orgs.filter(o => o.type === '项目').map(o => ({ id: o.orgId, name: o.name }))

export const planCurrentMonth = () => _PLAN_MONTH

/** 该部门本月是否已有计划（提报表单打开时先查，避免填完才发现重复） */
export function planOfMonth(planMonth, orgId) {
  const p = _planOfMonth(planMonth, orgId)
  return p ? _planRowOf(p) : null
}

/* ---------------- 写 ---------------- */

const _planError = (msg, code) => Object.assign(new Error(msg), { code })

function _cleanItems(items = []) {
  return items.map((t, i) => ({
    taskId: t.taskId || '',
    itemId: t.itemId || '',
    section: ['q', 'm', 'k'].includes(t.section) ? t.section : 'k',
    name: String(t.name || '').trim(),
    content: String(t.content || '').trim(),
    standard: String(t.standard || '').trim(),
    /* 权重夹在 0–100：负数会让加权分为负，而校验只比合计，负数能靠加总凑过去 */
    weight: Math.min(100, Math.max(0, _plan2(t.weight))),
    direction: t.direction === -1 ? -1 : 1,
    unit: String(t.unit || '').trim(),
    target: t.target === '' || t.target === undefined || t.target === null ? '' : Number(t.target),
    dueDate: String(t.dueDate || '').slice(0, 10),
    files: Array.isArray(t.files) ? [...t.files] : [],
    actual: t.actual === undefined || t.actual === null ? '' : t.actual,
    actualNote: String(t.actualNote || '').trim(),
    selfScore: t.selfScore === null || t.selfScore === undefined || t.selfScore === '' ? null : Number(t.selfScore),
    selfWeighted: _plan2(t.selfWeighted),
    reviewScore: t.reviewScore === null || t.reviewScore === undefined || t.reviewScore === '' ? null : Number(t.reviewScore),
    reviewWeighted: _plan2(t.reviewWeighted),
    remark: String(t.remark || '').trim(),
    progress: Math.min(100, Math.max(0, Number(t.progress) || 0)),
    execStatus: '未开始',
    finishAt: t.finishAt || '',
    score: 0,
    evalRemark: '',
    _i: i
  }))
}

/**
 * 保存计划（新建或改草稿）。
 * **草稿不强制权重闭合**：写到一半就存是正常动作；提报时才卡。
 */
export function saveDeptPlan(payload = {}, planId = '') {
  const me = currentOperator()
  if (!canEditDeptPlans()) throw _planError('当前角色没有计划维护权限（f.plans.edit）', 403)
  const planMonth = String(payload.planMonth || '').trim()
  if (!/^\d{4}-\d{2}$/.test(planMonth)) throw _planError('请选择计划月份', 42211)
  const orgId = String(payload.orgId || '').trim()
  if (!orgId) throw _planError('请选择提报部门', 42211)
  if (!leadsOf(me.empId).some(l => l.orgId === orgId)) {
    throw _planError('你不是该部门的负责人，不能以它的名义提报计划', 403)
  }
  const items = _cleanItems(payload.items || payload.tasks)
  if (!items.length) throw _planError('计划至少要有 1 条考核项', 42211)
  if (items.some(t => !t.name)) throw _planError('考核项名称不能为空', 42211)

  const dup = _planOfMonth(planMonth, orgId)
  if (dup && dup.planId !== planId) {
    throw _planError(`「${orgNameOf(orgId)}」${planMonth} 已有计划（${dup.planId}），一个部门一个月只能有一份`, 40925)
  }

  const tpl = planTplForOrg(orgId)
  const lead = leadsOf(me.empId).find(l => l.orgId === orgId)
  const base = {
    planMonth,
    orgId,
    orgName: orgNameOf(orgId),
    orgPath: orgPathOf(orgId),
    orgType: ORG_OF.get(orgId)?.type || '',
    projectId: _projectOfOrg(orgId),
    headcount: _headcountOf(orgId),
    tplId: payload.tplId || tpl?.tplId || '',
    tplName: payload.tplName || tpl?.name || '',
    tplVersion: payload.tplVersion || tpl?.version || 0,
    submitterDuty: lead?.duty || '正职',
    submitterOrgId: me.orgId,
    submitterOrgName: orgNameOf(me.orgId),
    summary: String(payload.summary || '').trim()
  }

  if (planId) {
    const p = DEPT_PLANS.find(x => x.planId === planId)
    if (!p) throw _planError('计划不存在', 40401)
    if (!['草稿', '已驳回'].includes(p.status)) {
      throw _planError(`计划已「${p.status}」，不能再改考核项（已批准的内容不能被事后修改）`, 40926)
    }
    const before = p.status
    const wc = planWeightCheck(items)
    Object.assign(p, base, {
      items: items.map((t, i) => ({ ...t, taskId: t.taskId || `${p.planId}-I${String(i + 1).padStart(2, '0')}` })),
      status: '草稿',
      weightTotal: wc.total,
      weightOk: wc.ok,
      approveAt: before === '已驳回' ? '' : p.approveAt,
      approveNote: '',
      logs: [...(p.logs || []), {
        at: _now(), by: me.name, action: before === '已驳回' ? '驳回后重编' : '保存草稿',
        note: `${items.length} 项考核项 · 权重合计 ${wc.total}%`
      }]
    })
    return getDeptPlan(p.planId)
  }

  const id = _planIdOf(planMonth)
  const wc = planWeightCheck(items)
  const p = {
    planId: id,
    ...base,
    submitterEmpId: me.empId,
    submitterName: me.name,
    submitterPosition: me.position,
    submitAt: _now(),
    status: '草稿',
    oaId: '', approveAt: '', approveBy: '', approveNote: '',
    reviseLog: [],
    items: items.map((t, i) => ({ ...t, taskId: `${id}-I${String(i + 1).padStart(2, '0')}` })),
    weightTotal: wc.total,
    weightOk: wc.ok,
    finishRate: 0, selfTotal: 0, reviewTotal: 0, totalScore: 0, score: 0, grade: '',
    evalAt: '', evalBy: '',
    logs: [{ at: _now(), by: me.name, action: '创建草稿', note: `以${orgNameOf(orgId)}负责人身份 · 模板 ${tpl?.name || '—'}` }]
  }
  DEPT_PLANS.push(p)
  return getDeptPlan(id)
}

/**
 * 提报审批：卡权重闭合 + 量化项填了目标值，然后生成 OA 单。
 * 审批链按**提报部门**解析（orgScopeId），不按人事归属 ——
 * 一人管两个部门时，两个部门的项目经理不是同一个人。
 */
export function submitDeptPlan(planId, { tplId = '' } = {}) {
  const me = currentOperator()
  if (!canEditDeptPlans()) throw _planError('当前角色没有计划维护权限（f.plans.edit）', 403)
  const p = DEPT_PLANS.find(x => x.planId === planId)
  if (!p) throw _planError('计划不存在', 40401)
  if (!['草稿', '已驳回'].includes(p.status)) throw _planError(`计划已「${p.status}」，不能重复提报`, 40926)
  if (!leadsOf(me.empId).some(l => l.orgId === p.orgId)) {
    throw _planError('你不是该部门的负责人，不能替它提报', 403)
  }

  /* 运营管理部可以改选模板：页面上择换模板时会整份重铺条目，这里只对齐模板标识 */
  if (tplId && tplId !== p.tplId) {
    const tpl = PLAN_TPLS.find(t => t.tplId === tplId)
    if (!tpl) throw _planError('模板不存在', 40401)
    p.tplId = tpl.tplId
    p.tplName = tpl.name
    p.tplVersion = tpl.version
  }

  const wc = planWeightCheck(p.items)
  if (!wc.ok) throw _planError(`权重校验不通过：${wc.msg}`, 42212)
  const noTarget = p.items.filter(i => i.section === 'q' && (i.target === '' || !Number.isFinite(Number(i.target))))
  if (noTarget.length) throw _planError(`量化指标要填目标值：${noTarget.map(i => i.name).join('、')}`, 42212)
  const noDue = p.items.filter(i => !i.dueDate)
  if (noDue.length) throw _planError(`每条都要填完成时间：${noDue.map(i => i.name).join('、')}`, 42212)

  const dup = _planOfMonth(p.planMonth, p.orgId)
  if (dup && dup.planId !== planId) {
    throw _planError(`「${p.orgName}」${p.planMonth} 已有计划（${dup.planId}）在流程中`, 40925)
  }

  const ap = createOaRequest({
    bizType: '计划审批',
    bizId: p.planId,
    title: `计划审批 · ${p.orgName} ${Number(p.planMonth.slice(5))} 月工作计划（${p.items.length} 项）`,
    orgScopeId: p.orgId,
    formData: {
      planMonth: p.planMonth, orgName: p.orgName,
      taskCount: p.items.length, weightTotal: wc.total
    }
  })
  p.status = '审批中'
  p.oaId = ap.approvalId
  p.submitAt = _now()
  p.logs.push({ at: p.submitAt, by: me.name, action: '提交审批', note: ap.approvalNo })
  return { ...getDeptPlan(p.planId), approval: ap }
}

/**
 * 审核阶段运营管理部**直接改**（不走驳回再重提）。
 * 改动逐条记进 reviseLog：半年后有人问"这个月的目标为什么和申报的不一样"，
 * 得能答上来。改完调用 approvePlanToRun 直接下发。
 */
export function revisePlanItems(planId, items = []) {
  if (!canEvalDeptPlans() && !canEditDeptPlans()) {
    throw _planError('当前角色没有审核权限（f.plans.eval）', 403)
  }
  const p = DEPT_PLANS.find(x => x.planId === planId)
  if (!p) throw _planError('计划不存在', 40401)
  if (p.status !== '审批中') throw _planError(`计划「${p.status}」不在审核中，不能改`, 40926)

  const me = currentOperator()
  const before = new Map((p.items || []).map(i => [i.taskId || i.itemId, i]))
  const next = _cleanItems(items)
  const log = []

  next.forEach((it, i) => {
    const key = it.taskId || it.itemId
    const old = before.get(key)
    if (!old) {
      log.push({ field: '新增', item: it.name, before: '', after: '', at: _now(), by: me.name })
      return
    }
    if (old.name !== it.name) {
      log.push({ field: '名称', item: old.name, before: old.name, after: it.name, at: _now(), by: me.name })
    }
    if (String(old.target) !== String(it.target) && it.section === 'q') {
      log.push({ field: '目标值', item: it.name, before: old.target, after: it.target, at: _now(), by: me.name })
    }
    if (_plan2(old.weight) !== _plan2(it.weight)) {
      log.push({ field: '权重', item: it.name, before: old.weight, after: it.weight, at: _now(), by: me.name })
    }
    if ((old.standard || '') !== (it.standard || '')) {
      log.push({ field: '评价标准', item: it.name, before: old.standard, after: it.standard, at: _now(), by: me.name })
    }
    it.taskId = it.taskId || `${p.planId}-I${String(i + 1).padStart(2, '0')}`
  })
  const removed = (p.items || []).filter(o => !next.some(n => (n.taskId || n.itemId) === (o.taskId || o.itemId)))
  removed.forEach(o => log.push({ field: '删除', item: o.name, before: o.name, after: '', at: _now(), by: me.name }))

  p.items = next
  p.reviseLog = [...(p.reviseLog || []), ...log]
  p.logs.push({
    at: _now(), by: me.name, action: '审核修改',
    note: log.length ? `调整 ${log.length} 项：${log.map(l => `${l.item}·${l.field}`).join('、')}` : '无调整'
  })
  return getDeptPlan(planId)
}

/** 审核通过并下发（改完直接过，不需要再走一轮驳回） */
export function approvePlanToRun(planId, { comment = '' } = {}) {
  if (!canEvalDeptPlans()) throw _planError('当前角色没有审核权限（f.plans.eval）', 403)
  const p = DEPT_PLANS.find(x => x.planId === planId)
  if (!p) throw _planError('计划不存在', 40401)
  if (p.status !== '审批中') throw _planError(`计划「${p.status}」不在审核中`, 40926)
  const wc = planWeightCheck(p.items)
  if (!wc.ok) throw _planError(`权重校验不通过：${wc.msg}`, 42212)

  const me = currentOperator()
  p.status = '已批准'
  p.approveAt = _now()
  p.approveBy = me.name
  p.approveNote = String(comment || '').trim()
  /* 审批单一起收口，否则待办里会一直挂着 */
  if (p.oaId) {
    const ap = approvals.find(a => a.approvalId === p.oaId)
    if (ap) {
      ap.status = '已通过'
      ap.currentNode = '已完成'
      ap.flow.forEach(n => { if (n.action === '待处理') { n.action = '同意'; n.handler = n.handler || me.name; n.time = _now(); n.comment = n.comment || '审核通过' } })
    }
  }
  p.logs.push({
    at: p.approveAt, by: me.name, action: '审核通过',
    note: `按调整后下发${(p.reviseLog || []).length ? `（累计调整 ${p.reviseLog.length} 项）` : ''}${p.approveNote ? ' · ' + p.approveNote : ''}`
  })
  return getDeptPlan(planId)
}

/** 撤回：只有还没人处理时能撤，撤回后回到草稿可再改 */
export function withdrawDeptPlan(planId) {
  const p = DEPT_PLANS.find(x => x.planId === planId)
  if (!p) throw _planError('计划不存在', 40401)
  if (p.status !== '审批中' || !p.oaId) throw _planError('只有审批中的计划可以撤回', 40926)
  withdrawOaRequest(p.oaId, '提报人撤回，重新调整考核项', { allowInFlight: true })
  p.status = '草稿'
  p.logs.push({ at: _now(), by: currentOperator().name, action: '撤回', note: '退回草稿可继续编辑' })
  return getDeptPlan(planId)
}

/**
 * 执行阶段：填一条的实际完成情况。
 * 量化项填数值（自评自动算），监控项填情况说明 + 扣分，重点项填文字 + 自评 1–5。
 * 已批准 / 执行中才能动；第一次填就把状态推到「执行中」。
 */
export function savePlanProgress(planId, taskId, patch = {}) {
  const me = currentOperator()
  const p = DEPT_PLANS.find(x => x.planId === planId)
  if (!p) throw _planError('计划不存在', 40401)
  if (!['已批准', '执行中'].includes(p.status)) {
    throw _planError(`计划「${p.status}」不能填完成情况`, 40926)
  }
  const t = p.items.find(x => x.taskId === taskId)
  if (!t) throw _planError('考核项不存在', 40401)

  if (patch.actual !== undefined) t.actual = patch.actual
  if (patch.actualNote !== undefined) t.actualNote = String(patch.actualNote || '').trim()
  if (patch.selfScore !== undefined) {
    /* 量化项的目标值有效时分数由公式定，不接受手填 —— 否则自己定分 */
    const { usable } = planTargetOf(t)
    if (!(t.section === 'q' && usable)) {
      t.selfScore = patch.selfScore === '' ? null : Math.min(5, Math.max(1, Number(patch.selfScore) || 0))
    }
  }
  if (patch.selfWeighted !== undefined && t.section === 'm') t.selfWeighted = _plan2(patch.selfWeighted)
  if (patch.remark !== undefined) t.remark = String(patch.remark || '').trim()
  if (patch.files !== undefined && Array.isArray(patch.files)) t.files = [...patch.files]

  t.progress = t.actual !== '' && t.actual !== null ? 100 : 0
  t.execStatus = _taskStatusOf(t)
  if (t.execStatus === '已完成' && !t.finishAt) t.finishAt = TODAY
  if (t.execStatus !== '已完成') t.finishAt = ''

  if (p.status === '已批准') {
    p.status = '执行中'
    p.logs.push({ at: _now(), by: me.name, action: '开始执行', note: `填报「${t.name}」` })
  }
  p.finishRate = _finishRateOf(p)
  return getDeptPlan(planId)
}

/**
 * 提交完成情况 → 进入待复评。
 * **复评必须等这一步**：不提交就不给评，状态卡住比口头约定可靠。
 */
export function submitPlanResult(planId) {
  const me = currentOperator()
  const p = DEPT_PLANS.find(x => x.planId === planId)
  if (!p) throw _planError('计划不存在', 40401)
  if (!['已批准', '执行中'].includes(p.status)) throw _planError(`计划「${p.status}」不能提交完成情况`, 40926)
  const unfilled = (p.items || []).filter(i => {
    if (i.section === 'm') return false
    if (i.section === 'q') return i.actual === '' || i.actual === null
    return i.selfScore === null || i.selfScore === undefined
  })
  if (unfilled.length) {
    throw _planError(`还有 ${unfilled.length} 项没填：${unfilled.map(i => i.name).join('、')}`, 42212)
  }
  p.status = '待复评'
  p.resultAt = _now()
  p.logs.push({ at: p.resultAt, by: me.name, action: '提交完成情况', note: '等待运营管理部复评' })
  return getDeptPlan(planId)
}

/**
 * 复评 + 归档。逐项打分（1–5），不允许只给一个总分 ——
 * 总分说不清是哪一项出了问题，也没法回看"这项为什么只有 3 分"。
 * 监控项没有分数，只填扣分。
 */
export function closeDeptPlan(planId, { scores = {}, deductions = {}, summary = '' } = {}) {
  const me = currentOperator()
  if (!canEvalDeptPlans() && !canEditDeptPlans()) {
    throw _planError('当前角色没有复评权限（f.plans.eval）', 403)
  }
  const p = DEPT_PLANS.find(x => x.planId === planId)
  if (!p) throw _planError('计划不存在', 40401)
  /* 状态卡死：没提交完成情况就不给评 */
  if (p.status !== '待复评') {
    throw _planError(
      p.status === '已结案' ? '计划已归档' : `计划「${p.status}」，要等填报人提交完成情况之后才能复评`,
      40926
    )
  }
  const missing = (p.items || []).filter(i => i.section !== 'm' && (scores[i.taskId] === undefined || scores[i.taskId] === ''))
  if (missing.length) {
    throw _planError(`还有 ${missing.length} 项没打分：${missing.map(i => i.name).join('、')}`, 42212)
  }
  for (const it of p.items) {
    if (it.section === 'm') {
      if (deductions[it.taskId] !== undefined && deductions[it.taskId] !== '') {
        it.reviewWeighted = _plan2(deductions[it.taskId])
      }
      continue
    }
    const s = Number(scores[it.taskId])
    if (!Number.isFinite(s) || s < 1 || s > 5) throw _planError(`「${it.name}」评分必须在 1–5 之间`, 42212)
    it.reviewScore = _plan2(s)
  }
  const totals = planTotalsOf(p.items)
  p.status = '已结案'
  p.reviewAt = _now()
  p.evalAt = p.reviewAt
  p.evalBy = me.name
  p.reviewTotal = totals.reviewTotal
  p.selfTotal = totals.selfTotal
  p.totalScore = totals.total
  p.score = totals.total
  p.grade = planGradeOf(totals.total)
  p.finishRate = _finishRateOf(p)
  p.summary = String(summary || '').trim()
  p.logs.push({
    at: p.reviewAt, by: me.name, action: '复评完成',
    note: `自评 ${totals.selfTotal}×20% + 复评 ${totals.reviewTotal}×80% = ${totals.total}（${p.grade}）`
      + (p.summary ? ' · ' + p.summary : '')
  })
  return getDeptPlan(planId)
}

/* ---------------- 统计 ---------------- */

/**
 * 计划统计：按项目部门 / 状态 / 评分三个维度。
 * 口径提醒：
 *   - 「平均得分」只算已结案的（未结案没分，算进去会把均值拉低）；
 *   - 「完成率」按自评加权折算，不是条目数占比；
 *   - 总部职能部门的计划归到「总部职能」一组，不硬塞进项目。
 */
export function deptPlanStats({ planMonth = '', projectId = '' } = {}) {
  let list = DEPT_PLANS.map(p => _planRowOf(p))
  if (planMonth) list = list.filter(p => p.planMonth === planMonth)
  if (projectId) list = list.filter(p => p.projectId === projectId)

  const byStatus = PLAN_STATUS.map(s => ({ status: s, count: list.filter(p => p.status === s).length }))
  const statusCount = s => list.filter(p => p.status === s).length
  const closed = list.filter(p => p.status === '已结案')
  const totalItems = list.reduce((s, p) => s + p.items.length, 0)
  const lateTasks = list.reduce((s, p) => s + p.lateCount, 0)

  /* 条目执行情况：与「计划状态」是两个维度 —— 一份计划里可以有 3 项完成 2 项延期 */
  const execMap = new Map(PLAN_TASK_STATUS.map(s => [s, 0]))
  for (const p of list) {
    for (const it of p.items) execMap.set(it.execStatus, (execMap.get(it.execStatus) || 0) + 1)
  }
  const byExec = PLAN_TASK_STATUS.map(s => ({ status: s, count: execMap.get(s) || 0 }))

  const gmap = new Map()
  for (const p of list) {
    const key = p.projectId || 'HEAD'
    const cur = gmap.get(key) || {
      key, name: key === 'HEAD' ? '总部职能' : orgNameOf(key),
      plans: 0, tasks: 0, doneTasks: 0, lateTasks: 0,
      closed: 0, scoreSum: 0, finishSum: 0
    }
    cur.plans += 1
    cur.tasks += p.items.length
    cur.doneTasks += p.items.filter(t => t.execStatus === '已完成').length
    cur.lateTasks += p.lateCount
    cur.finishSum += p.finishRate
    if (p.status === '已结案') { cur.closed += 1; cur.scoreSum += p.totalScore }
    gmap.set(key, cur)
  }
  const byOrg = [...gmap.values()].map(g => ({
    ...g,
    avgScore: g.closed ? Math.round(g.scoreSum / g.closed * 100) / 100 : 0,
    avgFinish: g.plans ? Math.round(g.finishSum / g.plans * 10) / 10 : 0
  }))

  const scores = closed.map(p => p.totalScore)
  const byGrade = [
    { grade: 'A', label: '优秀', min: 4.5, max: 5.01 },
    { grade: 'B', label: '良好', min: 3.75, max: 4.5 },
    { grade: 'C', label: '合格', min: 3.0, max: 3.75 },
    { grade: 'D', label: '待改进', min: 0, max: 3.0 }
  ].map(b => ({ ...b, count: scores.filter(x => x >= b.min && x < b.max).length }))

  return {
    total: list.length,
    planCount: list.length,
    totalItems,
    taskCount: totalItems,
    closed: closed.length,
    closedCount: closed.length,
    pendingCount: list.filter(p => ['已批准', '执行中', '待复评'].includes(p.status)).length,
    published: list.filter(p => ['已批准', '执行中', '待复评'].includes(p.status)).length,
    draftCount: statusCount('草稿'),
    rejectedCount: statusCount('已驳回'),
    pendingReview: statusCount('待复评'),
    avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) / 100 : 0,
    avgFinish: list.length ? Math.round(list.reduce((s, p) => s + p.finishRate, 0) / list.length * 10) / 10 : 0,
    lateTasks,
    byStatus, byOrg, byProject: byOrg, byExec, byGrade
  }
}

/* ==================================================================
 * K 域 · 办公资产（2026-11-04 第 58 批）
 *
 * **这一域管的是办公资产**（电脑、桌椅、打印机、工具），不是 D 域的「设备台账」。
 * 设备台账管门禁 / 摄像头 / 车闸这类**装在公共区域的 IoT 设备**，看的是「在不在线」；
 * 办公资产看的是「值多少钱、在哪个部门」。两者的字段、状态、使用人都不是一套，
 * 所以不合并 —— 唯一可能的交集（电梯）靠 devices.assetId 单向关联，这里不存设备属性。
 *
 * 本期范围（用户确认过的减法）：
 *   建分类 → 新增资产 → 生成编号与 token → 打印标签 → 贴码上架（闲置）
 *   **不做**：领用 / 归还 / 送修 / 报废审批、盘点、折旧与净值。
 *   因此「状态」是**描述性字段**，不是流程状态 —— 页面必须写明这一点，
 *   否则会有人拿它统计"资产在哪"，而它随时可能和现实不符。
 * ================================================================== */

export const ASSET_STATUS = ['闲置', '在用', '报废']

/** 分类：树，parentId 自引用。只允许两级 —— 三级以上录入时选到崩溃，且实际用不到 */
export const ASSET_CAT_MAX_DEPTH = 2

const ASSET_PERM_VIEW = 'c.assets.view'
const ASSET_PERM_EDIT = 'c.assets.edit'
const ASSET_CAT_VIEW = 'c.assetCats.view'
const ASSET_CAT_EDIT = 'c.assetCats.edit'

export const canViewAssets = () => _hasPerm(ASSET_PERM_VIEW)
export const canEditAssets = () => _hasPerm(ASSET_PERM_EDIT)
export const canViewAssetCats = () => _hasPerm(ASSET_CAT_VIEW)
export const canEditAssetCats = () => _hasPerm(ASSET_CAT_EDIT)

const _assetError = (msg, code = 42212) => Object.assign(new Error(msg), { code })

let AC_SEQ = 0
const ASSET_CATS = []
let ASSET_SEQ = 0
const ASSETS = []
let ASSET_LOG_SEQ = 0
const ASSET_LOGS = []

/* ---------------- 分类 ---------------- */

const _catOf = catId => ASSET_CATS.find(c => c.catId === catId) || null

/** 分类全路径（`办公设备 / 电脑`）。改名不回写资产，靠资产上的快照 */
function _catPathOf(catId) {
  const chain = []
  let cur = _catOf(catId)
  let guard = 0
  while (cur && guard++ < 6) {
    chain.unshift(cur.name)
    cur = cur.parentId ? _catOf(cur.parentId) : null
  }
  return chain.join(' / ')
}

const _catDepthOf = catId => {
  let n = 0
  let cur = _catOf(catId)
  let guard = 0
  while (cur && guard++ < 6) { n += 1; cur = cur.parentId ? _catOf(cur.parentId) : null }
  return n
}

/** 某分类（含全部下级）的资产数 */
function _assetCountOf(catId) {
  const ids = new Set([catId])
  let added = true
  while (added) {
    added = false
    for (const c of ASSET_CATS) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.catId)) { ids.add(c.catId); added = true }
    }
  }
  return ASSETS.filter(a => ids.has(a.catId)).length
}

/** 分类行（带本级/含下级资产数、层级、路径） */
function _catRowOf(c) {
  const children = ASSET_CATS.filter(x => x.parentId === c.catId)
  return {
    ...c,
    catPath: _catPathOf(c.catId),
    depth: _catDepthOf(c.catId),
    leaf: children.length === 0,
    childCount: children.length,
    assetCount: ASSETS.filter(a => a.catId === c.catId).length,
    assetCountAll: _assetCountOf(c.catId),
    canDelete: children.length === 0 && ASSETS.every(a => a.catId !== c.catId)
  }
}

export function assetCatFlat() {
  return ASSET_CATS
    .map(_catRowOf)
    .sort((a, b) => (a.parentId || '').localeCompare(b.parentId || '') || (a.sort - b.sort) || a.name.localeCompare(b.name, 'zh'))
}

/** 树（页面左栏用）：根节点挂 children，节点带资产数 */
export function assetCatTree({ includeDisabled = true } = {}) {
  const all = ASSET_CATS
    .filter(c => includeDisabled || c.enabled)
    .map(_catRowOf)
    .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, 'zh'))
  const byId = new Map(all.map(c => [c.catId, { ...c, children: [] }]))
  const roots = []
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).children.push(node)
    else roots.push(node)
  }
  return roots
}

/** 下拉用：带缩进的扁平列表（一级缩进两个空格） */
export function assetCatOpts({ includeDisabled = false } = {}) {
  const out = []
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      out.push({ value: n.catId, label: `${depth ? '　'.repeat(depth) : ''}${n.name}`, depth, disabled: !n.enabled })
      if (n.children && n.children.length) walk(n.children, depth + 1)
    }
  }
  walk(assetCatTree({ includeDisabled }), 0)
  return out
}

export function getAssetCategory(catId) {
  const c = _catOf(catId)
  return c ? _catRowOf(c) : null
}

/**
 * 保存分类（新增 / 编辑）。
 * 三条硬规则：
 *  ① 最多两级 —— 三级分类在录入时基本选不出东西；
 *  ② 改上级不能挂到自己的子孙下（成环，树会无限递归）；
 *  ③ 同级不能重名（同一层有两个「电脑」，录入时选哪个都是错）。
 */
export function saveAssetCategory({ catId = '', name = '', parentId = '', prefix = '', sort = 10, note = '', enabled = true } = {}) {
  if (!canEditAssetCats()) throw _assetError(`当前角色没有维护分类的权限（${ASSET_CAT_EDIT}）`, 403)
  const nm = String(name || '').trim()
  if (!nm) throw _assetError('分类名称不能为空')
  if (nm.length > 12) throw _assetError('分类名称不超过 12 个字')

  const pid = String(parentId || '')
  if (pid) {
    if (!_catOf(pid)) throw _assetError('上级分类不存在', 40401)
    if (_catDepthOf(pid) >= ASSET_CAT_MAX_DEPTH) {
      throw _assetError(`分类最多 ${ASSET_CAT_MAX_DEPTH} 级：三级分类在录入时选不出来，实际也用不到`)
    }
  }

  /* 成环检查：把自己挂到自己的子孙下面，树会永远展开不完。
     注意：在「最多两级」的限制下这条其实走不到 —— 把一级挂到二级下面，会先被上面的
     深度校验拦住（那就是三级了）。保留它是为了以后万一放开三级时不用回头补。 */
  if (catId && pid) {
    let walker = _catOf(pid)
    let guard = 0
    while (walker && guard++ < 8) {
      if (walker.catId === catId) throw _assetError('不能把分类挂到它自己的下级里（会形成环）')
      walker = walker.parentId ? _catOf(walker.parentId) : null
    }
  }

  const dup = ASSET_CATS.find(c => c.catId !== catId && (c.parentId || '') === pid && c.name === nm)
  if (dup) throw _assetError(`同级已存在「${nm}」（${dup.catId}），换个名字或改上级`)

  if (catId) {
    const c = _catOf(catId)
    if (!c) throw _assetError('分类不存在', 40401)
    Object.assign(c, { name: nm, parentId: pid, prefix: String(prefix || '').trim().toUpperCase(), sort: Number(sort) || 10, note: String(note || '').trim(), enabled: enabled !== false })
    /* 改名不回写资产：资产上存的是快照，历史单据要能解释"当时叫什么" */
    return getAssetCategory(catId)
  }

  AC_SEQ += 1
  const rec = {
    catId: 'AC' + String(AC_SEQ).padStart(4, '0'),
    name: nm, parentId: pid,
    prefix: String(prefix || '').trim().toUpperCase(),
    sort: Number(sort) || 10,
    note: String(note || '').trim(),
    enabled: enabled !== false,
    createdAt: _now()
  }
  ASSET_CATS.push(rec)
  return getAssetCategory(rec.catId)
}

/** 启停用：停用后不能新建资产，已有资产保留 */
export function toggleAssetCategory(catId) {
  if (!canEditAssetCats()) throw _assetError(`当前角色没有维护分类的权限（${ASSET_CAT_EDIT}）`, 403)
  const c = _catOf(catId)
  if (!c) throw _assetError('分类不存在', 40401)
  c.enabled = !c.enabled
  return getAssetCategory(catId)
}

/** 删除：有子分类或有资产都不给删（删了资产就指向空分类） */
export function removeAssetCategory(catId) {
  if (!canEditAssetCats()) throw _assetError(`当前角色没有维护分类的权限（${ASSET_CAT_EDIT}）`, 403)
  const c = _catOf(catId)
  if (!c) throw _assetError('分类不存在', 40401)
  const kids = ASSET_CATS.filter(x => x.parentId === catId)
  if (kids.length) throw _assetError(`「${c.name}」下还有 ${kids.length} 个子分类，先删或移走子分类`, 40927)
  const used = ASSETS.filter(a => a.catId === catId).length
  if (used) throw _assetError(`「${c.name}」下还有 ${used} 件资产，先把资产改成别的分类（或停用分类）`, 40927)
  const i = ASSET_CATS.findIndex(x => x.catId === catId)
  ASSET_CATS.splice(i, 1)
  return { catId, removed: true }
}

/* ---------------- 资产 ---------------- */

/** 编号：ZC + 年 + 4 位年流水。**生成后不可改** —— 标签已经印出去了 */
function _assetNoNext(year = String(TODAY).slice(0, 4)) {
  const prefix = `ZC${year}`
  const max = ASSETS
    .filter(a => String(a.assetNo || '').startsWith(prefix))
    .reduce((m, a) => Math.max(m, Number(String(a.assetNo).slice(prefix.length)) || 0), 0)
  return prefix + String(max + 1).padStart(4, '0')
}

/** 二维码 token：16 位随机，与编号无关（编号能顺序推，token 不能） */
function _assetToken(seedStr) {
  const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let h = 2166136261
  for (let i = 0; i < seedStr.length; i++) h = (h ^ seedStr.charCodeAt(i)) * 16777619 >>> 0
  let out = ''
  for (let i = 0; i < 16; i++) {
    h = (h * 1103515245 + 12345) >>> 0
    out += pool[(h >>> 8) % pool.length]
  }
  return out
}

const _assetFind = assetId => ASSETS.find(a => a.assetId === assetId) || null

function _logOf(assetId) {
  return ASSET_LOGS
    .filter(l => l.assetId === assetId)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.logId).localeCompare(String(a.logId)))
}

function _pushAssetLog(assetId, field, fieldLabel, before, after, by) {
  ASSET_LOG_SEQ += 1
  ASSET_LOGS.unshift({
    logId: 'AL' + String(ASSET_LOG_SEQ).padStart(5, '0'),
    assetId, at: _now(), by: by || currentOperator().name,
    field, fieldLabel, before: String(before ?? ''), after: String(after ?? '')
  })
}

/** 派生一行（列表 / 详情共用）：使用部门名由 orgId 现算，不在资产上存第二份 */
function _assetRowOf(a) {
  const emp = a.holderEmpId ? employees.find(e => e.empId === a.holderEmpId) : null
  const files = Array.isArray(a.files) ? a.files : []
  const photos = files.filter(f => f.kind === 'image' || !f.kind)
  return {
    ...a,
    files,
    photos,
    photoCount: photos.length,
    cover: photos.length ? photos[0].url : '',
    holderName: emp ? emp.name : '',
    orgName: a.orgId ? orgNameOf(a.orgId) : '',
    catName: a.catName || (_catOf(a.catId)?.name || ''),
    catPath: a.catPath || _catPathOf(a.catId),
    warrantyLeft: a.warrantyEnd ? daysBetween(a.warrantyEnd) : null,
    warrantyExpired: a.warrantyEnd ? (daysBetween(a.warrantyEnd) ?? 0) > 0 : false,
    warrantySoon: a.warrantyEnd ? ((daysBetween(a.warrantyEnd) ?? 999) >= -30 && (daysBetween(a.warrantyEnd) ?? 999) <= 0) : false,
    _ver: a._ver || 1
  }
}

export function assetRows({ catId = '', status = '', orgId = '', kw = '', pageNo = 1, size = 15 } = {}) {
  let list = ASSETS.map(_assetRowOf)
  if (catId) {
    /* 选一级分类要看到它全部下级的资产，否则点「办公设备」是空的 */
    const ids = new Set([catId])
    let added = true
    while (added) {
      added = false
      for (const c of ASSET_CATS) {
        if (c.parentId && ids.has(c.parentId) && !ids.has(c.catId)) { ids.add(c.catId); added = true }
      }
    }
    list = list.filter(a => ids.has(a.catId))
  }
  if (status) list = list.filter(a => a.status === status)
  if (orgId) list = list.filter(a => a.orgId === orgId)
  if (kw) {
    const k = String(kw).trim()
    list = list.filter(a => `${a.name}${a.assetNo}${a.assetCode}${a.sn}${a.brand}${a.model}${a.holderName}${a.location}`.includes(k))
  }
  list.sort((a, b) => String(b.buyDate || '').localeCompare(String(a.buyDate || '')) || a.assetNo.localeCompare(b.assetNo))
  const total = list.length
  const start = (Math.max(1, pageNo) - 1) * size
  return { rows: list.slice(start, start + size), total, pageNo, size }
}

export function getAsset(assetId) {
  const a = _assetFind(assetId)
  if (!a) return null
  return { ..._assetRowOf(a), logs: _logOf(assetId) }
}

/** 字段中文名（变更记录里显示，页面不用自己维护一份） */
const ASSET_FIELD_LABEL = {
  name: '名称', catId: '分类', assetCode: '资产编码', brand: '品牌', model: '型号', sn: '序列号',
  buyDate: '购置日期', price: '购置原值', vendor: '供应商', warrantyEnd: '保修到期',
  holderEmpId: '使用人', orgId: '使用部门', location: '存放位置', status: '状态', remark: '备注',
  files: '设备图片'
}

/* ---------------- 设备图片（附件） ----------------
 * 用户确认的口径：图片**作为附件存在资产上**，不当独立实体，也不上传到图床 ——
 * 原型里存 data URL（indexedDB 都没有，刷新即还原），只验证「结构对不对、上限够不够」。
 *
 * 三条限制都是必要的：
 *   ① 最多 6 张 —— 详情页一屏能看完；再多就该走档案系统，不该塞在资产卡片里；
 *   ② 单张 ≤ 5MB —— 手机直出照片常 3–8MB，超过这个数浏览器里预览会明显卡；
 *   ③ 只收图片 —— 附件区不承担"扫描件、合同 PDF"的职责，那是合同模块的事。
 * 这些数字在页面和契约里各写了一遍，改的时候三处一起改（页面文案写着）。
 */
export const ASSET_FILE_MAX = 6
export const ASSET_FILE_MAX_SIZE = 5 * 1024 * 1024
export const ASSET_FILE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/** 附件规范化 + 校验。页面已经拦一次，这里再拦一次 —— 接口不能只信前端 */
function _cleanAssetFiles(list) {
  const arr = Array.isArray(list) ? list : []
  if (arr.length > ASSET_FILE_MAX) {
    throw _assetError(`设备图片最多 ${ASSET_FILE_MAX} 张，先删掉几张再传`)
  }
  return arr.map((f, i) => {
    const name = String(f.name || '').trim()
    if (!name) throw _assetError(`第 ${i + 1} 张图片没有文件名`)
    const url = String(f.url || '')
    /* svg 只在种子示例图里出现（见 _assetDemoPhoto），上传口子不开 —— 但数据层要认，
       否则编辑一件带示例图的种子资产会因为这个校验寸步难行 */
    const isData = /^data:image\/(jpeg|png|webp|gif|svg\+xml);base64,/i.test(url)
    const isHttp = /^https?:\/\//i.test(url)
    if (!isData && !isHttp) throw _assetError(`「${name}」不是有效的图片数据，请重新选择文件`)
    const size = Number(f.size) || 0
    if (size > ASSET_FILE_MAX_SIZE) {
      throw _assetError(`「${name}」${(size / 1024 / 1024).toFixed(1)}MB，超过 ${ASSET_FILE_MAX_SIZE / 1024 / 1024}MB 上限`)
    }
    return {
      fileId: String(f.fileId || `AF${Date.now().toString(36)}${i}`),
      kind: 'image',
      name,
      url,
      size,
      mime: String(f.mime || '').trim(),
      at: String(f.at || _now()),
      by: String(f.by || currentOperator().name)
    }
  })
}

/** 变更记录里图片只记张数 + 新增了哪几张：把 base64 写进日志会撑爆表格 */
function _filesBrief(list) {
  const arr = Array.isArray(list) ? list : []
  if (!arr.length) return ''
  return `${arr.length} 张：${arr.map(f => f.name).join('、')}`
}

/**
 * 保存资产（新增 / 编辑）。
 * 编号只在新增时生成，之后**永远不可改** —— 二维码标签已经贴在实物上，
 * 改编号等于让日志、报修记录、纸质标签全部对不上。
 */
export function saveAsset({ assetId = '', name = '', catId = '', assetCode = '', brand = '', model = '', sn = '',
  buyDate = '', price = '', vendor = '', warrantyEnd = '', holderEmpId = '', orgId = '', location = '',
  status = '闲置', remark = '', files = [], ver } = {}) {
  if (!canEditAssets()) throw _assetError(`当前角色没有维护资产的权限（${ASSET_PERM_EDIT}）`, 403)
  const nm = String(name || '').trim()
  if (!nm) throw _assetError('资产名称不能为空')
  if (!catId) throw _assetError('请选择资产分类')
  const cat = _catOf(catId)
  if (!cat) throw _assetError('分类不存在', 40401)
  if (!cat.enabled) throw _assetError(`分类「${cat.name}」已停用，换一个分类或先启用它`)
  if (!ASSET_STATUS.includes(status)) throw _assetError(`状态只能是 ${ASSET_STATUS.join(' / ')}`)
  const priceNum = price === '' || price === null ? null : Number(price)
  if (priceNum !== null && (!Number.isFinite(priceNum) || priceNum < 0)) throw _assetError('购置原值必须是不小于 0 的数字')
  if (buyDate && !/^\d{4}-\d{2}-\d{2}$/.test(buyDate)) throw _assetError('购置日期格式应为 YYYY-MM-DD')
  if (warrantyEnd && !/^\d{4}-\d{2}-\d{2}$/.test(warrantyEnd)) throw _assetError('保修到期格式应为 YYYY-MM-DD')
  if (buyDate && warrantyEnd && warrantyEnd < buyDate) throw _assetError('保修到期不能早于购置日期')

  const emp = holderEmpId ? employees.find(e => e.empId === holderEmpId) : null
  if (holderEmpId && !emp) throw _assetError('使用人不存在', 40401)
  /* 使用部门跟着使用人走，但允许改（成本归属可能不是使用人所在部门） */
  const finalOrg = orgId || (emp ? (teamOf(emp) || emp.orgId) : '')

  const patch = {
    name: nm, catId, catName: cat.name, catPath: _catPathOf(catId),
    assetCode: String(assetCode || '').trim(),
    brand: String(brand || '').trim(), model: String(model || '').trim(), sn: String(sn || '').trim(),
    buyDate: String(buyDate || ''), price: priceNum,
    vendor: String(vendor || '').trim(), warrantyEnd: String(warrantyEnd || ''),
    holderEmpId: String(holderEmpId || ''), orgId: finalOrg,
    location: String(location || '').trim(),
    status, remark: String(remark || '').trim(), files: _cleanAssetFiles(files)
  }

  if (assetId) {
    const a = _assetFind(assetId)
    if (!a) throw _assetError('资产不存在', 40401)
    if (ver !== undefined && Number(ver) !== Number(a._ver || 1)) {
      throw _assetError('该资产已被他人修改，请刷新后重试', 40901)
    }
    /* 逐字段记变更：没有领用单，这一层就是唯一的"什么时候谁改成什么" */
    for (const [k, v] of Object.entries(patch)) {
      const before = a[k]
      /* 图片按 fileId + 文件名 + url 比：只比 fileId 的话，「同一个 fileId 换了内容」
         会被当成没改动而跳过校验（换成别的类型也能溜过去）；只换顺序不算改动 */
      const same = k === 'files'
        ? JSON.stringify((before || []).map(f => `${f.fileId}|${f.name}|${f.url}`))
          === JSON.stringify((v || []).map(f => `${f.fileId}|${f.name}|${f.url}`))
        : (before === null || before === undefined ? '' : String(before)) === (v === null || v === undefined ? '' : String(v))
      if (same) continue
      const label = ASSET_FIELD_LABEL[k] || k
      let bShow = before, aShow = v
      if (k === 'holderEmpId') {
        bShow = (employees.find(e => e.empId === before) || {}).name || ''
        aShow = emp ? emp.name : ''
      }
      if (k === 'orgId') { bShow = before ? orgNameOf(before) : ''; aShow = v ? orgNameOf(v) : '' }
      if (k === 'catId') { bShow = a.catName || ''; aShow = cat.name }
      if (k === 'files') { bShow = _filesBrief(before); aShow = _filesBrief(v) }
      _pushAssetLog(a.assetId, k, label, bShow, aShow)
      a[k] = v
    }
    a._ver = Number(a._ver || 1) + 1
    return getAsset(assetId)
  }

  ASSET_SEQ += 1
  const id = 'AS' + String(ASSET_SEQ).padStart(4, '0')
  const assetNo = _assetNoNext()
  const rec = {
    assetId: id,
    assetNo,
    ...patch,
    qrToken: _assetToken(`${id}|${assetNo}|${nm}`),
    createdAt: _now(),
    createdBy: currentOperator().name,
    _ver: 1
  }
  ASSETS.push(rec)
  _pushAssetLog(id, 'create', '新增资产', '', `${nm}（${assetNo}）`)
  return getAsset(id)
}

export const assetLogsOf = assetId => _logOf(assetId)

/** 顶部 KPI */
export function assetSummary() {
  const list = ASSETS.map(_assetRowOf)
  const totalValue = list.reduce((s, a) => s + (Number(a.price) || 0), 0)
  const byStatus = ASSET_STATUS.map(s => ({ status: s, count: list.filter(a => a.status === s).length }))
  const soon = list.filter(a => a.warrantySoon)
  const expired = list.filter(a => a.warrantyExpired)
  /* 分类被停用、但下面还挂着资产 —— 这些资产改分类时会卡住，值得在 KPI 里露出来 */
  const disabledCatIds = new Set(ASSET_CATS.filter(c => !c.enabled).map(c => c.catId))
  const noCat = list.filter(a => disabledCatIds.has(a.catId)).length
  return {
    total: list.length,
    totalValue: Math.round(totalValue * 100) / 100,
    idle: byStatus.find(x => x.status === '闲置')?.count || 0,
    inUse: byStatus.find(x => x.status === '在用')?.count || 0,
    scrapped: byStatus.find(x => x.status === '报废')?.count || 0,
    byStatus,
    warrantySoon: soon.length,
    warrantyExpired: expired.length,
    catCount: ASSET_CATS.filter(c => c.enabled).length,
    noCat
  }
}

/** 按分类汇总（列表页右侧或无数据时的说明用） */
export function assetByCategory() {
  return assetCatFlat()
    .filter(c => c.assetCountAll > 0)
    .map(c => ({
      catId: c.catId, name: c.name, catPath: c.catPath, depth: c.depth,
      count: c.assetCountAll,
      value: Math.round(ASSETS.filter(a => a.catId === c.catId).reduce((s, a) => s + (Number(a.price) || 0), 0) * 100) / 100
    }))
    .sort((a, b) => b.count - a.count)
}

/* ---------------- 免登录公开视图 ---------------- */

/**
 * 扫码页数据：**只返回白名单字段**。
 *
 * 为什么不让扫码页直接调详情接口：详情里有原值、供应商、序列号、内部备注。
 * 扫码不需要登录，等于任何人捡到一台电脑就能看到这些 —— 序列号能被拿去伪造保修，
 * 原值泄露采购价，供应商暴露商务关系。所以这里另开一个「公开视图」，字段是配置出来的，
 * 不是从详情里挑几个删掉。
 *
 * 用户确认的口径：**只显示使用部门，不显示使用人姓名**。
 *
 * **设备图片也不在公开视图里**（2026-11-05 第 60 批加图片时一并定的）：
 * 照片是现场随手拍的，背景里常有工位、白板、同事，公开出去不是"设备长什么样"的问题。
 * 要给人看实物，走登录后的详情页。
 */
export const ASSET_PUBLIC_FIELDS = ['name', 'assetNo', 'catPath', 'status', 'orgName', 'location', 'warrantyEnd']

export function assetPublicView(token) {
  const t = String(token || '').trim()
  if (!t) return { ok: false, reason: 'empty' }
  const a = ASSETS.find(x => x.qrToken === t)
  /* token 无效不抛错、不区分"格式错"与"不存在"—— 区分了就等于告诉别人怎么猜 */
  if (!a) return { ok: false, reason: 'notfound' }
  const row = _assetRowOf(a)
  return {
    ok: true,
    scrapped: row.status === '报废',
    asset: {
      name: row.name,
      assetNo: row.assetNo,
      catPath: row.catPath,
      status: row.status,
      orgName: row.orgName || '—',
      location: row.location || '—',
      warrantyEnd: row.warrantyEnd || '—',
      warrantyExpired: row.warrantyExpired
    }
  }
}

/** 打印标签用的行（批量）：只取标签上印得下的字段 */
export function assetLabelRows(assetIds = []) {
  const ids = Array.isArray(assetIds) ? assetIds : []
  return ASSETS
    .filter(a => ids.includes(a.assetId))
    .map(a => {
      const r = _assetRowOf(a)
      return {
        assetId: r.assetId, assetNo: r.assetNo, name: r.name,
        catName: r.catName, holderName: r.holderName, orgName: r.orgName,
        qrToken: r.qrToken, scanUrl: `/scan/${r.qrToken}`
      }
    })
}

/* ---------------- 种子 ---------------- */

/**
 * 种子：5 个大类 + 14 个小类 + 120 件办公资产。
 * 走独立随机流（SEED+95），不扰动主数据 —— 重跑后只有 K 域的产物变化。
 */
const _ASSET_CAT_SEED = [
  ['办公设备', '', 'BG', [
    ['电脑', '电脑'],
    ['显示器', '显示器'],
    ['打印机/复印机', '打印机'],
    ['投影设备', '投影'],
    ['网络设备', '网络']
  ]],
  ['办公家具', '', 'JJ', [
    ['桌椅', '桌椅'],
    ['文件柜', '柜子'],
    ['沙发茶几', '沙发']
  ]],
  ['电子电器', '', 'DZ', [
    ['空调', '空调'],
    ['饮水机', '饮水'],
    ['冰箱微波炉', '冰箱']
  ]],
  ['工具器具', '', 'GJ', [
    ['维修工具', '工具'],
    ['电工工具', '电工'],
    ['测量仪器', '仪器']
  ]],
  ['其他资产', '', 'QT', [
    ['未分类待定', '待分']
  ]]
]

/* 每件资产的候选（名称 / 品牌 / 型号 / 价格区间） */
const _ASSET_ITEM_SPECS = {
  电脑: [['联想 ThinkPad E14', '联想', 'E14 Gen4', 4800, 6800], ['戴尔 Latitude 5440', '戴尔', '5440', 5200, 7200], ['惠普 战 66', '惠普', 'ProBook 440', 4200, 5600], ['苹果 MacBook Air', '苹果', 'M2 13"', 7800, 9800]],
  显示器: [['戴尔 24 寸显示器', '戴尔', 'P2422H', 900, 1300], ['AOC 27 寸', 'AOC', 'Q27B2S', 800, 1200]],
  打印机: [['惠普激光打印机', '惠普', 'M403d', 1600, 2400], ['兄弟多功能一体机', '兄弟', 'DCP-7090', 1400, 2100], ['佳能复印机', '佳能', 'iR2625', 9800, 14000]],
  投影: [['爱普生投影仪', '爱普生', 'CB-X50', 3800, 5200], ['明基商务投影', '明基', 'MX560', 2600, 3600]],
  网络: [['华为交换机', '华为', 'S5720', 2200, 3600], ['H3C 无线 AP', 'H3C', 'WA6320', 600, 900], ['TP-Link 路由器', 'TP-Link', 'ER605', 400, 700]],
  桌椅: [['人体工学办公椅', '西昊', 'M18', 800, 1600], ['主管办公桌 1.6m', '震旦', 'D16', 1800, 3200], ['会议桌 2.4m', '震旦', 'M24', 3600, 5600]],
  柜子: [['钢制文件柜四门', '得力', 'FC-4', 600, 1100], ['档案密集柜', '震旦', 'MJ-6', 4200, 6800]],
  沙发: [['接待沙发三人位', '全友', 'SF-3', 2200, 3600], ['茶几 1.2m', '全友', 'CJ-12', 600, 1000]],
  空调: [['格力挂机 1.5 匹', '格力', 'KFR-35GW', 2600, 3600], ['美的柜机 3 匹', '美的', 'KFR-72LW', 5600, 7800]],
  饮水: [['沁园商用饮水机', '沁园', 'QY-2', 1200, 2200], ['安吉尔直饮机', '安吉尔', 'AHR27', 2800, 4200]],
  冰箱: [['海尔双门冰箱', '海尔', 'BCD-216', 1800, 2600], ['微波炉', '美的', 'M1-L213B', 400, 700]],
  工具: [['世达工具套装 46 件', '世达', '09014', 600, 1200], ['电动螺丝刀', '博世', 'GSB120', 400, 800]],
  电工: [['数字万用表', '优利德', 'UT61E', 300, 600], ['绝缘工具组套', '世达', 'SATA-7', 500, 900]],
  仪器: [['激光测距仪', '博世', 'GLM50', 400, 700], ['红外测温仪', '优利德', 'UT300S', 300, 600]],
  待分: [['待确认资产', '—', '—', 100, 500]]
}

const _ASSET_LOCATIONS = ['总部 3F 财务部', '总部 3F 会议室', '总部 2F 行政办公室', '总部 4F 总经理室', '翡翠城项目部办公室', '锦绣家园项目部办公室', '星光天地项目部办公室', '总部 1F 前台', '总部 B1 库房']

/** 确定性随机器（LCG）：种子里必须可复现，且不能借用主数据的随机流 */
function _assetRand(seed) {
  let x = seed >>> 0
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0
    return x / 4294967296
  }
}

function _assetSeedBuild() {
  const rng = _assetRand(20261104 + 95)
  const pick = arr => arr[Math.floor(rng() * arr.length)]
  const int = (a, b) => a + Math.floor(rng() * (b - a + 1))

  /* 分类 */
  for (const [topName, , topPrefix, kids] of _ASSET_CAT_SEED) {
    const top = saveAssetCategorySeed({ name: topName, parentId: '', prefix: topPrefix, sort: int(10, 50) })
    kids.forEach(([kidName, key], i) => {
      saveAssetCategorySeed({ name: kidName, parentId: top.catId, prefix: `${topPrefix}-${String(i + 1).padStart(2, '0')}`, sort: (i + 1) * 10 })
    })
  }

  /* 资产：按小类分布，电脑最多。
     [分类全名, 物品规格的 key, 件数] —— 分类名必须和 _ASSET_CAT_SEED 里一字不差，
     写成短名（"打印机" vs "打印机/复印机"）会静默跳过，资产总数莫名少一半。 */
  const dist = [
    ['电脑', '电脑', 26], ['显示器', '显示器', 18],
    ['打印机/复印机', '打印机', 8], ['投影设备', '投影', 4], ['网络设备', '网络', 6],
    ['桌椅', '桌椅', 20], ['文件柜', '柜子', 6], ['沙发茶几', '沙发', 3],
    ['空调', '空调', 8], ['饮水机', '饮水', 4], ['冰箱微波炉', '冰箱', 2],
    ['维修工具', '工具', 7], ['电工工具', '电工', 5], ['测量仪器', '仪器', 3]
  ]
  const activeEmps = employees.filter(e => e.status !== '离职')
  const byCatName = new Map(ASSET_CATS.map(c => [c.name, c]))
  let seq = 0

  for (const [catName, specKey, count] of dist) {
    const cat = byCatName.get(catName)
    if (!cat) continue
    const specs = _ASSET_ITEM_SPECS[specKey] || _ASSET_ITEM_SPECS.待分
    for (let i = 0; i < count; i++) {
      const [nm, brand, model, lo, hi] = pick(specs)
      const emp = rng() < 0.82 ? pick(activeEmps) : null
      const buy = new Date(2021 + int(0, 4), int(0, 11), int(1, 28))
      const buyDate = buy.toISOString().slice(0, 10)
      /* 保修日期刻意留出两端：约 8% 临期（30 天内到期）、14% 已过保。
         全按「购置 + 2~4 年」生成的话，KPI 里"保修临期"永远是 0，这条指标就成了摆设。 */
      const shift = (base, days) => {
        const t = new Date(base)
        t.setDate(t.getDate() + days)
        return t.toISOString().slice(0, 10)
      }
      const roll = rng()
      let wy
      if (roll < 0.08) wy = shift(TODAY, int(2, 28))
      else if (roll < 0.22) wy = shift(TODAY, -int(20, 380))
      else wy = shift(buy, int(730, 1460))
      seq += 1
      saveAssetSeed({
        name: nm, catId: cat.catId,
        assetCode: `${cat.prefix || 'QT'}-${String(i + 1).padStart(3, '0')}`,
        brand, model,
        sn: `${brand === '—' ? 'NA' : brand.slice(0, 2).toUpperCase()}${int(100000, 999999)}`,
        buyDate, price: int(lo, hi) > 0 ? Math.round(int(lo, hi) / 10) * 10 - 1 : 0,
        vendor: pick(['成都联创科技有限公司', '四川办公之家', '京东企业购', '本地供应商', '—']),
        warrantyEnd: wy,
        holderEmpId: emp ? emp.empId : '',
        orgId: emp ? (teamOf(emp) || emp.orgId) : pick(['O-HEAD', 'O-P01', 'O-P02', 'O-P03']),
        location: pick(_ASSET_LOCATIONS),
        status: rng() < 0.72 ? '在用' : (rng() < 0.6 ? '闲置' : '报废'),
        remark: '',
        /* 每 9 件留一张示例图：台账缩略图和详情页图片区不至于是空的，
           但只给一小部分 —— 现实里也不可能所有资产都拍过照 */
        withPhoto: seq % 9 === 0
      })
    }
  }
}

/** 种子专用：绕过权限与校验（种子产生时还没有登录人） */
function saveAssetCategorySeed({ name, parentId = '', prefix = '', sort = 10 }) {
  AC_SEQ += 1
  const rec = { catId: 'AC' + String(AC_SEQ).padStart(4, '0'), name, parentId, prefix, sort, note: '', enabled: true, createdAt: '2026-01-01 00:00' }
  ASSET_CATS.push(rec)
  return rec
}

const _xmlText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 种子示例图：640×420 的占位图，明写「示例图」。
 * 不做成假照片 —— 假照片会被当成实拍，评审时说不清"这张图哪来的"；
 * 占位图上写清是示例，反而能把「这里应该有一张实拍」讲明白。
 */
function _assetDemoPhoto(name) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">'
    + '<rect width="640" height="420" fill="#e9edf4"/>'
    + '<rect x="28" y="28" width="584" height="364" rx="14" fill="none" stroke="#c2cad9" stroke-dasharray="10 7"/>'
    + `<text x="320" y="206" font-size="27" fill="#79839a" text-anchor="middle" font-family="sans-serif">${_xmlText(name)}</text>`
    + '<text x="320" y="250" font-size="17" fill="#9aa4b8" text-anchor="middle" font-family="sans-serif">示例图 · 可上传实拍替换</text>'
    + '</svg>'
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(svg)))
  return `data:image/svg+xml;base64,${b64}`
}

function saveAssetSeed({ name, catId, assetCode, brand, model, sn, buyDate, price, vendor, warrantyEnd, holderEmpId, orgId, location, status, remark, withPhoto = false }) {
  ASSET_SEQ += 1
  const id = 'AS' + String(ASSET_SEQ).padStart(4, '0')
  const assetNo = _assetNoNext()
  const cat = _catOf(catId)
  const files = withPhoto
    ? [{
        fileId: 'AF' + id, kind: 'image', name: `${name}.png`,
        url: _assetDemoPhoto(name), size: 0, mime: 'image/svg+xml',
        at: `${buyDate} 10:00`, by: '张敏'
      }]
    : []
  ASSETS.push({
    assetId: id, assetNo, name, catId,
    catName: cat ? cat.name : '', catPath: _catPathOf(catId),
    assetCode, brand, model, sn, buyDate, price, vendor, warrantyEnd,
    holderEmpId, orgId, location, status, remark, files,
    qrToken: _assetToken(`${id}|${assetNo}|${name}`),
    createdAt: `${buyDate} 09:00`, createdBy: '张敏',
    _ver: 1
  })
}

_assetSeedBuild()

/* 给一部分种子资产补一条「新增」记录。
   不补的话，详情页的变更记录区整个是空的 —— 看不出这块是干什么用的，
   而它恰恰是「没有领用单时唯一的留痕」。时间用资产自己的创建时间，不用当前时间。 */
for (const a of ASSETS) {
  ASSET_LOG_SEQ += 1
  ASSET_LOGS.push({
    logId: 'AL' + String(ASSET_LOG_SEQ).padStart(5, '0'),
    assetId: a.assetId,
    at: a.createdAt || '2026-01-05 09:00',
    by: a.createdBy || '人事专员',
    field: 'create', fieldLabel: '新增资产',
    before: '', after: `${a.name}（${a.assetNo}）`
  })
}

/* ---------------- 会签演示单（2026-11-03 第 53 批） ----------------
 * 采购申请走会签：部门负责人节点要正职 + 副职都签。
 * 这张单正职已签、副职待签，用来演示「会签没签完不推进下一级」，
 * 以及"副职在单签节点轮不到、在会签节点必须参与"这条差别。
 */
{
  const applicant = employees.find(e => e.orgId === 'O-P01' && e.position === '维修工' && e.status !== '离职')
    || employees.find(e => e.orgId === 'O-P01' && e.status !== '离职')
  const zheng = leadersOf('O-P01').find(r => r.duty === '正职' && r.active)
  const vice = leadersOf('O-P01').find(r => r.duty === '副职' && r.active)
  const finance = employees.find(e => e.position === '财务主管' && e.status !== '离职')
  APPROVAL_SEQ += 1
  approvals.unshift({
    approvalId: 'AP' + String(APPROVAL_SEQ).padStart(5, '0'),
    approvalNo: 'SP-' + String(TODAY).slice(0, 4) + '-' + String(APPROVAL_SEQ).padStart(4, '0'),
    bizType: '采购申请',
    bizId: '',
    changeId: '',
    title: '采购申请 · 翡翠城地下车库照明改造灯具（120 套）',
    formData: {
      itemName: 'LED 感应灯具', amount: 18600, quantity: 120, communityId: 'P01',
      supplier: '成都恒光照明', reason: '车库灯具老化严重，夜间照度不足，业主投诉集中在 B1 区'
    },
    files: [],
    communityId: 'P01',
    communityName: communityName('P01'),
    amount: 18600,
    applicant: applicant.name,
    applicantRole: applicant.position,
    applicantEmpId: applicant.empId,
    applicantOrgId: applicant.orgId,
    applicantOrgName: orgNameOf(applicant.orgId),
    scopeOrgId: applicant.orgId,
    scopeOrgName: orgNameOf(applicant.orgId),
    applyTime: '2026-10-19 10:24',
    status: '审批中',
    currentNode: '部门负责人审批（会签 1/2）',
    urgency: '普通',
    waitHours: 31,
    flow: [
      {
        node: '部门负责人审批',
        signMode: 'all',
        handler: vice?.name || '',
        approvers: [
          { name: zheng?.name || '', empId: zheng?.empId || '', duty: '正职', action: '同意', time: '2026-10-19 14:02', comment: '预算内，同意采购' },
          { name: vice?.name || '', empId: vice?.empId || '', duty: '副职', action: '待处理', time: '', comment: '' }
        ],
        action: '待处理', time: '', comment: '', limitHours: 24, skipNote: ''
      },
      {
        node: '财务预算复核',
        signMode: 'single',
        handler: finance?.name || '',
        approvers: [{ name: finance?.name || '', empId: finance?.empId || '', duty: '', action: '待处理', time: '', comment: '' }],
        action: '待处理', time: '', comment: '', limitHours: 24, skipNote: ''
      }
    ],
    _isNew: true
  })
}

/* ==================================================================
 * N 域 · 邻里运营（2026-11-06 第 68 批）
 *
 * 邻里是**业主端**的入口，后台这一侧只做三件事：发布、审核、看数。
 *
 * 为什么不做话题广场 / 跟帖：那属于微信【社交-社区/论坛】类目，主体要提供
 * 《非经营性互联网信息服务备案核准》或 ICP 许可证，证本身不难 —— 难的是
 * **常态化内容审核**：邻里纠纷、指名骂物业、涉政涉黄、造谣，每条都要有人在
 * 24 小时内处理并留证。物业没有这个编制。砍掉之后闲置成为全站唯一 UGC 源，
 * 反而好办：一个队列、一套词、一份举报规则。
 *
 * 与 C 域公告的关系：**同一张表**。后台不另发一遍 —— 两处各发一次的结果是
 * 运营要发两遍、阅读数还对不上。这里只补一个「是否同步到邻里」的开关。
 *
 * 四条硬口径（页面与接口按这个来，后端别改）：
 *   ① 投票只做**意见征询**，不做《民法典》278 条的业主共同决定。表决要人数 +
 *      专有部分面积双过半、要公示期、要能出纸质票，小程序替代不了票箱；
 *      做了反而给人「已经表决过」的错觉。所以结果页只给参与率与分布，
 *      **不给「是否通过」** —— 那句话一旦出现，就要承担法律效力。
 *   ② 投票一旦开始，题目与选项都不能改。已投出去的票会指向不存在的选项，
 *      改完票数合计还对不上。要改就复制一份新的。
 *   ③ 收费活动必须有**成团下限**，「已截止但没到下限」是独立状态（待成行），
 *      既不是"报名中"也不是"已结束"。少了这一态，钱收了团没成，退款没入口。
 *   ④ 闲置**先审后发**，驳回必须写理由 —— 业主会拿着驳回通知来问「为什么」。
 * ================================================================== */

/* ---------- 权限 ---------- */
const NV_PERM = {
  workbench: 'n.workbench.view',
  voteView: 'n.votes.view', voteEdit: 'n.votes.edit',
  actView: 'n.activities.view', actEdit: 'n.activities.edit', actEnroll: 'n.activities.enroll',
  itemView: 'n.items.view', itemAudit: 'n.items.audit',
  reportView: 'n.reports.view', reportHandle: 'n.reports.handle'
}

export const canViewNeighborWorkbench = () => _hasPerm(NV_PERM.workbench)
export const canViewVotes = () => _hasPerm(NV_PERM.voteView)
export const canEditVotes = () => _hasPerm(NV_PERM.voteEdit)
export const canViewActivities = () => _hasPerm(NV_PERM.actView)
export const canEditActivities = () => _hasPerm(NV_PERM.actEdit)
/**
 * 代报名 / 取消 / 退款 / 签到：单独一个码，不跟「建活动」共用。
 *
 * 为什么拆：一线客服在现场帮业主报名，但**不该能建活动、改价格、确认流团**。
 * 合成一个码的结果只有两种 —— 要么客服报不了名（现在这样），
 * 要么把发布权一起放给客服。移动端上线后这条会更明显：手机上只做代报名。
 */
export const canEnrollActivities = () => _hasPerm(NV_PERM.actEnroll)
export const canViewItems = () => _hasPerm(NV_PERM.itemView)
export const canAuditItems = () => _hasPerm(NV_PERM.itemAudit)
export const canViewReports = () => _hasPerm(NV_PERM.reportView)
export const canHandleReports = () => _hasPerm(NV_PERM.reportHandle)

/* ---------- 字典 ---------- */
export const VOTE_TYPES = ['意见征询', '满意度调查', '方案征询']
export const VOTE_STATUS = ['草稿', '进行中', '已结束']
/**
 * 活动**类别**（2026-11-07 第 70 批拆出来的）。
 *
 * 收费与否**不在这里**：看 `fee`，由它派生 `feeType = 免费 / 收费`。
 * 原先两套含义挤在 `type` 一个字段里，页面上会同时出现「亲子 · 免费」和「收费 · 收费」，
 * 按类型筛选也会把「亲子」和「收费」并列 —— 那是字段设计的问题，不是数据的问题。
 */
export const ACTIVITY_CATEGORIES = ['敬老', '亲子', '文体', '出游', '公益']
/** 草稿不在活动列表的主筛选里，但新建后、发布前就是这个状态 */
export const ACTIVITY_PHASES = ['草稿', '报名中', '待成行', '已成行', '已流团', '已结束']
export const ITEM_STATUSES = ['待审核', '已上架', '已驳回', '已下架', '已售出', '已过期']
export const REPORT_REASONS = ['虚假信息', '违禁品', '骚扰辱骂', '疑似诈骗', '重复刷屏', '其他']
export const REPORT_ACTIONS = ['忽略', '下架并警告', '仅警告', '封禁 7 天']

const _nvError = (msg, code = 42230) => Object.assign(new Error(msg), { code })
const _nvR2 = n => Math.round((Number(n) || 0) * 100) / 100
const _nvStamp = () => `${TODAY} ${_now().slice(11, 16)}`
const _nvStaff = pos => employees.find(e => e.position === pos && e.status !== '离职')
  || employees.find(e => e.status !== '离职') || employees[0]

const _NV_PHASE_TYPE = {
  草稿: 'info', 报名中: 'success', 待成行: 'warning', 已成行: 'success', 已流团: 'danger', 已结束: ''
}
const _NV_STATUS_TYPE = {
  待审核: 'warning', 已上架: 'success', 已驳回: 'danger', 已下架: 'info', 已售出: '', 已过期: 'info'
}
const _NV_VOTE_TYPE = { 草稿: 'info', 进行中: 'success', 已结束: '' }

/* ==================================================================
 * ① 投票（意见征询）
 * ================================================================== */

const NV_VOTES = []
let _nvVoteSeq = 0

const _nvVoteOf = voteId => NV_VOTES.find(v => v.voteId === voteId) || null

/** 应投人数 = 该项目下有房号的业主去重数。租户不计：征询的是产权人意见 */
function _nvTargetOf(communityId) {
  return new Set(houses.filter(h => h.communityId === communityId && h.ownerId).map(h => h.ownerId)).size
}

function _nvVoteRow(v) {
  const total = v.options.reduce((s, o) => s + (Number(o.votes) || 0), 0)
  const target = _nvTargetOf(v.communityId)
  /* 应投户数取「有房号的业主去重数」，且不小于已投票数：
     种子里的票数是独立随机生成的，会出现 310 票 / 189 户这种硬伤。
     参与率一旦超过 100%，这一页的数字就没人信了 —— 分母兜住上限。 */
  const base = Math.max(target, total)
  return {
    voteId: v.voteId,
    title: v.title,
    type: v.type,
    communityId: v.communityId,
    communityName: communityName(v.communityId),
    audience: v.audience || '全部业主',
    startAt: v.startAt,
    endAt: v.endAt,
    status: v.status,
    statusType: _NV_VOTE_TYPE[v.status] || '',
    multi: !!v.multi,
    maxPick: v.maxPick || 1,
    anonymous: !!v.anonymous,
    optionCount: v.options.length,
    options: v.options.map(o => ({ ...o })),
    totalVotes: total,
    target: base,
    partRate: base ? _nvR2((total / base) * 100) : 0,
    createdBy: v.createdBy,
    createdAt: v.createdAt,
    publishedAt: v.publishedAt || '',
    endedAt: v.endedAt || ''
  }
}

function _nvSeedVotes() {
  const cs = _nvStaff('客服主管')
  surveys.forEach(s => {
    NV_VOTES.push({
      voteId: s.surveyId,
      title: s.title,
      type: s.type === '问卷' ? '满意度调查' : '意见征询',
      communityId: s.communityId,
      desc: s.desc || '',
      startAt: s.startAt,
      endAt: s.endAt,
      status: s.status,
      multi: !!s.multi,
      maxPick: s.multi ? 2 : 1,
      anonymous: !!s.anonymous,
      options: s.options.map(o => ({ ...o })),
      audience: '全部业主',
      createdBy: cs.name,
      createdAt: `${s.startAt} 09:20`,
      publishedAt: `${s.startAt} 10:00`,
      endedAt: s.status === '已结束' ? `${s.endAt} 23:59` : ''
    })
  })

  /* 两条草稿：演示"建 → 改 → 发布"的完整路径，也让列表有非空态可看 */
  const drafts = [
    {
      communityId: 'P01', title: '地下车库充电桩加装位置征询', type: '方案征询',
      desc: '拟在 B1 层东侧加装 12 个慢充桩，三个方案各有利弊，想先听听业主的意见。本征询不构成业主共同决定。',
      endAt: '2026-11-05', options: ['A · 靠近东出入口（离车流最近）', 'B · 中部靠墙（不占车道，但要走 30 米）', 'C · 分散布置（每区 4 个）']
    },
    {
      communityId: 'P02', title: '2027 年社区文化活动偏好调查', type: '满意度调查',
      desc: '为排明年的活动预算，想先摸一下大家更愿意参加哪一类。多选，最多选 2 项。',
      endAt: '2026-11-12', multi: true, maxPick: 2,
      options: ['亲子手工 / 市集', '健康讲座与义诊', '节日联欢', '户外出游', '老年兴趣班']
    }
  ]
  drafts.forEach((d, i) => {
    NV_VOTES.push({
      voteId: `SV01${String(i + 1).padStart(2, '0')}`,
      title: d.title,
      type: d.type,
      communityId: d.communityId,
      desc: d.desc,
      startAt: '',
      endAt: d.endAt,
      status: '草稿',
      multi: !!d.multi,
      maxPick: d.maxPick || 1,
      anonymous: true,
      options: d.options.map((label, k) => ({ key: `A${k + 1}`, label, votes: 0 })),
      audience: '全部业主',
      createdBy: cs.name,
      createdAt: '2026-10-20 16:40',
      publishedAt: '',
      endedAt: ''
    })
  })
}

/* ---------- 读 ---------- */

/**
 * 票数归一。
 *
 * 种子里的票数是独立随机的，会出现「310 票 / 189 户」这种硬伤 —— 参与率 164%，
 * 这一页的数字立刻没人信了。真实系统里不可能发生（一户一票），所以按户数上限压回来：
 * 超过 55% 的按比例缩到 55%，余数补给票数最高的选项，保证合计对得上。
 *
 * 只压不回补：本来就低于 55% 的不动，避免把「参与率低」这个真实信号抹平。
 */
function _nvNormalizeVotes() {
  NV_VOTES.forEach(v => {
    const target = _nvTargetOf(v.communityId)
    const total = v.options.reduce((s, o) => s + (Number(o.votes) || 0), 0)
    if (!target || !total || total <= target * 0.55) return
    const cap = Math.round(target * 0.55)
    const factor = cap / total
    let acc = 0
    v.options.forEach(o => {
      o.votes = Math.floor((Number(o.votes) || 0) * factor)
      acc += o.votes
    })
    const rest = cap - acc
    if (rest > 0) {
      const top = v.options.reduce((m, o) => (o.votes > m.votes ? o : m), v.options[0])
      top.votes += rest
    }
  })
}

export function queryVotes({ pageNo = 1, size = 20, filters = {} } = {}) {
  if (!canViewVotes()) throw _nvError(`当前角色没有查看投票的权限（${NV_PERM.voteView}）`, 403)
  return delay(() => {
    assertInScope({ communityId: filters.communityId })
    const list = NV_VOTES
      .filter(v => eq(v, filters.communityId, 'communityId'))
      .filter(v => eq(v, filters.type, 'type'))
      .filter(v => eq(v, filters.status, 'status'))
      .filter(v => kwHit(v, filters.kw, ['title', 'voteId'], v.desc || ''))
      .map(_nvVoteRow)
      /* 进行中排最前：运营每天要看的是"还在跑的这几个" */
      .sort((a, b) => {
        const rank = { 进行中: 0, 草稿: 1, 已结束: 2 }
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status]
        return String(b.endAt).localeCompare(String(a.endAt))
      })
    return paged(list, pageNo, size)
  })
}

export function voteStats() {
  const running = NV_VOTES.filter(v => v.status === '进行中').map(_nvVoteRow)
  const ended = NV_VOTES.filter(v => v.status === '已结束').map(_nvVoteRow)
  const avg = list => (list.length ? _nvR2(list.reduce((s, v) => s + v.partRate, 0) / list.length) : 0)
  return {
    total: NV_VOTES.length,
    running: running.length,
    draft: NV_VOTES.filter(v => v.status === '草稿').length,
    ended: ended.length,
    runningPartRate: avg(running),
    endedPartRate: avg(ended),
    votesTotal: NV_VOTES.reduce((s, v) => s + v.options.reduce((n, o) => n + o.votes, 0), 0)
  }
}

export function getVote(voteId) {
  const v = _nvVoteOf(voteId)
  return v ? _nvVoteRow(v) : null
}

/**
 * 结果聚合。
 *
 * 刻意**不返回「是否通过」**：这是意见征询，不是表决。给了一句"通过"，
 * 明天就有人拿它去主张业主大会决议。只给参与率、票数、分布。
 */
export function voteResult(voteId) {
  const v = _nvVoteOf(voteId)
  if (!v) return null
  const row = _nvVoteRow(v)
  const options = row.options
    .map(o => ({ ...o, pct: row.totalVotes ? _nvR2((o.votes / row.totalVotes) * 100) : 0 }))
    .sort((a, b) => b.votes - a.votes)
  const byHouse = {}
  const target = row.target || 1
  return {
    ...row,
    options,
    topOption: options[0] || null,
    /** 参与率低于 30% 时结果只能"参考"，不能拿去对外说"业主都同意" */
    confidence: row.partRate >= 50 ? '有效' : row.partRate >= 30 ? '可参考' : '偏低',
    notVoted: Math.max(0, target - row.totalVotes),
    target
    /* 这里**不放 conclusion: ''** —— 空壳字段迟早有人往里填"通过"，
       而这是意见征询，不是业主大会表决（契约 /neighbor/votes/{id}/result 写明不给结论）。 */
  }
}

/* ---------- 写 ---------- */

function _nvValidateVote(body = {}) {
  const title = String(body.title || '').trim()
  if (!title) throw _nvError('投票标题必填')
  if (title.length > 40) throw _nvError('标题最多 40 字')
  if (!VOTE_TYPES.includes(body.type)) throw _nvError(`投票类型只能是 ${VOTE_TYPES.join(' / ')}`)
  if (!body.communityId) throw _nvError('必须选择项目 —— 投票范围是按项目算的')
  if (!body.endAt) throw _nvError('必须设置截止日期')
  const opts = (body.options || []).map(o => String(o.label ?? o).trim()).filter(Boolean)
  if (opts.length < 2) throw _nvError('至少需要 2 个选项')
  if (opts.length > 10) throw _nvError('选项最多 10 个')
  if (new Set(opts).size !== opts.length) throw _nvError('选项有重复，请合并')
  if (opts.some(o => o.length > 30)) throw _nvError('单个选项最多 30 字')
  if (body.multi) {
    const max = Number(body.maxPick) || 0
    if (max < 1 || max > opts.length) throw _nvError(`多选时「最多可选」须在 1 ~ ${opts.length} 之间`)
  }
  return opts
}

export function saveVote(body = {}, voteId = '') {
  if (!canEditVotes()) throw _nvError(`当前角色没有维护投票的权限（${NV_PERM.voteEdit}）`, 403)
  const opts = _nvValidateVote(body)
  const cur = voteId ? _nvVoteOf(voteId) : null
  if (voteId && !cur) throw _nvError('投票不存在', 40430)
  /* 已开始的投票改选项 = 让已投出的票指向不存在的选项 */
  if (cur && cur.status !== '草稿') {
    throw _nvError('投票已开始，题目与选项都不能再改。要调整请复制一份新的', 40930)
  }

  const next = {
    title: String(body.title).trim(),
    type: body.type,
    communityId: body.communityId,
    desc: String(body.desc || '').trim(),
    startAt: cur ? cur.startAt : '',
    endAt: body.endAt,
    status: '草稿',
    multi: !!body.multi,
    maxPick: body.multi ? Number(body.maxPick) || 1 : 1,
    anonymous: body.anonymous !== false,
    audience: body.audience || '全部业主',
    options: opts.map((label, i) => {
      const old = cur ? cur.options.find(o => o.label === label) : null
      return { key: old ? old.key : `A${i + 1}`, label, votes: old ? old.votes : 0 }
    })
  }

  if (cur) {
    /* 保留原 key 上已累积的票数；被删掉的选项直接丢弃（草稿没有票，安全） */
    Object.assign(cur, next)
    return _nvVoteRow(cur)
  }
  _nvVoteSeq += 1
  const row = {
    ...next,
    voteId: `SV${String(100 + _nvVoteSeq).padStart(4, '0')}`,
    createdBy: currentOperator().name,
    createdAt: _nvStamp(),
    publishedAt: '',
    endedAt: ''
  }
  NV_VOTES.unshift(row)
  return _nvVoteRow(row)
}

export function publishVote(voteId) {
  if (!canEditVotes()) throw _nvError(`当前角色没有发布投票的权限（${NV_PERM.voteEdit}）`, 403)
  const v = _nvVoteOf(voteId)
  if (!v) throw _nvError('投票不存在', 40430)
  if (v.status === '进行中') throw _nvError('这个投票已经在进行中了', 40931)
  if (v.status === '已结束') throw _nvError('已结束的投票不能重新发布，请复制一份', 40932)
  if (toDay(v.endAt) < TODAY) throw _nvError(`截止日期 ${v.endAt} 已经过了，改一下再发布`)
  if (v.options.length < 2) throw _nvError('至少需要 2 个选项才能发布')
  Object.assign(v, { status: '进行中', startAt: TODAY, publishedAt: _nvStamp() })
  track('neighbor_vote_publish', { voteId })
  return _nvVoteRow(v)
}

export function endVote(voteId) {
  if (!canEditVotes()) throw _nvError(`当前角色没有结束投票的权限（${NV_PERM.voteEdit}）`, 403)
  const v = _nvVoteOf(voteId)
  if (!v) throw _nvError('投票不存在', 40430)
  if (v.status !== '进行中') throw _nvError('只有在进行中的投票才能结束', 40933)
  Object.assign(v, { status: '已结束', endedAt: _nvStamp() })
  track('neighbor_vote_end', { voteId })
  return _nvVoteRow(v)
}

export function deleteVote(voteId) {
  if (!canEditVotes()) throw _nvError(`当前角色没有删除投票的权限（${NV_PERM.voteEdit}）`, 403)
  const i = NV_VOTES.findIndex(v => v.voteId === voteId)
  if (i < 0) throw _nvError('投票不存在', 40430)
  if (NV_VOTES[i].status !== '草稿') throw _nvError('只有草稿能删除，已发布的投票要保留留痕', 40934)
  NV_VOTES.splice(i, 1)
  return true
}

/* ==================================================================
 * ② 活动（类别 × 免费/收费）
 * ================================================================== */

const NV_ACTS = []
let _nvActSeq = 0

const _nvActOf = activityId => NV_ACTS.find(a => a.activityId === activityId) || null

/** 已报名人数（含同行人，不含已取消） */
function _nvEnrolledOf(activityId) {
  return NV_ENROLLS
    .filter(e => e.activityId === activityId && e.status !== '已取消' && e.status !== '已退款')
    .reduce((s, e) => s + (Number(e.people) || 1), 0)
}

function _nvPhaseOf(a) {
  if (a.status === '草稿') return '草稿'
  /* 先判流团：confirmFlow 会把 status 一并置成「已结束」，
     如果先判「已结束」，刚确认流团的活动会显示成正常结束，退款记录就看不出来了 */
  if (a.flowedAt) return '已流团'
  if (a.status === '已结束') return '已结束'
  const enrolled = _nvEnrolledOf(a.activityId)
  const deadline = a.enrollDeadline || String(a.startAt).slice(0, 10)
  if (toDay(deadline) >= TODAY) return '报名中'
  const min = Number(a.minCapacity) || 0
  if (!min) return '已成行'
  return enrolled >= min ? '已成行' : '待成行'
}

function _nvActRow(a) {
  const enrolled = _nvEnrolledOf(a.activityId)
  const phase = _nvPhaseOf(a)
  const min = Number(a.minCapacity) || 0
  const paid = NV_ENROLLS
    /* 直接用原始记录判状态：`payStatus` 是派生字段，只存在于 _nvEnrollRow 的返回里，
       在这里读 e.payStatus 永远是 undefined —— 已收活动费会一直显示 ¥0.00 */
    .filter(e => e.activityId === a.activityId
      && !['已取消', '已退款'].includes(e.status)
      && Number(a.fee) > 0)
    .reduce((s, e) => s + (_nvR2((a.fee || 0) * (e.people || 1))), 0)
  return {
    activityId: a.activityId,
    title: a.title,
    category: a.category,
    /* 收费口径是**派生值**：只有「免费 / 收费」，与类别正交，不落库 */
    feeType: (Number(a.fee) || 0) > 0 ? '收费' : '免费',
    fee: Number(a.fee) || 0,
    feeText: a.fee > 0 ? `¥${_nvR2(a.fee)}/人` : '免费',
    communityId: a.communityId,
    communityName: communityName(a.communityId),
    startAt: a.startAt,
    endAt: a.endAt,
    place: a.place,
    capacity: a.capacity,
    minCapacity: min,
    enrollDeadline: a.enrollDeadline,
    enrolled,
    left: Math.max(0, a.capacity - enrolled),
    /* 进度条最多 100%：种子里有报名数超过名额的活动（42/20），
       直接按比例画会出 210% 的进度条，看起来像算错了。超额单独给一个数。 */
    fillRate: a.capacity ? Math.min(100, _nvR2((enrolled / a.capacity) * 100)) : 0,
    over: Math.max(0, enrolled - a.capacity),
    /** 距成团还差几人：待成行时这是运营最想看的数 */
    gap: min ? Math.max(0, min - enrolled) : 0,
    phase,
    phaseType: _NV_PHASE_TYPE[phase] || '',
    needInsurance: !!a.needInsurance,
    attendeeLimit: a.attendeeLimit || 1,
    refundPolicy: a.refundPolicy || [],
    feeInclude: a.feeInclude || '',
    feeExclude: a.feeExclude || '',
    organizer: a.organizer || '物业服务中心',
    desc: a.desc || '',
    paidAmount: _nvR2(paid),
    createdBy: a.createdBy || '',
    flowedAt: a.flowedAt || '',
    flowReason: a.flowReason || ''
  }
}

function _nvSeedActivities() {
  const cs = _nvStaff('客服主管')
  activities.forEach(a => {
    NV_ACTS.push({
      ...a,
      enrollDeadline: a.enrollDeadline || String(a.startAt).slice(0, 10),
      minCapacity: 0,
      needInsurance: false,
      attendeeLimit: 3,
      refundPolicy: [],
      createdBy: cs.name
    })
  })

  /* 补三条收费活动，专门覆盖「报名中 / 待成行 / 已成行」三个分支 ——
     原数据里收费活动只有两条且都已结束，光看它们没法验证成团逻辑。 */
  const extra = [
    {
      activityId: 'AC0013', communityId: 'P02', title: '邻里出游 · 青城前山一日游',
      category: '出游', cover: 3, startAt: '2026-11-15 07:30', endAt: '2026-11-15 18:00',
      place: '青城山前山景区（小区南门集合上车）', capacity: 40, minCapacity: 20, fee: 180,
      enrollDeadline: '2026-11-10', needInsurance: true, attendeeLimit: 4,
      feeInclude: '往返大巴、景区门票、团队午餐、随车导游、旅游意外险',
      feeExclude: '索道、观光车、个人消费',
      refundPolicy: [{ days: 7, ratio: 100 }, { days: 3, ratio: 50 }, { days: 0, ratio: 0 }],
      desc: '费用按车费、门票、餐费成本分摊，不构成旅行社业务。出行人需实名，用于购买当日意外险；活动结束后 30 天身份信息自动脱敏。'
    },
    {
      activityId: 'AC0014', communityId: 'P01', title: '秋日露营 · 亲子两天一夜',
      category: '出游', cover: 5, startAt: '2026-11-01 14:00', endAt: '2026-11-02 12:00',
      place: '青龙湖露营地（统一大巴往返）', capacity: 30, minCapacity: 15, fee: 260,
      enrollDeadline: '2026-10-18', needInsurance: true, attendeeLimit: 4,
      feeInclude: '营位、帐篷租赁、两正餐一早餐、往返交通、意外险',
      feeExclude: '睡袋（可自带或现场租 30 元）',
      refundPolicy: [{ days: 7, ratio: 100 }, { days: 3, ratio: 50 }, { days: 0, ratio: 0 }],
      desc: '按 15 人成团，不足则全额退款。'
    },
    {
      /* 2026-11-06：P01 原来只有 AC0014（待成行，按规则不能报名），
         代报名在翡翠城没有一个可报名样本 —— 补一场报名中的收费活动。 */
      activityId: 'AC0016', communityId: 'P01', title: '冬日温泉一日游 · 含往返与午餐',
      category: '出游', cover: 4, startAt: '2026-11-28 08:00', endAt: '2026-11-28 19:00',
      place: '花水湾温泉度假区（小区北门集合上车）', capacity: 40, minCapacity: 15, fee: 168,
      enrollDeadline: '2026-11-20', needInsurance: true, attendeeLimit: 4,
      feeInclude: '往返大巴、温泉门票、团队午餐、随车服务、旅游意外险',
      feeExclude: '泳衣租赁、个人消费',
      refundPolicy: [{ days: 7, ratio: 100 }, { days: 3, ratio: 50 }, { days: 0, ratio: 0 }],
      desc: '按 15 人成团，不足则全额退款。出行人需实名用于投保。'
    },
    {
      /* 2026-11-06：P01 没有「已成行」的活动，签到没法演示 —— 补一场已过截止且已达下限的。
         AC0016 报名中（可代报名）/ AC0014 待成行（不能报名）/ AC0017 已成行（可签到），三个分支齐了。 */
      activityId: 'AC0017', communityId: 'P01', title: '社区义诊 · 免费量血压与用药咨询',
      category: '公益', cover: 2, startAt: '2026-10-24 09:00', endAt: '2026-10-24 12:00',
      place: '翡翠城 1 栋架空层', capacity: 40, minCapacity: 10, fee: 0,
      enrollDeadline: '2026-10-16', needInsurance: false, attendeeLimit: 2,
      feeInclude: '', feeExclude: '',
      refundPolicy: [],
      desc: '社区卫生服务中心进小区，现场量血压、血糖与用药咨询；已达下限，按报名顺序通知。'
    },
    {
      activityId: 'AC0015', communityId: 'P03', title: '亲子农场采摘 · 含午餐',
      category: '出游', cover: 2, startAt: '2026-10-25 09:00', endAt: '2026-10-25 16:00',
      place: '禾田农场（自驾前往，园区东门集合）', capacity: 60, minCapacity: 20, fee: 88,
      enrollDeadline: '2026-10-20', needInsurance: true, attendeeLimit: 5,
      feeInclude: '采摘 2 斤、农场午餐、儿童手作材料',
      feeExclude: '超出 2 斤按 15 元/斤计',
      refundPolicy: [{ days: 3, ratio: 100 }, { days: 0, ratio: 50 }],
      desc: '已达成团人数，按报名顺序确认。'
    }
  ]
  extra.forEach(a => {
    NV_ACTS.push({
      ...a,
      status: '报名中',
      organizer: '物业服务中心',
      views: 0,
      enrolled: 0,
      createdBy: cs.name
    })
  })
}

/* ---------- 报名（活动与名单共用） ---------- */

const NV_ENROLLS = []
let _nvEnrollSeq = 0

const _nvEnrollOf = enrollId => NV_ENROLLS.find(e => e.enrollId === enrollId) || null

const _NV_ENROLL_TYPE = {
  已报名: 'success', 已签到: '', 已取消: 'info', 已退款: 'warning', 候补中: 'warning'
}

function _nvEnrollRow(e) {
  const a = _nvActOf(e.activityId)
  const fee = a ? Number(a.fee) || 0 : 0
  return {
    enrollId: e.enrollId,
    activityId: e.activityId,
    activityTitle: a ? a.title : '（活动已删除）',
    activityStart: a ? a.startAt : '',
    ownerId: e.ownerId || '',
    name: e.name,
    phone: e.phone,
    houseShort: e.houseShort || '',
    people: e.people || 1,
    at: e.at,
    status: e.status,
    statusType: _NV_ENROLL_TYPE[e.status] || '',
    fee,
    amount: _nvR2(fee * (e.people || 1)),
    payStatus: fee > 0
      ? (['已取消', '已退款'].includes(e.status) ? '已退款' : '已支付')
      : '无需支付',
    attendees: (e.attendees || []).map(t => ({ ...t })),
    source: e.source || '业主自助',
    remark: e.remark || '',
    refundAmount: e.refundAmount || 0,
    refundAt: e.refundAt || '',
    cancelReason: e.cancelReason || ''
  }
}

const _NV_SURNAME = ['王', '李', '张', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗']
const _NV_GIVEN = ['语桐', '子墨', '思远', '雨桐', '浩然', '若曦', '宇轩', '梓涵', '沐宸', '一诺', '晨曦', '安然']

function _nvPerson(rng, i) {
  const pick = list => list[Math.floor(rng() * list.length) % list.length]
  return `${pick(_NV_SURNAME)}${pick(_NV_GIVEN)}`
}

function _nvSeedEnrolls() {
  activityEnrollments.forEach(e => {
    NV_ENROLLS.push({ ...e, source: '业主自助' })
  })

  /* 三条收费活动的报名：让「待成行」差 7 人、「已成行」刚过线，数字能对上 */
  const rng = (seed => {
    let s = seed % 2147483647
    if (s <= 0) s += 2147483646
    return () => (s = (s * 16807) % 2147483647) / 2147483647
  })(20261106 + 68)
  const plan = [
    { activityId: 'AC0013', count: 14, day: '2026-10-19' },
    { activityId: 'AC0014', count: 8, day: '2026-10-15' },
    { activityId: 'AC0015', count: 22, day: '2026-10-18' },
    { activityId: 'AC0017', count: 12, day: '2026-10-12' }
  ]
  const units = ['0701', '1102', '0302', '0503', '0901', '0204', '1201', '0802']
  plan.forEach(p => {
    for (let i = 0; i < p.count; i += 1) {
      _nvEnrollSeq += 1
      const people = rng() > 0.55 ? 2 : 1
      const attendees = []
      for (let k = 0; k < people; k += 1) {
        attendees.push({
          name: _nvPerson(rng, i + k),
          idType: '身份证',
          idNo: `5101${String(10 + (i % 80)).padStart(2, '0')}19${80 + (i % 20)}${String(1010 + i).slice(0, 4)}${String(1000 + i * 7).slice(-4)}`.slice(0, 18),
          phone: `138${String(10000000 + i * 137 + k).slice(-8)}`,
          ageType: k === 0 ? '成人' : (rng() > 0.6 ? '儿童' : '成人'),
          emergencyName: _nvPerson(rng, i + 3),
          emergencyPhone: `139${String(20000000 + i * 211).slice(-8)}`
        })
      }
      NV_ENROLLS.push({
        enrollId: `AE${String(300 + _nvEnrollSeq).padStart(4, '0')}`,
        activityId: p.activityId,
        ownerId: `OW${String(100 + i).padStart(5, '0')}`,
        name: attendees[0].name,
        phone: attendees[0].phone,
        houseShort: `${_nvActOf(p.activityId).communityId}-0${(i % 9) + 1}-${units[i % units.length]}`,
        people,
        at: `${p.day} ${String(9 + (i % 9)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`,
        status: i % 11 === 10 ? '已取消' : '已报名',
        attendees,
        source: i % 5 === 0 ? '前台代报' : '业主自助'
      })
    }
  })
}

/* ---------- 读 ---------- */

export function queryActivities({ pageNo = 1, size = 20, filters = {} } = {}) {
  if (!canViewActivities()) throw _nvError(`当前角色没有查看活动的权限（${NV_PERM.actView}）`, 403)
  return delay(() => {
    assertInScope({ communityId: filters.communityId })
    const list = NV_ACTS
      .filter(a => eq(a, filters.communityId, 'communityId'))
      .filter(a => eq(a, filters.category, 'category'))
      .filter(a => (filters.phase ? _nvPhaseOf(a) === filters.phase : true))
      .filter(a => kwHit(a, filters.kw, ['title', 'activityId', 'place']))
      .map(_nvActRow)
      .sort((a, b) => String(b.startAt).localeCompare(String(a.startAt)))
    return paged(list, pageNo, size)
  })
}

export function activityStats() {
  const rows = NV_ACTS.map(_nvActRow)
  const money = rows.filter(r => r.fee > 0)
  return {
    total: rows.length,
    running: rows.filter(r => r.phase === '报名中').length,
    waiting: rows.filter(r => r.phase === '待成行').length,
    odd: rows.filter(r => r.phase === '已成行').length,
    flowed: rows.filter(r => r.phase === '已流团').length,
    paidAmount: _nvR2(money.reduce((s, r) => s + r.paidAmount, 0)),
    enrollPeople: rows.reduce((s, r) => s + r.enrolled, 0),
    /** 待成行的活动一共还差多少人成团 —— 决定要不要发推送拉一把 */
    gapTotal: rows.filter(r => r.phase === '待成行').reduce((s, r) => s + r.gap, 0)
  }
}

export function getActivity(activityId) {
  const a = _nvActOf(activityId)
  return a ? _nvActRow(a) : null
}

/** 活动下拉（代报名、举报页跳转用） */
export function activityOpts() {
  return NV_ACTS
    .filter(a => _nvPhaseOf(a) !== '已结束' && _nvPhaseOf(a) !== '草稿')
    .map(a => ({ value: a.activityId, label: `${a.title} · ${String(a.startAt).slice(0, 10)}` }))
}

/* ---------- 写 ---------- */

function _nvValidateActivity(body = {}, cur = null) {
  const title = String(body.title || '').trim()
  if (!title) throw _nvError('活动名称必填')
  if (title.length > 40) throw _nvError('活动名称最多 40 字')
  const category = String(body.category || '').trim()
  if (!ACTIVITY_CATEGORIES.includes(category)) {
    throw _nvError(`活动类别只能是 ${ACTIVITY_CATEGORIES.join(' / ')}`)
  }
  if (!body.communityId) throw _nvError('必须选择项目')
  if (!body.startAt || !body.endAt) throw _nvError('开始与结束时间都要填')
  if (String(body.endAt) < String(body.startAt)) throw _nvError('结束时间不能早于开始时间')
  if (!String(body.place || '').trim()) throw _nvError('活动地点必填 —— 业主报名后要知道去哪')
  const capacity = Number(body.capacity) || 0
  if (capacity < 1) throw _nvError('名额至少 1 人')
  const deadline = String(body.enrollDeadline || '').slice(0, 10)
  if (!deadline) throw _nvError('报名截止时间必填')
  if (deadline > String(body.startAt).slice(0, 10)) {
    throw _nvError('报名截止不能晚于活动开始 —— 否则活动开始了还在收人')
  }
  const enrolled = cur ? _nvEnrolledOf(cur.activityId) : 0
  if (cur && capacity < enrolled) throw _nvError(`名额不能小于已报名人数（${enrolled} 人）`)

  const fee = Number(body.fee) || 0
  /* 收费与否只看金额：fee > 0 才需要成团下限与退款档位。
     想办收费活动却忘填单价 → 会静默变成免费活动，所以前端在提交前先拦一道
     （ed.feeMode === '收费' 但 fee 为空时提示），后端只按金额判。 */
  if (fee > 0) {
    const min = Number(body.minCapacity) || 0
    if (min < 1) throw _nvError('收费活动必须设成团下限 —— 否则收完钱团没成，退款没依据')
    if (min > capacity) throw _nvError('成团下限不能大于名额')
    const policy = body.refundPolicy || []
    if (!policy.length) throw _nvError('收费活动必须配退款分档')
    for (const p of policy) {
      const d = Number(p.days)
      const r = Number(p.ratio)
      if (!(d >= 0)) throw _nvError('退款分档的「提前天数」必须是 0 或正整数')
      if (!(r >= 0 && r <= 100)) throw _nvError('退款比例须在 0 ~ 100 之间')
    }
    /* 提前越久退得越多：反过来就是在惩罚早取消的人 */
    const sorted = [...policy].sort((a, b) => Number(b.days) - Number(a.days))
    for (let i = 1; i < sorted.length; i += 1) {
      if (Number(sorted[i].ratio) > Number(sorted[i - 1].ratio)) {
        throw _nvError('退款比例应随「提前天数」减少而降低，请检查分档')
      }
    }
    /* 钱已经收了再改单价，已报名的人金额就对不上 */
    if (cur && enrolled > 0 && Number(cur.fee) !== fee) {
      throw _nvError('已有人报名，不能再改单价。要调价请另开一场活动')
    }
  }
  return { capacity, fee, deadline }
}

export function saveActivity(body = {}, activityId = '') {
  if (!canEditActivities()) throw _nvError(`当前角色没有维护活动的权限（${NV_PERM.actEdit}）`, 403)
  const cur = activityId ? _nvActOf(activityId) : null
  if (activityId && !cur) throw _nvError('活动不存在', 40440)
  if (cur && (cur.status === '已结束' || cur.flowedAt)) {
    throw _nvError('已结束或已流团的活动不能再改，请复制一份新的', 40940)
  }
  const { capacity, fee, deadline } = _nvValidateActivity(body, cur)

  const patch = {
    title: String(body.title).trim(),
    category: String(body.category).trim(),
    communityId: body.communityId,
    startAt: body.startAt,
    endAt: body.endAt,
    place: String(body.place).trim(),
    capacity,
    minCapacity: fee > 0 ? Number(body.minCapacity) || 0 : 0,
    enrollDeadline: deadline,
    fee,
    feeInclude: String(body.feeInclude || '').trim(),
    feeExclude: String(body.feeExclude || '').trim(),
    refundPolicy: fee > 0 ? (body.refundPolicy || []).map(p => ({ days: Number(p.days), ratio: Number(p.ratio) })) : [],
    needInsurance: !!body.needInsurance,
    attendeeLimit: Math.max(1, Number(body.attendeeLimit) || 1),
    desc: String(body.desc || '').trim()
  }

  if (cur) {
    Object.assign(cur, patch)
    return _nvActRow(cur)
  }
  _nvActSeq += 1
  const row = {
    ...patch,
    activityId: `AC${String(100 + _nvActSeq).padStart(4, '0')}`,
    status: '草稿',
    organizer: '物业服务中心',
    views: 0,
    enrolled: 0,
    createdBy: currentOperator().name
  }
  NV_ACTS.unshift(row)
  return _nvActRow(row)
}

export function publishActivity(activityId) {
  if (!canEditActivities()) throw _nvError(`当前角色没有发布活动的权限（${NV_PERM.actEdit}）`, 403)
  const a = _nvActOf(activityId)
  if (!a) throw _nvError('活动不存在', 40440)
  if (a.status === '已结束') throw _nvError('已结束的活动不能重新发布，请复制一份', 40941)
  if (a.status === '报名中' && !a.flowedAt) throw _nvError('活动已经在报名中了', 40942)
  const phase = _nvPhaseOf(a)
  if (phase !== '草稿' && phase !== '已流团') throw _nvError(`当前状态是「${phase}」，不能重新发布`, 40943)
  if (toDay(a.enrollDeadline) < TODAY) throw _nvError(`报名截止 ${a.enrollDeadline} 已经过了，改一下再发布`)
  if (toDay(String(a.startAt).slice(0, 10)) < TODAY) throw _nvError('开始时间已经过了，改一下再发布')
  Object.assign(a, { status: '报名中', flowedAt: '', flowReason: '' })
  track('neighbor_activity_publish', { activityId })
  return _nvActRow(a)
}

export function endActivity(activityId) {
  if (!canEditActivities()) throw _nvError(`当前角色没有结束活动的权限（${NV_PERM.actEdit}）`, 403)
  const a = _nvActOf(activityId)
  if (!a) throw _nvError('活动不存在', 40440)
  if (a.status === '已结束') throw _nvError('活动已经结束了', 40944)
  Object.assign(a, { status: '已结束' })
  return _nvActRow(a)
}

/**
 * 确认流团：未达下限 → 全额退款。
 *
 * 这是「待成行」唯一的出口。不做的后果很具体：钱收了、团没成、活动日期到了，
 * 报名人自己发现没车来接，然后在群里炸。
 * 收费活动按已支付金额原路退，公益的只置取消。
 */
export function confirmFlow(activityId, reason = '') {
  if (!canEditActivities()) throw _nvError(`当前角色没有确认流团的权限（${NV_PERM.actEdit}）`, 403)
  const a = _nvActOf(activityId)
  if (!a) throw _nvError('活动不存在', 40440)
  if (_nvPhaseOf(a) !== '待成行') throw _nvError('只有「待成行」的活动才能确认流团', 40945)
  if (!String(reason || '').trim()) throw _nvError('流团必须写原因 —— 业主会来问为什么没成行')

  const list = NV_ENROLLS.filter(e => e.activityId === activityId && !['已取消', '已退款'].includes(e.status))
  let refunded = 0
  list.forEach(e => {
    if (a.fee > 0) {
      e.status = '已退款'
      e.refundAmount = _nvR2(a.fee * (e.people || 1))
      e.refundAt = _nvStamp()
      e.cancelReason = '未达成团人数，全额退款'
      refunded = _nvR2(refunded + e.refundAmount)
    } else {
      e.status = '已取消'
      e.cancelReason = '未达成团人数'
    }
  })
  Object.assign(a, { flowedAt: _nvStamp(), flowReason: String(reason).trim(), status: '已结束' })
  track('neighbor_activity_flow', { activityId, people: list.length, refunded })
  return { activity: _nvActRow(a), count: list.length, refunded }
}

/* ==================================================================
 * ③ 报名名单
 * ================================================================== */

export function queryEnrolls({ activityId = '', pageNo = 1, size = 20, filters = {} } = {}) {
  if (!canViewActivities()) throw _nvError(`当前角色没有查看报名名单的权限（${NV_PERM.actView}）`, 403)
  return delay(() => {
    const list = NV_ENROLLS
      .filter(e => !activityId || e.activityId === activityId)
      .filter(e => eq(e, filters.status, 'status'))
      .filter(e => kwHit(e, filters.kw, ['enrollId', 'name', 'phone', 'houseShort'],
        (e.attendees || []).map(t => t.name).join(',')))
      .map(_nvEnrollRow)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    return paged(list, pageNo, size)
  })
}

export function enrollStats(activityId) {
  const a = _nvActOf(activityId)
  const list = NV_ENROLLS.filter(e => e.activityId === activityId)
  const active = list.filter(e => !['已取消', '已退款'].includes(e.status))
  const fee = a ? Number(a.fee) || 0 : 0
  const paid = active.filter(e => e.status !== '已取消')
  return {
    total: list.length,
    people: active.reduce((s, e) => s + (e.people || 1), 0),
    checkedIn: list.filter(e => e.status === '已签到').length,
    cancelled: list.filter(e => e.status === '已取消').length,
    refunded: list.filter(e => e.status === '已退款').length,
    paidAmount: _nvR2(paid.reduce((s, e) => s + fee * (e.people || 1), 0)),
    refundAmount: _nvR2(list.reduce((s, e) => s + (e.refundAmount || 0), 0)),
    capacity: a ? a.capacity : 0,
    minCapacity: a ? Number(a.minCapacity) || 0 : 0,
    gap: a ? Math.max(0, (Number(a.minCapacity) || 0) - _nvEnrolledOf(activityId)) : 0,
    phase: a ? _nvPhaseOf(a) : ''
  }
}

/**
 * 代报名（前台/客服替业主报）。
 *
 * 现场最常见的场景：阿姨不会用小程序，前台帮她报、顺手收现金。
 * 所以这里允许直接标记"已收款"，而不是生成一笔待支付让人自己再去付。
 */
export function enrollActivity(activityId, body = {}) {
  if (!canEnrollActivities()) throw _nvError(`当前角色没有代报名的权限（${NV_PERM.actEnroll}）`, 403)
  const a = _nvActOf(activityId)
  if (!a) throw _nvError('活动不存在', 40440)
  const phase = _nvPhaseOf(a)
  if (phase !== '报名中') throw _nvError(`活动当前是「${phase}」，不能再报名`, 40946)

  const name = String(body.name || '').trim()
  if (!name) throw _nvError('联系人姓名必填')
  const phone = String(body.phone || '').trim()
  if (!/^1\d{10}$/.test(phone)) throw _nvError('联系电话须为 11 位手机号')
  const people = Math.max(1, Number(body.people) || 1)
  if (people > (a.attendeeLimit || 1)) throw _nvError(`这场活动每户最多报 ${a.attendeeLimit} 人`)
  if (_nvEnrolledOf(activityId) + people > a.capacity) {
    throw _nvError(`名额只剩 ${Math.max(0, a.capacity - _nvEnrolledOf(activityId))} 人`)
  }
  /* 要投保就必须有每一位出行人的实名信息 —— 只有联系人的话买不了保险 */
  const attendees = (body.attendees || []).filter(t => String(t.name || '').trim())
  if (a.needInsurance) {
    if (attendees.length !== people) throw _nvError(`需要投保，必须填满 ${people} 位出行人`)
    for (const t of attendees) {
      if (!String(t.idNo || '').trim()) throw _nvError(`出行人「${t.name}」缺证件号，无法投保`)
    }
  }

  _nvEnrollSeq += 1
  const row = {
    enrollId: `AE${String(300 + _nvEnrollSeq).padStart(4, '0')}`,
    activityId,
    ownerId: body.ownerId || '',
    name,
    phone,
    houseShort: body.houseShort || '',
    people,
    at: _nvStamp(),
    status: '已报名',
    attendees: attendees.map(t => ({
      name: t.name,
      idType: t.idType || '身份证',
      idNo: String(t.idNo || '').trim(),
      phone: t.phone || phone,
      ageType: t.ageType || '成人',
      emergencyName: t.emergencyName || '',
      emergencyPhone: t.emergencyPhone || ''
    })),
    source: '前台代报',
    remark: String(body.remark || '').trim(),
    /** 前台代收现金：直接记已支付，日结里能看到这笔 */
    paidCash: a.fee > 0 ? !!body.paid : false,
    /* 2026-11-06（Q3）：谁办的、怎么收的。以前只有 paidCash，业主说"我交过钱"没法核 */
    operator: String(body.operator || '').trim() || currentOperator().name,
    paymentMethod: a.fee > 0 && body.paid ? String(body.paymentMethod || '现金').trim() : ''
  }
  NV_ENROLLS.unshift(row)
  track('neighbor_enroll', { activityId, people })
  return _nvEnrollRow(row)
}

export function cancelEnroll(enrollId, reason = '', operator = '') {
  if (!canEnrollActivities()) throw _nvError(`当前角色没有取消报名的权限（${NV_PERM.actEnroll}）`, 403)
  const e = _nvEnrollOf(enrollId)
  if (!e) throw _nvError('报名记录不存在', 40447)
  if (['已取消', '已退款'].includes(e.status)) throw _nvError('这条报名已经取消了', 40948)
  if (e.status === '已签到') throw _nvError('已签到的不能再取消，请走退款并备注', 40949)
  const a = _nvActOf(e.activityId)
  if (a && Number(a.fee) > 0) {
    throw _nvError('收费活动的报名取消要同时退款，请用「取消并退款」', 40950)
  }
  Object.assign(e, { status: '已取消', cancelReason: String(reason || '').trim() || '业主主动取消' })
  return _nvEnrollRow(e)
}

/** 按分档算退款比例：距开始 ≥N 天 → 对应比例，否则取最后一档 */
export function refundRatioOf(activityId, atDay = TODAY) {
  const a = _nvActOf(activityId)
  if (!a || !a.refundPolicy || !a.refundPolicy.length) return 100
  const start = String(a.startAt).slice(0, 10)
  const gap = Math.floor((new Date(`${start}T00:00:00`) - new Date(`${toDay(atDay)}T00:00:00`)) / 86400000)
  /*
   * 必须**从天数大的往小找**：分档是「提前 7 天 100% / 3 天 50% / 当天 0%」，
   * 升序排第一个满足 gap>=days 的永远是 days=0 那档 —— 提前一个月取消也只退 0%。
   * 2026-11-06 修正：以前就是这个写法，退款金额一直按最低档算，页面只显示"已退款"没暴露。
   */
  const tier = [...a.refundPolicy]
    .sort((x, y) => Number(y.days) - Number(x.days))
    .find(p => gap >= Number(p.days))
  return tier ? Number(tier.ratio) : 0
}

export function refundEnroll(enrollId, reason = '', operator = '') {
  if (!canEnrollActivities()) throw _nvError(`当前角色没有办理退款的权限（${NV_PERM.actEnroll}）`, 403)
  const e = _nvEnrollOf(enrollId)
  if (!e) throw _nvError('报名记录不存在', 40447)
  if (e.status === '已退款') throw _nvError('这条报名已经退过款了', 40951)
  const a = _nvActOf(e.activityId)
  if (!a || Number(a.fee) <= 0) throw _nvError('公益活动的报名只需取消，无需退款', 40952)

  const ratio = refundRatioOf(e.activityId)
  const full = _nvR2(Number(a.fee) * (e.people || 1))
  const amount = _nvR2(full * ratio / 100)
  Object.assign(e, {
    status: '已退款',
    refundAmount: amount,
    refundAt: _nvStamp(),
    refundBy: operator || currentOperator().name,
    cancelReason: String(reason || '').trim() || `按退款规则（提前档位 ${ratio}%）退款`
  })
  track('neighbor_enroll_refund', { enrollId, amount, ratio })
  return { enroll: _nvEnrollRow(e), ratio, full, amount }
}

export function checkinEnroll(enrollId, operator = '') {
  if (!canEnrollActivities()) throw _nvError(`当前角色没有签到的权限（${NV_PERM.actEnroll}）`, 403)
  const e = _nvEnrollOf(enrollId)
  if (!e) throw _nvError('报名记录不存在', 40447)
  if (e.status === '已签到') throw _nvError('已经签到过了', 40953)
  if (e.status !== '已报名') throw _nvError(`「${e.status}」的报名不能签到`, 40954)
  const a = _nvActOf(e.activityId)
  if (a && _nvPhaseOf(a) === '待成行') throw _nvError('活动还没确定成行，暂时不能签到', 40955)
  Object.assign(e, { status: '已签到', checkinBy: operator || currentOperator().name, checkinAt: _nvStamp() })
  return _nvEnrollRow(e)
}

/* ==================================================================
 * ④ 闲置（先审后发）
 * ================================================================== */

const NV_ITEMS = []
let _nvItemSeq = 0

const _nvItemOf = itemId => NV_ITEMS.find(i => i.itemId === itemId) || null

function _nvItemRow(i) {
  return {
    itemId: i.itemId,
    title: i.title,
    category: i.category,
    price: Number(i.price) || 0,
    originPrice: Number(i.originPrice) || 0,
    freeGive: !i.price,
    condition: i.condition || '九成新',
    images: i.images || 0,
    desc: i.desc || '',
    communityId: i.communityId,
    communityName: communityName(i.communityId),
    sellerName: i.sellerName,
    sellerType: i.sellerType || '业主',
    sellerHouse: i.sellerHouse,
    sellerPhone: i.sellerPhone || '',
    contactMode: i.contactMode || '站内私信',
    publishAt: i.publishAt,
    status: i.status,
    statusType: _NV_STATUS_TYPE[i.status] || '',
    rejectReason: i.rejectReason || '',
    auditBy: i.auditBy || '',
    auditAt: i.auditAt || '',
    offlineReason: i.offlineReason || '',
    expireAt: i.expireAt || '',
    views: i.views || 0,
    wants: i.wants || 0,
    reportCount: i.reportCount || 0,
    source: i.source || '业主发布'
  }
}

function _nvSeedItems() {
  secondhandItems.forEach(i => {
    NV_ITEMS.push({
      ...i,
      status: '已上架',
      sellerType: '业主',
      sellerPhone: i.wechat ? '' : '138****' + String(1000 + (i.views || 0)).slice(-4),
      contactMode: '站内私信',
      auditBy: '物业代发（历史数据）',
      auditAt: i.publishAt,
      expireAt: '',
      reportCount: 0,
      source: '物业代发'
    })
  })

  /* 待审 / 驳回 / 下架 / 过期 四类各来几条，审核队列才有东西可点 */
  const seed = [
    ['宜家儿童书桌（白色）', '家具', 120, 399, 'P01', '陈**', 'P01-012-0302', '九成新', '待审核', '2026-10-21 09:12', '业主'],
    ['小米空气净化器 4', '家电', 260, 899, 'P02', '李**', 'P02-003-1102', '八成新', '待审核', '2026-10-21 08:40', '业主'],
    ['捷安特山地车 26 寸', '其他', 420, 1580, 'P03', '王**', 'P03-005-0701', '七成新', '待审核', '2026-10-20 20:15', '租户'],
    ['全新未拆封 乐高得宝 10874', '母婴', 150, 399, 'P01', '周**', 'P01-007-0403', '全新', '待审核', '2026-10-20 19:02', '业主'],
    ['实木餐椅 4 把（自提）', '家具', 200, 1200, 'P02', '吴**', 'P02-009-0802', '八成新', '待审核', '2026-10-20 16:30', '业主'],
    ['罗技 MX Keys 键盘', '数码', 380, 899, 'P03', '徐**', 'P03-002-1201', '九成新', '待审核', '2026-10-20 14:20', '租户'],
    ['儿童安全座椅 0-4 岁', '母婴', 350, 1299, 'P01', '孙**', 'P01-003-0601', '九成新', '待审核', '2026-10-20 11:05', '业主'],
    ['西门子嵌入式洗碗机（需自拆）', '家电', 600, 6800, 'P02', '马**', 'P02-011-0301', '六成新', '待审核', '2026-10-19 22:41', '业主'],
    ['茅台飞天 53 度 500ml ×2', '其他', 2600, 2999, 'P01', '朱**', 'P01-001-0101', '全新', '已驳回', '2026-10-19 10:30', '业主'],
    ['布偶猫幼崽 2 个月', '其他', 1800, 0, 'P02', '胡**', 'P02-006-0903', '全新', '已驳回', '2026-10-18 15:22', '租户'],
    ['自制药酒（外用）', '其他', 80, 0, 'P03', '郭**', 'P03-008-0502', '全新', '已驳回', '2026-10-18 09:10', '业主'],
    ['某品牌代餐粉（无中文标签）', '其他', 99, 398, 'P01', '何**', 'P01-009-1104', '全新', '已下架', '2026-10-17 13:45', '业主'],
    ['二手笔记本电脑 i5 8G', '数码', 1200, 4999, 'P02', '林**', 'P02-004-0205', '七成新', '已下架', '2026-10-16 18:20', '业主'],
    ['三人位布艺沙发 免费送', '家具', 0, 2600, 'P03', '罗**', 'P03-006-0304', '五成新', '已过期', '2026-09-12 10:00', '业主']
  ]
  seed.forEach((s, i) => {
    _nvItemSeq += 1
    NV_ITEMS.push({
      itemId: `SH${String(100 + _nvItemSeq).padStart(4, '0')}`,
      title: s[0], category: s[1], price: s[2], originPrice: s[3],
      communityId: s[4], sellerName: s[5], sellerHouse: s[6], condition: s[7],
      status: s[8], publishAt: s[9], sellerType: s[10],
      images: 2 + (i % 4),
      desc: '自用闲置，功能正常，成色见实拍。小区内自提，介意议价勿扰。',
      sellerPhone: `138****${String(2000 + i * 37).slice(-4)}`,
      contactMode: '站内私信',
      views: 10 + i * 7,
      wants: i % 6,
      auditBy: ['已驳回', '已下架', '已过期'].includes(s[8]) ? '物业服务中心' : '',
      auditAt: ['已驳回', '已下架'].includes(s[8]) ? s[9] : '',
      rejectReason: s[0].includes('茅台') ? '平台禁售酒类，请自行线下处理'
        : s[0].includes('布偶猫') ? '禁止发布活体动物'
          : s[0].includes('药酒') ? '自制药酒属食品/药品，无资质不得发布' : '',
      offlineReason: s[0].includes('代餐') ? '举报核实：无中文标签，涉嫌三无食品'
        : s[0].includes('笔记本') ? '举报核实：无法说明来源' : '',
      expireAt: s[8] === '已过期' ? '2026-10-12' : '',
      reportCount: s[8] === '已下架' ? 3 : 0,
      source: '业主发布'
    })
  })
}

/* ---------- 读 ---------- */

export function queryItems({ pageNo = 1, size = 20, filters = {} } = {}) {
  if (!canViewItems()) throw _nvError(`当前角色没有查看闲置内容的权限（${NV_PERM.itemView}）`, 403)
  return delay(() => {
    assertInScope({ communityId: filters.communityId })
    const list = NV_ITEMS
      .filter(i => eq(i, filters.communityId, 'communityId'))
      .filter(i => eq(i, filters.status, 'status'))
      .filter(i => eq(i, filters.category, 'category'))
      .filter(i => eq(i, filters.sellerType, 'sellerType'))
      .filter(i => kwHit(i, filters.kw, ['itemId', 'title', 'sellerName', 'desc'],
        `${i.sellerHouse || ''}`))
      .map(_nvItemRow)
      .sort((a, b) => {
        /* 待审永远排最前：队列页要的就是"下一步做什么" */
        if ((a.status === '待审核') !== (b.status === '待审核')) return a.status === '待审核' ? -1 : 1
        return String(b.publishAt).localeCompare(String(a.publishAt))
      })
    return paged(list, pageNo, size)
  })
}

export function itemStats() {
  const all = NV_ITEMS
  const audited = all.filter(i => ['已上架', '已驳回'].includes(i.status))
  const todayNew = all.filter(i => String(i.publishAt).slice(0, 10) === TODAY).length
  return {
    total: all.length,
    pending: all.filter(i => i.status === '待审核').length,
    online: all.filter(i => i.status === '已上架').length,
    rejected: all.filter(i => i.status === '已驳回').length,
    offline: all.filter(i => i.status === '已下架').length,
    expired: all.filter(i => i.status === '已过期').length,
    todayNew,
    passRate: audited.length ? _nvR2((audited.filter(i => i.status === '已上架').length / audited.length) * 100) : 0,
    reported: all.reduce((s, i) => s + (i.reportCount || 0), 0)
  }
}

export function getItem(itemId) {
  const i = _nvItemOf(itemId)
  return i ? _nvItemRow(i) : null
}

export function itemCategories() {
  return [...new Set(NV_ITEMS.map(i => i.category))]
}

/* ---------- 写 ---------- */

export function auditItem(itemId, { pass = true, reason = '', operator = '' } = {}) {
  if (!canAuditItems()) throw _nvError(`当前角色没有审核闲置的权限（${NV_PERM.itemAudit}）`, 403)
  const i = _nvItemOf(itemId)
  if (!i) throw _nvError('内容不存在', 40460)
  if (i.status !== '待审核') throw _nvError(`这条已经是「${i.status}」，不能重复审核`, 40960)
  const why = String(reason || '').trim()
  if (!pass && !why) throw _nvError('驳回必须写理由 —— 业主会拿着通知来问为什么')
  Object.assign(i, {
    status: pass ? '已上架' : '已驳回',
    rejectReason: pass ? '' : why,
    /* operator 由员工端传入（移动端登录人）；PC 不传则沿用当前角色对应的人 */
    auditBy: operator || currentOperator().name,
    auditAt: _nvStamp()
  })
  track('neighbor_item_audit', { itemId, pass })
  return _nvItemRow(i)
}

export function offlineItem(itemId, reason = '', operator = '') {
  if (!canAuditItems()) throw _nvError(`当前角色没有下架内容的权限（${NV_PERM.itemAudit}）`, 403)
  const i = _nvItemOf(itemId)
  if (!i) throw _nvError('内容不存在', 40460)
  if (i.status === '已下架') throw _nvError('这条已经下架了', 40961)
  if (i.status !== '已上架') throw _nvError(`只有「已上架」的内容能下架，当前是「${i.status}」`, 40962)
  const why = String(reason || '').trim()
  if (!why) throw _nvError('下架必须写理由')
  Object.assign(i, { status: '已下架', offlineReason: why, auditBy: operator || currentOperator().name, auditAt: _nvStamp() })
  track('neighbor_item_offline', { itemId })
  return _nvItemRow(i)
}

/* ==================================================================
 * ⑤ 举报
 * ================================================================== */

const NV_REPORTS = []
let _nvReportSeq = 0

const _nvReportOf = reportId => NV_REPORTS.find(r => r.reportId === reportId) || null

function _nvReportRow(r) {
  const i = _nvItemOf(r.itemId)
  return {
    reportId: r.reportId,
    itemId: r.itemId,
    itemTitle: i ? i.title : '（内容已删除）',
    itemStatus: i ? i.status : '',
    /* 2026-11-06：移动端要按登录人项目过滤举报（举报记录本身没有 communityId，
       取被举报内容的项目）。PC 页面不读这两个字段，不影响。 */
    communityId: i ? i.communityId : '',
    communityName: i ? communityName(i.communityId) : '',
    sellerName: i ? i.sellerName : '',
    sellerHouse: i ? i.sellerHouse : '',
    reason: r.reason,
    detail: r.detail,
    reporterName: r.reporterName,
    reporterHouse: r.reporterHouse,
    at: r.at,
    status: r.status,
    statusType: r.status === '待处理' ? 'warning' : 'info',
    action: r.action || '',
    note: r.note || '',
    handledBy: r.handledBy || '',
    handledAt: r.handledAt || ''
  }
}

function _nvSeedReports() {
  const seed = [
    ['SH0109', '违禁品', '这酒是假的吧？物业也不管管，小区里能随便卖酒？', '周**', 'P01-003-0602', '2026-10-20 21:10', '待处理'],
    ['SH0110', '违禁品', '在小区里卖活体宠物，卫生谁负责', '李**', 'P02-002-0801', '2026-10-19 09:30', '待处理'],
    ['SH0112', '虚假信息', '这个代餐粉我买过，吃完拉肚子，包装上全是英文没有中文标签', '陈**', 'P01-009-1105', '2026-10-18 14:02', '待处理'],
    ['SH0113', '疑似诈骗', '笔记本来源不明，价格低得离谱，怕是赃物', '王**', 'P02-004-0206', '2026-10-17 11:20', '待处理'],
    ['SH0007', '骚扰辱骂', '私信里骂人，说话很难听', '刘**', 'P01-002-0301', '2026-10-16 19:40', '已处理'],
    ['SH0012', '重复刷屏', '同一个人连发五条一样的', '杨**', 'P02-008-0402', '2026-10-15 08:55', '已处理']
  ]
  seed.forEach(s => {
    _nvReportSeq += 1
    NV_REPORTS.push({
      reportId: `RP${String(100 + _nvReportSeq).padStart(4, '0')}`,
      itemId: s[0], reason: s[1], detail: s[2], reporterName: s[3], reporterHouse: s[4],
      at: s[5], status: s[6],
      action: s[6] === '已处理' ? (s[1] === '骚扰辱骂' ? '仅警告' : '忽略') : '',
      note: s[6] === '已处理' ? '已联系双方，暂不涉及违规内容' : '',
      handledBy: s[6] === '已处理' ? _nvStaff('客服主管').name : '',
      handledAt: s[6] === '已处理' ? s[5].replace(/\d{2}:\d{2}$/, '20:30') : ''
    })
  })
}

export function queryReports({ pageNo = 1, size = 20, filters = {} } = {}) {
  if (!canViewReports()) throw _nvError(`当前角色没有查看举报的权限（${NV_PERM.reportView}）`, 403)
  return delay(() => {
    const list = NV_REPORTS
      .filter(r => eq(r, filters.status, 'status'))
      .filter(r => eq(r, filters.reason, 'reason'))
      .filter(r => {
        const i = _nvItemOf(r.itemId)
        return kwHit({ ...r, itemTitle: i ? i.title : '' }, filters.kw, ['itemTitle', 'reporterName', 'detail'])
      })
      .map(_nvReportRow)
      .sort((a, b) => {
        if ((a.status === '待处理') !== (b.status === '待处理')) return a.status === '待处理' ? -1 : 1
        return String(b.at).localeCompare(String(a.at))
      })
    return paged(list, pageNo, size)
  })
}

export function reportStats() {
  return {
    total: NV_REPORTS.length,
    pending: NV_REPORTS.filter(r => r.status === '待处理').length,
    handled: NV_REPORTS.filter(r => r.status === '已处理').length,
    offline: NV_REPORTS.filter(r => r.action === '下架并警告').length
  }
}

export function handleReport(reportId, { action = '', note = '', operator = '' } = {}) {
  if (!canHandleReports()) throw _nvError(`当前角色没有处理举报的权限（${NV_PERM.reportHandle}）`, 403)
  const r = _nvReportOf(reportId)
  if (!r) throw _nvError('举报不存在', 40470)
  if (r.status === '已处理') throw _nvError('这条举报已经处理过了', 40970)
  if (!REPORT_ACTIONS.includes(action)) throw _nvError('请选择处理方式')
  if (!String(note || '').trim()) throw _nvError('处理说明必填 —— 事后要能解释为什么这么判')

  const i = _nvItemOf(r.itemId)
  if (action === '下架并警告' && i && i.status === '已上架') {
    i.status = '已下架'
    i.offlineReason = `举报核实：${r.reason}`
    i.auditBy = operator || currentOperator().name
    i.auditAt = _nvStamp()
  }
  Object.assign(r, {
    status: '已处理',
    action,
    note: String(note).trim(),
    handledBy: operator || currentOperator().name,
    handledAt: _nvStamp()
  })
  track('neighbor_report_handle', { reportId, action })
  return _nvReportRow(r)
}

/* ==================================================================
 * ⑥ 工作台汇总
 * ================================================================== */

export function neighborSummary() {
  if (!canViewNeighborWorkbench()) throw _nvError(`当前角色没有查看邻里工作台的权限（${NV_PERM.workbench}）`, 403)
  const votes = NV_VOTES.map(_nvVoteRow)
  const acts = NV_ACTS.map(_nvActRow)
  const items = NV_ITEMS.map(_nvItemRow)
  const reports = NV_REPORTS.map(_nvReportRow)

  /* 公告阅读率取自已发布公告：邻里不另建一套阅读统计，否则两个数会不一样 */
  const published = notices.filter(n => n.status === '已发布' && n.targetHouses)
  const readRate = published.length
    ? _nvR2(published.reduce((s, n) => s + (n.readCount || 0) / n.targetHouses, 0) / published.length * 100)
    : 0

  const enrollAll = acts.filter(a => a.phase !== '草稿').reduce((s, a) => s + a.enrolled, 0)
  const capAll = acts.filter(a => a.phase !== '草稿').reduce((s, a) => s + a.capacity, 0)

  return {
    todo: {
      items: items.filter(i => i.status === '待审核').length,
      reports: reports.filter(r => r.status === '待处理').length,
      waiting: acts.filter(a => a.phase === '待成行').length,
      votes: votes.filter(v => v.status === '进行中').length
    },
    kpi: {
      readRate,
      /* 活动报名率上限 100%：有活动的报名数超过名额（种子数据），不封顶会算出 100%+ */
      enrollFill: capAll ? Math.min(100, _nvR2(enrollAll / capAll * 100)) : 0,
      votePart: votes.filter(v => v.status === '进行中').length
        ? _nvR2(votes.filter(v => v.status === '进行中').reduce((s, v) => s + v.partRate, 0) / votes.filter(v => v.status === '进行中').length)
        : 0,
      itemPass: (() => {
        const a = items.filter(i => ['已上架', '已驳回'].includes(i.status))
        return a.length ? _nvR2(a.filter(i => i.status === '已上架').length / a.length * 100) : 0
      })(),
      reportPending: reports.filter(r => r.status === '待处理').length
    },
    votes: votes.filter(v => v.status === '进行中').sort((a, b) => a.partRate - b.partRate).slice(0, 3),
    acts: acts.filter(a => a.phase === '待成行' || a.phase === '报名中')
      .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))).slice(0, 4),
    items: items.filter(i => i.status === '待审核')
      .sort((a, b) => String(a.publishAt).localeCompare(String(b.publishAt))).slice(0, 5),
    reports: reports.filter(r => r.status === '待处理').slice(0, 3),
    at: _nvStamp()
  }
}

/* 统一初始化：模块加载时跑一次，顺序有依赖 ---------- */
_nvSeedVotes()
_nvNormalizeVotes()
_nvSeedActivities()
_nvSeedEnrolls()
_nvSeedItems()
_nvSeedReports()

/* ==================================================================
 * A 域子模块 · 租售信息（2026-11-06 第 69 批）
 *
 * 只做**信息发布**：业主把房租出去的信息挂出来，责任楼管审一道，想租的人留电话。
 * 物业全程不参与撮合与成交 —— 这条守住，它就是物业服务；破了，它就是房地产经纪，
 * 需要《房地产经纪机构备案表》，微信类目也要换。
 *
 * 四条硬口径（后端实现时别丢）：
 *   ① **审核人 = 该房的责任楼管**，不是"审核员"。按 house.stewardEmpId 分派；
 *      24 小时未审升到直属上级（按 orgLeaders 解析，不写死角色名）。
 *   ② **楼管手机号不出现在任何对外返回里**。访客要联系就留自己的号码，楼管回拨。
 *      方向反过来，责任也反过来：要保护的是访客的号码。
 *   ③ **审核只针对「内容版本」**：contentVersion !== auditedVersion 才需要再审。
 *      业主原样续挂、原样重新上架直接回「已发布」，否则每 60 天全量重审一遍。
 *   ④ 面积 / 户型 / 朝向 / 楼层**一律从 house 派生**，不存副本。
 *      存了副本，房本面积一改挂牌页就是错的，而且没人知道哪个准。
 *
 * 与商业系统的关系：零。不进商业系统，不再有"佣金"这个字段存在的理由。
 * ================================================================== */

const LV_PERM_VIEW = 'a.listings.view'
const LV_PERM_AUDIT = 'a.listings.audit'
const LV_PERM_VIEWING = 'a.listings.viewing'

export const canViewListings = () => _hasPerm(LV_PERM_VIEW)
export const canAuditListings = () => _hasPerm(LV_PERM_AUDIT)
export const canViewListingsViewing = () => _hasPerm(LV_PERM_VIEWING)

export const LISTING_STATUS = ['待审核', '已发布', '已驳回', '已下架', '已过期', '已成交']
export const LISTING_DECORATE = ['毛坯', '简装', '精装', '豪装']
export const LISTING_PAY_TERM = ['押一付一', '押一付三', '押二付一', '半年付', '年付']
export const LISTING_FACILITIES = ['冰箱', '洗衣机', '空调', '热水器', '宽带', '家私', '电梯', '车位']
export const VIEWING_STATUS = ['待联系', '已联系', '已带看', '已关闭']

const _LV_STATUS_TYPE = {
  待审核: 'warning', 已发布: 'success', 已驳回: 'danger',
  已下架: 'info', 已过期: 'info', 已成交: ''
}
const _LV_VIEWING_TYPE = { 待联系: 'warning', 已联系: 'success', 已带看: 'success', 已关闭: 'info' }

const _lvError = (msg, code = 42240) => Object.assign(new Error(msg), { code })
const _lvR2 = n => Math.round((Number(n) || 0) * 100) / 100
const _lvStamp = () => `${TODAY} ${_now().slice(11, 16)}`

/** 演示时钟的"现在"：2026-10-21 10:00，与 PC 其它页一致 */
const _lvNow = () => new Date(`${TODAY}T10:00:00`)

/** 距创建过了多少小时 —— 列表要显示"已等 6 小时"，运营看的就是这个 */
function _lvHoursSince(at) {
  const t = new Date(String(at || '').replace(/-/g, '/')).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.round((_lvNow().getTime() - t) / 3600000))
}

/** 手机号：有敏感字段权限给明文，否则脱敏。楼管要联系业主，客服核对身份也要 */
const _lvPhone = p => (_hasPerm('a.sensitive.view') ? p : maskPhone(p))

const LISTINGS = []
const VIEWINGS = []
let _lvSeq = 0
let _lvViewSeq = 0

const _lvOf = listingId => LISTINGS.find(x => x.listingId === listingId) || null
const _lvViewOf = viewingId => VIEWINGS.find(x => x.viewingId === viewingId) || null

/** 房源派生信息：全部从 house 取，不落库 */
function _lvHouseOf(listing) {
  const h = houses.find(x => x.houseId === listing.houseId) || {}
  const b = buildings.find(x => x.buildingId === h.buildingId)
  const u = units.find(x => x.unitId === h.unitId)
  return {
    houseId: h.houseId,
    communityId: h.communityId,
    communityName: communityName(h.communityId),
    buildingId: h.buildingId,
    buildingName: b ? b.name : '',
    unitName: u ? u.name : '',
    room: h.room,
    houseShort: h.shortName,
    fullName: h.fullName,
    houseType: h.houseType,
    area: h.area,
    orientation: h.orientation,
    floor: h.floor,
    decoration: h.decoration
  }
}

function _lvOwnerOf(listing, full = false) {
  const o = owners.find(x => x.ownerId === listing.ownerId) || {}
  /* 列表脱敏、详情/审核给全号 —— 与看房请求同一条规矩：
     会被投屏和截图的页面不摆全号，需要操作的场景才给。 */
  return {
    ownerId: o.ownerId,
    ownerName: o.name,
    ownerPhone: full ? _lvPhone(o.phone) : maskPhone(o.phone),
    certified: !!o.certified
  }
}

function _lvStewardOf(listing) {
  const e = employees.find(x => x.empId === listing.stewardEmpId) || {}
  /* 对外只给姓名与微信，手机号永不出现在这里 —— 见文件头第 ② 条 */
  return { empId: e.empId, name: e.name, position: e.position, wechatId: e.wechatId || '', qrUrl: e.contactQrUrl || '' }
}

function _lvRow(l) {
  const h = _lvHouseOf(l)
  const o = _lvOwnerOf(l)
  const s = _lvStewardOf(l)
  const hours = _lvHoursSince(l.createdAt)
  const pending = l.status === '待审核'
  return {
    listingId: l.listingId,
    ...h,
    ...o,
    stewardEmpId: s.empId,
    stewardName: s.name,
    stewardPosition: s.position,
    stewardWechat: s.wechatId,
    price: l.price,
    deposit: l.deposit,
    payTerm: l.payTerm,
    decorate: l.decorate,
    facilities: [...(l.facilities || [])],
    availableFrom: l.availableFrom,
    desc: l.desc,
    images: l.images || 0,
    status: l.status,
    statusType: _LV_STATUS_TYPE[l.status] || '',
    contentVersion: l.contentVersion,
    auditedVersion: l.auditedVersion,
    needAudit: l.contentVersion !== l.auditedVersion,
    createdAt: l.createdAt,
    hoursWaiting: hours,
    /** 超 24h 未审 = 已升级给上级；超 48h 标红 */
    overdue: pending && hours > 24,
    escalated: pending && hours > 48,
    expireAt: l.expireAt,
    dealAt: l.dealAt || '',
    auditBy: l.auditBy || '',
    auditAt: l.auditAt || '',
    rejectReason: l.rejectReason || '',
    offlineBy: l.offlineBy || '',
    offlineAt: l.offlineAt || '',
    offlineReason: l.offlineReason || '',
    viewCount: l.viewCount || 0,
    leadCount: VIEWINGS.filter(v => v.listingId === l.listingId).length
  }
}

function _lvViewRow(v) {
  const l = _lvOf(v.listingId)
  const h = l ? _lvHouseOf(l) : {}
  const s = l ? _lvStewardOf(l) : {}
  const hours = _lvHoursSince(v.createdAt)
  const pending = v.status === '待联系'
  return {
    viewingId: v.viewingId,
    listingId: v.listingId,
    ...h,
    price: l ? l.price : 0,
    name: v.name,
    /* 列表只给脱敏号码：这一页会被投屏、截图、导出，全号摆一屏迟早出事。
       完整号码在 getViewing（详情）里给，并且要留访问痕迹。 */
    phone: maskPhone(v.phone),
    phoneFull: _lvPhone(v.phone),
    preferredTime: v.preferredTime,
    note: v.note,
    status: v.status,
    statusType: _LV_VIEWING_TYPE[v.status] || '',
    createdAt: v.createdAt,
    hoursWaiting: hours,
    overdue: pending && hours > 24,
    escalated: pending && hours > 48,
    stewardEmpId: s.empId || '',
    stewardName: s.name || '',
    handledBy: v.handledBy || '',
    handledAt: v.handledAt || '',
    resultNote: v.resultNote || ''
  }
}

/* ---------------- 种子 ----------------
 * 一条挂牌 = 一套真房子。业主、楼管、面积户型全部从 house/owner/employee 关联出来，
 * 不编造"某某小区 3 室 120 平"这种假条目 —— 审核页要能点进业主档案核对。
 */
function _lvRand(seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

function _lvSeed() {
  const rng = _lvRand(20261106 + 69)
  const pick = list => list[Math.floor(rng() * list.length) % list.length]

  /*
   * 对外联系方式（微信号 / 二维码）挂在员工档案上，租售信息页展示给看房者。
   * 样例数据里没有这两个字段 —— 不补的话「我的 → 联系方式」第一次进来是一片空白，
   * 看不出"没填"和"填了没显示"的区别。只补楼栋管家：其他岗位本就不对外展示。
   * 放在 rng 取数之后，不参与随机序列，加这行不会让下面的样例数据漂移。
   */
  employees.forEach(e => {
    if (e.position !== '楼栋管家') return
    if (e.wechatId === undefined) e.wechatId = `wx_${String(e.phone || e.empNo || '').slice(-4)}`
    if (e.contactQrUrl === undefined) e.contactQrUrl = ''
  })

  /* 只取「住宅 + 已入住 + 有产权人」：空置房挂出来等于公示这套没人住 */
  const pool = houses.filter(h => h.usage === '住宅' && h.useStatus === '已入住' && h.ownerId && h.stewardEmpId)
  const picked = []
  const used = new Set()
  const take = h => { if (h && !used.has(h.houseId)) { used.add(h.houseId); picked.push(h); return true } return false }

  /*
   * 每位楼栋管家各保证 2 套 —— 原来只给「锚点楼管」6 套。
   *
   * 只给一个人的后果很具体：审核权、看房请求都挂在 `stewardEmpId` 上，
   * 其他楼管用责任范围进来是 0 条；手机端按责任楼管过滤，页面直接空白，
   * 看着像功能坏了（第 69 批交付后翡翠城的莫瑞就撞上了这个）。
   *
   * 锚点规则与 currentScope() 一致：优先取挂在项目部的那个，排在第一位多分不到，只是顺序靠前。
   */
  const stw = employees.filter(e => e.position === '楼栋管家' && e.status !== '离职')
  const anchorSteward = stw.find(e => communityOfOrg(e.orgId)) || stw[0]
  const anchors = anchorSteward ? [anchorSteward, ...stw.filter(e => e !== anchorSteward)] : stw
  anchors.forEach(e => pool.filter(h => h.stewardEmpId === e.empId).slice(0, 2).forEach(take))
  let guard = 0
  while (picked.length < 14 && guard < 4000) {
    guard += 1
    take(pool[Math.floor(rng() * pool.length) % pool.length])
  }

  const FAC_GROUPS = [
    ['冰箱', '洗衣机', '空调', '热水器', '宽带', '家私'],
    ['空调', '热水器', '宽带'],
    ['冰箱', '洗衣机', '空调', '热水器', '电梯'],
    ['空调', '宽带', '家私', '车位']
  ]
  const DESCS = [
    '自住出租，家具家电齐全，可拎包入住。小区中间楼层，采光好，楼下就是儿童乐园。',
    '业主长期在外地，房子一直空着，希望租给爱干净、稳定的家庭。',
    '近地铁 4 号线，步行 8 分钟。周边有菜市场和幼儿园，适合小两口。',
    '刚做过深度保洁，厨房卫生间都是新换的。不接受养宠物，介意勿扰。',
    '南北通透，主卧带阳台。租期一年起，押一付三。',
    '业主自住三年，保养得好。楼下有充电桩车位，有车的话可以一起租。'
  ]

  /* 状态手工排布：审核页和"已升级"标红都要有东西可看 */
  const plan = [
    /* 待审核 4 条：两条超 48h（已升级）、一条刚提交、一条超 24h */
    { status: '待审核', hoursAgo: 60 },
    { status: '待审核', hoursAgo: 52 },
    { status: '待审核', hoursAgo: 30 },
    { status: '待审核', hoursAgo: 3 },
    /* 已发布 6 条 */
    { status: '已发布', hoursAgo: 240 },
    { status: '已发布', hoursAgo: 190 },
    { status: '已发布', hoursAgo: 150 },
    { status: '已发布', hoursAgo: 96 },
    { status: '已发布', hoursAgo: 40 },
    { status: '已发布', hoursAgo: 12 },
    /* 已驳回 1 */
    {
      status: '已驳回', hoursAgo: 72,
      rejectReason: '第 3 张图拍到了门牌号，请删掉或打码后重新提交'
    },
    /* 已下架 1（物业强制） */
    {
      status: '已下架', hoursAgo: 300,
      offlineReason: '业主已当面告知房子已租出，联系不上，先强制下架'
    },
    /* 已过期 1 */
    { status: '已过期', hoursAgo: 1600 },
    /* 已成交 1 */
    { status: '已成交', hoursAgo: 700, dealAt: '2026-10-02 15:20' }
  ]

  /*
   * 待审核的 4 条要**分散到不同楼管**。
   * 原来是按 picked 顺序取前 4 套，而 picked 前 6 套是"锚点楼管"的房子 ——
   * 结果 4 条待审全压在一个人身上，其他楼管进去看到 0 条。
   * PC 上还能靠"全部项目"看出有数据，手机上按责任楼管过滤，就是一片空白，
   * 看着像功能坏了（第 69 批交付后业主端在翡翠城就撞上了这个）。
   */
  const byStw = new Map()
  picked.forEach(h => {
    const k = h.stewardEmpId
    if (!byStw.has(k)) byStw.set(k, [])
    byStw.get(k).push(h)
  })
  /* 按楼管轮转重排：待审核和看房请求都挂在"谁的房子"上，全压在锚点一个人身上，
     别的楼管打开就是空的（PC 还能靠"全部项目"自证，手机上按责任楼管过滤，看着像功能坏了） */
  const rotated = []
  {
    const buckets = [...byStw.values()].map(list => list.slice())
    for (let guard = 0; rotated.length < picked.length && guard < 200; guard += 1) {
      const q = buckets[guard % buckets.length]
      if (q && q.length) rotated.push(q.shift())
    }
  }

  plan.forEach((p, i) => {
    /* 兜底回 picked[i]：宁可重复一套房，也不能让 h.area 读到 undefined 把整页打崩 */
    const h = rotated[i] || picked[i]
    _lvSeq += 1
    const createdAt = new Date(_lvNow().getTime() - p.hoursAgo * 3600000)
    const pad = n => String(n).padStart(2, '0')
    const at = `${createdAt.getFullYear()}-${pad(createdAt.getMonth() + 1)}-${pad(createdAt.getDate())} ${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}`
    const dec = pick(LISTING_DECORATE)
    const area = Number(h.area) || 90
    /* 租金按面积估，25~32 元/平，取整到 50 */
    const rate = 25 + Math.round(rng() * 7)
    const price = Math.round((area * rate) / 50) * 50
    const expireAt = new Date(createdAt.getTime() + 60 * 86400000)
    LISTINGS.push({
      listingId: `LS${String(_lvSeq).padStart(5, '0')}`,
      houseId: h.houseId,
      ownerId: h.ownerId,
      publisherUserId: h.ownerId,
      stewardEmpId: h.stewardEmpId,
      type: '出租',
      price,
      deposit: price,
      payTerm: pick(LISTING_PAY_TERM),
      decorate: dec,
      facilities: pick(FAC_GROUPS),
      availableFrom: `${TODAY.slice(0, 8)}${pad((rng() > 0.5 ? 25 : 28))}`,
      desc: pick(DESCS),
      images: 4 + Math.floor(rng() * 5),
      status: p.status,
      contentVersion: p.status === '已驳回' ? 2 : 1,
      auditedVersion: p.status === '已发布' || p.status === '已下架' || p.status === '已过期' || p.status === '已成交' ? 1 : 0,
      createdAt: at,
      expireAt: `${expireAt.getFullYear()}-${pad(expireAt.getMonth() + 1)}-${pad(expireAt.getDate())}`,
      dealAt: p.dealAt || '',
      auditBy: ['已发布', '已下架', '已过期', '已成交', '已驳回'].includes(p.status) ? '莫瑞' : '',
      auditAt: ['已发布', '已下架', '已过期', '已成交', '已驳回'].includes(p.status) ? at : '',
      rejectReason: p.rejectReason || '',
      offlineBy: p.status === '已下架' ? '徐悦' : '',
      offlineAt: p.status === '已下架' ? at : '',
      offlineReason: p.offlineReason || '',
      viewCount: 20 + Math.floor(rng() * 300)
    })
  })

  /* 看房请求：只挂在"已发布"的房源上 —— 没公开的房子没人看得到 */
  const published = LISTINGS.filter(l => l.status === '已发布')
  /*
   * 排序时先按楼管各取一套，再排剩下的。
   * 不这么做的话，前几条请求全落在同一个楼管的房子上，
   * 别的楼管打开「看房请求」是空的 —— 而这条线是靠"已等多少小时"立命的。
   */
  const pubOrder = []
  {
    const seen = new Set()
    published.forEach(l => {
      if (seen.has(l.stewardEmpId)) return
      seen.add(l.stewardEmpId)
      pubOrder.push(l)
    })
    published.forEach(l => { if (!pubOrder.includes(l)) pubOrder.push(l) })
  }
  const NAMES = ['刘敏', '张伟', '陈晓东', '王丽娜', '李强', '周文娟', '赵磊', '孙倩']
  const TIMES = ['工作日白天', '工作日晚上', '周末']
  const NOTES = ['在附近上班，想月底前搬进来', '带一个小孩，两室够用就行', '先看看，不着急', '预算 3000 以内']
  const vPlan = [
    { status: '待联系', hoursAgo: 70 },
    { status: '待联系', hoursAgo: 30 },
    { status: '待联系', hoursAgo: 6 },
    { status: '待联系', hoursAgo: 2 },
    { status: '已联系', hoursAgo: 48, result: '已电话沟通，约周六上午看房' },
    { status: '已联系', hoursAgo: 20, result: '客户出差，下周再联系' },
    { status: '已联系', hoursAgo: 10, result: '已告知押一付三，客户考虑中' },
    { status: '已带看', hoursAgo: 36, result: '已看房，客户觉得楼层偏低' },
    { status: '已关闭', hoursAgo: 60, result: '客户已租别处' },
    { status: '已关闭', hoursAgo: 26, result: '号码停机，联系不上' }
  ]
  vPlan.forEach((p, i) => {
    const l = pubOrder[i % pubOrder.length]
    _lvViewSeq += 1
    const createdAt = new Date(_lvNow().getTime() - p.hoursAgo * 3600000)
    const pad = n => String(n).padStart(2, '0')
    VIEWINGS.push({
      viewingId: `VW${String(_lvViewSeq).padStart(5, '0')}`,
      listingId: l.listingId,
      name: NAMES[i % NAMES.length],
      phone: `139${String(10000000 + i * 3317).slice(-8)}`,
      preferredTime: TIMES[i % TIMES.length],
      note: NOTES[i % NOTES.length],
      status: p.status,
      createdAt: `${createdAt.getFullYear()}-${pad(createdAt.getMonth() + 1)}-${pad(createdAt.getDate())} ${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}`,
      handledBy: p.status === '待联系' ? '' : '莫瑞',
      handledAt: p.status === '待联系' ? '' : `${TODAY} 09:${pad(20 + i)}`,
      resultNote: p.result || ''
    })
  })
}

/* ---------------- 读 ---------------- */

/**
 * 按当前角色的数据范围收敛挂牌。
 *
 * 三个模式走三条路：
 *   全部项目 → 不动；责任范围 → 按 houseIds；本项目 / 指定项目 → 按 communityIds。
 * 只做 assertInScope 是不够的 —— 那只是在"传了 communityId 参数"时拒绝越界，
 * 不传就照样把别的项目的数据全吐出来。项目经理打开列表看到 14 套、
 * 其中一半不在自己项目里，这就是数据范围失效。
 */
const _LV_HOUSE_OF = new Map()
function _lvScopedListings() {
  const s = currentScope()
  if (s.mode === '全部项目') return LISTINGS
  if (s.mode === '责任范围') {
    return LISTINGS.filter(l => (s.houseIds ? s.houseIds.has(l.houseId) : l.stewardEmpId === s.empId))
  }
  const comms = s.communityIds
  if (!comms || !comms.size) return []
  return LISTINGS.filter(l => {
    if (!_LV_HOUSE_OF.has(l.houseId)) {
      const h = houses.find(x => x.houseId === l.houseId) || {}
      _LV_HOUSE_OF.set(l.houseId, h.communityId || '')
    }
    return comms.has(_LV_HOUSE_OF.get(l.houseId))
  })
}

export function queryListings({ pageNo = 1, size = 20, filters = {} } = {}) {
  if (!canViewListings()) throw _lvError(`当前角色没有查看租售信息的权限（${LV_PERM_VIEW}）`, 403)
  return delay(() => {
    assertInScope({ communityId: filters.communityId })
    const me = currentOperator()
    const list = _lvScopedListings()
      .filter(l => eq(l, filters.communityId, 'communityId'))
      .filter(l => eq(l, filters.status, 'status'))
      .filter(l => eq(l, filters.stewardEmpId, 'stewardEmpId'))
      .filter(l => (filters.mine ? l.stewardEmpId === me.empId : true))
      .filter(l => {
        if (!filters.kw) return true
        const h = _lvHouseOf(l)
        const o = owners.find(x => x.ownerId === l.ownerId) || {}
        return kwHit({ ...h, ownerName: o.name, listingId: l.listingId }, filters.kw,
          ['listingId', 'houseShort', 'fullName', 'ownerName'])
      })
      /* 待审核排最前，其次按等待时长倒序 —— 这页看的就是"谁在等" */
      .sort((a, b) => {
        if ((a.status === '待审核') !== (b.status === '待审核')) return a.status === '待审核' ? -1 : 1
        if (a.status === '待审核') return String(a.createdAt).localeCompare(String(b.createdAt))
        return String(b.createdAt).localeCompare(String(a.createdAt))
      })
      .map(_lvRow)
    const rows = filters.overdue ? list.filter(r => r.overdue) : list
    return paged(rows, pageNo, size)
  })
}

/** 数据范围说明：楼管进页面要知道「这几套是归我管的」，而不是「为什么只有 6 条」 */
export function listingScopeHint() {
  const s = currentScope()
  if (s.mode === '全部项目') return '数据范围：全部项目'
  const names = [...(s.communityIds || [])].map(id => communityName(id)).join('、') || '—'
  if (s.mode === '责任范围') {
    const n = s.houseIds ? s.houseIds.size : 0
    return `数据范围：责任范围 · ${names} · 负责 ${n} 套房屋`
  }
  return `数据范围：${s.mode} · ${names}`
}

export function listingStats() {
  const rows = _lvScopedListings().map(_lvRow)
  const pending = rows.filter(r => r.status === '待审核')
  const published = rows.filter(r => r.status === '已发布')
  const viewings = _lvScopedViewings().map(_lvViewRow)
  return {
    total: rows.length,
    pending: pending.length,
    escalated: pending.filter(r => r.overdue).length,
    published: published.length,
    rejected: rows.filter(r => r.status === '已驳回').length,
    offline: rows.filter(r => r.status === '已下架').length,
    expired: rows.filter(r => r.status === '已过期').length,
    dealt: rows.filter(r => r.status === '已成交').length,
    viewingPending: viewings.filter(v => v.status === '待联系').length,
    viewingOverdue: viewings.filter(v => v.status === '待联系' && v.overdue).length,
    viewTotal: rows.reduce((s, r) => s + r.viewCount, 0)
  }
}

export function getListing(listingId) {
  if (!canViewListings()) throw _lvError(`当前角色没有查看租售信息的权限（${LV_PERM_VIEW}）`, 403)
  return delay(() => {
    const l = _lvOf(listingId)
    if (!l) return null
    const row = _lvRow(l)
    return {
      ...row,
      /* 详情是操作场景（审核要看、楼管要打给业主），这里给全号 */
      ..._lvOwnerOf(l, true),
      viewings: VIEWINGS.filter(v => v.listingId === listingId).map(_lvViewRow)
    }
  })
}

/* ---------------- 写 ---------------- */

export function auditListing(listingId, { pass = true, reason = '' } = {}) {
  if (!canAuditListings()) throw _lvError(`当前角色没有审核租售信息的权限（${LV_PERM_AUDIT}）`, 403)
  const l = _lvOf(listingId)
  if (!l) throw _lvError('挂牌不存在', 40440)
  if (l.status !== '待审核') throw _lvError(`这条已经是「${l.status}」，不能重复审核`, 40940)
  const why = String(reason || '').trim()
  if (!pass && !why) throw _lvError('驳回必须写理由 —— 业主看得到这句，也会拿着它来问')
  Object.assign(l, {
    status: pass ? '已发布' : '已驳回',
    rejectReason: pass ? '' : why,
    auditedVersion: pass ? l.contentVersion : l.auditedVersion,
    auditBy: currentOperator().name,
    auditAt: _lvStamp()
  })
  track('listing_audit', { listingId, pass })
  return _lvRow(l)
}

export function offlineListing(listingId, reason = '') {
  if (!canAuditListings()) throw _lvError(`当前角色没有下架租售信息的权限（${LV_PERM_AUDIT}）`, 403)
  const l = _lvOf(listingId)
  if (!l) throw _lvError('挂牌不存在', 40440)
  if (l.status !== '已发布') throw _lvError(`只有「已发布」的挂牌能下架，当前是「${l.status}」`, 40941)
  const why = String(reason || '').trim()
  if (!why) throw _lvError('下架必须写原因')
  Object.assign(l, {
    status: '已下架', offlineReason: why,
    offlineBy: currentOperator().name, offlineAt: _lvStamp()
  })
  track('listing_offline', { listingId })
  return _lvRow(l)
}

/**
 * 改派责任楼管。
 * 改的是**房源**而不是单条看房请求 —— 审核权、联系方式、后续看房请求都挂在
 * stewardEmpId 上，只改请求会造成"审核归 A、微信是 B"。
 */
export function reassignListing(listingId, empId) {
  if (!canAuditListings()) throw _lvError(`当前角色没有改派责任楼管的权限（${LV_PERM_AUDIT}）`, 403)
  const l = _lvOf(listingId)
  if (!l) throw _lvError('挂牌不存在', 40440)
  if (!empId) throw _lvError('请选择新的责任楼管')
  const e = employees.find(x => x.empId === empId && x.status !== '离职')
  if (!e) throw _lvError('该员工不存在或已离职')
  l.stewardEmpId = empId
  track('listing_reassign', { listingId, empId })
  return _lvRow(l)
}

/** 可改派的楼管：在职、岗位是楼栋管家 */
export function listingStewardOpts() {
  return employees
    .filter(e => e.position === '楼栋管家' && e.status !== '离职')
    .map(e => ({ value: e.empId, label: `${e.name} · ${orgNameOf(e.orgId)}` }))
}

/* ---------------- 看房请求 ---------------- */

const _lvScopedViewings = () => {
  const ids = new Set(_lvScopedListings().map(l => l.listingId))
  return VIEWINGS.filter(v => ids.has(v.listingId))
}

export function queryViewings({ pageNo = 1, size = 20, filters = {} } = {}) {
  if (!canViewListingsViewing()) throw _lvError(`当前角色没有查看看房请求的权限（${LV_PERM_VIEWING}）`, 403)
  return delay(() => {
    const list = _lvScopedViewings()
      .filter(v => eq(v, filters.status, 'status'))
      .filter(v => eq(v, filters.listingId, 'listingId'))
      .filter(v => {
        if (!filters.kw) return true
        const l = _lvOf(v.listingId)
        const h = l ? _lvHouseOf(l) : {}
        return kwHit({ ...v, houseShort: h.houseShort || '', fullName: h.fullName || '' },
          filters.kw, ['viewingId', 'name', 'phone', 'houseShort', 'fullName'])
      })
      .sort((a, b) => {
        if ((a.status === '待联系') !== (b.status === '待联系')) return a.status === '待联系' ? -1 : 1
        if (a.status === '待联系') return String(a.createdAt).localeCompare(String(b.createdAt))
        return String(b.createdAt).localeCompare(String(a.createdAt))
      })
      .map(_lvViewRow)
    const rows = filters.overdue ? list.filter(r => r.overdue) : list
    return paged(rows, pageNo, size)
  })
}

export function viewingStats() {
  const rows = _lvScopedViewings().map(_lvViewRow)
  return {
    total: rows.length,
    pending: rows.filter(r => r.status === '待联系').length,
    overdue: rows.filter(r => r.status === '待联系' && r.overdue).length,
    contacted: rows.filter(r => r.status === '已联系').length,
    visited: rows.filter(r => r.status === '已带看').length,
    closed: rows.filter(r => r.status === '已关闭').length
  }
}

export function getViewing(viewingId) {
  if (!canViewListingsViewing()) throw _lvError(`当前角色没有查看看房请求的权限（${LV_PERM_VIEWING}）`, 403)
  const v = _lvViewOf(viewingId)
  return v ? _lvViewRow(v) : null
}

/**
 * 标记看房请求「已联系 / 已关闭」。
 *
 * 这是移动端唯一的核心动作（§12.4）：PC 只做超时监控，真正回电话的是手机上的人。
 * **结果必须写** —— 下一个人接手时要能知道上次聊到哪了；
 * 不写结果的话，同一个访客会被三个人各打一遍，而访客记住的是"物业老打电话骚扰"。
 *
 * 只允许从「待联系」转出：已联系过的不再重复标记，否则时间线会被覆盖成最后一次。
 */
export function markViewingContacted(viewingId, { status = '已联系', note = '', operator = '' } = {}) {
  if (!canViewListingsViewing()) throw _lvError(`当前角色没有处理看房请求的权限（${LV_PERM_VIEWING}）`, 403)
  const v = _lvViewOf(viewingId)
  if (!v) throw _lvError('看房请求不存在', 40441)
  if (v.status !== '待联系') throw _lvError(`这条已经是「${v.status}」，不用再标记`, 40942)
  if (!['已联系', '已关闭'].includes(status)) throw _lvError('只能标成「已联系」或「已关闭」')
  const why = String(note || '').trim()
  if (!why) throw _lvError('要写一句联系结果 —— 下个人接手时得知道聊到哪了')
  Object.assign(v, {
    status,
    handledBy: String(operator || '').trim() || currentOperator().name,
    handledAt: _lvStamp(),
    resultNote: why
  })
  track('viewing_contacted', { viewingId, status })
  return _lvViewRow(v)
}

/**
 * 维护本人的对外联系方式（微信号 + 二维码）。
 *
 * 不设"是否公开"开关：填了就是愿意展示，没填就不显示。
 * 加开关只会多出"填了但关着"这种没人说得清的状态。
 * 手机号不在这里 —— 它只在内部通讯录里，不对外展示（见文件头第 ② 条）。
 */
export function updateMyContact({ wechatId = '', contactQrUrl = '' } = {}, empId = '') {
  const me = currentOperator()
  const target = String(empId || me.empId)
  /* 改别人的联系方式是 HR 的活；本人自助不需要任何权限码 */
  if (target !== me.empId && !_hasPerm('e.org.edit')) {
    throw _lvError('只能维护自己的联系方式', 403)
  }
  const e = employees.find(x => x.empId === target)
  if (!e) throw _lvError('员工不存在', 40442)
  const wx = String(wechatId || '').trim()
  if (wx.length > 30) throw _lvError('微信号最多 30 个字符')
  const qr = String(contactQrUrl || '').trim()
  Object.assign(e, { wechatId: wx, contactQrUrl: qr })
  track('my_contact_saved', { empId: target })
  return { empId: e.empId, name: e.name, wechatId: wx, contactQrUrl: qr }
}

/** 读回本人联系方式（移动端「我的」页进页面先取一次） */
export function myContact(empId = '') {
  const me = currentOperator()
  const e = employees.find(x => x.empId === String(empId || me.empId))
  if (!e) return null
  return {
    empId: e.empId,
    name: e.name,
    position: e.position,
    wechatId: e.wechatId || '',
    contactQrUrl: e.contactQrUrl || ''
  }
}

/* ---------- 初始化：模块加载时跑一次 ---------- */
_lvSeed()

/* ============================================================
 * H4 / H5 · 人脸核验（业主本人 + 家庭成员 + 租客，同一工作台）
 * ------------------------------------------------------------
 * 以前「已录人脸」是业主表单里的一个 el-switch，勾一下就生效；
 * 业主端采集提交上来之后**没有任何受理入口**，永远停在「待核验」。
 * 现在收成一条状态机：未采集 → 待核验 → 已生效 / 已驳回（驳回必填原因）。
 * 租客与业主走同一个工作台，按主体类型分两段 —— 同一件事开两个入口，
 * 客服第一句话一定是「到底在哪审」。
 * ============================================================ */

const FACE_REQUESTS = []
let _FACE_SEQ = 0

const FACE_STATUS = ['待核验', '已生效', '已驳回']
const FACE_SUBJECT = ['业主', '租客']

/** 核验权限：业主档案或租户管理的操作权，任一即可（不再单开权限码，避免和员工端窗口撞车） */
export const canAuditFaces = () => _hasPerm('a.owners.edit') || _hasPerm('a.tenants.edit')

const _faceHouse = houseId => {
  const h = houses.find(x => x.houseId === houseId) || {}
  return { houseShort: h.shortName || '', communityId: h.communityId || '', communityName: h.communityId ? communityName(h.communityId) : '' }
}

function _faceRow(r) {
  const house = _faceHouse(r.houseId)
  const waitMin = (() => {
    const t = Date.parse(String(r.submittedAt).replace(/-/g, '/'))
    const now = Date.parse(`${TODAY} 10:00`.replace(/-/g, '/'))
    return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 3600000)) : 0
  })()
  return {
    ...r,
    ...house,
    hoursWaiting: waitMin,
    overdue: r.status === '待核验' && waitMin >= 24,
    statusType: r.status === '已生效' ? 'success' : (r.status === '已驳回' ? 'danger' : 'warning'),
    maskedPhone: maskPhone(r.phone || ''),
    label: r.subjectType === '租客' ? `租客 · ${r.relation || '承租人'}` : (r.relation === '本人' ? '业主本人' : `家庭成员 · ${r.relation}`)
  }
}

function _pushFace(rec) {
  _FACE_SEQ += 1
  FACE_REQUESTS.push({
    reqId: 'FR' + String(_FACE_SEQ).padStart(5, '0'),
    subjectType: '业主',
    ownerId: '', memberId: '', tenantId: '',
    name: '', relation: '本人', phone: '',
    houseId: '', source: '业主端',
    submittedAt: `${TODAY} 09:00`,
    status: '待核验', auditBy: '', auditAt: '', rejectReason: '',
    images: 2,
    ...rec
  })
}

/** 种子：业主本人 + 配偶 + 子女 + 两个租客，五个待核验，够演示两段 */
function _seedFaceRequests() {
  if (FACE_REQUESTS.length) return
  // 优先挑「有配偶 / 子女且未录人脸」的业主：验收要看到 本人 / 配偶 / 子女 三种主体，
  // 随机挑一个没成员的业主，第一段就只有「业主本人」，看不出家庭成员这条路
  const hasKin = o => members.some(m => m.ownerId === o.ownerId && !m.faceRegistered
    && ['配偶', '子女'].includes(m.relation))
  const pool = owners.filter(o => !o.faceRegistered && housesOfOwner(o.ownerId).length)
  const cands = [...pool.filter(hasKin), ...pool.filter(o => !hasKin(o))].slice(0, 2)
  cands.forEach((o, oi) => {
    const h = housesOfOwner(o.ownerId)[0]
    _pushFace({
      ownerId: o.ownerId, name: o.name, relation: '本人', phone: o.phone,
      houseId: h.houseId, submittedAt: oi === 0 ? `${TODAY} 09:20` : `${TODAY} 08:40`,
      images: 2
    })
    const ms = members.filter(m => m.ownerId === o.ownerId && !m.faceRegistered).slice(0, oi === 0 ? 2 : 1)
    ms.forEach((m, mi) => {
      _pushFace({
        ownerId: o.ownerId, memberId: m.memberId, name: m.name, relation: m.relation || '家属',
        phone: m.phone, houseId: h.houseId,
        submittedAt: `${TODAY} 0${oi === 0 ? 9 : 8}:${mi === 0 ? '45' : '55'}`,
        images: 1
      })
    })
  })
  // 租户表的在住标记是 status === '在住'，不是 live（早期别处用的字段名不一样）
  tenants.filter(t => t.status === '在住' && !t.faceRegistered).slice(0, 2).forEach((t, i) => {
    _pushFace({
      subjectType: '租客', tenantId: t.tenantId, name: t.name, relation: '承租人',
      phone: t.phone, houseId: t.houseId, source: '员工端',
      submittedAt: `${TODAY} 0${i === 0 ? 9 : 8}:${i === 0 ? '10' : '35'}`,
      images: 1
    })
  })
}

export function queryFaceRequests({ subjectType = '', status = '', kw = '', pageNo = 1, size = 20 } = {}) {
  return delay(() => {
    const k = String(kw).trim()
    const list = FACE_REQUESTS
      .filter(r => !subjectType || r.subjectType === subjectType)
      .filter(r => !status || r.status === status)
      .filter(r => !k || `${r.name}${r.houseShort}${r.relation}`.includes(k))
      .map(_faceRow)
      // 待核验永远在最前，且等得久的更靠前 —— 这页看的就是「谁在等」
      .sort((a, b) => {
        const w = (x) => (x.status === '待核验' ? 0 : 1)
        return w(a) - w(b) || b.hoursWaiting - a.hoursWaiting
      })
    const start = (Number(pageNo) - 1) * Number(size)
    return { rows: list.slice(start, start + Number(size)), total: list.length }
  })
}

export function faceRequestStats() {
  const rows = FACE_REQUESTS.map(_faceRow)
  return {
    total: rows.length,
    pending: rows.filter(r => r.status === '待核验').length,
    pendingOwner: rows.filter(r => r.status === '待核验' && r.subjectType === '业主').length,
    pendingTenant: rows.filter(r => r.status === '待核验' && r.subjectType === '租客').length,
    overdue: rows.filter(r => r.overdue).length,
    activated: rows.filter(r => r.status === '已生效').length,
    rejected: rows.filter(r => r.status === '已驳回').length
  }
}

/** 某业主（含家庭成员）名下的人脸记录：业主档案页只读展示用 */
/** 该租客是否已有待核验记录：有就别让他重复提交，按钮也要禁掉 */
export function facePendingOfTenant(tenantId) {
  return FACE_REQUESTS.some(r => r.subjectType === '租客' && r.tenantId === tenantId && r.status === '待核验')
}

/** 该业主（本人或家庭成员）是否已有待核验记录 */
export function facePendingOfOwner(ownerId) {
  return FACE_REQUESTS.some(r => r.subjectType === '业主' && r.ownerId === ownerId && r.status === '待核验')
}

export function faceRequestsOfOwner(ownerId) {
  return FACE_REQUESTS
    .filter(r => r.subjectType === '业主' && r.ownerId === ownerId)
    .map(_faceRow)
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))
}

/** 业主端 / 员工端提交采集（原型内由种子与页面制造，接口化后落库） */
export function submitFaceRequest(rec = {}) {
  const subjectType = FACE_SUBJECT.includes(rec.subjectType) ? rec.subjectType : '业主'
  if (!rec.name) throw new Error('姓名必填')
  if (!rec.houseId) throw new Error('房屋必填')
  _pushFace({ ...rec, subjectType, status: '待核验', submittedAt: rec.submittedAt || `${TODAY} 10:00` })
  return { ok: true, reqId: FACE_REQUESTS[FACE_REQUESTS.length - 1].reqId }
}

/**
 * 审核：通过 / 驳回。
 * 通过时把结果写回主体（业主 / 家庭成员 / 租客）的 faceRegistered，
 * 所以「租客列表里的人脸状态跟着变」不是页面自己算的，而是这一处写的。
 */
export function auditFaceRequest(reqId, { pass = false, reason = '' } = {}) {
  return delay(() => {
    if (!canAuditFaces()) throw new Error('当前角色没有人脸核验的权限（a.owners.edit / a.tenants.edit）')
    const r = FACE_REQUESTS.find(x => x.reqId === reqId)
    if (!r) throw new Error('核验记录不存在')
    if (r.status !== '待核验') throw new Error(`该记录已处理（${r.status}），不能重复审核`)
    if (!pass && !String(reason).trim()) throw new Error('驳回必须写原因 —— 业主端会原样展示给业主')
    r.status = pass ? '已生效' : '已驳回'
    r.auditBy = currentOperator().name || '物业前台'
    r.auditAt = `${TODAY} 10:00`
    r.rejectReason = pass ? '' : String(reason).trim()
    if (pass) {
      if (r.subjectType === '租客') {
        const t = tenants.find(x => x.tenantId === r.tenantId)
        if (t) t.faceRegistered = true
      } else if (r.memberId) {
        const m = members.find(x => x.memberId === r.memberId)
        if (m) m.faceRegistered = true
      } else {
        const o = owners.find(x => x.ownerId === r.ownerId)
        if (o) o.faceRegistered = true
      }
    }
    return _faceRow(r)
  })
}

_seedFaceRequests()

/* ============================================================
 * 费用分类字典 · 减免原因 · 项目水电收费模式（批 1 · 2026-11-12）
 * ------------------------------------------------------------
 * 这一层的意义：把「分类」从散落的中文文本变成受控字典。
 * 以前收费项写 `category: '常规服务费'`，合同/报销各写各的，
 * 报表只能按字符串分组，改一个字就多一个分组。
 *
 * 三条硬规则：
 *   ① 分类只有两级，一级定方向（收入/支出/负债），二级挂单据；
 *   ② 每级声明「允许来源」，账单不能产生"税金"、合同不能产生"物业费"；
 *   ③ 停用不等于删除 —— 历史单据仍要能显示分类名。
 * ============================================================ */

const CATEGORY_DIRECTIONS = ['income', 'expense', 'liability']
const UTILITY_MODES = [
  { value: 'none', label: '国网/水司自缴（系统不涉及）' },
  { value: 'card', label: '插卡式（前台充卡）' },
  { value: 'meter', label: '物业抄表推单' }
]
const SOURCE_LABELS = {
  bill: '账单', recharge: '预充值', temp: '临时收费', contract: '合同',
  payroll: '工资表', reimburse: '报销', manual: '手工补录'
}

/** 写配置的口径：原型阶段复用收费科目权限，待权限模型细化后换成 b.feeCategory.edit */
const assertFeeConfigPerm = () =>
  assertPerm('b.feeItems.view', '维护费用分类需要有收费科目权限（b.feeItems.view）')

export const canEditFeeConfig = () => _hasPerm('b.feeItems.view')
export const sourceLabel = s => SOURCE_LABELS[s] || s

/** 全量分类（含停用），按 sort；带父级名称与来源中文 */
export function feeCategoryRows({ direction = '' } = {}) {
  const byCode = new Map(feeCategories.map(c => [c.code, c]))
  return feeCategories
    .filter(c => !direction || c.direction === direction)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(c => ({
      ...c,
      parentName: c.parentCode ? (byCode.get(c.parentCode) || {}).name || '' : '',
      sourceText: (c.allowSources || []).map(sourceLabel).join(' / ')
    }))
}

/** 两级树：一级下挂二级，供页面做树表 */
export function feeCategoryTree({ direction = '' } = {}) {
  const rows = feeCategoryRows({ direction })
  const l1 = rows.filter(r => r.level === 1)
  return l1.map(p => ({ ...p, children: rows.filter(r => r.parentCode === p.code) }))
}

/** 下拉选项：只给启用项；按来源过滤（账单不该出现"税金"） */
export function feeDictOpts({ direction = 'income', level = 2, source = '' } = {}) {
  return feeCategoryRows({ direction })
    .filter(c => c.enabled && (!level || c.level === level))
    .filter(c => !source || (c.allowSources || []).includes(source))
    .map(c => ({ label: c.level === 2 ? `${c.parentName} / ${c.name}` : c.name, value: c.code }))
}

export const feeCategoryOf = code => feeCategories.find(c => c.code === code) || null

/** 单据落分类时的校验：方向、来源、是否启用，任一不符都拒 */
export function assertFeeCategory(code, { direction = '', source = '' } = {}) {
  const c = feeCategoryOf(code)
  if (!c) throw new Error('费用分类不存在')
  if (!c.enabled) throw new Error(`分类「${c.name}」已停用，不能再用于新单据`)
  if (direction && c.direction !== direction) {
    throw new Error(`分类「${c.name}」是${c.direction === 'income' ? '收入' : c.direction === 'expense' ? '支出' : '负债'}类，不能用在${direction}单据上`)
  }
  if (source && !(c.allowSources || []).includes(source)) {
    throw new Error(`分类「${c.name}」不接受${sourceLabel(source)}来源`)
  }
  return c
}

/** 改分类：只允许改名称/排序/说明。编码与来源被单据引用，改了历史数据会指向不存在的分类 */
export function saveFeeCategory({ code, name, sort, desc } = {}) {
  assertFeeConfigPerm()
  const c = feeCategoryOf(code)
  if (!c) throw new Error('分类不存在')
  const n = String(name || '').trim()
  if (n.length < 2) throw new Error('名称至少 2 个字')
  if (feeCategories.some(x => x.code !== code && x.name === n)) throw new Error(`已有同名分类「${n}」`)
  c.name = n
  if (sort !== undefined) c.sort = Number(sort) || 0
  if (desc !== undefined) c.desc = String(desc)
  return { ...c }
}

/** 启停分类。停一级要连带把二级停掉，否则二级还挂着、下拉里却没了父级 */
export function toggleFeeCategory(code, enabled) {
  assertFeeConfigPerm()
  const c = feeCategoryOf(code)
  if (!c) throw new Error('分类不存在')
  const kids = feeCategories.filter(x => x.parentCode === code)
  if (!enabled && kids.some(k => k.enabled)) {
    const names = kids.filter(k => k.enabled).map(k => k.name).join('、')
    throw new Error(`「${c.name}」下还有启用的子分类（${names}），先停子级再停父级`)
  }
  c.enabled = !!enabled
  /* 停父级时把子级一起停，避免出现"子级启用、父级停用"的孤儿状态 */
  if (!enabled) kids.forEach(k => { k.enabled = false })
  return { ...c }
}

/** 收费项 + 分类：列表页直接用，缺分类的会标出来（不静默） */
export function feeItemCategoryRows({ status = '', categoryCode = '', kw = '' } = {}) {
  const map = new Map(feeItemCategoryMap.map(m => [m.itemId, m]))
  return feeItems
    .filter(i => !status || i.status === status)
    .filter(i => !kw || `${i.name}${i.category}${i.remark || ''}`.includes(kw))
    .map(i => {
      const m = map.get(i.itemId) || {}
      const c = m.categoryCode ? feeCategoryOf(m.categoryCode) : null
      return {
        ...i,
        categoryCode: m.categoryCode || '',
        categoryName: c ? c.name : '',
        categoryPath: c ? `${feeCategoryOf(c.parentCode)?.name || ''} / ${c.name}`.replace(/^ \/ /, '') : '',
        meterType: m.meterType || '',
        missingCategory: !c
      }
    })
    .filter(i => !categoryCode || i.categoryCode === categoryCode)
}

/** 分类缺口：有多少收费项没挂分类 —— 报表分不了组就是从这里开始的 */
export function feeItemCategoryGaps() {
  const rows = feeItemCategoryRows()
  return { total: rows.length, missing: rows.filter(r => r.missingCategory) }
}

/* ---------------- 减免原因字典 ---------------- */
export function waiveReasonRows({ enabledOnly = false } = {}) {
  return waiveReasons
    .filter(r => !enabledOnly || r.enabled)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(r => ({ ...r }))
}

export const waiveReasonOpts = () =>
  waiveReasonRows({ enabledOnly: true }).map(r => ({
    label: r.name, value: r.reasonId,
    type: r.type, needProof: r.needProof, countInAssess: r.countInAssess,
    scope: r.scope || '全部', approveAbove: Number(r.approveAbove) || 0
  }))

/**
 * 收银台可选的减免原因：按项目过滤。
 * 政策性减免常常只针对某个小区（老旧小区改造补贴），
 * 让它在别的项目也能选，前台就会拿一个不适用的依据去减免。
 */
export const waiveReasonOptsFor = communityId =>
  waiveReasonOpts().filter(o => o.scope !== '指定项目'
    || (waiveReasons.find(r => r.reasonId === o.value)?.communityIds || []).includes(communityId))

export const waiveReasonOf = id => waiveReasons.find(r => r.reasonId === id) || null

export function saveWaiveReason(rec = {}) {
  assertFeeConfigPerm()
  const name = String(rec.name || '').trim()
  if (name.length < 2) throw new Error('名称至少 2 个字')
  const dup = waiveReasons.find(r => r.name === name && r.reasonId !== rec.reasonId)
  if (dup) throw new Error(`「${name}」已存在`)
  if (rec.reasonId) {
    const r = waiveReasons.find(x => x.reasonId === rec.reasonId)
    if (!r) throw new Error('减免原因不存在')
    if (!r.enabled && rec.enabled === undefined) throw new Error('已停用的原因不能直接改名，请先启用')
    Object.assign(r, {
      name,
      type: rec.type || r.type,
      countInAssess: rec.countInAssess === undefined ? r.countInAssess : !!rec.countInAssess,
      needProof: rec.needProof === undefined ? r.needProof : !!rec.needProof,
      desc: rec.desc === undefined ? r.desc : String(rec.desc),
      sort: rec.sort === undefined ? r.sort : Number(rec.sort) || 0,
      scope: rec.scope === undefined ? (r.scope || '全部') : rec.scope,
      communityIds: rec.communityIds === undefined ? (r.communityIds || []) : rec.communityIds,
      approveAbove: rec.approveAbove === undefined ? (Number(r.approveAbove) || 0) : Number(rec.approveAbove) || 0
    })
    return { ...r }
  }
  const seq = waiveReasons.reduce((m, r) => Math.max(m, Number(String(r.reasonId).replace(/\D/g, '')) || 0), 0) + 1
  const row = {
    reasonId: 'WR' + String(seq).padStart(2, '0'),
    code: String(rec.code || 'CUSTOM_' + seq).toUpperCase(),
    name,
    type: rec.type || '个案',
    countInAssess: !!rec.countInAssess,
    needProof: rec.needProof === undefined ? true : !!rec.needProof,
    enabled: true,
    sort: rec.sort === undefined ? (seq * 10) : Number(rec.sort) || 0,
    desc: String(rec.desc || ''),
    scope: rec.scope || '全部',
    communityIds: Array.isArray(rec.communityIds) ? rec.communityIds : [],
    approveAbove: Number(rec.approveAbove) || 0
  }
  waiveReasons.push(row)
  return { ...row }
}

export function toggleWaiveReason(reasonId, enabled) {
  assertFeeConfigPerm()
  const r = waiveReasons.find(x => x.reasonId === reasonId)
  if (!r) throw new Error('减免原因不存在')
  /* 停用前先确认没有"唯一可用"的风险：至少留一条启用的，否则收银台减免没法提交 */
  if (!enabled && waiveReasons.filter(x => x.enabled && x.reasonId !== reasonId).length === 0) {
    throw new Error('至少要保留一条启用的减免原因，否则减免无法提交')
  }
  r.enabled = !!enabled
  return { ...r }
}

/* ---------------- 项目水电收费模式 ---------------- */
export const utilityModeOpts = () => UTILITY_MODES.map(m => ({ ...m }))
export const utilityModeLabel = v => (UTILITY_MODES.find(m => m.value === v) || {}).label || '未配置'

export function communityUtilityOf(communityId) {
  const row = communityUtility.find(u => u.communityId === communityId)
  return row ? { ...row } : { communityId, elec: 'none', water: 'none', updatedAt: '', updatedBy: '' }
}

export function communityUtilityRows() {
  return communities.map(c => {
    const u = communityUtilityOf(c.communityId)
    return { ...c, elec: u.elec, water: u.water, elecLabel: utilityModeLabel(u.elec), waterLabel: utilityModeLabel(u.water), updatedAt: u.updatedAt }
  })
}

/** 项目水电模式：按表计类型分别配 —— 常见"电走国网、水走物业"，一刀切会错 */
export function saveCommunityUtility(communityId, patch = {}) {
  assertFeeConfigPerm()
  const c = communities.find(x => x.communityId === communityId)
  if (!c) throw new Error('项目不存在')
  const valid = UTILITY_MODES.map(m => m.value)
  const next = {}
  for (const k of ['elec', 'water']) {
    if (patch[k] === undefined) continue
    if (!valid.includes(patch[k])) throw new Error('收费模式非法')
    next[k] = patch[k]
  }
  if (!Object.keys(next).length) throw new Error('没有要更新的模式')
  let row = communityUtility.find(u => u.communityId === communityId)
  if (!row) {
    row = { communityId, elec: 'none', water: 'none', updatedAt: '', updatedBy: '' }
    communityUtility.push(row)
  }
  Object.assign(row, next, {
    updatedAt: `${TODAY}`,
    updatedBy: currentOperator().name || '系统'
  })
  return { ...row }
}

/** 收款权限：预收/充值都走收银台口径 */
export const canCollect = () => _hasPerm('b.cashier.edit')

/** 该项目某种表计是否需要系统计费（A 类 false） */
export const utilityBilling = (communityId, meterType) =>
  communityUtilityOf(communityId)[meterType === '电表' || meterType === 'elec' ? 'elec' : 'water'] !== 'none'

/* ============================================================
 * 应收矩阵 · 收银台预收（批 2 · 2026-11-12）
 * ------------------------------------------------------------
 * 「应收」不再依赖"有没有生成账单"：它由 面积 × 单价 × 账期 直接算出。
 * 账单只是应收的一种呈现；不这样拆，没开单的月份就没有应收，收缴率会虚高。
 *
 * 两个时间维度（这是财务那段"2000 摊 16 个月"能算对的前提）：
 *   paidAt —— 收款日，算现金收入、开票日
 *   period —— 归属账期，算收缴率 / 预缴率 / 欠费账龄
 *
 * 平摊不是无条件的：只有「金额 == 月应收 × 月数」才允许平均分；
 * 否则逐月冲抵最早的未缴月份，剩余部分才作为预付。
 * 平均分会把"还差 100"抹成"每月差一点"，账龄就废了。
 * ============================================================ */

const MATRIX_START = '2025-01'
const MATRIX_END = '2027-12'

/** 收款/减免落格记录：矩阵的"已收"只从这里来，不再各页各写一份 */
const MATRIX_TX = []
let _MTX_SEQ = 0

/** 预收收款单（非计量项按账期摊、计量项按金额换量） */
const PREPAY_COLLECTS = []
let _PP_SEQ = 0

const monthRange = (from, to) => {
  const out = []
  let [y, m] = String(from).split('-').map(Number)
  const [ey, em] = String(to).split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

const periodOf = (date = TODAY) => String(date).slice(0, 7)
const addMonths = (period, n) => {
  let [y, m] = String(period).split('-').map(Number)
  m += n
  while (m > 12) { m -= 12; y += 1 }
  while (m < 1) { m += 12; y -= 1 }
  return `${y}-${String(m).padStart(2, '0')}`
}
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/* 户级单价：**同一个收费项对不同房屋可能是不同价**。
 * 数据集里物业服务费有三档：住宅 2.8、公寓 3.2、商业 8.5（120 户）。
 * 统一取 feeItems.price 的后果是：商业户每月按 2.8 算应收，
 * 报表上"应收"比真实账单少 39 万，收缴率却虚高到 126% —— 一个错、两个指标同时失真。
 *
 * 取价顺序：该户该科目**最近一张账单上的 price 快照** → 收费项单价。
 * 用账单快照而不是按 usage 硬编码，是因为快照本身记录了"这户当时按什么价开的"，
 * 调价、一房一价都能自动跟上。 */
let _PRICE_CACHE = { itemId: '', map: null }

function _priceMapOf(itemId) {
  if (_PRICE_CACHE.itemId === itemId && _PRICE_CACHE.map) return _PRICE_CACHE.map
  const latest = new Map()
  for (const b of bills) {
    if (b.itemId !== itemId || !(Number(b.price) > 0)) continue
    const prev = latest.get(b.houseId)
    if (!prev || String(b.period) > prev.period) {
      latest.set(b.houseId, { period: String(b.period), price: Number(b.price) })
    }
  }
  const flat = new Map([...latest].map(([k, v]) => [k, v.price]))
  _PRICE_CACHE = { itemId, map: flat }
  return flat
}

/** 某户某科目的实际单价（没有账单历史的户回落收费项单价） */
export function houseUnitPriceOf(houseId, itemId) {
  const p = _priceMapOf(itemId).get(houseId)
  if (p) return p
  const item = feeItems.find(i => i.itemId === itemId)
  return item ? Number(item.price) || 0 : 0
}

/** 某户某项的月应收：按面积计费的按面积，按车位的按车位，其余按月固定 */
export function monthlyFeeOf(houseId, itemId) {
  const h = houses.find(x => x.houseId === houseId)
  if (!h) throw new Error('房屋不存在')
  const item = feeItems.find(i => i.itemId === itemId)
  if (!item) throw new Error('收费项不存在')
  if (item.status !== '启用') throw new Error(`收费项「${item.name}」已停用`)
  if (item.calcType === '按面积') {
    return round2((h.area || h.buildArea || 0) * houseUnitPriceOf(houseId, itemId))
  }
  if (item.calcType === '按车位') return round2(item.price)
  return round2(item.price)
}

/** 只给"有应收"的收费项铺矩阵：水电没有月度应收，走充值 */
export const isReceivableItem = itemId => {
  const it = feeItems.find(i => i.itemId === itemId)
  /* 负债科目永远没有应收：押金收进来是欠业主的钱，把它铺进应收矩阵，
     报表上就变成"该收没收"，收缴率、欠费率全部失真 */
  if (it?.direction === 'liability') return false
  return !!it && ['按面积', '按车位', '按户'].includes(it.calcType) && it.cycle === '月'
}

const _mtxRow = (houseId, itemId, period) => {
  const monthly = monthlyFeeOf(houseId, itemId)
  const txs = MATRIX_TX.filter(t => t.houseId === houseId && t.itemId === itemId && t.period === period)
  const received = round2(txs.reduce((n, t) => n + (t.amount || 0), 0))
  const waived = round2(txs.filter(t => t.source === 'waive').reduce((n, t) => n + (t.amount || 0), 0))
  const paid = round2(txs.filter(t => t.source !== 'waive').reduce((n, t) => n + (t.amount || 0), 0))
  return {
    houseId, itemId, period,
    receivable: monthly,
    received: paid,
    waived,
    unpaid: round2(Math.max(0, monthly - paid - waived)),
    status: waived >= monthly ? '已减免' : paid >= monthly ? '已收' : (paid + waived > 0 ? '部分收' : (period < periodOf() ? '欠费' : '未到期'))
  }
}

/** 单户矩阵：默认铺满 MATRIX_START..MATRIX_END，也可指定区间 */
export function billingMatrixOfHouse(houseId, { itemId = '', from = MATRIX_START, to = MATRIX_END } = {}) {
  const item = itemId || 'FI01'
  return monthRange(from, to).map(p => _mtxRow(houseId, item, p))
}

/** 区间汇总：报表与三率都从这里取，口径只有一处 */
export function billingMatrixSummary({ from = '2026-01', to = periodOf(), itemId = 'FI01', communityId = '' } = {}) {
  const periods = monthRange(from, to)
  let receivable = 0; let received = 0; let waived = 0; let housesCount = 0
  for (const h of houses) {
    if (communityId && h.communityId !== communityId) continue
    housesCount += 1
    const monthly = (h.area || h.buildArea || 0) * ((feeItems.find(i => i.itemId === itemId) || {}).price || 0)
    receivable += monthly * periods.length
    for (const p of periods) {
      const r = _mtxRow(h.houseId, itemId, p)
      received += r.received
      waived += r.waived
    }
  }
  receivable = round2(receivable)
  received = round2(received)
  waived = round2(waived)
  const base = round2(receivable - waived)
  return {
    from, to, periods: periods.length, houses: housesCount, itemId,
    receivable, received, waived,
    collectionRate: base > 0 ? round2(received / base * 100) / 100 : 0,
    arrears: round2(Math.max(0, base - received))
  }
}

/** 平摊预演：收银台输"几个月"时先算给前台看，避免收完才发现金额对不上 */
export function prepayPlan({ houseId, itemId = 'FI01', months = 1, startPeriod = periodOf() } = {}) {
  if (!isReceivableItem(itemId)) throw new Error('该收费项没有月度应收，请走充值')
  const n = Number(months)
  if (!Number.isFinite(n) || n <= 0) throw new Error('月份数必须大于 0')
  if (n > 36) throw new Error('一次最多预收 36 个月')
  const monthly = monthlyFeeOf(houseId, itemId)
  const periods = Array.from({ length: n }, (_, i) => addMonths(startPeriod, i))
  const details = periods.map(p => ({ period: p, amount: monthly, before: _mtxRow(houseId, itemId, p) }))
  return { monthly, months: n, amount: round2(monthly * n), details, startPeriod }
}

/**
 * 预收收款（非计量项）。
 * 金额 == 月应收 × 月数 → 平均摊（这是财务给的例子）；
 * 不等 → 从最早未结账期起逐月冲抵，分摊不完的部分记到最后一期之外（预付余额）。
 */
export function createPrepayCollect({
  houseId, itemId = 'FI01', months = 0, amount, startPeriod = periodOf(),
  payMethod = '微信支付', waive = 0, waiveReasonId = '', operator = ''
} = {}) {
  assertPerm('b.cashier.edit', '缺少权限位 b.cashier.edit：无权收款')
  const h = houses.find(x => x.houseId === houseId)
  if (!h) throw new Error('房屋不存在')
  if (!isReceivableItem(itemId)) throw new Error('该收费项没有月度应收')
  const monthly = monthlyFeeOf(houseId, itemId)
  const total = round2(Number(amount))
  if (!Number.isFinite(total) || total <= 0) throw new Error('收款金额必须大于 0')
  const waiveAmt = round2(Number(waive) || 0)
  if (waiveAmt < 0) throw new Error('减免金额不能为负')
  if (waiveAmt > 0) {
    if (!waiveReasonId) throw new Error('减免必须选择原因 —— 报表要按原因统计')
    const wr = waiveReasons.find(r => r.reasonId === waiveReasonId)
    if (!wr) throw new Error('减免原因不存在')
    if (!wr.enabled) throw new Error(`减免原因「${wr.name}」已停用`)
    if (waiveAmt > total + monthly * (months || 0)) throw new Error('减免金额超过本次应收')
  }

  const n = Number(months) || 0
  let details = []
  let mode = 'even'
  if (n > 0 && Math.abs(total - monthly * n) < 0.01) {
    /* 财务口径：金额正好等于"月费 × 月数"，平均摊到这些账期 */
    details = Array.from({ length: n }, (_, i) => {
      const p = addMonths(startPeriod, i)
      return { period: p, amount: monthly }
    })
  } else {
    /* 不等额：从最早未结账期起逐月冲抵，剩下的才是真预付 */
    mode = 'fifo'
    const periods = monthRange(MATRIX_START, MATRIX_END)
    let left = total
    for (const p of periods) {
      if (left <= 0) break
      const row = _mtxRow(houseId, itemId, p)
      const gap = round2(row.receivable - row.received - row.waived)
      if (gap <= 0) continue
      const take = round2(Math.min(left, gap))
      details.push({ period: p, amount: take })
      left = round2(left - take)
    }
    if (left > 0.01) details.push({ period: 'PREPAID', amount: left })
    if (!details.length) throw new Error('没有可冲抵的账期，请确认金额')
  }

  _PP_SEQ += 1
  const collect = {
    collectId: 'PC' + String(_PP_SEQ).padStart(5, '0'),
    houseId, houseName: h.shortName || h.fullName || houseId, itemId, itemName: (feeItems.find(i => i.itemId === itemId) || {}).name,
    monthly, months: n, amount: total, waive: waiveAmt, waiveReasonId,
    payMethod, mode, details, paidAt: `${TODAY} ${new Date().toTimeString().slice(0, 5)}`,
    operator: operator || currentOperator().name || '前台'
  }
  PREPAY_COLLECTS.push(collect)

  /* 落矩阵：这是"已收"的唯一写入口 */
  for (const d of details) {
    if (d.period === 'PREPAID') continue
    _MTX_SEQ += 1
    MATRIX_TX.push({
      txId: 'MT' + String(_MTX_SEQ).padStart(6, '0'),
      houseId, itemId, period: d.period, amount: d.amount,
      source: 'prepay', collectId: collect.collectId, at: collect.paidAt
    })
  }
  if (waiveAmt > 0) {
    const first = details.find(d => d.period !== 'PREPAID')
    if (first) {
      _MTX_SEQ += 1
      MATRIX_TX.push({
        txId: 'MT' + String(_MTX_SEQ).padStart(6, '0'),
        houseId, itemId, period: first.period, amount: waiveAmt,
        source: 'waive', waiveReasonId, collectId: collect.collectId, at: collect.paidAt
      })
    }
  }
  return collect
}

export const prepayCollectRows = () => PREPAY_COLLECTS.map(c => ({ ...c }))

/**
 * 减免演示种子（2026-11-14 · 报表批）
 * ------------------------------------------------------------
 * 数据集里**一张带减免的账单都没有**，减免分析会全是 0 —— 分不清"没人减免"和"功能没做"。
 * 这里给 2026-08~10 的已缴账单补一批减免，同时**等额扣掉 paidAmount**：
 * 账单必须继续满足 `payable = paidAmount + discount`，否则减免就成了凭空多出来的一笔钱。
 *
 * 三条规则：
 *   ① 选哪些：已缴 + 月度收费项 + 账期在 08~10，按 billId 排序后**固定取模**（不随机）；
 *   ② 免多少：按原因定比例（差错纠正 5% / 协商 15% / 困难户 30% 封顶 200 / 其他 8%），
 *      算出来不足 20 元的不记 —— 为了 3 块钱走一遍减免审批不合常理；
 *   ③ 记原因：`discountReasonId` + `discountReason` 落到账单上，矩阵种子会带进流水，
 *      报表才分得出「政策性」和「差错纠正」。
 *
 * 固定规则 = 每次刷新同一张账单的减免额一样，验收脚本才敢断言。
 * **正式上线后这段不存在**：减免全部来自收银台那一刻选的原因。
 */
const WAIVE_SEED_REASONS = [
  { reasonId: 'WR03', pct: 0.05, cap: 0 },      /* 差错纠正：小额、笔数最多 */
  { reasonId: 'WR04', pct: 0.15, cap: 500 },    /* 协商减免：投诉补偿 */
  { reasonId: 'WR02', pct: 0.30, cap: 200 },    /* 困难户：比例高但封顶 */
  { reasonId: 'WR05', pct: 0.08, cap: 0 }       /* 其他 */
]

function _seedWaives() {
  const SEED_PERIODS = new Set(['2026-08', '2026-09', '2026-10'])
  const monthlyItems = new Set(feeItems
    .filter(i => ['按面积', '按车位', '按户'].includes(i.calcType) && i.cycle === '月')
    .map(i => i.itemId))
  const paid = bills
    .filter(b => b.houseId && b.status === '已缴' && SEED_PERIODS.has(b.period)
      && monthlyItems.has(b.itemId) && (Number(b.paidAmount) || 0) > 0 && !(Number(b.discount) > 0))
    .sort((a, b) => String(a.billId).localeCompare(String(b.billId)))

  let i = 0
  for (const b of paid) {
    /* 每 17 张挑一张：太少看不出分布，太多会把收缴率拉低到不像真的 */
    if (i++ % 17 !== 5) continue
    const cfg = WAIVE_SEED_REASONS[i % WAIVE_SEED_REASONS.length]
    const base = Number(b.payable) || Number(b.amount) || 0
    let amount = round2(base * cfg.pct)
    if (cfg.cap) amount = Math.min(amount, cfg.cap)
    if (amount < 20) continue
    const paidNow = round2((Number(b.paidAmount) || 0) - amount)
    if (paidNow < 0) continue
    const reason = waiveReasons.find(r => r.reasonId === cfg.reasonId) || {}
    b.discount = amount
    b.discountReasonId = cfg.reasonId
    b.discountReason = reason.name || ''
    b.paidAmount = paidNow
    b._waiveSeed = true
  }

  /* 再补两笔**超过免审额度**的：困难户减免的审批线是 1000 元，
     报表上的「超额度」列如果永远是空的，这个功能就等于没做。
     挑已缴金额够大的账单（否则减免 1200 会超过实收），固定取前两笔。 */
  const big = paid.filter(b => !b._waiveSeed && (Number(b.paidAmount) || 0) >= 1500)
  for (const b of big.slice(0, 2)) {
    const reason = waiveReasons.find(r => r.reasonId === 'WR02') || {}
    b.discount = 1200
    b.discountReasonId = 'WR02'
    b.discountReason = reason.name || ''
    b.paidAmount = round2((Number(b.paidAmount) || 0) - 1200)
    b._waiveSeed = true
    b._waiveOverLimit = true
  }
}

/**
 * 把历史账单的实收/减免灌进矩阵 —— 否则刚上线时矩阵"已收"全为 0，
 * 收缴率一片 0%，谁看都以为系统坏了。
 * 只灌有月度应收的收费项；水电走充值，不进矩阵。
 */
function _seedMatrixFromBills() {
  if (MATRIX_TX.length) return
  for (const b of bills) {
    if (!b.houseId || !b.period) continue
    const item = feeItems.find(i => i.itemId === b.itemId)
    if (!item || !['按面积', '按车位', '按户'].includes(item.calcType)) continue
    const paid = Number(b.paidAmount) || 0
    if (paid > 0) {
      _MTX_SEQ += 1
      MATRIX_TX.push({
        txId: 'MT' + String(_MTX_SEQ).padStart(6, '0'),
        houseId: b.houseId, itemId: b.itemId, period: b.period, amount: round2(paid),
        source: 'bill', billId: b.billId, at: b.payTime || '', legacy: true
      })
    }
    const disc = Number(b.discount) || 0
    if (disc > 0) {
      _MTX_SEQ += 1
      MATRIX_TX.push({
        txId: 'MT' + String(_MTX_SEQ).padStart(6, '0'),
        houseId: b.houseId, itemId: b.itemId, period: b.period, amount: round2(disc),
        source: 'waive', waiveReasonId: b.discountReasonId || '', billId: b.billId,
        /* 账单上记了原因就带过来，减免分析才分得出「政策性」和「差错纠正」；
           早年没有原因的（legacy）留空，报表里单列一行「未填原因」 */
        reasonId: b.discountReasonId || '', reasonName: b.discountReason || '',
        at: b.payTime || '', legacy: true
      })
    }
  }
}
_seedWaives()      /* 先补减免，矩阵种子才会把它带成 waive 流水 */
_seedMatrixFromBills()

/**
 * 预缴种子（2026-11-13 · 批 6）。
 * 演示数据集里只有"已缴账单"，没有一笔提前缴的 —— 预缴率会恒为 0，
 * 报表上看着像"这个指标没用"，实际是没数据。
 * 取前 80 户有月度应收的住宅，把 2026-11 ~ 2027-04 六期标成已预缴，
 * 这样预缴率大约 5%，能看出指标是活的。
 * **只影响演示**：正式上线后这段不会存在，预缴全部来自真实收款。
 */
function _seedPrepay() {
  const item = feeItems.find(i => i.itemId === 'FI01')
  if (!item) return
  /* 只取"演示常用户"之后的房子（前 20 户是收银台默认客户，占满它们的未来月份，
     演示"预缴 12 个月"时就点不动了），间隔抽样让预缴分布看起来像真的 */
  const pool = houses.filter(h => (h.area || 0) > 0 && h.usage === '住宅').slice(20)
  const targets = pool.filter((h, i) => i % 4 === 0).slice(0, 80)
  const periods = monthRange('2026-11', '2027-01')
  for (const h of targets) {
    /* 用「最近账单单价」而不是收费项单价：商业户预缴按 2.8 算，会和它的应收对不上 */
    const price = (bills.find(b => b.houseId === h.houseId && b.itemId === 'FI01' && Number(b.price) > 0) || {}).price || item.price
    const monthly = round2((h.area || 0) * price)
    for (const p of periods) {
      _MTX_SEQ += 1
      MATRIX_TX.push({
        txId: 'MT' + String(_MTX_SEQ).padStart(6, '0'),
        houseId: h.houseId, itemId: 'FI01', period: p, amount: monthly,
        source: 'prepay', at: '2026-10-08', legacy: true, demoSeed: true
      })
    }
  }
}
_seedPrepay()


/* ---------------- 计量项（水电）充值：金额 ⇄ 用量 ---------------- */
const UTILITY_CHARGES = []
let _UC_SEQ = 0

/** 换算：单价取收费项，单据存快照 —— 调价后历史充值对应的度数不能变 */
export function utilityQuote({ itemId, amount, qty } = {}) {
  const it = feeItems.find(i => i.itemId === itemId)
  if (!it) throw new Error('收费项不存在')
  const unitPrice = Number(it.price) || 0
  if (!unitPrice) throw new Error('该收费项没有单价，无法换算')
  const a = Number(amount)
  const q = Number(qty)
  if (Number.isFinite(a) && a > 0) return { itemId, unitPrice, unit: it.unit, amount: round2(a), qty: round2(a / unitPrice) }
  if (Number.isFinite(q) && q > 0) return { itemId, unitPrice, unit: it.unit, amount: round2(q * unitPrice), qty: round2(q) }
  throw new Error('金额或用量必须填一个')
}

export function createUtilityCharge({ houseId, itemId, amount, qty, payMethod = '微信支付', operator = '' } = {}) {
  assertPerm('b.cashier.edit', '缺少权限位 b.cashier.edit：无权收款')
  const h = houses.find(x => x.houseId === houseId)
  if (!h) throw new Error('房屋不存在')
  const mode = communityUtilityOf(h.communityId)[meterTypeOf(itemId)]
  if (mode === 'none') throw new Error('该项目该表计由业主自缴，系统不收费')
  const q = utilityQuote({ itemId, amount, qty })
  _UC_SEQ += 1
  const row = {
    chargeId: 'UC' + String(_UC_SEQ).padStart(5, '0'),
    houseId, houseName: h.shortName || houseId, itemId,
    itemName: (feeItems.find(i => i.itemId === itemId) || {}).name,
    mode, amount: q.amount, qty: q.qty, unitPrice: q.unitPrice, unit: q.unit,
    payMethod, paidAt: `${TODAY} ${new Date().toTimeString().slice(0, 5)}`,
    operator: operator || currentOperator().name || '前台'
  }
  UTILITY_CHARGES.push(row)
  return row
}

const meterTypeOf = itemId => (feeItemCategoryMap.find(m => m.itemId === itemId) || {}).meterType || '水表'
export const utilityChargeRows = () => UTILITY_CHARGES.map(r => ({ ...r }))
export { MATRIX_START, MATRIX_END, monthRange }

/* ============================================================
 * 水电价目表 · 按业态取价（2026-11-13）
 * ------------------------------------------------------------
 * 单价不再是「收费项上的一个数字」：同一项目里住宅和商业不同价，
 * 商业里零售/餐饮/办公又不同价，个别商户还有协议价。
 *
 * 取价顺序：房屋覆盖 → 房屋类型精确 → 业态 → 通用。
 * **取不到就报错**，不静默回落：一旦回落成住宅价，商业户每次都被少收，
 * 而且差额不会有人发现 —— 这类错误在报表上只表现为"电费收入偏低"。
 * ============================================================ */

const UTILITY_METER_TYPES = ['电表', '水表']

const _tierOfPrice = pid => utilityPrices.find(x => x.priceId === pid) || null

/** 某项目某表计的全部档位（下拉用，含停用标记） */
export function utilityTierRows({ communityId = '', meterType = '' } = {}) {
  return utilityPrices
    .filter(p => (!communityId || p.communityId === communityId) && (!meterType || p.meterType === meterType))
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(p => ({ ...p, priceText: `${p.price} ${p.unit}` }))
}

/**
 * 按「房屋类型 → 业态 → 通用」匹配档位。
 * 房屋类型精确匹配优先于业态：零售铺必须命中 0.80，不能被"商业"这一层盖掉。
 */
function _matchTier(communityId, meterType, usage, houseType) {
  const cands = utilityPrices.filter(p =>
    p.communityId === communityId && p.meterType === meterType && p.enabled)
  if (!cands.length) return null
  const bySort = (a, b) => (a.sort || 0) - (b.sort || 0)
  const exact = cands.filter(p => (p.houseTypes || []).includes(houseType)).sort(bySort)[0]
  if (exact) return exact
  const byUsage = cands.filter(p => !(p.houseTypes || []).length && (p.usage || []).includes(usage)).sort(bySort)[0]
  if (byUsage) return byUsage
  return cands.filter(p => !(p.usage || []).length && !(p.houseTypes || []).length).sort(bySort)[0] || null
}

/**
 * 某户某表计当前生效的价档。
 * 返回值带 isOverride：页面要能看出"这户是特例"，否则运营改价时永远想不起它。
 */
export function utilityPriceOf(houseId, meterType = '电表') {
  const h = houses.find(x => x.houseId === houseId)
  if (!h) throw new Error('房屋不存在')
  if (!UTILITY_METER_TYPES.includes(meterType)) throw new Error(`未知表计：${meterType}`)
  const bind = houseUtilityBinding.find(b => b.houseId === houseId)
  const pid = bind ? (meterType === '电表' ? bind.elecPriceId : bind.waterPriceId) : ''
  if (pid) {
    const t = _tierOfPrice(pid)
    if (t) return { ...t, isOverride: true, overrideReason: bind.reason || '' }
  }
  const t = _matchTier(h.communityId, meterType, h.usage, h.houseType)
  if (!t) {
    throw new Error(`该项目「${h.usage}${h.houseType ? ' · ' + h.houseType : ''}」没有配置${meterType}价，请先在价目表补价`)
  }
  return { ...t, isOverride: false, overrideReason: '' }
}

/** 某个业主义下所有房屋的表计价，收银台按户展示用 */
export function utilityPriceOfHouse(houseId) {
  return { elec: utilityPriceOf(houseId, '电表'), water: utilityPriceOf(houseId, '水表') }
}

/** 改单人房价：必须写原因，否则以后没人知道为什么这户和别人不一样 */
export function setHouseUtilityPrice(houseId, meterType, priceId, reason = '') {
  assertPerm('b.feeItems.view', '维护水电价目需要有收费科目权限')
  const h = houses.find(x => x.houseId === houseId)
  if (!h) throw new Error('房屋不存在')
  const t = _tierOfPrice(priceId)
  if (!t) throw new Error('价档不存在')
  if (t.meterType !== meterType) throw new Error(`该价档是${t.meterType}价，不能用在${meterType}上`)
  if (!t.enabled) throw new Error('该价档已停用')
  if (!String(reason).trim()) throw new Error('改价必须写原因 —— 否则以后查不清这户为什么和别人不一样')
  let row = houseUtilityBinding.find(b => b.houseId === houseId)
  if (!row) {
    row = { houseId, elecPriceId: '', waterPriceId: '', reason: '', updatedAt: '', updatedBy: '' }
    houseUtilityBinding.push(row)
  }
  if (meterType === '电表') row.elecPriceId = priceId
  else row.waterPriceId = priceId
  row.reason = String(reason).trim()
  row.updatedAt = TODAY
  row.updatedBy = currentOperator().name || '系统'
  return utilityPriceOf(houseId, meterType)
}

/** 恢复成业态默认价（清掉单人价覆盖） */
export function resetHouseUtilityPrice(houseId, meterType) {
  const row = houseUtilityBinding.find(b => b.houseId === houseId)
  if (!row) return utilityPriceOf(houseId, meterType)
  if (meterType === '电表') row.elecPriceId = ''
  else row.waterPriceId = ''
  row.updatedAt = TODAY
  if (!row.elecPriceId && !row.waterPriceId) {
    const i = houseUtilityBinding.indexOf(row)
    if (i >= 0) houseUtilityBinding.splice(i, 1)
  }
  return utilityPriceOf(houseId, meterType)
}

/* ---------------- 抄表模式的电费/水费账单 ---------------- */

/**
 * 该户某表计的待缴账单（抄表模式下由抄表出账产生）。
 * 收银台用它渲染「待缴单」，金额不可改 —— 改了等于改读数。
 */
export function utilityBillsOf(houseId, meterType = '电表') {
  const itemId = meterType === '电表' ? 'FI06' : 'FI05'
  return bills
    .filter(b => b.houseId === houseId && b.itemId === itemId
      && ['未缴', '逾期', '部分缴'].includes(b.status))
    .sort((a, b) => String(a.period).localeCompare(String(b.period)))
    .map(b => ({
      ...b,
      unpaid: Math.round((b.amount - (b.paidAmount || 0) - (b.discount || 0)) * 100) / 100,
      usage: b.quantity || 0
    }))
}

/* ---------------- 车位续期 ---------------- */

/**
 * 车位续期：不产生账期、不进欠费统计 —— 过期就是失效，没有"欠几个月"。
 * 续期只做两件事：收一笔钱、把 expireDate 往后推。
 */
export function parkingRenewQuote(parkId, months = 1) {
  const pk = PV_ROWS.find(p => p.parkId === parkId)
  if (!pk) throw new Error('车位不存在')
  const n = Number(months)
  if (!Number.isFinite(n) || n < 1) throw new Error('续期月数至少 1 个月')
  if (n > 36) throw new Error('一次最多续 36 个月')
  if (!pk.expireDate) throw new Error('该车位没有有效期，请先在车位档案里设定')
  const monthly = Number(pk.feeStandard) || 0
  if (!monthly) throw new Error('该车位没有月费标准')
  // 已过期从今天续，未过期从原到期日续 —— 过期户不该白送中间空档
  const base = pk.expireDate >= TODAY ? pk.expireDate : TODAY
  const [y, m, d] = String(base).split('-').map(Number)
  let ny = y, nm = m + n
  while (nm > 12) { nm -= 12; ny += 1 }
  const lastDay = new Date(ny, nm, 0).getDate()
  const newExpire = `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
  return {
    parkId, parkNo: pk.parkNo, plateNo: pk.plateNo || '', months: n,
    monthly, amount: Math.round(monthly * n * 100) / 100,
    oldExpire: pk.expireDate, newExpire,
    expired: pk.expireDate < TODAY,
    daysLeft: pk.expireDate >= TODAY
      ? Math.round((Date.parse(pk.expireDate.replace(/-/g, '/')) - Date.parse(TODAY.replace(/-/g, '/'))) / 86400000)
      : 0
  }
}

/**
 * 车位续期落库：只延长有效期，不产生账单、不进欠费。
 * 与「换绑」分开：换绑改车牌要同步道闸，续期只改日期。
 */
export function renewParking(parkId, months = 1) {
  assertPerm('b.cashier.edit', '缺少权限位 b.cashier.edit：无权收款')
  const q = parkingRenewQuote(parkId, months)
  const pk = PV_ROWS.find(p => p.parkId === parkId)
  pk.expireDate = q.newExpire
  return {
    renewId: 'PR' + String(Date.now()).slice(-6),
    ...q,
    paidAt: `${TODAY}`
  }
}

/* ---------------- 押金（收银台直收，不含退还） ---------------- */

/** 收银台可收押金类型（读字典，不再硬编码三个） */
export const DEPOSIT_COLLECT_TYPES = depositTypeOpts().map(o => ({
  type: o.value, amount: o.standardAmount, refundable: true,
  needDates: o.needDates, byQuantity: o.byQuantity
}))
export const depositCollectTypeOpts = () => depositTypeOpts()

/**
 * 收银台收押金。
 *
 * 金额规则分两种（2026-11-13）：
 *   · 有标准额（装修 3000 / 门禁卡 50 / 车牌 20）—— 金额不可改，一改就成了议价，退的时候按哪个数退；
 *   · 无标准额（履约保证金 / 租约押金）—— 必须按合同或租约填，且要写依据，否则退的时候说不清基数。
 *
 * 这里只「收」，退还走押金台账 —— 收银台上退钱等于开了一条不经审批的出金口。
 */
export function collectDeposit({ houseId, type = '门禁卡押金', quantity = 1, amount = 0, remark = '' } = {}) {
  assertPerm('b.cashier.edit', '缺少权限位 b.cashier.edit：无权收款')
  const h = houses.find(x => x.houseId === houseId)
  if (!h) throw new Error('房屋不存在')
  const def = depositTypeOf(type)
  if (!def) throw new Error('押金类型不存在')
  if (!def.enabled) throw new Error(`押金类型「${def.name}」已停用`)
  const q = Math.max(1, Number(quantity) || 1)
  const fixed = Number(def.standardAmount) > 0
  const amt = fixed
    ? Math.round(def.standardAmount * (def.byQuantity ? q : 1) * 100) / 100
    : Math.round((Number(amount) || 0) * 100) / 100
  if (amt <= 0) throw new Error(`「${def.name}」金额不固定，请按合同/租约填写金额`)
  DP_SEQ += 1
  const rec = {
    depositId: 'DP' + String(DP_SEQ).padStart(5, '0'),
    applyNo: 'YJ' + new Date().getFullYear() + '-' + String(DP_SEQ).padStart(4, '0'),
    communityId: h.communityId, communityName: communityName(h.communityId),
    houseId: h.houseId, houseName: h.fullName,
    ownerId: h.ownerId || '', ownerName: ownerName(h.ownerId), phone: '',
    type: def.name, quantity: def.byQuantity ? q : 1, amount: amt,
    paidDate: TODAY, startDate: '', planEndDate: '', checkDate: null,
    status: def.needDates ? '装修中' : '在押',
    deductAmount: 0, deductReason: '',
    refundAmount: 0, refundDate: null, balance: amt, overdueDays: 0,
    operator: currentOperator().name || '前台', remark: String(remark || ''), _isNew: true
  }
  decorationDeposits.unshift(rec)
  return rec
}

/**
 * 按「指定单价」换算金额与用量。
 * 不能用 utilityQuote：那个读的是收费项上的旧单价（4.2 / 0.62），
 * 现在真实单价在价目表里且按业态不同，混用会让商业户按住宅价结算。
 */
export function utilityQuoteAt(unitPrice, unit = '', { amount, qty } = {}) {
  const p = Number(unitPrice)
  if (!Number.isFinite(p) || p <= 0) throw new Error('单价无效，无法换算')
  const a = Number(amount)
  const q = Number(qty)
  const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100
  if (Number.isFinite(a) && a > 0) return { unitPrice: p, unit, amount: r2(a), qty: r2(a / p) }
  if (Number.isFinite(q) && q > 0) return { unitPrice: p, unit, amount: r2(q * p), qty: r2(q) }
  throw new Error('金额或用量必须填一个')
}

/**
 * 预缴某一期物业费（收银台上的"点未来月份"）。
 *
 * 与 createPrepayCollect 的区别：那个是"给一笔钱，我按先清欠再预付的顺序摊"，
 * 适合业主说"我交 2000"；这个是"就这一期，提前交"，适合业主说"把 12 月也交了"。
 * 两者都只写矩阵，不生成账单 —— 账单是"已经到期要交"的凭证，预缴还没到期。
 */
export function createPrepayForPeriod({ houseId, itemId = 'FI01', period, amount } = {}) {
  assertPerm('b.cashier.edit', '缺少权限位 b.cashier.edit：无权收款')
  const h = houses.find(x => x.houseId === houseId)
  if (!h) throw new Error('房屋不存在')
  if (!period) throw new Error('请选择账期')
  const row = _mtxRow(houseId, itemId, period)
  const left = Math.round((row.receivable - row.received - row.waived) * 100) / 100
  if (left <= 0) throw new Error(`${period} 已收清，无需预缴`)
  const amt = Math.round((Number(amount) || left) * 100) / 100
  if (amt <= 0) throw new Error('预缴金额必须大于 0')
  if (amt > left + 0.01) throw new Error(`预缴金额不能超过该期应收（还剩 ¥${left}）`)
  _MTX_SEQ += 1
  MATRIX_TX.push({
    txId: 'MT' + String(_MTX_SEQ).padStart(6, '0'),
    houseId, itemId, period, amount: amt,
    source: 'prepay', at: `${TODAY}`, prepayOnly: true
  })
  return { period, amount: amt, left: Math.round((left - amt) * 100) / 100 }
}

/**
 * 收银台账期窗口（2026-11-13）。
 *
 * 之前固定铺 6 期（2026-08 ~ 2027-01），前台看不到"一年后"，也没法一次选半年。
 * 现在拆成两段：
 *   欠费段  回溯 6 期（有更早的欠费就自动往前扩到那一期）
 *   预缴段  未来 12 期
 *
 * 欠费段最少给 6 期是刻意的：**已收的月份也要看得见**。
 * 业主说"我 9 月交过了"，前台要能直接把绿格子指给他看，而不是去翻流水。
 * 回溯不早于房屋交付月 —— 不设这个下限，2015 年交付的楼会凭空长出一年的"欠费"。
 */
export function cashierPeriodRows({ houseId, itemId = 'FI01', future = 12, minBack = 5, maxBack = 11 } = {}) {
  const cur = periodOf()
  const h = houses.find(x => x.houseId === houseId)
  if (!h) return { current: cur, from: cur, to: cur, rows: [] }

  let floor = addMonths(cur, -maxBack)
  if (h.deliverDate) {
    const dm = String(h.deliverDate).slice(0, 7)
    if (dm && dm > floor) floor = dm
  }

  /* 最早未缴期：比"回溯 6 期"更早的欠费，要把欠费段往前扩到那一期，
     否则欠了 10 期只显示最近 6 期，前台会以为只欠半年 */
  let from = addMonths(cur, -minBack)
  for (const p of monthRange(floor, cur)) {
    if (_mtxRow(houseId, itemId, p).unpaid > 0) { if (p < from) from = p; break }
  }
  if (from < floor) from = floor

  const to = addMonths(cur, future)
  const rows = monthRange(from, to).map(p => ({
    ..._mtxRow(houseId, itemId, p),
    segment: p < cur ? 'past' : (p === cur ? 'current' : 'future')
  }))
  return { current: cur, from, to, rows }
}

/** 收银台可收的"其他收费科目"：非按月、非水电的那些 */
export function cashierExtraItemOpts() {
  return feeItems
    .filter(i => i.status === '启用' && !['FI01', 'FI05', 'FI06', 'FI07'].includes(i.itemId))
    .filter(i => !['按面积', '按车位'].includes(i.calcType))
    .map(i => ({ value: i.itemId, label: `${i.name}（${i.price} ${i.unit || ''}）`, price: i.price, unit: i.unit, calcType: i.calcType }))
}


/* ==================================================================
 * 批 5 · 支出归集 / 手工补录 / 押金口径（2026-11-13）
 * ------------------------------------------------------------
 * 支出不是一张表：它从四类来源汇过来，各自的"确认时点"还不一样。
 *
 *   费用报销  按**付款日**确认（钱出去才算支出，报销单批了没付不算）
 *   工资      按**当月**计（薪酬是期间费用，发薪日跨月不改变归属月）
 *   合同支出  按**期间摊**（3 年的保洁合同不能一次性记进当月）
 *   手工补录  按**补录的账期**（税费、通道手续费这类没有单据流）
 *
 * 四个来源混成一张表就再也拆不开：问"这个月运营费用为什么涨了"，
 * 分不清是报销多了还是合同摊多了。所以归集表必须保留来源列。
 * ================================================================== */

export const EXPENSE_SOURCES = ['费用报销', '工资', '手工补录', '合同支出']

const _e2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** 某员工归属项目（orgId → communityId），拿不到就算集团 */
const _empCommunity = e => communityOfOrg(e.orgId) || ''

/**
 * 工资成本（单月）。
 * 应发取 monthlySalary；社保公积金与福利按 baseSalary 比例估算并**标注估算**——
 * 真实数在社保申报表里，原型不编造，页面会写明"估算"。
 */
export function payrollCostOf({ communityId = '' } = {}) {
  const live = employees.filter(e => e.status !== '离职')
  const rows = live.filter(e => !communityId || _empCommunity(e) === communityId)
  const salary = _e2(rows.reduce((s, e) => s + (Number(e.monthlySalary) || 0), 0))
  const base = rows.reduce((s, e) => s + (Number(e.baseSalary) || 0), 0)
  const insurance = _e2(base * 0.22)
  const welfare = _e2(base * 0.03)
  return {
    headcount: rows.length,
    salary, insurance, welfare,
    total: _e2(salary + insurance + welfare),
    estimated: true
  }
}

/** 合同支出摊到某月：期间覆盖该月才摊，摊法 = 合同额 ÷ 期间月数 */
function _contractExpenseOf(period, communityId) {
  let amount = 0
  const rows = []
  for (const c of contracts) {
    if (contractDirectionOf(c) !== '支出') continue
    if (communityId && c.communityId !== communityId) continue
    const s = String(c.startDate).slice(0, 7)
    const e = String(c.endDate).slice(0, 7)
    if (!s || !e || period < s || period > e) continue
    const m = contractMonthsOf(c) || 1
    const share = _e2((Number(c.amount) || 0) / m)
    if (share <= 0) continue
    amount += share
    /* 分类是**派生**的：原始合同上没有 categoryId 字段，
       直接读 c.categoryId 会全落进"未归类"，报表看着像有一大笔来源不明的支出 */
    rows.push({
      contractId: c.contractId, contractNo: c.contractNo, name: c.name,
      categoryId: contractCategoryOf(c), amount: share
    })
  }
  return { amount: _e2(amount), rows }
}

/**
 * 支出归集：某账期的支出，按「分类二级 × 来源」拆开。
 * 只统计**已付款**的报销 —— 审批通过但没付款的，钱还在账上，记成支出就是提前确认成本。
 */
export function expenseCollect({ period = periodOf(), communityId = '', source = '' } = {}) {
  const rows = new Map()
  const add = (categoryId, src, amount, count = 1) => {
    if (!(amount > 0)) return
    const cat = feeCategories.find(f => f.code === categoryId) || {}
    const key = categoryId
    const cur = rows.get(key) || {
      categoryId,
      categoryName: cat.name || categoryId,
      parentCode: cat.parentCode || '',
      parentName: (feeCategories.find(f => f.code === cat.parentCode) || {}).name || '未归类',
      amount: 0, count: 0,
      bySource: {}
    }
    cur.amount = _e2(cur.amount + amount)
    cur.count += count
    cur.bySource[src] = _e2((cur.bySource[src] || 0) + amount)
    rows.set(key, cur)
  }

  /* ① 费用报销：只认已付款 */
  const paidExpenses = expenses.filter(x =>
    x.period === period && x.status === '已付款' && (!communityId || x.communityId === communityId))
  for (const x of paidExpenses) add(x.categoryId, '费用报销', x.amount)

  /* ② 工资：三条成本，按月各一份 */
  const pay = payrollCostOf({ communityId })
  add('EXP_LABOR_SALARY', '工资', pay.salary)
  add('EXP_LABOR_INSURANCE', '工资', pay.insurance)
  add('EXP_LABOR_WELFARE', '工资', pay.welfare)

  /* ③ 手工补录：只取支出方向且已入账 */
  const manual = manualEntries.filter(x =>
    x.period === period && x.direction === 'expense' && x.status === '已入账'
    && (!communityId || x.communityId === communityId))
  for (const x of manual) add(x.categoryCode, '手工补录', x.amount)

  /* ④ 合同支出：按期间摊到月 */
  const ce = _contractExpenseOf(period, communityId)
  for (const r of ce.rows) add(r.categoryId, '合同支出', r.amount)

  let list = [...rows.values()].sort((a, b) => b.amount - a.amount)
  if (source) list = list.filter(r => (r.bySource[source] || 0) > 0)

  const bySource = {}
  for (const r of list) for (const [k, v] of Object.entries(r.bySource)) bySource[k] = _e2((bySource[k] || 0) + v)

  /* 一级分类汇总：报表第一层看的是「人力 / 合同 / 运营」，不是几十个二级 */
  const byParent = new Map()
  for (const r of list) {
    const cur = byParent.get(r.parentCode) || { code: r.parentCode, name: r.parentName, amount: 0, count: 0 }
    cur.amount = _e2(cur.amount + r.amount)
    cur.count += r.count
    byParent.set(r.parentCode, cur)
  }

  const total = _e2(list.reduce((s, r) => s + r.amount, 0))
  return {
    period, communityId, source,
    total,
    count: list.reduce((s, r) => s + r.count, 0),
    rows: list,
    bySource: EXPENSE_SOURCES.filter(s => bySource[s]).map(s => ({ source: s, amount: bySource[s] })),
    byParent: [...byParent.values()].sort((a, b) => b.amount - a.amount),
    payroll: pay,
    contractCount: ce.rows.length,
    expenseCount: paidExpenses.length,
    /* 未付款的报销单：列出来提醒"这个月还有多少已批未付"，但它不进上面的合计 */
    unpaidExpense: _e2(expenses.filter(x =>
      x.period === period && x.status === '待付款' && (!communityId || x.communityId === communityId))
      .reduce((s, x) => s + x.amount, 0))
  }
}

/* ---------------- 手工补录 ---------------- */

export const MANUAL_ENTRY_STATUS = ['已入账', '已作废']

/**
 * 可补录的分类：**二级**、方向匹配、且 `allowSources` 里含 `manual`。
 * 这就是"税费只能补录、日常费用必须走报销"的落点 ——
 * 不是靠页面不给选，而是分类字典里那条 `allowSources` 说了算。
 */
export function manualCategoryOpts(direction = 'expense') {
  return feeCategories
    .filter(c => c.level === 2 && c.direction === direction && (c.allowSources || []).includes('manual'))
    .map(c => ({
      value: c.code, label: c.name,
      parentName: (feeCategories.find(f => f.code === c.parentCode) || {}).name || '',
      desc: c.desc || ''
    }))
}

let ME_SEQ = manualEntries.length

export function queryManualEntries({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const { communityId = '', direction = '', categoryCode = '', period = '', kw = '' } = filters
    const list = manualEntries
      .filter(x => !communityId || x.communityId === communityId)
      .filter(x => !direction || x.direction === direction)
      .filter(x => !categoryCode || x.categoryCode === categoryCode)
      .filter(x => !period || x.period === period)
      .filter(x => !kw || `${x.entryNo}${x.reason}${x.objectName}${x.source}`.includes(kw))
      .sort((a, b) => String(b.bizDate).localeCompare(String(a.bizDate)))
    return paged(list, pageNo, size)
  })
}

export function manualEntrySummary() {
  const live = manualEntries.filter(x => x.status === '已入账')
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100
  const exp = live.filter(x => x.direction === 'expense')
  const inc = live.filter(x => x.direction === 'income')
  return {
    count: live.length,
    expense: r2(exp.reduce((s, x) => s + x.amount, 0)),
    income: r2(inc.reduce((s, x) => s + x.amount, 0)),
    tax: r2(live.filter(x => x.categoryCode === 'EXP_OP_TAX').reduce((s, x) => s + x.amount, 0)),
    taxCount: live.filter(x => x.categoryCode === 'EXP_OP_TAX').length,
    voided: manualEntries.filter(x => x.status === '已作废').length
  }
}

/**
 * 建单 / 改单。
 * 三条硬规则：
 *   ① 分类必须接受补录 —— 日常费用（办公/差旅/维修材料）只有报销一条路，
 *      允许补录等于给"绕过审批直接入账"开口子；
 *   ② 税费必须走这里（EXP_OP_TAX 的 allowSources 只有 manual），所以不需要额外标记；
 *   ③ 改单只允许改「已作废」以外的原值 → 已入账的只能作废重录，不能就地改金额。
 */
export function saveManualEntry(payload = {}, entryId = '') {
  assertPerm('b.cashier.edit', '缺少权限位 b.cashier.edit：无权手工补录')

  const direction = payload.direction === 'income' ? 'income' : 'expense'
  const code = String(payload.categoryCode || '')
  const cat = feeCategories.find(f => f.code === code)
  if (!cat) throw new Error('请选择费用分类')
  if (cat.level !== 2) throw new Error('只能挂到二级分类 —— 一级只是汇总口径，不能直接入账')
  if (cat.direction !== direction) throw new Error(`「${cat.name}」是${cat.direction === 'income' ? '收入' : '支出'}分类，方向不一致`)
  if (!(cat.allowSources || []).includes('manual')) {
    throw new Error(`「${cat.name}」不接受手工补录：日常费用请走报销，合同类请走合同台账`)
  }

  const amount = _e2(payload.amount)
  if (!(amount > 0)) throw new Error('金额必须大于 0')
  if (amount > 10000000) throw new Error('单笔金额超过 1000 万，请拆分或走线下')

  const period = String(payload.period || '').trim()
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('账期格式应为 YYYY-MM')
  const bizDate = String(payload.bizDate || `${period}-01`)
  const reason = String(payload.reason || '').trim()
  if (!reason) throw new Error('必须写补录原因 —— 否则以后没人说得清这笔钱是哪来的')

  const now = `${TODAY} ${new Date().toTimeString().slice(0, 5)}`
  if (entryId) {
    const cur = manualEntries.find(x => x.entryId === entryId)
    if (!cur) throw new Error('补录单不存在')
    if (cur.status === '已作废') throw new Error('已作废的单据不能修改，请重新建单')
    Object.assign(cur, {
      direction, categoryCode: code, categoryName: cat.name, amount, period, bizDate,
      objectType: payload.objectType || cur.objectType,
      objectName: String(payload.objectName || '').trim(),
      communityId: String(payload.communityId || ''),
      source: String(payload.source || '').trim(),
      attachment: String(payload.attachment || '').trim(),
      reason
    })
    return { ...cur }
  }

  ME_SEQ += 1
  const rec = {
    entryId: 'ME' + String(ME_SEQ).padStart(4, '0'),
    entryNo: `BL-${period.slice(0, 4)}-${String(ME_SEQ).padStart(3, '0')}`,
    direction, categoryCode: code, categoryName: cat.name, amount, period, bizDate,
    objectType: payload.objectType || '项目',
    objectName: String(payload.objectName || '').trim(),
    communityId: String(payload.communityId || ''),
    source: String(payload.source || '').trim(),
    attachment: String(payload.attachment || '').trim(),
    reason, operator: currentOperator().name || '财务',
    status: '已入账', createdAt: now
  }
  manualEntries.unshift(rec)
  track('manual_entry', { direction, category: code, amount })
  return { ...rec }
}

/** 作废：**不删**。补录是"没有单据流"的钱，删掉就再也查不到它曾经存在过 */
export function voidManualEntry(entryId, reason = '') {
  assertPerm('b.cashier.edit', '缺少权限位 b.cashier.edit：无权作废补录')
  const cur = manualEntries.find(x => x.entryId === entryId)
  if (!cur) throw new Error('补录单不存在')
  if (cur.status === '已作废') throw new Error('该单据已作废')
  const why = String(reason || '').trim()
  if (!why) throw new Error('作废必须写原因 —— 报表要能解释这笔记账为什么被撤回')
  cur.status = '已作废'
  cur.voidReason = why.slice(0, 60)
  cur.voidAt = TODAY
  cur.voidBy = currentOperator().name || '财务'
  return { ...cur }
}

/* ---------------- 押金口径 ---------------- */

/**
 * 押金是**负债**，不是收入：收进来那天现金增加了，但钱不是公司的。
 * 报表里必须单独一行，混进收入就是虚增营收（和预存是同一类错误）。
 */
export const DEPOSIT_CATEGORY_CODE = 'LIA_DEPOSIT'

export function depositLedger() {
  const rows = decorationDeposits
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100
  const received = r2(rows.reduce((s, d) => s + (Number(d.amount) || 0), 0))
  const refunded = r2(rows.reduce((s, d) => s + (Number(d.refundAmount) || 0), 0))
  const deducted = r2(rows.filter(d => Number(d.deductAmount) > 0)
    .reduce((s, d) => s + (Number(d.deductAmount) || 0), 0))
  const byType = new Map()
  for (const d of rows) {
    const cur = byType.get(d.type || '未分类') || { type: d.type || '未分类', count: 0, received: 0, balance: 0 }
    cur.count += 1
    cur.received = r2(cur.received + (Number(d.amount) || 0))
    cur.balance = r2(cur.balance + (Number(d.balance) || 0))
    byType.set(d.type || '未分类', cur)
  }
  return {
    count: rows.length,
    received,
    refunded,
    deducted,
    byType: [...byType.values()].sort((a, b) => b.balance - a.balance),
    /* 在账 = 收 − 退 − 扣。这三个数必须严格相等，否则台账里有一笔去向不明 */
    balance: r2(received - refunded - deducted),
    categoryName: (feeCategories.find(f => f.code === DEPOSIT_CATEGORY_CODE) || {}).name || '押金及保证金',
    note: '收取时计入“其他应付款”，退款时冲减；只有扣款部分（业主违约）才转成收入'
  }
}

/* ==================================================================
 * 批 6 · 三率报表 / 收支分项 / 结余（2026-11-13）
 * ------------------------------------------------------------
 * 三率不是三个百分比，是**同一套数的三种切法**，所以必须一次算完：
 *
 *   应收   = Σ 面积 × 单价 × 期数        （按账期铺，不看有没有开单）
 *   已收   = Σ 矩阵流水（不含减免）
 *   减免   = Σ 矩阵流水中 source=waive
 *   未收   = 应收 − 已收 − 减免          ← **不减到 0**：超额收款是负数，要让人看见
 *
 *   收缴率 = 已收 ÷ (应收 − 减免)
 *   欠费率 = 1 − 收缴率
 *   预缴率 = Σ(归属期 > T2 的已收) ÷ Σ(归属期 > T2 的应收)
 *   清欠额 = Σ(归属期 < T1 的已收)        ← 和预缴分开，混算没有意义
 *   现金收入 = Σ(paidAt ∈ 区间)           ← 按收款日，与归属口径互为勾稽
 *
 * 恒等式 `已收 + 减免 + 未收 = 应收` 是这张报表的自检线：
 * 对不上就是矩阵有孤儿流水，或者某期应收算错了。
 * ================================================================ */

/**
 * 矩阵索引：houseId|itemId|period → { paid, waived }
 * 756 户 × 12 期的报表不能每次都线性扫 MATRIX_TX（那是 3000 万次比较，页面会卡死）。
 * 索引只在调用时建一次，且只建需要的账期范围。
 */
function _matrixIndex(itemId, periods) {
  const want = new Set(periods)
  const idx = new Map()
  for (const t of MATRIX_TX) {
    if (t.itemId !== itemId || !want.has(t.period)) continue
    const k = `${t.houseId}|${t.period}`
    const cur = idx.get(k) || { paid: 0, waived: 0 }
    if (t.source === 'waive') cur.waived += Number(t.amount) || 0
    else cur.paid += Number(t.amount) || 0
    idx.set(k, cur)
  }
  return idx
}

/**
 * 某户某收费项的月应收。
 * 按面积时必须取**户级单价**（住宅 2.8 / 公寓 3.2 / 商业 8.5），
 * 用收费项上的一个价会把商业户的应收算少一大截，收缴率随之虚高。
 */
function _monthlyOf(h, item, priceMap) {
  if (!item) return 0
  if (item.calcType === '按面积') {
    const p = (priceMap && priceMap.get(h.houseId)) || Number(item.price) || 0
    return _e2((h.area || h.buildArea || 0) * p)
  }
  return _e2(Number(item.price) || 0)
}

/**
 * 三率报表。
 * @param {{from?:string,to?:string,communityId?:string,itemId?:string,prepayMonths?:number}} p
 */
export function threeRateReport({
  from = '2026-01', to = periodOf(), communityId = '', itemId = 'FI01', prepayMonths = 12
} = {}) {
  const periods = monthRange(from, to)
  if (!periods.length) throw new Error('开始账期不能晚于结束账期')
  if (periods.length > 36) throw new Error('一次最多统计 36 个账期')

  const item = feeItems.find(i => i.itemId === itemId)
  if (!item) throw new Error('收费项不存在')
  if (!isReceivableItem(itemId)) throw new Error(`「${item.name}」没有月度应收，三率不适用（水电按账单缴，走收入分项）`)

  const hs = houses.filter(h => !communityId || h.communityId === communityId)
  const idx = _matrixIndex(itemId, periods)
  const priceMap = _priceMapOf(itemId)

  let receivable = 0
  let received = 0
  let waived = 0
  const byPeriod = periods.map(p => ({ period: p, receivable: 0, received: 0, waived: 0, unpaid: 0 }))
  const byHouse = new Map()

  hs.forEach(h => {
    const monthly = _monthlyOf(h, item, priceMap)
    if (monthly <= 0) return
    let hp = 0
    let hr = 0
    let hw = 0
    byPeriod.forEach((row, i) => {
      const t = idx.get(`${h.houseId}|${row.period}`) || { paid: 0, waived: 0 }
      row.receivable = _e2(row.receivable + monthly)
      row.received = _e2(row.received + t.paid)
      row.waived = _e2(row.waived + t.waived)
      hp += monthly
      hr += t.paid
      hw += t.waived
    })
    receivable += hp
    received += hr
    waived += hw
    byHouse.set(h.houseId, { receivable: _e2(hp), received: _e2(hr), waived: _e2(hw), unpaid: _e2(hp - hr - hw) })
  })

  receivable = _e2(receivable)
  received = _e2(received)
  waived = _e2(waived)
  /* 不减到 0：超额收款（预缴冲抵到已收满的期）会出现负数，那是有用的信息 */
  const unpaid = _e2(receivable - received - waived)
  byPeriod.forEach(r => { r.unpaid = _e2(r.receivable - r.received - r.waived) })

  const base = _e2(receivable - waived)
  const collectionRate = base > 0 ? Math.round(received / base * 10000) / 100 : 0
  const arrearsRate = Math.round((100 - collectionRate) * 100) / 100

  /* 预缴：归属期 > T2 的已收 ÷ 应收（往后看 prepayMonths 期） */
  const futurePeriods = monthRange(addMonths(to, 1), addMonths(to, prepayMonths))
  const fIdx = _matrixIndex(itemId, futurePeriods)
  let prepayReceived = 0
  let prepayReceivable = 0
  for (const h of hs) {
    const monthly = _monthlyOf(h, item, priceMap)
    if (monthly <= 0) continue
    for (const p of futurePeriods) {
      prepayReceivable += monthly
      const t = fIdx.get(`${h.houseId}|${p}`) || { paid: 0 }
      prepayReceived += t.paid
    }
  }
  prepayReceived = _e2(prepayReceived)
  prepayReceivable = _e2(prepayReceivable)
  const prepayRate = prepayReceivable > 0 ? Math.round(prepayReceived / prepayReceivable * 10000) / 100 : 0

  /* 清欠：归属期 < T1 的已收 */
  const pastPeriods = monthRange(MATRIX_START, addMonths(from, -1))
  const pIdx = _matrixIndex(itemId, pastPeriods)
  let clearingAmount = 0
  for (const h of hs) {
    for (const p of pastPeriods) {
      const t = pIdx.get(`${h.houseId}|${p}`)
      if (t) clearingAmount += t.paid
    }
  }
  clearingAmount = _e2(clearingAmount)

  /* 现金收入：按 paidAt 落在区间（排除预存抵扣 —— 那是负债抵扣，钱早就收过了） */
  const cashIncome = _e2(payments
    .filter(p => {
      const m = String(p.payTime || '').slice(0, 7)
      return m >= from && m <= to && p.channel !== '预存抵扣'
    })
    .reduce((s, p) => s + (Number(p.amount) || 0), 0))

  const unreceived = [...byHouse.entries()]
    .map(([houseId, v]) => ({ houseId, houseName: houseName(houseId), ...v }))
    .filter(x => Math.abs(x.unpaid) > 0.01)
    .sort((a, b) => b.unpaid - a.unpaid)

  return {
    from, to, itemId, itemName: item.name, communityId,
    periods: periods.length,
    houses: hs.length,
    receivable, received, waived, unpaid,
    collectionRate, arrearsRate, prepayRate,
    prepayReceived, prepayReceivable,
    clearingAmount, cashIncome,
    byPeriod,
    /* 自检线：对不上就是矩阵有孤儿流水，或者某期应收算错了 */
    identity: {
      ok: Math.abs(received + waived + unpaid - receivable) < 0.01,
      diff: _e2(received + waived + unpaid - receivable)
    },
    topDebtors: unreceived.slice(0, 8),
    overpaid: unreceived.filter(x => x.unpaid < 0).length
  }
}

/**
 * 收支分项 + 结余（区间）。
 * 收入侧与支出侧的来源不同，不能套同一套模板：
 *   收入：账单实收（按科目）+ 合同收入（按期间摊）+ 临时收费 + 手工补录收入
 *   支出：报销 + 工资 + 合同摊 + 补录（直接复用 expenseCollect，按月累加）
 */
export function incomeExpenseReport({ from = '2026-01', to = periodOf(), communityId = '' } = {}) {
  const periods = monthRange(from, to)
  if (!periods.length) throw new Error('开始账期不能晚于结束账期')

  const catOf = code => {
    const c = feeCategories.find(f => f.code === code) || {}
    return {
      code,
      name: c.name || code,
      parentCode: c.parentCode || '',
      parentName: (feeCategories.find(f => f.code === c.parentCode) || {}).name || '未归类'
    }
  }

  const income = new Map()
  const addIncome = (code, amount) => {
    if (!(amount > 0)) return
    const c = catOf(code)
    const cur = income.get(code) || { ...c, amount: 0 }
    cur.amount = _e2(cur.amount + amount)
    income.set(code, cur)
  }

  /* ① 账单实收：按科目（payments 是按笔的现金，比账单的 paidAmount 更接近"收到多少"）
     payments 上没有 communityId，只能经 houseId 反查；756 户 × 3986 笔不能每次都 find */
  const commOfHouse = new Map(houses.map(h => [h.houseId, h.communityId]))
  const billOf = new Map(bills.map(b => [b.billId, b]))
  const catOfItem = new Map(feeItemCategoryMap.map(m => [m.itemId, m.categoryCode]))
  const payRows = payments.filter(p => {
    const m = String(p.payTime || '').slice(0, 7)
    if (m < from || m > to) return false
    if (p.channel === '预存抵扣' || p.channel === '临时收费') return false
    if (communityId && commOfHouse.get(p.houseId) !== communityId) return false
    return true
  })
  for (const p of payRows) {
    const b = billOf.get(p.billId)
    const itemId = b ? b.itemId : ''
    /* 字段名是 categoryCode，不是 categoryId —— 写错一个字，整张收入表会全落进"其他业务收入" */
    addIncome(catOfItem.get(itemId) || 'INC_OTHER_SERVICE', p.amount)
  }

  /* ② 合同收入：只算计入收入的经营合同，按期间摊到本月 */
  for (const p of periods) {
    for (const c of contracts) {
      if (contractDirectionOf(c) !== '收入' || !contractCountsInRevenue(c)) continue
      if (communityId && c.communityId !== communityId) continue
      const s = String(c.startDate).slice(0, 7)
      const e = String(c.endDate).slice(0, 7)
      if (!s || !e || p < s || p > e) continue
      const m = contractMonthsOf(c) || 1
      addIncome(contractCategoryOf(c), _e2((Number(c.amount) || 0) / m))
    }
  }

  /* ③ 临时收费：已收款，按笔归入临时服务费 */
  const tc = TEMP_CHARGES_LIST()
    .filter(x => x.status === '已收款')
    .filter(x => { const m = String(x.payTime || '').slice(0, 7); return m >= from && m <= to })
    .filter(x => !communityId || x.communityId === communityId)
  for (const x of tc) addIncome('INC_OTHER_SERVICE', x.amount)

  /* ④ 手工补录收入 */
  for (const x of manualEntries) {
    if (x.direction !== 'income' || x.status !== '已入账') continue
    if (x.period < from || x.period > to) continue
    if (communityId && x.communityId !== communityId) continue
    addIncome(x.categoryCode, x.amount)
  }

  /* 支出：逐月归集再合并（expenseCollect 是单月的） */
  const expense = new Map()
  for (const p of periods) {
    const ec = expenseCollect({ period: p, communityId })
    for (const r of ec.rows) {
      const cur = expense.get(r.categoryId) || {
        code: r.categoryId, name: r.categoryName,
        parentCode: r.parentCode, parentName: r.parentName, amount: 0
      }
      cur.amount = _e2(cur.amount + r.amount)
      expense.set(r.categoryId, cur)
    }
  }

  const deco = list => [...list.values()].sort((a, b) => b.amount - a.amount)
  const sum = list => _e2(list.reduce((s, r) => s + r.amount, 0))
  const incomeRows = deco(income)
  const expenseRows = deco(expense)
  const incomeTotal = sum(incomeRows)
  const expenseTotal = sum(expenseRows)

  /* 按月看趋势：结余为负的月份要能一眼找出来 */
  const byMonth = periods.map(p => {
    const inc = _e2(payRows.filter(x => String(x.payTime).slice(0, 7) === p)
      .reduce((s, x) => s + x.amount, 0))
    const ec = expenseCollect({ period: p, communityId })
    return { period: p, income: inc, expense: ec.total, balance: _e2(inc - ec.total) }
  })

  return {
    from, to, communityId, periods: periods.length,
    incomeRows, expenseRows, incomeTotal, expenseTotal,
    balance: _e2(incomeTotal - expenseTotal),
    margin: incomeTotal > 0 ? Math.round((incomeTotal - expenseTotal) / incomeTotal * 10000) / 100 : 0,
    byMonth,
    cashCount: payRows.length
  }
}

/* ==================================================================
 * 报表批（2026-11-14）：减免分析 / 欠费账龄 / 押金在账
 * ------------------------------------------------------------
 * 三张表各回答一个经营者真正会问的问题：
 *   ① 减免分析：这一年让出去的钱，是政策性让的，还是差错改出来的？
 *   ② 欠费账龄：欠的钱有多老？—— 90 天以上收不回来，基本就是坏账；
 *   ③ 押金在账：手上有多少**别人的钱**？它是负债，不能拿来当收入花。
 * ================================================================== */

/**
 * 减免分析（按原因汇总）。
 *
 * 口径要点：
 *   · 金额取**矩阵里的 waive 流水**，不取账单的 discount 字段 —— 一张账单可能分两次减免，
 *     账单只有一个累计值，按它汇总会把两次算成一次；
 *   · 早年没有登记原因的老账（`legacy`），单列成「未填原因（历史数据）」，
 *     不并进「其他」—— 并进去就把"没登记"洗成了"登记了其他"；
 *   · `overLimit` = 单笔超过该原因的免审额度，报表要能一眼看出谁在超权减免。
 */
export function waiveAnalysis({ from = '2026-01', to = periodOf(), communityId = '' } = {}) {
  const periods = new Set(monthRange(from, to))
  if (!periods.size) throw new Error('开始账期不能晚于结束账期')

  const commOf = new Map(houses.map(h => [h.houseId, h.communityId]))
  const houseOf = new Map(houses.map(h => [h.houseId, h]))
  const itemOf = new Map(feeItems.map(i => [i.itemId, i]))

  const tx = MATRIX_TX.filter(t => t.source === 'waive' && periods.has(t.period)
    && (!communityId || commOf.get(t.houseId) === communityId))

  const total = round2(tx.reduce((s, t) => s + (Number(t.amount) || 0), 0))
  const byReason = new Map()
  const periodMap = new Map()
  for (const t of tx) {
    const id = t.reasonId || t.waiveReasonId || ''
    const rec = id ? waiveReasons.find(r => r.reasonId === id) : null
    const key = id || '__none__'
    const cur = byReason.get(key) || {
      reasonId: id,
      name: rec ? rec.name : '未填原因（历史数据）',
      type: rec ? rec.type : '历史',
      countInAssess: rec ? !!rec.countInAssess : false,
      approveAbove: rec ? Number(rec.approveAbove) || 0 : 0,
      amount: 0, count: 0, overLimit: 0, houseSet: new Set()
    }
    cur.amount = round2(cur.amount + (Number(t.amount) || 0))
    cur.count += 1
    cur.houseSet.add(t.houseId)
    if (cur.approveAbove > 0 && t.amount > cur.approveAbove) cur.overLimit += 1
    byReason.set(key, cur)

    const p = periodMap.get(t.period) || { period: t.period, amount: 0, count: 0 }
    p.amount = round2(p.amount + (Number(t.amount) || 0))
    p.count += 1
    periodMap.set(t.period, p)
  }

  const reasons = [...byReason.values()]
    .map(r => ({
      ...r,
      houses: r.houseSet.size,
      share: total > 0 ? Math.round(r.amount / total * 1000) / 10 : 0,
      houseSet: undefined
    }))
    .sort((a, b) => b.amount - a.amount)

  /* 明细：只给前 12 笔 —— 报表是用来发现问题的，逐笔查在账单页 */
  const detail = [...tx].sort((a, b) => b.amount - a.amount).slice(0, 12).map(t => {
    const h = houseOf.get(t.houseId) || {}
    return {
      houseId: t.houseId,
      houseName: h.shortName || h.fullName || t.houseId,
      period: t.period,
      itemName: (itemOf.get(t.itemId) || {}).name || '',
      amount: round2(t.amount),
      reasonId: t.reasonId || t.waiveReasonId || '',
      reasonName: (waiveReasons.find(r => r.reasonId === (t.reasonId || t.waiveReasonId)) || {}).name || '未填原因',
      at: t.at || ''
    }
  })

  return {
    from, to, communityId,
    total,
    count: tx.length,
    houses: new Set(tx.map(t => t.houseId)).size,
    avg: tx.length ? round2(total / tx.length) : 0,
    overLimitCount: reasons.reduce((s, r) => s + r.overLimit, 0),
    reasons,
    byPeriod: [...periodMap.values()].sort((a, b) => String(a.period).localeCompare(String(b.period))),
    detail
  }
}

/**
 * 欠费账龄（实时口径）。
 *
 * 与「报表中心 · 欠费账龄」的区别要说清楚，否则两个页面两个数：
 *   · 这里**实时算**，`asOf` 默认取数据集当下；看板要的是"此刻"；
 *   · 报表中心那张读**跑批快照**，同一个 `statDate` 反复看数字不变，能对账。
 * 两者的分档边界完全一致（未到期 / 1-30 / 31-60 / 61-90 / 91-180 / 180 天以上）。
 */
export function agingReport({ communityId = '', asOf = TODAY } = {}) {
  const DEBT = new Set(['未缴', '部分缴', '逾期'])
  const asOfDate = new Date(`${String(asOf).slice(0, 10)}T00:00:00`)
  /* 分档必须与 `AGING_BUCKETS` / 契约的 AgingBucket 枚举**完全一致**（5 档）：
     报表中心、员工端账龄筛选、这张看板用的是同一个分类，多切一档就出现"三处三个口径"。 */
  const BUCKETS = ['未到期', '0-30天', '31-90天', '91-180天', '180天以上']
  const bucketOf = days => {
    if (days <= 0) return '未到期'
    if (days <= 30) return '0-30天'
    if (days <= 90) return '31-90天'
    if (days <= 180) return '91-180天'
    return '180天以上'
  }

  const rows = bills.filter(b => DEBT.has(b.status) && (Number(b.unpaid) || 0) > 0
    && (!communityId || b.communityId === communityId))

  const agg = new Map(BUCKETS.map(k => [k, { bucket: k, amount: 0, count: 0, houseSet: new Set() }]))
  const commAgg = new Map()
  const detail = []
  for (const b of rows) {
    const due = new Date(`${String(b.dueDate).slice(0, 10)}T00:00:00`)
    const days = Math.max(-9999, Math.floor((asOfDate - due) / 86400000))
    const k = bucketOf(days)
    const cur = agg.get(k)
    cur.amount = round2(cur.amount + (Number(b.unpaid) || 0))
    cur.count += 1
    cur.houseSet.add(b.houseId)

    const ca = commAgg.get(b.communityId) || { communityId: b.communityId, name: (communities.find(c => c.id === b.communityId) || {}).name || b.communityId, amount: 0, houseSet: new Set() }
    ca.amount = round2(ca.amount + (Number(b.unpaid) || 0))
    ca.houseSet.add(b.houseId)
    commAgg.set(b.communityId, ca)

    detail.push({ billId: b.billId, houseId: b.houseId, period: b.period, dueDate: b.dueDate, overdueDays: days, unpaid: round2(b.unpaid), aging: k })
  }

  const total = round2([...agg.values()].reduce((s, r) => s + r.amount, 0))
  return {
    asOf: String(asOf).slice(0, 10),
    total,
    count: rows.length,
    houses: new Set(rows.map(b => b.houseId)).size,
    rows: BUCKETS.map(k => {
      const r = agg.get(k)
      return {
        bucket: k,
        amount: r.amount,
        count: r.count,
        houses: r.houseSet.size,
        share: total > 0 ? Math.round(r.amount / total * 1000) / 10 : 0
      }
    }),
    byCommunity: [...commAgg.values()]
      .map(r => ({ ...r, houses: r.houseSet.size, houseSet: undefined }))
      .sort((a, b) => b.amount - a.amount),
    /* 欠得最久的 8 笔：催缴从这张表往下打 */
    oldest: detail.filter(d => d.overdueDays > 0)
      .sort((a, b) => b.overdueDays - a.overdueDays).slice(0, 8)
  }
}

/**
 * 押金在账（报表视角）。
 *
 * 押金是**负债**（LIA_DEPOSIT）：收进来不是收入，退出去不是支出，只有扣款转收入。
 * 所以这张表分两段，且不能混：
 *   · **期间发生额**：区间内收了多少、退了多少、扣转收入多少；
 *   · **时点在账**：截至 `to` 手上有多少别人的钱。
 * 恒等式 `收 = 退 + 扣 + 在账` 在**全量**上必须成立（区间截断会让它不成立，那是正常的），
 * 所以自检线用全量算，并明确写出来。
 */
export function depositReport({ from = '2026-01-01', to = TODAY, communityId = '' } = {}) {
  const inRange = d => d && d >= from && d <= to
  const rows = decorationDeposits.filter(d => !communityId || d.communityId === communityId)
  const typeAgg = new Map()
  const bump = (type, field, amount) => {
    const cur = typeAgg.get(type) || { type, count: 0, received: 0, refunded: 0, deducted: 0, balance: 0 }
    cur[field] = round2(cur[field] + amount)
    typeAgg.set(type, cur)
  }

  let received = 0, refunded = 0, deducted = 0, balance = 0
  for (const d of rows) {
    const amount = Number(d.amount) || 0
    const refund = Number(d.refundAmount) || 0
    const deduct = Number(d.deductAmount) || 0
    const cur = typeAgg.get(d.type || '未分类') || { type: d.type || '未分类', count: 0, received: 0, refunded: 0, deducted: 0, balance: 0 }
    cur.count += 1
    typeAgg.set(d.type || '未分类', cur)

    if (inRange(String(d.paidDate || '').slice(0, 10))) { received = round2(received + amount); bump(d.type, 'received', amount) }
    if (inRange(String(d.refundDate || '').slice(0, 10))) { refunded = round2(refunded + refund); bump(d.type, 'refunded', refund) }
    if (deduct > 0 && inRange(String(d.checkDate || '').slice(0, 10))) { deducted = round2(deducted + deduct); bump(d.type, 'deducted', deduct) }
    /* 时点在账：`to` 之前收的，才可能还在账上 */
    if (String(d.paidDate || '').slice(0, 10) <= to) {
      const bal = Number(d.balance) || 0
      balance = round2(balance + bal)
      bump(d.type, 'balance', bal)
    }
  }

  const allReceived = round2(rows.reduce((s, d) => s + (Number(d.amount) || 0), 0))
  const allRefunded = round2(rows.reduce((s, d) => s + (Number(d.refundAmount) || 0), 0))
  const allDeducted = round2(rows.reduce((s, d) => s + (Number(d.deductAmount) || 0), 0))
  const allBalance = round2(rows.reduce((s, d) => s + (Number(d.balance) || 0), 0))

  return {
    from, to, communityId,
    received, refunded, deducted, balance,
    byType: [...typeAgg.values()].sort((a, b) => b.balance - a.balance),
    identity: {
      received: allReceived,
      refunded: allRefunded,
      deducted: allDeducted,
      balance: allBalance,
      diff: round2(allReceived - allRefunded - allDeducted - allBalance),
      ok: Math.abs(allReceived - allRefunded - allDeducted - allBalance) <= 0.01
    }
  }
}

/**
 * 预算对比（2026-11-14）。
 *
 * 三条口径必须先说清楚，否则这张表会被读错：
 *   ① **实际数不另算**：直接复用 `incomeExpenseReport` 的结果 —— 同一个 code、同一套金额来源。
 *      报表页六张表里最怕出现"两个页面同一个科目两个数"，所以宁可多调一次函数；
 *   ② **收入看完成率、支出看执行率**：`actual / budget` 的算法一样，语义相反 ——
 *      收入低于 100% 是没收到（欠收），支出高于 100% 是花超了（超支）。文案不能混；
 *   ③ **预算按月编、区间按天取**：区间 3 个月就乘 3，跨年时逐月取对应年度的预算行。
 *      项目筛选下没有项目级预算（集团编制），此时预算列留空并说明原因，不按面积摊。
 */
export function budgetVsActual({ from = '2026-01', to = periodOf(), communityId = '' } = {}) {
  const periods = monthRange(from, to)
  if (!periods.length) throw new Error('开始账期不能晚于结束账期')
  const months = periods.length

  /* 区间预算 = 逐月取该月所属年度的预算行再求和（跨年不会串年） */
  const budgetOf = code => periods.reduce((sum, p) => {
    const y = Number(String(p).slice(0, 4))
    const hit = budgets.find(b => b.categoryCode === code && b.year === y && (b.communityId || '') === communityId)
    return sum + (hit ? Number(hit.monthBudget) || 0 : 0)
  }, 0)

  const pl = incomeExpenseReport({ from, to, communityId })

  const build = (list, direction) => {
    const seen = new Set()
    const rows = []
    for (const r of list) {
      seen.add(r.code)
      const budget = budgetOf(r.code)
      const actual = r.amount
      const hasBudget = budget > 0
      const rate = hasBudget ? Math.round(actual / budget * 1000) / 10 : null
      rows.push({
        code: r.code, name: r.name, parentName: r.parentName, direction,
        budget: hasBudget ? budget : null, actual,
        diff: hasBudget ? Math.round((actual - budget) * 100) / 100 : null,
        rate,
        status: !hasBudget ? '未编预算'
          : direction === 'income'
            ? (rate >= 100 ? '达成' : rate >= 90 ? '接近' : '欠收')
            : (rate > 100 ? '超支' : rate >= 95 ? '接近' : '正常')
      })
    }
    /* 编了预算但一分钱没发生的也要出现：空着一整条比"漏一行"更容易被忽略 */
    for (const b of budgets) {
      if (seen.has(b.categoryCode)) continue
      /* 只补本方向的：否则收入表里会冒出"工资""社保"这种支出科目（第一版就踩了） */
      if (b.direction !== direction) continue
      if ((b.communityId || '') !== communityId) continue
      if (!periods.some(p => Number(String(p).slice(0, 4)) === b.year)) continue
      const budget = budgetOf(b.categoryCode)
      if (!budget) continue
      rows.push({
        code: b.categoryCode, name: b.categoryName, parentName: '', direction: b.direction,
        budget, actual: 0, diff: Math.round((0 - budget) * 100) / 100, rate: 0,
        status: b.direction === 'income' ? '欠收' : '正常'
      })
    }
    rows.sort((a, b) => (b.budget || 0) - (a.budget || 0))
    const budgetTotal = round2(rows.reduce((s, r) => s + (r.budget || 0), 0))
    const actualTotal = round2(rows.reduce((s, r) => s + r.actual, 0))
    const rateTotal = budgetTotal > 0 ? Math.round(actualTotal / budgetTotal * 1000) / 10 : null
    return {
      rows, budgetTotal, actualTotal, rate: rateTotal,
      diff: budgetTotal > 0 ? round2(actualTotal - budgetTotal) : null,
      overCount: rows.filter(r => r.status === '超支').length,
      shortCount: rows.filter(r => r.status === '欠收').length,
      unbudgetedCount: rows.filter(r => r.status === '未编预算').length,
      unbudgetedAmount: round2(rows.filter(r => r.status === '未编预算').reduce((s, r) => s + r.actual, 0))
    }
  }

  const income = build(pl.incomeRows, 'income')
  const expense = build(pl.expenseRows, 'expense')

  return {
    from, to, months, communityId,
    /* 项目维度没有预算时，页面要能解释"为什么这一列是空的"，而不是让人以为没编 */
    scope: communityId ? 'project' : 'group',
    scopeNote: communityId
      ? '预算按集团编制，项目维度只比实际；要看执行率请切回「全部项目」'
      : `集团预算，${months} 个月（月度预算 × ${months}）`,
    income, expense
  }
}

/** 临时收费的原始数组（内部只读用）。写成函数是为了避免顶层 TDZ：
    TEMP_CHARGES 声明在文件中部，这里的代码在模块初始化时不会立即取它 */
function TEMP_CHARGES_LIST() {
  return TEMP_CHARGES
}
