// 原型数据服务层：页面只读这里，禁止在页面里直接 filter/reduce 原始数据
// 目的：口径统一（欠费、收缴率、逾期口径只有一个定义），后续换接口只改本文件

import {
  alarms, approvals, attendance, bills, buildingStewards, buildings, collectionRecords, communities, contracts,
  decorationDeposits, devices, employees, feeItems, houses, inspectPlans, inspectTasks,
  inspectTemplates, invoices, maintenanceRecords, members, meterReadings, meters, metrics,
  notices, operationLogs, orgs, owners, parkings, passRecords, payments, permissions,
  prepayAccounts, qualityChecks, roles, tenants, units, vehicles, workOrders
} from '@/mock'
import { daysBetween, maskId, maskPhone } from '@/utils/format'
import { currentRoleId, currentRoleName } from '@/utils/auth'
import { permCodesOfRole, setRolePerms } from '@/utils/rbac'
import { idCardValid } from '@/utils/rules'
import { DICT_MAP, dictMapRaw } from '@/utils/dict'
import { ENUM } from '@/utils/enums'
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
      (!vf || vf(o)) &&
      kwHit(o, filters.kw, ['name', 'phone', 'ownerId'], o.houseNames.join(' '))
    )
    const page = paged(list, pageNo, size)
    /* 列表只回掩码：明文必须逐条揭示（会写访问日志），导出走 prepareExport 的脱敏分支 */
    return { ...page, rows: redactList(page.rows) }
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
    /* 员工手机 / 证件同属敏感：列表只回掩码，明文走揭示接口 */
    return { ...page, rows: redactList(page.rows, ['phone', 'idCard']) }
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
    /* 2026-10-30 口径更正：原按自然小时算超时（种子里 isOverdue 就是这么来的），
       现统一走 SLA 工作日历 —— 周五 17:00 的单 24h 到期是周一 17:00，不是周六。
       KPI 与列表「SLA 剩余」列必须同源，否则同一页两个数。 */
    overdue: WO_ROWS.filter(w => {
      /* 只统计「还在办且已超时」的单：已结单的迟到单不占这个数，否则 KPI 与列表列里显示的「已结单」打架 */
      if (SLA_DONE_STATUS.includes(w.status) || SLA_EXCLUDE_STATUS.includes(w.status)) return false
      const s = woSlaState(w)
      return !!s && s.breached
    }).length,
    pending: WO_ROWS.filter(w => w.status === '待派单').length
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

/* ---------------- 29 · 租户管理（P4：业主维护 + 物业核验补充） ----------------
 * 业务口径（2026-10-29 确认）：
 *   ① 租户由业主出租产生，租户信息（含新增）主要由业主在小程序维护；
 *      物业可代为补充或修正，且保存即生效，不需要业主二次确认。
 *   ② 物业不是出租方：不签租约、不掌握租金 → 后台不展示、不统计租金（rent 字段保留，仅供业主端）。
 *   ③ 物业侧的价值是「这套房现在住着谁」：核验、补全、失效（搬离），服务门禁人脸 / 通知触达 / 上门服务。
 *   ④ 补充动作要能在「租户到场代缴物业费」的收银台流程里完成 —— 见 tenantsOfOwner()。
 * 字段口径：source（业主自助 / 物业补录）、verifyStatus（待核验 / 已核验 / 信息不全）、status（在住 / 已搬离）。
 */

/** 物业视角的信息完整度：门禁与触达要用到的 8 项（租金不参与） */
const TENANT_REQUIRED = [
  ['name', '姓名'], ['phone', '手机号'], ['idCard', '证件号'],
  ['certified', '实名认证'], ['faceRegistered', '人脸录入'],
  ['relation', '与业主关系'], ['residents', '居住人数'], ['emergencyContact', '紧急联系人']
]
/** 物业可补充 / 修正的字段（其余为业主维护，后台只读） */
export const TENANT_EDITABLE = [
  'name', 'phone', 'idCard', 'secondPhone', 'relation', 'residents',
  'emergencyContact', 'vehicles', 'pets', 'specialCare', 'remark'
]
export const TENANT_FIELD_LABEL = {
  name: '姓名', phone: '手机号', idCard: '证件号', secondPhone: '第二联系电话',
  relation: '与业主关系', residents: '居住人数', emergencyContact: '紧急联系人',
  vehicles: '车辆信息', pets: '养宠', specialCare: '特殊人群', remark: '备注'
}
/** 业主维护、物业只读的字段（涉及产权与合同，改动需业主在移动端操作） */
export const TENANT_OWNER_FIELDS = [
  { key: 'houseName', label: '承租房屋' },
  { key: 'leaseStart', label: '起租日' },
  { key: 'leaseEnd', label: '到期日' },
  { key: 'ownerName', label: '产权业主' }
]

export const TENANT_VERIFY_STATUS = ['待核验', '已核验', '信息不全']
export const TENANT_RELATIONS = ['承租人', '业主亲属', '业主朋友', '企业宿舍', '其他']
export const TENANT_SPECIAL_CARE = ['老人', '儿童', '残障', '孕产']

/**
 * 核验门槛（5 项）：物业能补、且确实影响"这套房住的是谁"的字段。
 * 实名 / 人脸属核验结果，不在此列；**紧急联系人降级为完整度项**——
 * 它不是身份核验的必要条件，卡在门槛里会让批量核验几乎全失败（实测 4/4 都被它挡住）。
 */
const TENANT_BASIC = TENANT_REQUIRED.filter(([k]) => !['certified', 'faceRegistered', 'emergencyContact'].includes(k))

const _tenantFill = t => {
  const miss = keys => keys.filter(([k]) => {
    const v = t[k]
    return (k === 'certified' || k === 'faceRegistered') ? !v : !String(v ?? '').trim()
  }).map(([, label]) => label)
  const missing = miss(TENANT_REQUIRED)
  const missingBasic = miss(TENANT_BASIC)
  const total = TENANT_REQUIRED.length
  return {
    total,
    filled: total - missing.length,
    missing,
    /* 核验门槛：只看 6 项基础信息 */
    basicTotal: TENANT_BASIC.length,
    basicFilled: TENANT_BASIC.length - missingBasic.length,
    missingBasic,
    rate: Math.round((total - missing.length) / total * 1000) / 10
  }
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
export function supplementTenant(tenantId, patch = {}, operator = '物业前台') {
  const raw = tenants.find(x => x.tenantId === tenantId)
  if (!raw) throw new Error('租户不存在')
  if ((raw.status || '在住') !== '在住') throw new Error('已搬离的租户记录不可修改')
  const keys = TENANT_EDITABLE.filter(k => k in patch)
  if (!keys.length) throw new Error('没有可保存的字段')
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

/** 业主自助登记（原型取数用）：保存为「业主自助 + 待核验」，物业随后核验 */
export function registerTenantByOwner(p = {}, operator = '业主小程序') {
  const house = HOUSE_ROWS.find(h => h.houseId === p.houseId)
  if (!house) throw new Error('请选择承租房屋')
  if (liveTenantOfHouse(p.houseId)) throw new Error('该房屋已有在住租户，请先标记原租户搬离')
  /* 唯一：同证件号只允许一条在住记录（换房应先搬离）；手机号允许家属共用，故不做唯一 */
  if (p.idCard) assertUnique(TENANT_ROWS.filter(t => t.live), 'idCard', p.idCard, { label: '证件号' })
  const id = nextId(tenants, 'TN', 'tenantId')
  const t = {
    tenantId: id, name: p.name, phone: p.phone, idCard: p.idCard || '',
    houseId: p.houseId, ownerId: house.ownerId,
    leaseStart: p.leaseStart || '', leaseEnd: p.leaseEnd || '',
    /* 租金仅业主端可见，后台不展示；此处保留字段以维持数据结构 */
    rent: Number(p.rent) || 0,
    certified: !!p.certified, faceRegistered: !!p.faceRegistered,
    source: p.source || '业主自助',
    verifyStatus: '待核验',
    relation: p.relation || '承租人',
    residents: Number(p.residents) || 1,
    status: '在住',
    updatedBy: operator, updatedAt: _now()
  }
  tenants.unshift(t)
  house.tenantId = id
  _pushTenantHistory(id, {
    action: p.source === '物业补录' ? '物业代业主登记' : '业主登记',
    by: operator, at: _now(),
    memo: `承租 ${house.fullName} · 租期 ${t.leaseStart} ~ ${t.leaseEnd}`, done: true
  })
  return _syncTenantRow(id)
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
export function createOrg({ name = '', type = '', parentId = '', leader = '', sort } = {}) {
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

const EMP_EDITABLE_FIELDS = [
  'position', 'level', 'empType', 'status', 'contractStart', 'contractEnd',
  'phone', 'idCard', 'socialSecurity', 'regularDate', 'score', 'certificates', 'manager'
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
  idCard: '证件号', bankAccount: '银行账号'
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
  _RF_SEQ += 1
  const row = {
    refundId: 'RF' + String(_RF_SEQ).padStart(5, '0'),
    refundNo: `TK-${day}-${String(_RF_SEQ).padStart(3, '0')}`,
    payId: p.payId, billId: p.billId, houseId: p.houseId, ownerId: p.ownerId,
    ownerName: ownerName(p.ownerId), houseName: houseName(p.houseId),
    communityId: (houses.find(h => h.houseId === p.houseId) || {}).communityId || '',
    method: p.method, channel: p.channel,
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
  const pays = PAY_ROWS.filter(p => _dayOf(p.payTime) === day)
  const refs = REFUND_ROWS.filter(r => _dayOf(r.at) === day)
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
