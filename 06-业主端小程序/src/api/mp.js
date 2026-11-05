/**
 * 业主端数据层（mp）· 身份 / 房产 / 账单 / 报修 / 支付
 * ------------------------------------------------------------
 * 原则：
 *   1. 不重写业务规则：建单走 PC 的 `createWorkOrder`（source=小程序），价目走 repairPrices 一份；
 *   2. 身份分三层（见 store/app.js 顶部），账单与工单都按**已绑房产**取，不按 ownerId 一把捞；
 *   3. 家庭账单是**多房合并**（2026-11-01 确认）：合并的是付款动作，不是账单本身 ——
 *      一张 payOrder 可以覆盖多张账单，但 lines 里逐条带 houseId，后台入账仍按房拆分。
 */
import { buildings, bills, communities, employees, houses, members, owners, tenants, units, workOrders } from '@pc/mock'
import { createWorkOrder } from '@pc/utils/api'
import { addonsOf, app, applyPatch, markBillPaid, persist, writeAddons } from '@/store/app'
import { DEMO, stamp } from '@/config/demo'
import { addonFee, orderFee, priceOfCode, round2 } from '@/api/pricing'
import { matchIdentity, ROLE } from './identity-rule.mjs'

const COMMUNITY_OF = new Map(communities.map(c => [c.communityId, c]))
const BUILDING_OF = new Map(buildings.map(b => [b.buildingId, b]))
const UNIT_OF = new Map(units.map(u => [u.unitId, u]))
const EMP_OF = new Map(employees.map(e => [e.empId, e]))
const HOUSE_OF = new Map(houses.map(h => [h.houseId, h]))
const OWNER_OF = new Map(owners.map(o => [o.ownerId, o]))

/* ============================ 一、选社区 / 楼栋 / 房间 ============================ */

export const communityList = () =>
  communities.map(c => ({ ...c, houseCount: houses.filter(h => h.communityId === c.communityId).length }))

export const buildingList = communityId =>
  buildings
    .filter(b => b.communityId === communityId)
    .map(b => ({
      ...b,
      unitList: units.filter(u => u.buildingId === b.buildingId),
      houseCount: houses.filter(h => h.buildingId === b.buildingId).length
    }))

/** 楼栋下的房号，按单元分组（业主选房时按"1单元 101/102"这样看） */
export function roomList(buildingId) {
  const list = houses.filter(h => h.buildingId === buildingId)
  const map = new Map()
  for (const h of list) {
    const key = h.unitId || 'X'
    if (!map.has(key)) map.set(key, { unitId: key, unitName: UNIT_OF.get(key)?.name || '未分单元', rooms: [] })
    map.get(key).rooms.push({
      houseId: h.houseId,
      room: h.room,
      floor: h.floor,
      fullName: h.fullName,
      area: h.area,
      houseType: h.houseType,
      useStatus: h.useStatus
    })
  }
  return [...map.values()].map(g => ({
    ...g,
    rooms: g.rooms.sort((a, b) => a.floor - b.floor || String(a.room).localeCompare(String(b.room)))
  }))
}

export function houseView(house) {
  if (!house) return null
  const community = COMMUNITY_OF.get(house.communityId)
  const building = BUILDING_OF.get(house.buildingId)
  const unit = UNIT_OF.get(house.unitId)
  const tenant = house.tenantId ? tenants.find(t => t.tenantId === house.tenantId) : null
  return {
    ...house,
    communityName: community?.name || house.communityId,
    buildingName: building?.name || '',
    unitName: unit?.name || '',
    address: house.fullName,
    tenant,
    steward: stewardOf(house)
  }
}

export const houseOf = houseId => houseView(HOUSE_OF.get(houseId))

/** 管家：无命中时告诉业主"找谁核验"（house.stewardEmpId → 员工名册） */
export function stewardOf(house) {
  const emp = EMP_OF.get(house?.stewardEmpId)
  if (!emp) return null
  return { empId: emp.empId, name: emp.name, position: emp.position, phone: emp.phone, orgId: emp.orgId }
}

/* ============================ 二、身份匹配（自动优先，人工兜底） ============================ */

export function matchFor({ phone, name, idCard4, houseId }) {
  const r = matchIdentity({ phone, name, idCard4 }, { owners, members, tenants }, houseId)
  const house = houseView(HOUSE_OF.get(houseId))
  /* 管家：有房按房取；没房但人是真的，就用其名下一套房的管家（业主最想知道"该找谁"） */
  let steward = house ? stewardOf(house) : null
  if (!steward) {
    const owner = OWNER_OF.get(r.ownerId)
    const h = (owner?.houseIds || []).map(id => HOUSE_OF.get(id)).filter(Boolean)[0]
    if (h) steward = stewardOf(h)
  }
  return { ...r, house, steward }
}

export function authSummary() {
  const a = app.auth
  return {
    status: a.status,
    identity: a.identity,
    reason: a.reason,
    applicant: a.applicant,
    house: a.applicant ? houseView(HOUSE_OF.get(a.applicant.houseId)) : null,
    at: a.at
  }
}

/* ============================ 三、我的房产 ============================ */

export const boundHouseIds = () => app.bindings.map(b => b.houseId)

export const myHouses = () =>
  app.bindings.map(b => {
    const h = houseView(HOUSE_OF.get(b.houseId))
    return h ? { ...h, identity: b.identity, verifyStatus: b.verifyStatus } : null
  }).filter(Boolean)

export function activeHouse() {
  const b = app.bindings.find(x => x.houseId === app.activeHouseId) || app.bindings[0]
  if (!b) return null
  const h = houseView(HOUSE_OF.get(b.houseId))
  return h ? { ...h, identity: b.identity, verifyStatus: b.verifyStatus } : null
}

/**
 * 我名下还有哪些房没绑。
 * 认证是"逐套绑"（设计稿也是一套一套确认），所以多房业主绑完一套后，
 * 首页要给一个"还有 N 套可绑定"的入口，否则他永远看不到另一套的账。
 */
export function unboundHouses() {
  const ownerIds = new Set(app.bindings.map(b => b.ownerId).filter(Boolean))
  if (!ownerIds.size) return []
  const bound = new Set(boundHouseIds())
  const list = []
  for (const id of ownerIds) {
    const o = OWNER_OF.get(id)
    for (const hid of o?.houseIds || []) {
      if (!bound.has(hid)) {
        const h = houseView(HOUSE_OF.get(hid))
        if (h) list.push(h)
      }
    }
  }
  return list
}

/** 这套房的住户（业主 + 家庭成员 + 租客） */
export function residentsOf(houseId) {
  const house = HOUSE_OF.get(houseId)
  if (!house) return { owner: null, members: [], tenants: [] }
  const owner = OWNER_OF.get(house.ownerId)
  const seedMembers = members
    .filter(m => m.ownerId === house.ownerId)
    .map(m => ({ memberId: m.memberId, name: m.name, relation: m.relation, phone: m.phone, certified: m.certified }))
  /* 业主自助新增的成员（本地写回，状态待核验）与已解除的成员都要合并进来 */
  const added = app.membersAdded
    .filter(m => m.houseId === houseId)
    .map(m => ({ ...m, certified: false, pending: true }))
  return {
    owner: owner ? { name: owner.name, phone: owner.phone, relation: '业主' } : null,
    members: [...added, ...seedMembers].filter(m => !app.membersRemoved.includes(m.memberId)),
    tenants: tenants
      .filter(t => t.houseId === houseId)
      .map(t => ({
        tenantId: t.tenantId,
        name: t.name,
        phone: t.phone,
        leaseStart: t.leaseStart,
        leaseEnd: t.leaseEnd,
        rent: t.rent,
        verifyStatus: t.verifyStatus,
        residents: t.residents
      }))
  }
}

/* ============================ 四、账单（多房合并） ============================ */

const DEBT_STATUS = ['未缴', '部分缴', '逾期']
export const isDebt = b => DEBT_STATUS.includes(b.status) && (b.unpaid || 0) > 0

const myHouseIdSet = () => new Set(boundHouseIds())
const myOwnerIds = () => [...new Set(app.bindings.map(b => b.ownerId).filter(Boolean))]

/**
 * 家庭账单 = 已绑房产的账单 + 本人（业主本人 / 家属所属业主）名下不挂房的车位费。
 * 车位费那条不是可选项：`bills` 里有 1,344 张 houseId 为空的账单（车位是独立资产），
 * 只按房过滤会漏钱（李秀兰会少看 ¥362.52），业主会以为只欠这些。
 */
export function myBills({ houseId = '', onlyDebt = false } = {}) {
  const set = myHouseIdSet()
  const ownerSet = new Set(myOwnerIds())
  return bills
    .filter(b => (b.houseId ? set.has(b.houseId) : ownerSet.has(b.ownerId)))
    .filter(b => !houseId || b.houseId === houseId)
    .filter(b => !onlyDebt || isDebt(b))
    .map(b => ({
      ...b,
      houseName: b.houseId ? HOUSE_OF.get(b.houseId)?.fullName || '' : '车位',
      isPark: !b.houseId,
      overdue: isDebt(b) && (b.overdueDays || 0) > 0
    }))
    .sort((a, b) => {
      const d = (isDebt(b) ? 1 : 0) - (isDebt(a) ? 1 : 0)
      if (d) return d
      if (a.period !== b.period) return a.period < b.period ? 1 : -1
      return String(a.itemName).localeCompare(String(b.itemName))
    })
}

export const debtOf = list => round2(list.filter(isDebt).reduce((s, b) => s + (b.unpaid || 0), 0))

export function debtSummary() {
  const list = myBills()
  const debt = list.filter(isDebt)
  return {
    unpaid: debtOf(list),
    count: debt.length,
    maxOverdueDays: debt.reduce((m, b) => Math.max(m, b.overdueDays || 0), 0),
    periods: [...new Set(debt.map(b => b.period))].sort()
  }
}

export function billsByPeriod(list) {
  const map = new Map()
  for (const b of list) {
    if (!map.has(b.period)) map.set(b.period, [])
    map.get(b.period).push(b)
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([period, items]) => ({
      period,
      items,
      payable: round2(items.reduce((s, b) => s + (b.payable ?? b.amount ?? 0), 0)),
      unpaid: round2(items.reduce((s, b) => s + (b.unpaid || 0), 0)),
      debt: items.some(isDebt)
    }))
}

/** 按房分组（多房合并的第二层：先看合计，再按房拆开） */
export function billsByHouse(list) {
  const map = new Map()
  for (const b of list) {
    const key = b.houseId || '__park__'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(b)
  }
  return [...map.entries()]
    .map(([key, items]) => ({
      houseId: key === '__park__' ? '' : key,
      houseName: key === '__park__' ? '车位（不挂房）' : items[0].houseName,
      items,
      payable: round2(items.reduce((s, b) => s + (b.payable ?? 0), 0)),
      unpaid: round2(items.reduce((s, b) => s + (b.unpaid || 0), 0)),
      debt: items.some(isDebt)
    }))
    /* 房在前、车位在后：车位是附属资产，不该抢在"我的房子"前面 */
    .sort((a, b) => {
      if (!a.houseId !== !b.houseId) return a.houseId ? -1 : 1
      return String(a.houseName).localeCompare(String(b.houseName))
    })
}

/** 年度账单（历史账单：按年折叠） */
export function billsByYear(list) {
  const map = new Map()
  for (const b of list) {
    const y = String(b.period).slice(0, 4)
    if (!map.has(y)) map.set(y, { year: y, payable: 0, paid: 0, count: 0, debt: 0 })
    const g = map.get(y)
    g.payable = round2(g.payable + (b.payable ?? 0))
    g.paid = round2(g.paid + (b.paidAmount || 0))
    g.count += 1
    g.debt = round2(g.debt + (b.unpaid || 0))
  }
  return [...map.values()].sort((a, b) => (a.year < b.year ? 1 : -1))
}

export const billsOf = (ids = []) => ids.map(id => bills.find(b => b.billId === id)).filter(Boolean)

/* ============================ 五、报修单 ============================ */

const DOING = ['待派单', '已派单', '处理中', '待确认']
export const isDoing = wo => DOING.includes(wo?.status)

export function decorate(wo) {
  if (!wo) return null
  const patch = app.patches[wo.woId] || {}
  const addons = addonsOf(wo.woId)
  const pay = app.payOrders.find(p => p.type === 'wo' && p.refId === wo.woId && p.status === '待支付') || null
  const base = { ...wo, ...patch, addons }
  const pending = addons.filter(a => !a.confirmed)
  const origin = round2((base.materialFee || 0) + (base.laborFee || 0))
  const total = round2(base.totalFee || 0)
  const paid = round2(base.paidAmount != null ? base.paidAmount : base.payStatus === '已支付' ? total : 0)
  const rep = app.repairs[wo.woId] || {}
  return {
    ...base,
    addons,
    pendingAddons: pending,
    pendingAddonFee: round2(pending.reduce((s, a) => s + (a.total || 0), 0)),
    addonFee: round2(addons.filter(a => a.confirmed).reduce((s, a) => s + (a.total || 0), 0)),
    originFee: origin,
    totalFee: total,
    paidAmount: paid,
    dueFee: Math.max(0, round2(total - paid)),
    willBeFee: round2(origin + (base.addonFee || 0) + pending.reduce((s, a) => s + (a.total || 0), 0)),
    payOrder: pay,
    house: houseView(HOUSE_OF.get(wo.houseId)),
    priceItem: priceOfCode(wo.priceCode),
    urgedAt: rep.urgedAt || '',
    urgeCount: rep.urgeCount || 0,
    cancelledAt: rep.cancelledAt || ''
  }
}

export const orderOf = woId => decorate(workOrders.find(w => w.woId === woId) || null)

/** 我的报修：个人单按已绑房产取；公共单按项目取（跟产权无关，登录即可见） */
export function myOrders({ houseId = '', onlyDoing = false, scope = 'personal', communityId = '' } = {}) {
  const set = myHouseIdSet()
  const cmIds = new Set(app.bindings.map(b => HOUSE_OF.get(b.houseId)?.communityId).filter(Boolean))
  return workOrders
    .filter(w => (scope === 'public' ? !!w.isPublic && (!communityId || w.communityId === communityId) : set.has(w.houseId)))
    .filter(w => !houseId || w.houseId === houseId)
    .filter(w => !onlyDoing || isDoing(w))
    .map(decorate)
    .sort((a, b) => {
      const d = (isDoing(b) ? 1 : 0) - (isDoing(a) ? 1 : 0)
      if (d) return d
      return String(b.createTime).localeCompare(String(a.createTime))
    })
}

export const pendingAddonOrders = () => myOrders().filter(w => w.pendingAddons.length > 0)
export const toEvaluateOrders = () => myOrders().filter(w => w.status === '已完工' && !w.score)

/* ============================ 六、下单 ============================ */

export function createOrder(p = {}) {
  const item = priceOfCode(p.code)
  if (!item) throw new Error('维修项目不存在：' + p.code)
  const isPublic = p.scope === 'public'
  if (!isPublic && !boundHouseIds().includes(p.houseId)) throw new Error('房屋未绑定，不能下单')

  const house = isPublic ? null : HOUSE_OF.get(p.houseId)
  const owner = house ? OWNER_OF.get(house.ownerId) : null
  const qty = Math.max(1, Number(p.qty) || 1)
  const fee = orderFee(item, qty)

  const wo = createWorkOrder({
    communityId: house?.communityId || p.communityId || 'P01',
    houseId: isPublic ? '' : p.houseId,
    houseName: isPublic ? p.place || '公共区域' : house.fullName,
    ownerId: owner?.ownerId || '',
    ownerName: owner?.name || '',
    phone: owner?.phone || '',
    type: isPublic ? '公共区域维修' : '入户维修',
    category: item.category,
    source: '小程序',
    priority: '普通',
    title: isPublic ? `${p.place || '公共区域'} · ${item.name}` : `${item.category} · ${item.name}`,
    description: p.description || '',
    images: (p.photos || []).length,
    feeType: isPublic ? '免费' : '收费',
    remark: p.description || ''
  })

  const patch = {
    priceCode: item.code,
    priceName: item.name,
    priceQty: qty,
    priceUnit: item.unit,
    materialFee: isPublic ? 0 : fee.material,
    laborFee: isPublic ? 0 : fee.labor,
    totalFee: isPublic ? 0 : fee.total,
    payStatus: isPublic ? '无需支付' : '未支付',
    isPublic,
    place: isPublic ? p.place || '' : '',
    appointAt: `${p.appointDate || DEMO.today} ${(p.appointSlot || '09:00-10:00').split('-')[0]}`,
    appointSlot: p.appointSlot || '09:00-10:00',
    photos: p.photos || [],
    createTime: stamp(),
    woNo: `BX${DEMO.today.slice(0, 4)}${String(Number(wo.woId.replace(/\D/g, ''))).padStart(5, '0')}`
  }
  Object.assign(wo, patch)
  const row = workOrders.find(w => w.woId === wo.woId)
  if (row) Object.assign(row, patch)

  if (!app.orders.some(o => o.woId === wo.woId)) app.orders.unshift(wo)
  persist()
  return decorate(wo)
}

/* ============================ 七、支付（只到「模拟成功」） ============================ */

const PAY_TTL_MIN = 30

function nextPayId() {
  app.paySeq = (app.paySeq || 0) + 1
  persist()
  return `PY${DEMO.today.replace(/-/g, '')}${String(app.paySeq).padStart(4, '0')}`
}

const findPending = (type, refId) =>
  app.payOrders.find(p => p.type === type && p.refId === refId && p.status === '待支付') || null

function payExpireAt() {
  const [d, t] = DEMO.nowText.split(' ')
  const [hh, mm] = t.split(':').map(Number)
  const total = hh * 60 + mm + PAY_TTL_MIN
  return `${d} ${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function createOrderPay(woId) {
  const wo = orderOf(woId)
  if (!wo) throw new Error('工单不存在')
  if (wo.dueFee <= 0) throw new Error(wo.paidAmount > 0 ? '该单已结清' : '该单无需支付')
  if (wo.pendingAddons.length) throw new Error('有增项待确认，确认后才能一并支付')

  const exist = findPending('wo', woId)
  if (exist) {
    exist.amount = wo.dueFee
    persist()
    return exist
  }

  const pay = {
    payId: nextPayId(),
    type: 'wo',
    refId: woId,
    title: `${wo.category} · ${wo.priceName || wo.title}`,
    sub: `${wo.houseName} · 工单 ${wo.woNo}${wo.paidAmount > 0 ? ' · 增项补付' : ''}`,
    amount: wo.dueFee,
    createdAt: stamp(),
    expireAt: payExpireAt(),
    status: '待支付',
    billIds: []
  }
  app.payOrders.unshift(pay)
  persist()
  return pay
}

/**
 * 账单缴费（可跨房合并）。
 * 金额 = 所选账单 unpaid 之和；lines 逐条带 houseId —— 合并的是"付款动作"，不是账单本身，
 * 后台入账仍是一张账单一条 payment，否则按房对账 / 催缴 / 退费全部崩掉。
 */
export function createBillPay(billIds = []) {
  const ids = billIds.filter(Boolean)
  if (!ids.length) throw new Error('没有选择账单')
  const list = ids.map(id => bills.find(b => b.billId === id)).filter(Boolean)
  const bad = list.find(b => !isDebt(b))
  if (bad) throw new Error(`账单 ${bad.billId} 不欠费，不能缴费`)
  const amount = round2(list.reduce((s, b) => s + (b.unpaid || 0), 0))
  const houseNames = [...new Set(list.map(b => (b.houseId ? HOUSE_OF.get(b.houseId)?.fullName : '车位')).filter(Boolean))]
  const parkIncluded = list.some(b => !b.houseId)

  const pay = {
    payId: nextPayId(),
    type: 'bill',
    refId: ids[0],
    title:
      houseNames.length > 1
        ? `${houseNames.length} 套房合并缴费`
        : list.length > 1
          ? `${list.length} 张账单合并缴费`
          : `${list[0].itemName}（${list[0].period}）`,
    sub:
      houseNames.length > 1
        ? `${houseNames[0]} 等 ${houseNames.length} 套${parkIncluded ? '（含车位）' : ''} · 共 ${list.length} 项`
        : `${houseNames[0] || ''} · 共 ${list.length} 项`,
    amount,
    createdAt: stamp(),
    expireAt: payExpireAt(),
    status: '待支付',
    billIds: ids,
    lines: list.map(b => ({
      billId: b.billId,
      houseId: b.houseId || '',
      houseName: b.houseId ? HOUSE_OF.get(b.houseId)?.fullName || '' : '车位',
      itemName: b.itemName,
      period: b.period,
      status: b.status,
      overdueDays: b.overdueDays || 0,
      amount: round2(b.unpaid || 0)
    }))
  }
  app.payOrders.unshift(pay)
  persist()
  return pay
}

export const payOrderOf = payId => app.payOrders.find(p => p.payId === payId) || null

/**
 * 模拟支付成功。
 *
 * ⚠️ 真实接入要整段替换：服务端 JSAPI 下单 → wx.requestPayment →
 *    微信异步回调（验签 + 金额校验 + 幂等）→ 才置「已支付」。
 *    业务侧只认"已支付"这个结果，前端不判断成功。
 *    契约：POST /mp/payments/{payId}/simulate（生产环境必须 404）。
 */
export function simulatePay(payId) {
  const pay = payOrderOf(payId)
  if (!pay) throw new Error('订单不存在')
  if (pay.status === '已支付') return pay

  pay.status = '已支付'
  pay.paidAt = stamp()
  pay.payMethod = '微信支付（模拟）'

  if (pay.type === 'wo') {
    const wo = orderOf(pay.refId)
    applyPatch(pay.refId, {
      payStatus: '已支付',
      paidAmount: round2(wo?.totalFee || pay.amount),
      payTime: pay.paidAt,
      payMethod: '微信支付（模拟）'
    })
  } else if (pay.lines?.length) {
    for (const line of pay.lines) markBillPaid(line.billId, { payId, amount: line.amount, at: stamp() })
  } else {
    for (const id of pay.billIds || []) markBillPaid(id, { payId, amount: pay.amount, at: stamp() })
  }
  persist()
  return pay
}

/* ============================ 八、增项 / 评价 ============================ */

export function confirmAddons(woId) {
  const wo = orderOf(woId)
  if (!wo) throw new Error('工单不存在')
  const pending = wo.pendingAddons
  if (!pending.length) throw new Error('没有待确认的增项')

  const at = stamp()
  writeAddons(
    woId,
    wo.addons.map(a =>
      a.confirmed ? a : { ...a, confirmed: true, confirmedAt: at, confirmedBy: `${wo.house?.identity || '业主'}（小程序）` }
    )
  )

  const addonTotal = round2(pending.reduce((s, a) => s + (a.total || 0), 0))
  const origin = round2((wo.materialFee || 0) + (wo.laborFee || 0))
  const total = round2(origin + addonTotal)
  const paid = wo.paidAmount || 0
  applyPatch(woId, {
    totalFee: total,
    addonFee: addonTotal,
    addonsConfirmedAt: at,
    paidAmount: paid,
    payStatus: total > paid ? '未支付' : wo.payStatus,
    status: wo.status === '待确认' ? '已完工' : wo.status,
    finishTime: wo.finishTime || at
  })
  return orderOf(woId)
}

/**
 * 【演示态】模拟师傅现场加项。
 * 员工端把增项存在它自己的 store 里，两个工程运行时不通，业主端读不到 ——
 * 所以给一个显式入口，按约定形状写进 workOrders[].addons。真实环境由员工端写入，这个按钮要删。
 */
export function demoAddAddon(woId, code = 'AD-D01', qty = 1) {
  const wo = orderOf(woId)
  if (!wo) throw new Error('工单不存在')
  if (['已评价', '已关闭', '已取消'].includes(wo.status)) throw new Error('该单已结束，不能再加项')
  const item = priceOfCode(code)
  if (!item) throw new Error('增项价目不存在：' + code)
  const fee = addonFee(item, qty)
  const at = stamp()

  writeAddons(woId, [
    ...addonsOf(woId),
    {
      code: item.code,
      name: item.name,
      qty: Math.max(1, Number(qty) || 1),
      material: fee.material,
      labor: fee.labor,
      total: fee.total,
      at,
      by: wo.assignee || '维修师傅',
      confirmed: false,
      confirmedAt: ''
    }
  ])

  const patch = { status: '待确认' }
  if (!wo.assignee) {
    const emp = employees.find(e => e.position === '维修工' && e.orgId === `O-${wo.communityId}`) || null
    patch.assignee = emp?.name || '维修师傅'
    patch.assigneePhone = emp?.phone || ''
  }
  if (!wo.acceptTime) patch.acceptTime = at
  if (!wo.arriveTime) patch.arriveTime = at
  applyPatch(woId, patch)
  return orderOf(woId)
}

export const EVAL_TAGS = ['准时上门', '穿着规范', '讲解清楚', '收拾干净', '收费透明', '态度好']
export const EVAL_MOODS = [
  { score: 2, label: '不满意', icon: '☹' },
  { score: 3, label: '一般', icon: '·' },
  { score: 5, label: '很满意', icon: '☺' }
]
export const EVAL_RESOLVED = ['已解决', '未解决', '需关注后续进度']

export function evaluateOrder(woId, { score = 5, tags = [], text = '', resolved = '' } = {}) {
  const wo = orderOf(woId)
  if (!wo) throw new Error('工单不存在')
  if (wo.status !== '已完工') throw new Error('该单当前不可评价')
  if (!Number(score) || Number(score) < 1 || Number(score) > 5) throw new Error('评分需为 1~5 星')
  applyPatch(woId, {
    score: Number(score),
    evalTags: tags,
    evaluate: String(text || '').slice(0, 200),
    evalResolved: resolved,
    evaluateAt: stamp(),
    status: '已评价'
  })
  return orderOf(woId)
}

/* ============================ 九、文案 / 进度 / 时间线 ============================ */

export const STATUS_TONE = {
  待派单: 'var(--biz-warning)',
  已派单: 'var(--biz-primary)',
  处理中: 'var(--biz-ins-doing)',
  待确认: 'var(--biz-warning)',
  已完工: 'var(--biz-accent-dark)',
  已关闭: 'var(--biz-text-3)',
  已评价: 'var(--biz-success)',
  已取消: 'var(--biz-text-4)'
}

export const PAY_TONE = {
  已支付: 'var(--biz-accent-dark)',
  未支付: 'var(--biz-danger)',
  已挂账: 'var(--biz-warning)',
  无需支付: 'var(--biz-text-3)'
}

export const STATUS_TEXT = {
  待派单: '已提交，等待受理',
  已派单: '已受理，师傅稍后联系',
  处理中: '处理中',
  待确认: '有增项待确认',
  已完工: '已完成，待评价',
  已评价: '已完成',
  已关闭: '已关闭',
  已取消: '已撤销'
}

export const STAGES = ['待受理', '处理中', '已完成']

/** 三段式进度（列表与详情共用）：待受理 → 处理中 → 已完成 */
export function stageOf(wo) {
  if (!wo) return 0
  if (wo.status === '已取消') return -1
  if (['已完工', '已评价', '已关闭'].includes(wo.status)) return 2
  if (['处理中', '待确认', '已派单'].includes(wo.status) && (wo.acceptTime || wo.arriveTime)) return 1
  if (wo.status === '待派单') return 0
  return 1
}

export function timelineOf(wo) {
  if (!wo) return []
  const nodes = [
    { key: 'create', label: '已提交', at: wo.createTime, done: true },
    { key: 'accept', label: '已受理', at: wo.acceptTime, done: !!wo.acceptTime },
    { key: 'arrive', label: '师傅到场', at: wo.arriveTime, done: !!wo.arriveTime }
  ]
  if (wo.addons?.length) {
    const first = wo.addons[0]
    nodes.push({
      key: 'addon',
      label: '现场增项',
      at: first.at,
      done: !!first.at,
      note: `${wo.addons.length} 项 · 合计 ¥${round2(wo.addons.reduce((s, a) => s + (a.total || 0), 0)).toFixed(2)}`,
      tone: wo.pendingAddons?.length ? 'var(--biz-warning)' : ''
    })
  }
  nodes.push({
    key: 'finish',
    label: '已完工',
    at: wo.finishTime,
    done: ['已完工', '已评价', '已关闭'].includes(wo.status),
    note: wo.status === '待确认' ? '等您确认增项' : ''
  })
  nodes.push({ key: 'eval', label: '已评价', at: wo.evaluateAt, done: !!wo.score, note: wo.score ? `${wo.score} 星` : '' })
  return nodes
}

/** 公共区域报修的候选位置（园区固定设施；后续可挪到后台配置） */
export const PUBLIC_PLACES = ['1栋大堂', '2栋大堂', '单元电梯轿厢', '地下车库 B1', '地下车库 B2', '园区主干道', '儿童游乐区', '健身广场', '垃圾收集点', '中心花园']

export { ROLE }
