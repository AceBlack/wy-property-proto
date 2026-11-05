/**
 * 楼栋管家工作台（移动端）
 *
 * 数据范围就是「责任范围」这一档：buildingStewards 里 empId === 我 的楼栋，
 * 往下推导出房屋与账单 —— 与 PC 端「楼栋责任范围」同源，不另建一套关系。
 *
 * 边界（已确认）：管家能看欠费、能催、能记跟进，**不能收款、不能改账单**
 * （PC 侧 b.bills.edit 只给收银/财务，管家只有 b.bills.view）。
 */
import { bills, buildingStewards, buildings, collectionRecords, houses, members, ownerTags, owners, tenants } from '@pc/mock'
import {
  HOUSE_PROPERTY_OPTS,
  HOUSE_USE_OPTS,
  addOwnerTag,
  computeTenantFill,
  getTenantDetail,
  moveOutTenant,
  ownerEditableFields,
  ownerTagRows,
  registerTenantFace,
  removeOwnerTag,
  supplementTenant,
  updateHouseField,
  updateOwnerField,
  verifyTenant
} from '@pc/utils/api'

const HOUSE_OF = new Map(houses.map(h => [h.houseId, h]))
const OWNER_OF = new Map(owners.map(o => [o.ownerId, o]))
const BUILDING_OF = new Map(buildings.map(b => [b.buildingId, b]))

const DEBT = ['未缴', '部分缴', '逾期']
const EFFECTIVE = s => s !== '已作废' && s !== '已减免'

export function scopeRows(empId) {
  return buildingStewards.filter(b => b.empId === empId)
}

export const scopeRowsCount = empId => scopeRows(empId).length

export function scopeSummary(empId) {
  const rows = scopeRows(empId)
  const ids = new Set(rows.map(r => r.buildingId))
  const myHouses = houses.filter(h => ids.has(h.buildingId))
  const myBills = bills.filter(b => myHouses.some(h => h.houseId === b.houseId))
  const valid = myBills.filter(b => EFFECTIVE(b.status))
  const payable = valid.reduce((s, b) => s + (b.payable || 0), 0)
  const paid = valid.reduce((s, b) => s + (b.paidAmount || 0), 0)
  const debtList = valid.filter(b => DEBT.includes(b.status) && (b.unpaid || 0) > 0)
  const debtHouse = new Set(debtList.map(b => b.houseId))

  return {
    buildings: rows.map(r => ({
      buildingId: r.buildingId,
      name: BUILDING_OF.get(r.buildingId)?.name || r.buildingId,
      floors: BUILDING_OF.get(r.buildingId)?.floorCount || 0,
      houses: myHouses.filter(h => h.buildingId === r.buildingId).length
    })),
    houseCount: myHouses.length,
    billCount: myBills.length,
    payable,
    paid,
    rate: payable ? (paid / payable) * 100 : 0,
    debtAmount: debtList.reduce((s, b) => s + (b.unpaid || 0), 0),
    debtCount: debtList.length,
    debtHouses: debtHouse.size
  }
}

/**
 * 欠费户（按户聚合，不是按账单）：管家是按门牌去催的，
 * 一户挂了 3 个月账，只该出现一行。
 */
export function debtHouseholds(empId, { buildingId = '' } = {}) {
  const ids = new Set(scopeRows(empId).map(r => r.buildingId))
  const list = bills.filter(b => {
    const h = HOUSE_OF.get(b.houseId)
    if (!h || !ids.has(h.buildingId)) return false
    if (buildingId && h.buildingId !== buildingId) return false
    return EFFECTIVE(b.status) && DEBT.includes(b.status) && (b.unpaid || 0) > 0
  })

  const map = new Map()
  for (const b of list) {
    const h = HOUSE_OF.get(b.houseId)
    const o = OWNER_OF.get(b.ownerId)
    const cur = map.get(b.houseId) || {
      houseId: b.houseId,
      houseName: h?.fullName || b.houseId,
      room: h?.room || '',
      area: h?.area || 0,
      buildingId: h?.buildingId || '',
      ownerName: o?.name || '—',
      ownerPhone: o?.phone || '',
      ownerId: b.ownerId,
      debt: 0,
      count: 0,
      maxOverdue: 0,
      oldestPeriod: b.period,
      items: []
    }
    cur.debt += b.unpaid || 0
    cur.count += 1
    cur.maxOverdue = Math.max(cur.maxOverdue, b.overdueDays || 0)
    if (String(b.period) < String(cur.oldestPeriod)) cur.oldestPeriod = b.period
    cur.items.push({
      billId: b.billId,
      period: b.period,
      itemName: b.itemName,
      payable: b.payable,
      unpaid: b.unpaid,
      status: b.status,
      dueDate: b.dueDate,
      overdueDays: b.overdueDays || 0
    })
    map.set(b.houseId, cur)
  }
  return [...map.values()]
    .map(x => ({ ...x, items: x.items.sort((a, b) => String(a.period).localeCompare(String(b.period))) }))
    .sort((a, b) => b.debt - a.debt)
}

/** 脱敏手机号：管家默认只看后四位，点「揭示」才出明文（并留痕，与 PC 同口径） */
export const maskPhone = p => (p ? String(p).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : '—')

export const COLLECT_METHODS = ['电话', '上门', '短信', '微信']
export const COLLECT_RESULTS = ['承诺还款', '家中无人', '拒缴', '已说明情况']

export function householdDetail(empId, houseId) {
  const rows = debtHouseholds(empId)
  return rows.find(r => r.houseId === houseId) || null
}

/* ================= 业主与房屋（现场维护） =================
 * 管家是全站唯一能改业主档案的一线角色（a.owners.edit），所以这块必须给到手机上：
 * 电话换了、搬走了、房子改成出租了，站在门口就能改，不用回办公室。
 * 写操作走后端同款函数：updateOwnerField（含手机号唯一校验、版本冲突 409）与 updateHouseField。
 * 敏感字段：默认脱敏，揭示要 a.sensitive.view，且与 PC 一样算"看过一次"。
 */
export { HOUSE_PROPERTY_OPTS, HOUSE_USE_OPTS }

export const ownerFields = () => ownerEditableFields()

export function houseDetailOf(houseId) {
  const house = HOUSE_OF.get(houseId)
  if (!house) return null
  const owner = OWNER_OF.get(house.ownerId) || null
  const list = bills
    .filter(b => b.houseId === houseId)
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))
  const debt = list
    .filter(b => EFFECTIVE(b.status) && DEBT.includes(b.status) && (b.unpaid || 0) > 0)
    .reduce((s, b) => s + (b.unpaid || 0), 0)
  const building = BUILDING_OF.get(house.buildingId)
  return {
    house: {
      ...house,
      buildingName: building?.name || '',
      useStatus: house.useStatus || '',
      propertyStatus: house.propertyStatus || '',
      decoration: house.decoration || ''
    },
    owner: owner ? { ...owner } : null,
    bills: list.slice(0, 6).map(b => ({
      billId: b.billId,
      period: b.period,
      itemName: b.itemName,
      payable: b.payable,
      unpaid: b.unpaid,
      status: b.status,
      dueDate: b.dueDate,
      overdueDays: b.overdueDays || 0
    })),
    debt,
    debtCount: list.filter(b => EFFECTIVE(b.status) && DEBT.includes(b.status) && (b.unpaid || 0) > 0).length
  }
}

/** 改业主字段：手机号唯一 + 格式校验都在数据层，页面只负责把错误显示出来 */
export function saveOwnerField(ownerId, field, value) {
  return updateOwnerField(ownerId, field, value)
}

/** 改房屋字段：使用状态 / 产权状态 / 装修 / 备注（不动面积与权属，避免影响账单口径） */
export function saveHouseField(houseId, field, value) {
  return updateHouseField(houseId, field, value)
}

/* ================= 住在里面的人：租户与共住成员 =================
 * 档口上最常问的不是"业主是谁"，而是"现在住的是谁"。
 * 数据现实：160 个租户分散在 160 户（一户一租），169 个家庭成员挂在业主身上；
 * 租户里 57 户「信息不全」、55 户「待核验」—— 补这块正是管家的高频动作。
 *
 * 隐私边界（已确认）：
 *   - 租户**不给租金**（tenants.rent 是合同价，属于财务/项目经理的事）
 *   - 身份证一律不返回，人脸/认证只给"有没有"的布尔值
 */
export function residentsOf(houseId) {
  const house = HOUSE_OF.get(houseId)
  const active = tenants.filter(t => t.houseId === houseId && t.status === '在住')
  const list = members.filter(m => m.ownerId === (house?.ownerId || active[0]?.ownerId))
  return {
    tenants: active.map(t => ({
      tenantId: t.tenantId,
      name: t.name,
      phone: t.phone,
      relation: t.relation,
      tenantType: t.tenantType || '个人',
      leaseStart: t.leaseStart,
      leaseEnd: t.leaseEnd,
      residents: t.residents,
      verifyStatus: t.verifyStatus,
      certified: !!t.certified,
      faceRegistered: !!t.faceRegistered,
      source: t.source,
      /* 完整度用 PC 的同一个函数算，页面不自己数 —— 否则「列表 62%、详情 75%」没法解释 */
      fill: computeTenantFill(t)
    })),
    members: list.map(m => ({
      name: m.name,
      relation: m.relation,
      phone: m.phone,
      certified: !!m.certified,
      faceRegistered: !!m.faceRegistered,
      appUser: !!m.isOwnerAppUser,
      remark: m.remark || ''
    }))
  }
}

/* ================= 批量催缴（照 PC 催缴工作台的口径） =================
 * PC 的做法：按**房屋**聚合（不按账单逐条催）→ 账龄分档 → 勾选 → 生成催缴单（批次）→ 按批次追溯。
 * 移动端照抄这一套，另外加两条现场才需要的规则：
 *   1. 同一户 7 天内催过，默认不打勾（否则一天三条短信，业主会投诉）
 *   2. 只发提醒、不收款（收银在收银台/小程序）
 */
export const AGING_OPTS = [
  { key: '', label: '全部' },
  { key: '30', label: '逾期≥30 天' },
  { key: '60', label: '逾期≥60 天' }
]

export const ITEM_OPTS = ['物业服务费', '水费', '电费']

const toDate = s => (s ? new Date(String(s).replace(/-/g, '/')) : null)

/** 这户最近一次催缴：先看 PC 的催缴历史（186 条），再看本机新增的记录 */
export function lastCollectOf(houseId, localRecords = []) {
  const pc = collectionRecords
    .filter(r => r.houseId === houseId)
    .map(r => ({ at: r.collectTime, method: r.method, status: r.status, operator: r.operator, round: r.round }))
  const local = localRecords
    .filter(r => r.houseId === houseId)
    .map(r => ({ at: r.at, method: r.method, status: r.result, operator: r.by, round: r.round || 0 }))
  const all = [...pc, ...local].sort((a, b) => String(b.at).localeCompare(String(a.at)))
  return all[0] || null
}

/** 7 天内催过？以演示时钟为基准，不用系统当天（mock 日期都在 10 月） */
export function daysSince(atText, nowText = '2026-10-20 10:00') {
  const a = toDate(atText)
  const n = toDate(nowText)
  if (!a || !n) return 999
  return Math.floor((n - a) / 86400000)
}

/**
 * 批量催缴的工作集：在「欠费户」基础上加账龄 / 费项 / 楼栋筛选，
 * 并标出 canPick（7 天内催过的不默认选）。
 */
export function collectWorkSet(empId, { aging = '', item = '', buildingId = '', skipRecent = true, localRecords = [], nowText } = {}) {
  const rows = debtHouseholds(empId, { buildingId })
  return rows
    .map(r => {
      const last = lastCollectOf(r.houseId, localRecords)
      const gap = last ? daysSince(last.at, nowText) : 999
      const items = item ? r.items.filter(x => x.itemName === item) : r.items
      const debt = items.reduce((s, x) => s + (x.unpaid || 0), 0)
      const maxOverdue = items.reduce((s, x) => Math.max(s, x.overdueDays || 0), 0)
      return {
        ...r,
        items,
        debt,
        count: items.length,
        maxOverdue,
        lastAt: last?.at || '',
        lastMethod: last?.method || '',
        gapDays: gap,
        recent: gap < 7,
        canPick: debt > 0 && (!skipRecent || gap >= 7),
        picked: false
      }
    })
    .filter(r => r.debt > 0)
    .filter(r => !aging || r.maxOverdue >= Number(aging))
    .sort((a, b) => b.debt - a.debt)
}

/** 生成催缴批次：一条记录对一户（不按账单拆），带 batchNo 便于按批次追溯 */
export function makeBatchNo(existing = [], today = '2026-10-20') {
  const stampText = `CJ${today.replace(/-/g, '')}`
  const used = existing.filter(b => String(b.batchNo || '').startsWith(stampText)).length
  return `${stampText}-${String(used + 1).padStart(2, '0')}`
}

/* ================= 业主标签（后台 2026-11-03 新增，员工端 11-04 补） =================
 * 口径（三方一致）：
 *   · 读字典：`ownerTagRows()`，需要 `a.owners.view`；楼管有
 *   · 打/去标签：`addOwnerTag` / `removeOwnerTag`，要 `a.owners.edit`；楼管有，且受责任范围约束
 *   · 维护字典（新建/停用标签）：`e.ownerTags.edit` —— **楼管没有**，所以移动端只选不建
 *
 * 标签不是装饰：独居老人 51 位、重点关怀 57 位，是管家的走访清单；投诉频繁 19 位，
 * 决定上门时先说什么话。这些数据原本只在 PC 的业主 360 里能看到。
 */
export const tagCategories = () => [...new Set(ownerTags.map(t => t.category))]

/** 可选标签：默认只给启用中的（停用的不能再打，已打过的不受影响） */
export function tagDict({ includeDisabled = false } = {}) {
  const rows = ownerTagRows({ enabled: includeDisabled ? null : true })
  return rows.map(t => ({
    tagId: t.tagId,
    name: t.name,
    category: t.category,
    color: t.color,
    desc: t.desc,
    enabled: t.enabled,
    ownerCount: t.ownerCount
  }))
}

/** 某业主身上的标签（含已停用的：显示但标灰，不能悄悄消失） */
export function tagsOfOwner(ownerId) {
  const o = owners.find(x => x.ownerId === ownerId)
  const ids = o?.tagIds || []
  return ids
    .map(id => ownerTags.find(t => t.tagId === id))
    .filter(Boolean)
    .map(t => ({ tagId: t.tagId, name: t.name, category: t.category, color: t.color, enabled: t.enabled }))
}

export const addTag = (ownerId, tagId) => addOwnerTag(ownerId, tagId)
export const dropTag = (ownerId, tagId) => removeOwnerTag(ownerId, tagId)

/* ================= 租户管理（后台 2026-11-02 新增；员工端 11-04 从「只看」升到「能管」） =================
 * 楼管本来就有 `a.tenants.edit`，但移动端之前只把租户当只读信息展示，
 * 现场真正要做的是：核实「这套房住的是谁」→ 补资料 → 核验 → 录人脸 → 退租搬离。
 *
 * 三条边界（与 PC 一致，不在移动端另立规矩）：
 *   · 核验门槛是 **5 项基础信息**（姓名/手机/证件/与业主关系/居住人数），实名与人脸是结果不是门槛；
 *   · 录人脸必须在「已核验 + 已实名」之后；
 *   · 搬离要释放房屋的在住关系，否则那套房永远显示有人住。
 */
export const tenantDetailOf = tenantId => getTenantDetail(tenantId)

export const tenantFillOf = row => computeTenantFill(row)

/** 可补录的字段：现场能核实的几项（证件号、公司信息不在手机上改，避免录错） */
export const TENANT_PATCH_FIELDS = [
  { key: 'relation', label: '与业主关系', type: 'select' },
  { key: 'residents', label: '居住人数', type: 'number' },
  { key: 'emergencyContact', label: '紧急联系人', type: 'text' },
  { key: 'secondPhone', label: '第二联系电话', type: 'text' },
  { key: 'remark', label: '备注', type: 'text' }
]

export function saveTenantFields(persona, tenantId, patch) {
  return supplementTenant(tenantId, patch, persona?.name || '楼栋管家')
}

export function verifyTenantBy(persona, tenantId, { pass = true, note = '' } = {}) {
  return verifyTenant(tenantId, { verifier: persona?.name || '楼栋管家', pass, note })
}

export function registerFaceBy(persona, tenantId) {
  return registerTenantFace(tenantId, { operator: persona?.name || '楼栋管家' })
}

export function moveOutBy(persona, tenantId, { date = '', reason = '' } = {}) {
  return moveOutTenant(tenantId, { date, reason, operator: persona?.name || '楼栋管家' })
}
