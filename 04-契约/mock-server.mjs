/**
 * 假服务（mock server）· 按 openapi.yaml 跑起来的那一端
 * ----------------------------------------------------------------
 * 为什么不用 Prism 之类现成工具：那些工具按 schema 随机造数据，**业务语义是假的**
 * （退款不会冲回账单、越权不会 403、批量不会部分失败）。这些恰恰是联调时最容易被掩盖的问题。
 * 这里用同一份 fixtures 实现真实语义，让前端在 `VITE_API_MODE=http` 下就能暴露真问题。
 *
 * 启动：node mock-server.mjs [port]     默认 4010
 * 账号：gm / pm / steward，密码随意（例：123456）
 *
 * 硬约束（与契约一致，改这里必须同步 openapi.yaml）：
 *   - 统一信封 { code, message, data }；错误码五位
 *   - 分页 size 1..100，越界 400
 *   - 越权 403（不是空列表）；不存在 404；版本冲突 409；业务校验 422
 *   - 业主**列表**脱敏、**详情**明文（详情需 a.sensitive.view）
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const readJson = p => JSON.parse(fs.readFileSync(path.join(__dirname, p), 'utf8'))

/* ------------------------------ 数据 ------------------------------ */
const owners = readJson('fixtures/owners.json')
const houses = readJson('fixtures/houses.json')
const bills = readJson('fixtures/bills.json')
const payments = readJson('fixtures/payments.json')
const workOrders = readJson('fixtures/work-orders.json')
const employees = readJson('fixtures/employees.json')
const tenants = readJson('fixtures/tenants.json')
const inspectTasks = readJson('fixtures/inspect-tasks.json')
const rectifyOrders = readJson('fixtures/rectify-orders.json')
const qualityChecks = readJson('fixtures/quality-checks.json')
const communities = readJson('fixtures/communities.json')
const contracts = readJson('fixtures/contracts.json')
const notices = readJson('fixtures/notices.json')
const orgs = readJson('fixtures/orgs.json')
const roles = readJson('fixtures/roles.json')
const payrolls = readJson('fixtures/payrolls.json')
const permissions = readJson('fixtures/permissions.json')
const accessLogs = readJson('fixtures/access-logs.json')
const exportLogs = readJson('fixtures/export-logs.json')

/** 数据集「当下」：整改超期、催缴逾期都按它算，不用真实时间（否则样例全部超期） */
const DATA_DATE = '2026-10-21'

const HOUSE = new Map(houses.map(h => [h.houseId, h]))
const OWNER = new Map(owners.map(o => [o.ownerId, o]))
const BILL = new Map(bills.map(b => [b.billId, b]))
const EMP = new Map(employees.map(e => [e.empId, e]))
const refunds = []

/* 乐观锁版本号（进程内） */
const ver = new Map()
const verOf = (kind, id) => ver.get(`${kind}:${id}`) || 1
const bumpVer = (kind, id) => { const v = verOf(kind, id) + 1; ver.set(`${kind}:${id}`, v); return v }

/* ------------------------------ 账号 ------------------------------ */
const FULL = ['*']
/* 楼管账号按样例里**真实存在**的责任范围推导：取名下房屋最多的那位，
   避免硬编码 empId 后样例一变就「楼管看不到任何数据」 */
const stewardCount = houses.reduce((m, h) => {
  if (h.stewardEmpId) m[h.stewardEmpId] = (m[h.stewardEmpId] || 0) + 1
  return m
}, {})
const stewardEmpId = Object.entries(stewardCount).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
const stewardsHouses = houses.filter(h => h.stewardEmpId === stewardEmpId).map(h => h.houseId)
const stewardCommunities = [...new Set(houses.filter(h => h.stewardEmpId === stewardEmpId).map(h => h.communityId))]

const USERS = {
  gm: {
    password: '123456', empId: 'EM0001', name: '韦秀兰',
    roleId: 'R-GM', roleName: '集团总经理', permissions: FULL, dataScope: '全部项目'
  },
  pm: {
    password: '123456', empId: 'EM0010', name: '杜若曦',
    roleId: 'R-PM', roleName: '项目经理', permissions: FULL, dataScope: '本项目', communities: ['P01']
  },
  steward: {
    password: '123456', empId: stewardEmpId, name: (EMP.get(stewardEmpId) || {}).name || '楼栋管家',
    roleId: 'R-STW', roleName: '楼栋管家',
    permissions: ['a.owners.view', 'a.sensitive.view', 'b.bills.view', 'f.workorders.view'],
    dataScope: '责任范围', communities: stewardCommunities, houseIds: stewardsHouses
  },
  /* 员工自助视角：数据范围「仅本人」。用来验证工资表**不会把全表下发再让前端藏**——
     这类账号最容易被漏测，因为它只在大规模上线后才会被发现「能看到别人的工资」。 */
  staff: {
    password: '123456', empId: 'EM0020', name: (EMP.get('EM0020') || {}).name || '普通员工',
    roleId: 'R-ENG', roleName: '工程维修',
    permissions: ['c.payroll.view', 'f.workorders.view'],
    dataScope: '仅本人'
  }
}

const tokens = new Map()   // token → { username, exp }
const TTL = 2 * 60 * 60

/* ------------------------------ 工具 ------------------------------ */
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const maskPhone = v => (v ? String(v).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : v)
const maskId = v => (v ? String(v).replace(/^(.{4}).*(.{4})$/, '$1**********$2') : v)
const num = (v, d = 0) => (v === undefined || v === '' ? d : Number(v))

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
const bad = msg => new ApiError(400, 40001, msg)
const unauthorized = () => new ApiError(401, 40101, '登录已过期，请重新登录')
const forbidden = msg => new ApiError(403, 40301, msg)
const notFound = msg => new ApiError(404, 40401, msg)
const conflictVer = () => new ApiError(409, 40901, '该记录已被他人修改，请刷新后重试')
const conflictUnique = msg => new ApiError(409, 40902, msg)
/* 40903 = 该期间已月结、只读；40904 = 已月结不能重复提交；40905 = 已反结不能重复反结。
   三种都给 409，但业务码必须分开：前端提示与后续动作完全不同（反结 / 看记录 / 不用管）。 */
const periodClosed = msg => new ApiError(409, 40903, msg)
const alreadyClosed = msg => new ApiError(409, 40904, msg)
const alreadyReopened = msg => new ApiError(409, 40905, msg)
const invalid = msg => new ApiError(422, 42201, msg)

const send = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  })
  res.end(JSON.stringify({ code: 0, message: 'ok', data }))
}
const sendErr = (res, e) => {
  res.writeHead(e.status || 500, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  })
  res.end(JSON.stringify({ code: e.code || 50000, message: e.message || '服务异常' }))
}

/* ------------------------------ 鉴权与范围 ------------------------------ */
function auth(req) {
  const h = req.headers.authorization || ''
  const m = h.match(/^Bearer\s+(.+)$/)
  if (!m) throw unauthorized()
  const hit = tokens.get(m[1])
  if (!hit || hit.exp < Date.now()) throw unauthorized()
  return USERS[hit.username]
}

/** 数据范围：老板全部；项目经理本项目；楼管责任范围（按房屋） */
function scope(u) {
  if (u.dataScope === '全部项目') return { all: true, communities: null, houses: null }
  return { all: false, communities: new Set(u.communities || []), houses: u.houseIds ? new Set(u.houseIds) : null }
}

function assertInScope(u, q) {
  const s = scope(u)
  if (s.all) return
  if (q.communityId && !s.communities.has(q.communityId)) {
    throw forbidden(`无权查看「${q.communityId}」的数据：超出当前数据范围（${u.dataScope}）`)
  }
  if (q.buildingId) {
    const hit = houses.filter(h => h.buildingId === q.buildingId)
    if (!hit.some(h => s.communities.has(h.communityId))) throw forbidden('该楼栋不在你的数据范围内')
  }
}

/**
 * 社区级实体（合同 / 公告）的可见性。
 * `communityId` 为空表示**集团层面**（劳动、采购合同，集团公告）——不挂项目，人人可见；
 * 否则按数据范围里的社区集合判断。责任范围的楼管 communities 为空，所以只有集团层面可见
 * （楼管不管合同公告，页面上也有权限守卫挡着）。
 */
function inScopeCommunity(u, communityId) {
  const s = scope(u)
  if (s.all) return true
  if (!communityId) return true
  return s.communities.has(communityId)
}

/** 行级过滤：房屋类实体按责任范围；业主按「名下任一房屋在范围内」 */
function inScopeHouse(u, houseId) {
  const s = scope(u)
  if (s.all) return true
  if (!houseId) return s.houses ? false : true
  if (s.houses) return s.houses.has(houseId)
  const h = HOUSE.get(houseId)
  return !!h && s.communities.has(h.communityId)
}
/** 没有 houseId 的实体（巡检任务、整改单）按项目判范围 */
function inScopeOwner(u, ownerId) {
  const s = scope(u)
  if (s.all) return true
  return houses.some(h => h.ownerId === ownerId && inScopeHouse(u, h.houseId))
}

/* ------------------------------ 分页 ------------------------------ */
function page(rows, q) {
  const pageNo = q.pageNo === undefined ? 1 : Number(q.pageNo)
  const size = q.size === undefined ? 20 : Number(q.size)
  if (!Number.isInteger(pageNo) || pageNo < 1) throw bad('pageNo 必须是 ≥1 的整数')
  if (!Number.isInteger(size) || size < 1 || size > 100) throw bad('size 必须在 1..100 之间')
  const start = (pageNo - 1) * size
  return { rows: rows.slice(start, start + size), total: rows.length, pageNo, size }
}
const kwHit = (fields, kw) => !kw || fields.some(f => String(f ?? '').includes(kw))
const eq = (v, q) => q === undefined || q === '' || String(v) === String(q)

/* ------------------------------ 复合视图 ------------------------------ */
function houseNameOf(houseId) {
  const h = HOUSE.get(houseId)
  return h ? h.fullName : ''
}
function ownerDebt(ownerId) {
  return r2(bills.filter(b => b.ownerId === ownerId).reduce((s, b) => s + (b.unpaid || 0), 0))
}
function ownerRow(o, { mask = true } = {}) {
  const hs = houses.filter(h => h.ownerId === o.ownerId)
  return {
    ...o,
    phone: mask ? maskPhone(o.phone) : o.phone,
    idCard: mask ? maskId(o.idCard) : o.idCard,
    phoneRedacted: mask,
    idCardRedacted: mask,
    houseCount: hs.length,
    houseNames: hs.map(h => h.fullName),
    debtAmount: ownerDebt(o.ownerId),
    _ver: verOf('owner', o.ownerId)
  }
}
function billRow(b) {
  const h = HOUSE.get(b.houseId)
  const o = OWNER.get(b.ownerId)
  return {
    ...b,
    buildingId: h ? h.buildingId : '',
    unitId: h ? h.unitId : '',
    houseName: h ? h.fullName : '',
    ownerName: o ? o.name : '',
    subjectType: b.houseId ? 'house' : 'park',
    _ver: verOf('bill', b.billId)
  }
}
function paymentRow(p) {
  const b = BILL.get(p.billId)
  const h = HOUSE.get(p.houseId)
  const o = OWNER.get(p.ownerId)
  return {
    ...p,
    communityId: h ? h.communityId : '',
    communityName: h ? communityNameOf(h.communityId) : '',
    subjectType: p.houseId ? 'house' : 'park',
    houseName: h ? h.fullName : '',
    ownerName: o ? o.name : '',
    subject: h ? h.fullName : (b ? '车位' : ''),
    itemName: b ? b.itemName : '',
    period: b ? b.period : ''
  }
}
function woRow(w) {
  const h = HOUSE.get(w.houseId)
  return {
    ...w,
    buildingId: h ? h.buildingId : '',
    unitId: h ? h.unitId : '',
    _ver: verOf('wo', w.woId)
  }
}

/* ------------------------------ 租户 / 巡检 / 整改 派生 ------------------------------ */
/** 完整度 8 项；核验门槛 5 项（实名与人脸属于核验结果，不作门槛，否则永远验不过） */
const TENANT_REQUIRED = [
  ['name', '姓名'], ['phone', '手机号'], ['idCard', '证件号'], ['relation', '与业主关系'],
  ['residents', '居住人数'], ['emergencyContact', '紧急联系人'],
  ['certified', '实名认证'], ['faceRegistered', '人脸录入']
]
const TENANT_BASIC = TENANT_REQUIRED.filter(([k]) => !['certified', 'faceRegistered', 'emergencyContact'].includes(k))

function tenantCompleteness(t) {
  const miss = keys => keys.filter(([k,]) => {
    const v = t[k]
    return (k === 'certified' || k === 'faceRegistered') ? !v : (k === 'residents' ? !(Number(v) > 0) : !String(v ?? '').trim())
  }).map(([, label]) => label)
  const missing = miss(TENANT_REQUIRED)
  const missingBasic = miss(TENANT_BASIC)
  return {
    total: TENANT_REQUIRED.length, filled: TENANT_REQUIRED.length - missing.length, missing,
    rate: Math.round((TENANT_REQUIRED.length - missing.length) / TENANT_REQUIRED.length * 1000) / 10,
    basicTotal: TENANT_BASIC.length, basicFilled: TENANT_BASIC.length - missingBasic.length, missingBasic
  }
}
function tenantRow(t, { mask = true } = {}) {
  const h = HOUSE.get(t.houseId)
  const o = OWNER.get(t.ownerId)
  return {
    ...t,
    phone: mask ? maskPhone(t.phone) : t.phone,
    idCard: mask ? maskId(t.idCard) : t.idCard,
    phoneRedacted: mask,
    idCardRedacted: mask,
    houseName: h ? h.fullName : '',
    communityId: h ? h.communityId : '',
    ownerName: o ? o.name : '',
    ownerPhone: mask ? maskPhone((o || {}).phone || '') : (o || {}).phone || '',
    completeness: tenantCompleteness(t),
    _ver: verOf('tenant', t.tenantId)
  }
}

const isSupervise = t => t.taskType === '监督'
function inspectRow(t) {
  return { ...t, _ver: verOf('task', t.taskId) }
}

const qualityRow = q => ({
  ...q,
  communityName: communityNameOf(q.communityId),   /* 列表要显示项目名，别让前端拿 id 猜 */
  _ver: verOf('quality', q.checkId)
})

const isRectifyClosed = r => r.status === '已闭环'
function rectifyRow(r) {
  const done = r.items.filter(i => i.done).length
  return {
    ...r,
    overdue: !isRectifyClosed(r) && String(r.dueDate || '') < DATA_DATE,
    progress: { done, total: r.items.length },
    items: r.items.map(i => ({ ...i })),
    _ver: verOf('rectify', r.rectifyId)
  }
}

/* ------------------------------ 路由表 ------------------------------ */
const routes = []
const on = (method, pattern, handler) => {
  const keys = []
  const re = new RegExp('^' + pattern.replace(/\{(\w+)\}/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '$')
  routes.push({ method, re, keys, handler })
}

/* ---------------- auth ---------------- */
on('POST', '/auth/login', (ctx) => {
  const { username, password } = ctx.body || {}
  const u = USERS[username]
  if (!u || u.password !== password) throw new ApiError(401, 40101, '账号或密码不正确')
  const token = 'mock.' + Buffer.from(`${username}:${Date.now()}`).toString('base64url')
  const refreshToken = 'refresh.' + Buffer.from(username).toString('base64url')
  tokens.set(token, { username, exp: Date.now() + TTL * 1000 })
  return {
    token, refreshToken, expiresIn: TTL,
    user: {
      empId: u.empId, name: u.name, roleId: u.roleId, roleName: u.roleName,
      permissions: u.permissions, dataScope: u.dataScope, communities: u.communities || []
    }
  }
})
on('POST', '/auth/refresh', (ctx) => {
  const rt = String(ctx.body?.refreshToken || '').replace('refresh.', '')
  const u = USERS[Buffer.from(rt, 'base64url').toString()]
  if (!u) throw unauthorized()
  const token = 'mock.' + Buffer.from(`${rt}:${Date.now()}`).toString('base64url')
  tokens.set(token, { username: rt, exp: Date.now() + TTL * 1000 })
  return {
    token, refreshToken: ctx.body.refreshToken, expiresIn: TTL,
    user: {
      empId: u.empId, name: u.name, roleId: u.roleId, roleName: u.roleName,
      permissions: u.permissions, dataScope: u.dataScope, communities: u.communities || []
    }
  }
})

/* ---------------- owners ---------------- */
on('GET', '/owners', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const q = ctx.query
  const list = owners
    .filter(o => inScopeOwner(ctx.user, o.ownerId))
    .filter(o => {
      const hs = houses.filter(h => h.ownerId === o.ownerId)
      if (q.communityId && !hs.some(h => h.communityId === q.communityId)) return false
      if (q.buildingId && !hs.some(h => h.buildingId === q.buildingId)) return false
      if (q.unitId && !hs.some(h => h.unitId === q.unitId)) return false
      if (!kwHit([o.name, o.phone, o.ownerId, hs.map(h => h.fullName).join(' ')], q.kw)) return false
      if (q.vf === 'debt' && ownerDebt(o.ownerId) <= 0) return false
      if (q.vf === 'multi' && hs.length <= 1) return false
      if (q.vf === 'unverified' && o.certified) return false
      if (q.vf === 'noface' && o.faceRegistered) return false
      return true
    })
    .map(o => ownerRow(o, { mask: true }))
  return page(list, q)
})
on('GET', '/owners/{ownerId}', (ctx) => {
  const o = OWNER.get(ctx.params.ownerId)
  if (!o) throw notFound('业主不存在')
  if (!inScopeOwner(ctx.user, o.ownerId)) throw forbidden('该业主不在你的数据范围内')
  const hs = houses.filter(h => h.ownerId === o.ownerId).map(h => ({
    ...h, stewardName: (EMP.get(h.stewardEmpId) || {}).name || ''
  }))
  const myBills = bills.filter(b => b.ownerId === o.ownerId)
  return {
    owner: ownerRow(o, { mask: false }),
    houses: hs,
    stats: {
      houses: hs.length,
      unpaid: r2(myBills.reduce((s, b) => s + (b.unpaid || 0), 0)),
      debtBills: myBills.filter(b => (b.unpaid || 0) > 0).length
    },
    recentPayments: payments.filter(p => p.ownerId === o.ownerId).slice(0, 3).map(paymentRow)
  }
})
on('PATCH', '/owners/{ownerId}', (ctx) => {
  const o = OWNER.get(ctx.params.ownerId)
  if (!o) throw notFound('业主不存在')
  if (!inScopeOwner(ctx.user, o.ownerId)) throw forbidden('该业主不在你的数据范围内')
  const { field, value, ver: expect } = ctx.body || {}
  const ALLOWED = ['name', 'phone', 'email', 'emergencyContact', 'emergencyPhone', 'creditLevel', 'remark']
  if (!ALLOWED.includes(field)) throw bad(`字段 ${field} 不支持内联编辑`)
  if (expect !== undefined && Number(expect) !== verOf('owner', o.ownerId)) throw conflictVer()
  if (field === 'phone') {
    const dup = owners.find(x => x.ownerId !== o.ownerId && x.phone === value)
    if (dup) throw conflictUnique(`手机号「${value}」已存在，不能重复录入`)
  }
  o[field] = value
  bumpVer('owner', o.ownerId)
  return ownerRow(o, { mask: false })
})
on('GET', '/owners/{ownerId}/houses', (ctx) => {
  const o = OWNER.get(ctx.params.ownerId)
  if (!o) throw notFound('业主不存在')
  return {
    rows: houses.filter(h => h.ownerId === o.ownerId)
      .map(h => ({ ...h, stewardName: (EMP.get(h.stewardEmpId) || {}).name || '' }))
  }
})

/* ---------------- houses ---------------- */
on('GET', '/houses/{houseId}', (ctx) => {
  const h = HOUSE.get(ctx.params.houseId)
  if (!h) throw notFound('房屋不存在')
  if (!inScopeHouse(ctx.user, h.houseId)) throw forbidden('该房屋不在你的数据范围内')
  return { ...h, stewardName: (EMP.get(h.stewardEmpId) || {}).name || '' }
})

/* ---------------- bills ---------------- */
const isDebt = b => (b.unpaid || 0) > 0

function billFilter(u, q) {
  return bills
    .filter(b => inScopeHouse(u, b.houseId))
    .filter(b => {
      const h = HOUSE.get(b.houseId)
      const comm = b.communityId || (h ? h.communityId : '')
      if (q.communityId && comm !== q.communityId) return false
      if (q.buildingId && (h ? h.buildingId : '') !== q.buildingId) return false
      if (q.unitId && (h ? h.unitId : '') !== q.unitId) return false
      if (!eq(b.period, q.period)) return false
      if (!eq(b.status, q.status)) return false
      if (!eq(b.itemId, q.itemId)) return false
      if (q.subjectType && (b.houseId ? 'house' : 'park') !== q.subjectType) return false
      if (q.vf === 'debt' && !isDebt(b)) return false
      if (q.vf === 'overdue' && !(b.status === '逾期' || (b.overdueDays || 0) > 0)) return false
      if (q.vf === 'unpaid' && b.status !== '未缴') return false
      if (q.vf === 'part' && b.status !== '部分缴') return false
      if (!kwHit([b.billId, b.itemName, (OWNER.get(b.ownerId) || {}).name], q.kw)) return false
      return true
    })
    .sort((a, b) => String(b.period).localeCompare(String(a.period)) || String(a.billId).localeCompare(String(b.billId)))
}

on('GET', '/bills', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const list = billFilter(ctx.user, ctx.query).map(billRow)
  return page(list, ctx.query)
})
on('GET', '/bills/summary', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const list = billFilter(ctx.user, ctx.query)
  return {
    count: list.length,
    payable: r2(list.reduce((s, b) => s + (b.payable || 0), 0)),
    unpaid: r2(list.reduce((s, b) => s + (b.unpaid || 0), 0)),
    debtCount: list.filter(isDebt).length,
    overdueCount: list.filter(b => (b.overdueDays || 0) > 0).length
  }
})
on('GET', '/bills/{billId}', (ctx) => {
  const b = BILL.get(ctx.params.billId)
  if (!b) throw notFound('账单不存在')
  return billRow(b)
})
on('PATCH', '/bills/{billId}', (ctx) => {
  const b = BILL.get(ctx.params.billId)
  if (!b) throw notFound('账单不存在')
  const { field, value, ver: expect } = ctx.body || {}
  if (!['remark', 'dueDate'].includes(field)) throw bad(`字段 ${field} 不支持内联编辑`)
  if (expect !== undefined && Number(expect) !== verOf('bill', b.billId)) throw conflictVer()
  b[field] = value
  bumpVer('bill', b.billId)
  return billRow(b)
})
on('POST', '/bills/batch-remind', (ctx) => {
  const ids = ctx.body?.billIds
  if (!Array.isArray(ids) || !ids.length) throw bad('billIds 不能为空')
  const ok = []
  const failed = []
  for (const id of [...new Set(ids)]) {
    const b = BILL.get(id)
    if (!b) { failed.push({ id, reason: '账单不存在' }); continue }
    if (!inScopeHouse(ctx.user, b.houseId)) { failed.push({ id, reason: '该账单不在你的数据范围内' }); continue }
    if (!isDebt(b)) { failed.push({ id, reason: '该账单没有欠费，无需催缴' }); continue }
    ok.push(id)
  }
  return { ok: ok.length, failed, total: [...new Set(ids)].length, batchNo: 'CJ' + Date.now().toString().slice(-7) }
})
on('POST', '/bills/batch-reduce', (ctx) => {
  const ids = ctx.body?.billIds
  const reason = String(ctx.body?.reason || '').trim()
  if (!Array.isArray(ids) || !ids.length) throw bad('billIds 不能为空')
  if (reason.length < 4) throw invalid('请填写减免原因（至少 4 个字）')
  const ok = []
  const failed = []
  for (const id of [...new Set(ids)]) {
    const b = BILL.get(id)
    if (!b) { failed.push({ id, reason: '账单不存在' }); continue }
    if (!isDebt(b)) { failed.push({ id, reason: '该账单已结清或已减免' }); continue }
    b.discount = r2((b.discount || 0) + (b.unpaid || 0))
    b.unpaid = 0
    b.status = '已减免'
    bumpVer('bill', b.billId)
    ok.push(id)
  }
  return { ok: ok.length, failed, total: [...new Set(ids)].length }
})

/* ---------------- payments ---------------- */
const dayOf = s => String(s || '').slice(0, 10)

/** 流水过滤：列表与汇总必须共用这一个函数，否则「列表 100 笔 / 合计 98 笔」 */
function payFilter(u, q) {
  return payments
    .filter(p => inScopeHouse(u, p.houseId))
    .filter(p => {
      const h = HOUSE.get(p.houseId)
      if (q.communityId && (h ? h.communityId : '') !== q.communityId) return false
      if (q.buildingId && (h ? h.buildingId : '') !== q.buildingId) return false
      if (q.unitId && (h ? h.unitId : '') !== q.unitId) return false
      if (!eq(p.method, q.method)) return false
      if (!eq(p.channel, q.channel)) return false
      if (!eq(p.invoiceStatus, q.invoiceStatus)) return false
      if (q.startDate && dayOf(p.payTime) < q.startDate) return false
      if (q.endDate && dayOf(p.payTime) > q.endDate) return false
      if (!kwHit([p.payId, p.transNo, p.operator, (BILL.get(p.billId) || {}).itemName], q.kw)) return false
      if (q.subjectType && (p.houseId ? 'house' : 'park') !== q.subjectType) return false
      if (q.vf && !(PAY_VF[q.vf] || (() => true))(p)) return false
      return true
    })
    .sort((a, b) => String(b.payTime).localeCompare(String(a.payTime)))
}
/** 快捷视图谓词：与原型 api.js 的 PAY_VF 同一份定义 */
const PAY_VF = {
  parkonly: p => !p.houseId,
  cash: p => p.method === '现金',
  uninvoiced: p => p.invoiceStatus === '未开票',
  red: p => p.invoiceStatus === '已冲红',
  deposit: p => p.channel === '预存抵扣'
}

on('GET', '/payments', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  return page(payFilter(ctx.user, ctx.query).map(paymentRow), ctx.query)
})

/* 汇总必须注册在 /payments/{payId} 之前，否则 "summary" 会被当成 payId 匹配掉 */
on('GET', '/payments/summary', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const list = payFilter(ctx.user, ctx.query)
  const sum = arr => r2(arr.reduce((s, p) => s + (p.amount || 0), 0))
  const cash = list.filter(p => p.method === '现金')
  const today = DATA_DATE
  const thisMonth = DATA_DATE.slice(0, 7)
  const payIds = new Set(list.map(p => p.payId))
  const groupBy = key => {
    const m = new Map()
    for (const p of list) {
      const k = p[key] || ''
      const cur = m.get(k) || { [key]: k, count: 0, amount: 0 }
      cur.count++
      cur.amount = r2(cur.amount + (p.amount || 0))
      m.set(k, cur)
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount)
  }
  return {
    count: list.length,
    amount: sum(list),
    cashCount: cash.length,
    cashAmount: sum(cash),
    uninvoicedCount: list.filter(p => p.invoiceStatus === '未开票').length,
    refundAmount: r2(refunds.filter(r => payIds.has(r.payId)).reduce((s, r) => s + (r.amount || 0), 0)),
    todayCount: list.filter(p => dayOf(p.payTime) === today).length,
    todayAmount: sum(list.filter(p => dayOf(p.payTime) === today)),
    monthCount: list.filter(p => String(p.payTime).slice(0, 7) === thisMonth).length,
    monthAmount: sum(list.filter(p => String(p.payTime).slice(0, 7) === thisMonth)),
    invoiced: list.filter(p => p.invoiceStatus === '已开票').length,
    byMethod: groupBy('method'),
    byChannel: groupBy('channel')
  }
})
on('GET', '/payments/{payId}', (ctx) => {
  const p = payments.find(x => x.payId === ctx.params.payId)
  if (!p) throw notFound('流水不存在')
  return {
    payment: paymentRow(p),
    bill: BILL.get(p.billId) ? billRow(BILL.get(p.billId)) : null,
    house: HOUSE.get(p.houseId) || null,
    refunds: refunds.filter(r => r.payId === p.payId)
  }
})
on('POST', '/payments/{payId}/refund', (ctx) => {
  const p = payments.find(x => x.payId === ctx.params.payId)
  if (!p) throw notFound('流水不存在')
  if (!inScopeHouse(ctx.user, p.houseId)) throw forbidden('该流水不在你的数据范围内')
  /* 已月结期间的流水不能直接退：退款会改上月已封存的收款与欠费，
     必须「反结 → 退款 → 重结」，否则月结报表与明细对不上且查不出是哪一步错的 */
  const lock = activeClose(monthOf(p.payTime))
  if (lock) {
    throw periodClosed(`${lock.period} 已月结（${lock.closeNo}），该期间流水只读；请先反结再退款`)
  }
  const already = r2(p.refundAmount || 0)
  const left = r2((p.amount || 0) - already)
  if (left <= 0) throw invalid('该笔已全额退款，不能重复退款')
  const reason = String(ctx.body?.reason || '').trim()
  if (reason.length < 4) throw invalid('请填写退款原因（至少 4 个字）')
  const amt = ctx.body?.amount === undefined || ctx.body?.amount === null || ctx.body?.amount === ''
    ? left : r2(Number(ctx.body.amount))
  if (!(amt > 0)) throw invalid('退款金额必须大于 0')
  if (amt > left + 0.01) throw invalid(`退款金额不能超过可退金额 ${left}`)

  const at = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const row = {
    refundId: 'RF' + String(refunds.length + 1).padStart(5, '0'),
    refundNo: `TK-${at.slice(0, 10)}-${String(refunds.length + 1).padStart(3, '0')}`,
    payId: p.payId, billId: p.billId, ownerId: p.ownerId,
    ownerName: (OWNER.get(p.ownerId) || {}).name || '',
    houseName: houseNameOf(p.houseId),
    amount: amt, kind: amt >= left - 0.01 ? '全额' : '部分',
    /* 退款原路退回：记下原流水的方式，月结按方式汇总才不会出现一行空 method */
    method: p.method, channel: p.channel,
    reason, operator: ctx.body?.operator || ctx.user.name, at,
    invoiceRedFlushed: p.invoiceStatus === '已开票'
  }
  refunds.unshift(row)

  /* ① 流水 */
  p.refundAmount = r2(already + amt)
  p.refundStatus = p.refundAmount >= (p.amount || 0) - 0.01 ? '已全额退款' : '部分退款'
  if (p.invoiceStatus === '已开票') p.invoiceStatus = '已冲红'

  /* ② 冲回账单：已收减、未收加、状态重算 —— 不做这步，欠费报表会少一笔 */
  const b = BILL.get(p.billId)
  if (b) {
    b.paidAmount = r2(Math.max(0, (b.paidAmount || 0) - amt))
    b.unpaid = r2((b.unpaid || 0) + amt)
    b.status = b.unpaid <= 0.01 ? '已缴' : (b.paidAmount > 0.01 ? '部分缴' : ((b.overdueDays || 0) > 0 ? '逾期' : '未缴'))
    bumpVer('bill', b.billId)
  }
  return row
})

/* ---------------- work orders ---------------- */
const WO_DONE = ['已完工', '已关闭', '已评价']
const isOpen = w => !WO_DONE.includes(w.status) && w.status !== '已取消'

function woFilter(u, q) {
  return workOrders
    .filter(w => inScopeHouse(u, w.houseId))
    .filter(w => {
      const h = HOUSE.get(w.houseId)
      if (q.communityId && w.communityId !== q.communityId) return false
      if (q.buildingId && (!h || h.buildingId !== q.buildingId)) return false
      if (q.unitId && (!h || h.unitId !== q.unitId)) return false
      if (!eq(w.status, q.status)) return false
      if (!eq(w.type, q.type)) return false
      if (!eq(w.priority, q.priority)) return false
      if (String(q.nohouse) === 'true' && w.houseId) return false
      if (q.vf === 'pending' && w.status !== '待派单') return false
      /* 「已超时 / 临近超时」都只算**未闭环**的单：已结单的迟到单不占这两个视图，
         否则视图条数与 KPI（只算未闭环）对不上，同一页两个数 */
      if (q.vf === 'overdue' && !(isOpen(w) && w.slaBreached)) return false
      if (q.vf === 'urgent' && !(isOpen(w) && !w.slaBreached && (w.slaHours - w.slaUsedHours) <= w.slaHours * 0.2)) return false
      if (q.vf === 'open' && !isOpen(w)) return false
      if (!kwHit([w.woNo, w.title, w.assignee, w.ownerName], q.kw)) return false
      return true
    })
}
on('GET', '/work-orders', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const list = woFilter(ctx.user, ctx.query).map(woRow)
  return page(list, ctx.query)
})
on('GET', '/work-orders/summary', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const open = woFilter(ctx.user, { ...ctx.query, vf: '' }).filter(isOpen)
  return {
    total: woFilter(ctx.user, ctx.query).length,
    open: open.length,
    overdue: open.filter(w => w.slaBreached).length,
    pending: open.filter(w => w.status === '待派单').length,
    urgent: open.filter(w => !w.slaBreached && (w.slaHours - w.slaUsedHours) <= w.slaHours * 0.2).length,
    paused: open.filter(w => w.status === '待确认').length
  }
})
on('GET', '/work-orders/{woId}', (ctx) => {
  const w = workOrders.find(x => x.woId === ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  const timeline = [
    { at: w.createTime, action: '创建', by: w.ownerName || '业主', memo: w.source },
    w.acceptTime ? { at: w.acceptTime, action: '接单', by: w.assignee || '', memo: '' } : null,
    w.arriveTime ? { at: w.arriveTime, action: '到场', by: w.assignee || '', memo: '' } : null,
    w.finishTime ? { at: w.finishTime, action: '完工', by: w.assignee || '', memo: w.remark || '' } : null
  ].filter(Boolean)
  return { workOrder: woRow(w), timeline }
})
on('PATCH', '/work-orders/{woId}', (ctx) => {
  const w = workOrders.find(x => x.woId === ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  const { field, value, ver: expect } = ctx.body || {}
  if (!['priority', 'assignee', 'remark'].includes(field)) throw bad(`字段 ${field} 不支持内联编辑`)
  if (expect !== undefined && Number(expect) !== verOf('wo', w.woId)) throw conflictVer()
  w[field] = value
  bumpVer('wo', w.woId)
  return woRow(w)
})
on('POST', '/work-orders/batch', (ctx) => {
  const ids = ctx.body?.woIds
  const patchData = ctx.body?.patch || {}
  if (!Array.isArray(ids) || !ids.length) throw bad('woIds 不能为空')
  if (!patchData.priority && !patchData.assignee) throw invalid('patch 至少要给 priority 或 assignee')
  const ok = []
  const failed = []
  for (const id of [...new Set(ids)]) {
    const w = workOrders.find(x => x.woId === id)
    if (!w) { failed.push({ id, reason: '工单不存在' }); continue }
    if (!isOpen(w)) { failed.push({ id, reason: `状态「${w.status}」不参与批量修改` }); continue }
    Object.assign(w, patchData)
    bumpVer('wo', w.woId)
    ok.push(id)
  }
  return { ok: ok.length, failed, total: [...new Set(ids)].length }
})


/* ---------------- tenants ---------------- */
function tenantFilter(u, q) {
  return tenants
    .filter(t => inScopeHouse(u, t.houseId))
    .filter(t => {
      const h = HOUSE.get(t.houseId)
      if (q.communityId && (!h || h.communityId !== q.communityId)) return false
      if (q.buildingId && (!h || h.buildingId !== q.buildingId)) return false
      if (q.unitId && (!h || h.unitId !== q.unitId)) return false
      if (!eq(t.verifyStatus, q.verifyStatus)) return false
      if (!eq(t.source, q.source)) return false
      if (!kwHit([t.name, t.phone, t.tenantId, h ? h.fullName : ''], q.kw)) return false
      if (q.vf === 'pending' && t.verifyStatus !== '待核验') return false
      if (q.vf === 'incomplete' && t.verifyStatus !== '信息不全') return false
      if (q.vf === 'uncertified' && t.certified) return false
      if (q.vf === 'noface' && t.faceRegistered) return false
      if (q.vf === 'moved' && t.status !== '已搬离') return false
      if (q.vf === 'expiring') {
        const left = (new Date(t.leaseEnd) - new Date(DATA_DATE)) / 86400000
        if (!(left >= 0 && left <= 90)) return false
      }
      if (!q.vf && t.status === '已搬离') return false
      return true
    })
}
on('GET', '/tenants', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const list = tenantFilter(ctx.user, ctx.query).map(t => tenantRow(t, { mask: true }))
  return page(list, ctx.query)
})
on('GET', '/tenants/{tenantId}', (ctx) => {
  const t = tenants.find(x => x.tenantId === ctx.params.tenantId)
  if (!t) throw notFound('租户不存在')
  if (!inScopeHouse(ctx.user, t.houseId)) throw forbidden('该租户不在你的数据范围内')
  const o = OWNER.get(t.ownerId)
  return {
    tenant: tenantRow(t, { mask: false }),
    house: HOUSE.get(t.houseId) || null,
    owner: o ? { ownerId: o.ownerId, name: o.name, phone: o.phone } : null
  }
})
on('POST', '/tenants/{tenantId}/verify', (ctx) => {
  const t = tenants.find(x => x.tenantId === ctx.params.tenantId)
  if (!t) throw notFound('租户不存在')
  if (t.status === '已搬离') throw invalid('已搬离的租户不能核验')
  const pass = ctx.body?.pass !== false
  const miss = tenantCompleteness(t).missingBasic
  if (pass && miss.length) {
    const e = new ApiError(422, 42202, `还有 ${miss.length} 项基础信息缺失（${miss.join('、')}），补全后再核验`)
    e.details = miss.map(k => ({ id: t.tenantId, reason: `缺 ${k}` }))
    throw e
  }
  t.verifyStatus = pass ? '已核验' : '信息不全'
  if (pass) t.certified = true          /* 核验含实名；人脸另行录入 */
  t.verifiedBy = ctx.body?.verifier || ctx.user.name
  t.verifiedAt = DATA_DATE
  bumpVer('tenant', t.tenantId)
  return tenantRow(t, { mask: false })
})
on('POST', '/tenants/{tenantId}/face', (ctx) => {
  const t = tenants.find(x => x.tenantId === ctx.params.tenantId)
  if (!t) throw notFound('租户不存在')
  if (t.status === '已搬离') throw invalid('已搬离的租户不能录入人脸')
  if (t.verifyStatus !== '已核验') throw invalid('请先完成物业核验，再录入人脸')
  if (t.faceRegistered) throw invalid('该租户已录入人脸')
  t.faceRegistered = true
  t.verifiedAt = DATA_DATE
  bumpVer('tenant', t.tenantId)
  return tenantRow(t, { mask: false })
})
on('POST', '/tenants/{tenantId}/move-out', (ctx) => {
  const t = tenants.find(x => x.tenantId === ctx.params.tenantId)
  if (!t) throw notFound('租户不存在')
  if (t.status === '已搬离') throw invalid('该租户已是「已搬离」状态')
  const date = ctx.body?.date
  const reason = String(ctx.body?.reason || '').trim()
  if (!date) throw bad('搬离日期必填')
  if (reason.length < 2) throw invalid('请填写搬离原因')
  t.status = '已搬离'
  t.moveOutAt = date
  t.moveOutReason = reason
  t.faceRegistered = false               /* 搬离必须停用门禁 */
  const h = HOUSE.get(t.houseId)
  if (h) h.tenantId = null               /* 释放房屋的在住关系，否则那套房永远显示有人 */
  bumpVer('tenant', t.tenantId)
  return tenantRow(t, { mask: false })
})
on('POST', '/tenants/batch-verify', (ctx) => {
  const ids = ctx.body?.tenantIds
  if (!Array.isArray(ids) || !ids.length) throw bad('tenantIds 不能为空')
  const ok = []
  const failed = []
  for (const id of [...new Set(ids)]) {
    const t = tenants.find(x => x.tenantId === id)
    if (!t) { failed.push({ id, reason: '租户不存在' }); continue }
    if (t.status === '已搬离') { failed.push({ id, reason: '已搬离' }); continue }
    if (t.verifyStatus === '已核验') { failed.push({ id, reason: '已核验过' }); continue }
    const miss = tenantCompleteness(t).missingBasic
    if (miss.length) { failed.push({ id, reason: `缺 ${miss.join('、')}` }); continue }
    t.verifyStatus = '已核验'
    t.certified = true
    t.verifiedBy = ctx.body?.operator || ctx.user.name
    t.verifiedAt = DATA_DATE
    bumpVer('tenant', t.tenantId)
    ok.push(id)
  }
  return { ok: ok.length, failed, total: [...new Set(ids)].length }
})

/* ---------------- inspect tasks ---------------- */
function taskFilter(u, q) {
  return inspectTasks
    .filter(t => inScopeHouse(u, houses.find(h => h.communityId === t.communityId && inScopeHouse(u, h.houseId))?.houseId)
      || inScopeCommunity(u, t.communityId))
    .filter(t => {
      if (q.communityId && t.communityId !== q.communityId) return false
      if (!eq(t.taskType, q.taskType)) return false
      if (!eq(t.status, q.status)) return false
      if (!eq(t.post, q.post)) return false
      if (q.executor && t.executor !== q.executor) return false
      if (q.dateFrom && t.scheduledDate < q.dateFrom) return false
      if (q.dateTo && t.scheduledDate > q.dateTo) return false
      if (!kwHit([t.taskId, t.planName, t.executor, t.targetDept], q.kw)) return false
      return true
    })
    .sort((a, b) => String(b.scheduledDate).localeCompare(String(a.scheduledDate)))
}
on('GET', '/inspect-tasks', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const list = taskFilter(ctx.user, ctx.query).map(inspectRow)
  return page(list, ctx.query)
})
on('GET', '/inspect-tasks/{taskId}', (ctx) => {
  const t = inspectTasks.find(x => x.taskId === ctx.params.taskId)
  if (!t) throw notFound('巡检任务不存在')
  return inspectRow(t)
})
on('POST', '/inspect-tasks/{taskId}/submit', (ctx) => {
  const t = inspectTasks.find(x => x.taskId === ctx.params.taskId)
  if (!t) throw notFound('巡检任务不存在')
  const results = ctx.body?.results
  if (!Array.isArray(results) || !results.length) throw bad('results 不能为空')
  for (const r of results) {
    if (!['合格', '不合格'].includes(r.result)) throw bad(`result 只能是「合格 / 不合格」，收到 ${r.result}`)
  }
  /* 监督任务的不合格项必须落到人：不指定责任员工，考核就归不到人，等于白查 */
  if (isSupervise(t)) {
    const miss = results.filter(r => r.result === '不合格' && !r.responsibleEmpId)
    if (miss.length) throw invalid(`监督任务有 ${miss.length} 项不合格未指定责任员工（${miss.map(m => m.item).slice(0, 3).join('、')}）`)
  }
  const ng = results.filter(r => r.result === '不合格')
  t.normalCount = results.length - ng.length
  t.issueCount = ng.length
  t.itemCount = results.length
  t.photos = Number(ctx.body?.photos) || t.photos || 0
  t.checkedIn = ctx.body?.checkedIn !== undefined ? !!ctx.body.checkedIn : true
  t.status = '已完成'
  t.doneTime = `${DATA_DATE} 10:20`
  t.issueItems = ng.map(r => ({
    item: r.item, deduct: Number(r.deduct) || 2,
    responsibleName: r.responsibleName || '', responsibleEmpId: r.responsibleEmpId || ''
  }))
  bumpVer('task', t.taskId)
  return inspectRow(t)
})

/* ---------------- rectify orders ---------------- */
function rectifyFilter(u, q) {
  return rectifyOrders
    .filter(r => inScopeCommunity(u, r.communityId))
    .filter(r => {
      if (q.communityId && r.communityId !== q.communityId) return false
      if (!eq(r.status, q.status)) return false
      if (!eq(r.level, q.level)) return false
      if (q.deptName && r.deptName !== q.deptName) return false
      if (String(q.overdue) === 'true' && !(r.status !== '已闭环' && String(r.dueDate) < DATA_DATE)) return false
      if (q.vf === 'todo' && !['待整改', '已退回'].includes(r.status)) return false
      if (q.vf === 'overdue' && !(r.status !== '已闭环' && String(r.dueDate) < DATA_DATE)) return false
      if (q.vf === 'recheck' && r.status !== '待复核') return false
      if (q.vf === 'closed' && r.status !== '已闭环') return false
      if (!kwHit([r.rectifyNo, r.checkNo, r.issueDesc, r.deptName], q.kw)) return false
      return true
    })
    .sort((a, b) => {
      const rank = x => (x.status === '已闭环' ? 2 : 0)
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      return String(b.createdAt).localeCompare(String(a.createdAt))
    })
}
on('GET', '/rectify-orders', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const list = rectifyFilter(ctx.user, ctx.query).map(rectifyRow)
  return page(list, ctx.query)
})
on('GET', '/rectify-orders/{rectifyId}', (ctx) => {
  const r = rectifyOrders.find(x => x.rectifyId === ctx.params.rectifyId)
  if (!r) throw notFound('整改单不存在')
  return rectifyRow(r)
})
on('POST', '/rectify-orders/{rectifyId}/submit', (ctx) => {
  const r = rectifyOrders.find(x => x.rectifyId === ctx.params.rectifyId)
  if (!r) throw notFound('整改单不存在')
  if (r.status === '已闭环') throw invalid('该单已闭环，不能重复提交')
  if (r.status === '待复核') throw invalid('已提交复核，请等待督导复核')
  const picked = Array.isArray(ctx.body?.itemNos) && ctx.body.itemNos.length ? new Set(ctx.body.itemNos) : null
  r.items = r.items.map(i => ({ ...i, done: picked ? (picked.has(i.no) || i.done) : true }))
  const left = r.items.filter(i => !i.done).length
  if (left) throw invalid(`还有 ${left} 项未处理，不能提交复核`)
  r.status = '待复核'
  r.submitAt = `${DATA_DATE} 17:10`
  r.submitBy = ctx.body?.submitBy || ctx.user.name
  r.submitRemark = ctx.body?.submitRemark || ''
  bumpVer('rectify', r.rectifyId)
  return rectifyRow(r)
})
on('POST', '/rectify-orders/{rectifyId}/recheck', (ctx) => {
  const r = rectifyOrders.find(x => x.rectifyId === ctx.params.rectifyId)
  if (!r) throw notFound('整改单不存在')
  if (r.status !== '待复核') throw invalid(`当前状态「${r.status}」不可复核`)
  const pass = ctx.body?.pass !== false
  const by = String(ctx.body?.recheckBy || '').trim()
  if (!by) throw bad('recheckBy 必填')
  /* 提交人不得自己复核：自己交自己验，等于没验 */
  if (r.submitBy && r.submitBy === by) throw invalid('提交人不能自己复核，请由品质督导复核')
  if (pass) {
    r.status = '已闭环'
    r.recheckResult = '通过'
    r.recheckAt = `${DATA_DATE} 09:40`
  } else {
    r.status = '已退回'
    r.recheckResult = '不通过'
    r.recheckAt = `${DATA_DATE} 09:40`
    r.items = r.items.map(i => ({ ...i, done: false }))   /* 退回不是改状态，是归零重做 */
  }
  r.recheckRemark = ctx.body?.remark || ''
  bumpVer('rectify', r.rectifyId)
  return rectifyRow(r)
})


/* ---------------- quality checks ---------------- */
function qualityFilter(u, q) {
  return qualityChecks
    .filter(c => inScopeCommunity(u, c.communityId))
    .filter(c => {
      if (q.communityId && c.communityId !== q.communityId) return false
      if (!eq(c.area, q.area)) return false
      if (!eq(c.grade, q.grade)) return false
      if (!eq(c.status, q.status)) return false
      if (!eq(c.sourceType, q.sourceType)) return false
      if (!eq(c.period, q.period)) return false
      if (!kwHit([c.checkNo, c.checker, c.area, c.type], q.kw)) return false
      if (q.vf === 'unqualified' && !(c.grade === '不合格' || c.veto)) return false
      if (q.vf === 'rectifying' && c.status !== '整改中') return false
      if (q.vf === 'recheck' && c.status !== '待复核') return false
      if (q.vf === 'overdue' && c.status !== '已超时') return false
      if (q.vf === 'veto' && !c.veto) return false
      return true
    })
    .sort((a, b) => String(b.checkDate).localeCompare(String(a.checkDate)))
}
on('GET', '/quality-checks', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const list = qualityFilter(ctx.user, ctx.query).map(qualityRow)
  return page(list, ctx.query)
})
on('GET', '/quality-checks/summary', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const list = qualityFilter(ctx.user, ctx.query)
  const avg = list.length ? Math.round(list.reduce((s, c) => s + c.score, 0) / list.length * 10) / 10 : 0
  return {
    count: list.length,
    avgScore: avg,
    qualified: list.filter(c => c.grade !== '不合格').length,
    /* 一票否决的分数可能不低，只按 <70 判会漏 */
    unqualified: list.filter(c => c.grade === '不合格' || c.veto).length,
    rectifying: list.filter(c => c.status === '整改中').length,
    overdue: list.filter(c => c.status === '已超时').length,
    recheck: list.filter(c => c.status === '待复核').length,
    veto: list.filter(c => c.veto).length
  }
})
on('GET', '/quality-checks/{checkId}', (ctx) => {
  const c = qualityChecks.find(x => x.checkId === ctx.params.checkId)
  if (!c) throw notFound('检查记录不存在')
  if (!inScopeCommunity(ctx.user, c.communityId)) throw forbidden('该记录不在你的数据范围内')
  return {
    check: qualityRow(c),
    rectifies: rectifyOrders.filter(r => r.checkId === c.checkId).map(rectifyRow)
  }
})

/* ================= 期间状态（报表与月结共用） =================
 * 放在报表块之前：`specOf()` 在模块初始化时就要判断「这个月结账没有」，
 * 定义放在月结块里会撞 TDZ（第一次加载直接 ReferenceError）。
 * 报表的 provisional 与月结的 closable 读的必须是同一个 activeClose —— 两个来源必然对不上。
 */
const monthCloses = []                       /* 结账记录（含已反结） */
const monthOf = v => String(v || '').slice(0, 7)
/**
 * 该期间是否已封账。
 * - 不传 communityId：只看**全公司**结账（汇总口径）；
 * - 传 communityId：本项目结过就算封；**全公司结账覆盖所有项目**——
 *   否则全公司结完，单个项目还能补录，汇总数就对不上了。
 */
const activeClose = (period, communityId = '') => {
  const list = monthCloses.filter(c => c.period === period && c.status === '已结账')
  if (communityId) {
    return list.find(c => c.scope === 'community' && c.communityId === communityId)
      || list.find(c => c.scope === 'group') || null
  }
  return list.find(c => c.scope === 'group') || null
}
const prevMonthOf = period => {
  const [y, m] = String(period).split('-')
  return new Date(Date.UTC(+y, +m - 2, 1)).toISOString().slice(0, 7)
}

/* ================= 报表快照（跑批产物） =================
 * 为什么不用「实时算」：账龄、收缴率、达标率都是「截至某一天」的口径，
 * 实时算会让同一张表两次刷新两个数，且答不了「上个月报表当时长什么样」。
 * 这里的语义与真后端一致：
 *   ① 批次由 POST /reports/recalc 生成（异步，跑完才有 batchNo）；
 *   ② 查询接口只读已落库的批次，**再按当前用户的数据范围裁剪行**（批次是全局的，权限是个人的）；
 *   ③ 快照一旦生成就冻结——之后账单再变，历史批次数字不变（这是报表能对账的前提）。
 *
 * 期次模型（2026-10-30 拍板）：
 *   - **时点型**（欠费账龄）：月报 = 月末那天 24:00 的余额，年报 = 年末那天；期次只决定「看哪一天的余额」，
 *     不做整期汇总——把余额按天加起来没有业务含义。
 *   - **期间型**（收缴率 / 部门达标率）：月报 = 整月重算，年报 = 整年重算；**不能**由日快照累加，
 *     因为补录与退款会让「每天的余额相加」≠「整月发生额」。
 *   - 未结账的期次照样能出数，但 `provisional=true`（试算值），`statDate` 落在今天而不是期末——
 *     页头必须显示「试算 · 截至 X 日」，否则下个月看到数字变了会以为系统出错。
 *   - 年报拆两张：**余额**走 arrears 的年视图（时点），**发生额**走 collection-rate 的年视图（区间），
 *     不合并成一张——时点值相加没有意义。
 */

const REPORT_NAME = {
  arrears: '欠费账龄报表',
  'collection-rate': '收缴率报表',
  'dept-target': '部门达标率报表'
}
/** 时点型：期次只定位「看哪一天」；其余为期间型 */
const POINT_REPORTS = new Set(['arrears'])
const FORMULA_VERSION = 'v1.0'
const AGING_BUCKETS = ['未到期', '0-30天', '31-90天', '91-180天', '180天以上']
const TEAM_POST = { T1: '客服', T2: '工程', T3: '安保', T4: '环境' }
const POST_WEIGHT = {
  客服: { pass: 0.7, done: 0.3 }, 工程: { pass: 0.8, done: 0.2 },
  安保: { pass: 0.6, done: 0.4 }, 环境: { pass: 0.7, done: 0.3 }
}
const COMM_NAME = new Map(communities.map(c => [c.communityId, c.name]))
const communityNameOf = id => COMM_NAME.get(id) || id
const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
const r1 = n => Math.round((Number(n) || 0) * 10) / 10
const pad2 = n => String(n).padStart(2, '0')
/** 真日历校验：'2026-13-40' 光靠正则能过，但它不是日期 */
const isDateStr = s => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
const monthEndOf = ym => {
  const [y, m] = String(ym).split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}
const CURRENT_YEAR = DATA_DATE.slice(0, 4)

/** 楼栋名：从房屋全名里取「N栋」（fixtures 没有单独的楼栋表） */
const buildingNameCache = new Map()
function buildingNameOf(buildingId) {
  if (buildingNameCache.has(buildingId)) return buildingNameCache.get(buildingId)
  const h = houses.find(x => x.buildingId === buildingId)
  const m = String(h?.fullName || '').match(/(\d+栋)/)
  const name = m ? m[1] : buildingId
  buildingNameCache.set(buildingId, name)
  return name
}

function agingOf(dueDate, statDate) {
  if (!dueDate) return '未到期'
  const d = daysBetween(dueDate, statDate)
  if (d <= 0) return '未到期'
  if (d <= 30) return '0-30天'
  if (d <= 90) return '31-90天'
  if (d <= 180) return '91-180天'
  return '180天以上'
}

/** 欠费账龄：楼栋 × 账龄分档。作废账单不进表，未到期单列一档（时点型） */
function buildArrears(statDate) {
  const m = new Map()
  for (const b of bills) {
    const h = HOUSE.get(b.houseId)
    if (!h) continue                                   /* 车位账单没有楼栋，不进本表 */
    if (String(b.createTime || '').slice(0, 10) > statDate) continue
    if (b.status === '已作废') continue
    if ((b.unpaid || 0) <= 0) continue
    const aging = agingOf(b.dueDate, statDate)
    const key = `${h.buildingId}|${aging}`
    const cur = m.get(key) || {
      communityId: h.communityId, communityName: communityNameOf(h.communityId),
      buildingId: h.buildingId, buildingName: buildingNameOf(h.buildingId), aging,
      billCount: 0, houseCount: 0, ownerCount: 0, payable: 0, unpaid: 0,
      overdueSum: 0, overdueBase: 0, items: new Map()
    }
    const hSet = cur._houses || (cur._houses = new Set())
    const oSet = cur._owners || (cur._owners = new Set())
    hSet.add(h.houseId)
    if (b.ownerId) oSet.add(b.ownerId)
    cur.billCount++
    cur.payable = r2(cur.payable + (b.payable || 0))
    cur.unpaid = r2(cur.unpaid + (b.unpaid || 0))
    if (aging !== '未到期') {
      cur.overdueSum += daysBetween(b.dueDate, statDate)
      cur.overdueBase++
    }
    cur.items.set(b.itemName, r2((cur.items.get(b.itemName) || 0) + (b.unpaid || 0)))
    m.set(key, cur)
  }
  /* 账龄从最老排到最新：催缴先看欠得最久的，未到期放最后（那部分还不是欠费）。
     顺序必须和原型 api.js 一致，否则同一张表两边首屏不一样，看着像数据错了。 */
  const order = Object.fromEntries([...AGING_BUCKETS].reverse().map((k, i) => [k, i]))
  return [...m.values()].map(c => {
    const { _houses, _owners, items, overdueSum, overdueBase, ...row } = c
    const top = [...items.entries()].sort((a, b) => b[1] - a[1])[0]
    return {
      ...row,
      houseCount: _houses.size,
      ownerCount: _owners.size,
      avgOverdueDays: overdueBase ? r1(overdueSum / overdueBase) : 0,
      topItem: top ? top[0] : ''
    }
  }).sort((a, b) => (order[a.aging] - order[b.aging]) || (b.unpaid - a.unpaid))
}

/** 收缴率：账期 × 科目。作废与减免不进分母（减免是公司决策，不是业主欠费） */
function buildCollection(statDate) {
  const m = new Map()
  for (const b of bills) {
    if (String(b.createTime || '').slice(0, 10) > statDate) continue
    const key = `${b.communityId}|${b.period}|${b.itemId}`
    const cur = m.get(key) || {
      communityId: b.communityId, communityName: communityNameOf(b.communityId),
      period: b.period, itemId: b.itemId, itemName: b.itemName,
      billCount: 0, payable: 0, paid: 0, unpaid: 0, reduction: 0, voided: 0
    }
    cur.billCount++
    cur.paid = r2(cur.paid + (b.paidAmount || 0))
    if (b.status === '已作废') {
      cur.voided = r2(cur.voided + (b.payable || 0))
    } else if (b.status === '已减免') {
      cur.reduction = r2(cur.reduction + Math.max(0, (b.payable || 0) - (b.paidAmount || 0)))
    } else {
      cur.payable = r2(cur.payable + (b.payable || 0))
      cur.unpaid = r2(cur.unpaid + (b.unpaid || 0))
    }
    m.set(key, cur)
  }
  return [...m.values()]
    .map(x => ({ ...x, rate: x.payable > 0 ? r2((x.paid / x.payable) * 100) : null }))
    .sort((a, b) => String(b.period).localeCompare(String(a.period)) || (b.payable - a.payable))
}

/** 部门达标率：部门 × 周期。完成率/合格率只算执行任务，问题数只算监督任务 */
function buildDeptTarget(statDate) {
  const m = new Map()
  const bump = (orgId, period, communityId) => {
    const key = `${orgId}|${period}`
    const cur = m.get(key) || {
      orgId, period, communityId, communityName: communityNameOf(communityId),
      deptName: '', post: '', planned: 0, finished: 0, itemTotal: 0, itemOk: 0,
      selfIssues: 0, crossIssues: 0
    }
    m.set(key, cur)
    return cur
  }
  for (const t of inspectTasks) {
    if (String(t.scheduledDate || '') > statDate) continue
    const period = String(t.scheduledDate).slice(0, 7)
    if (t.taskType === '监督') {
      const target = t.targetDept || t.executorOrgId
      if (!target) continue
      bump(target, period, t.communityId).selfIssues += (t.issueCount || 0)
      continue
    }
    const orgId = t.executorOrgId
    if (!orgId) continue
    const cur = bump(orgId, period, t.communityId)
    cur.planned++
    if (['已完成', '已转工单'].includes(t.status)) {
      cur.finished++
      cur.itemTotal += (t.itemCount || 0)
      cur.itemOk += (t.normalCount || 0)
    }
  }
  return [...m.values()]
    /* 只有监督任务、没有执行任务的班子不进表：没有交付数据就等于没得评，
       硬列出来会算成 0 分 0 达标率，空部门平白被判不合格（原型里同样处理） */
    .filter(c => c.planned > 0)
    .map(c => deptRowOf(c))
    .sort((a, b) => String(b.period).localeCompare(String(a.period)) || (b.weighted - a.weighted))
}

/** 一行部门指标的派生（日/月/年三种粒度共用，避免三个地方各写一遍公式） */
function deptRowOf(c) {
  const post = TEAM_POST[String(c.orgId).split('-')[2]] || ''
  const w = POST_WEIGHT[post] || { pass: 0.7, done: 0.3 }
  const doneRate = c.planned ? c.finished / c.planned : 0
  const passRate = c.itemTotal ? c.itemOk / c.itemTotal : 0
  const weighted = passRate * w.pass + doneRate * w.done
  const score = Math.max(0, r1(weighted * 100 - c.selfIssues * 2 * 0.5 - c.crossIssues * 2 * 1.5))
  const grade = score >= 90 ? '优秀' : score >= 80 ? '良好' : score >= 70 ? '合格' : '不合格'
  return {
    ...c,
    deptName: `${post}班`,
    post,
    doneRate: r2(doneRate * 100),
    passRate: r2(passRate * 100),
    weightPass: w.pass, weightDone: w.done,
    weighted: r2(weighted * 100),
    score, grade,
    evaluated: qualityChecks.some(q => q.sourceType === '任务评价' && q.deptId === c.orgId && q.period === c.period)
  }
}

/** 年报：把 12 个月按部门累加再算比率（**不能把 12 个月的达标率取平均**，任务量不同权重不同） */
function aggregateDeptYear(rows, year) {
  const m = new Map()
  for (const r of rows) {
    if (!String(r.period).startsWith(year)) continue
    const cur = m.get(r.orgId) || {
      orgId: r.orgId, period: year, communityId: r.communityId, communityName: r.communityName,
      planned: 0, finished: 0, itemTotal: 0, itemOk: 0, selfIssues: 0, crossIssues: 0
    }
    cur.planned += r.planned
    cur.finished += r.finished
    cur.itemTotal += r.itemTotal
    cur.itemOk += r.itemOk
    cur.selfIssues += r.selfIssues
    cur.crossIssues += r.crossIssues
    m.set(r.orgId, cur)
  }
  return [...m.values()].filter(c => c.planned > 0)
    .map(deptRowOf)
    .sort((a, b) => b.weighted - a.weighted)
}

function summarizeArrears(rows) {
  /* 合计行只做行级加总：房屋数在「楼栋 × 账龄」粒度上会重复计数（同一套房可能既有未到期又有逾期），
     所以合计里不给 houseCount——给一个错数比不给更糟。 */
  return {
    billCount: rows.reduce((s, r) => s + r.billCount, 0),
    payable: r2(rows.reduce((s, r) => s + r.payable, 0)),
    unpaid: r2(rows.reduce((s, r) => s + r.unpaid, 0)),
    overdueUnpaid: r2(rows.filter(r => r.aging !== '未到期').reduce((s, r) => s + r.unpaid, 0))
  }
}
function summarizeCollection(rows) {
  const payable = r2(rows.reduce((s, r) => s + r.payable, 0))
  const paid = r2(rows.reduce((s, r) => s + r.paid, 0))
  return {
    payable, paid,
    unpaid: r2(rows.reduce((s, r) => s + r.unpaid, 0)),
    reduction: r2(rows.reduce((s, r) => s + r.reduction, 0)),
    rate: payable > 0 ? r2((paid / payable) * 100) : null
  }
}
function summarizeDept(rows) {
  const n = rows.length
  return {
    deptCount: n,
    planned: rows.reduce((s, r) => s + r.planned, 0),
    avgWeighted: n ? r2(rows.reduce((s, r) => s + r.weighted, 0) / n) : 0,
    selfIssues: rows.reduce((s, r) => s + r.selfIssues, 0),
    crossIssues: rows.reduce((s, r) => s + r.crossIssues, 0),
    unqualified: rows.filter(r => r.grade === '不合格').length
  }
}
const BUILDERS = {
  arrears: { build: buildArrears, sum: summarizeArrears },
  'collection-rate': { build: buildCollection, sum: summarizeCollection },
  'dept-target': { build: buildDeptTarget, sum: summarizeDept }
}

/* ---------------- 期次 ---------------- */
const PERIOD_TYPE = { day: '日', month: '月', year: '年' }

/** 期末日：已结束取期末，未结束取数据集当天（并标试算） */
function periodEndOf(periodType, period) {
  if (periodType === 'day') return period
  if (periodType === 'month') return monthEndOf(period)
  return `${period}-12-31`
}
const isPeriodClosed = (periodType, period) => {
  /* 月结是**真实状态**（monthCloses 里有未反结的记录），不是常量：
     这样反结后报表自动回到试算、重结后自动转定稿，不需要另外同步一处 */
  if (periodType === 'month') return !!activeClose(period)
  if (periodType === 'year') return period < CURRENT_YEAR
  return period < DATA_DATE
}

function specOf(periodType, period, code) {
  /* 日粒度不夹取：2026-10-22 就是 10-22 那一天（历史补跑也常用未来日做试算）。
     月/年若还没结束，时点只能算到今天，并标试算。 */
  const end = periodEndOf(periodType, period)
  const statDate = periodType === 'day' ? period : (end > DATA_DATE ? DATA_DATE : end)
  return {
    code, periodType, period,
    statDate,
    /* 试算只对月/年有意义：日快照本身就是「那天当时」的数，标试算只会让页头一直挂个黄标 */
    provisional: periodType === 'day' ? false : !isPeriodClosed(periodType, period)
  }
}

/** 按粒度构建行：时点型三种粒度都是「取那一天」，期间型按月/年筛行或聚合 */
function buildByPeriod(code, spec) {
  const rows = BUILDERS[code].build(spec.statDate)
  if (spec.periodType === 'day' || POINT_REPORTS.has(code)) return rows
  if (spec.periodType === 'month') return rows.filter(r => r.period === spec.period)
  if (code === 'collection-rate') return rows.filter(r => String(r.period).startsWith(spec.period))
  return aggregateDeptYear(rows, spec.period)
}

const snapshots = new Map()       /* batchNo → { meta, rows, summary } */
const recalcTasks = []            /* 重算任务 */

function createSnapshot(code, spec, { status = '成功', message = '' } = {}) {
  const { periodType, period, statDate } = spec
  /* 序号按**同粒度同期次**递增：日 RPT-20261021-01 / 月 RPT-202610-M01 / 年 RPT-2026-Y01 */
  const seq = [...snapshots.values()]
    .filter(s => s.meta.periodType === periodType && s.meta.period === period).length + 1
  const batchNo = periodType === 'day'
    ? `RPT-${statDate.replace(/-/g, '')}-${pad2(seq)}`
    : periodType === 'month'
      ? `RPT-${period.replace(/-/g, '')}-M${pad2(seq)}`
      : `RPT-${period}-Y${pad2(seq)}`
  const rows = status === '成功' ? buildByPeriod(code, spec) : []
  const meta = {
    reportCode: code, reportName: REPORT_NAME[code],
    /* 内部存 day/month/year，序列化给前端时才翻成 日/月/年（metaOut）——
       内部混两套写法必然出「找不到批次」这类错，踩过一次 */
    periodType, period, statDate,
    provisional: spec.provisional,
    batchNo,
    calcAt: `${DATA_DATE} 02:${pad2(10 + seq * 3)}`,
    dataCutoff: `${statDate} 23:59`,
    durationMs: 900 + seq * 137,
    formulaVersion: FORMULA_VERSION,
    rowCount: rows.length,
    partial: false,
    stale: false,
    status,
    ...(message ? { message } : {})
  }
  const snap = { meta, rows, summary: status === '成功' ? BUILDERS[code].sum(rows) : {} }
  snapshots.set(batchNo, snap)
  return snap
}

/** 启动时补历史批次：日 3 天 / 月 3 期（含 1 期试算）/ 年 1 期（试算） */
for (const statDate of ['2026-10-19', '2026-10-20', '2026-10-21']) {
  for (const code of Object.keys(REPORT_NAME)) createSnapshot(code, specOf('day', statDate, code))
}
for (const ym of ['2026-08', '2026-09', '2026-10']) {
  for (const code of Object.keys(REPORT_NAME)) createSnapshot(code, specOf('month', ym, code))
}
for (const code of Object.keys(REPORT_NAME)) createSnapshot(code, specOf('year', '2026', code))
createSnapshot('dept-target', specOf('day', '2026-10-20', 'dept-target'),
  { status: '失败', message: '源数据缺失：P03 巡检明细为空，本批次作废' })
/* 两条 90 天前的日批次（7 月未月结）：保留策略与清理任务的验证材料 */
for (const d of ['2026-07-15', '2026-07-16']) {
  for (const code of Object.keys(REPORT_NAME)) createSnapshot(code, specOf('day', d, code))
}

/* 全部成功批次（含被反结作废的）：作废不删除，审计要能查到「当时出过什么数」 */
const allSnaps = code => [...snapshots.values()]
  .filter(s => s.meta.status === '成功' && (!code || s.meta.reportCode === code))
  .sort((a, b) => String(b.meta.statDate).localeCompare(String(a.meta.statDate))
    || String(b.meta.batchNo).localeCompare(String(a.meta.batchNo)))
/* 「成功批次」= 排除已作废。latest 与环比取数都走这里，否则反结后还会拿到作废批次 */
const successSnaps = code => allSnaps(code).filter(s => !s.meta.voided)
const PT_RAW = { 日: 'day', 月: 'month', 年: 'year' }
const rawOf = t => PT_RAW[t] || t
const latestSuccess = (code, periodType = 'day') => successSnaps(code)
  .find(s => s.meta.periodType === rawOf(periodType)) || null
const findSnapshot = (code, periodType, period) => {
  const hit = allSnaps(code).filter(s => s.meta.periodType === rawOf(periodType) && s.meta.period === period)
  /* 反结后该期次只剩作废批次：仍然可读（历史要能翻），但 meta.voided=true 让页面标「已作废」 */
  return hit.find(s => !s.meta.voided) || hit[0] || null
}

/** 环比 / 同比：只给期间型（余额的「环比」是另一个概念，不塞进同一张表） */
function compareOf(code, spec) {
  if (POINT_REPORTS.has(code) || spec.periodType === 'day') return null
  const back = (periodType, period) => {
    const s = findSnapshot(code, periodType, period)
    if (!s) return null
    const sum = s.summary || {}
    return { period, value: code === 'collection-rate' ? sum.rate : sum.avgWeighted }
  }
  const [y, m] = spec.periodType === 'month' ? spec.period.split('-') : [spec.period, '']
  /* m 是 1 基月份，上个月的月索引是 m-2（写成 m-1 会算回本月，踩过） */
  const prev = spec.periodType === 'month'
    ? back('month', new Date(Date.UTC(+y, +m - 2, 1)).toISOString().slice(0, 7))
    : back('year', String(Number(y) - 1))
  const yoy = spec.periodType === 'month' ? back('month', `${Number(y) - 1}-${m}`) : null
  return { prevPeriod: prev?.period || '', prevValue: prev?.value ?? null, yoyPeriod: yoy?.period || '', yoyValue: yoy?.value ?? null }
}

/* 失败批次没有 summary：主指标给 null 而不是 0——0 会被读成"这一期收缴率为 0" */
const mainMetricOf = (code, summary = {}) => {
  const v = code === 'collection-rate' ? summary.rate : (code === 'dept-target' ? summary.avgWeighted : summary.unpaid)
  return v === undefined ? null : v
}

const metaOut = snap => {
  const raw = snap.meta.periodType                 /* 内部值 day/month/year，对外输出中文 */
  const latest = latestSuccess(snap.meta.reportCode, raw)
  const behind = latest ? daysBetween(snap.meta.statDate, latest.meta.statDate) : 0
  const cmp = compareOf(snap.meta.reportCode, { periodType: raw, period: snap.meta.period })
  return {
    ...snap.meta,
    periodType: PERIOD_TYPE[raw] || raw,
    /* provisional **实时**按「该期是否已月结」算，不能用建批次时存下的值：
       反结后旧批次仍是那份冻结的数，但它已经不是定稿了——状态属于期间，不属于批次 */
    provisional: raw === 'day' ? false : !isPeriodClosed(raw, snap.meta.period),
    periodValue: mainMetricOf(snap.meta.reportCode, snap.summary),
    stale: behind > 1,
    ...(cmp ? { compare: cmp } : {})
  }
}
const noSnapshot = () => {
  const e = new ApiError(404, 40402, '该期次没有成功批次，请先重算')
  return e
}

/** 参数 → 期次。statDate / month / year 三选一；期间型用 periodType + period */
function periodKeyOf(code, q) {
  const given = [q.statDate && 'statDate', q.month && 'month', q.year && 'year'].filter(Boolean)
  if (given.length > 1) throw bad('statDate / month / year 只能给一个')
  if (q.statDate) {
    if (!isDateStr(q.statDate)) throw bad('statDate 必须是有效日期，格式 YYYY-MM-DD')
    return { periodType: 'day', period: q.statDate }
  }
  if (q.month) {
    if (!/^\d{4}-\d{2}$/.test(q.month) || Number(q.month.slice(5)) > 12) throw bad('month 格式应为 YYYY-MM')
    return { periodType: 'month', period: q.month }
  }
  if (q.year) {
    if (!/^\d{4}$/.test(String(q.year))) throw bad('year 格式应为 YYYY')
    return { periodType: 'year', period: String(q.year) }
  }
  if (q.period) {
    /* 前端传中文（日/月/年），内部用 day/month/year，统一在这里翻一次 */
    const type = q.periodType ? rawOf(q.periodType) : (String(q.period).length === 4 ? 'year' : 'month')
    if (!PERIOD_TYPE[type]) throw bad('periodType 只能是 日 / 月 / 年')
    return { periodType: type, period: q.period }
  }
  if (q.periodType && rawOf(q.periodType) !== 'day') throw bad('给了 periodType 就必须给 period')
  const latest = latestSuccess(code, 'day')
  if (!latest) throw noSnapshot()
  return { periodType: 'day', period: latest.meta.statDate }
}

/** 行级范围裁剪：批次是全局算的，越权在读取时按行过滤（不是返回空表，社区参数越权另行 403） */
function inScopeReportRow(u, row) {
  const s = scope(u)
  if (s.all) return true
  if (!s.communities.has(row.communityId)) return false
  if (!s.houses) return true
  if (row.buildingId) {
    return houses.some(h => h.buildingId === row.buildingId && s.houses.has(h.houseId))
  }
  return true
}

on('GET', '/reports/snapshots', (ctx) => {
  const q = ctx.query
  const limit = q.limit === undefined ? 20 : Number(q.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw bad('limit 必须在 1..100 之间')
  if (q.reportCode && !REPORT_NAME[q.reportCode]) throw bad(`reportCode 非法：${q.reportCode}`)
  if (q.periodType && !PERIOD_TYPE[rawOf(q.periodType)]) throw bad('periodType 只能是 日 / 月 / 年')
  const list = [...snapshots.values()]
    .filter(s => !q.reportCode || s.meta.reportCode === q.reportCode)
    .filter(s => !q.status || s.meta.status === q.status)
    .filter(s => !q.periodType || s.meta.periodType === rawOf(q.periodType))
    .map(s => ({ ...metaOut(s), status: s.meta.status, ...(s.meta.message ? { message: s.meta.message } : {}) }))
    .sort((a, b) => String(b.statDate).localeCompare(String(a.statDate))
      || String(b.batchNo).localeCompare(String(a.batchNo)))
    .slice(0, limit)
  const latest = latestSuccess(q.reportCode, q.periodType ? rawOf(q.periodType) : 'day')
  return { rows: list, latest: latest ? { ...metaOut(latest), status: latest.meta.status } : null }
})

on('GET', '/reports/arrears', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const q = ctx.query
  const key = periodKeyOf('arrears', q)
  const snap = findSnapshot('arrears', key.periodType, key.period)
  if (!snap) throw noSnapshot()
  const rows = snap.rows
    .filter(r => inScopeReportRow(ctx.user, r))
    .filter(r => eq(r.communityId, q.communityId))
    .filter(r => eq(r.buildingId, q.buildingId))
    .filter(r => !q.aging || r.aging === q.aging)
    .filter(r => kwHit([r.buildingName], q.kw))
  return { ...page(rows, q), meta: metaOut(snap), summary: summarizeArrears(rows) }
})

on('GET', '/reports/collection-rate', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const q = ctx.query
  const key = periodKeyOf('collection-rate', q)
  const snap = findSnapshot('collection-rate', key.periodType, key.period)
  if (!snap) throw noSnapshot()
  const rows = snap.rows
    .filter(r => inScopeReportRow(ctx.user, r))
    .filter(r => eq(r.communityId, q.communityId))
    /* 行级筛选用 billPeriod（账期），与报表期次 period 区分开，别混成一个参数 */
    .filter(r => eq(r.period, q.billPeriod))
    .filter(r => eq(r.itemId, q.itemId))
  return { ...page(rows, q), meta: metaOut(snap), summary: summarizeCollection(rows) }
})

on('GET', '/reports/dept-target', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const q = ctx.query
  const key = periodKeyOf('dept-target', q)
  const snap = findSnapshot('dept-target', key.periodType, key.period)
  if (!snap) throw noSnapshot()
  const rows = snap.rows
    .filter(r => inScopeReportRow(ctx.user, r))
    .filter(r => eq(r.communityId, q.communityId))
    .filter(r => eq(r.post, q.post))
    .filter(r => eq(r.period, q.billPeriod))
  return { ...page(rows, q), meta: metaOut(snap), summary: summarizeDept(rows) }
})

const taskOut = j => ({
  taskId: j.taskId, reportCode: j.reportCode,
  periodType: PERIOD_TYPE[j.periodType] || j.periodType, period: j.period, statDate: j.statDate,
  status: j.status, progress: j.progress,
  startedAt: j.startedAt, finishedAt: j.finishedAt || '',
  batchNo: j.batchNo || '', rowCount: j.rowCount || 0,
  message: j.message || '', reused: !!j.reused
})

on('POST', '/reports/recalc', (ctx) => {
  const { reportCode, statDate, period, note } = ctx.body || {}
  const periodType = rawOf(ctx.body?.periodType || 'day')
  if (!REPORT_NAME[reportCode]) throw bad(`reportCode 非法：${reportCode}`)
  if (!PERIOD_TYPE[periodType]) throw bad('periodType 只能是 日 / 月 / 年')
  const p = period || statDate
  if (periodType === 'day' && !isDateStr(p)) throw bad('按日重算必须给有效 statDate（YYYY-MM-DD）')
  if (periodType === 'month' && !/^\d{4}-\d{2}$/.test(String(p || ''))) throw bad('按月重算必须给 period（YYYY-MM）')
  if (periodType === 'year' && !/^\d{4}$/.test(String(p || ''))) throw bad('按年重算必须给 period（YYYY）')

  const running = recalcTasks.find(j =>
    j.reportCode === reportCode && j.periodType === periodType && j.period === p && j.status === '运行中')
  if (running) { ctx.status = 200; return taskOut({ ...running, reused: true }) }  /* 幂等：不新建批次 */

  const seq = recalcTasks.length + 1
  const job = {
    taskId: `RCL-${DATA_DATE.replace(/-/g, '')}-${pad2(seq)}`,
    reportCode, periodType, period: p,
    statDate: periodType === 'day' ? p : (periodEndOf(periodType, p) > DATA_DATE ? DATA_DATE : periodEndOf(periodType, p)),
    status: '运行中', progress: 0,
    startedAt: `${DATA_DATE} 09:${pad2(10 + seq)}`,
    polls: 0, note: note || ''
  }
  recalcTasks.unshift(job)
  ctx.status = 202
  return taskOut({ ...job, reused: false })
})

on('GET', '/reports/recalc/{taskId}', (ctx) => {
  const j = recalcTasks.find(x => x.taskId === ctx.params.taskId)
  if (!j) throw notFound('重算任务不存在')
  if (j.status === '运行中') {
    j.polls++
    if (j.polls < 2) { j.progress = 60 }           /* 第一次轮询：还在跑 */
    else {
      const spec = specOf(j.periodType, j.period, j.reportCode)
      const snap = createSnapshot(j.reportCode, spec, { message: j.note })
      j.status = '成功'
      j.progress = 100
      j.batchNo = snap.meta.batchNo
      j.rowCount = snap.meta.rowCount
      j.finishedAt = `${DATA_DATE} 09:2${j.polls}`
    }
  }
  return taskOut(j)
})

/* ================= 批次保留与清理 =================
 * 日快照一天 3 张表，一年 1000+ 批次——不设保留策略，下拉框和索引都会被拖垮；
 * 但也不能随便删：
 *   - 日 90 天 / 月 24 期 / **年永久**（年报是最小粒度的历史凭证，删了等于抹账）；
 *   - **已月结期间的批次一律受保护**：审计要能回答「那个月报表当时长什么样」，
 *     而月结正是"当时"被确认的时间点。受保护的数量单独计数（protectedClosed），
 *     不许混进 expired——混进去会表现成"怎么清都清不干净"。
 */

const DEFAULT_KEEP_DAYS = 90
const DEFAULT_KEEP_MONTHS = 24

const posInt = (v, dft) => {
  if (v === undefined || v === null || v === '') return dft
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw bad('保留参数必须是正整数')
  return n
}

/** 该批次所属期间是否已月结（受保护） */
function isProtectedSnap(snap) {
  const raw = snap.meta.periodType
  if (raw === 'year') return true                                  /* 年报永久保留 */
  if (raw === 'month') return !!activeClose(snap.meta.period)
  return !!activeClose(monthOf(snap.meta.statDate))                /* 日报按其所在月判断 */
}

/** 过期判定：日按天数、月按期数排名、年永不过期 */
function isExpiredSnap(snap, keepDays, keepMonths, monthRank) {
  const raw = snap.meta.periodType
  if (raw === 'year') return false
  if (raw === 'month') {
    const idx = monthRank.indexOf(snap.meta.period)
    return idx >= keepMonths
  }
  return daysBetween(snap.meta.statDate, DATA_DATE) > keepDays
}

/** 按月期次从新到旧排名（SQL 里就是 ROW_NUMBER() OVER (ORDER BY period DESC)） */
function monthRankOf() {
  return [...new Set([...snapshots.values()]
    .filter(s => s.meta.periodType === 'month')
    .map(s => s.meta.period))].sort().reverse()
}

function retentionOf(keepDays, keepMonths) {
  const monthRank = monthRankOf()
  const all = [...snapshots.values()].filter(s => s.meta.status === '成功')
  const byType = ['day', 'month', 'year'].map(raw => {
    const list = all.filter(s => s.meta.periodType === raw)
    const periods = list.map(s => (raw === 'day' ? s.meta.statDate : s.meta.period)).sort()
    const expiredList = list.filter(s => isExpiredSnap(s, keepDays, keepMonths, monthRank))
    return {
      periodType: PERIOD_TYPE[raw],
      keep: raw === 'day' ? `${keepDays} 天` : (raw === 'month' ? `${keepMonths} 期` : '永久'),
      total: list.length,
      oldest: periods[0] || '',
      newest: periods[periods.length - 1] || '',
      expired: expiredList.filter(s => !isProtectedSnap(s)).length,
      protectedClosed: expiredList.filter(s => isProtectedSnap(s)).length
    }
  })
  return { keepDays, keepMonths, byType }
}

on('GET', '/reports/retention', (ctx) => {
  const keepDays = posInt(ctx.query.keepDays, DEFAULT_KEEP_DAYS)
  const keepMonths = posInt(ctx.query.keepMonths, DEFAULT_KEEP_MONTHS)
  return retentionOf(keepDays, keepMonths)
})

on('POST', '/reports/purge', (ctx) => {
  const body = ctx.body || {}
  const keepDays = posInt(body.keepDays, DEFAULT_KEEP_DAYS)
  const keepMonths = posInt(body.keepMonths, DEFAULT_KEEP_MONTHS)
  const dryRun = body.dryRun === true
  const monthRank = monthRankOf()
  const all = [...snapshots.values()].filter(s => s.meta.status === '成功')
  const expired = all.filter(s => isExpiredSnap(s, keepDays, keepMonths, monthRank))
  const removable = expired.filter(s => !isProtectedSnap(s))
  const keptProtected = expired.length - removable.length
  if (!dryRun) for (const s of removable) snapshots.delete(s.meta.batchNo)
  return {
    removed: removable.length,
    keptProtected,
    dryRun,
    batches: removable.slice(0, 50).map(s => s.meta.batchNo)
  }
})

/* ================= 合同台账 =================
 * 两条口径写在这里：
 *  ① **合同变更是独立单据**：改金额/期限/提前终止都不直接改合同，而是生成 ContractChange
 *     进审批，审批通过才回写。直接改合同的话——谁在什么时候把 30 万改成 50 万，永远查不出来。
 *  ② **即将到期是派生态**：30 天内到期且未终止，不存在"人工标成即将到期"。
 *     人工标的后果是续签提醒变成玄学。
 */

const CONTRACT_OF = new Map(contracts.map(c => [c.contractId, c]))
const contractChanges = []          /* 变更单（内存态，新建的都进这里） */
/* 与原型 api.js 的 CONTRACT_VF 必须逐条一致——两边各写一套，首屏数字就不一样了。
   `expiring` 用**状态**不用天数：样例里「即将到期」是按 90 天标的（62 天的也在里面），
   用 30 天会在联调时和原型差 6 条，而没人说得清谁对。 */
const CONTRACT_VF = {
  pending: c => ['待审批', '待生效'].includes(c.status),
  expiring: c => c.status === '即将到期',
  expired: c => c.status === '已到期',
  big: c => c.amount >= 300000,
  group: c => !c.communityId,
  changePending: c => !!c.changePending
}

const restDaysOf = endDate => daysBetween(DATA_DATE, String(endDate).slice(0, 10))

/** 合同对外的行：电话一律掩码（相对方是个人时就是个人信息），社区名服务端带出 */
const contractRow = c => ({
  ...c,
  communityName: c.communityId ? communityNameOf(c.communityId) : '集团层面',
  phone: maskPhone(c.phone),
  restDays: restDaysOf(c.endDate),
  changePending: !!c.changePending || contractChanges.some(x => x.contractId === c.contractId && x.status === '待审批')
})

function contractFilter(u, q) {
  const vf = CONTRACT_VF[q.vf] || null
  return contracts
    .map(contractRow)
    .filter(c => inScopeCommunity(u, c.communityId))
    .filter(c => eq(c.type, q.type) && eq(c.subtype, q.subtype)
      && eq(c.communityId, q.communityId) && eq(c.status, q.status))
    .filter(c => !vf || vf(c))
    .filter(c => kwHit([c.contractNo, c.name, c.partyB, c.contact, c.owner, c.subtype], q.kw))
}

on('GET', '/contracts', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  return page(contractFilter(ctx.user, ctx.query), ctx.query)
})

/* summary 必须在 /contracts/{contractId} 之前 */
on('GET', '/contracts/summary', (ctx) => {
  const rows = contractFilter(ctx.user, ctx.query)
  return {
    total: rows.length,
    amount: r2(rows.reduce((s, c) => s + (c.amount || 0), 0)),
    running: rows.filter(c => c.status === '履行中').length,
    expiring: rows.filter(CONTRACT_VF.expiring).length,
    expired: rows.filter(c => c.status === '已到期').length,
    pending: rows.filter(CONTRACT_VF.pending).length
  }
})

on('GET', '/contracts/{contractId}', (ctx) => {
  const c = CONTRACT_OF.get(ctx.params.contractId)
  if (!c) throw notFound('合同不存在')
  if (!inScopeCommunity(ctx.user, c.communityId)) throw forbidden('该合同不在你的数据范围内')
  const row = contractRow(c)
  /* 关联对象按 refType 带出；查不到给 null——详情页不该因为一个断链 500 */
  let ref = null
  if (c.refType === 'house') ref = HOUSE.get(c.refId) || null
  else if (c.refType === 'employee') ref = employees.find(e => e.empId === c.refId) || null
  return {
    contract: row,
    ref,
    changes: contractChanges.filter(x => x.contractId === c.contractId)
  }
})

on('POST', '/contracts', (ctx) => {
  const b = ctx.body || {}
  const need = ['name', 'type', 'partyB', 'amount', 'startDate', 'endDate']
  const miss = need.filter(k => b[k] === undefined || b[k] === '' || b[k] === null)
  if (miss.length) throw invalid(`缺少必填字段：${miss.join('、')}`)
  if (String(b.endDate) <= String(b.startDate)) throw invalid('结束日期必须晚于开始日期')
  if (!(Number(b.amount) > 0)) throw invalid('合同金额必须大于 0')
  const seq = contracts.length + 1
  const rec = {
    contractId: 'CT' + String(9000 + seq).slice(1),
    /* 单号服务端生成：前端传了也忽略——两个人同时新建会拿到同一个号 */
    contractNo: `HT-${DATA_DATE.slice(0, 4)}-${String(seq).padStart(4, '0')}`,
    name: b.name, type: b.type, subtype: b.subtype || '',
    communityId: b.communityId || '', orgId: b.orgId || '',
    partyB: b.partyB, contact: b.contact || '', phone: b.phone || '',
    amount: r2(Number(b.amount)), payCycle: b.payCycle || '月付',
    signDate: b.signDate || DATA_DATE, startDate: b.startDate, endDate: b.endDate,
    status: '待审批', owner: ctx.user.name, ownerEmpId: ctx.user.empId || '',
    attachments: 0, remark: b.remark || '',
    /* refType 是枚举（house/parking/employee），没有关联对象就**不带这个字段**，
       不要给空串——空串是"非法枚举值"，schema 会拦，前端也不好判 */
    ...(b.refType ? { refType: b.refType, refId: b.refId || '' } : {})
  }
  contracts.unshift(rec)
  CONTRACT_OF.set(rec.contractId, rec)
  ctx.status = 201
  return contractRow(rec)
})

/* 附件元数据：真实系统在对象存储里，这里按 contracts.attachments 的份数生成确定性样例 */
const contractFilesOf = c => Array.from({ length: Math.max(0, c.attachments || 0) }, (_, i) => ({
  fileId: `${c.contractId}-F${i + 1}`,
  name: `${c.name}_扫描件${i + 1}.pdf`,
  size: 240_000 + i * 38_000,
  mime: 'application/pdf',
  uploadedAt: `${c.signDate || DATA_DATE} 10:${String(12 + i).padStart(2, '0')}`,
  uploader: c.owner || '系统'
}))

on('GET', '/contracts/{contractId}/attachments', (ctx) => {
  const c = CONTRACT_OF.get(ctx.params.contractId)
  if (!c) throw notFound('合同不存在')
  if (!inScopeCommunity(ctx.user, c.communityId)) throw forbidden('该合同不在你的数据范围内')
  return { rows: contractFilesOf(c) }
})

let _DL_SEQ = 0
on('POST', '/contracts/{contractId}/attachments/{fileId}/download', (ctx) => {
  const c = CONTRACT_OF.get(ctx.params.contractId)
  if (!c) throw notFound('合同不存在')
  if (!inScopeCommunity(ctx.user, c.communityId)) throw forbidden('该合同不在你的数据范围内')
  const f = contractFilesOf(c).find(x => x.fileId === ctx.params.fileId)
  if (!f) throw notFound('附件不存在')
  _DL_SEQ++
  const logId = 'EL' + String(900000 + _DL_SEQ).padStart(6, '0')
  /* 文件外发要查得到：同一次下载写一条导出日志 */
  exportLogs.unshift({
    logId, at: nowStamp(), operator: ctx.user.name, roleName: ctx.user.roleName,
    orgName: '', scopeMode: ctx.user.dataScope || '',
    name: f.name, format: 'pdf', rows: 1, result: '成功',
    memo: `合同附件下载（${c.contractNo}）`, hash: 'dl' + _DL_SEQ, prevHash: ''
  })
  return {
    fileId: f.fileId,
    /* 临时签名链接：过期必须重新申请，缓存下来的后果是链接在群里传来传去永远有效 */
    url: `/files/contracts/${c.contractId}/${f.fileId}?sign=${logId}&expires=1200`,
    expiresAt: `${DATA_DATE} ${new Date(Date.now() + 20 * 60 * 1000).toTimeString().slice(0, 5)}`,
    size: f.size,
    accessLogId: logId
  }
})

on('POST', '/contracts/{contractId}/changes', (ctx) => {
  const c = CONTRACT_OF.get(ctx.params.contractId)
  if (!c) throw notFound('合同不存在')
  if (!inScopeCommunity(ctx.user, c.communityId)) throw forbidden('该合同不在你的数据范围内')
  const b = ctx.body || {}
  const changeType = String(b.changeType || '').trim()
  const reason = String(b.reason || '').trim()
  if (!changeType) throw invalid('请选择变更类型')
  if (reason.length < 4) throw invalid('请填写变更原因（至少 4 个字）')
  /* 终态不能再变更：已到期/已终止的合同要动，只能新签一份 */
  if (['已到期', '已终止'].includes(c.status)) throw invalid(`合同状态「${c.status}」，不能再发起变更`)
  /* 已有变更在审批中 → 409 而不是 422：这不是参数错，是要先去处理那一单 */
  if (contractChanges.some(x => x.contractId === c.contractId && x.status === '待审批')) {
    throw new ApiError(409, 40906, '该合同已有变更在审批中，请先处理完')
  }
  const before = { name: c.name, amount: c.amount, partyB: c.partyB, startDate: c.startDate, endDate: c.endDate }
  const after = { ...before }
  for (const [k, v] of Object.entries(b.patch || {})) {
    if (v !== undefined && v !== null && v !== '') after[k] = k === 'amount' ? r2(Number(v)) : v
  }
  if (changeType !== '提前终止' && JSON.stringify(before) === JSON.stringify(after)) {
    throw invalid('变更内容与原合同一致，无需发起审批')
  }
  const seq = contractChanges.length + 1
  const rec = {
    changeId: 'CH' + String(seq).padStart(4, '0'),
    changeNo: `BG-${DATA_DATE.slice(0, 4)}-${String(seq).padStart(3, '0')}`,
    contractId: c.contractId, contractName: c.name,
    changeType, before, after, reason,
    applicant: ctx.user.name, applyTime: `${DATA_DATE} 10:20`,
    status: '待审批', approvalId: 'AP' + String(seq).padStart(5, '0')
  }
  contractChanges.unshift(rec)
  ctx.status = 201
  return { change: rec, approval: { approvalId: rec.approvalId, status: '待审批' } }
})

/* ================= 公告通知 =================
 * 状态机单向：草稿 → 待审核 → 已发布 → 已过期；已发布可撤回，撤回后要重新提交审核。
 * 两条硬约束：
 *  ① **已发布不能改内容**——业主已经看过了，改了等于篡改留痕，要改先撤回（409/40907）；
 *  ② **已发布/已过期不能再发布**（409/40908）——重复点发布，业主会收到两条一样的推送，
 *     然后打客服问"到底停不停水"。
 */

const NOTICE_OF = new Map(notices.map(n => [n.noticeId, n]))
const NOTICE_VF = {
  pending: n => ['草稿', '待审核'].includes(n.status),
  published: n => n.status === '已发布',
  expired: n => n.status === '已过期',
  top: n => !!n.top,
  /* 阈值 60% 与原型一致；改阈值要两边一起改，否则"低阅读率"计数对不上 */
  lowRead: n => n.status === '已发布' && n.readRate < 60
}

const readRateOf = n => (n.targetHouses ? Math.round((n.readCount / n.targetHouses) * 1000) / 10 : 0)

const noticeRow = n => ({
  ...n,
  communityName: n.communityId ? communityNameOf(n.communityId) : '全部项目',
  /* 展示串由服务端拼：前端各拼一遍的结果是列表用「/」、详情用「、」 */
  channelText: (n.channels || []).join(' / '),
  readRate: readRateOf(n)
})

function noticeFilter(u, q) {
  const vf = NOTICE_VF[q.vf] || null
  return notices
    .map(noticeRow)
    .filter(n => inScopeCommunity(u, n.communityId))
    .filter(n => eq(n.type, q.type) && eq(n.communityId, q.communityId) && eq(n.status, q.status))
    .filter(n => !vf || vf(n))
    .filter(n => kwHit([n.title, n.noticeId, n.publisher, n.content], q.kw))
}

on('GET', '/notices', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  return page(noticeFilter(ctx.user, ctx.query), ctx.query)
})

on('GET', '/notices/summary', (ctx) => {
  const rows = noticeFilter(ctx.user, ctx.query)
  const pub = rows.filter(n => n.status === '已发布')
  const avg = pub.length ? Math.round((pub.reduce((s, n) => s + n.readRate, 0) / pub.length) * 10) / 10 : 0
  return {
    total: rows.length,
    published: pub.length,
    pending: rows.filter(NOTICE_VF.pending).length,
    expired: rows.filter(n => n.status === '已过期').length,
    avgReadRate: avg,
    lowRead: rows.filter(NOTICE_VF.lowRead).length
  }
})

on('GET', '/notices/{noticeId}', (ctx) => {
  const n = NOTICE_OF.get(ctx.params.noticeId)
  if (!n) throw notFound('公告不存在')
  if (!inScopeCommunity(ctx.user, n.communityId)) throw forbidden('该公告不在你的数据范围内')
  return {
    notice: noticeRow(n),
    unreached: Math.max(0, (n.targetHouses || 0) - (n.readCount || 0)),
    timeline: [
      { title: `起草 · ${n.publisher}`, memo: `${noticeRow(n).communityName} · 附件 ${n.attachments || 0} 个`, done: true },
      { title: n.auditBy ? `审核通过 · ${n.auditBy}` : '待审核', memo: n.auditTime || '尚未提交审核', done: !!n.auditBy },
      { title: `发布 · ${n.publishTime}`, memo: `${(n.channels || []).join(' / ')} · 覆盖 ${n.targetHouses} 户`, done: ['已发布', '已过期'].includes(n.status) },
      { title: `触达 ${noticeRow(n).readRate}%`, memo: `已读 ${n.readCount} 户 · 未读 ${Math.max(0, (n.targetHouses || 0) - (n.readCount || 0))} 户`, done: false }
    ]
  }
})

on('POST', '/notices', (ctx) => {
  const b = ctx.body || {}
  const title = String(b.title || '').trim()
  const content = String(b.content || '').trim()
  const channels = Array.isArray(b.channels) ? b.channels.filter(Boolean) : []
  if (title.length < 4) throw invalid('公告标题至少 4 个字')
  if (!b.type) throw invalid('请选择公告类型')
  if (content.length < 10) throw invalid('公告正文至少 10 个字')
  /* 没有渠道的公告等于没发：前台看得见、业主收不到 */
  if (!channels.length) throw invalid('至少选择一个推送渠道')
  const seq = notices.length + 1
  const rec = {
    noticeId: 'NT' + String(9000 + seq).slice(1),
    title, type: b.type, communityId: b.communityId || '',
    channels, publisher: ctx.user.name, publisherEmpId: ctx.user.empId || '',
    publishTime: '', status: '草稿',
    targetHouses: b.communityId ? (houses.filter(h => h.communityId === b.communityId).length || 0) : houses.length,
    readCount: 0, top: !!b.top, auditBy: '', auditTime: '',
    attachments: Number(b.attachments) || 0, content
  }
  notices.unshift(rec)
  NOTICE_OF.set(rec.noticeId, rec)
  ctx.status = 201
  return noticeRow(rec)
})

on('PATCH', '/notices/{noticeId}', (ctx) => {
  const n = NOTICE_OF.get(ctx.params.noticeId)
  if (!n) throw notFound('公告不存在')
  if (!inScopeCommunity(ctx.user, n.communityId)) throw forbidden('该公告不在你的数据范围内')
  /* 已发布不能改内容：业主看过了，改了等于篡改留痕 */
  if (['已发布', '已过期'].includes(n.status)) {
    throw new ApiError(409, 40907, `${n.status}的公告不能修改，请先撤回`)
  }
  const b = ctx.body || {}
  if (b.title !== undefined && String(b.title).trim().length < 4) throw invalid('公告标题至少 4 个字')
  if (b.content !== undefined && String(b.content).trim().length < 10) throw invalid('公告正文至少 10 个字')
  if (b.channels !== undefined) {
    const ch = (b.channels || []).filter(Boolean)
    if (!ch.length) throw invalid('至少选择一个推送渠道')
    n.channels = ch
  }
  for (const k of ['title', 'content', 'top']) if (b[k] !== undefined) n[k] = b[k]
  return noticeRow(n)
})

on('POST', '/notices/{noticeId}/submit-audit', (ctx) => {
  const n = NOTICE_OF.get(ctx.params.noticeId)
  if (!n) throw notFound('公告不存在')
  if (!inScopeCommunity(ctx.user, n.communityId)) throw forbidden('该公告不在你的数据范围内')
  if (!['草稿', '已撤回'].includes(n.status)) {
    throw new ApiError(409, 40914, `公告当前状态「${n.status}」，只有草稿与已撤回可以提交审核`)
  }
  if (!(n.channels || []).length) throw invalid('没有推送渠道，提交审核也没意义')
  n.status = '待审核'
  n.submitBy = ctx.user.name
  n.submitTime = nowStamp()
  return noticeRow(n)
})

on('POST', '/notices/{noticeId}/publish', (ctx) => {
  const n = NOTICE_OF.get(ctx.params.noticeId)
  if (!n) throw notFound('公告不存在')
  if (!inScopeCommunity(ctx.user, n.communityId)) throw forbidden('该公告不在你的数据范围内')
  if (['已发布', '已过期'].includes(n.status)) {
    throw new ApiError(409, 40908, `${n.status}的公告不能再发布，避免重复推送`)
  }
  /* 只发待审核的：草稿直接发等于跳过审核，谁审的那栏永远是空的 */
  if (n.status !== '待审核') {
    throw new ApiError(409, 40914, `公告当前状态「${n.status}」，需要先提交审核（POST /notices/{id}/submit-audit）`)
  }
  if (!(n.channels || []).length) throw invalid('没有推送渠道，发布出去业主也收不到')
  n.status = '已发布'
  n.publishTime = `${DATA_DATE} 16:30`
  n.auditBy = ctx.user.name
  n.auditTime = `${DATA_DATE} 16:20`
  /* 新一轮推送：上一轮的已读不算进来（撤回时不清零，因为那批人确实看过） */
  n.readCount = 0
  return noticeRow(n)
})

on('POST', '/notices/{noticeId}/repush', (ctx) => {
  const n = NOTICE_OF.get(ctx.params.noticeId)
  if (!n) throw notFound('公告不存在')
  if (!inScopeCommunity(ctx.user, n.communityId)) throw forbidden('该公告不在你的数据范围内')
  if (!['已发布', '已过期'].includes(n.status)) invalid(`公告状态「${n.status}」，不能补推`)
  const unread = Math.max(0, (n.targetHouses || 0) - (n.readCount || 0))
  /* 补推只给没看过的人：重复推给已读的人，结果是他关掉通知 */
  if (!unread) throw invalid('没有未读业主，无需补推')
  n.repushCount = (n.repushCount || 0) + unread
  n.repushAt = `${DATA_DATE} 17:00`
  return { unread, at: n.repushAt, channels: n.channels, total: n.repushCount }
})

on('POST', '/notices/{noticeId}/withdraw', (ctx) => {
  const n = NOTICE_OF.get(ctx.params.noticeId)
  if (!n) throw notFound('公告不存在')
  if (!inScopeCommunity(ctx.user, n.communityId)) throw forbidden('该公告不在你的数据范围内')
  const reason = String((ctx.body || {}).reason || '').trim()
  if (reason.length < 4) throw invalid('请填写撤回原因（至少 4 个字）')
  if (n.status !== '已发布') throw new ApiError(409, 40909, `只有已发布的公告能撤回，当前为「${n.status}」`)
  /* 撤回不删除、已读数据不清零：业主确实看过，抹掉就是伪造 */
  n.status = '已撤回'
  n.withdrawReason = reason
  n.withdrawAt = `${DATA_DATE} 16:40`
  return noticeRow(n)
})

/* ================= 员工档案（人事口径，不含薪资） =================
 * 三条刻意为之的口径，动手改之前先想清楚：
 *
 * ① **行用白名单构造，不展开 `...e`**。fixtures 里现在没有 baseSalary / bankCard，
 *    但真表一定有；写成 `...e` 的那天，任何有「员工列表」权限的人就能拿走全公司工资，
 *    而这种泄露撤回不了。
 * ② **角色不存员工表**：由岗位反推（`roles.positions`），人工调整写一层覆盖。
 *    角色存进员工表的结果是改一次岗位要手工改一遍权限，两边还会长期不一致。
 * ③ **组织归属拆成两个字段**：`homeOrgId` 是人事档案上存的（人挂到项目部），
 *    `orgId` 是岗位反推出的实际排班归属（班组 / 职能部门）。合成一个字段的话，
 *    班组调整会顺手改掉人事档案的归属，人力对不上花名册。
 */

const ORG = new Map(orgs.map(o => [o.orgId, o]))
const ROLE = new Map(roles.map(r => [r.roleId, r]))
const ROLE_OF_POS = new Map()
for (const r of roles) for (const p of r.positions || []) ROLE_OF_POS.set(p, r.roleId)
/** 权限位总数：与 seed 的 permissions 表一致（14 角色 / 72 权限位），改 seed 时要同步 */
const PERM_TOTAL = 72

const isProjectOrg = id => /^O-P\d+$/.test(id || '')
/** 岗位 → 班组（项目部）/ 职能部门（总部）。必须与原型 api.js 的 teamOf 逐条一致 */
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
const teamOf = e => isProjectOrg(e.orgId)
  ? (TEAM_BY_POS[e.position] ? `${e.orgId}-${TEAM_BY_POS[e.position]}` : '')
  : (DEPT_BY_POS[e.position] || '')

const orgPathOf = id => {
  const chain = []
  let cur = ORG.get(id)
  while (cur) { chain.unshift(cur.name); cur = cur.parentId ? ORG.get(cur.parentId) : null }
  return chain.join(' / ')
}
/** 员工所属项目：沿组织树上溯到「项目」节点，返回 P01 这类项目号；总部员工为空 */
const projOfOrg = id => {
  let cur = ORG.get(id)
  while (cur) {
    if (cur.type === '项目') return cur.orgId.replace(/^O-/, '')
    cur = cur.parentId ? ORG.get(cur.parentId) : null
  }
  return ''
}
const DESC = new Map()
function descOrgs(orgId) {
  if (!orgId) return null
  if (DESC.has(orgId)) return DESC.get(orgId)
  const out = []
  const walk = id => { out.push(id); for (const o of orgs) if (o.parentId === id) walk(o.orgId) }
  walk(orgId)
  const s = new Set(out)
  DESC.set(orgId, s)
  return s
}

/** 人工调整过的角色（优先于岗位反推）。内存态，重启还原 */
const EMP_ROLE_OVERRIDE = new Map()

/**
 * 员工 → 角色。两处例外写在这里，别在别处再算一遍：
 *  - 项目部也挂「总经理」岗位（6 人），但集团总经理只应有一位，项目部的一律按项目经理算；
 *  - **离职即收权**：离职员工的 roleId 为空。人走了权限还在，是最常见的一类越权。
 */
function roleOfEmp(e) {
  const none = { roleId: null, roleName: '未分配', source: null, permCount: 0, dataScope: null }
  if (e.status === '离职') return none
  const ov = EMP_ROLE_OVERRIDE.get(e.empId)
  if (ov && ROLE.has(ov)) {
    const r = ROLE.get(ov)
    return { roleId: r.roleId, roleName: r.name, source: 'override', permCount: r.permCount, dataScope: r.dataScope }
  }
  const pos = e.position === '总经理' && isProjectOrg(e.orgId) ? '项目经理' : e.position
  const r = ROLE.get(ROLE_OF_POS.get(pos) || '')
  return r
    ? { roleId: r.roleId, roleName: r.name, source: 'position', permCount: r.permCount, dataScope: r.dataScope }
    : none
}

/** 列表 / 详情共用的行。白名单构造——见文件块头第 ① 条 */
function empRow(e, { mask = true } = {}) {
  const orgId = teamOf(e) || e.orgId
  const role = roleOfEmp(e)
  /* 新入职 / 未签合同的员工没有 contractEnd：给 null，不给 NaN（NaN 序列化成 null 会让 schema 报类型错） */
  const daysLeft = e.contractEnd ? daysBetween(DATA_DATE, e.contractEnd) : null
  const manager = employees.find(x => x.empId !== e.empId && x.name === e.manager)
  return {
    empId: e.empId, empNo: e.empNo, name: e.name, gender: e.gender,
    phone: mask ? maskPhone(e.phone) : e.phone,
    phoneRedacted: mask,
    idCard: mask ? maskId(e.idCard) : e.idCard,
    idCardRedacted: mask,
    homeOrgId: e.orgId,
    orgId,
    orgName: (ORG.get(orgId) || {}).name || '-',
    orgPath: orgPathOf(orgId),
    teamId: teamOf(e),
    projName: isProjectOrg(e.orgId) ? ((ORG.get(e.orgId) || {}).name || '') : '总部职能',
    position: e.position, level: e.level, empType: e.empType, status: e.status,
    entryDate: e.entryDate, regularDate: e.regularDate || null,
    contractStart: e.contractStart, contractEnd: e.contractEnd,
    contractDaysLeft: daysLeft,
    contractExpired: daysLeft === null ? false : daysLeft < 0,
    contractExpiring: daysLeft !== null && daysLeft >= 0 && daysLeft <= 30 && e.status !== '离职',
    managerName: e.manager || '',
    managerEmpId: manager ? manager.empId : null,
    roleId: role.roleId, roleName: role.roleName, roleSource: role.source,
    dataScope: role.dataScope, permCount: role.permCount,
    socialSecurity: !!e.socialSecurity,
    attendance: {
      late: e.attendance?.late || 0,
      leaveDays: e.attendance?.leaveDays || 0,
      overtimeHours: e.attendance?.overtimeHours || 0
    },
    score: e.score,
    assignable: e.status !== '离职',
    _ver: verOf('emp', e.empId)
  }
}

/**
 * 员工的数据范围：按「所属项目」判定。
 * 总部职能岗没有项目，非全量范围的人一率看不到——项目经理不该翻总部人事档案。
 */
function empVisible(u, e) {
  if (u.dataScope === '全部项目') return true
  const proj = projOfOrg(e.orgId)
  if (!proj) return false
  return (u.communities || []).includes(proj)
}

const hasPerm = (u, code) => {
  const p = u.permissions || []
  return p.includes('*') || p.includes(code)
}
function requirePerm(u, code, msg) {
  if (!hasPerm(u, code)) throw forbidden(msg || `缺少权限位 ${code}`)
}

const EMP_VF = {
  onjob: r => r.status === '在职',
  probation: r => r.status === '试用',
  noRole: r => !r.roleId,
  contractExpiring: r => r.contractExpiring,
  contractExpired: r => r.contractExpired,
  /* E 域的"数据范围视图"：这三个必须服务端过滤——分页后前端只能过滤当前页 */
  selfOnly: r => r.dataScope === '仅本人',
  deptOnly: r => r.dataScope === '本部门',
  groupAll: r => r.dataScope === '全部项目'
}

/** 列表 / 汇总同源：两边各写一套谓词的结果是首屏"总计 68、列表 12" */
function empFilter(u, q = {}) {
  const ids = descOrgs(q.orgId)
  const vf = EMP_VF[q.vf] || null
  return employees
    .filter(e => empVisible(u, e))
    .filter(e => !ids || ids.has(teamOf(e) || e.orgId))
    .map(e => empRow(e))
    .filter(r => eq(r.status, q.status) && eq(r.empType, q.empType)
      && eq(r.position, q.position) && eq(r.roleId, q.roleId) && eq(r.dataScope, q.dataScope))
    .filter(r => !vf || vf(r))
    .filter(r => {
      if (!q.kw) return true
      if (kwHit([r.name, r.empNo, r.position, r.orgName, r.roleName, r.phone], q.kw)) return true
      /* 手机号在行里是掩码，按明文搜会搜不到——用原表再兜一次 */
      const raw = employees.find(x => x.empId === r.empId)
      return String((raw || {}).phone || '').includes(q.kw)
    })
    .sort((a, b) => a.empId.localeCompare(b.empId))
}

const findEmp = empId => employees.find(x => x.empId === empId)

on('GET', '/employees', (ctx) => {
  requirePerm(ctx.user, 'c.employees.view', '缺少权限位 c.employees.view：无权查看员工档案')
  return page(empFilter(ctx.user, ctx.query), ctx.query)
})

/* summary / org-tree / options 必须在 /employees/{empId} 之前注册，否则会被当成 empId */
on('POST', '/employees', (ctx) => {
  requirePerm(ctx.user, 'c.employees.edit', '缺少权限位 c.employees.edit：无权新增员工')
  const b = ctx.body || {}
  const name = String(b.name || '').trim()
  if (name.length < 2) throw invalid('姓名至少 2 个字')
  if (!b.orgId) throw invalid('请选择所属组织')
  if (!ORG.has(b.orgId)) throw notFound('组织不存在')
  if (!String(b.position || '').trim()) throw invalid('请选择岗位')
  if (b.phone && !/^1[3-9]\d{9}$/.test(String(b.phone))) throw invalid('手机号格式不正确，应为 11 位')
  if (b.phone) {
    const dup = employees.find(x => x.phone === String(b.phone))
    if (dup) throw conflictUnique(`手机号「${b.phone}」已被 ${dup.empId} 占用`)
  }
  const seq = 9000 + employees.length + 1
  const rec = {
    /* 工号服务端生成：前端传了也忽略——两个人同时新增会拿到同一个号，而工号是三方对账依据 */
    empId: 'EM' + String(seq).slice(1),
    empNo: 'P' + String(seq).slice(1),
    name, orgId: b.orgId, position: String(b.position).trim(),
    phone: String(b.phone || ''), email: String(b.email || ''),
    entryDate: b.hireDate || DATA_DATE, regularDate: null,
    status: b.status || '在职', idCard: String(b.idCard || ''),
    level: '', empType: '正式', manager: '',
    socialSecurity: true, certificates: [],
    attendance: { late: 0, leaveDays: 0, overtimeHours: 0 }, score: 0,
    baseSalary: 0, monthlySalary: 0, bankCard: ''
  }
  employees.push(rec)
  ctx.status = 201
  return empRow(rec)
})

on('GET', '/employees/summary', (ctx) => {
  requirePerm(ctx.user, 'c.employees.view', '缺少权限位 c.employees.view：无权查看员工档案')
  const rows = empFilter(ctx.user, ctx.query)
  const cnt = f => rows.filter(f).length
  return {
    total: rows.length,
    onjob: cnt(r => r.status === '在职'),
    probation: cnt(r => r.status === '试用'),
    left: cnt(r => r.status === '离职'),
    noRole: cnt(r => !r.roleId),
    contractExpiring: cnt(r => r.contractExpiring),
    contractExpired: cnt(r => r.contractExpired),
    orgCount: orgs.length,
    teamCount: orgs.filter(o => o.type === '班组').length,
    roleCount: roles.length,
    permCount: PERM_TOTAL,
    selfOnly: cnt(r => r.dataScope === '仅本人'),
    deptOnly: cnt(r => r.dataScope === '本部门'),
    groupAll: cnt(r => r.dataScope === '全部项目')
  }
})

on('GET', '/employees/org-tree', (ctx) => {
  requirePerm(ctx.user, 'c.employees.view', '缺少权限位 c.employees.view：无权查看员工档案')
  const rows = empFilter(ctx.user, {})
  const selfCount = new Map()
  for (const r of rows) selfCount.set(r.orgId, (selfCount.get(r.orgId) || 0) + 1)
  const subtree = id => { const s = descOrgs(id); return rows.filter(r => s.has(r.orgId)).length }
  const build = parentId => orgs
    .filter(o => (o.parentId || '') === parentId)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(o => {
      const kids = build(o.orgId)
      return {
        orgId: o.orgId, name: o.name, type: o.type, leader: o.leader || '',
        headcount: subtree(o.orgId), selfHeadcount: selfCount.get(o.orgId) || 0,
        children: kids.length ? kids : undefined
      }
    })
    /* 空节点不出现：项目经理点开树看到别的项目 "0 人"，会以为系统坏了 */
    .filter(n => n.headcount > 0)
  return { roots: build('O-ROOT') }
})

on('GET', '/employees/options', (ctx) => {
  /* 选人不需要看人事档案：这里只回姓名 / 岗位 / 班组，不含手机证件。
     要求 c.employees.view 的后果是——班组长排不了班，因为他没有看档案的权限。 */
  const size = Math.min(Math.max(Number(ctx.query.size) || 50, 1), 200)
  const rows = empFilter(ctx.user, {})
    .filter(r => r.assignable)
    .filter(r => !ctx.query.teamId || r.teamId === ctx.query.teamId)
    .filter(r => !ctx.query.kw || String(r.name).includes(ctx.query.kw))
    .slice(0, size)
    .map(r => ({
      empId: r.empId, name: r.name, label: `${r.name} · ${r.position}`,
      position: r.position, teamId: r.teamId, orgName: r.orgName,
      status: r.status, assignable: r.assignable
    }))
  return { rows, total: rows.length }
})

on('GET', '/employees/{empId}', (ctx) => {
  const e = findEmp(ctx.params.empId)
  if (!e) throw notFound('员工不存在')
  if (!empVisible(ctx.user, e)) throw forbidden('该员工不在你的数据范围内')
  requirePerm(ctx.user, 'c.employees.view', '缺少权限位 c.employees.view：无权查看员工档案')
  const row = empRow(e)
  const role = ROLE.get(row.roleId || '')
  return {
    employee: row,
    role: role ? {
      roleId: role.roleId, name: role.name, scope: role.scope,
      dataScope: role.dataScope, permCount: role.permCount, domains: role.domains || []
    } : {},
    org: {
      name: row.orgName, path: row.orgPath, teamId: row.teamId,
      leader: (ORG.get(row.orgId) || {}).leader || ''
    },
    contract: {
      start: row.contractStart, end: row.contractEnd,
      daysLeft: row.contractDaysLeft, expired: row.contractExpired
    },
    attendance: row.attendance,
    certificates: e.certificates || [],
    related: {
      contracts: contracts.filter(c => c.refType === 'employee' && c.refId === e.empId).length,
      /* 工资条条数属工资域。给 null 不给 0——0 会被读成"这人有工资条但没生成" */
      payrollRecords: null
    }
  }
})

const EMP_EDITABLE = [
  'position', 'level', 'empType', 'status', 'contractStart', 'contractEnd',
  'phone', 'idCard', 'socialSecurity', 'regularDate', 'score', 'certificates', 'manager'
]
/** 这些字段**明确拒绝**而不是静默忽略：静默忽略的结果是前端提示"保存成功"，实际什么都没改 */
const EMP_READONLY = {
  roleId: '角色走 PATCH /employees/{empId}/role（要留"谁把谁提成主管"的痕迹）',
  orgId: '组织调动是调岗单据（调出/调入确认 + 生效日），不是一个字段',
  homeOrgId: '同上：组织调动走调岗单据',
  empNo: '工号不可改：考勤机、工资代发、社保申报都按工号对账',
  baseSalary: '薪酬属工资域，改薪资必须走审批',
  monthlySalary: '薪酬属工资域，改薪资必须走审批',
  bankCard: '银行卡属工资域'
}

on('PATCH', '/employees/{empId}', (ctx) => {
  const e = findEmp(ctx.params.empId)
  if (!e) throw notFound('员工不存在')
  if (!empVisible(ctx.user, e)) throw forbidden('该员工不在你的数据范围内')
  requirePerm(ctx.user, 'c.employees.edit', '缺少权限位 c.employees.edit：无权修改员工档案')
  const { patch, ver, reason } = ctx.body || {}
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw bad('patch 必须是对象')
  const rejected = Object.keys(patch).filter(k => EMP_READONLY[k])
  if (rejected.length) throw invalid(`${rejected.join('、')} 不能在这里改：${EMP_READONLY[rejected[0]]}`)
  const unknown = Object.keys(patch).filter(k => !EMP_EDITABLE.includes(k))
  if (unknown.length) throw invalid(`字段 ${unknown.join('、')} 不支持修改`)
  if (ver !== undefined && Number(ver) !== verOf('emp', e.empId)) {
    throw conflictVer()
  }
  if (patch.phone !== undefined) {
    const dup = employees.find(x => x.empId !== e.empId && x.phone === String(patch.phone))
    if (dup) throw conflictUnique(`手机号「${patch.phone}」已被 ${dup.empId} 占用`)
  }
  /* 手机 / 证件一改，考勤打卡、工资代发、门禁授权全部对不上，必须留原因 */
  const sensitive = ['phone', 'idCard']
    .filter(k => patch[k] !== undefined && String(patch[k]) !== String(e[k]))
  if (sensitive.length && String(reason || '').trim().length < 4) {
    throw invalid(`修改${sensitive.map(k => (k === 'phone' ? '手机号' : '证件号')).join('、')}必须填写原因（至少 4 个字）`)
  }
  const beforeRole = roleOfEmp(e)
  const posChanged = patch.position !== undefined && patch.position !== e.position
  for (const k of EMP_EDITABLE) if (patch[k] !== undefined) e[k] = patch[k]
  /* 调岗后必须清掉上一任的覆盖角色，否则人去了工程组，系统还让他批客服的假 */
  if (posChanged) EMP_ROLE_OVERRIDE.delete(e.empId)
  bumpVer('emp', e.empId)
  const afterRole = roleOfEmp(e)
  const row = empRow(e)
  if (beforeRole.roleId !== afterRole.roleId || beforeRole.source !== afterRole.source) {
    row.roleRecalculated = {
      from: beforeRole.roleName, to: afterRole.roleName,
      reason: posChanged ? '岗位变更，已清除角色覆盖并按新岗位重算' : '状态变更，角色已按规则重算'
    }
  }
  return row
})

let ACCESS_SEQ = 0
on('POST', '/employees/{empId}/reveal', (ctx) => {
  const e = findEmp(ctx.params.empId)
  if (!e) throw notFound('员工不存在')
  if (!empVisible(ctx.user, e)) throw forbidden('该员工不在你的数据范围内')
  /* 双权限：a.sensitive.view 是「能看个人敏感信息」的能力位，但它落不到对象上——
     只看能力位的话，能看业主手机的人顺带就能批量导出员工身份证。 */
  requirePerm(ctx.user, 'c.employees.view', '缺少权限位 c.employees.view：无权查看员工档案')
  requirePerm(ctx.user, 'a.sensitive.view', '缺少权限位 a.sensitive.view：员工手机 / 证件属个人敏感信息')
  const { fields, reason } = ctx.body || {}
  if (!Array.isArray(fields) || !fields.length) throw bad('fields 至少一项（phone / idCard）')
  const LABEL = { phone: '手机号', idCard: '证件号' }
  const illegal = fields.filter(f => !LABEL[f])
  if (illegal.length) throw invalid(`不支持揭示 ${illegal.join('、')}，只支持 phone / idCard`)
  const why = String(reason || '').trim()
  if (why.length < 4) throw invalid('请填写揭示原因（至少 4 个字）')
  return {
    empId: e.empId,
    fields: [...new Set(fields)].map(f => ({ field: f, label: LABEL[f], value: e[f] })),
    reason: why,
    operator: ctx.user.name || ctx.user.username || '',
    shownAt: `${DATA_DATE} ${new Date().toTimeString().slice(0, 5)}`,
    accessLogId: 'AL' + String(++ACCESS_SEQ).padStart(5, '0')
  }
})

on('PATCH', '/employees/{empId}/role', (ctx) => {
  const e = findEmp(ctx.params.empId)
  if (!e) throw notFound('员工不存在')
  if (!empVisible(ctx.user, e)) throw forbidden('该员工不在你的数据范围内')
  requirePerm(ctx.user, 'c.employees.edit', '缺少权限位 c.employees.edit：无权调整员工角色')
  const roleId = String((ctx.body || {}).roleId || '').trim()
  const r = ROLE.get(roleId)
  if (!r) throw notFound('角色不存在')
  if (e.status === '离职') {
    throw new ApiError(409, 40910, `${e.empId} 已离职，不能调整角色；先恢复在职`)
  }
  const cur = roleOfEmp(e)
  if (cur.roleId === roleId) throw new ApiError(409, 40911, `该员工已是「${r.name}」，无需调整`)
  EMP_ROLE_OVERRIDE.set(e.empId, roleId)
  const countOf = rid => employees.filter(x => roleOfEmp(x).roleId === rid).length
  const affected = [cur.roleId, roleId].filter(Boolean).map(rid => ({
    roleId: rid, roleName: (ROLE.get(rid) || {}).name || rid, userCount: countOf(rid)
  }))
  return {
    employee: empRow(e),
    from: { roleId: cur.roleId, roleName: cur.roleName },
    to: { roleId: r.roleId, roleName: r.name, permCount: r.permCount, dataScope: r.dataScope },
    affected
  }
})

/* ================= 月结（期间关账） =================
 * 三个口径写在这里，改之前先想清楚后果：
 *
 * ① **谁有权结**：`b.monthClose.edit`（财务）。项目经理**没有**——封账是财务动作，
 *    让项目经理封自己项目的账，等于让他自己掩盖欠费。
 * ② **能不能反结**：能，但走 `e.monthReopen.edit`（更高一级，刻意在 e 域避开财务的 b.* 通配）
 *    + 必填 ≥10 字原因。
 *    不允许反结的结果是有人去数据库改数，那才是真正的失控；允许但要留痕。
 * ③ **结完能改什么**：该期间流水 / 退款 / 账单减免一律 409 / 40903。
 *    退款会改上月已封存的收款与欠费，必须「反结 → 改 → 重结」。
 *
 * 反结不塞进退款流水：反结不是退款，混进退款表会让「退款金额」统计失真。
 * 它有自己的红冲凭证号（reversalNo），月结记录本身即凭证。
 */

/** 该期间的流水过滤（与结算同源） */
const BILL_INDEX = new Map(bills.map(b => [b.billId, b]))
/** 一笔流水属于哪个项目：优先看账单，车位费没房子也能落到项目 */
const commOfPayment = x => {
  const b = BILL_INDEX.get(x.billId)
  return (b && b.communityId) || (HOUSE.get(x.houseId) || {}).communityId || ''
}
const monthPayments = (period, communityId = '') => payments
  .filter(p => monthOf(p.payTime) === period)
  .filter(p => !communityId || commOfPayment(p) === communityId)
const monthRefunds = (period, communityId = '') => refunds
  .filter(r => monthOf(r.at) === period)
  .filter(r => !communityId || commOfPayment(r) === communityId)

/** 按收款方式汇总：现金要实点，非现金对流水 */
function monthMethodRows(period, communityId = '') {
  const pays = monthPayments(period, communityId)
  const refs = monthRefunds(period, communityId)
  const methods = [...new Set([...pays.map(p => p.method), ...refs.map(r => r.method)])]
    .filter(Boolean).sort()   /* 空渠道不出一行：汇总里出现无名的行比少一行更糟 */
  return methods.map(m => {
    const inRows = pays.filter(p => p.method === m)
    const outRows = refs.filter(r => r.method === m)
    const amount = r2(inRows.reduce((s, p) => s + (p.amount || 0), 0))
    const refund = r2(outRows.reduce((s, r) => s + (r.amount || 0), 0))
    return {
      method: m, count: inRows.length, amount,
      refundCount: outRows.length, refund, net: r2(amount - refund),
      mode: m === '现金' ? '实点' : '对流水'
    }
  })
}

/**
 * 预览 / 提交**共用这一段**。
 * 分开写过的后果是「预览 1002 笔、结完记录写 998 笔」，而且没人能解释差在哪。
 */
function monthPreview(period, communityId = '') {
  const rows = monthMethodRows(period, communityId)
  const billsOfMonth = bills.filter(b => b.period === period && b.status !== '已作废'
    && (!communityId || b.communityId === communityId))
  const pays = monthPayments(period, communityId)
  const income = r2(rows.reduce((s, r) => s + r.amount, 0))
  const refund = r2(rows.reduce((s, r) => s + r.refund, 0))
  const receivable = r2(billsOfMonth.reduce((s, b) => s + (b.payable || 0), 0))
  const received = r2(billsOfMonth.reduce((s, b) => s + (b.paidAmount || 0), 0))
  const debt = r2(billsOfMonth.reduce((s, b) => s + (b.unpaid || 0), 0))
  const closed = activeClose(period, communityId)
  const prev = activeClose(prevMonthOf(period), communityId)
  /* 全公司结账前的硬前置：**有业务的项目**都必须先结。
     汇总前明细不清，等于用总数掩盖某个项目的问题；
     但当期一笔账都没有的项目不参与（否则空项目永远结不掉，全公司就永远结不了）。 */
  const unclosedCommunities = communityId ? [] : communities
    .filter(c => {
      if (activeClose(period, c.communityId)) return false
      return bills.some(b => b.period === period && b.communityId === c.communityId && b.status !== '已作废')
    })
    .map(c => ({ communityId: c.communityId, name: c.name }))
  return {
    period,
    scope: communityId ? 'community' : 'group',
    communityId,
    communityName: communityId ? communityNameOf(communityId) : '',
    unclosedCommunities,
    rows,
    count: rows.reduce((s, r) => s + r.count, 0),
    income, refund, net: r2(income - refund),
    receivable, received, debt,
    /* 未核销事项：结账前必须让人看见，不能糊过去 */
    uninvoiced: pays.filter(p => p.invoiceStatus === '未开票').length,
    debtBills: billsOfMonth.filter(b => (b.unpaid || 0) > 0).length,
    prevPeriod: prevMonthOf(period),
    prevNet: prev ? prev.net : null,        /* 上月没结账就是 null，不给 0 */
    closed: closed || undefined,
    /* 未来期间不能提前结；已结不能重复结 */
    closable: period <= monthOf(DATA_DATE) && !closed
  }
}

/** 提交月结：校验顺序按「能不能结 → 有没有数 → 说明够不够」，错在哪步就说哪步 */
function doClose(period, memo, operator, communityId = '') {
  if (!/^\d{4}-\d{2}$/.test(String(period)) || +String(period).slice(5) > 12) throw bad('期间格式应为 YYYY-MM')
  if (period > monthOf(DATA_DATE)) throw invalid(`${period} 还没到，不能提前月结`)
  if (communityId && !communities.some(c => c.communityId === communityId)) throw notFound('项目不存在')
  const dup = activeClose(period, communityId)
  if (dup) {
    throw alreadyClosed(dup.scope === 'group'
      ? `${period} 已全公司月结（${dup.closeNo}），不能重复提交`
      : `${period} ${communityId} 已月结（${dup.closeNo}），不能重复提交`)
  }
  const pre = monthPreview(period, communityId)
  /* 全公司结账要求所有项目先结：否则就是拿总数掩盖某个项目的问题 */
  if (!communityId && pre.unclosedCommunities.length) {
    throw invalid(`还有 ${pre.unclosedCommunities.length} 个项目未结（${pre.unclosedCommunities.map(c => c.name).join('、')}），` +
      '全公司结账前必须先结清各项目')
  }
  if (!pre.count && !pre.receivable) throw invalid(`${period} 既没有收款也没有应收，无需月结`)
  const risk = pre.uninvoiced + pre.debtBills
  const m = String(memo || '').trim()
  if (risk > 0 && m.length < 4) {
    throw invalid(`还有 ${pre.uninvoiced} 笔未开票、${pre.debtBills} 笔欠费，请写明处理说明（至少 4 个字）`)
  }
  /* 单号按该期间历史记录数递增：反结后重结是 -02，不覆盖 -01（-01 要能查） */
  const seq = monthCloses.filter(c => c.period === period && (c.communityId || '') === communityId).length + 1
  const rec = {
    closeId: 'MC' + period.replace('-', '') + (communityId ? '-' + communityId : '') + (seq > 1 ? `-${seq}` : ''),
    closeNo: `YJ-${period.replace('-', '')}${communityId ? '-' + communityId : ''}-${pad2(seq)}`,
    period, status: '已结账',
    scope: communityId ? 'community' : 'group',
    communityId, communityName: communityId ? communityNameOf(communityId) : '',
    count: pre.count, income: pre.income, refund: pre.refund, net: pre.net,
    receivable: pre.receivable, received: pre.received, debt: pre.debt,
    uninvoiced: pre.uninvoiced, debtBills: pre.debtBills,
    memo: m, operator: operator || '财务·雷志强',
    at: `${DATA_DATE} 09:40`, locked: true,
    reopenedAt: '', reopenReason: '', reopenCount: 0, reversalNo: ''
  }
  monthCloses.unshift(rec)
  /* 只有**全公司**结账才重跑报表：报表是全公司口径，单个项目结完就宣布定稿是错的 */
  if (!communityId) {
    for (const code of Object.keys(REPORT_NAME)) createSnapshot(code, specOf('month', period, code))
  }
  return rec
}

/** 反结：记录不删、置「已反结」、作废该期间报表批次、恢复可写 */
function doReopen(closeId, reason, operator) {
  const rec = monthCloses.find(c => c.closeId === closeId)
  if (!rec) throw notFound('月结记录不存在')
  if (rec.status === '已反结') throw alreadyReopened(`${rec.period} 已于 ${rec.reopenedAt} 反结，不能重复反结`)
  const r = String(reason || '').trim()
  if (r.length < 10) throw invalid('反结原因至少 10 个字：要让别人看懂为什么推翻一次已封账的结果')
  rec.status = '已反结'
  rec.reopenedAt = `${DATA_DATE} 10:15`
  rec.reopenReason = r
  rec.reopenCount = (rec.reopenCount || 0) + 1
  rec.reversalNo = `HC-${rec.period.replace('-', '')}-${pad2(rec.reopenCount)}`
  rec.locked = false
  /* 全公司反结要**级联反结**该期间的项目级结账：
     只解汇总锁的话，项目明细还锁着，反结之后依然补录不了——等于白反。 */
  if (rec.scope !== 'community') {
    for (const c of monthCloses) {
      if (c.period === rec.period && c.scope === 'community' && c.status === '已结账') {
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
  if (rec.scope !== 'community') {
    for (const snap of snapshots.values()) {
      if (snap.meta.periodType === 'month' && snap.meta.period === rec.period) snap.meta.voided = true
    }
  }
  return rec
}

/* 预置 8 / 9 月已结：数字由同一段 monthPreview 算出，不手写——
   手写的样例数字和 fixtures 对不上，第一次联调就会被当成 bug */
for (const ym of ['2026-08', '2026-09']) {
  const pre = monthPreview(ym)
  monthCloses.push({
    closeId: 'MC' + ym.replace('-', ''), closeNo: `YJ-${ym.replace('-', '')}-01`,
    period: ym, status: '已结账',
    scope: 'group', communityId: '', communityName: '',
    count: pre.count, income: pre.income, refund: pre.refund, net: pre.net,
    receivable: pre.receivable, received: pre.received, debt: pre.debt,
    uninvoiced: pre.uninvoiced, debtBills: pre.debtBills,
    memo: ym === '2026-09' ? '9 月欠费已转 10 月催缴' : '正常结账',
    operator: '财务·雷志强', at: `${ym}-30 10:05`.replace('-30', '-01'),
    locked: true, reopenedAt: '', reopenReason: '', reopenCount: 0, reversalNo: ''
  })
}
monthCloses.sort((a, b) => String(b.period).localeCompare(String(a.period)))

const closeOut = rec => ({
  closeId: rec.closeId, closeNo: rec.closeNo, period: rec.period, status: rec.status,
  scope: rec.scope || 'group',
  communityId: rec.communityId || '', communityName: rec.communityName || '',
  count: rec.count, income: rec.income, refund: rec.refund, net: rec.net,
  receivable: rec.receivable, received: rec.received, debt: rec.debt,
  uninvoiced: rec.uninvoiced, debtBills: rec.debtBills,
  memo: rec.memo, operator: rec.operator, at: rec.at, locked: rec.locked,
  reopenedAt: rec.reopenedAt, reopenReason: rec.reopenReason,
  reopenCount: rec.reopenCount, reversalNo: rec.reversalNo
})

on('GET', '/month-closes', (ctx) => {
  const q = ctx.query
  const list = monthCloses
    .filter(c => !q.year || String(c.period).startsWith(q.year))
    .filter(c => !q.status || c.status === q.status)
    /* scope=group 只看全公司结账；传 communityId 只看这个项目 */
    .filter(c => !q.scope || (c.scope || 'group') === q.scope)
    .filter(c => !q.communityId || c.communityId === q.communityId)
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))
    .map(closeOut)
  return page(list, q)
})

/* preview 必须注册在 /month-closes/{closeId} 之前，否则 "preview" 会被当 closeId */
on('GET', '/month-closes/preview', (ctx) => {
  const period = ctx.query.period
  if (!/^\d{4}-\d{2}$/.test(String(period || '')) || +String(period || '').slice(5) > 12) {
    throw bad('period 必填，格式 YYYY-MM')
  }
  return monthPreview(period, String(ctx.query.communityId || ''))
})

on('GET', '/month-closes/{closeId}', (ctx) => {
  const rec = monthCloses.find(c => c.closeId === ctx.params.closeId)
  if (!rec) throw notFound('月结记录不存在')
  return closeOut(rec)
})

on('POST', '/month-closes', (ctx) => {
  const body = ctx.body || {}
  const rec = doClose(body.period, body.memo, body.operator, String(body.communityId || ''))
  ctx.status = 201
  return closeOut(rec)
})

on('POST', '/month-closes/{closeId}/reopen', (ctx) => {
  const body = ctx.body || {}
  const rec = doReopen(ctx.params.closeId, body.reason, body.operator)
  return closeOut(rec)
})

/* ================= 工资表（核算快照） =================
 * 三条口径写在这里，动手改之前先想清楚：
 *
 * ① **工资条是快照，不是查询结果**。生成 → 核算锁定 → 提交发放 → 审批 → 发放，
 *    金额在核算那一刻冻结。实时算的结果是同一个人今天看 11,058.98、明天补录一条加班
 *    就变 11,120.31，员工截图来问"为什么少了 62 块"，谁也说不清哪个对。
 * ② **金额只能服务端算**（grossPay / deductionTotal / netPay），前端不加总。
 *    前端加总的后果是列表一个数、工资条一个数、汇总又一个数。
 * ③ **提交人不能审批自己的发放单**。一个人既能核算又能批准，"谁批的"永远写的是同一个人。
 *
 * 行状态由**期次状态**派生（核算 / 提交 / 审批是整批动作），唯一的例外是单笔冲正。
 */

const PAY_BY_ID = new Map(payrolls.map(r => [r.payrollId, r]))

/** 期次状态 + 事件时间线（整批一次动作） */
const PERIOD_STATE = new Map()
for (const r of payrolls) {
  if (PERIOD_STATE.has(r.period)) continue
  const paid = r.status === '已发放'
  PERIOD_STATE.set(r.period, {
    period: r.period,
    status: r.status,
    batchNo: r.batchNo || '',
    paidAt: r.paidAt || '',
    paidBy: r.paidBy || '',
    submittedBy: paid ? '杜若曦' : '',
    approvedBy: paid ? '何淑珍' : '',
    payDate: paid ? '2026-10-10' : '',
    events: paid
      ? [
        { at: '2026-10-08 09:30', action: '生成工资表', operator: '系统', note: '按 9 月考勤与绩效核算' },
        { at: '2026-10-08 15:10', action: '核算锁定', operator: '何淑珍', note: '' },
        { at: '2026-10-09 10:05', action: '提交发放', operator: '杜若曦', note: `代发批次 ${r.batchNo}` },
        { at: '2026-10-09 16:40', action: '审批通过', operator: '何淑珍', note: '' },
        { at: '2026-10-10 14:20', action: '发放完成', operator: '何淑珍', note: '银企直连回执成功' }
      ]
      : [{ at: '2026-10-21 09:00', action: '生成工资表', operator: '系统', note: '按 10 月考勤与绩效核算' }]
  })
}

const nowStamp = () => `${DATA_DATE} ${new Date().toTimeString().slice(0, 5)}`
const latestPeriod = () => [...PERIOD_STATE.keys()].sort().pop() || ''

/** 白名单构造行：`bankCard`（完整卡号）在 fixture 里，但**永不随列表下发** */
const PAYROLL_FIELDS = [
  'payrollId', 'period', 'empId', 'empNo', 'empName', 'orgId', 'orgName',
  'position', 'level', 'empType', 'base', 'performance', 'overtime', 'allowance', 'grossPay',
  'socialInsurance', 'housingFund', 'tax', 'otherDeduction', 'deductionTotal', 'netPay',
  'paidAt', 'paidBy', 'reversedAt', 'reverseReason', 'bankCardMasked', 'bankCardTail', 'formulaVersion'
]
function payrollRow(r) {
  const st = PERIOD_STATE.get(r.period) || {}
  const out = {}
  for (const k of PAYROLL_FIELDS) out[k] = r[k]
  out.batchNo = r.batchNo || st.batchNo || ''
  /* 行状态 = 期次状态，除非这笔被单笔冲正 */
  out.status = r.reversedAt ? '已冲正' : (st.status || r.status)
  out.submittedBy = st.submittedBy || ''
  out._ver = verOf('payroll', r.payrollId)
  return out
}

/** 「仅本人」只回自己那一条——不是下发全表让前端藏 */
function payrollVisible(u, r) {
  if (u.dataScope === '仅本人') return r.empId === u.empId
  if (u.dataScope === '全部项目') return true
  const proj = projOfOrg(r.orgId)
  return !!proj && (u.communities || []).includes(proj)
}

function payrollFilter(u, q = {}) {
  const period = q.period || latestPeriod()
  const ids = descOrgs(q.orgId)
  return payrolls
    .filter(r => r.period === period)
    .filter(r => payrollVisible(u, r))
    .filter(r => !ids || ids.has(r.orgId))
    .map(payrollRow)
    .filter(r => eq(r.status, q.status))
    .filter(r => kwHit([r.empName, r.empNo, r.position, r.orgName], q.kw))
    .sort((a, b) => String(a.empNo).localeCompare(String(b.empNo)))
}

function payrollSummaryOf(period, u) {
  const rows = payrollFilter(u, { period })
  const alive = rows.filter(r => r.status !== '已冲正')
  const reversed = rows.filter(r => r.status === '已冲正')
  const byStatus = {}
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1
  const st = PERIOD_STATE.get(period) || {}
  return {
    period,
    batchNo: st.batchNo || '',
    status: st.status || '',
    employeeCount: rows.length,
    /* 已冲正的实发不进 netTotal：钱已经退回去了，还算在实发里就是账上凭空多一笔 */
    grossTotal: r2(alive.reduce((s, r) => s + (r.grossPay || 0), 0)),
    deductionTotal: r2(alive.reduce((s, r) => s + (r.deductionTotal || 0), 0)),
    netTotal: r2(alive.reduce((s, r) => s + (r.netPay || 0), 0)),
    reversedCount: reversed.length,
    reversedAmount: r2(reversed.reduce((s, r) => s + (r.netPay || 0), 0)),
    byStatus
  }
}

function periodMeta(period, u) {
  const s = payrollSummaryOf(period, u)
  const st = PERIOD_STATE.get(period) || {}
  return {
    period, status: st.status, employeeCount: s.employeeCount, netTotal: s.netTotal,
    batchNo: st.batchNo || '', generatedAt: (st.events[0] || {}).at || '', paidAt: st.paidAt || ''
  }
}

/** 核算：与原型的 payrollRows 同一套公式（formulaVersion=v1） */
function buildPayrollRows(period) {
  const prefix = 'PR' + period.slice(2, 4) + period.slice(5, 7)
  return employees
    .filter(e => e.status !== '离职')
    .map((e, i) => {
      const base = Number(e.baseSalary || 0)
      const monthly = Number(e.monthlySalary || base)
      const perf = r2(Math.max(0, monthly - base))
      const hourly = base / 21.75 / 8
      const ot = r2(hourly * (e.attendance?.overtimeHours || 0) * 1.5)
      const gross = r2(monthly + ot)
      const ss = e.socialSecurity ? r2(base * 0.105) : 0
      const fund = e.socialSecurity ? r2(base * 0.07) : 0
      const taxable = Math.max(0, gross - ss - fund - 5000)
      const tax = r2(taxable * 0.03)
      const other = 0
      const card = String(e.bankCard || '')
      return {
        payrollId: `${prefix}-${String(i + 1).padStart(4, '0')}`,
        period, batchNo: '',
        empId: e.empId, empNo: e.empNo, empName: e.name,
        orgId: e.orgId, orgName: (ORG.get(e.orgId) || {}).name || '',
        position: e.position, level: e.level, empType: e.empType,
        base, performance: perf, overtime: ot, allowance: 0, grossPay: gross,
        socialInsurance: ss, housingFund: fund, tax, otherDeduction: other,
        deductionTotal: r2(ss + fund + tax + other),
        netPay: r2(gross - ss - fund - tax - other),
        status: '草稿', paidAt: '', paidBy: '', reversedAt: '', reverseReason: '',
        bankCard: card,
        bankCardMasked: '**** **** **** ' + card.slice(-4),
        bankCardTail: card.slice(-4),
        formulaVersion: 'v1'
      }
    })
}

on('GET', '/payrolls', (ctx) => {
  requirePerm(ctx.user, 'c.payroll.view', '缺少权限位 c.payroll.view：无权查看工资表')
  const period = ctx.query.period || latestPeriod()
  if (!PERIOD_STATE.has(period)) throw notFound(`${period} 没有工资表（需要先生成）`)
  return page(payrollFilter(ctx.user, { ...ctx.query, period }), ctx.query)
})

on('GET', '/payrolls/summary', (ctx) => {
  requirePerm(ctx.user, 'c.payroll.view', '缺少权限位 c.payroll.view：无权查看工资表')
  const period = ctx.query.period || latestPeriod()
  if (!PERIOD_STATE.has(period)) throw notFound(`${period} 没有工资表（需要先生成）`)
  return payrollSummaryOf(period, ctx.user)
})

on('GET', '/payrolls/periods', (ctx) => {
  requirePerm(ctx.user, 'c.payroll.view', '缺少权限位 c.payroll.view：无权查看工资表')
  return { rows: [...PERIOD_STATE.keys()].sort().reverse().map(p => periodMeta(p, ctx.user)) }
})

on('POST', '/payrolls/generate', (ctx) => {
  requirePerm(ctx.user, 'c.payroll.edit', '缺少权限位 c.payroll.edit：无权生成工资表')
  const b = ctx.body || {}
  const period = String(b.period || '').trim()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw bad('period 格式应为 YYYY-MM')
  const existed = PERIOD_STATE.get(period)
  if (existed) {
    if (existed.status !== '草稿') {
      throw new ApiError(409, 40913, `${period} 当前状态「${existed.status}」，不能重算；已发放的请先冲正`)
    }
    if (!b.overwrite) {
      const n = payrolls.filter(r => r.period === period).length
      throw new ApiError(409, 40912, `${period} 工资表已存在（${n} 人），重算需 overwrite=true`)
    }
    /* 草稿期重算：直接替换。此时一分钱都没发出去，替换不会造成账实不符 */
    for (let i = payrolls.length - 1; i >= 0; i--) {
      if (payrolls[i].period === period) {
        PAY_BY_ID.delete(payrolls[i].payrollId)
        payrolls.splice(i, 1)
      }
    }
  }
  const rows = buildPayrollRows(period)
  if (!rows.length) throw invalid(`${period} 没有可核算的在职员工`)
  payrolls.push(...rows)
  for (const r of rows) PAY_BY_ID.set(r.payrollId, r)
  PERIOD_STATE.set(period, {
    period, status: '草稿', batchNo: '', paidAt: '', paidBy: '',
    submittedBy: '', approvedBy: '', payDate: '',
    events: [{ at: nowStamp(), action: existed ? '重新核算' : '生成工资表', operator: ctx.user.name, note: `${rows.length} 人` }]
  })
  ctx.status = existed ? 200 : 201
  return {
    period, employeeCount: rows.length, overwritten: !!existed,
    summary: payrollSummaryOf(period, ctx.user)
  }
})

on('POST', '/payrolls/{period}/confirm', (ctx) => {
  requirePerm(ctx.user, 'c.payroll.edit', '缺少权限位 c.payroll.edit：无权核算工资')
  const period = ctx.params.period
  const st = PERIOD_STATE.get(period)
  if (!st) throw notFound(`${period} 没有工资表`)
  if (st.status !== '草稿') {
    throw new ApiError(409, 40914, `${period} 当前状态「${st.status}」，只有草稿可以核算`)
  }
  st.status = '已核算'
  st.events.push({ at: nowStamp(), action: '核算锁定', operator: ctx.user.name, note: '' })
  return periodMeta(period, ctx.user)
})

on('POST', '/payrolls/{period}/pay', (ctx) => {
  requirePerm(ctx.user, 'c.payroll.edit', '缺少权限位 c.payroll.edit：无权提交发放')
  const period = ctx.params.period
  const st = PERIOD_STATE.get(period)
  if (!st) throw notFound(`${period} 没有工资表`)
  const b = ctx.body || {}
  if (!b.payDate || !isDateStr(b.payDate)) throw bad('payDate 必填且为 YYYY-MM-DD')
  if (st.status !== '已核算') {
    throw new ApiError(409, 40914, `${period} 当前状态「${st.status}」，需要先核算锁定`)
  }
  const batchNo = `GZ-${period}-01`
  st.status = '待发放审批'
  st.batchNo = batchNo
  st.payDate = b.payDate
  st.submittedBy = ctx.user.name
  st.events.push({ at: nowStamp(), action: '提交发放', operator: ctx.user.name, note: `代发批次 ${batchNo} · 发放日 ${b.payDate}` })
  return periodMeta(period, ctx.user)
})

on('POST', '/payrolls/{period}/approve', (ctx) => {
  requirePerm(ctx.user, 'c.payroll.edit', '缺少权限位 c.payroll.edit：无权审批发放')
  const period = ctx.params.period
  const st = PERIOD_STATE.get(period)
  if (!st) throw notFound(`${period} 没有工资表`)
  const b = ctx.body || {}
  const decision = String(b.decision || '')
  if (!['approve', 'reject'].includes(decision)) throw bad('decision 只能是 approve / reject')
  if (st.status !== '待发放审批') {
    throw new ApiError(409, 40914, `${period} 当前状态「${st.status}」，没有待审批的发放单`)
  }
  /* 双人原则：一个人既能核算又能批准，"谁批的"永远写的是同一个人 */
  if (st.submittedBy === ctx.user.name) {
    throw new ApiError(409, 40915, `发放单由 ${st.submittedBy} 提交，不能由本人审批`)
  }
  if (decision === 'reject') {
    const reason = String(b.reason || '').trim()
    if (reason.length < 4) throw invalid('驳回要写原因（至少 4 个字）')
    st.status = '已核算'
    st.batchNo = ''
    st.events.push({ at: nowStamp(), action: '审批驳回', operator: ctx.user.name, note: reason })
    return periodMeta(period, ctx.user)
  }
  st.status = '已发放'
  st.approvedBy = ctx.user.name
  st.paidAt = nowStamp()
  st.paidBy = ctx.user.name
  for (const r of payrolls.filter(x => x.period === period)) {
    if (!r.reversedAt) { r.paidAt = st.paidAt; r.paidBy = st.paidBy }
  }
  st.events.push({ at: nowStamp(), action: '发放完成', operator: ctx.user.name, note: '银企直连回执成功' })
  return periodMeta(period, ctx.user)
})

on('GET', '/payrolls/{payrollId}', (ctx) => {
  requirePerm(ctx.user, 'c.payroll.view', '缺少权限位 c.payroll.view：无权查看工资条')
  const r = PAY_BY_ID.get(ctx.params.payrollId)
  if (!r) throw notFound('工资条不存在')
  if (!payrollVisible(ctx.user, r)) throw forbidden('该工资条不在你的数据范围内')
  const row = payrollRow(r)
  const st = PERIOD_STATE.get(r.period) || {}
  return {
    payroll: row,
    calc: {
      gross: [
        { label: '基本工资', amount: r.base },
        { label: '绩效', amount: r.performance, note: '月度应发 − 基本工资' },
        { label: '加班费', amount: r.overtime, note: `基本工资 / 21.75 / 8 × 加班小时 × 1.5` },
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
    bankCard: {
      masked: r.bankCardMasked, tail: r.bankCardTail,
      revealable: hasPerm(ctx.user, 'c.payroll.view') && hasPerm(ctx.user, 'a.sensitive.view')
    },
    timeline: [...st.events]
  }
})

on('POST', '/payrolls/{payrollId}/reverse', (ctx) => {
  requirePerm(ctx.user, 'c.payroll.edit', '缺少权限位 c.payroll.edit：无权冲正')
  const r = PAY_BY_ID.get(ctx.params.payrollId)
  if (!r) throw notFound('工资条不存在')
  if (!payrollVisible(ctx.user, r)) throw forbidden('该工资条不在你的数据范围内')
  if (payrollRow(r).status !== '已发放') {
    throw new ApiError(409, 40914, `${ctx.params.payrollId} 当前状态「${payrollRow(r).status}」，只有已发放的工资条可以冲正`)
  }
  const reason = String((ctx.body || {}).reason || '').trim()
  if (reason.length < 10) throw invalid('冲正原因至少 10 个字（这笔要留档）')
  r.reversedAt = nowStamp()
  r.reverseReason = reason
  bumpVer('payroll', r.payrollId)
  const st = PERIOD_STATE.get(r.period)
  if (st) st.events.push({ at: r.reversedAt, action: '单笔冲正', operator: ctx.user.name, note: `${r.empName} · ${reason}` })
  return payrollRow(r)
})

let PAY_ACCESS_SEQ = 0
on('POST', '/payrolls/{payrollId}/reveal', (ctx) => {
  const r = PAY_BY_ID.get(ctx.params.payrollId)
  if (!r) throw notFound('工资条不存在')
  if (!payrollVisible(ctx.user, r)) throw forbidden('该工资条不在你的数据范围内')
  /* 双权限：只有 a.sensitive.view 不够——能看业主手机的人不该顺带能导出全公司银行卡 */
  requirePerm(ctx.user, 'c.payroll.view', '缺少权限位 c.payroll.view：无权查看工资条')
  requirePerm(ctx.user, 'a.sensitive.view', '缺少权限位 a.sensitive.view：银行卡号属个人敏感信息')
  const reason = String((ctx.body || {}).reason || '').trim()
  if (reason.length < 4) throw invalid('请填写揭示原因（至少 4 个字）')
  return {
    payrollId: r.payrollId, empName: r.empName,
    bankCard: r.bankCard, reason,
    operator: ctx.user.name, shownAt: nowStamp(),
    accessLogId: 'AL' + String(++PAY_ACCESS_SEQ).padStart(5, '0')
  }
})

/* ================= 组织与权限（纯 RBAC） =================
 * 四条规矩，改之前先想清楚：
 * ① **权限只挂角色，人只挂角色**——没有「给某人加一个权限码」这种接口。
 *    逐人授权的系统最后没人说得清"谁到底能干什么"。
 * ② **提权要批、降权即时**：新增命中高敏白名单才进审批；收回权限立刻生效——
 *    收回还要等审批，这段时间里他能做的事一点没少。
 * ③ **双人原则**：提交人不能批自己提的申请（自己提自己批，等于没有审批）。
 * ④ **每次都记 diff**：记的是具体权限码，不是"改过权限"四个字。
 */

const PERM_DICT = new Map(permissions.map(p => [p.code, p]))
const PERM_TOTAL_COUNT = permissions.length

/** 高敏白名单：拿到就等于能自己扩权或掩盖问题 */
const SENSITIVE_RULES = [
  { code: 'a.sensitive.view', why: '能看业主 / 租户的证件号与银行账号明文' },
  { code: 'e.monthReopen.edit', why: '能推翻已封账的月结结果' },
  { code: 'e.org.edit', why: '能改角色权限本身——等于能给自己加任何权限' },
  { code: 'c.payroll.edit', why: '能改工资表' },
  { code: 'a.stewards.edit', why: '能改楼栋责任范围——等于能自己扩大可见范围' }
]

/** 角色生效权限：保存后的覆盖优先（默认取 fixture 的 perms） */
const ROLE_PERMS = new Map(roles.map(r => [r.roleId, new Set(r.perms || [])]))
const permsOf = roleId => ROLE_PERMS.get(roleId) || new Set()

const PERM_REQUESTS = []
const PERM_LOGS = []
let _PERM_LOG_SEQ = 0
let _PERM_REQ_SEQ = 0

/** 数据范围档位（窄 → 宽）。「指定项目」排在「本项目」之上是保守取法：
    指定 3 个项目的人通常比只看得见 1 个项目部的人看得多。 */
const SCOPE_RANK = { 仅本人: 0, 本部门: 1, 责任范围: 2, 本项目: 3, 指定项目: 4, 全部项目: 5 }

/** 从某个时间戳到「数据集当下」过了多少小时（超时提醒用，不依赖真实时间） */
const hoursSince = stamp => {
  const t = Date.parse(String(stamp).replace(' ', 'T') + ':00Z')
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((Date.parse(DATA_DATE + 'T00:00:00Z') - t) / 3600000))
}
const OVERDUE_HOURS = 24

/* 预置两条待审批：一条已超时（挂了两天没人管）、一条刚提的。
   没有这两条，「审批超时提醒」永远没有可演示的对象。 */
;(function seedPermRequests() {
  const seed = [
    {
      roleId: 'R-CHG', roleName: '收银员', kind: 'perm',
      added: ['e.monthReopen.edit'], removed: [],
      risks: SENSITIVE_RULES.filter(x => x.code === 'e.monthReopen.edit'),
      reason: '收银员需要处理反结后的补录', submitBy: '顾悦', submitRoleId: 'R-FINM',
      submitAt: '2026-10-19 10:00'
    },
    {
      roleId: 'R-QS', roleName: '品质督导', kind: 'scope',
      added: [], removed: [], risks: [],
      scope: { from: '指定项目', to: '全部项目', communities: [] },
      reason: '品质巡检需要覆盖全部项目', submitBy: '谢文博', submitRoleId: 'R-HR',
      submitAt: '2026-10-21 08:00'
    }
  ]
  for (const x of seed) {
    _PERM_REQ_SEQ++
    PERM_REQUESTS.push({
      reqId: 'REQ' + String(_PERM_REQ_SEQ).padStart(4, '0'),
      roleId: x.roleId, roleName: x.roleName, kind: x.kind,
      added: x.added, removed: x.removed,
      addedCount: x.added.length, removedCount: x.removed.length,
      risks: x.risks, reason: x.reason,
      submitBy: x.submitBy, submitRoleId: x.submitRoleId, submitAt: x.submitAt,
      status: '待审批', approver: '', approvedAt: '', approveNote: '', changeId: '',
      ...(x.scope ? { scope: x.scope } : {}),
      after: x.kind === 'perm' ? [...permsOf(x.roleId), ...x.added] : []
    })
  }
})()

const roleUserCount = roleId => employees.filter(e => roleOfEmp(e).roleId === roleId).length

function roleRow(r) {
  const perms = permsOf(r.roleId)
  const domains = [...new Set([...perms].map(c => (PERM_DICT.get(c) || {}).domainName).filter(Boolean))]
  return {
    roleId: r.roleId, name: r.name, scope: r.scope, dataScope: r.dataScope,
    communities: r.communities || [], positions: r.positions || [],
    builtin: true,
    /* 实际使用人数：按员工岗位反推，不是角色表里存的那个数 */
    userCount: roleUserCount(r.roleId),
    permCount: perms.size,
    coverage: Math.round((perms.size / PERM_TOTAL_COUNT) * 100),
    domains
  }
}

function permMatrixOf(roleId) {
  const has = roleId ? permsOf(roleId) : new Set()
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
    total: PERM_TOTAL_COUNT,
    granted: has.size,
    coverage: Math.round((has.size / PERM_TOTAL_COUNT) * 100)
  }
}

on('GET', '/roles', (ctx) => {
  requirePerm(ctx.user, 'e.org.view', '缺少权限位 e.org.view：无权查看角色')
  const q = ctx.query
  let rows = roles.map(roleRow)
  if (q.scope) rows = rows.filter(r => r.scope === q.scope)
  if (q.dataScope) rows = rows.filter(r => r.dataScope === q.dataScope)
  const VF = {
    crossDomain: r => r.domains.length >= 3,
    bigPerm: r => r.permCount >= 20,
    readonly: r => r.permCount > 0 && [...permsOf(r.roleId)].every(c => c.endsWith('.view')),
    wideScope: r => ['全部项目', '指定项目'].includes(r.dataScope)
  }
  if (VF[q.vf]) rows = rows.filter(VF[q.vf])
  if (q.kw) rows = rows.filter(r => kwHit([r.name, r.roleId, ...(r.positions || [])], q.kw))
  return { rows }
})

on('POST', '/roles', (ctx) => {
  requirePerm(ctx.user, 'e.org.edit', '缺少权限位 e.org.edit：无权新增角色')
  const b = ctx.body || {}
  /* 新角色不接受 perms：一次带一堆权限没人逐条看；矩阵保存那条路有 diff、日志、高敏审批 */
  if (Array.isArray(b.perms) && b.perms.length) {
    throw invalid('新建角色不接受 perms：先建空角色，再去权限矩阵里授权（那一步有日志与审批）')
  }
  const name = String(b.name || '').trim()
  if (name.length < 2) throw invalid('角色名称至少 2 个字')
  if (!['集团', '项目'].includes(b.scope)) throw invalid('适用层级只能是 集团 / 项目')
  if (roles.some(r => r.name === name)) throw conflictUnique(`角色名称「${name}」已存在`)
  const seq = roles.length + 1
  const rec = {
    roleId: 'R-C' + String(seq).padStart(2, '0'),
    name,
    scope: b.scope,
    /* 默认「仅本人」：默认给「全部项目」是很多系统出事的起点 */
    dataScope: b.dataScope || '仅本人',
    communities: b.communities || [],
    positions: b.positions || [],
    desc: b.desc || '',
    builtin: false
  }
  roles.push(rec)
  ROLE_PERMS.set(rec.roleId, new Set())
  ctx.status = 201
  return roleRow(rec)
})

on('GET', '/roles/{roleId}', (ctx) => {
  requirePerm(ctx.user, 'e.org.view', '缺少权限位 e.org.view：无权查看角色')
  const r = roles.find(x => x.roleId === ctx.params.roleId)
  if (!r) throw notFound('角色不存在')
  const row = roleRow(r)
  const matrix = permMatrixOf(r.roleId)
  const perms = [...permsOf(r.roleId)]
  return {
    role: row,
    matrix,
    members: employees.filter(e => roleOfEmp(e).roleId === r.roleId).slice(0, 6).map(e => ({
      empId: e.empId, name: e.name, position: e.position,
      orgName: (ORG.get(teamOf(e) || e.orgId) || {}).name || ''
    })),
    visible: r.dataScope === '指定项目'
      ? (r.communities || []).map(cid => communityNameOf(cid)).join('、')
      : (r.dataScope === '全部项目' ? `全部 ${communities.length} 个项目` : r.dataScope),
    byDomain: matrix.groups.map(g => ({
      domainName: g.domainName,
      granted: g.funcs.reduce((s, f) => s + f.ops.filter(o => o.on).length, 0),
      total: g.funcs.reduce((s, f) => s + f.ops.length, 0)
    })),
    posture: {
      sensitive: perms.filter(c => SENSITIVE_RULES.some(x => x.code === c)),
      wideScope: ['全部项目', '指定项目'].includes(r.dataScope)
    }
  }
})

function pushPermLog({ roleId, roleName, action, added, removed, reason, source }) {
  _PERM_LOG_SEQ++
  const rec = {
    logId: 'PL' + String(_PERM_LOG_SEQ).padStart(4, '0'),
    at: nowStamp(),
    operator: '', operatorRole: '',
    roleId, roleName, action,
    added: [...added].sort(), removed: [...removed].sort(),
    reason: reason || '', source: source || '/e/org'
  }
  PERM_LOGS.unshift(rec)
  return rec
}

const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x))

on('PATCH', '/roles/{roleId}', (ctx) => {
  requirePerm(ctx.user, 'e.org.edit', '缺少权限位 e.org.edit：无权修改角色')
  const r = roles.find(x => x.roleId === ctx.params.roleId)
  if (!r) throw notFound('角色不存在')
  const b = ctx.body || {}
  if (b.scope !== undefined) throw invalid('不能改适用层级（集团 / 项目级）：那是新建角色的事')

  const oldScope = r.dataScope
  const newScope = b.dataScope !== undefined ? b.dataScope : oldScope
  if (!Object.prototype.hasOwnProperty.call(SCOPE_RANK, newScope)) throw invalid(`数据范围「${newScope}」非法`)

  const oldComm = (r.communities || []).slice().sort().join(',')
  const commChanged = Array.isArray(b.communities) && [...b.communities].sort().join(',') !== oldComm
  /* 变宽要审；同档换项目也要审——换项目就是换一批能看到的数据 */
  const needAudit = SCOPE_RANK[newScope] > SCOPE_RANK[oldScope]
    || (SCOPE_RANK[newScope] === SCOPE_RANK[oldScope] && commChanged)

  if (b.name !== undefined) {
    const name = String(b.name).trim()
    if (name.length < 2) throw invalid('角色名称至少 2 个字')
    if (roles.some(x => x.roleId !== r.roleId && x.name === name)) {
      throw conflictUnique(`角色名称「${name}」已存在`)
    }
  }
  const operator = { name: ctx.user.name, role: ctx.user.roleName }

  if (needAudit) {
    const reason = String(b.reason || '').trim()
    if (reason.length < 4) throw invalid('放宽数据范围要写原因（至少 4 个字）')
    const dup = PERM_REQUESTS.find(q => q.roleId === r.roleId && q.status === '待审批'
      && q.kind === 'scope' && q.scope && q.scope.to === newScope)
    if (dup) throw new ApiError(409, 40916, `「${r.name}」已有一条数据范围变更在审批中（${dup.reqId}）`)
    _PERM_REQ_SEQ++
    const req = {
      reqId: 'REQ' + String(_PERM_REQ_SEQ).padStart(4, '0'),
      roleId: r.roleId, roleName: r.name, kind: 'scope',
      added: [], removed: [], addedCount: 0, removedCount: 0, risks: [],
      scope: { from: oldScope, to: newScope, communities: b.communities || [] },
      reason,
      submitBy: operator.name, submitRoleId: ctx.user.roleId, submitAt: nowStamp(),
      status: '待审批', approver: '', approvedAt: '', approveNote: '', changeId: '',
      after: []
    }
    PERM_REQUESTS.unshift(req)
    const log = pushPermLog({
      roleId: r.roleId, roleName: r.name, action: '提交审批', added: [], removed: [],
      reason: `数据范围 ${oldScope} → ${newScope}：${reason}`
    })
    log.operator = operator.name
    log.operatorRole = operator.role
    ctx.status = 202
    const { after: _a, ...pub } = req
    return {
      roleId: r.roleId, applied: false, noChange: false,
      diff: { added: [], removed: [] }, log, request: pub, effectiveAt: ''
    }
  }

  const nothing = b.name === undefined && b.desc === undefined && newScope === oldScope && !commChanged
  if (nothing) {
    return {
      roleId: r.roleId, applied: true, noChange: true,
      diff: { added: [], removed: [] }, log: null, request: null, effectiveAt: ''
    }
  }
  if (b.name !== undefined) r.name = String(b.name).trim()
  if (b.desc !== undefined) r.desc = String(b.desc)
  if (newScope !== oldScope) r.dataScope = newScope
  if (Array.isArray(b.communities)) r.communities = b.communities
  const log = pushPermLog({
    roleId: r.roleId, roleName: r.name, action: '直接保存', added: [], removed: [],
    reason: `数据范围 ${oldScope} → ${newScope}`
  })
  log.operator = operator.name
  log.operatorRole = operator.role
  return {
    roleId: r.roleId, applied: true, noChange: false,
    diff: { added: [], removed: [] }, log, request: null, effectiveAt: log.at
  }
})

on('PUT', '/roles/{roleId}/perms', (ctx) => {
  requirePerm(ctx.user, 'e.org.edit', '缺少权限位 e.org.edit：无权修改角色权限')
  const r = roles.find(x => x.roleId === ctx.params.roleId)
  if (!r) throw notFound('角色不存在')
  const b = ctx.body || {}
  if (!Array.isArray(b.perms)) throw bad('perms 必须是权限码数组')
  const illegal = b.perms.filter(c => !PERM_DICT.has(c))
  if (illegal.length) throw invalid(`未知权限码：${illegal.slice(0, 3).join('、')}`)

  const before = [...permsOf(r.roleId)]
  const after = [...new Set(b.perms)]
  const added = after.filter(c => !before.includes(c)).sort()
  const removed = before.filter(c => !after.includes(c)).sort()
  const diff = { added, removed }

  /* 原样保存不记日志：日志里全是"改过权限"的噪声，真出事时翻不到那一条 */
  if (!added.length && !removed.length) {
    return { roleId: r.roleId, applied: true, noChange: true, diff, log: null, request: null, effectiveAt: '' }
  }

  const risks = added.map(c => SENSITIVE_RULES.find(x => x.code === c)).filter(Boolean)
  const operator = { name: ctx.user.name, role: ctx.user.roleName }

  if (risks.length) {
    const dup = PERM_REQUESTS.find(q => q.roleId === r.roleId && q.status === '待审批' && sameSet(q.added, added))
    if (dup) throw new ApiError(409, 40916, `「${r.name}」已有一条相同内容的提权申请在审批中（${dup.reqId}）`)
    const reason = String(b.reason || '').trim()
    if (reason.length < 4) throw invalid('提权申请要写原因（至少 4 个字）')
    _PERM_REQ_SEQ++
    const req = {
      reqId: 'REQ' + String(_PERM_REQ_SEQ).padStart(4, '0'),
      roleId: r.roleId, roleName: r.name,
      added, removed, addedCount: added.length, removedCount: removed.length,
      risks,
      reason,
      submitBy: operator.name, submitRoleId: ctx.user.roleId, submitAt: nowStamp(),
      status: '待审批', approver: '', approvedAt: '', approveNote: '', changeId: '',
      /* 内部快照：审批通过时直接落这份，不再拿"当前"集合去比（那期间可能又被改过） */
      after
    }
    PERM_REQUESTS.unshift(req)
    const log = pushPermLog({ roleId: r.roleId, roleName: r.name, action: '提交审批', added, removed, reason })
    log.operator = operator.name
    log.operatorRole = operator.role
    ctx.status = 202
    const { after: _hidden, ...pub } = req
    return { roleId: r.roleId, applied: false, noChange: false, diff, log, request: pub, effectiveAt: '' }
  }

  /* 纯降权 / 普通新增 → 立即生效 */
  ROLE_PERMS.set(r.roleId, new Set(after))
  const log = pushPermLog({ roleId: r.roleId, roleName: r.name, action: '直接保存', added, removed, reason: b.reason || '' })
  log.operator = operator.name
  log.operatorRole = operator.role
  return { roleId: r.roleId, applied: true, noChange: false, diff, log, request: null, effectiveAt: log.at }
})

on('GET', '/perm-requests', (ctx) => {
  requirePerm(ctx.user, 'e.permApprove.view', '缺少权限位 e.permApprove.view：无权查看权限申请')
  const rows = PERM_REQUESTS
    .filter(r => eq(r.status, ctx.query.status) && eq(r.roleId, ctx.query.roleId))
    .map(({ after, ...pub }) => ({
      ...pub,
      mine: pub.submitRoleId === ctx.user.roleId,
      ageHours: hoursSince(pub.submitAt),
      /* 挂过 24 小时没人处理的单要跳出来：审批不是"有空再看"，它挡着别人干活 */
      overdue: pub.status === '待审批' && hoursSince(pub.submitAt) >= OVERDUE_HOURS
    }))
    .filter(r => ctx.query.vf !== 'overdue' || r.overdue)
    .sort((a, b) => String(b.submitAt).localeCompare(String(a.submitAt)))
  return { rows }
})

on('POST', '/perm-requests', (ctx) => {
  requirePerm(ctx.user, 'e.org.edit', '缺少权限位 e.org.edit：无权提交权限申请')
  const b = ctx.body || {}
  const r = roles.find(x => x.roleId === b.roleId)
  if (!r) throw notFound('角色不存在')
  const added = [...new Set(b.added || [])].filter(c => PERM_DICT.has(c)).sort()
  const removed = [...new Set(b.removed || [])].filter(c => PERM_DICT.has(c)).sort()
  if (!added.length && !removed.length) throw invalid('申请内容为空')
  const reason = String(b.reason || '').trim()
  if (reason.length < 4) throw invalid('提权申请要写原因（至少 4 个字）')
  const dup = PERM_REQUESTS.find(q => q.roleId === r.roleId && q.status === '待审批' && sameSet(q.added, added))
  if (dup) throw new ApiError(409, 40916, `「${r.name}」已有一条相同内容的提权申请在审批中（${dup.reqId}）`)
  _PERM_REQ_SEQ++
  const after = [...new Set([...permsOf(r.roleId), ...added])].filter(c => !removed.includes(c))
  const req = {
    reqId: 'REQ' + String(_PERM_REQ_SEQ).padStart(4, '0'),
    roleId: r.roleId, roleName: r.name,
    added, removed, addedCount: added.length, removedCount: removed.length,
    risks: added.map(c => SENSITIVE_RULES.find(x => x.code === c)).filter(Boolean),
    reason,
    submitBy: ctx.user.name, submitRoleId: ctx.user.roleId, submitAt: nowStamp(),
    status: '待审批', approver: '', approvedAt: '', approveNote: '', changeId: '',
    after
  }
  PERM_REQUESTS.unshift(req)
  ctx.status = 201
  const { after: _hidden, ...pub } = req
  return pub
})

function permRequestOf(reqId) {
  const req = PERM_REQUESTS.find(x => x.reqId === reqId)
  if (!req) throw notFound('申请不存在')
  return req
}

on('POST', '/perm-requests/{reqId}/approve', (ctx) => {
  requirePerm(ctx.user, 'e.permApprove.edit', '缺少权限位 e.permApprove.edit：无权审批权限申请')
  const req = permRequestOf(ctx.params.reqId)
  if (req.status !== '待审批') throw new ApiError(409, 40918, `${req.reqId} 当前状态「${req.status}」，不能重复审批`)
  /* 双人原则：自己提自己批，等于没有审批，日志里还留一次"审批通过"的假象 */
  if (req.submitRoleId === ctx.user.roleId) {
    throw new ApiError(409, 40917, `该申请由「${req.submitBy}」提交，不能由同一个人审批`)
  }
  if (req.kind === 'scope') {
    /* 数据范围审批：改的是"能看多少行"，不是"能点哪个按钮"，落库位置不同 */
    const role = roles.find(r => r.roleId === req.roleId)
    if (role) {
      role.dataScope = req.scope.to
      if (Array.isArray(req.scope.communities)) role.communities = req.scope.communities
    }
  } else {
    ROLE_PERMS.set(req.roleId, new Set(req.after))
  }
  req.status = '已通过'
  req.approver = ctx.user.name
  req.approvedAt = nowStamp()
  req.approveNote = String((ctx.body || {}).note || '')
  const log = pushPermLog({
    roleId: req.roleId, roleName: req.roleName, action: '审批通过',
    added: req.added, removed: req.removed, reason: req.reason
  })
  log.operator = ctx.user.name
  log.operatorRole = ctx.user.roleName
  req.changeId = log.logId
  const { after: _hidden, ...pub } = req
  return pub
})

on('POST', '/perm-requests/{reqId}/reject', (ctx) => {
  requirePerm(ctx.user, 'e.permApprove.edit', '缺少权限位 e.permApprove.edit：无权审批权限申请')
  const req = permRequestOf(ctx.params.reqId)
  if (req.status !== '待审批') throw new ApiError(409, 40918, `${req.reqId} 当前状态「${req.status}」，不能重复处理`)
  if (req.submitRoleId === ctx.user.roleId) {
    throw new ApiError(409, 40917, '审批人不能是提交人')
  }
  const reason = String((ctx.body || {}).reason || '').trim()
  if (reason.length < 4) throw invalid('驳回要写原因（至少 4 个字）')
  req.status = '已驳回'
  req.approver = ctx.user.name
  req.approvedAt = nowStamp()
  req.approveNote = reason
  const log = pushPermLog({
    roleId: req.roleId, roleName: req.roleName, action: '审批驳回',
    added: req.added, removed: req.removed, reason
  })
  log.operator = ctx.user.name
  log.operatorRole = ctx.user.roleName
  const { after: _hidden, ...pub } = req
  return pub
})

on('POST', '/perm-requests/{reqId}/withdraw', (ctx) => {
  const req = permRequestOf(ctx.params.reqId)
  if (req.status !== '待审批') throw new ApiError(409, 40918, `${req.reqId} 当前状态「${req.status}」，不能撤回`)
  if (req.submitRoleId !== ctx.user.roleId) throw forbidden('只有提交人可以撤回')
  req.status = '已撤回'
  req.approvedAt = nowStamp()
  const { after: _hidden, ...pub } = req
  return pub
})

on('GET', '/perm-logs', (ctx) => {
  requirePerm(ctx.user, 'e.permLog.view', '缺少权限位 e.permLog.view：无权查看权限变更日志')
  const rows = PERM_LOGS
    .filter(r => eq(r.roleId, ctx.query.roleId) && eq(r.action, ctx.query.action))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.logId).localeCompare(String(a.logId)))
  return page(rows, ctx.query)
})

on('GET', '/access-logs', (ctx) => {
  requirePerm(ctx.user, 'e.accessLog.view', '缺少权限位 e.accessLog.view：无权查看访问日志')
  const rows = accessLogs
    .filter(r => eq(r.action, ctx.query.action) && eq(r.result, ctx.query.result) && eq(r.operator, ctx.query.operator))
    .filter(r => kwHit([r.entityName, r.fieldLabel, r.memo, r.source, r.operator], ctx.query.kw))
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.logId).localeCompare(String(a.logId)))
  return page(rows, ctx.query)
})

/** 近 N 天（按样例的 DATA_DATE 往前推，不依赖真实时间） */
const daysAgo = days => {
  const d = new Date(DATA_DATE + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - (Math.max(1, days) - 1))
  return d.toISOString().slice(0, 10)
}

on('GET', '/access-logs/summary', (ctx) => {
  requirePerm(ctx.user, 'e.accessLog.view', '缺少权限位 e.accessLog.view：无权查看访问日志')
  const start = daysAgo(Number(ctx.query.days) || 7)
  const rows = accessLogs
    .filter(r => r.at.slice(0, 10) >= start)
    .filter(r => eq(r.result, ctx.query.result) && eq(r.operator, ctx.query.operator))
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
})

on('GET', '/export-logs', (ctx) => {
  requirePerm(ctx.user, 'e.accessLog.view', '缺少权限位 e.accessLog.view：无权查看导出日志')
  /* days 只在显式传了才过滤：默认给 7 会把「查全部」的老调用悄悄截断，排查时看不出少在哪 */
  const start = ctx.query.days ? daysAgo(Number(ctx.query.days)) : ''
  const rows = exportLogs
    .filter(r => !start || r.at.slice(0, 10) >= start)
    .filter(r => eq(r.result, ctx.query.result) && eq(r.operator, ctx.query.operator))
    .filter(r => kwHit([r.name, r.memo, r.operator], ctx.query.kw))
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.logId).localeCompare(String(a.logId)))
  return page(rows, ctx.query)
})

on('GET', '/data-scopes', (ctx) => {
  requirePerm(ctx.user, 'e.org.view', '缺少权限位 e.org.view：无权查看数据范围')
  const ALL = ['全部项目', '指定项目', '本项目', '本部门', '责任范围', '仅本人']
  return {
    rows: ALL.map(ds => {
      const list = roles.filter(r => r.dataScope === ds).map(roleRow)
      return {
        dataScope: ds,
        roleCount: list.length,
        userCount: list.reduce((s, r) => s + r.userCount, 0),
        roles: list.map(r => ({ roleId: r.roleId, name: r.name, userCount: r.userCount }))
      }
    })
  }
})

/* ------------------------------ 组织 CRUD ------------------------------
 * 组织只做「新增 / 修改」，不删除：
 * 删组织要么带着人一起删（等于离职），要么先把人挪走——两种都是组织调整单据，
 * 一个 DELETE 表达不了，硬做的结果是库里留下一批 orgId 指向不存在组织的员工。
 */
const orgSelfCount = orgId => employees.filter(e => (teamOf(e) || e.orgId) === orgId).length
const orgHeadCount = orgId => {
  const s = descOrgs(orgId)
  return employees.filter(e => s.has(teamOf(e) || e.orgId)).length
}
const orgRow = o => ({
  orgId: o.orgId, name: o.name, parentId: o.parentId || '', type: o.type,
  leader: o.leader || '', sort: o.sort || 0,
  headcount: orgHeadCount(o.orgId), selfHeadcount: orgSelfCount(o.orgId)
})

on('GET', '/orgs', (ctx) => {
  requirePerm(ctx.user, 'e.org.view', '缺少权限位 e.org.view：无权查看组织')
  const rows = orgs
    .filter(o => eq(o.type, ctx.query.type) && eq(o.parentId, ctx.query.parentId))
    .filter(o => kwHit([o.name, o.leader, o.orgId], ctx.query.kw))
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(orgRow)
  return { rows }
})

on('POST', '/orgs', (ctx) => {
  requirePerm(ctx.user, 'e.org.edit', '缺少权限位 e.org.edit：无权新增组织')
  const b = ctx.body || {}
  const name = String(b.name || '').trim()
  if (name.length < 2) throw invalid('组织名称至少 2 个字')
  /* 集团与项目要伴随立项/设立一整套动作，不是一个接口能建的 */
  if (!['部门', '班组'].includes(b.type)) throw invalid('只能新增 部门 / 班组；集团与项目由立项流程创建')
  const parent = ORG.get(b.parentId)
  if (!parent) throw notFound('上级组织不存在')
  if (orgs.some(o => o.parentId === b.parentId && o.name === name)) {
    throw conflictUnique(`「${parent.name}」下已有「${name}」，同级不能重名`)
  }
  let id
  if (b.type === '班组') {
    let n = orgs.filter(o => o.parentId === b.parentId && o.type === '班组').length + 1
    id = `${b.parentId}-T${n}`
    while (ORG.has(id)) id = `${b.parentId}-T${++n}`
  } else {
    let n = orgs.filter(o => o.type === '部门').length + 1
    id = 'O-D' + String(n).padStart(2, '0')
    while (ORG.has(id)) id = 'O-D' + String(++n).padStart(2, '0')
  }
  const rec = {
    orgId: id, name, parentId: b.parentId, type: b.type,
    leader: b.leader || '', sort: Number(b.sort) || 99
  }
  orgs.push(rec)
  ORG.set(rec.orgId, rec)
  DESC.clear()
  ctx.status = 201
  return orgRow(rec)
})

on('PATCH', '/orgs/{orgId}', (ctx) => {
  requirePerm(ctx.user, 'e.org.edit', '缺少权限位 e.org.edit：无权修改组织')
  const o = ORG.get(ctx.params.orgId)
  if (!o) throw notFound('组织不存在')
  const b = ctx.body || {}
  if (b.type !== undefined) {
    throw invalid('不能改组织类型：改类型会让下面所有人的归属语义整体变化，走组织调整单据')
  }
  if (b.parentId !== undefined && b.parentId !== o.parentId) {
    if (o.orgId === 'O-ROOT') throw invalid('集团节点不能改上级')
    if (!ORG.has(b.parentId)) throw notFound('上级组织不存在')
    /* 防环：新上级不能是自己或自己的后代，否则整棵子树从树上消失 */
    if (descOrgs(o.orgId).has(b.parentId)) {
      throw invalid('不能把组织挂到它自己的下级下面——会形成环，下面的人就从组织架构里消失了')
    }
  }
  if (b.name !== undefined) {
    const name = String(b.name).trim()
    if (name.length < 2) throw invalid('组织名称至少 2 个字')
    const pid = b.parentId !== undefined ? b.parentId : (o.parentId || '')
    if (orgs.some(x => x.orgId !== o.orgId && x.parentId === pid && x.name === name)) {
      throw conflictUnique(`同级已有「${name}」`)
    }
    o.name = name
  }
  if (b.leader !== undefined) o.leader = String(b.leader)
  if (b.sort !== undefined) o.sort = Number(b.sort) || 0
  if (b.parentId !== undefined) o.parentId = b.parentId
  DESC.clear()   /* 移动后子树缓存失效 */
  bumpVer('org', o.orgId)
  return orgRow(o)
})

/* ------------------------------ HTTP ------------------------------ */
const CORS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
}

function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  const u = new URL(req.url, 'http://localhost')
  const query = Object.fromEntries(u.searchParams.entries())
  let body = {}
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    if (chunks.length) {
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { body = {} }
    }
    const ctx = { query, body, params: {}, user: null, req }
    try {
      const hit = routes.find(r => r.method === req.method && r.re.test(u.pathname))
      if (!hit) throw new ApiError(404, 40400, `接口不存在：${req.method} ${u.pathname}`)
      const m = u.pathname.match(hit.re)
      hit.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]) })
      /* /auth/* 不需要令牌，其余都要 */
      if (!u.pathname.startsWith('/auth/')) ctx.user = auth(req)
      const data = hit.handler(ctx)
      send(res, ctx.status || 200, data)
    } catch (e) {
      sendErr(res, e instanceof ApiError ? e : new ApiError(500, 50000, e?.message || '服务异常'))
    }
  })
}

export function startServer(port = 4010) {
  const server = http.createServer(handler)
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)))
}

const isMain = process.argv[1] && process.argv[1].endsWith('mock-server.mjs')
if (isMain) {
  const port = Number(process.argv[2]) || 4010
  startServer(port).then(() => {
    console.log(`契约假服务已启动：http://127.0.0.1:${port}`)
    console.log(`数据：${owners.length} 业主 / ${houses.length} 房屋 / ${bills.length} 账单 / ${payments.length} 流水 / ${workOrders.length} 工单`)
    console.log(`账号：gm（全部项目）/ pm（本项目 P01）/ steward（责任范围 ${stewardCommunities.join(',')} · ${(EMP.get(stewardEmpId) || {}).name}），密码 123456`)
  })
}
