// 原型数据服务层：页面只读这里，禁止在页面里直接 filter/reduce 原始数据
// 目的：口径统一（欠费、收缴率、逾期口径只有一个定义），后续换接口只改本文件

import {
  alarms, approvals, attendance, bills, buildings, collectionRecords, communities, contracts,
  decorationDeposits, devices, employees, feeItems, houses, inspectPlans, inspectTasks,
  inspectTemplates, invoices, maintenanceRecords, members, meterReadings, meters, metrics,
  notices, operationLogs, orgs, owners, parkings, passRecords, payments, permissions,
  prepayAccounts, qualityChecks, roles, tenants, units, vehicles, workOrders
} from '@/mock'
import { daysBetween } from '@/utils/format'
import { currentRoleId } from '@/utils/auth'
import { permCodesOfRole } from '@/utils/rbac'
import { idCardValid } from '@/utils/rules'
import { DICT_MAP, dictMapRaw } from '@/utils/dict'

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
  const list = scopeFilter(communityId ? workOrders.filter(w => w.communityId === communityId) : workOrders, { emp: w => w.assignee })
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
  const list = scopeFilter(communityId ? inspectTasks.filter(t => t.communityId === communityId) : inspectTasks, { emp: t => t.executor })
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
export const houseUsageOpts = () => distinct(houses, 'usage')
export const houseTypeOpts = () => distinct(houses, 'houseType')
export const houseUseStatusOpts = () => distinct(houses, 'useStatus')
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

/* ---------------- 房屋 ---------------- */
export function queryHouses({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const list = scopeFilter(houses).filter(h =>
      eq(h, filters.communityId, 'communityId') &&
      eq(h, filters.buildingId, 'buildingId') &&
      eq(h, filters.usage, 'usage') &&
      eq(h, filters.useStatus, 'useStatus') &&
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
    const vf = OWNER_VF[filters.vf]
    const list = scopeFilter(OWNER_ROWS, { communities: o => OWNER_SCOPE.get(o.ownerId)?.communities || new Set() }).filter(o =>
      ownerInScope(o, 'communities', filters.communityId) &&
      ownerInScope(o, 'buildings', filters.buildingId) &&
      ownerInScope(o, 'units', filters.unitId) &&
      eq(o, filters.ownerType, 'ownerType') &&
      eq(o, filters.creditLevel, 'creditLevel') &&
      (!vf || vf(o)) &&
      kwHit(o, filters.kw, ['name', 'phone', 'ownerId'], o.houseNames.join(' '))
    )
    return paged(list, pageNo, size)
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
    return owners
      .filter(o => scoped(o) && (o.name.includes(k) || o.phone.includes(k) || o.houseIds.some(h => h.includes(k))))
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

/** 业主 360：固定演示对象（与数据集剧本一致） */
export const demoOwnerList = (n = 4) => owners.slice(0, n)
/** 家庭成员 / 租客 */
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
export function queryBills({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const vf = BILL_VF[filters.vf]
    const list = scopeFilter(BILL_ROWS).filter(b =>
      eq(b, filters.communityId, 'communityId') &&
      eq(b, filters.buildingId, 'buildingId') &&
      eq(b, filters.unitId, 'unitId') &&
      eq(b, filters.period, 'period') &&
      eq(b, filters.status, 'status') &&
      eq(b, filters.itemId, 'itemId') &&
      (!vf || vf(b)) &&
      kwHit(b, filters.kw, ['billId', 'itemName'], b.ownerName || ownerNameOf(b.ownerId))
    // 同账期必须返回 0 保持稳定排序，否则种子里的「房屋 / 车位」混排会被打乱成清一色车位账单
    ).sort((a, b) => (a.period === b.period ? 0 : (a.period < b.period ? 1 : -1)))
    return paged(list, pageNo, size)
  })
}

export const paymentsOfOwner = ownerId => payments.filter(p => p.ownerId === ownerId)

/* ---------------- 工单 ---------------- */
export function queryWorkOrders({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const vf = WO_VF[filters.vf]
    const list = scopeFilter(WO_ROWS, { emp: w => w.assignee }).filter(w =>
      eq(w, filters.communityId, 'communityId') &&
      eq(w, filters.buildingId, 'buildingId') &&
      eq(w, filters.unitId, 'unitId') &&
      eq(w, filters.status, 'status') &&
      eq(w, filters.type, 'type') &&
      eq(w, filters.priority, 'priority') &&
      (!vf || vf(w)) &&
      kwHit(w, filters.kw, ['woNo', 'title', 'assignee'], w.ownerName || '')
    )
    return paged(list, pageNo, size)
  })
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
    const list = scopeFilter(inspectTasks, { emp: t => t.executor }).filter(t =>
      eq(t, filters.communityId, 'communityId') &&
      eq(t, filters.status, 'status') &&
      eq(t, filters.post, 'post') &&
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
    .filter(t => ['待执行', '执行中', '逾期'].includes(t.status))
    .slice(0, 8)
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
    return paged(list, pageNo, size)
  })
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
  const cid = HOUSE_COMMUNITY.get(p.houseId) || bill?.communityId || ''
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
    /** 车位管理费类流水没有 houseId，统一落到「车位 xxx」 */
    subject: subjectLabel(p.houseId, bill?.parkId),
    itemName: bill?.itemName || '',
    period: bill?.period || ''
  }
}
const PAY_ROWS = payments.map(payRow)

/* ---------- 21 页三栏骨架（P1 升级）：树轴 项目 → 楼栋 → 单元 ---------- */

// parkonly 供「车位收费」分支复用；其余四个是收银对账视角
const PAY_VF = {
  parkonly: p => p.subjectType === 'park',
  cash: p => p.method === '现金',
  uninvoiced: p => p.invoiceStatus === '未开票',
  red: p => p.invoiceStatus === '已冲红',
  deposit: p => p.channel === '预存抵扣'
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
  pending: w => w.status === '待派单',
  overdue: w => !!w.isOverdue,
  urgent: w => w.priority === '特急' || w.priority === '紧急',
  open: w => WO_OPEN.includes(w.status)
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
    label: { pending: '待派单', overdue: '已超时', urgent: '紧急及以上', open: '未闭环' }[key],
    n: WO_ROWS.filter(hit).length,
    patch: { vf: key, communityId: '', buildingId: '', unitId: '' }
  }))

export function woQuerySummary() {
  return {
    total: WO_ROWS.length,
    open: WO_ROWS.filter(w => WO_OPEN.includes(w.status)).length,
    overdue: WO_ROWS.filter(w => w.isOverdue).length,
    pending: WO_ROWS.filter(w => w.status === '待派单').length
  }
}

export function queryPayments({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const vf = PAY_VF[filters.vf]
    const list = scopeFilter(PAY_ROWS).filter(p =>
      eq(p, filters.communityId, 'communityId') &&
      eq(p, filters.buildingId, 'buildingId') &&
      eq(p, filters.unitId, 'unitId') &&
      (!vf || vf(p)) &&
      eq(p, filters.method, 'method') &&
      eq(p, filters.channel, 'channel') &&
      eq(p, filters.invoiceStatus, 'invoiceStatus') &&
      between(p.payTime, filters.range) &&
      kwHit(p, filters.kw, ['payId', 'transNo', 'operator', 'itemName', 'method', 'channel'],
        `${p.ownerName} ${p.subject}`)
    ).sort((a, b) => (a.payTime < b.payTime ? 1 : -1))
    return paged(list, pageNo, size)
  })
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
      siblings: PAY_ROWS.filter(p => p.billId === payment.billId && p.payId !== payId)
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
export function feeItemRows() {
  return feeItems.map(it => {
    const list = bills.filter(b => b.itemId === it.itemId)
    const s = feeSummaryOf(list)
    return { ...it, ...s }
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
export function queryFeeItems({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const list = feeItemRows().filter(i =>
      eq(i, filters.category, 'category') &&
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
      /** 已转工单时回连工单 */
      workOrder: task.refWoId ? workOrders.find(w => w.woId === task.refWoId) || null : null
    }
  })
}
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

export function queryPassRecords({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const vf = PASS_VF[filters.vf]
    const list = PASS_ROWS.filter(p =>
      eq(p, filters.communityId, 'communityId') &&
      eq(p, filters.zone, 'zone') &&
      (!vf || vf(p)) &&
      eq(p, filters.direction, 'direction') &&
      eq(p, filters.gate, 'gate') &&
      eq(p, filters.channel, 'channel') &&
      between(p.passTime, filters.range) &&
      kwHit(p, filters.kw, ['plateNo', 'parkNo', 'gate', 'ownerName', 'channel', 'operator', 'vehicleType'])
    ).sort((a, b) => (a.passTime < b.passTime ? 1 : -1))
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
  empty: h => h.useStatus === '空置',
  debt: h => h.debt > 0,
  decorating: h => h.useStatus === '装修中',
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
    const list = scopeFilter(HOUSE_ROWS).filter(h =>
      eq(h, filters.communityId, 'communityId') &&
      eq(h, filters.buildingId, 'buildingId') &&
      eq(h, filters.unitId, 'unitId') &&
      eq(h, filters.floor, 'floor') &&
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
  return {
    total: HOUSE_ROWS.length,
    selfUse: use('自住'),
    rent: use('出租'),
    empty: use('空置'),
    decorating: use('装修中'),
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
    if (h.useStatus === '空置') u.empty++
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
    if (h.useStatus === '空置') f.empty++
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
    units: new Set(hs.map(h => h.unitId))
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

/** 换绑留痕：绑定关系变更必须可追溯（原型阶段按车位当前状态派生） */
export function parkingBindLogs(parking, vehicle) {
  if (!parking) return []
  const logs = []
  if (vehicle) {
    logs.push({ title: `绑定 ${vehicle.plateNo}`, memo: '系统同步 · 厂商回执成功', done: true })
    logs.push({ title: `授权状态 ${vehicle.authStatus} · ${vehicle.inOutType}`, memo: '道闸白名单已下发', done: true })
  } else {
    logs.push({ title: '车位启用', memo: `${parking.communityName} · ${parking.zoneLabel} 交付启用`, done: true })
    logs.push({ title: '尚未绑定车牌', memo: '可直接用于新业主 / 租户分配', done: false })
  }
  // 未绑定 / 闲置车位（192 个）没有管理费到期日，不显示续期条目
  if (parking.expireDate) {
    logs.push({
      title: `管理费续期至 ${parking.expireDate}`,
      memo: parking.expiring ? '即将到期 · 待收银台缴费后自动展期' : '收银台缴费后自动展期',
      done: false
    })
  }
  return logs
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
      bindLogs: parkingBindLogs(parking, vehicle)
    }
  })
}
export const parkZoneOpts = () => distinct(parkings, 'zone')
export const parkStatusOpts = () => distinct(parkings, 'status')
export const parkBindStatusOpts = () => distinct(parkings, 'bindStatus')
export const parkCategoryOpts = () => distinct(parkings, 'category')

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

/* ---------------- 29 · 租户管理 ---------------- */

/** 租户行：房屋/业主/剩余租期全部由房屋台账同源派生，口径与房屋页一致 */
const TENANT_ROWS = tenants.map(t => {
  const h = HOUSE_ROWS.find(x => x.houseId === t.houseId)
  const left = daysBetween(t.leaseEnd) === null ? null : -daysBetween(t.leaseEnd)
  const months = Math.round((new Date(t.leaseEnd) - new Date(t.leaseStart)) / 2628000000)
  return {
    ...t,
    communityId: h?.communityId || '',
    communityName: h?.communityName || '-',
    buildingId: h?.buildingId || '',
    buildingName: h?.buildingName || '-',
    unitId: h?.unitId || '',
    houseName: h?.fullName || t.houseId,
    houseUsage: h?.usage || '-',
    ownerName: ownerNameOf(t.ownerId),
    ownerPhone: owners.find(o => o.ownerId === t.ownerId)?.phone || '',
    leftDays: left,
    months,
    // 续租提醒窗口取 90 天（与合同到期同口径）；租约极少在 30 天内集中到期，30 天窗口会长期为 0，失去提醒意义
    expiring: left !== null && left >= 0 && left <= 90,
    expired: left !== null && left < 0
  }
})
const TENANT_VF = {
  expiring: t => t.expiring,
  long: t => t.months >= 12,
  uncertified: t => !t.certified,
  noface: t => !t.faceRegistered
}

export function tenantTree() {
  const roots = []
  const idx = new Map()
  for (const t of TENANT_ROWS) {
    if (!t.communityId) continue
    let c = idx.get(t.communityId)
    if (!c) {
      c = { id: t.communityId, type: 'community', label: t.communityName, n: 0, children: [], _map: new Map(),
        patch: { communityId: t.communityId, buildingId: '', unitId: '', vf: '' } }
      idx.set(t.communityId, c); roots.push(c)
    }
    let b = c._map.get(t.buildingId)
    if (!b) {
      b = { id: t.buildingId, type: 'building', label: t.buildingName, n: 0, children: [], _map: new Map(),
        patch: { communityId: t.communityId, buildingId: t.buildingId, unitId: '', vf: '' } }
      c.children.push(b); c._map.set(t.buildingId, b)
    }
    const ukey = t.unitId || t.houseId
    let u = b._map.get(ukey)
    if (!u) {
      u = { id: ukey, type: 'unit', label: unitLabel(t.unitId), n: 0, children: [],
        patch: { communityId: t.communityId, buildingId: t.buildingId, unitId: t.unitId, vf: '' } }
      b.children.push(u); b._map.set(ukey, u)
    }
    u.n++
  }
  const tidy = n => {
    if (n.children.length) { n.children.forEach(tidy); n.n = n.children.reduce((s, x) => s + x.n, 0) }
    delete n._map
    return n
  }
  return roots.map(tidy)
}
export const tenantVirtualNodes = () => Object.entries(TENANT_VF).map(([key, hit]) => ({
  key,
  label: { expiring: '90 天内到期', long: '一年以上长租', uncertified: '未实名认证', noface: '未录入人脸' }[key],
  n: TENANT_ROWS.filter(hit).length,
  patch: { vf: key, communityId: '', buildingId: '', unitId: '' }
}))

export function queryTenants({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const vf = TENANT_VF[filters.vf]
    const list = TENANT_ROWS.filter(t =>
      eq(t, filters.communityId, 'communityId') &&
      eq(t, filters.buildingId, 'buildingId') &&
      eq(t, filters.unitId, 'unitId') &&
      eq(t, filters.certified, 'certified') &&
      eq(t, filters.faceRegistered, 'faceRegistered') &&
      eq(t, filters.ownerId, 'ownerId') &&
      (!vf || vf(t)) &&
      kwHit(t, filters.kw, ['name', 'phone', 'tenantId', 'houseName', 'ownerName'])
    )
    return paged(list, pageNo, size)
  })
}
export function tenantSummary() {
  const avg = TENANT_ROWS.reduce((s, t) => s + t.rent, 0) / (TENANT_ROWS.length || 1)
  return {
    total: TENANT_ROWS.length,
    expiring: TENANT_ROWS.filter(TENANT_VF.expiring).length,
    uncertified: TENANT_ROWS.filter(TENANT_VF.uncertified).length,
    noface: TENANT_ROWS.filter(TENANT_VF.noface).length,
    avgRent: Math.round(avg),
    rentIncome: Math.round(TENANT_ROWS.reduce((s, t) => s + t.rent, 0))
  }
}
/** 租户详情：租客 + 房屋 + 业主 + 该房屋欠费 + 租约时间线 */
export function getTenantDetail(tenantId) {
  return delay(() => {
    const tenant = TENANT_ROWS.find(t => t.tenantId === tenantId)
    if (!tenant) return null
    const house = HOUSE_ROWS.find(h => h.houseId === tenant.houseId) || null
    const owner = owners.find(o => o.ownerId === tenant.ownerId) || null
    const hb = billsOfHouse(tenant.houseId)
    return {
      tenant, house, owner,
      bills: hb.slice(0, 8),
      debt: house?.debt || 0,
      timeline: [
        { title: `签约 · 租期 ${tenant.months} 个月`, memo: `${tenant.leaseStart} 起 · 月租 ¥${tenant.rent}`, done: true },
        { title: '实名认证', memo: tenant.certified ? '已完成 · 身份证已核验' : '未完成 · 待租客提交证件', done: !!tenant.certified },
        { title: '人脸录入', memo: tenant.faceRegistered ? '已录入 · 门禁可刷脸通行' : '未录入 · 仅刷卡通行', done: !!tenant.faceRegistered },
        { title: `租期至 ${tenant.leaseEnd}`,
          memo: tenant.expired ? `已过期 ${Math.abs(tenant.leftDays)} 天 · 待续租或退租` : `剩余 ${tenant.leftDays} 天${tenant.expiring ? ' · 待续租提醒' : ''}`,
          done: false }
      ]
    }
  })
}

/* ---------------- 30 · 合同管理 ---------------- */

const CONTRACT_ROWS = contracts.map(c => ({
  ...c,
  communityName: c.communityId ? communityName(c.communityId) : '集团 / 全项目',
  // 剩余天数：正数=还在履约，负数=已过期
  restDays: daysBetween(c.endDate) === null ? null : -daysBetween(c.endDate)
}))
const CONTRACT_VF = {
  expiring: c => c.status === '即将到期',
  expired: c => c.status === '已到期',
  pending: c => c.status === '草稿' || c.status === '待审批',
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
      eq(c, filters.ctype, 'type') &&
      eq(c, filters.csub, 'subtype') &&
      eq(c, filters.communityId, 'communityId') &&
      eq(c, filters.status, 'status') &&
      (!vf || vf(c)) &&
      kwHit(c, filters.kw, ['contractNo', 'name', 'partyB', 'contact', 'owner', 'subtype'])
    )
    return paged(list, pageNo, size)
  })
}
export function contractSummary() {
  const st = s => CONTRACT_ROWS.filter(c => c.status === s).length
  return {
    total: CONTRACT_ROWS.length,
    amount: Math.round(CONTRACT_ROWS.reduce((s, c) => s + c.amount, 0)),
    running: st('履行中'),
    expiring: CONTRACT_ROWS.filter(CONTRACT_VF.expiring).length,
    expired: CONTRACT_ROWS.filter(CONTRACT_VF.expired).length,
    pending: CONTRACT_ROWS.filter(CONTRACT_VF.pending).length
  }
}
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
export const contractTypeOpts = () => distinct(contracts, 'type')
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

export function queryQualityChecks({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => {
    const vf = QC_VF[filters.vf]
    const list = QC_ROWS.filter(q =>
      eq(q, filters.communityId, 'communityId') &&
      eq(q, filters.area, 'area') &&
      eq(q, filters.type, 'type') &&
      eq(q, filters.grade, 'grade') &&
      eq(q, filters.status, 'status') &&
      (!vf || vf(q)) &&
      kwHit(q, filters.kw, ['checkNo', 'checker', 'area', 'communityName'])
    )
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
 * 模型（用户已拍板）：纯 RBAC —— 人 → 角色 → 权限；数据权限按项目级五档
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
  保洁主管: 'T4', 保洁员: 'T4', 绿化员: 'T4'
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

const empRow = e => {
  const orgId = teamOf(e) || e.orgId
  const overridden = EMP_ROLE_OVERRIDE.get(e.empId)
  const role = (overridden && ROLE_OF.get(overridden)) || roleOfEmp(e)
  const cl = daysBetween(e.contractEnd)
  return {
    ...e,
    orgId,
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
    noSocial: !e.socialSecurity,
    lateHeavy: (e.attendance?.late || 0) >= 3
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
        n: subtreeCount(o.orgId),
        leader: o.leader,
        children: kids.length ? kids : undefined,
        patch: { orgId: o.orgId, vf: '' }
      }
    })
  /** 根取「集团」的下级：el-tree 默认折叠，返回单根会让进页面只看到一个节点 */
  return build('O-ROOT')
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
    contractExpired: count(e => e.contractExpired)
  }
}

export const roleOpts = () => ROLE_ROWS.map(r => ({ value: r.roleId, label: r.name }))

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
export const dataScopeOpts = () => ['全部项目', '指定项目', '本项目', '本部门', '仅本人']
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

/** Tab3：数据范围五档 → 角色。左树本身就是「谁能看到什么」的答案 */
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
 *  onlyVacant 用于租约「只选可出租房屋」（待确认：空置判定是否看 useStatus === '空置'） */
export function houseOptions(n = 300, { onlyVacant = false, communityId = '' } = {}) {
  return houses
    .filter(h => (!communityId || h.communityId === communityId))
    .filter(h => !onlyVacant || h.useStatus === '空置' || h.useStatus === '出租')
    .slice(0, n)
    .map(h => ({
      houseId: h.houseId, label: h.fullName, room: h.room, buildingId: h.buildingId,
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

/** 合同子类型：按主类型过滤（type 切换时联动） */
export function contractSubtypeOpts(type = '') {
  return distinct(contracts.filter(c => !type || c.type === type), 'subtype')
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

/** 营业报表：按「项目 × 科目」汇总应收 / 已收 / 未收与收缴率 */
function businessRows(filters = {}) {
  const m = new Map()
  for (const b of scopeFilter(bills)) {
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
  return [...m.values()]
    .map(x => ({ ...x, rate: x.payable > 0 ? Math.round((x.paid / x.payable) * 1000) / 10 : null }))
    .filter(x => kwHit(x, filters.kw, ['itemName', 'communityName']))
    .sort((a, b) => b.payable - a.payable)
}
export function queryBusiness({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => paged(businessRows(filters), pageNo, size))
}

/** 报修汇总：按「项目 × 工单类型」汇总数量、完工量、超时量与平均时长 */
function repairRows(filters = {}) {
  const m = new Map()
  for (const w of workOrders) {
    if (filters.communityId && w.communityId !== filters.communityId) continue
    const key = `${w.communityId}|${w.type}`
    const cur = m.get(key) || {
      key, communityId: w.communityId, communityName: communityName(w.communityId),
      type: w.type, count: 0, done: 0, overdue: 0, hours: 0, hourBase: 0
    }
    cur.count++
    if (['已完成', '已评价'].includes(w.status)) cur.done++
    if (w.isOverdue) cur.overdue++
    if (w.durationHours) { cur.hours += w.durationHours; cur.hourBase++ }
    m.set(key, cur)
  }
  return [...m.values()]
    .map(x => ({ ...x, avgHours: x.hourBase ? Math.round((x.hours / x.hourBase) * 10) / 10 : null }))
    .filter(x => kwHit(x, filters.kw, ['type', 'communityName']))
    .sort((a, b) => b.count - a.count)
}
export function queryRepairSummary({ pageNo = 1, size = 20, filters = {} } = {}) {
  return delay(() => paged(repairRows(filters), pageNo, size))
}

/* ---------------- 装修押金（唯一押金场景） ---------------- */
// 口径（用户 2026-10-22 确认）：押金场景只保留「装修押金」一种。
// 租约押金、车位押金等一律不存在，因此 tenants 不设押金字段，押金只在此处出数。
// 余额 balance = amount - refundAmount - deductAmount；在账 = 未验收（装修中 / 已逾期）或未结清。

export const DEPOSIT_STATUS = ['装修中', '已逾期', '已退还', '部分扣除', '已没收']
export const depositStatusOpts = () => DEPOSIT_STATUS.map(v => ({ value: v, label: v }))

const DEPOSIT_VF = {
  /** 在账：钱还在物业手里 */
  onhand: d => (d.balance || 0) > 0,
  /** 逾期未退：超过申请工期仍未验收 */
  overdue: d => d.status === '已逾期',
  /** 已结清：已退还 / 部分扣除 / 已没收 */
  settled: d => ['已退还', '部分扣除', '已没收'].includes(d.status),
  /** 有扣除：验收时扣了钱（部分扣除或全额没收） */
  deducted: d => (d.deductAmount || 0) > 0
}
export const depositVirtualNodes = () => {
  const label = {
    onhand: '在账（未结清）', overdue: '逾期未验收', settled: '已结清', deducted: '有扣款'
  }
  return [{ key: 'all', label: '全部装修押金', n: decorationDeposits.length, patch: { vf: '' } }]
    .concat(Object.keys(DEPOSIT_VF).map(key => ({
      key, label: label[key], n: decorationDeposits.filter(DEPOSIT_VF[key]).length, patch: { vf: key }
    })))
}

function depositRows(filters = {}) {
  return decorationDeposits.filter(d =>
    eq(d, filters.communityId, 'communityId') &&
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
    overdueAmount: list.filter(DEPOSIT_VF.overdue).reduce((s, d) => s + (d.balance || 0), 0)
  }
}

/** 报表合计行：与列表同口径，避免「表内加总 ≠ 合计行」 */
export function reportSummary(code, filters = {}) {
  if (code === 'fee-detail' || code === 'debt-detail') {
    const vf = code === 'debt-detail' ? 'debt' : (filters.vf || '')
    const list = scopeFilter(BILL_ROWS).filter(b =>
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
  if (code === 'business') {
    const list = businessRows(filters)
    return {
      count: list.length,
      payable: list.reduce((s, x) => s + x.payable, 0),
      paid: list.reduce((s, x) => s + x.paid, 0),
      unpaid: list.reduce((s, x) => s + x.unpaid, 0)
    }
  }
  if (code === 'inspect') {
    const s = inspectReportSummary(filters)
    return { count: s.count, payable: s.planned, paid: s.doneRate, unpaid: s.issues, deduct: s.late }
  }
  if (code === 'repair-summary') {
    const list = repairRows(filters)
    return {
      count: list.reduce((s, x) => s + x.count, 0),
      payable: list.reduce((s, x) => s + x.done, 0),      // 复用字段位：done
      paid: list.reduce((s, x) => s + x.overdue, 0),      // 复用字段位：overdue
      unpaid: 0
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

/* ---------------- 工单发起（F1） ---------------- */

export const woTypeOpts = () => distinct(workOrders, 'type')
export const woCategoryOpts = (type = '') => distinct(workOrders.filter(w => !type || w.type === type), 'category')
export const woPriorityOpts = () => ['特急', '紧急', '普通']
export const woSourceOpts = () => ['客服代客', '业主 App', '小程序', '电话', '巡检发现', '设备告警']

let WO_SEQ = workOrders.length
/** 发起工单：写入内存（当次会话内在工单列表可见，刷新还原） */
export function createWorkOrder(p = {}) {
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
    type: p.type || '报事', category: p.category || '',
    source: p.source || '客服代客', priority: p.priority || '普通',
    status: '待派单', title: p.title || '', description: p.description || '',
    images: p.images || 0, createTime: _now(), dispatchMode: p.assignee ? '手动派单' : '待派单',
    assignee: p.assignee || '', assigneePhone: '', acceptTime: '', arriveTime: '', finishTime: '',
    durationHours: 0, slaHours: p.priority === '特急' ? 4 : (p.priority === '紧急' ? 8 : 24),
    isOverdue: false, feeType: p.feeType || '免费', materialFee: 0, laborFee: 0, totalFee: 0,
    payStatus: '未支付', score: 0, evalTags: [], evaluate: '',
    remark: p.remark || '', isPublic: !p.houseId,
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
    communityId: a.communityId, type: '公共区域维修', category: '设备故障',
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
  if (action === '驳回') {
    node.action = '驳回'; node.handler = node.handler || '当前处理人'; node.time = time
    node.comment = comment || '不符合要求'
    a.status = '已驳回'; a.currentNode = '已完成'
  } else if (action === '转办') {
    if (!to) throw new Error('请选择转办人')
    node.handler = to; node.time = time; node.comment = `转办给 ${to}${comment ? '：' + comment : ''}`
    node.action = '转办'
    a.status = '审批中'; a.currentNode = `${node.node}（${to}）`
  } else if (action === '加签') {
    if (!to) throw new Error('请选择加签人')
    node.handler = node.handler || '当前处理人'; node.time = time
    node.action = '同意'; node.comment = comment || '同意，已加签'
    a.flow.splice(idx + 1, 0, { node: `加签审批（${to}）`, handler: to, action: '待处理', time: '', comment: '' })
    a.status = '审批中'; a.currentNode = `加签审批（${to}）`
  } else {
    node.action = '同意'; node.handler = node.handler || '当前处理人'; node.time = time
    node.comment = comment || '同意'
    const next = a.flow[idx + 1]
    if (next) { next.action = '待处理'; a.status = '审批中'; a.currentNode = next.node }
    else { a.status = '已通过'; a.currentNode = '已完成' }
  }
  // 合同域回写：审批通过/驳回后同步合同与变更单（C4）
  _applyContractApproval(a, action)
  return a
}

/** 转办 / 加签的候选人：主管及以上 */
export const approvalCandidates = () => employees
  .filter(e => e.status === '在职' && /主管|经理|总监/.test(e.position))
  .slice(0, 40).map(e => ({ empId: e.empId, name: e.name, position: e.position }))

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
  return delay(() => paged(scopeFilter(debtPoolRows(filters)), pageNo, size))
}

/** 催缴工作台概览：欠费户数 / 金额 / 账龄分布 / 已催缴覆盖率 */
export function collectionSummary() {
  const pool = scopeFilter(debtPoolRows())
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
/** 开票：单张或批量（内存态），并回写缴费流水的开票状态 */
export function issueInvoice(payIds, type = '电子发票') {
  const ids = Array.isArray(payIds) ? payIds : [payIds]
  if (!ids.length) throw new Error('请先选择需要开票的收款记录')
  const created = []; const skipped = []
  for (const pid of ids) {
    const p = payments.find(x => x.payId === pid)
    if (!p) { skipped.push(pid); continue }
    if (p.invoiceStatus === '已开票') { skipped.push(pid); continue }
    IV_SEQ += 1
    const amt = p.amount || 0
    const inv = {
      invoiceId: 'IV' + String(IV_SEQ).padStart(6, '0'),
      invoiceNo: type === '收据' ? 'SJ' + String(10000000 + IV_SEQ) : '0264' + String(10000000 + IV_SEQ),
      type, status: '已开具', payId: p.payId, billId: p.billId,
      communityId: _HOUSE_CM.get(p.houseId) || 'P01',
      communityName: communityName(_HOUSE_CM.get(p.houseId) || 'P01'),
      houseId: p.houseId, houseName: houseName(p.houseId),
      ownerId: p.ownerId, ownerName: ownerName(p.ownerId),
      itemName: '物业服务费', amount: amt, taxAmount: type === '收据' ? 0 : Math.round(amt * 0.06 * 100) / 100,
      issueTime: _now(), issuer: '当前登录人', channel: '前台开具',
      redReason: '', redTime: '', failReason: '', _isNew: true
    }
    invoices.unshift(inv)
    p.invoiceStatus = '已开票'
    p.invoiceNo = inv.invoiceNo
    _syncPayRow(p)          // 缴费流水的「未开票 / 已冲红」虚拟节点读 PAY_ROWS
    created.push(inv)
  }
  if (!created.length) throw new Error('所选记录均已开票或不存在')
  return { created, skipped, count: created.length }
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
      .map(p => ({
        payId: p.payId, billId: p.billId, amount: p.amount, method: p.method,
        payTime: p.payTime, transNo: p.transNo, channel: p.channel,
        houseId: p.houseId, houseName: houseName(p.houseId),
        ownerId: p.ownerId, ownerName: ownerName(p.ownerId),
        communityId: _HOUSE_CM.get(p.houseId) || 'P01',
        communityName: communityName(_HOUSE_CM.get(p.houseId) || 'P01'),
        invoiceStatus: p.invoiceStatus || '未开票'
      }))
    return paged(list, pageNo, size)
  })
}

/* ---------------- B4 装修押金台账（写操作） ---------------- */

let DP_SEQ = decorationDeposits.length
/** 登记装修押金（内存态）：金额按面积分档的建议值由页面给出，此处只落库 */
export function createDeposit(p = {}) {
  const h = _HOUSE_OF.get(p.houseId)
  if (!h) throw new Error('请选择装修房屋')
  const ow = _OWNER_OF.get(p.ownerId || h.ownerId) || null
  const amount = Number(p.amount) || 0
  if (amount <= 0) throw new Error('押金金额必须大于 0')
  if (!p.startDate || !p.planEndDate) throw new Error('请填写开工日期与计划完工日期')
  if (p.planEndDate <= p.startDate) throw new Error('计划完工日期必须晚于开工日期')
  DP_SEQ += 1
  const rec = {
    depositId: 'DP' + String(DP_SEQ).padStart(5, '0'),
    applyNo: 'ZX' + new Date().getFullYear() + '-' + String(DP_SEQ).padStart(4, '0'),
    communityId: h.communityId, communityName: communityName(h.communityId),
    houseId: h.houseId, houseName: h.fullName,
    ownerId: ow?.ownerId || '', ownerName: ow?.name || p.ownerName || '',
    phone: ow?.phone || p.phone || '',
    type: '装修押金', amount,
    paidDate: p.paidDate || _now().slice(0, 10),
    startDate: p.startDate, planEndDate: p.planEndDate, checkDate: null,
    status: '装修中', deductAmount: 0, deductReason: '',
    refundAmount: 0, refundDate: null, balance: amount, overdueDays: 0,
    operator: p.operator || '当前登录人', remark: p.remark || '', _isNew: true
  }
  decorationDeposits.unshift(rec)
  return rec
}

/** 验收：填验收日与扣款金额 / 原因；扣款不得超过押金总额 */
export function checkDeposit(depositId, { checkDate = '', deductAmount = 0, deductReason = '' } = {}) {
  const d = decorationDeposits.find(x => x.depositId === depositId)
  if (!d) throw new Error('押金记录不存在')
  if (d.status !== '装修中' && d.status !== '已逾期') throw new Error('只有「装修中 / 已逾期」可以验收')
  if (!checkDate) throw new Error('请填写验收日期')
  const deduct = Number(deductAmount) || 0
  if (deduct < 0 || deduct > d.amount) throw new Error('扣款金额不得为负且不得超过押金总额')
  if (deduct > 0 && !deductReason) throw new Error('有扣款时必须填写扣款原因')
  d.checkDate = checkDate
  d.deductAmount = Math.round(deduct * 100) / 100
  d.deductReason = deduct ? deductReason : ''
  // 验收通过不等于钱已退：无扣款时进入「待退款」，由退款动作最终置「已退还」
  d.status = deduct >= d.amount ? '已没收' : (deduct > 0 ? '部分扣除' : '待退款')
  d.overdueDays = checkDate > d.planEndDate
    ? Math.round((new Date(checkDate) - new Date(d.planEndDate)) / 86400000) : 0
  return d
}

/** 退款：验收通过后退余额（可部分退），退完置「已退还」 */
export function refundDeposit(depositId, { refundAmount = null, refundDate = '' } = {}) {
  const d = decorationDeposits.find(x => x.depositId === depositId)
  if (!d) throw new Error('押金记录不存在')
  if (!d.checkDate) throw new Error('请先完成验收')
  const can = Math.round((d.amount - d.deductAmount - d.refundAmount) * 100) / 100
  if (can <= 0) throw new Error('该押金已无余额可退')
  const amt = refundAmount === null ? can : Number(refundAmount)
  if (amt <= 0 || amt > can) throw new Error(`退款金额应在 0 ~ ${can} 之间`)
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
  { key: 'login.sessionHours', name: '会话有效期', value: '8', unit: '小时', group: '安全', desc: '超时后需重新登录' }
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
  n.readCount = 0
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
  PLAN_SEQ += 1
  const tpl = inspectTemplates.find(t => t.templateId === d.templateId)
  const row = {
    planId: 'IP' + String(PLAN_SEQ).padStart(2, '0'),
    name, post: d.post || (tpl?.post || '保洁'),
    cycle: d.cycle || '每日', templateId: d.templateId,
    communityId: d.communityId || 'P01',
    executor: d.executor, items: tpl?.fields?.length || d.items || 6,
    status: d.status || '启用',
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
  Object.assign(p, {
    name: payload.name || p.name, post: payload.post || p.post, cycle: payload.cycle || p.cycle,
    templateId: payload.templateId || p.templateId, executor: payload.executor || p.executor,
    status: payload.status || p.status, startDate: payload.startDate ?? p.startDate,
    endDate: payload.endDate ?? p.endDate, remark: payload.remark ?? p.remark
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
export const dataScopeOptsOf = () => ['全部项目', '指定项目', '本项目', '本部门', '仅本人']

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

/** 充值：余额增加，写流水 */
export function recharge(accountId, amount, method = '微信') {
  const a = prepayAccounts.find(x => x.accountId === accountId)
  if (!a) throw new Error('预存账户不存在')
  if (a.status === '已销户') throw new Error('已销户账户不可充值')
  const amt = Number(amount)
  if (!amt || amt <= 0) throw new Error('充值金额须大于 0')
  if (amt > 50000) throw new Error('单次充值不得超过 ¥50,000')
  a.balance = Math.round((a.balance + amt) * 100) / 100
  a.totalRecharge = Math.round((a.totalRecharge + amt) * 100) / 100
  a.lastRechargeDate = _now().slice(0, 10)
  if (a.status === '冻结') a.status = '正常'
  PL_SEQ += 1
  PREPAY_LOGS.unshift({
    logId: 'PL' + String(PL_SEQ).padStart(6, '0'), accountId, type: '充值',
    amount: amt, balance: a.balance, method, time: _now(), operator: '当前登录人',
    remark: `${method}充值 ¥${amt}`
  })
  return { ...a }
}

/** 余额抵扣：按「账期最早的未缴账单」逐笔冲抵，返回抵扣明细 */
export function deductPrepay(accountId, amount) {
  const a = prepayAccounts.find(x => x.accountId === accountId)
  if (!a) throw new Error('预存账户不存在')
  if (a.status !== '正常') throw new Error(`账户状态「${a.status}」不可抵扣`)
  const amt = Number(amount)
  if (!amt || amt <= 0) throw new Error('抵扣金额须大于 0')
  if (amt > a.balance) throw new Error(`余额不足：可用 ¥${a.balance}，需抵扣 ¥${amt}`)

  // 必须改原 bills（feeSummary / 催缴池 / 房屋欠费都读它），再同步 BILL_ROWS 派生行；
  // 只改派生行会出现「账单列表已缴、催缴台仍显示欠费」的同会话不一致。
  const unpaid = bills.filter(b => b.houseId === a.houseId && (b.unpaid || 0) > 0)
    .sort((x, y) => String(x.period).localeCompare(String(y.period)))
  if (!unpaid.length) throw new Error('该房屋没有待抵扣的未缴账单')

  let rest = amt
  const detail = []
  for (const b of unpaid) {
    if (rest <= 0.009) break
    const use = Math.min(rest, b.unpaid)
    b.paidAmount = Math.round((b.paidAmount + use) * 100) / 100
    b.unpaid = Math.round((b.unpaid - use) * 100) / 100
    b.payMethod = '预存抵扣'
    b.status = b.unpaid <= 0.009 ? '已缴' : '部分缴'   // 与 DEBT_STATUS / BILL_VF.part 同枚举
    if (b.status === '已缴') { b.payTime = _now(); b.overdueDays = 0 }
    rest = Math.round((rest - use) * 100) / 100
    _syncBillRow(b)
    detail.push({ billId: b.billId, period: b.period, itemName: b.itemName, amount: use })
  }
  const used = Math.round((amt - rest) * 100) / 100
  // 预存抵扣是一种缴费方式：与 seed 里 129 条 channel='预存抵扣' 的流水同口径，
  // 补一条 payment，保证「应收 = 实收 + 欠费」在缴费流水页也自洽
  if (used > 0) {
    PAY_SEQ += 1
    const pay = {
      payId: 'PM-PD' + String(PAY_SEQ).padStart(6, '0'),
      billId: detail[0].billId, houseId: a.houseId, ownerId: a.ownerId,
      amount: used, method: '预存抵扣', payTime: _now(),
      transNo: 'PD' + Date.now().toString().slice(-10),
      operator: '当前登录人', invoiceStatus: '未开票', invoiceNo: '',
      channel: '预存抵扣', _isNew: true
    }
    payments.unshift(pay)
    _syncPayRow(pay, { insert: true })
  }
  a.balance = Math.round((a.balance - used) * 100) / 100
  a.totalDeduct = Math.round((a.totalDeduct + used) * 100) / 100
  a.lastDeductDate = _now().slice(0, 10)
  PL_SEQ += 1
  PREPAY_LOGS.unshift({
    logId: 'PL' + String(PL_SEQ).padStart(6, '0'), accountId, type: '抵扣',
    amount: -used, balance: a.balance, method: '余额抵扣', time: _now(), operator: '当前登录人',
    remark: `冲抵 ${detail.length} 笔账单`
  })
  return { account: { ...a }, used, rest, detail }
}

export function prepayLogs(accountId) {
  return PREPAY_LOGS.filter(l => !accountId || l.accountId === accountId)
}

/** 切换自动抵扣 */
export function toggleAutoDeduct(accountId) {
  const a = prepayAccounts.find(x => x.accountId === accountId)
  if (!a) throw new Error('预存账户不存在')
  a.autoDeduct = !a.autoDeduct
  return { ...a }
}

export const prepayAccountOf = houseId => prepayAccounts.find(a => a.houseId === houseId) || null

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
    houseIds: [...hs], parkIds: [], tags: [], creditLevel: 'B',
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
  remark: { label: '备注' }
}
export const ownerEditableFields = () => Object.entries(OWNER_EDITABLE).map(([k, v]) => ({ field: k, label: v.label }))
export function updateOwnerField(ownerId, field, value) {
  const o = owners.find(x => x.ownerId === ownerId)
  if (!o) throw new Error('业主不存在')
  const cfg = OWNER_EDITABLE[field]
  if (!cfg) throw new Error('该字段不支持内联编辑')
  const v = String(value ?? '').trim()
  if (cfg.check) { const e = cfg.check(v); if (e) throw new Error(e) }
  o[field] = v
  _syncOwnerRow(o)
  return { ...o }
}

/** 房屋：使用状态 / 产权状态 / 装修情况 / 朝向 / 备注（不动面积与权属，避免影响账单口径） */
const HOUSE_USE_STATUS = ['自住', '出租', '空置', '装修中', '限制使用']
const HOUSE_PROPERTY_STATUS = ['已办证', '办理中', '未办理', '抵押中']
export const HOUSE_USE_OPTS = HOUSE_USE_STATUS
export const HOUSE_PROPERTY_OPTS = HOUSE_PROPERTY_STATUS
const HOUSE_EDITABLE = {
  useStatus: { label: '使用状态', check: v => (HOUSE_USE_STATUS.includes(v) ? '' : '使用状态取值不合法') },
  propertyStatus: { label: '产权状态', check: v => (HOUSE_PROPERTY_STATUS.includes(v) ? '' : '产权状态取值不合法') },
  decoration: { label: '装修情况' },
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
  const derived = {
    ...c,
    communityName: c.communityId ? communityName(c.communityId) : '集团 / 全项目',
    restDays: daysBetween(c.endDate) === null ? null : -daysBetween(c.endDate)
  }
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

/** 新建合同：落库（待审批）+ 生成审批单 */
export function createContract(d = {}) {
  const seq = contracts.reduce((m, c) => Math.max(m, +String(c.contractId).replace(/\D/g, '') || 0), 0) + 1
  const c = {
    contractId: 'CT' + String(seq).padStart(4, '0'),
    contractNo: d.contractNo || nextContractNo(new Date().getFullYear()),
    name: d.name, type: d.type, subtype: d.subtype,
    communityId: d.communityId || '', orgId: d.orgId || '',
    partyB: d.partyB, contact: d.contact || '', phone: d.phone || '',
    amount: Number(d.amount) || 0, payCycle: d.payCycle || '月付',
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
 * Q8 口径（2026-10-23 确认）：五档真正生效，不再只做展示。
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
  if (role.dataScope === '指定项目') return { ...base, communityIds: new Set(role.communities || []) }
  if (role.dataScope === '本项目') return { ...base, communityIds: new Set(myCommunity ? [myCommunity] : []) }
  if (role.dataScope === '本部门') return { ...base, communityIds: new Set(deptCommunities) }
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
  if (s.mode === '本部门') return `本部门：${s.orgName} 覆盖 ${names}`
  return `指定项目：${names}`
}

/**
 * 通用行过滤。
 * communities: 返回行所属项目（字符串）或项目集合（Set）
 * emp: 「仅本人」时用于取行的经手人（姓名），不传则退回按项目收窄
 */
export function scopeFilter(list, { communities: getComm = r => r.communityId, emp = null } = {}) {
  const s = currentScope()
  if (s.mode === '全部项目') return list
  if (s.mode === '仅本人' && emp) return list.filter(r => emp(r) === s.anchorName)
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
    from: before.roleName, permCount: r.perms.length, dataScope: r.dataScope
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
