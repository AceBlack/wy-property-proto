/**
 * 假服务（mock server）· 按 openapi.yaml 跑起来的那一端
 * ----------------------------------------------------------------
 * 为什么不用 Prism 之类现成工具：那些工具按 schema 随机造数据，**业务语义是假的**
 * （退款不会冲回账单、越权不会 403、批量不会部分失败）。这些恰恰是联调时最容易被掩盖的问题。
 * 这里用同一份 fixtures 实现真实语义，让前端在 `VITE_API_MODE=http` 下就能暴露真问题。
 *
 * 启动：node mock-server.mjs [port]     默认 4010
 * 账号：契约测试用 gm / pm / steward / staff；员工端（05）用 zhou-ming / wang-lei / mo-rui / xu-yue。
 *       密码都是 123456。两套账号不合并 —— 契约测试要的是「某角色 + 某数据范围」的稳定样本，
 *       员工端要的是「某个具体的人」，混用会让工单经办人记错人。
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

/* OA 单据与流程定义**不复制一份**：直接读原型的 utils/oa.js，
   避免"前端改了字段、mock 还是旧的"这类只在联调时才发现的问题 */
import { OA_FLOW_DEFS, OA_FORM_DEFS, ASSIGNEE_TYPES, ROLE_CODES } from '../03-原型/src/utils/oa.js'
const readJson = p => JSON.parse(fs.readFileSync(path.join(__dirname, p), 'utf8'))

/* ------------------------------ 数据 ------------------------------ */
const owners = readJson('fixtures/owners.json')
const ownerTags = readJson('fixtures/ownerTags.json')
const houses = readJson('fixtures/houses.json')
const bills = readJson('fixtures/bills.json')
const payments = readJson('fixtures/payments.json')
const workOrders = readJson('fixtures/work-orders.json')
const serviceItems = readJson('fixtures/serviceItems.json')
const employees = readJson('fixtures/employees.json')
const tenants = readJson('fixtures/tenants.json')
/* 抄表记录（1218 条）：待录入 165 是移动端的任务池，见 gen-meter-fixtures.mjs */
const meterReadings = readJson('fixtures/meter-readings.json')
const inspectTasks = readJson('fixtures/inspect-tasks.json')
const rectifyOrders = readJson('fixtures/rectify-orders.json')
const qualityChecks = readJson('fixtures/quality-checks.json')
const communities = readJson('fixtures/communities.json')
const buildings = readJson('fixtures/buildings.json')
const units = readJson('fixtures/units.json')
/* 车位三件套（批次 82）：只导了 60 位业主名下的 45 个车位，见 gen-park-fixtures.mjs */
const parkings = readJson('fixtures/parkings.json')
const vehicles = readJson('fixtures/vehicles.json')
const parkingChangeLogs = readJson('fixtures/parking-change-logs.json')
const contracts = readJson('fixtures/contracts.json')
const notices = readJson('fixtures/notices.json')
const orgs = readJson('fixtures/orgs.json')
const orgLeaders = readJson('fixtures/org-leaders.json')
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

/* 角色 → 权限码。员工端账号用它取授权，**不手写第二个权限清单**：
   手写过一次（下面的 steward），后来 R-STW 加了租售三条，手写的那份就落后了，
   表现为"PC 能点、手机端 403"，查起来像权限码拼错。
   原来这个 map 定义在文件很靠后的位置（权限矩阵那一节），账号段读不到；
   在这里提前定义，后面那处改成复用，不建第二份。 */
const ROLE_PERMS = new Map(roles.map(r => [r.roleId, new Set(r.perms || [])]))
const permsOf = roleId => ROLE_PERMS.get(roleId) || new Set()

/** 按 empId 现算责任范围：房屋从 fixtures 推，别写死（样例一变就是"楼管什么都看不到"） */
function scopeOfEmp(empId) {
  const mine = houses.filter(h => h.stewardEmpId === empId)
  return {
    houseIds: mine.map(h => h.houseId),
    communities: [...new Set(mine.map(h => h.communityId))]
  }
}

const MO_RUI_SCOPE = scopeOfEmp('EM0027')

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
    /* 与种子里 R-STW 一致：楼管能改范围内的业主资料（含打标签），
       但**没有** e.ownerTags.edit —— 字典由平台维护，楼管只能选不能改。
       邻里四项同样照抄 R-STW：只能看（workbench/items/reports/activities.view），
       审核（items.audit）、处理举报（reports.handle）、代报名（activities.enroll）都不给 ——
       这三件在 PC 端也是客服主管的活。所以这个账号同时是"越权 403"的测试样本。 */
    permissions: [
      'a.owners.view', 'a.owners.edit', 'a.sensitive.view', 'b.bills.view',
      'f.workorders.view', 'c.contacts.view',
      'n.workbench.view', 'n.items.view', 'n.reports.view', 'n.activities.view',
      /* 2026-11-06（69 批）：租售这里是例外 —— 楼管就是审核人与回拨人。
         邻里那三项（items.audit / reports.handle / activities.enroll）仍然不给，
         所以这个账号照样是"越权 403"的样本，只是换了一个域。 */
      'a.listings.view', 'a.listings.audit', 'a.listings.viewing'
    ],
    dataScope: '责任范围', communities: stewardCommunities, houseIds: stewardsHouses
  },
  /* 员工自助视角：数据范围「仅本人」。用来验证工资表**不会把全表下发再让前端藏**——
     这类账号最容易被漏测，因为它只在大规模上线后才会被发现「能看到别人的工资」。 */
  staff: {
    password: '123456', empId: 'EM0020', name: (EMP.get('EM0020') || {}).name || '普通员工',
    roleId: 'R-ENG', roleName: '工程维修',
    permissions: ['c.payroll.view', 'f.workorders.view', 'c.contacts.view'],
    dataScope: '仅本人'
  },

  /*
   * 员工端（05-员工端APP）的四个演示身份。
   *
   * 为什么单独四个，不复用上面的 pm / steward：
   *   `pm` 是杜若曦（EM0010），`steward` 是贺文博（EM0031，房屋最多的那位）——
   *   而 App 上演示的是徐悦（EM0008）与莫瑞（EM0027）。
   *   复用的后果不是"少几条数据"，而是**经办人记错人**：莫瑞回拨看房电话，
   *   工单里留下的是"贺文博已联系"，业主打过去找到的是另一个人。
   *
   * 权限一律从 `ROLE_PERMS` 取，与 PC 同一份字典：
   *   两处各写一份的结果是"PC 能点的按钮手机上 403"，而且没人知道该信哪份。
   *
   * `zhou-ming` 的 empId 为空是**数据事实**：周明不在 120 人名册里（计划上的运营设定值）。
   * 所以一线视角按姓名取任务（`?executor=周明`），不编一个工号出来。
   */
  'zhou-ming': {
    password: '123456', empId: '', name: '周明',
    roleId: 'R-ENG', roleName: '工程维修',
    permissions: [...permsOf('R-ENG')],
    /* 「仅本人」+ communities：范围是靠 communities 算的，dataScope 只是标签。
       只写 dataScope 不写 communities，scope() 会得到空集合 —— 什么都看不到 */
    dataScope: '仅本人', communities: ['P01']
  },
  'wang-lei': {
    password: '123456', empId: 'EM0018', name: '汪磊',
    roleId: 'R-SEC', roleName: '部门经理',
    permissions: [...permsOf('R-SEC')],
    dataScope: '本部门', communities: ['P01']
  },
  'mo-rui': {
    password: '123456', empId: 'EM0027', name: '莫瑞',
    roleId: 'R-STW', roleName: '楼栋管家',
    permissions: [...permsOf('R-STW')],
    dataScope: '责任范围',
    communities: MO_RUI_SCOPE.communities, houseIds: MO_RUI_SCOPE.houseIds
  },
  'xu-yue': {
    password: '123456', empId: 'EM0008', name: '徐悦',
    roleId: 'R-PM', roleName: '项目经理',
    permissions: [...permsOf('R-PM')],
    dataScope: '本项目', communities: ['P01']
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
/**
 * 画像里的三项个人敏感信息：列表回掩码，详情回明文（详情由 `/owners/{id}` 且要 a.sensitive.view）。
 * 经济状况 / 政治面貌是**枚举**，按手机号那样保留前后位没有意义，直接整值遮蔽。
 */
const maskEnum = v => (v ? '***' : '')
function ownerRow(o, { mask = true } = {}) {
  const hs = houses.filter(h => h.ownerId === o.ownerId)
  return {
    ...o,
    phone: mask ? maskPhone(o.phone) : o.phone,
    idCard: mask ? maskId(o.idCard) : o.idCard,
    phoneRedacted: mask,
    idCardRedacted: mask,
    economicLevel: mask ? maskEnum(o.economicLevel) : o.economicLevel,
    politicalStatus: mask ? maskEnum(o.politicalStatus) : o.politicalStatus,
    negativeNotes: mask ? maskEnum(o.negativeNotes) : o.negativeNotes,
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
  const cid = p.communityId || (h ? h.communityId : '')
  return {
    ...p,
    communityId: cid,
    communityName: cid ? communityNameOf(cid) : '',
    /* 临时收费既没有房屋也没有车位，承载对象是「付款方」 */
    subjectType: p.tempChargeId ? 'temp' : (p.houseId ? 'house' : (b ? 'park' : '')),
    houseName: h ? h.fullName : '',
    ownerName: o ? o.name : (p.tempPartyName || ''),
    subject: p.tempChargeId ? `临时 · ${p.tempPartyName || '—'}` : (h ? h.fullName : (b ? '车位' : '')),
    itemName: b ? b.itemName : (p.tempItemName || ''),
    period: b ? b.period : '',
    /* 收据与发票是**两个独立状态**（第 64 批）：只开收据的流水仍算"没开发票" */
    receiptStatus: p.receiptStatus || '未开具',
    receiptNo: p.receiptNo || ''
  }
}
function woRow(w) {
  const h = HOUSE.get(w.houseId)
  return {
    ...w,
    /* 新旧两个字段名同时给：业主端 / 员工端按 priceCode 索引价目，契约里叫 serviceItemCode */
    serviceItemCode: w.serviceItemCode || w.priceCode || '',
    serviceName: w.serviceName || '',
    serviceCost: Number(w.serviceCost) || 0,
    buildingId: h ? h.buildingId : '',
    unitId: h ? h.unitId : '',
    _ver: verOf('wo', w.woId)
  }
}

/**
 * 增项汇总。`onlyConfirmed` 只算业主已确认的（**金额口径**）；
 * `pending` 永远数全部未确认的 —— 它回答"还有几笔等业主点头"，不是金额。
 */
function woAddonSum(w, onlyConfirmed = false) {
  const all = Array.isArray(w.addons) ? w.addons : []
  const list = onlyConfirmed ? all.filter(a => a.confirmed) : all
  return {
    material: r2(list.reduce((s, a) => s + (Number(a.material) || 0), 0)),
    labor: r2(list.reduce((s, a) => s + (Number(a.labor) || 0), 0)),
    total: r2(list.reduce((s, a) => s + (Number(a.total) || 0), 0)),
    pending: all.filter(a => !a.confirmed).length,
    count: all.length
  }
}

/*
 * 应收 = 单额 + **已确认**增项。
 * 未确认的算进去，师傅就会去要一笔业主根本没认的钱 —— 这是现场最容易起冲突的地方。
 * 收款、详情、提成三处必须用同一个式子，不能各算各的。
 */
const woDueOf = w => r2(Number(w.totalFee || 0) + woAddonSum(w, true).total)


/* ------------------------------ 租户 / 巡检 / 整改 派生 ------------------------------ */
/**
 * 完整度：个人 / 公司**两套口径**（各 8 项）。
 * 拿个人的 8 项去量公司租户，它永远缺"与业主关系""居住人数"，完整度上不去——
 * 报表里就会出现"公司租户全部不达标"，而其实资料早齐了。
 */
const TENANT_REQUIRED_PERSON = [
  ['name', '姓名'], ['phone', '手机号'], ['idCard', '证件号'], ['relation', '与业主关系'],
  ['residents', '居住人数'], ['emergencyContact', '紧急联系人'],
  ['certified', '实名认证'], ['faceRegistered', '人脸录入']
]
const TENANT_REQUIRED_COMPANY = [
  ['companyName', '公司名称'], ['creditCode', '统一社会信用代码'],
  ['legalPerson', '法定代表人'], ['legalPersonPhone', '法人电话'],
  ['agentName', '经办人'], ['agentPhone', '经办人手机'],
  ['businessCategory', '经营类目'], ['regAddress', '注册地址']
]
const TENANT_BASIC_PERSON = TENANT_REQUIRED_PERSON
  .filter(([k]) => !['certified', 'faceRegistered', 'emergencyContact'].includes(k))
const TENANT_BASIC_COMPANY = ['companyName', 'creditCode', 'legalPerson', 'agentName', 'agentPhone']

function tenantCompleteness(t) {
  const isCo = (t.tenantType || '个人') === '公司'
  const req = isCo ? TENANT_REQUIRED_COMPANY : TENANT_REQUIRED_PERSON
  const basicKeys = isCo ? TENANT_BASIC_COMPANY : TENANT_BASIC_PERSON.map(([k]) => k)
  const empty = k => {
    const v = t[k]
    if (k === 'certified' || k === 'faceRegistered') return !v
    if (k === 'residents') return !(Number(v) > 0)
    return !String(v ?? '').trim()
  }
  const missing = req.filter(([k]) => empty(k)).map(([, label]) => label)
  const missingBasic = req.filter(([k]) => basicKeys.includes(k) && empty(k)).map(([, label]) => label)
  const licenseCount = (t.licenseFiles || []).length
  return {
    total: req.length, filled: req.length - missing.length, missing,
    rate: Math.round((req.length - missing.length) / req.length * 1000) / 10,
    basicTotal: basicKeys.length, basicFilled: basicKeys.length - missingBasic.length, missingBasic,
    /* 影像件单列：不进 8 项分母，但决定能不能核验（见契约 TenantCompleteness.licenseReady） */
    licenseRequired: isCo, licenseCount, licenseReady: !isCo || licenseCount > 0
  }
}

/* 营业执照影像件规则：与前端 TENANT_FILE_RULES 同口径 */
const FILE_RULES = {
  maxCount: 3, maxSizeMB: 5,
  types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  typeText: 'JPG / PNG / WEBP / PDF'
}
function checkFile(body, existing = []) {
  const name = String(body?.name || '').trim()
  if (!name) return '文件名不能为空'
  const type = String(body?.type || '').toLowerCase()
  if (!FILE_RULES.types.includes(type)) return `只支持 ${FILE_RULES.typeText}，当前文件是 ${type || '未知格式'}`
  const size = Number(body?.size) || 0
  if (!size) return '文件是空的，请重新选择'
  if (size > FILE_RULES.maxSizeMB * 1024 * 1024) {
    return `单张不能超过 ${FILE_RULES.maxSizeMB} MB（当前 ${(size / 1024 / 1024).toFixed(1)} MB）`
  }
  if (existing.length >= FILE_RULES.maxCount) return `最多 ${FILE_RULES.maxCount} 张（正本 / 副本 / 变更页足够），请先删掉一张`
  if (existing.some(f => f.name === name && Number(f.size) === size)) return '这张已经传过了'
  return ''
}

/* 统一社会信用代码校验（GB 32100-2015）——字符集去掉 I O S V Z，31 位加权 */
const CC_CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY'
const CC_W = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]
function creditCodeCheck(code) {
  const v = String(code || '').trim().toUpperCase()
  if (!v) return '统一社会信用代码必填'
  if (v.length !== 18) return '统一社会信用代码应为 18 位'
  const bad = [...v].find(c => !CC_CHARS.includes(c))
  if (bad) return `统一社会信用代码含非法字符「${bad}」（不含 I O S V Z）`
  const sum = [...v.slice(0, 17)].reduce((acc, c, i) => acc + CC_CHARS.indexOf(c) * CC_W[i], 0)
  const chk = 31 - (sum % 31)
  const expect = CC_CHARS[chk === 31 ? 0 : chk]
  if (v[17] !== expect) return `统一社会信用代码校验位不对（应为 ${expect}）`
  return ''
}
function tenantRow(t, { mask = true } = {}) {
  const h = HOUSE.get(t.houseId)
  const o = OWNER.get(t.ownerId)
  /* 租金**只对业主开放**（`/mp/houses/{id}/residents`）。后台这条线上是"代收方视角"：
     楼管知道邻居的收入，业主之间就有得吵 —— 契约 `Tenant` 里也没有 rent。
     fixtures 里补 rent 是为了业主端能显示租约金额，别让它从这里漏出去。 */
  const { rent: _rent, ...rest } = t
  return {
    ...rest,
    phone: mask ? maskPhone(t.phone) : t.phone,
    idCard: mask ? maskId(t.idCard) : t.idCard,
    phoneRedacted: mask,
    idCardRedacted: mask,
    /* 影像件一律给数组，不要 undefined：前端 `t.licenseFiles.length` 直接渲染会炸 */
    licenseFiles: (t.licenseFiles || []).map(f => ({ ...f })),
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
  /* pattern 原文也留着：契约测试要拿它跟 openapi.yaml 对账（见 contract-test 的守卫用例） */
  routes.push({ method, pattern, re, keys, handler })
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
      /* 标签筛选：必须在分页前做。放在 map 之后筛，返回的永远是"本页 20 条里命中那几条" */
      if (q.tagId && !(o.tagIds || []).includes(q.tagId)) return false
      return true
    })
    .map(o => ownerRow(o, { mask: true }))
  return page(list, q)
})
/* ---------------- 业主标签字典 ---------------- */
const TAG_OWNER_COUNT = () => {
  const m = new Map()
  for (const o of owners) for (const t of (o.tagIds || [])) m.set(t, (m.get(t) || 0) + 1)
  return m
}
const tagOut = (t) => ({ ...t, ownerCount: TAG_OWNER_COUNT().get(t.tagId) || 0 })

on('GET', '/owner-tags', (ctx) => {
  /* 只要求 a.owners.view：楼管要打标签，就必须先能读到"有哪些可选"。
     要求字典维护权的话，选择弹层对楼管会是一个空列表。 */
  requirePerm(ctx.user, 'a.owners.view', '缺少权限位 a.owners.view：无权读取业主标签字典')
  const q = ctx.query
  const list = ownerTags
    .filter(t => (q.enabled === 'all' ? true : q.enabled === 'true' ? t.enabled : q.enabled === 'false' ? !t.enabled : t.enabled))
    .filter(t => eq(t.category, q.category))
    .filter(t => kwHit([t.name, t.desc, t.tagId], q.kw))
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(tagOut)
  return { rows: list }
})

on('GET', '/owner-tags/stats', (ctx) => {
  requirePerm(ctx.user, 'a.owners.view', '缺少权限位 a.owners.view：无权读取业主标签字典')
  const use = TAG_OWNER_COUNT()
  const tagged = owners.filter(o => (o.tagIds || []).length).length
  return {
    total: ownerTags.length,
    enabled: ownerTags.filter(t => t.enabled).length,
    disabled: ownerTags.filter(t => !t.enabled).length,
    used: ownerTags.filter(t => (use.get(t.tagId) || 0) > 0).length,
    taggedOwners: tagged,
    untaggedOwners: owners.length - tagged
  }
})

on('POST', '/owner-tags', (ctx) => {
  /* 维护字典是 e 域的权限，不是 a 域：楼管能选不能改 */
  requirePerm(ctx.user, 'e.ownerTags.edit', '缺少权限位 e.ownerTags.edit：标签字典由平台维护，不是楼管改的')
  const b = ctx.body || {}
  const name = String(b.name || '').trim()
  if (name.length < 2) throw invalid('标签名称至少 2 个字')
  /* 停用的词条也算占用：否则会出现一个启用一个停用的两个「重点关怀」，打标签的人分不清 */
  if (ownerTags.some(t => t.name === name)) {
    throw conflictUnique(`标签「${name}」已存在（含已停用词条）`)
  }
  if (!['关怀', '风险', '价值', '行为'].includes(b.category)) throw invalid('分类只能是 关怀 / 风险 / 价值 / 行为')
  const seq = ownerTags.reduce((m, t) => Math.max(m, Number(String(t.tagId).replace(/\D/g, '')) || 0), 0) + 1
  const rec = {
    tagId: 'OT' + String(seq).padStart(2, '0'),
    name, category: b.category, color: b.color || 'blue',
    builtin: false, enabled: true,
    sort: ownerTags.reduce((m, t) => Math.max(m, t.sort || 0), 0) + 1,
    desc: String(b.desc || '').trim(), ownerCount: 0
  }
  ownerTags.push(rec)
  ctx.status = 201
  return { ...rec }
})

on('PATCH', '/owner-tags/{tagId}', (ctx) => {
  requirePerm(ctx.user, 'e.ownerTags.edit', '缺少权限位 e.ownerTags.edit：标签字典由平台维护')
  const t = ownerTags.find(x => x.tagId === ctx.params.tagId)
  if (!t) throw notFound('标签不存在')
  const b = ctx.body || {}
  if (b.tagId !== undefined && b.tagId !== t.tagId) throw invalid('tagId 不可修改：业主表引用它，改了历史标签就成孤儿')
  if (b.name !== undefined) {
    const n = String(b.name).trim()
    if (n.length < 2) throw invalid('标签名称至少 2 个字')
    if (ownerTags.some(x => x.tagId !== t.tagId && x.name === n)) throw conflictUnique(`标签「${n}」已存在`)
    t.name = n
  }
  if (b.category !== undefined) {
    if (!['关怀', '风险', '价值', '行为'].includes(b.category)) throw invalid('分类只能是 关怀 / 风险 / 价值 / 行为')
    t.category = b.category
  }
  if (b.color !== undefined) t.color = b.color
  if (b.desc !== undefined) t.desc = String(b.desc).trim()
  if (b.sort !== undefined) t.sort = Number(b.sort) || 0
  if (b.enabled !== undefined) t.enabled = !!b.enabled
  return tagOut(t)
})

on('POST', '/owners/{ownerId}/tags', (ctx) => {
  requirePerm(ctx.user, 'a.owners.edit', '缺少权限位 a.owners.edit：打标签属于业主资料维护')
  const o = OWNER.get(ctx.params.ownerId)
  if (!o) throw notFound('业主不存在')
  if (!inScopeOwner(ctx.user, o.ownerId)) throw forbidden('该业主不在你的数据范围内')
  const tagId = String((ctx.body || {}).tagId || '')
  const t = ownerTags.find(x => x.tagId === tagId)
  if (!t) throw notFound('标签不存在')
  /* 停用只拦"新打"，不拦"已打的保留"，也不拦"摘掉" */
  if (!t.enabled) throw new ApiError(409, 40919, `标签「${t.name}」已停用，不能再打；已打过的不受影响`)
  o.tagIds = o.tagIds || []
  if (o.tagIds.includes(tagId)) throw new ApiError(409, 40920, `「${o.name}」已经有「${t.name}」标签`)
  o.tagIds.push(tagId)
  return { ownerId: o.ownerId, tagIds: [...o.tagIds], tag: tagOut(t) }
})

on('DELETE', '/owners/{ownerId}/tags/{tagId}', (ctx) => {
  requirePerm(ctx.user, 'a.owners.edit', '缺少权限位 a.owners.edit：去标签属于业主资料维护')
  const o = OWNER.get(ctx.params.ownerId)
  if (!o) throw notFound('业主不存在')
  if (!inScopeOwner(ctx.user, o.ownerId)) throw forbidden('该业主不在你的数据范围内')
  o.tagIds = o.tagIds || []
  if (!o.tagIds.includes(ctx.params.tagId)) {
    const t = ownerTags.find(x => x.tagId === ctx.params.tagId)
    throw new ApiError(404, 40409, `「${o.name}」没有「${t ? t.name : ctx.params.tagId}」标签`)
  }
  o.tagIds = o.tagIds.filter(x => x !== ctx.params.tagId)
  return { ownerId: o.ownerId, tagIds: [...o.tagIds] }
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
  /* 客户画像 12 项与基础信息一样走内联编辑；枚举当场校验，脏值不进库 */
  const ALLOWED = ['name', 'phone', 'email', 'emergencyContact', 'emergencyPhone', 'creditLevel', 'remark',
    'ownerCategory', 'economicLevel', 'politicalStatus', 'weddingDate', 'employer', 'jobTitle',
    'occupation', 'workAddress', 'hobbies', 'pets', 'positiveNotes', 'negativeNotes']
  const ENUMS = {
    ownerCategory: ['常住', '候鸟', '投资', '出租业主'],
    economicLevel: ['优渥', '良好', '一般', '困难'],
    politicalStatus: ['中共党员', '共青团员', '群众', '民主党派']
  }
  if (!ALLOWED.includes(field)) throw bad(`字段 ${field} 不支持内联编辑`)
  if (expect !== undefined && Number(expect) !== verOf('owner', o.ownerId)) throw conflictVer()
  if (ENUMS[field] && value !== '' && !ENUMS[field].includes(value)) {
    throw invalid(`${field} 取值非法，只能是 ${ENUMS[field].join(' / ')}`)
  }
  if (field === 'weddingDate' && value && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw invalid('结婚纪念日格式应为 YYYY-MM-DD')
  }
  if (field === 'phone') {
    /* 列表下发的是掩码（138****8001），把掩码当明文提交必须拒 ——
       否则它会被原样落库，这个业主从此登录不了业主端（登录按明文手机号找档案）。
       这不是防"恶意"，是防"前端把展示值回填到输入框"这个最常见的实现错误。 */
    if (!/^1\d{10}$/.test(String(value))) throw invalid('手机号须为 11 位明文，掩码值不能提交')
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

/*
 * 房屋字段内联编辑。
 *
 * 与业主那边同构（白名单 + 枚举校验 + 范围校验），但**不做乐观锁**：
 * 房屋没有一个"版本"概念，而且改动都是低频的静态属性（用途、装修、朝向）。
 * 强行加 ver 会让前端每改一次都要先取版本，收益抵不上复杂度。
 */
const HOUSE_EDITABLE = {
  useStatus: ['已入住', '装修未入住', '正在装修', '已交房未装修', '未交房', '空置房'],
  usage: ['住宅', '公寓', '商业'],
  propertyStatus: ['已办证', '办理中', '未办理', '抵押中'],
  decorationViolation: ['无', '疑似', '已认定', '已整改']
}
const HOUSE_FREE_FIELDS = ['decoration', 'decorationResult', 'orientation', 'certNo', 'remark']
const HOUSE_DATE_FIELDS = ['deliverDate']

on('PATCH', '/houses/{houseId}', (ctx) => {
  const h = HOUSE.get(ctx.params.houseId)
  if (!h) throw notFound('房屋不存在')
  if (!inScopeHouse(ctx.user, h.houseId)) throw forbidden('该房屋不在你的数据范围内')

  const { field, value } = ctx.body || {}
  const v = String(value ?? '').trim()
  const isEnum = Object.prototype.hasOwnProperty.call(HOUSE_EDITABLE, field)
  if (!isEnum && !HOUSE_FREE_FIELDS.includes(field) && !HOUSE_DATE_FIELDS.includes(field)) {
    throw bad(`字段 ${field} 不支持内联编辑`)
  }
  if (isEnum && !HOUSE_EDITABLE[field].includes(v)) {
    throw invalid(`${field} 取值非法，只能是 ${HOUSE_EDITABLE[field].join(' / ')}`)
  }
  if (HOUSE_DATE_FIELDS.includes(field) && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw invalid(`${field} 格式应为 YYYY-MM-DD`)
  }

  /*
   * 使用状态要守住交付边界，两个方向都拦：
   *   · 未交房的房子被标成"已入住" → 它当天就进计费与可出租候选，而钥匙还没交；
   *   · 反过来把已交房的标成"未交房" → 计费停了，但人还住着，账就漏了。
   * 这条不是"校验"，是业务约束——PC 的 updateHouseField 也是这么拦的。
   */
  if (field === 'useStatus') {
    if (h.deliverStatus === '未交房' && v !== '未交房') {
      throw invalid(`${h.fullName} 还未交房，使用状态只能是「未交房」；请先把交付状态改为「已交付」`)
    }
    if (v === '未交房' && h.deliverStatus !== '未交房') {
      throw invalid('「未交房」要连交付状态一起改：请先把交付状态改为「未交房」')
    }
  }

  h[field] = v
  bumpVer('house', h.houseId)
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

/* ---------------- 开票 / 开收据（2026-11-06 第 64 批） ----------------
 * 收据与发票是**两个独立状态**，不是一个"开没开票"：
 *   收据 `receiptStatus` / `receiptNo`（税额恒 0，不是扣税凭证）
 *   发票 `invoiceStatus` / `invoiceNo`（按项目税率）
 * 只开收据的流水**仍然留在待开票池里** —— 它还差一张发票。
 */
const TICKET_TYPES = ['收据', '电子发票', '增值税普通发票']
let TICKET_SEQ = 0

on('POST', '/payments/{payId}/tickets', (ctx) => {
  requirePerm(ctx.user, 'b.invoices.edit', '缺少权限位 b.invoices.edit：无权开票')
  const p = payments.find(x => x.payId === ctx.params.payId)
  if (!p) throw new ApiError(404, 40401, '流水不存在')

  const body = ctx.body || {}
  const types = (Array.isArray(body.types) ? body.types : [body.types || '电子发票'])
    .filter(t => TICKET_TYPES.includes(t))
  if (!types.length) throw invalid(`票据类型只能是 ${TICKET_TYPES.join(' / ')}`)

  const buyerTitle = String(body.buyerTitle || '').trim()
  const itemName = String(body.itemName || '').trim()
  const b = BILL.get(p.billId)
  const created = []
  const skipped = []

  for (const type of types) {
    const isReceipt = type === '收据'
    const done = isReceipt ? p.receiptStatus === '已开具' : p.invoiceStatus === '已开票'
    if (done) { skipped.push(type); continue }
    TICKET_SEQ += 1
    const no = isReceipt
      ? 'SJ' + String(10000000 + TICKET_SEQ)
      : '0264' + String(10000000 + TICKET_SEQ)
    /* 项目名取**这一笔的实际科目**，不写死「物业服务费」——
       临时收费写"物业服务费"是错的，水费写"物业服务费"也是错的 */
    const name = itemName || (b ? b.itemName : '') || p.tempItemName || '物业服务费'
    const inv = {
      ticketId: 'TK' + String(TICKET_SEQ).padStart(6, '0'),
      ticketNo: no, type, isReceipt,
      payId: p.payId,
      tempChargeId: p.tempChargeId || '',
      amount: p.amount,
      /* 收据不产生税额 —— 它不是增值税扣税凭证 */
      taxAmount: isReceipt ? 0 : r2((p.amount || 0) * 0.06),
      /* 购买方三档：手填 > 档案 > 房主。外来缴费人没有档案也没有房主，只能手填 */
      buyerTitle: buyerTitle || (OWNER.get(p.ownerId) || {}).name || p.tempPartyName || '',
      itemName: name,
      communityId: p.communityId || '',
      issueTime: `${DATA_DATE} 10:00`,
      issuer: ctx.user.name,
      status: '已开具'
    }
    if (isReceipt) { p.receiptStatus = '已开具'; p.receiptNo = no }
    else { p.invoiceStatus = '已开票'; p.invoiceNo = no }
    created.push(inv)
  }
  if (!created.length) throw new ApiError(409, 40926, '所选票据都已开具过')
  return { created, skipped, count: created.length }
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
/* ---------------- OA 审批（2026-11-03） ----------------
 * 与「业务实体 + 审批单」的区别：OA 单据**没有业务实体**，内容全在 formData。
 * 所以这里不新建表 —— 复用 approvals，只是 bizId 留空。
 *
 * 本期边界：批准即结束，不落业务结果。
 */
/*
 * 审批单原来只有一个空数组（"跑了才有"），于是员工端审批页切到 HTTP 后三个页签全是 0。
 * 现在读种子（P01 的 42 条），POST 创建的单继续往同一个数组里 push。
 */
const oaRequests = readJson('fixtures/approvals.json')
let AP_SEQ = 100               /* 从 100 起，避免与样例里的 AP0009x 撞号 */
const oaFlows = OA_FLOW_DEFS.map(f => ({
  ...f,
  baseNodes: f.baseNodes.map(n => ({ ...n })),
  overNodes: f.overNodes.map(n => ({ ...n })),
  inFlight: 0
}))
const oaFlowOf = bizType => oaFlows.find(f => f.bizType === bizType) || null

const ROLE_POSITION_MAP = {
  finance: ['财务主管', '会计'], legal: ['会计'], contract: ['会计'], gm: ['总经理'], admin: ['人事专员', '人事主管']
}
/** 审批人解析：一律走负责人关系表（在期正职 → 在期代理），副职不参与 */
function resolveAssignee(node, applicant) {
  switch (node.assigneeType) {
    case 'orgLeader':
      return orgLeaderName(applicant.orgId)
    case 'projectManager': {
      let org = orgs.find(o => o.orgId === applicant.orgId)
      for (let i = 0; org && org.type !== '项目' && org.parentId && i < 8; i++) {
        org = orgs.find(o => o.orgId === org.parentId)
      }
      if (org && org.type === '项目') return orgLeaderName(org.orgId)
      return orgLeaderName('O-ROOT')
    }
    case 'directSuperior':
      return applicant.manager || orgLeaderName(applicant.orgId)
    case 'role': {
      const poss = ROLE_POSITION_MAP[node.roleCode] || []
      const e = employees.find(x => poss.includes(x.position) && x.status !== '离职')
      return e ? e.name : ''
    }
    case 'deptHead':
      return orgLeaderName(node.orgId)
    default:
      return ''
  }
}

function oaNodesFor(bizType, amount) {
  const f = oaFlowOf(bizType)
  if (!f) return []
  const over = Number(f.amountThreshold) > 0 && Number(amount) > Number(f.amountThreshold)
  return (over && f.overNodes.length ? f.overNodes : f.baseNodes)
}

function oaFormCheck(bizType, formData = {}) {
  const def = OA_FORM_DEFS.find(f => f.bizType === bizType)
  if (!def) return `未知单据类型：${bizType}`
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
    if (f.maxlength && String(v).length > f.maxlength) return `${f.label}不超过 ${f.maxlength} 字`
    if (f.type === 'select' && f.options && !f.options.includes(v)) return `${f.label}取值不合法`
  }
  for (const f of def.fields) {
    if (f.role !== 'periodEnd') continue
    if (formData[f.after] && formData[f.key] && String(formData[f.key]) <= String(formData[f.after])) {
      return `${f.label}必须晚于开始时间`
    }
  }
  return ''
}

const oaSummaryOf = (def, fd = {}) => (def.summaryKeys || [])
  .map(k => {
    const f = def.fields.find(x => x.key === k)
    const v = fd[k]
    if (v === undefined || v === null || v === '') return ''
    return f && f.type === 'money' ? `¥${Number(v).toLocaleString('en-US')}` : String(v)
  })
  .filter(Boolean).join(' · ')

const oaRow = a => ({ ...a, waitText: ['待审批', '审批中'].includes(a.status) ? `已等 ${a.waitHours} 小时` : a.status })

on('GET', '/oa/forms', () => OA_FORM_DEFS)

on('GET', '/oa/requests', (ctx) => {
  const q = ctx.query || {}
  const list = oaRequests
    .filter(a => !q.status || a.status === q.status)
    .filter(a => !q.bizType || a.bizType === q.bizType)
    .filter(a => !q.kw || `${a.title}${a.approvalNo}`.toLowerCase().includes(String(q.kw).toLowerCase()))
    .map(oaRow)
  return page(list, q)
})

/* ---------- 员工端审批（列表 / 详情聚合） ---------- */

/*
 * 为什么不能直接用 `/oa/requests`：那是**"我的申请"**视角（按 status/bizType/kw 筛），
 * 而员工端第一个页签是「待我处理」—— 要按**节点审批人**判，跟申请人无关。
 *
 * 判定规则与 `05/src/api/oa.js` 的 `canHandle` 必须一模一样，否则会出现
 * "页面说待你审批、点进去服务端说不是你"。这里照抄那四条纪律：
 *   ① 节点名 → 组织 → 负责人关系表的**在期正职**（空缺落代理，副职不参与单签）
 *   ② 会签看名单里有没有我
 *   ③ 不能审自己提交的单
 *   ④ 只看本项目
 */
const OA_TEAM_OF_LABEL = { 工程主管: 'T2', 客服主管: 'T1', 环境主管: 'T4', 安保主管: 'T3' }
const OA_MOBILE_UNSUPPORTED = [{ key: '合同初审', why: '合同审批在 PC 端办理（含合同正文与附件），移动端只处理业务单据' }]

const oaPendingNode = a => (a.flow || []).find(n => n.action === '待处理') || null

/** 这一单"该谁办"。kind: done / unsupported / sign（会签）/ leader（单人节点）/ role */
function oaTargetOf(a) {
  if (!a) return { kind: 'none', why: '单据不存在' }
  if (!['待审批', '审批中'].includes(a.status)) return { kind: 'done', why: `单据已${a.status}` }

  const cur = String(a.currentNode || '')
  const unsupported = OA_MOBILE_UNSUPPORTED.find(x => cur.includes(x.key))
  if (unsupported) return { kind: 'unsupported', label: unsupported.key, why: unsupported.why }

  const node = oaPendingNode(a)
  const approvers = node?.approvers || []
  const signMode = node?.signMode || 'single'
  const progress = { done: approvers.filter(p => p.action !== '待处理').length, total: approvers.length }

  let orgId = ''
  for (const [label, team] of Object.entries(OA_TEAM_OF_LABEL)) {
    if (cur.includes(label)) { orgId = `O-${a.communityId}-${team}`; break }
  }
  if (!orgId && /项目经理|部门负责人/.test(cur)) orgId = `O-${a.communityId}`
  const signer = orgId ? rankingLeader(orgId) : null

  if (approvers.length) return { kind: 'sign', label: cur, orgId, signer, approvers, signMode, progress }
  if (orgId) return { kind: 'leader', label: cur, orgId, signer, approvers, signMode, progress }
  return { kind: 'role', label: cur, orgId, signer, approvers, signMode, progress }
}

/** 我能不能办这一单 */
function oaCanHandle(u, a) {
  const t = oaTargetOf(a)
  if (t.kind === 'none' || t.kind === 'done' || t.kind === 'unsupported') return false
  if (a.applicant === u.name) return false
  if (a.communityId && !inScopeCommunity(u, a.communityId)) return false
  if (t.kind === 'sign') return t.approvers.some(p => p.name === u.name && p.action === '待处理')
  /* 单人节点只认关系表解出来的那个人；正职空缺落到代理，副职不参与 */
  return !!t.signer && t.signer.name === u.name
}

/** 我办过的：flow 里有我的处理痕迹（含会签名单） */
const oaDoneBy = (u, a) =>
  (a.flow || []).some(n =>
    (n.handler === u.name && n.action && n.action !== '待处理') ||
    (n.approvers || []).some(p => p.name === u.name && p.action !== '待处理')
  )

/* ---------- 员工端欠费与催收 ---------- */

/*
 * 一个接口同时服务两个页面：
 *   - 楼栋首页的「欠费户列表」（按楼栋筛选、只读）
 *   - 催收页的「工作集」（按账龄/费项筛、默认跳过近 7 天已催）
 *
 * 为什么合成一条：两个页面的行是同一个东西（欠费户），差别只在筛选条件。
 * 拆两条会出现"首页显示 12 户、催收页显示 9 户"，用户会怀疑哪边算错了。
 */
const collectionRecords = readJson('fixtures/collection-records.json')
const BILL_DEBT = ['未缴', '部分缴', '逾期']
const RECENT_DAYS = 7

/** 这户最近一次催缴（PC 历史 + 移动端新登记的，取最新一条） */
function lastCollectOf(houseId) {
  const all = [
    ...collectionRecords.filter(r => r.houseId === houseId)
      .map(r => ({ at: r.collectTime, method: r.method, status: r.status, round: r.round, operator: r.operator })),
    ...mobileCollections.filter(c => c.houseId === houseId)
      .map(c => ({ at: c.at, method: c.method, status: c.result, round: 0, operator: c.by }))
  ].filter(r => r.at).sort((a, b) => String(b.at).localeCompare(String(a.at)))
  return all[0] || null
}

const daysGapOf = (from, to) => {
  const a = new Date(String(from).replace(/-/g, '/'))
  const b = new Date(String(to).replace(/-/g, '/'))
  if (isNaN(a) || isNaN(b)) return 999
  return Math.max(0, Math.floor((b - a) / 86400000))
}

on('GET', '/mobile/debts', (ctx) => {
  requirePerm(ctx.user, MT_PERM.stewardView, `缺少权限位 ${MT_PERM.stewardView}：无权查看欠费`)
  const u = ctx.user
  const sc = scope(u)
  const bid = String(ctx.query.buildingId || '')
  const aging = String(ctx.query.aging || '')
  const item = String(ctx.query.item || '')
  /* 默认跳过近 7 天已催：一屏全是"刚催过"的户，等于把今天该打的电话淹掉 */
  const skipRecent = ctx.query.skipRecent === undefined ? true : String(ctx.query.skipRecent) === 'true'

  const scopedHouses = houses.filter(h =>
    sc.all || (sc.houses ? sc.houses.has(h.houseId) : sc.communities.has(h.communityId))
  )
  const houseIds = new Set(scopedHouses.map(h => h.houseId))

  const debtBills = bills.filter(b =>
    houseIds.has(b.houseId) &&
    !['已作废', '已减免'].includes(b.status) &&
    BILL_DEBT.includes(b.status) &&
    (Number(b.unpaid) || 0) > 0 &&
    (!bid || (HOUSE.get(b.houseId) || {}).buildingId === bid)
  )

  /* 按房屋聚合：一户一行，不是一账一行 —— 楼管打电话是打给"这户" */
  const byHouse = new Map()
  for (const b of debtBills) {
    const key = b.houseId
    if (!byHouse.has(key)) {
      const h = HOUSE.get(key) || {}
      const o = OWNER.get(b.ownerId) || {}
      byHouse.set(key, {
        houseId: key,
        houseName: h.fullName || h.name || key,
        buildingId: h.buildingId || '',
        ownerId: b.ownerId,
        ownerName: o.name || '',
        phone: o.phone || '',
        debt: 0,
        maxOverdue: 0,
        items: []
      })
    }
    const row = byHouse.get(key)
    row.debt = r2(row.debt + (Number(b.unpaid) || 0))
    row.maxOverdue = Math.max(row.maxOverdue, Number(b.overdueDays) || 0)
    row.items.push({
      billId: b.billId,
      itemName: b.itemName,
      period: b.period,
      unpaid: Number(b.unpaid) || 0,
      overdueDays: Number(b.overdueDays) || 0
    })
  }

  let rows = [...byHouse.values()].map(r => {
    const last = lastCollectOf(r.houseId)
    return {
      ...r,
      lastCollect: last,
      gapDays: last ? daysGapOf(last.at, DATA_DATE) : 999
    }
  })

  /*
   * 按费项筛时**要截断 items**，不能只过滤行：
   * 楼管选了「水费」，卡片上就该显示这户欠的水费，而不是水费+物业费的合计 ——
   * 否则电话打过去报的数和业主查到的不一致。账龄同理，按该费项的逾期天数算。
   */
  if (item) {
    rows = rows
      .filter(r => r.items.some(x => x.itemName === item))
      .map(r => {
        const items = r.items.filter(x => x.itemName === item)
        return {
          ...r,
          items,
          debt: r2(items.reduce((s2, x) => s2 + (Number(x.unpaid) || 0), 0)),
          maxOverdue: items.reduce((s2, x) => Math.max(s2, Number(x.overdueDays) || 0), 0)
        }
      })
  }
  if (aging) {
    const min = Number(aging) || 0
    rows = rows.filter(r => r.maxOverdue >= min)
  }
  if (skipRecent) rows = rows.filter(r => !(r.lastCollect && r.gapDays < RECENT_DAYS))

  rows.sort((a, b) => b.debt - a.debt)

  /* 汇总永远按**全范围**算，不因为筛了账龄就变小 —— 否则"欠费合计"会随筛选跳动 */
  const validScopedBills = bills.filter(b =>
    houseIds.has(b.houseId) && !['已作废', '已减免'].includes(b.status)
  )
  const payable = r2(validScopedBills.reduce((s2, b) => s2 + (Number(b.payable) || 0), 0))
  const paid = r2(validScopedBills.reduce((s2, b) => s2 + (Number(b.paidAmount) || 0), 0))
  const allDebtRows = [...byHouse.values()]
  const debtAmount = r2(allDebtRows.reduce((s2, r) => s2 + r.debt, 0))

  const byBuilding = new Map()
  for (const h of scopedHouses) {
    const k = h.buildingId || ''
    if (!byBuilding.has(k)) {
      const bd = buildings.find(x => x.buildingId === k) || {}
      byBuilding.set(k, {
        buildingId: k,
        name: bd.name || h.buildingName || k,
        /* 页面要显示"11 层 / 44 户"，缺了这两项卡片会显示 0 */
        floors: Number(bd.floorCount) || 0,
        houses: Number(bd.houseCount) || 0,
        houseCount: 0,
        debtHouseCount: 0,
        debtAmount: 0
      })
    }
    byBuilding.get(k).houseCount += 1
  }
  for (const r of allDebtRows) {
    const x = byBuilding.get(r.buildingId)
    if (x) { x.debtHouseCount += 1; x.debtAmount = r2(x.debtAmount + r.debt) }
  }

  return {
    summary: {
      buildingCount: byBuilding.size,
      houseCount: scopedHouses.length,
      billCount: validScopedBills.length,
      payable,
      paid,
      /* 收缴率：页面直接拿它做 toFixed，缺了会白屏（"undefined.toFixed"） */
      rate: payable ? r2((paid / payable) * 100) : 0,
      debtHouseCount: allDebtRows.length,
      debtHouses: allDebtRows.length,
      debtCount: allDebtRows.reduce((n, r) => n + r.items.length, 0),
      debtAmount
    },
    buildings: [...byBuilding.values()].sort((a, b) => b.debtAmount - a.debtAmount),
    rows,
    total: rows.length
  }
})

/**
 * 能不能对这张单执行审批动作。
 *
 * 与 `oaCanHandle`（列表用）的区别：那个回答"要不要把它放进我的待办"，
 * 这个回答"我现在点同意会不会被服务端放行"。两者共用同一套 targetOf 结论，
 * 但代签规则只在这里——待办列表不该把"我能代签的"都算成我的待办。
 */
function oaCanAct(u, a) {
  if (!a) return { ok: false, why: '审批单不存在' }
  if (!['待审批', '审批中'].includes(a.status)) {
    return { ok: false, why: `当前「${a.status}」，已结束无法处理` }
  }
  if (a.communityId && !inScopeCommunity(u, a.communityId)) {
    return { ok: false, why: '这张单不在你的数据范围内' }
  }

  const t = oaTargetOf(a)
  if (t.kind === 'unsupported') return { ok: false, why: t.why }

  /* ① 名单里的人 / 单人节点的 signer：正常签，但**不能签自己发起的** */
  const inList = t.kind === 'sign'
    ? t.approvers.some(p => p.name === u.name && p.action === '待处理')
    : !!(t.signer && t.signer.name === u.name)
  if (inList) {
    if (a.applicant === u.name) return { ok: false, why: '不能审批自己提交的单据' }
    return { ok: true }
  }

  /*
   * ② 代签：集团总经理、该项目的项目经理。
   *
   * 集团总经理**豁免"不能审自己"** —— 他已经是系统里最高的一档，
   * 没有第二个人能批他的单；严格禁止的结果是他的报销单永远卡在"待审批"。
   * 项目经理不豁免：他上面还有人。
   */
  if (u.roleId === 'R-GM') return { ok: true, proxy: '集团总经理代签' }
  if (a.communityId) {
    const pm = rankingLeader(`O-${a.communityId}`)
    if (pm && pm.name === u.name) {
      if (a.applicant === u.name) return { ok: false, why: '不能审批自己提交的单据' }
      return { ok: true, proxy: '项目经理代签' }
    }
  }

  const who = t.signer?.name || (t.approvers || []).map(p => p.name).filter(Boolean).join('、')
  return { ok: false, why: `这单卡在「${t.label || a.currentNode}」${who ? `，由 ${who} 处理` : ''}，不是你` }
}

on('GET', '/mobile/approvals', (ctx) => {
  requirePerm(ctx.user, MT_PERM.approvalHandle, `缺少权限位 ${MT_PERM.approvalHandle}：无权处理审批`)
  const u = ctx.user
  const tab = String(ctx.query.tab || 'todo')

  const pools = {
    todo: oaRequests.filter(a => oaCanHandle(u, a)),
    applied: oaRequests.filter(a => a.applicant === u.name),
    done: oaRequests.filter(a => oaDoneBy(u, a))
  }
  const LABEL = { todo: '待我处理', applied: '我发起', done: '我办过' }
  if (!pools[tab]) throw bad(`tab 只能是 todo / applied / done，收到「${tab}」`)

  return {
    tabs: ['todo', 'applied', 'done'].map(k => ({ key: k, label: LABEL[k], count: pools[k].length })),
    tab,
    rows: pools[tab].map(oaRow)
  }
})

on('GET', '/mobile/approvals/{approvalId}', (ctx) => {
  requirePerm(ctx.user, MT_PERM.approvalHandle, `缺少权限位 ${MT_PERM.approvalHandle}：无权处理审批`)
  const a = oaRequests.find(x => x.approvalId === ctx.params.approvalId)
  if (!a) throw notFound('审批单不存在')
  if (a.communityId && !inScopeCommunity(ctx.user, a.communityId)) throw forbidden('这张单不在你的数据范围内')

  const t = oaTargetOf(a)
  return {
    approval: oaRow(a),
    actor: { label: t.label || '', kind: t.kind, signer: t.signer || null, orgId: t.orgId || '' },
    target: t,
    sign: t.kind === 'sign' ? { mode: t.signMode, progress: t.progress, approvers: t.approvers } : null,
    canHandle: oaCanHandle(ctx.user, a),
    timeline: (a.flow || []).map((n, i) => ({
      index: i + 1,
      node: n.node,
      handler: n.handler || '',
      action: n.action || '待处理',
      time: n.time || '',
      comment: n.comment || '',
      done: !!n.action && n.action !== '待处理',
      signMode: n.signMode || 'single',
      approvers: n.approvers || []
    }))
  }
})

on('POST', '/oa/requests', (ctx) => {
  const b = ctx.body || {}
  const def = OA_FORM_DEFS.find(f => f.bizType === b.bizType)
  if (!def) throw new ApiError(422, 42211, `不支持的单据类型：${b.bizType}`)
  /* 明细派生金额（2026-11-13）：与 PC 的 createOaRequest 同一规则 ——
     总价 = 单价 × 本次采购数量，金额取合计，客户端传值一律重算 */
  const data = { ...(b.formData || {}) }
  for (const f of def.fields || []) {
    if (f.derived !== 'items') continue
    data[f.key] = r2((Array.isArray(data.items) ? data.items : [])
      .reduce((sum, x) => sum + (Number(x.buyQty) || 0) * (Number(x.price) || 0), 0))
  }
  const bad = oaFormCheck(b.bizType, data)
  if (bad) throw new ApiError(422, 42211, bad)

  /* USERS 里只有 empId/name/roleName，岗位与部门要从员工档案补 */
  const emp = EMP.get(ctx.user.empId) || {}
  const applicant = {
    empId: ctx.user.empId, name: ctx.user.name,
    position: emp.position || '客服专员',
    orgId: emp.orgId || 'O-HEAD',
    manager: emp.manager || ''
  }
  const amountField = def.fields.find(f => f.role === 'amount')
  const amount = amountField ? Number(data[amountField.key]) || 0 : 0
  const nodes = oaNodesFor(b.bizType, amount)
  if (!nodes.length) throw new ApiError(422, 42212, '该单据没有配置审批流')

  AP_SEQ += 1
  const ap = {
    approvalId: 'AP' + String(AP_SEQ).padStart(5, '0'),
    approvalNo: `SP-${DATA_DATE.slice(0, 4)}-${String(AP_SEQ).padStart(4, '0')}`,
    bizType: b.bizType, bizId: '', changeId: '',
    title: `${b.bizType} · ${oaSummaryOf(def, data)}`,
    formData: { ...data },
    files: Array.isArray(b.files) ? b.files : [],
    communityId: data.communityId || '',
    communityName: data.communityId ? communityNameOf(data.communityId) : '集团 / 全项目',
    amount,
    applicant: applicant.name, applicantRole: applicant.position,
    applicantEmpId: applicant.empId, applicantOrgId: applicant.orgId,
    applicantOrgName: (orgs.find(o => o.orgId === applicant.orgId) || {}).name || '',
    applyTime: DATA_DATE,
    status: '待审批', currentNode: nodes[0].name,
    urgency: b.urgency || def.urgentDefault || '普通',
    waitHours: 0,
    flow: nodes.map(n => {
      const list = resolveAssignees(n, applicant)
      return {
        node: n.name,
        signMode: n.signMode || 'single',
        handler: list[0]?.name || '',
        approvers: list.map(p => ({
          name: p.name, empId: p.empId || '', duty: p.duty || '',
          action: '待处理', time: '', comment: ''
        })),
        action: '待处理', time: '', comment: '', limitHours: n.limitHours || 24,
        skipNote: list[0]?.note || ''
      }
    })
  }
  oaRequests.unshift(ap)
  const f = oaFlowOf(b.bizType)
  if (f) f.inFlight += 1
  return { ...ap }
})

/**
 * 审批动作。契约里一直没有这一条 —— 之前只有"发起 / 撤回"，
 * 审批是在页面里点完就完了，后端拿不到规格。会签必须有它才能落地：
 * 一次「同意」只签掉一个人，全部签完才推进下一级。
 */
on('POST', '/oa/requests/{approvalId}/action', (ctx) => {
  const a = oaRequests.find(x => x.approvalId === ctx.params.approvalId)
  if (!a) throw notFound('审批单不存在')
  if (!['待审批', '审批中'].includes(a.status)) {
    throw new ApiError(409, 40928, `当前「${a.status}」，已结束无法处理`)
  }
  const b = ctx.body || {}
  const action = String(b.action || '')
  if (!['同意', '驳回'].includes(action)) throw bad('action 只能是 同意 / 驳回')
  const idx = a.flow.findIndex(n => n.action === '待处理')
  if (idx < 0) throw new ApiError(409, 40928, '没有待处理节点')

  /*
   * 谁能办这一单。
   *
   * 这条校验原来完全没有 —— 任何人拿到 approvalId 就能审别人的单。
   * 但也不能卡到"只认名单里的人"：集团总经理与项目经理本来就有代签权，
   * 而且会签名单里常有副职（副职不参与单签、只参与会签），他们未必有账号。
   * 所以分两层：
   *   ① 名单里的人 / 单人节点的 signer —— 正常签；
   *   ② 集团总经理、该项目的项目经理 —— 允许代签（这是权力不是漏洞）。
   * 其余人一律 403，并告诉他这单卡在谁那里。
   */
  const guard = oaCanAct(ctx.user, a)
  if (!guard.ok) throw forbidden(guard.why)

  const node = a.flow[idx]
  const approvers = Array.isArray(node.approvers) ? node.approvers : []
  const isSign = approvers.length > 0
  const mode = node.signMode || 'single'
  const comment = String(b.comment || '')

  /* 会签先找"我这一份"；角色身份对不上时按第一份代签并注明 */
  let mine = null
  let proxy = ''
  if (isSign) {
    mine = approvers.find(p => p.action === '待处理' && p.name === ctx.user.name) || null
    if (!mine) {
      mine = approvers.find(p => p.action === '待处理') || null
      if (mine) proxy = `（代 ${mine.name} 处理）`
    }
  }

  if (action === '驳回') {
    if (isSign && mine) {
      mine.action = '驳回'; mine.time = DATA_DATE
      mine.comment = (comment || '不符合要求') + proxy
    }
    node.action = '驳回'
    node.handler = mine?.name || node.handler || ctx.user.name
    node.time = DATA_DATE
    node.comment = comment || '不符合要求'
    for (const p of approvers) {
      if (p.action === '待处理') { p.action = '已跳过'; p.comment = '同节点已驳回' }
    }
    a.status = '已驳回'; a.currentNode = '已完成'
    return { ...a }
  }

  if (isSign && mine) { mine.action = '同意'; mine.time = DATA_DATE; mine.comment = (comment || '同意') + proxy }
  else { node.action = '同意'; node.handler = node.handler || ctx.user.name; node.time = DATA_DATE; node.comment = comment || '同意' }

  const pending = isSign ? approvers.filter(p => p.action === '待处理') : []
  const passed = !isSign || mode === 'any' || pending.length === 0
  if (!passed) {
    a.status = '审批中'
    const done = approvers.filter(p => p.action !== '待处理').length
    a.currentNode = `${node.node}（会签 ${done}/${approvers.length}）`
    node.handler = pending[0].name
    return { ...a }
  }
  if (isSign) {
    node.action = '同意'
    node.handler = mine?.name || approvers[0]?.name || ''
    node.time = DATA_DATE
    node.comment = mode === 'any' && approvers.length > 1 ? '或签：一人同意即通过' : `会签：${approvers.length} 人全部同意`
    if (mode === 'any') {
      for (const p of approvers) {
        if (p.action === '待处理') { p.action = '已跳过'; p.comment = '或签，他人已同意' }
      }
    }
  }
  const next = a.flow[idx + 1]
  if (next) { next.action = '待处理'; a.status = '审批中'; a.currentNode = next.node }
  else { a.status = '已通过'; a.currentNode = '已完成' }
  return { ...a }
})

on('POST', '/oa/requests/{approvalId}/withdraw', (ctx) => {
  const a = oaRequests.find(x => x.approvalId === ctx.params.approvalId)
  if (!a) throw notFound('审批单不存在')
  if (a.status !== '待审批') {
    throw new ApiError(409, 40928, `当前「${a.status}」，只有还没人处理的单子可以撤回`)
  }
  const first = a.flow.find(n => n.action === '待处理')
  if (first) {
    first.action = '撤回'; first.handler = a.applicant; first.time = DATA_DATE
    first.comment = ctx.body?.reason || '申请人撤回'
  }
  a.status = '已撤回'; a.currentNode = '已完成'
  const f = oaFlowOf(a.bizType)
  if (f) f.inFlight = Math.max(0, f.inFlight - 1)
  return { ...a }
})

on('GET', '/oa/flows', () => oaFlows.map(f => ({ ...f, inFlight: oaRequests.filter(r => r.bizType === f.bizType && ['待审批', '审批中'].includes(r.status)).length })))

on('PUT', '/oa/flows/{bizType}', (ctx) => {
  const f = oaFlowOf(ctx.params.bizType)
  if (!f) throw notFound('单据类型不存在')
  const b = ctx.body || {}
  const clean = nodes => (nodes || []).map((n, i) => ({
    key: n.key || 'n' + (i + 1),
    name: String(n.name || '').trim() || `节点 ${i + 1}`,
    assigneeType: n.assigneeType || 'orgLeader',
    roleCode: n.roleCode || '', orgId: n.orgId || '',
    /* 签署方式：只有「部门负责人」来源真正生效，其他来源等价于单人 */
    signMode: ['single', 'all', 'any'].includes(n.signMode) ? n.signMode : 'single',
    limitHours: Math.max(1, Number(n.limitHours) || 24),
    allowReject: n.allowReject !== false
  }))
  if (b.baseNodes) {
    const list = clean(b.baseNodes)
    if (!list.length) throw new ApiError(422, 42212, '至少保留一个审批节点')
    f.baseNodes = list
  }
  if (b.overNodes !== undefined) f.overNodes = clean(b.overNodes)
  if (b.amountThreshold !== undefined) f.amountThreshold = Math.max(0, Number(b.amountThreshold) || 0)
  if (b.note !== undefined) f.note = String(b.note)
  if (f.overNodes.length && !f.amountThreshold) {
    throw new ApiError(422, 42212, '配了金额分支节点，但阈值是 0，这套节点永远走不到')
  }
  return { ...f }
})

/* ================= 组织负责人（H 域 · 2026-11-03 第 52 批） =================
 * 一个部门可以有多个负责人：正职唯一、副职可多个、代理必须带结束日期。
 * 审批只认正职，正职空缺才落到在期代理；副职是分工，不参与审批。
 * `orgs.leader` 只是展示快照，判断"谁是审批人"必须读这张表。
 */
const ORG_DUTY = ['正职', '副职', '代理']
let OL_SEQ = orgLeaders.length

const relState = r => {
  if (r.startDate && r.startDate > DATA_DATE) return '未生效'
  if (r.endDate && r.endDate < DATA_DATE) return '已结束'
  return '在期'
}
const relActive = r => relState(r) === '在期'

const leadersOfOrg = orgId => orgLeaders
  .filter(r => r.orgId === orgId)
  .map(r => {
    const e = EMP.get(r.empId) || {}
    const state = relState(r)
    return {
      ...r, name: e.name || r.empId, position: e.position || '',
      empStatus: e.status || '', state, active: state === '在期'
    }
  })
  .sort((a, b) => ({ 正职: 0, 代理: 1, 副职: 2 }[a.duty] - { 正职: 0, 代理: 1, 副职: 2 }[b.duty]))

/** 部门当前审批人：在期正职 → 在期代理（结束日最晚的）→ 快照兜底 */
function rankingLeader(orgId) {
  const list = leadersOfOrg(orgId).filter(r => r.active)
  const zheng = list.find(r => r.duty === '正职')
  if (zheng) return zheng
  const proxies = list.filter(r => r.duty === '代理')
  if (!proxies.length) return null
  return proxies.sort((a, b) => String(b.endDate || '9999').localeCompare(String(a.endDate || '9999')))[0]
}
function orgLeaderName(orgId) {
  return rankingLeader(orgId)?.name || (orgs.find(o => o.orgId === orgId) || {}).leader || ''
}

/** 把当前审批人回写到 orgs.leader 快照（组织树、被检班组都读它） */
function syncOrgLeaderSnapshot(orgId) {
  const o = orgs.find(x => x.orgId === orgId)
  if (!o) return
  const hit = rankingLeader(orgId)
  o.leaderEmpId = hit ? hit.empId : ''
  o.leader = hit ? hit.name : ''
}

on('GET', '/orgs/{orgId}/leaders', (ctx) => {
  if (!orgs.some(o => o.orgId === ctx.params.orgId)) throw notFound('组织不存在')
  return leadersOfOrg(ctx.params.orgId)
})

on('GET', '/employees/leader-options', () => employees
  .filter(e => e.status !== '离职')
  .map(e => ({
    empId: e.empId, name: e.name, position: e.position, orgId: e.orgId,
    orgName: (orgs.find(o => o.orgId === e.orgId) || {}).name || '', status: e.status
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'zh')))

on('PUT', '/orgs/{orgId}/leaders', (ctx) => {
  const orgId = ctx.params.orgId
  if (!orgs.some(o => o.orgId === orgId)) throw notFound('组织不存在')
  const list = Array.isArray((ctx.body || {}).leaders) ? ctx.body.leaders : []

  const clean = list.map((x, i) => {
    const emp = EMP.get(x.empId)
    if (!emp) throw new ApiError(422, 42213, `第 ${i + 1} 行员工不存在`)
    if (emp.status === '离职') throw new ApiError(422, 42213, `「${emp.name}」已离职，不能设为负责人`)
    if (!ORG_DUTY.includes(x.duty)) throw new ApiError(422, 42214, '职责只能是正职 / 副职 / 代理')
    const startDate = String(x.startDate || '')
    const endDate = String(x.endDate || '')
    if (startDate && endDate && endDate < startDate) {
      throw new ApiError(422, 42213, '结束日期不能早于开始日期')
    }
    if (x.duty === '代理' && !endDate) {
      throw new ApiError(422, 42213, '代理必须填结束日期（到期自动失效，不需要人工收回）')
    }
    return {
      id: x.id || '', empId: x.empId, duty: x.duty,
      startDate, endDate, note: String(x.note || '').trim()
    }
  })
  const zheng = clean.filter(x => x.duty === '正职' && relActive(x))
  if (zheng.length > 1) throw new ApiError(409, 40927, '同一部门只能有一个在期正职')

  const others = orgLeaders.filter(r => r.orgId !== orgId)
  orgLeaders.length = 0
  orgLeaders.push(...others)
  for (const x of clean) {
    if (x.id) {
      const old = orgLeaders.find(r => r.id === x.id)
      if (old) { Object.assign(old, x); continue }
    }
    OL_SEQ += 1
    orgLeaders.push({ id: 'OL' + String(OL_SEQ).padStart(4, '0'), orgId, ...x })
  }
  syncOrgLeaderSnapshot(orgId)
  return leadersOfOrg(orgId)
})

/* ================= 计划模板（T 域 · 2026-11-03 第 54 批） =================
 * 考核项的唯一源：五套业务模板 + 一个职能兜底。填报人不改模板，只填实际完成情况。
 *
 * 三条口径与原型完全一致（2026-11-05 第 60 批起模板里不再有权重）：
 *   ① 模板只管「考什么、怎么算分」，**权重在计划里由提报人填**；
 *   ② 校验只看内容完整性：名称、适用类型、量化段与重点段不能为空；
 *   ③ 提报时整份拷贝成快照，模板改动不影响已经提报的计划。
 */
const planTpls = readJson('fixtures/plan-templates.json')
let TPL_SEQ = 0

const TPL_SECTIONS = [
  { key: 'q', name: '量化指标' },
  { key: 'm', name: '监控指标' },
  { key: 'k', name: '重点工作计划' }
]
const tplR2 = n => Math.round((Number(n) || 0) * 100) / 100

/** 模板校验：返回错误清单而不是抛第一个 —— 页面要一次列全，改一处试一次太慢 */
/** 模板校验只关心「考什么」：权重不在模板里了（第 60 批搬到计划上） */
function planTplCheck(t) {
  const errs = []
  const items = (t.items || []).filter(i => i.enabled !== false)

  if (!String(t.name || '').trim()) errs.push('模板名称不能为空')
  if (!['项目', '班组', '职能'].includes(t.matchType)) errs.push('适用类型只能选项目 / 班组 / 职能')
  if (t.matchType === '班组' && !/^[1-4]$/.test(String(t.matchSuffix || ''))) {
    errs.push('适用班组要指定是哪一个（T1 客服 / T2 工程 / T3 秩序 / T4 环境）')
  }
  for (const sec of TPL_SECTIONS) {
    const rows = items.filter(i => i.section === sec.key)
    if (rows.some(i => !String(i.name || '').trim())) errs.push(`${sec.name}有条目没填名称`)
    if (rows.some(i => String(i.name || '').trim().length > 40)) errs.push(`${sec.name}有条目名称超过 40 字`)
    /* 量化段和重点段是计分主体；监控段允许为空 */
    if (sec.key !== 'm' && !rows.length) errs.push(`${sec.name}至少要有一条考核项`)
  }
  return { ok: errs.length === 0, errs }
}

const tplRow = (t) => {
  const items = t.items || []
  const by = k => items.filter(i => i.section === k)
  const chk = planTplCheck(t)
  return {
    ...t,
    qCount: by('q').length, mCount: by('m').length, kCount: by('k').length,
    totalCount: items.length,
    checkOk: chk.ok, checkErrs: chk.errs
  }
}

const tplOf = id => planTpls.find(t => t.tplId === id)
const tplMust = (id) => {
  const t = tplOf(id)
  if (!t) throw notFound('计划模板不存在')
  return t
}

function tplCleanItems(items = []) {
  const used = new Set()
  return items.map((x) => {
    let id = x.itemId || ''
    if (!id || used.has(id)) { TPL_SEQ += 1; id = 'PI' + String(TPL_SEQ).padStart(4, '0') }
    used.add(id)
    return {
      itemId: id,
      section: ['q', 'm', 'k'].includes(x.section) ? x.section : 'k',
      name: String(x.name || '').trim(),
      standard: String(x.standard || '').trim(),
      direction: x.direction === -1 ? -1 : 1,
      targetDefault: (x.targetDefault === '' || x.targetDefault === undefined || x.targetDefault === null)
        ? '' : Number(x.targetDefault),
      unit: String(x.unit || '').trim(),
      enabled: x.enabled !== false
    }
  })
}

/* 注意 /plan-templates/match 必须注册在 /plan-templates/{tplId} 之前 ——
   同一段数时先注册的赢，否则 tplId 会收到字符串 'match'（第 52 批踩过）。 */
on('GET', '/plan-templates/match', (ctx) => {
  const orgId = String((ctx.query || {}).orgId || '')
  const o = orgs.find(x => x.orgId === orgId)
  if (!o) throw notFound('组织不存在')
  const on = planTpls.filter(t => t.enabled)
  let hit = null
  if (o.type === '项目') hit = on.find(t => t.matchType === '项目')
  else if (o.type === '班组') {
    const sfx = String(orgId).split('-T')[1] || ''
    hit = on.find(t => t.matchType === '班组' && t.matchSuffix === sfx)
      || on.find(t => t.matchType === '职能')
  } else hit = on.find(t => t.matchType === '职能')
  return hit ? tplRow(hit) : null
})

on('GET', '/plan-templates/stats', () => {
  const rows = planTpls.map(tplRow)
  return {
    total: rows.length,
    enabled: rows.filter(t => t.enabled).length,
    disabled: rows.filter(t => !t.enabled).length,
    items: rows.reduce((s, t) => s + t.totalCount, 0),
    broken: rows.filter(t => !t.checkOk).length
  }
})

on('GET', '/plan-templates', (ctx) => {
  const q = ctx.query || {}
  const kw = String(q.kw || '')
  return planTpls
    .filter(t => !q.onlyEnabled || t.enabled)
    .filter(t => !kw || `${t.name}${t.desc}${t.items.map(i => i.name).join('')}`.includes(kw))
    .map(tplRow)
})

on('GET', '/plan-templates/{tplId}', (ctx) => tplRow(tplMust(ctx.params.tplId)))

on('POST', '/plan-templates', (ctx) => {
  if (!planPerm(ctx.user, 'f.planTpl.edit')) throw forbidden('没有计划模板维护权限')
  const b = ctx.body || {}
  const items = tplCleanItems(b.items)
  const draft = {
    name: String(b.name || '').trim(),
    desc: String(b.desc || '').trim(),
    matchType: b.matchType || '班组',
    matchSuffix: String(b.matchSuffix || ''),
    items
  }
  const chk = planTplCheck(draft)
  if (!chk.ok) throw new ApiError(422, 42214, chk.errs[0])

  const same = planTpls.find(t => t.matchType === draft.matchType && String(t.matchSuffix) === String(draft.matchSuffix))
  if (same) throw new ApiError(409, 40929, `已经有一个「${same.name}」管这一类部门了，同一类不能配两个模板`)

  const t = {
    tplId: 'PT' + String(planTpls.length + 1).padStart(2, '0'),
    ...draft, enabled: true, version: 1,
    updatedAt: DATA_DATE, updatedBy: ctx.user.name
  }
  planTpls.push(t)
  return tplRow(t)
})

on('PATCH', '/plan-templates/{tplId}', (ctx) => {
  if (!planPerm(ctx.user, 'f.planTpl.edit')) throw forbidden('没有计划模板维护权限')
  const t = tplMust(ctx.params.tplId)
  const b = ctx.body || {}
  const draft = {
    name: b.name !== undefined ? String(b.name).trim() : t.name,
    desc: b.desc !== undefined ? String(b.desc).trim() : t.desc,
    matchType: b.matchType !== undefined ? b.matchType : t.matchType,
    matchSuffix: b.matchSuffix !== undefined ? String(b.matchSuffix) : t.matchSuffix,
    items: b.items !== undefined ? tplCleanItems(b.items) : t.items
  }
  const chk = planTplCheck(draft)
  if (!chk.ok) throw new ApiError(422, 42214, chk.errs[0])
  Object.assign(t, draft, {
    version: (t.version || 1) + 1,
    updatedAt: DATA_DATE,
    updatedBy: ctx.user.name
  })
  return tplRow(t)
})

on('PATCH', '/plan-templates/{tplId}/enabled', (ctx) => {
  if (!planPerm(ctx.user, 'f.planTpl.edit')) throw forbidden('没有计划模板维护权限')
  const t = tplMust(ctx.params.tplId)
  t.enabled = !!(ctx.body || {}).enabled
  t.updatedAt = DATA_DATE
  t.updatedBy = ctx.user.name
  return tplRow(t)
})

/* ================= 办公资产（K 域 · 2026-11-04 第 58 批） =================
 * 与 D 域「设备台账」不是一回事：那边管门禁/摄像头这类 IoT 设备（看「在不在线」），
 * 这里管电脑/桌椅/工具这类可被个人领用的办公物品（看「值多少、在哪个部门」）。
 *
 * 口径（后端实现时别丢）：
 *  ① `assetNo` 服务端生成、**永不可改** —— 标签已经贴在实物上；
 *  ② 分类改名**不回写资产**：资产上存 catName / catPath 快照；
 *  ③ 分类最多两级，改上级不能挂到自己的子孙下，同级不能重名；
 *  ④ 有子分类或有资产的分类不给删（409/40927），只能停用；
 *  ⑤ `status` 是**描述性字段**，本期无单据流，不能拿它推断「资产在哪」；
 *  ⑥ 扫码公开接口 `/public/assets/{token}` **免登录**，只回白名单字段：
 *     使用部门可以给，使用人姓名 / 原值 / 供应商 / 序列号 / 备注一律不给。
 */
const assetCats = readJson('fixtures/asset-categories.json')
const assets = readJson('fixtures/assets.json')

const ASSET_STATUS_LIST = ['闲置', '在用', '报废']
const ASSET_LOG = []          /* 变更记录：{ logId, assetId, at, by, field, fieldLabel, before, after } */
let AL_SEQ = 0
let AS_SEQ = assets.length
let AC_SEQ = assetCats.length

const ASSET_FIELD_LABEL = {
  name: '名称', catId: '分类', assetCode: '资产编码', brand: '品牌', model: '型号', sn: '序列号',
  buyDate: '购置日期', price: '购置原值', vendor: '供应商', warrantyEnd: '保修到期',
  holderEmpId: '使用人', orgId: '使用部门', location: '存放位置', status: '状态', remark: '备注',
  files: '设备图片'
}

/* ---------------- 设备图片（附件） ----------------
 * 存在资产的 `files` 里（kind='image'），不单独开表：图片脱离资产没有意义。
 * 三条限制与原型同一套数字：最多 6 张、单张 ≤ 5MB、只收 jpeg/png/webp/gif。
 * 后端实现时注意：真实系统应存对象存储的 URL，**不要**把 base64 塞进数据库行里。
 */
const ASSET_FILE_MAX = 6
const ASSET_FILE_MAX_SIZE = 5 * 1024 * 1024

function assetCleanFiles(list, user) {
  const arr = Array.isArray(list) ? list : []
  if (arr.length > ASSET_FILE_MAX) throw invalid(`设备图片最多 ${ASSET_FILE_MAX} 张，先删掉几张再传`)
  return arr.map((f, i) => {
    const name = String(f.name || '').trim()
    if (!name) throw invalid(`第 ${i + 1} 张图片没有文件名`)
    const url = String(f.url || '')
    /* svg 只可能来自种子示例图；上传口子不开，但数据层要认 */
    const okUrl = /^data:image\/(jpeg|png|webp|gif|svg\+xml);base64,/i.test(url) || /^https?:\/\//i.test(url)
    if (!okUrl) throw invalid(`「${name}」不是有效的图片数据，请重新选择文件`)
    const size = Number(f.size) || 0
    if (size > ASSET_FILE_MAX_SIZE) {
      throw invalid(`「${name}」${(size / 1024 / 1024).toFixed(1)}MB，超过 ${ASSET_FILE_MAX_SIZE / 1024 / 1024}MB 上限`)
    }
    return {
      fileId: String(f.fileId || `AF${Date.now().toString(36)}${i}`),
      kind: 'image', name, url, size,
      mime: String(f.mime || '').trim(),
      at: String(f.at || DATA_DATE),
      by: String(f.by || (user && user.name) || '')
    }
  })
}

/** 日志里只写张数和文件名：base64 写进去会把变更记录撑成乱码 */
const assetFilesBrief = list => {
  const arr = Array.isArray(list) ? list : []
  return arr.length ? `${arr.length} 张：${arr.map(f => f.name).join('、')}` : ''
}

const catOf = catId => assetCats.find(c => c.catId === catId) || null

function catPathOf(catId) {
  const chain = []
  let cur = catOf(catId)
  let guard = 0
  while (cur && guard++ < 6) {
    chain.unshift(cur.name)
    cur = cur.parentId ? catOf(cur.parentId) : null
  }
  return chain.join(' / ')
}

function catDepthOf(catId) {
  let n = 0
  let cur = catOf(catId)
  let guard = 0
  while (cur && guard++ < 6) { n += 1; cur = cur.parentId ? catOf(cur.parentId) : null }
  return n
}

function assetsUnder(catId) {
  const ids = new Set([catId])
  let added = true
  while (added) {
    added = false
    for (const c of assetCats) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.catId)) { ids.add(c.catId); added = true }
    }
  }
  return assets.filter(a => ids.has(a.catId))
}

function assetCatRow(c) {
  const kids = assetCats.filter(x => x.parentId === c.catId)
  return {
    ...c,
    catPath: catPathOf(c.catId),
    depth: catDepthOf(c.catId),
    leaf: kids.length === 0,
    childCount: kids.length,
    assetCount: assets.filter(a => a.catId === c.catId).length,
    assetCountAll: assetsUnder(c.catId).length,
    canDelete: kids.length === 0 && assets.every(a => a.catId !== c.catId)
  }
}

function assetHolderName(empId) {
  const e = employees.find(x => x.empId === empId)
  return e ? e.name : ''
}

function assetOrgName(orgId) {
  return orgId ? ((orgs.find(o => o.orgId === orgId) || {}).name || orgId) : ''
}

function assetRow(a) {
  return {
    ...a,
    holderName: assetHolderName(a.holderEmpId),
    orgName: assetOrgName(a.orgId),
    catName: a.catName || (catOf(a.catId)?.name || ''),
    catPath: a.catPath || catPathOf(a.catId),
    logs: ASSET_LOG.filter(l => l.assetId === a.assetId)
  }
}

function assetLog(a, field, label, before, after, by) {
  AL_SEQ += 1
  ASSET_LOG.unshift({
    logId: 'AL' + String(AL_SEQ).padStart(5, '0'),
    assetId: a.assetId, at: `${DATA_DATE} 10:00`, by: by || '',
    field, fieldLabel: label, before: String(before ?? ''), after: String(after ?? '')
  })
}

/* ---------------- 分类 ---------------- */
on('GET', '/asset-categories/tree', (ctx) => {
  requirePerm(ctx.user, 'c.assets.view', '缺少权限位 c.assets.view：无权查看资产')
  return assetCatTreeOf()
})

on('GET', '/asset-categories', (ctx) => {
  requirePerm(ctx.user, 'c.assets.view', '缺少权限位 c.assets.view：无权查看资产')
  return assetCats.map(assetCatRow).sort((a, b) => (a.parentId || '').localeCompare(b.parentId || '') || a.sort - b.sort)
})

function assetCatTreeOf() {
  const all = assetCats.map(assetCatRow).sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, 'zh'))
  const byId = new Map(all.map(c => [c.catId, { ...c, children: [] }]))
  const roots = []
  for (const n of byId.values()) {
    if (n.parentId && byId.has(n.parentId)) byId.get(n.parentId).children.push(n)
    else roots.push(n)
  }
  return roots
}

on('GET', '/asset-categories/options', (ctx) => {
  requirePerm(ctx.user, 'c.assets.view', '缺少权限位 c.assets.view：无权查看资产')
  const out = []
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      out.push({ value: n.catId, label: `${depth ? '　'.repeat(depth) : ''}${n.name}`, depth, disabled: !n.enabled })
      walk(n.children || [], depth + 1)
    }
  }
  walk(assetCatTreeOf(), 0)
  return out
})

on('GET', '/asset-categories/{catId}', (ctx) => {
  requirePerm(ctx.user, 'c.assets.view', '缺少权限位 c.assets.view：无权查看资产')
  const c = catOf(ctx.params.catId)
  if (!c) throw notFound('分类不存在')
  return assetCatRow(c)
})

function assertCatPayload(body, catId) {
  const name = String(body.name || '').trim()
  if (!name) throw invalid('分类名称不能为空')
  if (name.length > 12) throw invalid('分类名称不超过 12 个字')
  const pid = String(body.parentId || '')
  if (pid) {
    if (!catOf(pid)) throw notFound('上级分类不存在')
    if (catDepthOf(pid) >= 2) throw invalid('分类最多 2 级：三级分类在录入时选不出来，实际也用不到')
  }
  if (catId && pid) {
    let walker = catOf(pid)
    let guard = 0
    while (walker && guard++ < 8) {
      if (walker.catId === catId) throw invalid('不能把分类挂到它自己的下级里（会形成环）')
      walker = walker.parentId ? catOf(walker.parentId) : null
    }
  }
  const dup = assetCats.find(c => c.catId !== catId && (c.parentId || '') === pid && c.name === name)
  if (dup) throw invalid(`同级已存在「${name}」（${dup.catId}），换个名字或改上级`)
  return { name, parentId: pid, prefix: String(body.prefix || '').trim().toUpperCase(), sort: Number(body.sort) || 10, note: String(body.note || '').trim() }
}

on('POST', '/asset-categories', (ctx) => {
  requirePerm(ctx.user, 'c.assetCats.edit', '缺少权限位 c.assetCats.edit：无权维护资产分类')
  const p = assertCatPayload(ctx.body || {})
  AC_SEQ += 1
  const rec = { catId: 'AC' + String(AC_SEQ).padStart(4, '0'), ...p, enabled: true, createdAt: DATA_DATE }
  assetCats.push(rec)
  return assetCatRow(rec)
})

on('PATCH', '/asset-categories/{catId}', (ctx) => {
  requirePerm(ctx.user, 'c.assetCats.edit', '缺少权限位 c.assetCats.edit：无权维护资产分类')
  const c = catOf(ctx.params.catId)
  if (!c) throw notFound('分类不存在')
  const p = assertCatPayload(ctx.body || {}, c.catId)
  Object.assign(c, p)
  return assetCatRow(c)
})

on('POST', '/asset-categories/{catId}/toggle', (ctx) => {
  requirePerm(ctx.user, 'c.assetCats.edit', '缺少权限位 c.assetCats.edit：无权维护资产分类')
  const c = catOf(ctx.params.catId)
  if (!c) throw notFound('分类不存在')
  c.enabled = !c.enabled
  return assetCatRow(c)
})

on('POST', '/asset-categories/{catId}/remove', (ctx) => {
  requirePerm(ctx.user, 'c.assetCats.edit', '缺少权限位 c.assetCats.edit：无权维护资产分类')
  const c = catOf(ctx.params.catId)
  if (!c) throw notFound('分类不存在')
  const kids = assetCats.filter(x => x.parentId === c.catId)
  if (kids.length) throw new ApiError(409, 40927, `「${c.name}」下还有 ${kids.length} 个子分类，先删或移走子分类`)
  const used = assets.filter(a => a.catId === c.catId).length
  if (used) throw new ApiError(409, 40927, `「${c.name}」下还有 ${used} 件资产，先把资产改成别的分类（或停用分类）`)
  assetCats.splice(assetCats.findIndex(x => x.catId === c.catId), 1)
  return { catId: c.catId, removed: true }
})

/* ---------------- 资产 ---------------- */
on('GET', '/assets', (ctx) => {
  requirePerm(ctx.user, 'c.assets.view', '缺少权限位 c.assets.view：无权查看资产')
  const q = ctx.query || {}
  let list = assets.map(assetRow)
  if (q.catId) {
    const hit = new Set(assetsUnder(q.catId).map(a => a.assetId))
    list = list.filter(a => hit.has(a.assetId))
  }
  if (q.status) list = list.filter(a => a.status === q.status)
  if (q.orgId) list = list.filter(a => a.orgId === q.orgId)
  if (q.kw) {
    const k = String(q.kw)
    list = list.filter(a => `${a.name}${a.assetNo}${a.assetCode}${a.sn}${a.brand}${a.model}${a.holderName}${a.location}`.includes(k))
  }
  list.sort((a, b) => String(b.buyDate || '').localeCompare(String(a.buyDate || '')) || a.assetNo.localeCompare(b.assetNo))
  return page(list, q)
})

on('GET', '/assets/summary', (ctx) => {
  requirePerm(ctx.user, 'c.assets.view', '缺少权限位 c.assets.view：无权查看资产')
  const rows = assets.map(assetRow)
  const totalValue = Math.round(rows.reduce((s, a) => s + (Number(a.price) || 0), 0) * 100) / 100
  const byStatus = ASSET_STATUS_LIST.map(s => ({ status: s, count: rows.filter(a => a.status === s).length }))
  return {
    total: rows.length,
    totalValue,
    idle: byStatus.find(x => x.status === '闲置').count,
    inUse: byStatus.find(x => x.status === '在用').count,
    scrapped: byStatus.find(x => x.status === '报废').count,
    byStatus,
    warrantySoon: 0,
    warrantyExpired: 0,
    catCount: assetCats.filter(c => c.enabled).length,
    noCat: 0
  }
})

on('GET', '/assets/by-category', (ctx) => {
  requirePerm(ctx.user, 'c.assets.view', '缺少权限位 c.assets.view：无权查看资产')
  return assetCats
    .filter(c => !assetCats.some(x => x.parentId === c.catId))
    .map(c => ({
      catId: c.catId, name: c.name, catPath: catPathOf(c.catId), depth: catDepthOf(c.catId),
      count: assets.filter(a => a.catId === c.catId).length,
      value: Math.round(assets.filter(a => a.catId === c.catId).reduce((s, a) => s + (Number(a.price) || 0), 0) * 100) / 100
    }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count)
})

on('GET', '/assets/{assetId}', (ctx) => {
  requirePerm(ctx.user, 'c.assets.view', '缺少权限位 c.assets.view：无权查看资产')
  const a = assets.find(x => x.assetId === ctx.params.assetId)
  if (!a) throw notFound('资产不存在')
  return assetRow(a)
})

on('POST', '/assets', (ctx) => {
  requirePerm(ctx.user, 'c.assets.edit', '缺少权限位 c.assets.edit：无权维护资产')
  const b = ctx.body || {}
  const name = String(b.name || '').trim()
  if (!name) throw invalid('资产名称不能为空')
  const cat = catOf(String(b.catId || ''))
  if (!cat) throw invalid('请选择资产分类')
  if (!cat.enabled) throw invalid(`分类「${cat.name}」已停用，换一个分类或先启用它`)
  const status = String(b.status || '闲置')
  if (!ASSET_STATUS_LIST.includes(status)) throw invalid(`状态只能是 ${ASSET_STATUS_LIST.join(' / ')}`)

  AS_SEQ += 1
  const year = String(DATA_DATE).slice(0, 4)
  const prefix = `ZC${year}`
  const max = assets
    .filter(a => String(a.assetNo).startsWith(prefix))
    .reduce((m, a) => Math.max(m, Number(String(a.assetNo).slice(prefix.length)) || 0), 0)
  const assetNo = prefix + String(max + 1).padStart(4, '0')
  const id = 'AS' + String(AS_SEQ).padStart(4, '0')
  /* 16 位 token：与编号无关。编号能顺序推，token 不能 —— 否则改一个字符就能枚举全公司的资产 */
  const rawTok = Buffer.from(id + assetNo + DATA_DATE).toString('base64url').replace(/[^A-Za-z0-9]/g, '')
  const seqTok = (rawTok + 'XDkb3mQz9fHn7RtaBcEf').slice(0, 16)

  const rec = {
    assetId: id,
    assetNo,
    name,
    catId: cat.catId,
    catName: cat.name,
    catPath: catPathOf(cat.catId),
    assetCode: String(b.assetCode || '').trim(),
    brand: String(b.brand || '').trim(),
    model: String(b.model || '').trim(),
    sn: String(b.sn || '').trim(),
    buyDate: String(b.buyDate || ''),
    price: b.price === '' || b.price === undefined ? null : Number(b.price),
    vendor: String(b.vendor || '').trim(),
    warrantyEnd: String(b.warrantyEnd || ''),
    holderEmpId: String(b.holderEmpId || ''),
    orgId: String(b.orgId || ''),
    location: String(b.location || '').trim(),
    status,
    remark: String(b.remark || '').trim(),
    files: assetCleanFiles(b.files, ctx.user),
    qrToken: seqTok,
    createdAt: `${DATA_DATE} 10:00`,
    createdBy: ctx.user.name || '',
    _ver: 1
  }
  assets.push(rec)
  assetLog(rec, 'create', '新增资产', '', `${name}（${assetNo}）`, ctx.user.name)
  return assetRow(rec)
})

on('PATCH', '/assets/{assetId}', (ctx) => {
  requirePerm(ctx.user, 'c.assets.edit', '缺少权限位 c.assets.edit：无权维护资产')
  const a = assets.find(x => x.assetId === ctx.params.assetId)
  if (!a) throw notFound('资产不存在')
  const b = ctx.body || {}
  if (b.ver !== undefined && Number(b.ver) !== Number(a._ver || 1)) {
    throw new ApiError(409, 40901, '该资产已被他人修改，请刷新后重试')
  }
  if (b.assetNo !== undefined && String(b.assetNo) !== String(a.assetNo)) {
    throw invalid('资产编号不可修改：标签已贴在实物上，改号会让日志与纸标签对不上')
  }
  if (b.status !== undefined && !ASSET_STATUS_LIST.includes(String(b.status))) {
    throw invalid(`状态只能是 ${ASSET_STATUS_LIST.join(' / ')}`)
  }
  if (b.catId !== undefined) {
    const cat = catOf(String(b.catId))
    if (!cat) throw invalid('分类不存在')
    if (!cat.enabled) throw invalid(`分类「${cat.name}」已停用，换一个分类或先启用它`)
    b.catName = cat.name
    b.catPath = catPathOf(cat.catId)
  }
  for (const [k, v] of Object.entries(b)) {
    if (k === 'ver' || !(k in ASSET_FIELD_LABEL) && k !== 'catName' && k !== 'catPath') continue
    const before = a[k]
    /* 图片按 fileId + 名称 + url 比：只比 fileId 的话，「同一个 fileId 换了内容」
       会被当成没改动而跳过校验（换成 PDF 也能溜过去）；顺序变了不算改动。 */
    const sig = list => (list || []).map(f => `${f.fileId}|${f.name}|${f.url}`)
    const same = k === 'files'
      ? JSON.stringify(sig(before)) === JSON.stringify(sig(v))
      : (before ?? '') === (v ?? '')
    if (same) continue
    if (ASSET_FIELD_LABEL[k]) {
      let bShow = before
      let aShow = v
      if (k === 'holderEmpId') { bShow = assetHolderName(before); aShow = assetHolderName(v) }
      if (k === 'orgId') { bShow = assetOrgName(before); aShow = assetOrgName(v) }
      if (k === 'catId') { bShow = a.catName || ''; aShow = b.catName || catOf(v)?.name || '' }
      if (k === 'files') { bShow = assetFilesBrief(before); aShow = assetFilesBrief(v) }
      assetLog(a, k, ASSET_FIELD_LABEL[k], bShow, aShow, ctx.user.name)
    }
    a[k] = k === 'files' ? assetCleanFiles(v, ctx.user) : v
  }
  a._ver = Number(a._ver || 1) + 1
  return assetRow(a)
})

on('POST', '/assets/labels', (ctx) => {
  requirePerm(ctx.user, 'c.assets.view', '缺少权限位 c.assets.view：无权查看资产')
  const ids = Array.isArray((ctx.body || {}).assetIds) ? ctx.body.assetIds : []
  return assets.filter(a => ids.includes(a.assetId)).map(a => ({
    assetId: a.assetId, assetNo: a.assetNo, name: a.name,
    catName: a.catName || '', qrToken: a.qrToken, scanUrl: `/scan/${a.qrToken}`
  }))
})

/* ---------------- 扫码公开接口（免登录） ---------------- */
on('GET', '/public/assets/{token}', (ctx) => {
  /* 故意不 requirePerm：扫码的人可能是访客、供应商，或者手机上没登录。
     边界由「只回这 7 个字段」保证，不靠登录态。 */
  const a = assets.find(x => x.qrToken === ctx.params.token)
  if (!a) throw new ApiError(404, 40410, '未找到该资产')
  return {
    ok: true,
    scrapped: a.status === '报废',
    asset: {
      name: a.name,
      assetNo: a.assetNo,
      catPath: a.catPath || catPathOf(a.catId),
      status: a.status,
      orgName: assetOrgName(a.orgId) || '—',
      location: a.location || '—',
      warrantyEnd: a.warrantyEnd || '—',
      warrantyExpired: !!a.warrantyEnd && String(a.warrantyEnd) < DATA_DATE
    }
  }
})

/* ================= 部门计划（G 域 · 2026-11-03 第 56 批 · 模板驱动） =================
 * 与原型同一套口径，写成服务端视角：
 *   - (planMonth, orgId) 唯一，已驳回的不占位（可以重提）；
 *   - 提报主体 = 该组织负责人，服务端必须重新校验，不能只信前端下拉；
 *   - 条目由模板铺开（提报时整份拷贝成快照），权重合计 100 卡在提交、不卡草稿；
 *   - 状态：草稿 → 审批中 → 已批准 → 执行中 → 待复评 → 已结案；
 *   - 复评必须等「提交完成情况」，按状态卡，不靠调用方自觉；
 *   - 审核阶段运营管理部可直接改考核项（不走驳回），改动逐条进 reviseLog。
 *
 * 算分只有一处实现（planTargetOf / planSelfScoreOf / planItemCalc / planTotalsOf）：
 *   否决 = 目标 × 95%，挑战 = 目标 × 105%（逆向镜像）；
 *   自评 = 5 ×（实际 − 否决）/（挑战 − 否决），夹 1–5；
 *   加权 = 分 × 权重/100；总分 = 自评合计 × 20% + 复评合计 × 80%。
 */
const deptPlans = readJson('fixtures/dept-plans.json')
const PLAN_STATUS = ['草稿', '审批中', '已批准', '已驳回', '执行中', '待复评', '已结案']
const PLAN_TASK_STATUS = ['未开始', '进行中', '已完成', '延期']
const PLAN_SCORE_RULE = { rejectRate: 0.95, challengeRate: 1.05, min: 1, max: 5, selfWeight: 0.2, reviewWeight: 0.8 }

const planPerm = (u, code) => (u.permissions || []).includes('*') || (u.permissions || []).includes(code)

/** 这个人负责哪几个部门（正职 / 副职 / 在期代理都算）—— 提报主体校验用 */
function leadsOfUser(u) {
  const home = (EMP.get(u.empId) || {}).orgId || ''
  return orgLeaders
    .filter(r => r.empId === u.empId && relActive(r))
    .map(r => ({
      orgId: r.orgId,
      orgName: ((orgs.find(o => o.orgId === r.orgId) || {}).name) || '',
      duty: r.duty,
      isPrimary: home === r.orgId
    }))
}
const planInvalid = msg => new ApiError(422, 42212, msg)

/** 按组织匹配模板（与原型 planTplForOrg 同口径） */
function planTplOfOrg(orgId) {
  const o = orgs.find(x => x.orgId === orgId)
  if (!o) return null
  const on = planTpls.filter(t => t.enabled)
  if (o.type === '项目') return on.find(t => t.matchType === '项目') || null
  if (o.type === '班组') {
    const sfx = String(orgId).split('-T')[1] || ''
    return on.find(t => t.matchType === '班组' && t.matchSuffix === sfx)
      || on.find(t => t.matchType === '职能') || null
  }
  return on.find(t => t.matchType === '职能') || null
}

/**
 * 自审绕过：解析出的审批人等于申请人时，沿组织链向上找第一个不是自己的负责人。
 * 项目经理给自己项目提计划，第一节点「项目经理审批」解析到的就是他本人，
 * 不跳升流程直接死锁。
 */
function planAssignee(node, applicant) {
  const raw = resolveAssignee(node, applicant)
  if (!raw || raw !== applicant.name) return { name: raw, note: '' }
  let cur = orgs.find(o => o.orgId === applicant.orgId)
  const seen = new Set([applicant.orgId])
  for (let i = 0; cur && cur.parentId && i < 8; i++) {
    if (seen.has(cur.parentId)) break
    seen.add(cur.parentId)
    cur = orgs.find(o => o.orgId === cur.parentId)
    if (cur.leader && cur.leader !== applicant.name) {
      return { name: cur.leader, note: `原审批人为本人，已跳升至${cur.name}负责人` }
    }
  }
  return { name: '', note: '上级链上没有其他负责人，需手动指派' }
}

/**
 * 会签 / 或签：一个节点解析出**全部**审批人。
 * 只有「部门负责人」来源支持多签，对象是本部门全部在期负责人（正职 + 副职 + 代理），
 * 并排除申请人本人 —— 自己不能给自己签；排除后没人就沿组织链向上找。
 */
function resolveAssignees(node, applicant) {
  const mode = node.signMode || 'single'
  if (mode === 'single' || node.assigneeType !== 'orgLeader') {
    const hit = planAssignee(node, applicant)
    return hit.name ? [{ name: hit.name, empId: '', duty: '', note: hit.note }] : []
  }
  const same = leadersOfOrg(applicant.orgId).filter(r => r.active && r.name !== applicant.name)
  if (same.length) return same.map(r => ({ name: r.name, empId: r.empId, duty: r.duty, note: '' }))
  let cur = orgs.find(o => o.orgId === applicant.orgId)
  const seen = new Set([applicant.orgId])
  for (let i = 0; cur && cur.parentId && i < 8; i++) {
    if (seen.has(cur.parentId)) break
    seen.add(cur.parentId)
    cur = orgs.find(o => o.orgId === cur.parentId)
    const up = leadersOfOrg(cur.orgId).filter(r => r.active && r.name !== applicant.name)
    if (up.length) {
      return up.map(r => ({
        name: r.name, empId: r.empId, duty: r.duty,
        note: `本部门没有其他负责人，已跳升至${cur.name}`
      }))
    }
  }
  return []
}
const planStatusErr = msg => new ApiError(409, 40926, msg)
const planDupErr = msg => new ApiError(409, 40925, msg)

function planTargetOf(item = {}) {
  const t = Number(item.target)
  const dir = item.direction === -1 ? -1 : 1
  if (!Number.isFinite(t) || t <= 0) return { reject: null, challenge: null, usable: false }
  return {
    reject: r2(dir > 0 ? t * PLAN_SCORE_RULE.rejectRate : t * PLAN_SCORE_RULE.challengeRate),
    challenge: r2(dir > 0 ? t * PLAN_SCORE_RULE.challengeRate : t * PLAN_SCORE_RULE.rejectRate),
    usable: true
  }
}

function planSelfScoreOf(item = {}) {
  if (item.section !== 'q') return num(item.selfScore)
  const { reject, challenge, usable } = planTargetOf(item)
  if (!usable) return num(item.selfScore)
  const a = Number(item.actual)
  if (item.actual === '' || item.actual === null || item.actual === undefined || !Number.isFinite(a)) return 0
  const den = Math.abs(challenge - reject)
  if (!den) return 0
  const raw = item.direction === -1 ? (reject - a) : (a - reject)
  return Math.min(PLAN_SCORE_RULE.max, Math.max(PLAN_SCORE_RULE.min, 5 * raw / den))
}

const planWeightedOf = (score, weight) => r2(num(score) * num(weight) / 100)

function planItemCalc(item = {}) {
  if (item.section === 'm') {
    return {
      selfScore: null, reviewScore: null,
      selfWeighted: r2(item.selfWeighted), reviewWeighted: r2(item.reviewWeighted)
    }
  }
  const self = planSelfScoreOf(item)
  const review = num(item.reviewScore)
  return {
    selfScore: r2(self),
    reviewScore: review ? r2(review) : null,
    selfWeighted: planWeightedOf(self, item.weight),
    reviewWeighted: review ? planWeightedOf(review, item.weight) : 0
  }
}

function planTotalsOf(items = []) {
  let self = 0
  let review = 0
  for (const it of items) {
    const c = planItemCalc(it)
    self += c.selfWeighted
    review += c.reviewWeighted
  }
  self = r2(self)
  review = r2(review)
  return {
    selfTotal: self,
    reviewTotal: review,
    total: r2(self * PLAN_SCORE_RULE.selfWeight + review * PLAN_SCORE_RULE.reviewWeight)
  }
}

/** 权重步长：只能按 5% 调（与原型 PLAN_WEIGHT_STEP 同口径） */
const PLAN_WEIGHT_STEP = 5
const onStep = n => {
  const v = num(n)
  return Number.isFinite(v) && Math.abs(v / PLAN_WEIGHT_STEP - Math.round(v / PLAN_WEIGHT_STEP)) < 1e-9
}

/**
 * 权重校验：**两条规则**（第 60 批）。
 *   ① 每一项必须是 5 的倍数（业务上只按 5% 调）；
 *   ② 各项合计正好 100%。
 * 非 5 的倍数先报：两项都错时先说合计，人会去调数字，而真正该做的是把 12 改成 10 / 15。
 */
function planWeightCheck(items = []) {
  const sumOf = k => r2(items.filter(i => i.section === k).reduce((s, i) => s + num(i.weight), 0))
  const qs = sumOf('q')
  const ks = sumOf('k')
  const ms = sumOf('m')
  const total = r2(qs + ks)
  const diff = r2(100 - total)
  const scorable = items.filter(i => i.section === 'q' || i.section === 'k')
  const errs = []
  if (ms !== 0) errs.push('监控指标的权重必须为 0（只扣分不占权重）')

  const offStep = scorable.filter(i => !onStep(i.weight))
  if (offStep.length) {
    const names = offStep.slice(0, 3).map(i => `「${i.name}」${i.weight}%`).join('、')
    errs.push(`${names}${offStep.length > 3 ? ` 等 ${offStep.length} 项` : ''}不是 ${PLAN_WEIGHT_STEP} 的倍数，权重只能按 ${PLAN_WEIGHT_STEP}% 调`)
  }

  if (!scorable.length) {
    errs.push('至少要有一条量化指标或重点工作，否则没有可计分的内容')
  } else if (Math.abs(diff) > 0.01) {
    errs.push(diff > 0
      ? `各项权重合计 ${total}%，还差 ${diff}% 才到 100%`
      : `各项权重合计 ${total}%，超出 ${r2(-diff)}%（必须正好 100%）`)
  }

  const maxItems = Math.round(100 / PLAN_WEIGHT_STEP)
  if (scorable.length > maxItems) {
    errs.push(`计分项共 ${scorable.length} 条，每项至少 ${PLAN_WEIGHT_STEP}%，最多只能有 ${maxItems} 条（先在模板里合并或删减）`)
  }
  return { qs, ks, ms, total, diff, ok: errs.length === 0, msg: errs.join('；') }
}

const planGradeOf = (s) => {
  const n = num(s)
  return n >= 4.5 ? 'A' : (n >= 3.75 ? 'B' : (n >= 3.0 ? 'C' : 'D'))
}

const planTaskStatus = t => {
  if (t.actual !== '' && t.actual !== null && t.actual !== undefined) return '已完成'
  if (t.selfScore) return '进行中'
  if (t.dueDate && t.dueDate < DATA_DATE) return '延期'
  return '未开始'
}

const planFinishRate = p => {
  const items = (p.items || []).filter(i => i.section !== 'm')
  if (!items.length) return 0
  const sum = items.reduce((s, i) => s + planItemCalc(i).selfWeighted, 0)
  return r2(Math.min(100, sum / 5 * 100))
}

const planRow = (p) => {
  const items = (p.items || []).map(t => ({
    ...t, execStatus: planTaskStatus(t), ...planItemCalc(t)
  }))
  const wc = planWeightCheck(items)
  const totals = planTotalsOf(items)
  const done = p.status === '已结案'
  const running = ['已批准', '执行中'].includes(p.status)
  return {
    ...p,
    items,
    tasks: items,
    weightTotal: wc.total,
    weightQs: wc.qs,
    weightKs: wc.ks,
    weightDiff: wc.diff,
    weightOk: wc.ok,
    weightMsg: wc.msg,
    finishRate: planFinishRate({ ...p, items }),
    doneCount: items.filter(t => t.execStatus === '已完成').length,
    lateCount: items.filter(t => t.execStatus === '延期').length,
    taskCount: items.length,
    itemCount: items.length,
    selfTotal: totals.selfTotal,
    reviewTotal: totals.reviewTotal,
    totalScore: done ? totals.total : 0,
    score: done ? totals.total : 0,
    grade: done ? planGradeOf(totals.total) : '',
    canProgress: running,
    canReview: p.status === '待复评'
  }
}

const planOf = id => deptPlans.find(p => p.planId === id)
const planMust = (id) => {
  const p = planOf(id)
  if (!p) throw notFound('计划不存在')
  return p
}
const planUnique = (month, orgId, exceptId) =>
  deptPlans.find(p => p.planMonth === month && p.orgId === orgId && p.status !== '已驳回' && p.planId !== exceptId) || null

function planCleanItems(items = [], planId = 'PL') {
  return items.map((t, i) => ({
    taskId: t.taskId || `${planId}-I${String(i + 1).padStart(2, '0')}`,
    itemId: String(t.itemId || ''),
    section: ['q', 'm', 'k'].includes(t.section) ? t.section : 'k',
    name: String(t.name || '').trim(),
    content: String(t.content || '').trim(),
    standard: String(t.standard || '').trim(),
    /* 夹在 0–100：负数会让加权分为负，而校验只比合计，负数能靠加总凑过去 */
    weight: Math.min(100, Math.max(0, r2(t.weight))),
    direction: t.direction === -1 ? -1 : 1,
    unit: String(t.unit || '').trim(),
    target: (t.target === '' || t.target === undefined || t.target === null) ? '' : num(t.target),
    dueDate: String(t.dueDate || '').slice(0, 10),
    files: Array.isArray(t.files) ? t.files : [],
    actual: (t.actual === undefined || t.actual === null) ? '' : t.actual,
    actualNote: String(t.actualNote || '').trim(),
    selfScore: (t.selfScore === null || t.selfScore === undefined || t.selfScore === '') ? null : num(t.selfScore),
    selfWeighted: r2(t.selfWeighted),
    reviewScore: (t.reviewScore === null || t.reviewScore === undefined || t.reviewScore === '') ? null : num(t.reviewScore),
    reviewWeighted: r2(t.reviewWeighted),
    remark: String(t.remark || '').trim(),
    progress: Math.min(100, Math.max(0, num(t.progress))),
    execStatus: '未开始',
    finishAt: String(t.finishAt || ''),
    score: 0,
    evalRemark: ''
  }))
}

function planPayload(b, u, existing) {
  const planMonth = String(b.planMonth || '').trim()
  if (!/^\d{4}-\d{2}$/.test(planMonth)) throw planInvalid('请选择计划月份（YYYY-MM）')
  const orgId = String(b.orgId || '').trim()
  if (!orgId) throw planInvalid('请选择提报部门')
  if (!leadsOfUser(u).some(l => l.orgId === orgId)) {
    throw forbidden('你不是该部门的负责人，不能以它的名义提报计划')
  }
  const items = planCleanItems(b.items || b.tasks || [], existing ? existing.planId : 'PL')
  if (!items.length) throw planInvalid('计划至少要有 1 条考核项')
  if (items.some(t => !t.name)) throw planInvalid('考核项名称不能为空')
  return { planMonth, orgId, items }
}

on('GET', '/dept-plans', (ctx) => {
  const q = ctx.query || {}
  const list = deptPlans
    .filter(p => !q.planMonth || p.planMonth === q.planMonth)
    .filter(p => !q.orgId || p.orgId === q.orgId)
    .filter(p => !q.projectId || p.projectId === q.projectId)
    .filter(p => !q.status || p.status === q.status)
    .filter(p => !q.kw || `${p.orgName}${p.submitterName}${p.planId}${(p.items || []).map(i => i.name).join('')}`.includes(q.kw))
    .map(planRow)
    .sort((a, b) => (a.planMonth === b.planMonth ? String(a.orgPath).localeCompare(String(b.orgPath)) : b.planMonth.localeCompare(a.planMonth)))
  return list
})

on('GET', '/dept-plans/stats', (ctx) => {
  const q = ctx.query || {}
  let list = deptPlans.map(planRow)
  if (q.planMonth) list = list.filter(p => p.planMonth === q.planMonth)
  if (q.projectId) list = list.filter(p => p.projectId === q.projectId)

  const statusCount = s => list.filter(p => p.status === s).length
  const closed = list.filter(p => p.status === '已结案')
  const totalItems = list.reduce((s, p) => s + p.items.length, 0)
  const execMap = new Map(PLAN_TASK_STATUS.map(s => [s, 0]))
  for (const p of list) for (const it of p.items) execMap.set(it.execStatus, (execMap.get(it.execStatus) || 0) + 1)

  const gmap = new Map()
  for (const p of list) {
    const key = p.projectId || 'HEAD'
    const cur = gmap.get(key) || {
      key, name: key === 'HEAD' ? '总部职能' : ((orgs.find(o => o.orgId === key) || {}).name || ''),
      plans: 0, tasks: 0, doneTasks: 0, lateTasks: 0, closed: 0, scoreSum: 0, finishSum: 0
    }
    cur.plans += 1
    cur.tasks += p.items.length
    cur.doneTasks += p.doneCount
    cur.lateTasks += p.lateCount
    cur.finishSum += p.finishRate
    if (p.status === '已结案') { cur.closed += 1; cur.scoreSum += p.totalScore }
    gmap.set(key, cur)
  }
  const byOrg = [...gmap.values()].map(g => ({
    ...g,
    avgScore: g.closed ? r2(g.scoreSum / g.closed) : 0,
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
    draftCount: statusCount('草稿'),
    rejectedCount: statusCount('已驳回'),
    pendingReview: statusCount('待复评'),
    avgScore: scores.length ? r2(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    avgFinish: list.length ? Math.round(list.reduce((s, p) => s + p.finishRate, 0) / list.length * 10) / 10 : 0,
    lateTasks: list.reduce((s, p) => s + p.lateCount, 0),
    byStatus: PLAN_STATUS.map(s => ({ status: s, count: statusCount(s) })),
    byOrg,
    byExec: PLAN_TASK_STATUS.map(s => ({ status: s, count: execMap.get(s) || 0 })),
    byGrade
  }
})

on('GET', '/dept-plans/exists', (ctx) => {
  const q = ctx.query || {}
  const p = deptPlans.find(x => x.planMonth === q.planMonth && x.orgId === q.orgId && x.status !== '已驳回')
  return p ? planRow(p) : null
})

on('GET', '/dept-plans/{planId}', (ctx) => planRow(planMust(ctx.params.planId)))

on('POST', '/dept-plans', (ctx) => {
  const u = ctx.user
  if (!planPerm(u, 'f.plans.edit')) throw forbidden('当前角色没有计划维护权限（f.plans.edit）')
  const { planMonth, orgId, items } = planPayload(ctx.body || {}, u, null)
  const dup = planUnique(planMonth, orgId, null)
  if (dup) throw planDupErr(`「${(orgs.find(o => o.orgId === orgId) || {}).name}」${planMonth} 已有计划（${dup.planId}），一个部门一个月只能有一份`)

  const tpl = planTplOfOrg(orgId)
  const org = orgs.find(o => o.orgId === orgId) || {}
  const emp = EMP.get(u.empId) || {}
  const id = 'PL' + planMonth.replace('-', '') + String(deptPlans.filter(p => p.planMonth === planMonth).length + 1).padStart(3, '0')
  const wc = planWeightCheck(items)
  const p = {
    planId: id,
    planMonth,
    orgId,
    orgName: org.name || '',
    orgPath: org.name || '',
    orgType: org.type || '',
    projectId: org.type === '项目' ? orgId : (org.parentId || ''),
    headcount: 0,
    tplId: (ctx.body || {}).tplId || (tpl ? tpl.tplId : ''),
    tplName: (ctx.body || {}).tplName || (tpl ? tpl.name : ''),
    tplVersion: (ctx.body || {}).tplVersion || (tpl ? tpl.version : 0),
    submitterEmpId: u.empId,
    submitterName: u.name,
    submitterPosition: emp.position || u.roleName,
    submitterDuty: '正职',
    submitterOrgId: emp.orgId || '',
    submitterOrgName: ((orgs.find(o => o.orgId === emp.orgId) || {}).name) || '',
    submitAt: DATA_DATE,
    status: '草稿',
    oaId: '', approveAt: '', approveBy: '', approveNote: '',
    reviseLog: [],
    items: items.map((t, i) => ({ ...t, taskId: `${id}-I${String(i + 1).padStart(2, '0')}` })),
    weightTotal: wc.total,
    weightOk: wc.ok,
    finishRate: 0, selfTotal: 0, reviewTotal: 0, totalScore: 0, score: 0, grade: '',
    evalAt: '', evalBy: '',
    summary: String((ctx.body || {}).summary || ''),
    logs: [{ at: DATA_DATE, by: u.name, action: '创建草稿', note: `以${org.name}负责人身份 · 模板 ${tpl ? tpl.name : '—'}` }]
  }
  deptPlans.push(p)
  return planRow(p)
})

on('PATCH', '/dept-plans/{planId}', (ctx) => {
  const u = ctx.user
  if (!planPerm(u, 'f.plans.edit')) throw forbidden('当前角色没有计划维护权限（f.plans.edit）')
  const p = planMust(ctx.params.planId)
  if (!['草稿', '已驳回'].includes(p.status)) {
    throw planStatusErr(`计划已「${p.status}」，不能再改考核项（已批准的内容不能被事后修改）`)
  }
  const { planMonth, orgId, items } = planPayload({ ...ctx.body, planMonth: p.planMonth, orgId: p.orgId }, u, p)
  const dup = planUnique(planMonth, orgId, p.planId)
  if (dup) throw planDupErr(`「${p.orgName}」${planMonth} 已有计划（${dup.planId}）`)
  const wc = planWeightCheck(items)
  p.items = items.map((t, i) => ({ ...t, taskId: t.taskId || `${p.planId}-I${String(i + 1).padStart(2, '0')}` }))
  p.status = '草稿'
  p.approveNote = ''
  p.weightTotal = wc.total
  p.weightOk = wc.ok
  p.summary = String((ctx.body || {}).summary || p.summary || '')
  p.logs.push({ at: DATA_DATE, by: u.name, action: '保存草稿', note: `${items.length} 项考核项 · 权重合计 ${wc.total}%` })
  return planRow(p)
})

on('POST', '/dept-plans/{planId}/submit', (ctx) => {
  const u = ctx.user
  if (!planPerm(u, 'f.plans.edit')) throw forbidden('当前角色没有计划维护权限（f.plans.edit）')
  const p = planMust(ctx.params.planId)
  if (!['草稿', '已驳回'].includes(p.status)) throw planStatusErr(`计划已「${p.status}」，不能重复提报`)
  if (!leadsOfUser(u).some(l => l.orgId === p.orgId)) throw forbidden('你不是该部门的负责人，不能替它提报')

  const wc = planWeightCheck(p.items)
  if (!wc.ok) throw planInvalid(`权重校验不通过：${wc.msg}`)
  const noTarget = p.items.filter(i => i.section === 'q' && (i.target === '' || !Number.isFinite(Number(i.target))))
  if (noTarget.length) throw planInvalid(`量化指标要填目标值：${noTarget.map(i => i.name).join('、')}`)
  if (p.items.some(i => !i.dueDate)) throw planInvalid('每条都要填完成时间')
  const dup = planUnique(p.planMonth, p.orgId, p.planId)
  if (dup) throw planDupErr(`该部门 ${p.planMonth} 已有计划在流程中`)

  /* 审批链按**提报部门**解析，不按人事归属 */
  const nodes = oaNodesFor('计划审批', 0)
  if (!nodes.length) throw new ApiError(422, 42212, '计划审批没有配置审批流')
  const emp = EMP.get(u.empId) || {}
  const applicant = {
    empId: u.empId, name: u.name, position: emp.position || u.roleName,
    orgId: p.orgId, manager: emp.manager || ''
  }
  AP_SEQ += 1
  const ap = {
    approvalId: 'AP' + String(AP_SEQ).padStart(5, '0'),
    approvalNo: `SP-${DATA_DATE.slice(0, 4)}-${String(AP_SEQ).padStart(4, '0')}`,
    bizType: '计划审批', bizId: p.planId, changeId: '',
    title: `计划审批 · ${p.orgName} ${Number(p.planMonth.slice(5))} 月工作计划（${p.items.length} 项）`,
    formData: { planMonth: p.planMonth, orgName: p.orgName, taskCount: p.items.length, weightTotal: wc.total },
    files: [], communityId: p.projectId ? p.projectId.replace('O-', '') : '',
    communityName: p.projectId ? communityNameOf(p.projectId.replace('O-', '')) : '集团 / 全项目',
    amount: 0,
    applicant: u.name, applicantRole: applicant.position,
    applicantEmpId: u.empId, applicantOrgId: emp.orgId || '',
    applicantOrgName: ((orgs.find(o => o.orgId === emp.orgId) || {}).name) || '',
    scopeOrgId: p.orgId, scopeOrgName: p.orgName,
    applyTime: DATA_DATE, status: '待审批', currentNode: nodes[0].name,
    urgency: '普通', waitHours: 0,
    flow: nodes.map(n => {
      const hit = planAssignee(n, applicant)
      return {
        node: n.name, handler: hit.name, action: '待处理', time: '', comment: '',
        limitHours: n.limitHours || 24, skipNote: hit.note
      }
    })
  }
  oaRequests.unshift(ap)
  p.status = '审批中'
  p.oaId = ap.approvalId
  p.submitAt = DATA_DATE
  p.logs.push({ at: DATA_DATE, by: u.name, action: '提交审批', note: ap.approvalNo })
  return { ...planRow(p), approval: ap }
})

on('POST', '/dept-plans/{planId}/withdraw', (ctx) => {
  const p = planMust(ctx.params.planId)
  if (p.status !== '审批中') throw planStatusErr('只有审批中的计划可以撤回')
  if (p.oaId) {
    const ap = oaRequests.find(a => a.approvalId === p.oaId)
    if (ap) { ap.status = '已撤回'; ap.currentNode = '已完成' }
  }
  p.status = '草稿'
  p.logs.push({ at: DATA_DATE, by: ctx.user.name, action: '撤回', note: '退回草稿可继续编辑' })
  return planRow(p)
})

/** 执行阶段：填一条的实际完成情况（量化填数值、监控填扣分、重点填文字+自评 1–5） */
on('PATCH', '/dept-plans/{planId}/items/{taskId}', (ctx) => {
  const p = planMust(ctx.params.planId)
  if (!['已批准', '执行中'].includes(p.status)) {
    throw planStatusErr(`计划「${p.status}」不能填完成情况`)
  }
  const t = p.items.find(x => x.taskId === ctx.params.taskId)
  if (!t) throw notFound('考核项不存在')
  const b = ctx.body || {}

  if (b.actual !== undefined) t.actual = b.actual
  if (b.actualNote !== undefined) t.actualNote = String(b.actualNote || '').trim()
  if (b.selfScore !== undefined) {
    /* 量化项目标有效时分数由公式定，不接受手填 —— 否则等于自己定分 */
    const { usable } = planTargetOf(t)
    if (!(t.section === 'q' && usable)) {
      t.selfScore = b.selfScore === '' || b.selfScore === null ? null : Math.min(5, Math.max(1, num(b.selfScore)))
    }
  }
  if (b.selfWeighted !== undefined && t.section === 'm') t.selfWeighted = r2(b.selfWeighted)
  if (b.remark !== undefined) t.remark = String(b.remark || '').trim()
  if (b.files !== undefined && Array.isArray(b.files)) t.files = b.files

  t.progress = (t.actual !== '' && t.actual !== null) ? 100 : 0
  t.execStatus = planTaskStatus(t)
  t.finishAt = t.execStatus === '已完成' ? (t.finishAt || DATA_DATE) : ''
  if (p.status === '已批准') {
    p.status = '执行中'
    p.logs.push({ at: DATA_DATE, by: ctx.user.name, action: '开始执行', note: `填报「${t.name}」` })
  }
  p.finishRate = planFinishRate(p)
  return planRow(p)
})

/** 审核阶段运营管理部直接改考核项（不走驳回），改动逐条进 reviseLog */
on('PATCH', '/dept-plans/{planId}/items', (ctx) => {
  const u = ctx.user
  if (!planPerm(u, 'f.plans.eval') && !planPerm(u, 'f.plans.edit')) {
    throw forbidden('当前角色没有审核权限（f.plans.eval）')
  }
  const p = planMust(ctx.params.planId)
  if (p.status !== '审批中') throw planStatusErr(`计划「${p.status}」不在审核中，不能改`)
  const next = planCleanItems((ctx.body || {}).items || [], p.planId)
  if (!next.length) throw planInvalid('至少保留 1 条考核项')
  const before = new Map(p.items.map(i => [i.taskId || i.itemId, i]))
  const log = []

  next.forEach((it, i) => {
    const key = it.taskId || it.itemId
    const old = before.get(key)
    if (!old) { log.push({ field: '新增', item: it.name, before: '', after: '', at: DATA_DATE, by: u.name }); return }
    if (old.name !== it.name) log.push({ field: '名称', item: old.name, before: old.name, after: it.name, at: DATA_DATE, by: u.name })
    if (String(old.target) !== String(it.target) && it.section === 'q') {
      log.push({ field: '目标值', item: it.name, before: old.target, after: it.target, at: DATA_DATE, by: u.name })
    }
    if (r2(old.weight) !== r2(it.weight)) {
      log.push({ field: '权重', item: it.name, before: old.weight, after: it.weight, at: DATA_DATE, by: u.name })
    }
    if ((old.standard || '') !== (it.standard || '')) {
      log.push({ field: '评价标准', item: it.name, before: old.standard, after: it.standard, at: DATA_DATE, by: u.name })
    }
    it.taskId = it.taskId || `${p.planId}-I${String(i + 1).padStart(2, '0')}`
  })
  p.items.filter(o => !next.some(n => (n.taskId || n.itemId) === (o.taskId || o.itemId)))
    .forEach(o => log.push({ field: '删除', item: o.name, before: o.name, after: '', at: DATA_DATE, by: u.name }))

  p.items = next
  p.reviseLog = [...(p.reviseLog || []), ...log]
  p.logs.push({
    at: DATA_DATE, by: u.name, action: '审核修改',
    note: log.length ? `调整 ${log.length} 项：${log.map(l => `${l.item}·${l.field}`).join('、')}` : '无调整'
  })
  return planRow(p)
})

/** 审核通过并下发：改完直接进执行 */
on('POST', '/dept-plans/{planId}/approve', (ctx) => {
  const u = ctx.user
  if (!planPerm(u, 'f.plans.eval')) throw forbidden('当前角色没有审核权限（f.plans.eval）')
  const p = planMust(ctx.params.planId)
  if (p.status !== '审批中') throw planStatusErr(`计划「${p.status}」不在审核中`)
  const wc = planWeightCheck(p.items)
  if (!wc.ok) throw planInvalid(`权重校验不通过：${wc.msg}`)

  p.status = '已批准'
  p.approveAt = DATA_DATE
  p.approveBy = u.name
  p.approveNote = String((ctx.body || {}).comment || '')
  if (p.oaId) {
    const ap = oaRequests.find(a => a.approvalId === p.oaId)
    if (ap) {
      ap.status = '已通过'
      ap.currentNode = '已完成'
      ap.flow.forEach(n => {
        if (n.action === '待处理') { n.action = '同意'; n.handler = n.handler || u.name; n.time = DATA_DATE; n.comment = n.comment || '审核通过' }
      })
    }
  }
  p.logs.push({
    at: DATA_DATE, by: u.name, action: '审核通过',
    note: `按调整后下发${(p.reviseLog || []).length ? `（累计调整 ${p.reviseLog.length} 项）` : ''}`
  })
  return planRow(p)
})

/** 提交完成情况 → 待复评。**复评必须等这一步** */
on('POST', '/dept-plans/{planId}/result', (ctx) => {
  const p = planMust(ctx.params.planId)
  if (!['已批准', '执行中'].includes(p.status)) throw planStatusErr(`计划「${p.status}」不能提交完成情况`)
  const unfilled = p.items.filter(i => {
    if (i.section === 'm') return false
    if (i.section === 'q') return i.actual === '' || i.actual === null
    return i.selfScore === null || i.selfScore === undefined
  })
  if (unfilled.length) throw planInvalid(`还有 ${unfilled.length} 项没填：${unfilled.map(i => i.name).join('、')}`)
  p.status = '待复评'
  p.resultAt = DATA_DATE
  p.logs.push({ at: DATA_DATE, by: ctx.user.name, action: '提交完成情况', note: '等待运营管理部复评' })
  return planRow(p)
})

/** 复评 + 归档：逐项 1–5 分，监控项填扣分 */
on('POST', '/dept-plans/{planId}/review', (ctx) => {
  const u = ctx.user
  if (!planPerm(u, 'f.plans.eval') && !planPerm(u, 'f.plans.edit')) {
    throw forbidden('当前角色没有复评权限（f.plans.eval）')
  }
  const p = planMust(ctx.params.planId)
  if (p.status !== '待复评') {
    throw planStatusErr(p.status === '已结案'
      ? '计划已归档'
      : `计划「${p.status}」，要等填报人提交完成情况之后才能复评`)
  }
  const b = ctx.body || {}
  const scores = b.scores || {}
  const deductions = b.deductions || {}

  const missing = p.items.filter(i => i.section !== 'm' && (scores[i.taskId] === undefined || scores[i.taskId] === ''))
  if (missing.length) throw planInvalid(`还有 ${missing.length} 项没打分：${missing.map(i => i.name).join('、')}`)

  for (const it of p.items) {
    if (it.section === 'm') {
      if (deductions[it.taskId] !== undefined && deductions[it.taskId] !== '') {
        it.reviewWeighted = r2(deductions[it.taskId])
      }
      continue
    }
    const s = Number(scores[it.taskId])
    if (!Number.isFinite(s) || s < 1 || s > 5) throw planInvalid(`「${it.name}」评分必须在 1–5 之间`)
    it.reviewScore = r2(s)
  }
  const totals = planTotalsOf(p.items)
  p.status = '已结案'
  p.reviewAt = DATA_DATE
  p.evalAt = DATA_DATE
  p.evalBy = u.name
  p.selfTotal = totals.selfTotal
  p.reviewTotal = totals.reviewTotal
  p.totalScore = totals.total
  p.score = totals.total
  p.grade = planGradeOf(totals.total)
  p.finishRate = planFinishRate(p)
  p.summary = String(b.summary || '')
  p.logs.push({
    at: DATA_DATE, by: u.name, action: '复评完成',
    note: `自评 ${totals.selfTotal}×20% + 复评 ${totals.reviewTotal}×80% = ${totals.total}（${p.grade}）`
  })
  return planRow(p)
})

/* ---------------- service items（商业服务项目 · 价目字典） ----------------
 * 口径与服务端一致：price / cost 由分解项算，不接受入参；停用不删；有在途单不给停用。
 */
const SVC_CLOSED = ['已完工', '已评价', '已关闭', '已取消']
const SVC_LOG = new Map()

function svcUsage() {
  const m = new Map()
  for (const w of workOrders) {
    const code = w.serviceItemCode || w.priceCode
    if (!code) continue
    const cur = m.get(code) || { count: 0, inFlight: 0, paid: 0, income: 0, cost: 0 }
    cur.count += 1
    if (!SVC_CLOSED.includes(w.status)) cur.inFlight += 1
    if (w.payStatus === '已支付' || w.payStatus === '已挂账') {
      cur.paid += 1
      cur.income += w.totalFee || 0
    }
    m.set(code, cur)
  }
  return m
}

function serviceRow(it) {
  const u = (serviceRow._u || (serviceRow._u = svcUsage())).get(it.code) || { count: 0, inFlight: 0, income: 0 }
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100
  return {
    ...it,
    usedCount: u.count,
    inFlight: u.inFlight,
    received: r2(u.income),
    updatedAt: (SVC_LOG.get(it.code) || [])[0]?.at || '',
    updatedBy: (SVC_LOG.get(it.code) || [])[0]?.by || ''
  }
}
const resetSvcCache = () => { serviceRow._u = null }

function serviceCheck(p, existing = [], code = '') {
  const name = String(p?.name || '').trim()
  if (name.length < 2) return [42201, '项目名称至少 2 个字']
  if (name.length > 30) return [42201, '项目名称不超过 30 个字']
  if (!String(p?.category || '').trim()) return [42201, '项目分类必填']
  const num = (v, label) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) return [null, `${label}必须是不小于 0 的数字`]
    const r = Math.round(n * 100) / 100
    return [r, '']
  }
  const [material, e1] = num(p.material, '材料费')
  const [labor, e2] = num(p.labor, '人工费')
  const [materialCost, e3] = num(p.materialCost, '材料成本')
  const [laborCost, e4] = num(p.laborCost, '人工成本')
  if (e1) return [42201, e1]
  if (e2) return [42201, e2]
  if (e3) return [42201, e3]
  if (e4) return [42201, e4]
  const price = Math.round((material + labor) * 100) / 100
  const cost = Math.round((materialCost + laborCost) * 100) / 100
  if (price <= 0) return [42205, '服务价格不能为 0：材料费与人工费至少填一项']
  if (materialCost > material) return [42205, `材料成本（${materialCost}）不能高于材料费（${material}）`]
  if (cost >= price) return [42206, `成本价（${cost}）不低于服务价格（${price}），这一项启用就亏本`]
  if (existing.some(i => i.category === p.category && i.name === name && i.code !== code)) {
    return [40923, `「${p.category}」下已有同名项目`]
  }
  return [null, '', { material, labor, materialCost, laborCost, price, cost }]
}

on('GET', '/service-items', (ctx) => {
  resetSvcCache()
  const q = ctx.query
  const k = String(q.kw || '').trim()
  const want = q.enabled === undefined || q.enabled === '' ? true : (q.enabled === 'all' ? null : q.enabled === 'true')
  const list = serviceItems
    .filter(i => !q.category || i.category === q.category)
    .filter(i => want === null || !!i.enabled === want)
    .filter(i => !k || i.name.includes(k) || i.code.includes(k) || i.category.includes(k))
    .sort((a, b) => a.sort - b.sort)
    .map(serviceRow)
  return page(list, q)
})

on('GET', '/service-items/summary', () => {
  resetSvcCache()
  const rows = serviceItems.map(serviceRow)
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100
  const income = r2(rows.reduce((s, r) => s + r.received, 0))
  const cost = r2(rows.reduce((s, r) => {
    const it = serviceItems.find(i => i.code === r.code)
    return s + (it ? r.received * (it.cost / it.price) : 0)
  }, 0))
  return {
    total: rows.length,
    enabled: rows.filter(r => r.enabled).length,
    disabled: rows.filter(r => !r.enabled).length,
    categories: new Set(serviceItems.map(i => i.category)).size,
    used: rows.filter(r => r.usedCount > 0).length,
    orders: rows.reduce((s, r) => s + r.usedCount, 0),
    settled: [...svcUsage().values()].reduce((s, u) => s + u.paid, 0),
    income, cost, profit: r2(income - cost),
    margin: income ? Math.round((income - cost) / income * 1000) / 10 : 0
  }
})

on('GET', '/service-items/{code}', (ctx) => {
  resetSvcCache()
  const it = serviceItems.find(i => i.code === ctx.params.code)
  if (!it) throw notFound('服务项目不存在')
  return serviceRow(it)
})

function writeServiceItem(p, code) {
  const [badCode, badMsg, calc] = serviceCheck(p, serviceItems, code)
  if (badCode) throw new ApiError(badCode === 40923 ? 409 : 422, badCode, badMsg)
  if (code) {
    const it = serviceItems.find(i => i.code === code)
    if (!it) throw notFound('服务项目不存在')
    const before = { ...it }
    Object.assign(it, {
      category: p.category, name: String(p.name).trim(),
      trade: p.trade || it.trade, unit: p.unit || it.unit,
      minutes: Math.max(0, Number(p.minutes) || 0),
      sort: Number(p.sort) || it.sort, desc: p.desc ?? it.desc,
      ...calc
    })
    const diff = []
    if (before.material !== it.material) diff.push(`材料费 ${before.material} → ${it.material}`)
    if (before.labor !== it.labor) diff.push(`人工费 ${before.labor} → ${it.labor}`)
    if (before.materialCost !== it.materialCost) diff.push(`材料成本 ${before.materialCost} → ${it.materialCost}`)
    if (before.laborCost !== it.laborCost) diff.push(`人工成本 ${before.laborCost} → ${it.laborCost}`)
    if (diff.length) {
      const list = SVC_LOG.get(code) || []
      list.unshift({ action: '改价', by: p.operator || ctxUserName(), at: DATA_DATE, memo: diff.join('；') })
      SVC_LOG.set(code, list)
    }
    resetSvcCache()
    return serviceRow(it)
  }
  const seq = serviceItems.length + 1
  const it = {
    code: 'SI' + String(seq).padStart(4, '0'),
    category: p.category, name: String(p.name).trim(),
    trade: p.trade || '综合', unit: p.unit || '次',
    minutes: Math.max(0, Number(p.minutes) || 0),
    enabled: true, sort: Number(p.sort) || seq * 10, desc: p.desc || '',
    ...calc
  }
  serviceItems.push(it)
  const list = SVC_LOG.get(it.code) || []
  list.unshift({ action: '新增', by: p.operator || ctxUserName(), at: DATA_DATE, memo: `服务价 ${it.price} / 成本 ${it.cost}` })
  SVC_LOG.set(it.code, list)
  resetSvcCache()
  return serviceRow(it)
}
const ctxUserName = () => '契约测试'

on('POST', '/service-items', (ctx) => writeServiceItem(ctx.body || {}, ''))
on('PATCH', '/service-items/{code}', (ctx) => writeServiceItem(ctx.body || {}, ctx.params.code))
on('POST', '/service-items/{code}/toggle', (ctx) => {
  const it = serviceItems.find(i => i.code === ctx.params.code)
  if (!it) throw notFound('服务项目不存在')
  const enabled = ctx.body?.enabled !== false
  if (!enabled) {
    const u = svcUsage().get(it.code)
    if (u && u.inFlight > 0) {
      throw new ApiError(409, 40924, `还有 ${u.inFlight} 张在途工单在用「${it.name}」，先结单或换项目再停用`)
    }
  }
  it.enabled = enabled
  const list = SVC_LOG.get(it.code) || []
  list.unshift({ action: enabled ? '启用' : '停用', by: ctx.body?.operator || ctxUserName(), at: DATA_DATE, memo: '' })
  SVC_LOG.set(it.code, list)
  resetSvcCache()
  return serviceRow(it)
})

/* ---------------- 工时积分（2026-11-02） ----------------
 * 只公共区域维修有积分：商业服务按人工费提成，重复激励会让师傅挑单。
 * 本期只记录，绩效折算未实现；但 ruleVersion / period / status 三样先摆好，
 * 绩效侧按 empId + period 聚合 laborPointLedger 即可。
 */
const POINT_RULE = {
  version: 'POINT-2026-11-01',
  basePerHour: 10,
  weights: {
    电梯: 1.5, 公共设备: 1.4, 配电: 1.3, 给排水: 1.2, 道闸门禁: 1.2,
    土建: 1.1, 公区照明: 1.0, 门窗五金: 1.0, 环境其他: 0.8
  }
}
const PERF_CONVERSION_STATE = {
  implemented: false,
  ruleVersion: POINT_RULE.version,
  note: '积分 → 绩效分的折算系数与基准分尚未确定；本期只记录积分并按月归属，绩效侧读 /labor-points/summary 即可'
}
const POINT_CLOSED = ['已完工', '已评价', '已关闭']
const pointWeightOf = cat => POINT_RULE.weights[cat] ?? 1
const calcPoints = (cat, hours) =>
  Math.round(Math.max(0, Number(hours) || 0) * POINT_RULE.basePerHour * pointWeightOf(cat) * 10) / 10

const pointLedger = []
for (const w of workOrders) {
  if (!w.laborPoints) continue
  pointLedger.push({
    ledgerId: 'PL' + String(pointLedger.length + 1).padStart(5, '0'),
    empId: (employees.find(e => e.name === w.assignee) || {}).empId || '',
    empName: w.assignee || '',
    woId: w.woId, woNo: w.woNo, communityId: w.communityId, category: w.category,
    hours: w.laborHours || 0, weight: w.laborPointWeight || 1, points: w.laborPoints,
    period: w.pointsPeriod || String(w.finishTime || w.createTime || '').slice(0, 7),
    ruleVersion: w.pointRuleVersion || POINT_RULE.version,
    status: w.pointsStatus || '待结算', beforePoints: 0,
    at: w.pointsAt || w.finishTime || w.createTime, by: w.pointsBy || '工程主管', remark: '样例数据'
  })
}

on('GET', '/work-orders/{woId}/labor-points', (ctx) => {
  const w = workOrders.find(x => x.woId === ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  return pointLedger.filter(e => e.woId === w.woId)
})

on('POST', '/work-orders/{woId}/labor-points', (ctx) => {
  const w = workOrders.find(x => x.woId === ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  if (w.type !== '公共区域维修') {
    throw new ApiError(422, 42210, '只有公共区域维修记录工时积分 —— 商业服务按人工费提成，重复激励会让师傅挑单')
  }
  if (!w.assignee) throw new ApiError(422, 42210, '还没派单，先派单再记工时')
  if (!POINT_CLOSED.includes(w.status)) {
    throw new ApiError(409, 40926, `工单当前「${w.status}」，完工后才能记工时积分`)
  }
  if (w.pointsStatus === '已结算') {
    throw new ApiError(409, 40927, `${w.pointsPeriod} 已结算，积分不能再改（要改走冲正）`)
  }
  const h = Number(ctx.body?.hours)
  if (!Number.isFinite(h) || h <= 0) throw new ApiError(422, 42210, '工时必须大于 0')
  if (h > 24) throw new ApiError(422, 42210, '单张工单工时不能超过 24 小时，跨天的请拆单')

  const weight = pointWeightOf(w.category)
  const points = calcPoints(w.category, h)
  const period = String(w.finishTime || w.createTime || DATA_DATE).slice(0, 7)
  const before = w.laborPoints || 0

  Object.assign(w, {
    laborHours: Math.round(h * 100) / 100, laborPoints: points, laborPointWeight: weight,
    pointRuleVersion: POINT_RULE.version, pointsPeriod: period, pointsStatus: '待结算',
    pointsBy: ctx.body?.operator || ctx.user.name, pointsAt: DATA_DATE
  })
  /* 重记时旧流水标「已作废」而不是删除：绩效争议要看得到改过几次 */
  for (const e of pointLedger) {
    if (e.woId === w.woId && e.status !== '已作废') e.status = '已作废'
  }
  const rec = {
    ledgerId: 'PL' + String(pointLedger.length + 1).padStart(5, '0'),
    empId: (employees.find(e => e.name === w.assignee) || {}).empId || '',
    empName: w.assignee || '', woId: w.woId, woNo: w.woNo, communityId: w.communityId,
    category: w.category, hours: Math.round(h * 100) / 100, weight, points, period,
    ruleVersion: POINT_RULE.version, status: '待结算', beforePoints: before,
    at: DATA_DATE, by: ctx.body?.operator || ctx.user.name, remark: ctx.body?.remark || ''
  }
  pointLedger.unshift(rec)
  bumpVer('wo', w.woId)
  return { workOrder: woRow(w), ledger: { ...rec } }
})

on('GET', '/labor-points/summary', (ctx) => {
  const empId = String(ctx.query.empId || '')
  const period = String(ctx.query.period || '')
  const list = pointLedger.filter(e =>
    e.status !== '已作废' && (!empId || e.empId === empId) && (!period || e.period === period))
  const m = new Map()
  for (const e of list) {
    const key = e.empId + '|' + e.period
    const cur = m.get(key) || { empId: e.empId, empName: e.empName, period: e.period, orders: 0, hours: 0, points: 0 }
    cur.orders += 1
    cur.hours = r2(cur.hours + e.hours)
    cur.points = Math.round((cur.points + e.points) * 10) / 10
    m.set(key, cur)
  }
  return { rows: [...m.values()].sort((a, b) => b.points - a.points), perfConversion: PERF_CONVERSION_STATE }
})

/* ---------------- 多种经营收入报表（2026-11-02） ---------------- */
const MR_DONE = ['已完工', '已评价', '已关闭']
const COOP_STATUS = ['履行中', '即将到期', '已到期']

/** 当年与合同期重叠的月数；跨年合同不会把整年收入挤进签约当年 */
function yearCoverMonths(c, year) {
  const ys = new Date(`${year}-01-01`)
  const ye = new Date(`${year}-12-31`)
  const a = new Date(String(c.startDate || '').slice(0, 10))
  const b = new Date(String(c.endDate || '').slice(0, 10))
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0
  const from = a > ys ? a : ys
  const to = b < ye ? b : ye
  if (to < from) return 0
  return Math.min(12, Math.round((to - from) / 86400000 / 30.44 * 10) / 10)
}
const reportYear = q => Number(q.year) || Number(String(DATA_DATE).slice(0, 4))
const csOf = (q) => {
  const rows = workOrders.filter(w => w.type === '商业服务' && MR_DONE.includes(w.status)
    && (!q.communityId || w.communityId === q.communityId))
  const paid = rows.filter(w => w.payStatus === '已支付' || w.payStatus === '已挂账')
  const r2n = n => Math.round((Number(n) || 0) * 100) / 100
  return {
    count: rows.length,
    income: r2n(rows.reduce((s2, w) => s2 + (w.totalFee || 0), 0)),
    paid: r2n(paid.reduce((s2, w) => s2 + (w.totalFee || 0), 0)),
    cost: r2n(rows.reduce((s2, w) => s2 + (w.serviceCost || 0), 0)),
    profit: r2n(rows.reduce((s2, w) => s2 + (w.totalFee || 0) - (w.serviceCost || 0), 0))
  }
}
const coOf = (q) => {
  const year = reportYear(q)
  const rows = contracts.filter(c => c.incomeCategory === '多种经营' && COOP_STATUS.includes(c.status)
    && (!q.communityId || c.communityId === q.communityId))
  let income = 0
  let pub = 0
  let annual = 0
  let count = 0
  for (const c of rows) {
    const cover = yearCoverMonths(c, year)
    if (!cover) continue
    count += 1
    annual += annualRevenueOf(c)
    income += annualRevenueOf(c) * cover / 12
    const m = contractMonthsOf(c)
    if (m) pub += Math.min(Number(c.publicRevenue) || 0, Number(c.amount) || 0) / m * 12 * cover / 12
  }
  return { count, income: r2(income), publicRevenue: r2(pub), annualTotal: r2(annual) }
}

on('GET', '/reports/multi-revenue', (ctx) => {
  const q = ctx.query || {}
  const cs = csOf(q)
  const co = coOf(q)
  const total = r2(cs.income + co.income)
  return {
    total,
    service: { count: cs.count, income: cs.income, cost: cs.cost, profit: cs.profit },
    cooperation: { count: co.count, income: co.income, publicRevenue: co.publicRevenue, annualTotal: co.annualTotal },
    share: {
      service: total ? Math.round(cs.income / total * 1000) / 10 : 0,
      cooperation: total ? Math.round(co.income / total * 1000) / 10 : 0
    }
  }
})

on('GET', '/reports/multi-revenue/monthly', (ctx) => {
  const q = ctx.query || {}
  const year = reportYear(q)
  const buckets = []
  for (let m = 1; m <= 12; m += 1) {
    buckets.push({ month: `${m}月`, key: `${year}-${String(m).padStart(2, '0')}`, service: 0, cooperation: 0 })
  }
  const idx = new Map(buckets.map(b => [b.key, b]))
  for (const w of workOrders) {
    if (w.type !== '商业服务' || !MR_DONE.includes(w.status)) continue
    if (q.communityId && w.communityId !== q.communityId) continue
    const b = idx.get(String(w.finishTime || w.createTime || '').slice(0, 7))
    if (b) b.service += w.totalFee || 0
  }
  for (const c of contracts) {
    if (c.incomeCategory !== '多种经营' || !COOP_STATUS.includes(c.status)) continue
    if (q.communityId && c.communityId !== q.communityId) continue
    const a = new Date(String(c.startDate || '').slice(0, 10))
    const b2 = new Date(String(c.endDate || '').slice(0, 10))
    for (const b of buckets) {
      const ms = new Date(`${b.key}-01`)
      const me = new Date(`${b.key}-01`)
      me.setMonth(me.getMonth() + 1)
      me.setDate(0)
      const from = a > ms ? a : ms
      const to = b2 < me ? b2 : me
      if (to < from) continue
      const days = (to - from) / 86400000 + 1
      b.cooperation += annualRevenueOf(c) * (days / 365)
    }
  }
  const months = Number(q.months) || 12
  return buckets
    .map(b => ({ ...b, service: r2(b.service), cooperation: r2(b.cooperation), total: r2(b.service + b.cooperation) }))
    .slice(-months)
})

on('GET', '/reports/multi-revenue/by-project', (ctx) => {
  const q = ctx.query || {}
  const year = reportYear(q)
  const m = new Map()
  const touch = id => {
    const key = id || '__all__'
    if (!m.has(key)) m.set(key, { communityId: id || '', communityName: id ? communityNameOf(id) : '集团 / 全项目', service: 0, cooperation: 0 })
    return m.get(key)
  }
  for (const w of workOrders) {
    if (w.type !== '商业服务' || !MR_DONE.includes(w.status)) continue
    if (q.communityId && w.communityId !== q.communityId) continue
    touch(w.communityId).service += w.totalFee || 0
  }
  for (const c of contracts) {
    if (c.incomeCategory !== '多种经营' || !COOP_STATUS.includes(c.status)) continue
    if (q.communityId && c.communityId !== q.communityId) continue
    const cover = yearCoverMonths(c, year)
    if (!cover) continue
    touch(c.communityId).cooperation += annualRevenueOf(c) * cover / 12
  }
  return [...m.values()]
    .map(x => ({ ...x, service: r2(x.service), cooperation: r2(x.cooperation), total: r2(x.service + x.cooperation) }))
    .sort((a, b) => b.total - a.total)
})

on('GET', '/reports/multi-revenue/contracts', (ctx) => {
  const q = ctx.query || {}
  const year = reportYear(q)
  return contracts
    .filter(c => c.incomeCategory === '多种经营' && COOP_STATUS.includes(c.status)
      && (!q.communityId || c.communityId === q.communityId))
    .map(c => {
      const cover = yearCoverMonths(c, year)
      return {
        contractId: c.contractId, contractNo: c.contractNo, name: c.name, subtype: c.subtype,
        partyB: c.partyB, communityName: c.communityId ? communityNameOf(c.communityId) : '集团 / 全项目',
        amount: c.amount, publicRevenue: c.publicRevenue || 0,
        contractMonths: contractMonthsOf(c), annualRevenue: annualRevenueOf(c),
        coverMonths: cover, income: r2(annualRevenueOf(c) * cover / 12)
      }
    })
    .filter(x => x.coverMonths > 0)
    .sort((a, b) => b.income - a.income)
})

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
on('POST', '/work-orders', (ctx) => {
  const p = ctx.body || {}
  const type = p.type || '报事'
  if (!['公共区域维修', '商业服务', '报事', '投诉建议', '咨询', '其他'].includes(type)) {
    throw bad(`type 只能是 公共区域维修 / 商业服务 / 报事 / 投诉建议 / 咨询 / 其他`)
  }
  let svc = null
  if (type === '商业服务') {
    if (!p.serviceItemCode) throw new ApiError(422, 42207, '商业服务工单要选服务项目：价格与服务范围都写在项目里')
    svc = serviceItems.find(i => i.code === p.serviceItemCode)
    if (!svc) throw notFound('服务项目不存在')
    if (!svc.enabled) throw new ApiError(409, 40924, `「${svc.name}」已停用，请另选项目或先启用`)
  }
  if (type === '公共区域维修' && !String(p.category || '').trim()) {
    throw new ApiError(422, 42207, '公共区域维修要选设施部位（电梯 / 给排水 / 土建…）')
  }
  if (!String(p.title || '').trim()) throw bad('工单标题必填')
  const seq = workOrders.length + 1
  const wo = {
    woId: 'WO' + String(seq).padStart(6, '0'),
    woNo: 'BX' + String(2026) + String(seq).padStart(5, '0'),
    communityId: p.communityId || 'P01',
    houseId: p.houseId || '', houseName: p.houseName || '',
    ownerId: p.ownerId || '', ownerName: p.ownerName || '',
    type, category: svc ? svc.category : (p.category || ''),
    source: p.source || '前台', priority: p.priority || '普通', status: '待派单',
    title: p.title, description: p.description || '',
    dispatchMode: '待派单', assignee: '', createTime: DATA_DATE,
    acceptTime: '', arriveTime: '', finishTime: '',
    /* 金额一律按项目快照写死：字典改价不回溯 */
    feeType: svc ? '收费' : '免费',
    materialFee: svc ? svc.material : 0,
    laborFee: svc ? svc.labor : 0,
    totalFee: svc ? svc.price : 0,
    serviceCost: svc ? svc.cost : 0,
    priceCode: svc ? svc.code : '',
    serviceName: svc ? svc.name : '',
    payStatus: svc ? '未支付' : '无需支付',
    score: 0, isPublic: type === '公共区域维修', slaHours: p.priority === '特急' ? 4 : (p.priority === '紧急' ? 8 : 24),
    _ver: 1
  }
  /*
   * 建单就算 SLA 到期：漏了这三个字段，列表里的「剩余时间」整列是空的，
   * 而 `WorkOrder` schema 把它们标成了 required —— 契约测试会直接红在"缺字段"上。
   * 与巡检转单那条路径保持同一套算法。
   */
  wo.slaDueAt = slaDueOf(wo.createTime, wo.slaHours)
  wo.slaUsedHours = 0
  wo.slaBreached = false
  workOrders.unshift(wo)
  resetSvcCache()
  return woRow(wo)
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
  /* 公司核的是营业执照原件：没有影像件就没有核验依据 */
  if (pass && (t.tenantType || '个人') === '公司' && !(t.licenseFiles || []).length) {
    throw new ApiError(422, 42203, '公司租户核验前需先上传营业执照影像件（正本或副本）')
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
/* 营业执照影像件：公司核验的依据。原型只登记元数据，文件本身不落库 */
on('POST', '/tenants/{tenantId}/license-files', (ctx) => {
  const t = tenants.find(x => x.tenantId === ctx.params.tenantId)
  if (!t) throw notFound('租户不存在')
  if (t.status === '已搬离') throw invalid('已搬离的租户记录不可修改')
  if ((t.tenantType || '个人') !== '公司') throw invalid('只有公司租户需要营业执照影像件')
  const files = t.licenseFiles || []
  const bad = checkFile(ctx.body, files)
  if (bad) {
    const dup = bad.includes('传过')
    throw dup ? new ApiError(409, 40922, bad) : new ApiError(422, 42204, bad)
  }
  const rec = {
    fileId: `LF${String(Date.now()).slice(-6)}${String(files.length + 1).padStart(2, '0')}`,
    name: String(ctx.body.name).trim(),
    size: Number(ctx.body.size) || 0,
    type: String(ctx.body.type).toLowerCase(),
    uploadedAt: DATA_DATE,
    uploadedBy: ctx.body?.operator || ctx.user.name
  }
  t.licenseFiles = [...files, rec]
  bumpVer('tenant', t.tenantId)
  return { files: t.licenseFiles.map(f => ({ ...f })), file: { ...rec } }
})
on('DELETE', '/tenants/{tenantId}/license-files/{fileId}', (ctx) => {
  const t = tenants.find(x => x.tenantId === ctx.params.tenantId)
  if (!t) throw notFound('租户不存在')
  if (t.status === '已搬离') throw invalid('已搬离的租户记录不可修改')
  const files = t.licenseFiles || []
  if (!files.some(f => f.fileId === ctx.params.fileId)) throw notFound('营业执照影像件不存在或已被删除')
  t.licenseFiles = files.filter(f => f.fileId !== ctx.params.fileId)
  bumpVer('tenant', t.tenantId)
  return { files: t.licenseFiles.map(f => ({ ...f })) }
})

/**
 * 换承租主体：个人 ↔ 公司。
 * 一次性做完「迁移联系人 / 清另一套字段 / 撤销人脸 / 复位核验」，不留半截状态。
 */
on('POST', '/tenants/{tenantId}/change-type', (ctx) => {
  const t = tenants.find(x => x.tenantId === ctx.params.tenantId)
  if (!t) throw notFound('租户不存在')
  if (t.status === '已搬离') throw invalid('已搬离的租户不能换承租主体，请重新登记')
  const to = ctx.body?.toType
  const from = t.tenantType || '个人'
  if (!['个人', '公司'].includes(to)) throw bad('toType 只能是 个人 / 公司')
  if (to === from) throw new ApiError(409, 40921, `该租户已经是「${to}」，无需转换`)
  const reason = String(ctx.body?.reason || '').trim()
  if (reason.length < 4) throw invalid('换承租主体要写清原因（至少 4 个字），这条记录将来要用来解释"为什么换过"')
  const patch = ctx.body?.patch || {}
  if (to === '公司') {
    const companyName = String(patch.companyName ?? t.companyName ?? '').trim()
    const creditCode = String(patch.creditCode ?? t.creditCode ?? '').trim().toUpperCase()
    if (companyName.length < 2) throw new ApiError(422, 42203, '换为公司要把公司名称填上（至少 2 个字）')
    const cc = creditCodeCheck(creditCode)
    if (cc) throw new ApiError(422, 42203, cc)
    Object.assign(t, {
      tenantType: '公司', name: companyName, companyName, creditCode,
      idCard: '', relation: '企业承租',
      legalPerson: patch.legalPerson ?? '', legalPersonPhone: patch.legalPersonPhone ?? '',
      agentName: patch.agentName ?? t.name ?? '', agentPhone: patch.agentPhone ?? t.phone ?? '',
      agentIdCard: patch.agentIdCard ?? t.idCard ?? '',
      businessCategory: patch.businessCategory ?? '', leasePurpose: patch.leasePurpose ?? '',
      regAddress: patch.regAddress ?? '', establishDate: patch.establishDate ?? '',
      employeeCount: Number(patch.employeeCount) || Number(t.residents) || 1
    })
  } else {
    const name = String(patch.name ?? t.name ?? '').trim()
    const phone = String(patch.phone ?? t.phone ?? '').trim()
    if (name.length < 2) throw new ApiError(422, 42203, '换为个人要把姓名填上（至少 2 个字）')
    if (!/^1[3-9]\d{9}$/.test(phone)) throw new ApiError(422, 42203, '换为个人要留一个 11 位手机号，否则现场联系不上')
    Object.assign(t, {
      tenantType: '个人', name, phone,
      idCard: patch.idCard ?? t.agentIdCard ?? '',
      relation: patch.relation || '承租人',
      residents: Number(patch.residents) || 1,
      companyName: '', creditCode: '', legalPerson: '', legalPersonPhone: '',
      agentName: '', agentPhone: '', agentIdCard: '', businessCategory: '',
      leasePurpose: '', regAddress: '', establishDate: '', employeeCount: 0,
      licenseFiles: []
    })
  }
  /* 换主体 = 换证件：人脸与核验都要重来（人脸属于自然人，公司主体没有脸） */
  t.faceRegistered = false
  t.certified = false
  t.verifyStatus = '待核验'
  t.verifiedBy = ''
  t.verifiedAt = ''
  t.typeChangeReason = reason
  t.typeChangedFrom = from
  t.updatedBy = ctx.body?.operator || ctx.user.name
  t.updatedAt = DATA_DATE
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
    if ((t.tenantType || '个人') === '公司' && !(t.licenseFiles || []).length) {
      failed.push({ id, reason: '缺营业执照影像件' }); continue
    }
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
    /*
     * 巡检任务是**项目级**的（没有 houseId 字段），范围只看社区。
     *
     * 这里原来还套了一层 `inScopeHouse(u, houses.find(...)?.houseId)`，想表达
     * "任务可能挂到某套房上"。但 `find` 找不到时 `?.houseId` 是 undefined，
     * 而 `inScopeHouse` 对"没有 houseId"的实体默认**放行**（那是给集团级实体用的口径）——
     * 于是范围判断整体恒真：周明（只有 P01）的列表里混进了 P02 的任务。
     * 实测：`GET /inspect-tasks?size=5` 第一条是 P02 钱秀芳的单。
     *
     * 楼管按房屋限定，但他没有 f.inspect.view，压根走不到这里；
     * 所以直接按社区判，语义更窄也更对。
     */
    .filter(t => inScopeCommunity(u, t.communityId))
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
    /* 实收**只在非作废账单上累加**：作废单的钱确实收过，但它进的是「收入」，
       不进「收缴率考核」—— 分母已经把作废的应收剔了，分子再留着这笔钱，
       率就会飙到 3000%（2026-11-14 作废 565 张后当场就是这么炸的）。
       与 03 的 feeSummary 同口径：那边是 effectiveBills 先过滤、应收与实收同源。 */
    if (b.status === '已作废') {
      cur.voided = r2(cur.voided + (b.payable || 0))
    } else if (b.status === '已减免') {
      cur.paid = r2(cur.paid + (b.paidAmount || 0))
      cur.reduction = r2(cur.reduction + Math.max(0, (b.payable || 0) - (b.paidAmount || 0)))
    } else {
      cur.paid = r2(cur.paid + (b.paidAmount || 0))
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

/** 合同期间月数（与原型 api.js 同口径：30.44 天/月） */
function contractMonthsOf(c = {}) {
  const a = String(c.startDate || '').slice(0, 10)
  const b = String(c.endDate || '').slice(0, 10)
  if (!a || !b) return 0
  const days = (new Date(b) - new Date(a)) / 86400000
  if (!Number.isFinite(days) || days <= 0) return 0
  return Math.max(1, Math.round(days / 30.44))
}

/**
 * 年化商业合作收入 = (合同金额 − 归业主的公共收益) ÷ 期间月数 × 12。
 * 非多种经营恒为 0 —— 68 份支出合同算进收入会凭空多出 1074 万。
 */
function annualRevenueOf(c = {}) {
  if ((c.incomeCategory || '') !== '多种经营') return 0
  const m = contractMonthsOf(c)
  if (!m) return 0
  const amount = Number(c.amount) || 0
  const pub = Math.min(Number(c.publicRevenue) || 0, amount)
  return r2((amount - pub) / m * 12)
}

/** 合同对外的行：电话一律掩码（相对方是个人时就是个人信息），社区名服务端带出 */
const contractRow = c => ({
  ...c,
  communityName: c.communityId ? communityNameOf(c.communityId) : '集团层面',
  phone: maskPhone(c.phone),
  restDays: restDaysOf(c.endDate),
  contractMonths: contractMonthsOf(c),
  annualRevenue: annualRevenueOf(c),
  annualPublicRevenue: (() => {
    if ((c.incomeCategory || '') !== '多种经营') return 0
    const m = contractMonthsOf(c)
    if (!m) return 0
    return r2(Math.min(Number(c.publicRevenue) || 0, Number(c.amount) || 0) / m * 12)
  })(),
  changePending: !!c.changePending || contractChanges.some(x => x.contractId === c.contractId && x.status === '待审批')
})

function contractFilter(u, q) {
  const vf = CONTRACT_VF[q.vf] || null
  return contracts
    .map(contractRow)
    .filter(c => inScopeCommunity(u, c.communityId))
    .filter(c => eq(c.type, q.type) && eq(c.subtype, q.subtype)
      && eq(c.communityId, q.communityId) && eq(c.status, q.status)
      && eq(c.incomeCategory, q.incomeCategory))
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
    pending: rows.filter(CONTRACT_VF.pending).length,
    /* 经营口径：合同规模 ≠ 收入规模 */
    operationCount: rows.filter(c => c.incomeCategory === '多种经营').length,
    operationAmount: r2(rows.filter(c => c.incomeCategory === '多种经营').reduce((s2, c) => s2 + annualRevenueOf(c), 0)),
    publicRevenue: r2(rows.filter(c => c.incomeCategory === '多种经营')
      .reduce((s2, c) => {
        const m = contractMonthsOf(c)
        return s2 + (m ? Math.min(Number(c.publicRevenue) || 0, Number(c.amount) || 0) / m * 12 : 0)
      }, 0)),
    expenseCount: rows.filter(c => c.incomeCategory === '不计入').length,
    mainCount: rows.filter(c => c.incomeCategory === '主营业务').length
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
  /* 收入分类与公共收益：非经营合同填公共收益没有意义，且公共收益不能超过合同金额 */
  const incCat = b.incomeCategory || '不计入'
  const pub = Number(b.publicRevenue) || 0
  if (!['主营业务', '多种经营', '不计入'].includes(incCat)) throw invalid('incomeCategory 只能是 主营业务 / 多种经营 / 不计入')
  if (pub < 0) throw invalid('公共收益金额不能为负数')
  if (incCat !== '多种经营' && pub > 0) {
    throw new ApiError(422, 42208, `「${incCat}」的合同不该填公共收益金额 —— 公共收益只来自经营共有部位`)
  }
  if (pub > Number(b.amount)) {
    throw new ApiError(422, 42208, `公共收益金额（${pub}）不能大于合同金额（${b.amount}）`)
  }
  const seq = contracts.length + 1
  const rec = {
    contractId: 'CT' + String(9000 + seq).slice(1),
    /* 单号服务端生成：前端传了也忽略——两个人同时新建会拿到同一个号 */
    contractNo: `HT-${DATA_DATE.slice(0, 4)}-${String(seq).padStart(4, '0')}`,
    name: b.name, type: b.type, subtype: b.subtype || '',
    communityId: b.communityId || '', orgId: b.orgId || '',
    partyB: b.partyB, contact: b.contact || '', phone: b.phone || '',
    amount: r2(Number(b.amount)), payCycle: b.payCycle || '月付',
    incomeCategory: incCat, publicRevenue: r2(pub),
    publicRevenueNote: b.publicRevenueNote || '',
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
    /* 紧急联系人：姓名与关系不脱敏（不是个人号码），电话同手机号一样只给掩码 */
    emergencyContact: e.emergencyContact || '',
    emergencyRelation: e.emergencyRelation || '',
    emergencyPhone: mask ? maskPhone(e.emergencyPhone || '') : (e.emergencyPhone || ''),
    emergencyPhoneRedacted: mask,
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
  'phone', 'idCard', 'socialSecurity', 'regularDate', 'score', 'certificates', 'manager',
  /* 2026-11-04：紧急联系人。与薪资不同，这项越权风险低但漏了代价高，直接开放给有维护权限的角色 */
  'emergencyContact', 'emergencyRelation', 'emergencyPhone'
]
const EMP_RELATION = ['配偶', '父亲', '母亲', '子女', '兄弟姐妹', '其他']
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
  /* 紧急联系人：要么都填、要么都空。只存一半等于没存 —— 出事时打过去不知道该找谁 */
  const ecName = patch.emergencyContact !== undefined ? String(patch.emergencyContact).trim() : String(e.emergencyContact || '').trim()
  const ecPhone = patch.emergencyPhone !== undefined ? String(patch.emergencyPhone).trim() : String(e.emergencyPhone || '').trim()
  const ecRel = patch.emergencyRelation !== undefined ? String(patch.emergencyRelation).trim() : String(e.emergencyRelation || '').trim()
  if (ecPhone && !/^1[3-9]\d{9}$/.test(ecPhone)) throw invalid('紧急联系电话应为 11 位手机号')
  if (ecRel && !EMP_RELATION.includes(ecRel)) throw invalid(`与本人关系只能是 ${EMP_RELATION.join(' / ')}`)
  if (ecPhone && !ecName) throw invalid('填了紧急联系电话，请一并填写联系人姓名（只有号码等于找不到人）')
  if (ecName && !ecPhone) throw invalid('填了紧急联系人，请一并填写联系电话')
  if ((ecName || ecPhone) && !ecRel) throw invalid('请选择紧急联系人与本人的关系')
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
  if (!Array.isArray(fields) || !fields.length) throw bad('fields 至少一项（phone / idCard / emergencyPhone）')
  const LABEL = { phone: '手机号', idCard: '证件号', emergencyPhone: '紧急联系电话' }
  const illegal = fields.filter(f => !LABEL[f])
  if (illegal.length) throw invalid(`不支持揭示 ${illegal.join('、')}，只支持 phone / idCard / emergencyPhone`)
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

/* 角色生效权限：保存后的覆盖优先（默认取 fixture 的 perms）。
   变量本身定义在文件开头（账号段之前要用），这里只留说明，别再声明一次 ——
   重复声明是 SyntaxError，整个假服务起不来，而报错只在启动时出现一次。 */

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
  /* 负责人列表随组织行下发：组织树与维护表要一次看到"谁是正职、谁在代理" */
  leaders: leadersOfOrg(o.orgId),
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

/* ==================== 收银台收款 + 组合支付（2026-11-06 第 62 批） ====================
 * 与原型 `payBills` 同口径（改一处必须改另一处）：
 *   ① 一笔收款最多 3 种方式，同一种方式只能一行；
 *   ② 各方式合计必须等于实收（应缴 − 减免），差一分都不让过；
 *   ③ 一次收款只能针对同一位业主；
 *   ④ **按账单拆流水**：payment 是「一条流水对一张账单」，开票、催缴、账单详情都按这个口径查，
 *      所以按各账单应收比例把 splits 拆开，加起来等于整笔；
 *   ⑤ 收款方式**只认下面这五个**：物业预存账户体系 2026-11 已整体下线
 *      （业主端取消充值、PC 收银台去掉「预存抵扣」），历史流水里还留着这个值，
 *      但那属于 `PayMethodLegacy`，只能读不能写。传了按 422/42212 拒。
 */
const PAY_METHODS = ['现金', '微信支付', '支付宝', 'POS刷卡', '银行代扣']
const PAY_SPLIT_MAX = 3
let MOCK_PAY_SEQ = payments.reduce((m, p) => Math.max(m, +String(p.payId).replace(/\D/g, '') || 0), 0)
let MOCK_BATCH_SEQ = 0

const payR2 = n => Math.round((Number(n) || 0) * 100) / 100

function splitCheck(splits, total) {
  const errs = []
  const rows = (Array.isArray(splits) ? splits : [])
    .filter(s => s && s.method)
    .map(s => ({ method: s.method, amount: payR2(s.amount) }))
  if (!rows.length) errs.push('请至少选择一种收款方式')
  if (rows.length > PAY_SPLIT_MAX) errs.push(`最多 ${PAY_SPLIT_MAX} 种收款方式（再多对账时分不清是系统错还是人填错）`)
  const seen = new Set()
  for (const s of rows) {
    if (!PAY_METHODS.includes(s.method)) errs.push(`不支持的收款方式「${s.method}」`)
    if (!(s.amount > 0)) errs.push(`「${s.method}」的金额必须大于 0`)
    if (seen.has(s.method)) errs.push(`「${s.method}」出现了两次，同一种方式请合成一行`)
    seen.add(s.method)
  }
  const sum = payR2(rows.reduce((a, s) => a + s.amount, 0))
  const target = payR2(total)
  const diff = payR2(target - sum)
  if (rows.length && Math.abs(diff) > 0.01) {
    errs.push(diff > 0 ? `已分配 ¥${sum}，还差 ¥${diff} 未分配` : `已分配 ¥${sum}，超出 ¥${payR2(-diff)}`)
  }
  return { rows, sum, total: target, diff, ok: errs.length === 0, msg: errs.join('；') }
}

function allocSplits(splits, weights) {
  const cents = splits.map(s => Math.round(s.amount * 100))
  const totalW = weights.reduce((a, w) => a + w, 0) || 1
  return weights.map((w, i) => {
    const isLast = i === weights.length - 1
    const row = splits.map((s, j) => {
      const take = isLast ? cents[j] : Math.round(s.amount * 100 * w / totalW)
      cents[j] -= take
      return { method: s.method, amount: take / 100 }
    }).filter(x => x.amount > 0.004)
    const sum = payR2(row.reduce((a, r) => a + r.amount, 0))
    const diff = payR2(w - sum)
    if (Math.abs(diff) > 0.004 && row.length) {
      const big = row.reduce((m, r) => (r.amount > m.amount ? r : m), row[0])
      big.amount = payR2(big.amount + diff)
    }
    return row
  })
}

on('POST', '/payments/batch', (ctx) => {
  requirePerm(ctx.user, 'b.cashier.edit', '缺少权限位 b.cashier.edit：无权收款')
  const b = ctx.body || {}
  const ids = Array.isArray(b.billIds) ? b.billIds : []
  if (!ids.length) throw invalid('请先勾选要收款的账单')

  const list = ids.map(id => BILL.get(id)).filter(Boolean)
  if (list.length !== ids.length) throw new ApiError(404, 40401, '有账单不存在，请刷新后重试')
  const dead = list.find(x => !(x.unpaid > 0))
  if (dead) throw new ApiError(409, 40926, `账单 ${dead.billId} 当前不是欠费状态，请刷新后重试`)
  const owners = [...new Set(list.map(x => x.ownerId))]
  if (owners.length > 1) throw invalid('一次收款只能针对同一位业主，不同业主请分开收')

  const unpaidSum = payR2(list.reduce((a, x) => a + (x.unpaid || 0), 0))
  const disc = payR2(b.discount)
  if (disc < 0) throw invalid('减免金额不能为负')
  if (disc > unpaidSum + 0.01) throw invalid(`减免 ¥${disc} 超过应缴 ¥${unpaidSum}`)
  const received = payR2(unpaidSum - disc)

  const chk = splitCheck(b.splits, received)
  if (!chk.ok) throw new ApiError(422, 42212, chk.msg)

  const weights = list.map(x => x.unpaid || 0)
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
  const billReceived = list.map((x, i) => payR2((x.unpaid || 0) - discParts[i]))
  const billSplits = allocSplits(chk.rows, billReceived)

  MOCK_BATCH_SEQ += 1
  const day = String(b.at || DATA_DATE).slice(0, 10)
  const batchNo = `SK${day.replace(/-/g, '')}-${String(MOCK_BATCH_SEQ).padStart(3, '0')}`
  const created = []
  for (let i = 0; i < list.length; i++) {
    const bill = list[i]
    const mine = billSplits[i]
    if (!mine.length) continue
    MOCK_PAY_SEQ += 1
    const pay = {
      payId: 'PM' + String(MOCK_PAY_SEQ).padStart(6, '0'),
      billId: bill.billId, houseId: bill.houseId, ownerId: bill.ownerId,
      amount: billReceived[i],
      method: mine.reduce((m, x) => (x.amount > m.amount ? x : m), mine[0]).method,
      splits: mine,
      payTime: `${day} 10:00`,
      transNo: 'TXN' + String(Date.now()).slice(-10) + String(i).padStart(2, '0'),
      operator: ctx.user.name,
      invoiceStatus: '未开票', invoiceNo: '',
      channel: '前台收款', batchNo,
      remark: String(b.remark || '').trim()
    }
    payments.unshift(pay)
    created.push(pay)

    bill.paidAmount = payR2((bill.paidAmount || 0) + billReceived[i])
    bill.discount = payR2((bill.discount || 0) + discParts[i])
    bill.unpaid = 0
    bill.status = '已缴'
    bill.payTime = pay.payTime
    bill.payMethod = pay.method
    bill.overdueDays = 0
  }

  return {
    batchNo, count: created.length,
    payable: unpaidSum, discount: disc, received,
    splits: chk.rows,
    payments: created.map(p => ({
      payId: p.payId, billId: p.billId, amount: p.amount, method: p.method,
      splits: p.splits, batchNo: p.batchNo, payTime: p.payTime, channel: p.channel,
      invoiceStatus: p.invoiceStatus, receiptStatus: p.receiptStatus || '未开具'
    }))
  }
})

/* ==================== 临时收费（2026-11-06 第 63 批） ====================
 * 与原型 `saveTempCharge` / `payTempCharge` 同一套口径（改一处必须改另一处）：
 *   ① **独立成表**：不写 bills、不生成应收 —— 所以**不进收缴率**；
 *   ② 收款写一条 `payments`（`billId` 空、`tempChargeId` 指回、`channel='临时收费'`），
 *      日结按方式汇总时能看到，开票池也能开票；
 *   ③ 计入营业收入：`/temp-charges/income` 只算已收款，按 `itemName` 分组；
 *   ④ 只有「待收款」能改、能作废；作废**必须写原因**；
 *   ⑤ 付款方三选一，**项目必填**（收入要按项目入账）。
 */
const tempCharges = readJson('fixtures/temp-charges.json').map(x => ({ ...x }))
let TC_SEQ = tempCharges.length
let TC_PAY_SEQ = payments.reduce((m, p) => Math.max(m, +String(p.payId).replace(/\D/g, '') || 0), 0)

const TC_PERM_VIEW = 'b.tempCharges.view'
const TC_PERM_EDIT = 'b.tempCharges.edit'
const TC_PARTY = ['业主', '租户', '外部']
const TC_STATUS = ['待收款', '已收款', '已作废']
const TC_REASONS = ['摆摊费', '场地租用', '赔偿款', '押金', '其他']

const tcR2 = n => Math.round((Number(n) || 0) * 100) / 100
const tcNotFound = msg => new ApiError(404, 40401, msg)

const tcRow = x => {
  const cmName = COMM_NAME.get(x.communityId)
  const house = x.houseId ? HOUSE.get(x.houseId) : null
  return {
    ...x,
    amount: tcR2(x.amount),
    communityName: cmName || '—',
    houseName: house ? house.fullName : '',
    statusType: x.status === '已收款' ? 'success' : (x.status === '已作废' ? 'info' : 'warning'),
    /* 显式声明：这部分钱**不进收缴率**（没有应收），但计入营业收入 */
    countsInCollectionRate: false,
    countsInIncome: x.status === '已收款'
  }
}

on('GET', '/temp-charges', (ctx) => {
  requirePerm(ctx.user, TC_PERM_VIEW, '缺少权限位 b.tempCharges.view：无权查看临时收费')
  const { kw = '', communityId = '', partyType = '', status = '' } = ctx.query
  const list = tempCharges
    .filter(x => !communityId || x.communityId === communityId)
    .filter(x => !partyType || x.partyType === partyType)
    .filter(x => !status || x.status === status)
    .filter(x => !kw || `${x.chargeNo}${x.partyName}${x.partyPhone}${x.reason}${x.itemName}`.includes(kw))
    .map(tcRow)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return page(list, ctx.query)
})

on('GET', '/temp-charges/stats', (ctx) => {
  requirePerm(ctx.user, TC_PERM_VIEW, '缺少权限位 b.tempCharges.view：无权查看临时收费')
  const paid = tempCharges.filter(x => x.status === '已收款')
  const month = String(DATA_DATE).slice(0, 7)
  return {
    total: tempCharges.length,
    pending: tempCharges.filter(x => x.status === '待收款').length,
    pendingAmount: tcR2(tempCharges.filter(x => x.status === '待收款').reduce((s, x) => s + x.amount, 0)),
    paidCount: paid.length,
    paidAmount: tcR2(paid.reduce((s, x) => s + x.amount, 0)),
    monthAmount: tcR2(paid.filter(x => String(x.payTime).startsWith(month)).reduce((s, x) => s + x.amount, 0)),
    voided: tempCharges.filter(x => x.status === '已作废').length,
    external: tempCharges.filter(x => x.partyType === '外部').length
  }
})

/**
 * 临时收费收入 —— **只算已收款**，且**不影响收缴率**。
 * 营收报表与「公司收入结构」都从这一个口子取，两处各算一次迟早差几分钱。
 */
on('GET', '/temp-charges/income', (ctx) => {
  requirePerm(ctx.user, TC_PERM_VIEW, '缺少权限位 b.tempCharges.view：无权查看临时收费')
  const { communityId = '', year = '' } = ctx.query
  const list = tempCharges
    .filter(x => x.status === '已收款')
    .filter(x => !communityId || x.communityId === communityId)
    .filter(x => !year || String(x.payTime).slice(0, 4) === String(year))
  const m = new Map()
  for (const x of list) {
    const k = x.itemName || '其他'
    const cur = m.get(k) || { itemName: k, count: 0, amount: 0 }
    cur.count += 1
    cur.amount = tcR2(cur.amount + x.amount)
    m.set(k, cur)
  }
  return {
    count: list.length,
    total: tcR2(list.reduce((s, x) => s + x.amount, 0)),
    byItem: [...m.values()].sort((a, b) => b.amount - a.amount),
    countsInCollectionRate: false
  }
})

on('GET', '/temp-charges/reason-options', (ctx) => {
  requirePerm(ctx.user, TC_PERM_VIEW, '缺少权限位 b.tempCharges.view：无权查看临时收费')
  /* 与开票的费用项目同源：发票上写的项目名就是收费事由 */
  const items = invItems.filter(i => i.enabled).map(i => i.name)
  return [...new Set([...TC_REASONS, ...items])].map(v => ({ value: v, label: v }))
})

on('GET', '/temp-charges/{chargeId}', (ctx) => {
  requirePerm(ctx.user, TC_PERM_VIEW, '缺少权限位 b.tempCharges.view：无权查看临时收费')
  const c = tempCharges.find(x => x.chargeId === ctx.params.chargeId)
  if (!c) throw tcNotFound('临时收费单不存在')
  return { ...tcRow(c), payment: c.payId ? (payments.find(p => p.payId === c.payId) || null) : null }
})

function tcPayload(body, user) {
  const partyType = TC_PARTY.includes(body.partyType) ? body.partyType : ''
  if (!partyType) throw invalid(`付款方类型只能是 ${TC_PARTY.join(' / ')}`)

  const partyName = String(body.partyName || '').trim()
  if (!partyName) throw invalid(partyType === '外部' ? '请填写缴费单位或个人名称' : '请选择付款方')
  if (partyName.length > 40) throw invalid('付款方名称不超过 40 字')

  let ownerId = ''
  let tenantId = ''
  let houseId = String(body.houseId || '')
  if (partyType === '业主') {
    const o = OWNER.get(body.ownerId)
    if (!o) throw invalid('选择的业主不存在')
    ownerId = o.ownerId
    if (!houseId) houseId = (o.houseIds || [])[0] || ''
  } else if (partyType === '租户') {
    const t = tenants.find(x => x.tenantId === body.tenantId)
    if (!t) throw invalid('选择的租户不存在')
    tenantId = t.tenantId
    if (!houseId) houseId = t.houseId || ''
  }

  /* 项目必填：收入要按项目统计，没有项目的收入只能进「集团」，事后查不出来源 */
  const communityId = String(body.communityId || (houseId ? ((HOUSE.get(houseId) || {}).communityId || '') : ''))
  if (!communityId) throw invalid('请选择所属项目（收入要按项目入账）')
  if (!COMM_NAME.has(communityId)) throw invalid('所属项目不存在')

  const reason = String(body.reason || '').trim()
  if (!reason) throw invalid('请填写收费事由')
  if (reason.length > 40) throw invalid('收费事由不超过 40 字')

  const amount = tcR2(body.amount)
  if (!(amount > 0)) throw invalid('收费金额必须大于 0')
  if (amount > 1000000) throw invalid('单笔金额不能超过 100 万，超过请拆单或走合同')

  const partyPhone = String(body.partyPhone || '').trim()
  if (partyPhone && !/^1\d{10}$/.test(partyPhone)) throw invalid('联系电话应为 11 位手机号')
  const remark = String(body.remark || '').trim()
  if (remark.length > 120) throw invalid('备注不超过 120 字')

  return {
    partyType, partyName, partyPhone, ownerId, tenantId, houseId, communityId,
    reason,
    /* 收入科目默认等于事由：发票上写的就是它，让人填两遍没意义 */
    itemName: String(body.itemName || reason).trim().slice(0, 20),
    amount, remark
  }
}

on('POST', '/temp-charges', (ctx) => {
  requirePerm(ctx.user, TC_PERM_EDIT, '缺少权限位 b.tempCharges.edit：无权建临时收费单')
  const rec = tcPayload(ctx.body || {}, ctx.user)
  const day = String(DATA_DATE)
  const sameDay = tempCharges.filter(x => String(x.chargeNo).includes(day.replace(/-/g, ''))).length
  TC_SEQ += 1
  const created = {
    chargeId: 'TC' + String(TC_SEQ).padStart(5, '0'),
    chargeNo: `LSF${day.replace(/-/g, '')}-${String(sameDay + 1).padStart(3, '0')}`,
    ...rec,
    status: '待收款',
    method: '', splits: [], payTime: '', payId: '', batchNo: '',
    operator: '',
    createdAt: `${day} 10:00`, createdBy: ctx.user.name,
    voidReason: '', voidAt: '', voidBy: ''
  }
  tempCharges.unshift(created)
  return tcRow(created)
})

on('PATCH', '/temp-charges/{chargeId}', (ctx) => {
  requirePerm(ctx.user, TC_PERM_EDIT, '缺少权限位 b.tempCharges.edit：无权修改临时收费单')
  const c = tempCharges.find(x => x.chargeId === ctx.params.chargeId)
  if (!c) throw tcNotFound('临时收费单不存在')
  /* 收了钱再改金额，等于让流水与单据对不上，而流水已经进了日结 */
  if (c.status !== '待收款') throw new ApiError(409, 40927, `「${c.status}」的单据不能修改，需先作废重开`)
  Object.assign(c, tcPayload({ ...c, ...(ctx.body || {}) }, ctx.user), { updatedAt: `${DATA_DATE} 10:00` })
  return tcRow(c)
})

on('POST', '/temp-charges/{chargeId}/pay', (ctx) => {
  requirePerm(ctx.user, TC_PERM_EDIT, '缺少权限位 b.tempCharges.edit：无权收款')
  const c = tempCharges.find(x => x.chargeId === ctx.params.chargeId)
  if (!c) throw tcNotFound('临时收费单不存在')
  if (c.status === '已收款') throw new ApiError(409, 40926, '这笔已经收过款了')
  if (c.status === '已作废') throw new ApiError(409, 40927, '已作废的单据不能收款')

  const body = ctx.body || {}
  const chk = splitCheck(body.splits, c.amount)
  if (!chk.ok) throw new ApiError(422, 42212, chk.msg)

  TC_PAY_SEQ += 1
  const pay = {
    payId: 'PM' + String(TC_PAY_SEQ).padStart(6, '0'),
    billId: '',
    tempChargeId: c.chargeId,
    tempChargeNo: c.chargeNo,
    tempItemName: c.itemName,
    tempPartyName: c.partyName,
    houseId: c.houseId || '',
    ownerId: c.ownerId || '',
    communityId: c.communityId,
    amount: c.amount,
    method: chk.rows.reduce((m, s) => (s.amount > m.amount ? s : m), chk.rows[0]).method,
    splits: chk.rows.map(s => ({ method: s.method, amount: tcR2(s.amount) })),
    payTime: `${DATA_DATE} 10:00`,
    transNo: 'TXN' + String(TC_PAY_SEQ).padStart(8, '0') + 'T',
    operator: ctx.user.name,
    invoiceStatus: '未开票', invoiceNo: '',
    /* 收据是**独立状态**（第 64 批）：只开收据的流水仍算"没开发票" */
    receiptStatus: '未开具', receiptNo: '',
    channel: '临时收费',
    batchNo: `SK${String(DATA_DATE).replace(/-/g, '')}-T${String(TC_PAY_SEQ).padStart(3, '0')}`,
    remark: String(body.remark || '').trim()
  }
  payments.unshift(pay)

  Object.assign(c, {
    status: '已收款', method: pay.method, splits: pay.splits,
    payTime: pay.payTime, payId: pay.payId, batchNo: pay.batchNo, operator: pay.operator
  })
  return { charge: tcRow(c), payment: pay, methodText: pay.method }
})

on('POST', '/temp-charges/{chargeId}/void', (ctx) => {
  requirePerm(ctx.user, TC_PERM_EDIT, '缺少权限位 b.tempCharges.edit：无权作废临时收费单')
  const c = tempCharges.find(x => x.chargeId === ctx.params.chargeId)
  if (!c) throw tcNotFound('临时收费单不存在')
  if (c.status === '已收款') throw new ApiError(409, 40927, '已收款的单据不能作废，需走退款流程')
  if (c.status === '已作废') throw new ApiError(409, 40928, '这张单已经作废了')
  const why = String((ctx.body || {}).reason || '').trim()
  if (!why) throw invalid('作废必须写原因 —— 台账要能解释这张单为什么没收钱')
  c.status = '已作废'
  c.voidReason = why.slice(0, 60)
  c.voidAt = `${DATA_DATE} 10:00`
  c.voidBy = ctx.user.name
  return tcRow(c)
})

/* ==================== 通讯录（2026-11-06 第 66 批） ====================
 * 与员工档案是**两件事**：档案有薪资/证件/紧急联系人（HR 用），
 * 通讯录只回答"这个人在哪个部门、怎么联系"（所有人用）。
 *
 * 三条硬口径：
 *   ① 只取在职（含试用，排除离职）—— 给离职的人打电话是这类工具最常见的错误；
 *   ② 手机号**不脱敏**：同事之间看全号。与档案的"揭示留痕"刻意相反；
 *   ③ **字段白名单在服务端**：薪资、证件、银行卡、紧急联系人根本不在返回里。
 */
const CONTACT_PERM = 'c.contacts.view'
const CONTACT_FIELDS = ['empId', 'name', 'position', 'orgId', 'orgName', 'phone', 'gender']

const ctActive = () => employees.filter(e => e.status !== '离职')
const ctOrgName = id => (ORG.get(id) || {}).name || '—'

function ctSubtree(orgId) {
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

on('GET', '/contacts', (ctx) => {
  requirePerm(ctx.user, CONTACT_PERM, '缺少权限位 c.contacts.view：无权查看通讯录')
  const { orgId = '', kw = '' } = ctx.query
  const includeSub = ctx.query.includeSub !== 'false'
  const k = String(kw).trim()
  let list = ctActive()
  if (orgId) {
    const ids = includeSub ? ctSubtree(orgId) : new Set([orgId])
    list = list.filter(e => ids.has(e.orgId))
  }
  if (k) {
    list = list.filter(e =>
      `${e.name}${e.position}${e.phone}${ctOrgName(e.orgId)}`.includes(k) ||
      /* 手机号支持搜后 4 位：前台记不住完整号码，但记得尾巴 */
      (k.length >= 4 && String(e.phone || '').endsWith(k))
    )
  }
  const rows = list.map(e => ({
    empId: e.empId, name: e.name, position: e.position || '—',
    orgId: e.orgId, orgName: ctOrgName(e.orgId),
    phone: e.phone || '', gender: e.gender || ''
  })).sort((a, b) => a.orgName.localeCompare(b.orgName, 'zh') || a.name.localeCompare(b.name, 'zh'))

  const m = new Map()
  for (const r of rows) {
    if (!m.has(r.orgId)) m.set(r.orgId, { orgId: r.orgId, orgName: r.orgName, rows: [] })
    m.get(r.orgId).rows.push(r)
  }
  return {
    rows,
    groups: [...m.values()].sort((a, b) => b.rows.length - a.rows.length),
    total: rows.length
  }
})

on('GET', '/contacts/tree', (ctx) => {
  requirePerm(ctx.user, CONTACT_PERM, '缺少权限位 c.contacts.view：无权查看通讯录')
  const direct = new Map()
  for (const e of ctActive()) direct.set(e.orgId, (direct.get(e.orgId) || 0) + 1)
  const build = parentId => orgs
    .filter(o => (o.parentId || '') === parentId)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(o => {
      const children = build(o.orgId)
      const self = direct.get(o.orgId) || 0
      return {
        orgId: o.orgId, name: o.name, type: o.type,
        directCount: self,
        totalCount: self + children.reduce((s, c) => s + c.totalCount, 0),
        children
      }
    })
  /* 只留有人的节点：班组层面不一定有直属员工，0 人节点铺出来只会让人多点三层 */
  const prune = list => list.filter(n => n.totalCount > 0)
    .map(n => ({ ...n, children: prune(n.children || []) }))
  return prune(build(''))
})

on('GET', '/contacts/stats', (ctx) => {
  requirePerm(ctx.user, CONTACT_PERM, '缺少权限位 c.contacts.view：无权查看通讯录')
  const active = ctActive()
  return {
    total: active.length,
    orgCount: new Set(active.map(e => e.orgId)).size,
    withPhone: active.filter(e => e.phone).length
  }
})

/* ==================== 开票设置（2026-11-06 第 61 批） ====================
 * 三个资源，对应三件不同的事：
 *   /invoice-items     费用项目（票据上「项目名称」的词条）
 *   /invoice-profiles  开票信息（抬头档案）
 *   /invoice-template  票据模板（单例）
 *
 * 口径（与 03-原型/src/utils/api.js 同一套，改一处必须改另一处）：
 *   · 带入 ≠ 建档：`/from-owner`、`/from-tenant` 只返回**草稿**，不落库；
 *   · 档案存的是**抬头快照**，业主改名不回写；要改走 `/refresh` 显式覆盖；
 *   · `taxNo` 企业必填（15–20 位），个人可空；同一「抬头 + 税号」不可重复；
 *   · 默认抬头全库唯一（`/default` 会把其他条置 false）；
 *   · **押金 / 赔偿款税率 0**：前者代收、后者不征增值税；
 *   · 模板是单例，参数校验不通过整单拒绝（422/42213）。
 *
 * 契约数据集里没有发票台账，所以 `usageCount` 恒为 0 —— 这是数据缺失，
 * 不是接口不算，真实实现里按 `invoices.itemName` / `profileId` 统计。
 */
const INV_SET = readJson('fixtures/invoice-settings.json')
const invItems = INV_SET.items.map(x => ({ ...x }))
const invProfiles = INV_SET.profiles.map(x => ({ ...x }))
let invTpl = JSON.parse(JSON.stringify(INV_SET.template))
let INV_ITEM_SEQ = invItems.length
let INV_PROFILE_SEQ = invProfiles.length

const INV_SET_PERM = 'b.invoiceSet.edit'
const INV_TAX_RATES = [0, 3, 5, 6, 9, 13]
const INV_TITLE_TYPES = ['个人', '企业']
const INV_SOURCES = ['手动', '业主', '租户']
const invR2 = n => Math.round((Number(n) || 0) * 100) / 100
const invNotFound = msg => new ApiError(404, 40401, msg)
const invState = msg => new ApiError(409, 40927, msg)
/**
 * 「现在几点」—— 必须从 `DATA_DATE` 派生，不能另写一个日期。
 *
 * 原来这里是写死的 '2026-11-06 10:00'，而全套 fixtures 的"当下"是 10-21：
 * 于是新写的工单时间戳落在 11-06、数据里的单子全在 10-21，差半个月。
 * 单看一条不觉得，连着看就是"受理时间早于创建时间"这类脏数据（§13.4 第 1 条同一件事）。
 */
const nowText = () => `${DATA_DATE} 10:00`

const invItemRow = x => ({ ...x, usageCount: 0 })
const invProfileRow = x => ({ ...x, usageCount: 0 })

const invOwnerName = id => (OWNER.get(id) || {}).name || ''
const invHouseOfOwner = ownerId => houses.find(h => h.ownerId === ownerId) || null

function invCleanItems(list) {
  if (!Array.isArray(list)) throw invalid('items 必须是数组')
  return list.map((x, i) => {
    const name = String(x.name || '').trim()
    if (!name) throw invalid(`第 ${i + 1} 个项目没有名称`)
    if (name.length > 20) throw invalid(`项目名称「${name}」超过 20 字（票据上放不下）`)
    const rate = Number(x.taxRate)
    if (!INV_TAX_RATES.includes(rate)) throw invalid(`税率只能是 0 / 3 / 5 / 6 / 9 / 13，「${name}」填的是 ${x.taxRate}`)
    return {
      name, taxRate: rate,
      taxClass: String(x.taxClass || '').trim(),
      remark: String(x.remark || '').trim(),
      enabled: x.enabled !== false,
      builtin: !!x.builtin
    }
  })
}

/* ---------------- 费用项目 ---------------- */
on('GET', '/invoice-items', (ctx) => {
  requirePerm(ctx.user, 'b.invoiceSet.view', '缺少权限位 b.invoiceSet.view：无权查看开票设置')
  const kw = String(ctx.query.kw || '')
  const includeDisabled = ctx.query.includeDisabled !== 'false'
  return invItems
    .filter(i => includeDisabled || i.enabled)
    .filter(i => !kw || `${i.name}${i.taxClass}`.includes(kw))
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(invItemRow)
})

on('GET', '/invoice-items/options', (ctx) => {
  requirePerm(ctx.user, 'b.invoiceSet.view', '缺少权限位 b.invoiceSet.view：无权查看开票设置')
  return invItems.filter(i => i.enabled)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(i => ({ value: i.name, label: i.name, taxRate: i.taxRate, taxClass: i.taxClass }))
})

/* 开票时的项目名：收费科目 + 费用项目。契约数据集没有收费科目（bills / feeItems 不在 fixtures 里），
   所以这里只能回费用项目 —— 真实实现要把 `/fee-items` 一并并进来并按名称去重 */
on('GET', '/invoice-items/name-options', (ctx) => {
  requirePerm(ctx.user, 'b.invoiceSet.view', '缺少权限位 b.invoiceSet.view：无权查看开票设置')
  return invItems.filter(i => i.enabled)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(i => ({ value: i.name, label: i.name, taxRate: i.taxRate, taxClass: i.taxClass, from: 'item' }))
})

on('POST', '/invoice-items', (ctx) => {
  requirePerm(ctx.user, INV_SET_PERM, '缺少权限位 b.invoiceSet.edit：无权维护费用项目')
  const [clean] = invCleanItems([ctx.body || {}])
  if (invItems.some(i => i.name === clean.name)) throw conflictUnique(`费用项目「${clean.name}」已经存在`)
  INV_ITEM_SEQ += 1
  const rec = {
    itemId: 'II' + String(INV_ITEM_SEQ).padStart(2, '0'),
    ...clean,
    sort: invItems.reduce((m, i) => Math.max(m, i.sort || 0), 0) + 10,
    createdAt: nowText(), updatedAt: nowText()
  }
  invItems.push(rec)
  return invItemRow(rec)
})

on('PATCH', '/invoice-items/{itemId}', (ctx) => {
  requirePerm(ctx.user, INV_SET_PERM, '缺少权限位 b.invoiceSet.edit：无权维护费用项目')
  const it = invItems.find(i => i.itemId === ctx.params.itemId)
  if (!it) throw invNotFound('费用项目不存在')
  const merged = { ...it, ...(ctx.body || {}) }
  const [clean] = invCleanItems([merged])
  if (invItems.some(i => i.name === clean.name && i.itemId !== it.itemId)) {
    throw conflictUnique(`费用项目「${clean.name}」已经存在`)
  }
  Object.assign(it, clean, { updatedAt: nowText() })
  return invItemRow(it)
})

on('POST', '/invoice-items/{itemId}/toggle', (ctx) => {
  requirePerm(ctx.user, INV_SET_PERM, '缺少权限位 b.invoiceSet.edit：无权维护费用项目')
  const it = invItems.find(i => i.itemId === ctx.params.itemId)
  if (!it) throw invNotFound('费用项目不存在')
  it.enabled = ctx.body && ctx.body.enabled !== undefined ? !!ctx.body.enabled : !it.enabled
  it.updatedAt = nowText()
  return invItemRow(it)
})

/* ---------------- 开票信息 ---------------- */
/* 注意注册顺序：/stats、/owner-options 这类固定路径必须排在 /{profileId} 之前，
   否则会被当成 id 吃掉（组织负责人那一批踩过一次） */
on('GET', '/invoice-profiles', (ctx) => {
  requirePerm(ctx.user, 'b.invoiceSet.view', '缺少权限位 b.invoiceSet.view：无权查看开票设置')
  const { kw = '', titleType = '', sourceType = '', enabled = '' } = ctx.query
  return invProfiles
    .filter(p => (enabled === '' || enabled === undefined ? true : p.enabled === (enabled === 'true')))
    .filter(p => !titleType || p.titleType === titleType)
    .filter(p => !sourceType || p.sourceType === sourceType)
    .filter(p => !kw || `${p.title}${p.taxNo}${p.contactName}${p.contactPhone}${p.sourceName}`.includes(kw))
    .slice()
    .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || String(a.title).localeCompare(String(b.title), 'zh'))
    .map(invProfileRow)
})

on('GET', '/invoice-profiles/stats', (ctx) => {
  requirePerm(ctx.user, 'b.invoiceSet.view', '缺少权限位 b.invoiceSet.view：无权查看开票设置')
  return {
    total: invProfiles.length,
    personal: invProfiles.filter(p => p.titleType === '个人').length,
    company: invProfiles.filter(p => p.titleType === '企业').length,
    manual: invProfiles.filter(p => p.sourceType === '手动').length,
    fromOwner: invProfiles.filter(p => p.sourceType === '业主').length,
    fromTenant: invProfiles.filter(p => p.sourceType === '租户').length,
    disabled: invProfiles.filter(p => !p.enabled).length
  }
})

on('GET', '/invoice-profiles/owner-options', (ctx) => {
  requirePerm(ctx.user, 'b.invoiceSet.view', '缺少权限位 b.invoiceSet.view：无权查看开票设置')
  const kw = String(ctx.query.kw || '')
  return owners
    .filter(o => !kw || `${o.name}${o.phone || ''}`.includes(kw))
    .slice(0, 50)
    .map(o => {
      const h = invHouseOfOwner(o.ownerId)
      return { value: o.ownerId, label: o.name, phone: o.phone || '', houseName: h ? h.fullName : '' }
    })
})

on('GET', '/invoice-profiles/tenant-options', (ctx) => {
  requirePerm(ctx.user, 'b.invoiceSet.view', '缺少权限位 b.invoiceSet.view：无权查看开票设置')
  const kw = String(ctx.query.kw || '')
  return tenants
    .filter(t => t.status === '在住')
    .filter(t => !kw || `${t.name}${t.companyName || ''}${t.phone || ''}`.includes(kw))
    .slice(0, 50)
    .map(t => ({
      value: t.tenantId,
      label: t.tenantType === '公司' ? (t.companyName || t.name) : t.name,
      tenantType: t.tenantType, creditCode: t.creditCode || '', phone: t.phone || '',
      houseName: (HOUSE.get(t.houseId) || {}).fullName || ''
    }))
})

on('GET', '/invoice-profiles/from-owner/{ownerId}', (ctx) => {
  requirePerm(ctx.user, 'b.invoiceSet.view', '缺少权限位 b.invoiceSet.view：无权查看开票设置')
  const o = OWNER.get(ctx.params.ownerId)
  if (!o) throw invNotFound('业主不存在')
  const h = invHouseOfOwner(o.ownerId)
  return {
    profileId: '', titleType: '个人', title: o.name, taxNo: '',
    bankName: '', bankAccount: '', regAddress: '', regPhone: '',
    contactName: o.name, contactPhone: o.phone || '', contactEmail: o.email || '',
    sourceType: '业主', sourceId: o.ownerId, sourceName: o.name,
    houseId: h ? h.houseId : '',
    remark: `从业主档案带入（${o.ownerId}）`
  }
})

on('GET', '/invoice-profiles/from-tenant/{tenantId}', (ctx) => {
  requirePerm(ctx.user, 'b.invoiceSet.view', '缺少权限位 b.invoiceSet.view：无权查看开票设置')
  const t = tenants.find(x => x.tenantId === ctx.params.tenantId)
  if (!t) throw invNotFound('租户不存在')
  const isCompany = t.tenantType === '公司' || !!t.creditCode
  if (isCompany) {
    return {
      profileId: '', titleType: '企业', title: t.companyName || t.name, taxNo: t.creditCode || '',
      bankName: '', bankAccount: '',
      regAddress: t.regAddress || '', regPhone: t.phone || '',
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
    bankName: '', bankAccount: '', regAddress: '', regPhone: '',
    contactName: t.name, contactPhone: t.phone || '', contactEmail: '',
    sourceType: '租户', sourceId: t.tenantId, sourceName: t.name,
    houseId: t.houseId || '',
    remark: `从租户档案带入（${t.tenantId}）`
  }
})

on('GET', '/invoice-profiles/of-house/{houseId}', (ctx) => {
  requirePerm(ctx.user, 'b.invoiceSet.view', '缺少权限位 b.invoiceSet.view：无权查看开票设置')
  const h = HOUSE.get(ctx.params.houseId)
  if (!h) throw invNotFound('房屋不存在')
  const out = []
  out.push(...invProfiles
    .filter(p => p.enabled && p.sourceType === '业主' && p.sourceId === h.ownerId)
    .map(p => ({ ...invProfileRow(p), roleLabel: '房主' })))
  const tenantIds = tenants.filter(t => t.houseId === h.houseId && t.status === '在住').map(t => t.tenantId)
  out.push(...invProfiles
    .filter(p => p.enabled && p.sourceType === '租户' && tenantIds.includes(p.sourceId))
    .map(p => ({ ...invProfileRow(p), roleLabel: '租户' })))
  if (!out.length) {
    out.push({
      profileId: '', titleType: '个人', title: invOwnerName(h.ownerId), taxNo: '',
      roleLabel: '房主', sourceType: '业主', sourceId: h.ownerId, _adhoc: true
    })
  }
  return out
})

on('GET', '/invoice-profiles/{profileId}', (ctx) => {
  requirePerm(ctx.user, 'b.invoiceSet.view', '缺少权限位 b.invoiceSet.view：无权查看开票设置')
  const p = invProfiles.find(x => x.profileId === ctx.params.profileId)
  if (!p) throw invNotFound('开票信息不存在')
  return invProfileRow(p)
})

on('POST', '/invoice-profiles', (ctx) => {
  requirePerm(ctx.user, INV_SET_PERM, '缺少权限位 b.invoiceSet.edit：无权维护开票信息')
  const rec = invProfilePayload(ctx.body || {})
  INV_PROFILE_SEQ += 1
  const created = {
    profileId: 'IP' + String(INV_PROFILE_SEQ).padStart(4, '0'),
    ...rec, isDefault: !!ctx.body.isDefault,
    createdAt: nowText(), updatedAt: nowText(), createdBy: ctx.user.name
  }
  invProfiles.push(created)
  if (created.isDefault) invSetDefault(created.profileId)
  return invProfileRow(created)
})

on('PATCH', '/invoice-profiles/{profileId}', (ctx) => {
  requirePerm(ctx.user, INV_SET_PERM, '缺少权限位 b.invoiceSet.edit：无权维护开票信息')
  const p = invProfiles.find(x => x.profileId === ctx.params.profileId)
  if (!p) throw invNotFound('开票信息不存在')
  const rec = invProfilePayload({ ...p, ...(ctx.body || {}) })
  Object.assign(p, rec, { updatedAt: nowText() })
  if (ctx.body.isDefault) invSetDefault(p.profileId)
  return invProfileRow(p)
})

on('POST', '/invoice-profiles/{profileId}/default', (ctx) => {
  requirePerm(ctx.user, INV_SET_PERM, '缺少权限位 b.invoiceSet.edit：无权维护开票信息')
  const p = invProfiles.find(x => x.profileId === ctx.params.profileId)
  if (!p) throw invNotFound('开票信息不存在')
  if (!p.enabled) throw invState('已停用的抬头不能设为默认')
  invSetDefault(p.profileId)
  return invProfileRow(p)
})

on('POST', '/invoice-profiles/{profileId}/toggle', (ctx) => {
  requirePerm(ctx.user, INV_SET_PERM, '缺少权限位 b.invoiceSet.edit：无权维护开票信息')
  const p = invProfiles.find(x => x.profileId === ctx.params.profileId)
  if (!p) throw invNotFound('开票信息不存在')
  p.enabled = ctx.body && ctx.body.enabled !== undefined ? !!ctx.body.enabled : !p.enabled
  if (!p.enabled && p.isDefault) p.isDefault = false
  p.updatedAt = nowText()
  return invProfileRow(p)
})

on('POST', '/invoice-profiles/{profileId}/refresh', (ctx) => {
  requirePerm(ctx.user, INV_SET_PERM, '缺少权限位 b.invoiceSet.edit：无权维护开票信息')
  const p = invProfiles.find(x => x.profileId === ctx.params.profileId)
  if (!p) throw invNotFound('开票信息不存在')
  if (!p.sourceId || p.sourceType === '手动') throw invState('这条是手工填写的，没有可带入的来源')
  const before = p.title
  if (p.sourceType === '业主') {
    const o = OWNER.get(p.sourceId)
    if (!o) throw invNotFound('来源业主已不存在')
    p.title = o.name
    p.contactName = o.name
    p.contactPhone = o.phone || p.contactPhone
    p.titleType = '个人'
  } else {
    const t = tenants.find(x => x.tenantId === p.sourceId)
    if (!t) throw invNotFound('来源租户已不存在')
    const isCompany = t.tenantType === '公司' || !!t.creditCode
    p.titleType = isCompany ? '企业' : '个人'
    p.title = isCompany ? (t.companyName || t.name) : t.name
    if (isCompany) {
      p.taxNo = t.creditCode || p.taxNo
      p.regAddress = t.regAddress || p.regAddress
      p.contactName = t.agentName || t.legalPerson || p.contactName
      p.contactPhone = t.agentPhone || t.phone || p.contactPhone
    }
  }
  p.updatedAt = nowText()
  return { ...invProfileRow(p), _before: before }
})

function invSetDefault(profileId) {
  for (const p of invProfiles) p.isDefault = p.profileId === profileId
}

function invProfilePayload(body) {
  const title = String(body.title || '').trim()
  if (!title) throw invalid('发票抬头不能为空')
  if (title.length > 60) throw invalid('发票抬头不超过 60 字')
  const titleType = INV_TITLE_TYPES.includes(body.titleType) ? body.titleType : '个人'
  const taxNo = String(body.taxNo || '').trim().toUpperCase()
  if (titleType === '企业' && !taxNo) throw invalid('企业抬头必须填纳税人识别号（开票要用）')
  if (taxNo && !/^[0-9A-Z]{15,20}$/.test(taxNo)) throw invalid('纳税人识别号应为 15–20 位数字或大写字母')
  const dup = invProfiles.find(p => p.title === title && p.taxNo === taxNo && p.profileId !== body.profileId)
  if (dup) throw conflictUnique(`抬头「${title}」${taxNo ? `（${taxNo}）` : ''}已经存在`)
  return {
    titleType, title, taxNo,
    bankName: String(body.bankName || '').trim(),
    bankAccount: String(body.bankAccount || '').trim(),
    regAddress: String(body.regAddress || '').trim(),
    regPhone: String(body.regPhone || '').trim(),
    contactName: String(body.contactName || '').trim(),
    contactPhone: String(body.contactPhone || '').trim(),
    contactEmail: String(body.contactEmail || '').trim(),
    sourceType: INV_SOURCES.includes(body.sourceType) ? body.sourceType : '手动',
    sourceId: String(body.sourceId || ''),
    sourceName: String(body.sourceName || ''),
    houseId: String(body.houseId || ''),
    enabled: body.enabled !== false,
    remark: String(body.remark || '').trim()
  }
}

/* ---------------- 票据模板（单例） ---------------- */
const INV_FONTS = ['宋体', '仿宋', '黑体', '楷体']

function invTplCheck(t) {
  const errs = []
  const w = Number(t.paper && t.paper.width)
  const h = Number(t.paper && t.paper.height)
  if (!(w >= 100 && w <= 420)) errs.push('纸张宽度应在 100–420mm（241 是针打连续纸的标准宽）')
  if (!(h >= 60 && h <= 297)) errs.push('纸张高度应在 60–297mm')
  const m = t.margin || {}
  for (const k of ['top', 'right', 'bottom', 'left']) {
    const v = Number(m[k])
    if (!(v >= 0 && v <= 60)) errs.push(`页边距「${k}」应在 0–60mm`)
  }
  if (Number(m.left) + Number(m.right) >= w - 40) errs.push('左右边距太大，内容区宽度不足 40mm')
  if (Number(m.top) + Number(m.bottom) >= h - 30) errs.push('上下边距太大，内容区高度不足 30mm')
  const size = Number(t.font && t.font.size)
  if (!(size >= 6 && size <= 16)) errs.push('字号应在 6–16pt（针打低于 6pt 会糊，高于 16pt 一页放不下）')
  const lh = Number(t.font && t.font.lineHeight)
  if (!(lh >= 1 && lh <= 3)) errs.push('行高倍数应在 1.0–3.0')
  const copies = Number(t.copies)
  if (!(copies >= 1 && copies <= 4)) errs.push('联数应为 1–4（再多针打一次过不去）')
  if (!String(t.title || '').trim()) errs.push('票据标题不能为空')
  if (!INV_FONTS.includes(t.font && t.font.family)) errs.push('字体只能选宋体 / 仿宋 / 黑体 / 楷体（针打自带字库就这几套）')
  return { ok: errs.length === 0, errs }
}

on('GET', '/invoice-template', (ctx) => {
  requirePerm(ctx.user, 'b.invoiceSet.view', '缺少权限位 b.invoiceSet.view：无权查看开票设置')
  return JSON.parse(JSON.stringify(invTpl))
})

on('PUT', '/invoice-template', (ctx) => {
  requirePerm(ctx.user, INV_SET_PERM, '缺少权限位 b.invoiceSet.edit：无权维护票据模板')
  const b = ctx.body || {}
  const draft = {
    ...JSON.parse(JSON.stringify(invTpl)),
    ...b,
    paper: { ...invTpl.paper, ...(b.paper || {}) },
    margin: { ...invTpl.margin, ...(b.margin || {}) },
    offset: { ...invTpl.offset, ...(b.offset || {}) },
    font: { ...invTpl.font, ...(b.font || {}) }
  }
  const chk = invTplCheck(draft)
  if (!chk.ok) throw new ApiError(422, 42213, `模板参数不合法：${chk.errs.join('；')}`)
  draft.copies = Number(draft.copies)
  draft.copyTitles = (draft.copyTitles || []).slice(0, draft.copies)
  while (draft.copyTitles.length < draft.copies) draft.copyTitles.push(`第 ${draft.copyTitles.length + 1} 联`)
  draft.updatedAt = nowText()
  draft.updatedBy = ctx.user.name
  invTpl = draft
  return JSON.parse(JSON.stringify(invTpl))
})

on('POST', '/invoice-template/reset', (ctx) => {
  requirePerm(ctx.user, INV_SET_PERM, '缺少权限位 b.invoiceSet.edit：无权维护票据模板')
  invTpl = JSON.parse(JSON.stringify(INV_SET.template))
  invTpl.updatedAt = nowText()
  invTpl.updatedBy = ctx.user.name
  return JSON.parse(JSON.stringify(invTpl))
})

on('POST', '/invoice-template/check', (ctx) => {
  requirePerm(ctx.user, 'b.invoiceSet.view', '缺少权限位 b.invoiceSet.view：无权查看开票设置')
  return invTplCheck({ ...invTpl, ...(ctx.body || {}) })
})

/* ------------------------------ 邻居（N 域） ------------------------------ */
/*
 * 数据来自 fixtures/neighbor-*.json，由 `scripts/gen-neighbor-fixtures.mjs` 从
 * `03-原型/src/utils/api.js` 的运行时种子生成 —— 手写会导致"假服务 3 条待审、
 * 前端 mock 也 3 条"这种巧合很快失效，一改原型就对不上。
 *
 * 这一域有一个容易写错的地方：**活动阶段是推出来的，不是存的**。
 * `status` 只有 草稿/报名中/已结束 三种，`报名中 / 待成行 / 已成行` 要看
 * 报名截止日 + 已报人数 + 成团下限一起算。存成字段的话，代报名之后
 * 「待成行」不会自动变「已成行」，列表就一直挂着"还差 0 人成团"。
 */
const neighborItems = readJson('fixtures/neighbor-items.json')
const neighborReports = readJson('fixtures/neighbor-reports.json')
const neighborActivities = readJson('fixtures/neighbor-activities.json')
const neighborEnrolls = readJson('fixtures/neighbor-enrolls.json')
/* 投票：fixture 里的 `totalVotes` 已经是选项之和（见 gen-neighbor-fixtures.mjs），
   这里不再兼容源数据的同名字段 —— 兼容的结果是两种口径长期共存 */
const neighborVotes = readJson('fixtures/neighbor-votes.json')

/** 演示基准日：与 fixtures 的「当下」同一个口径 */
const NV_TODAY = DATA_DATE

const NV_PERM = {
  workbench: 'n.workbench.view',
  itemView: 'n.items.view',
  itemAudit: 'n.items.audit',
  reportView: 'n.reports.view',
  reportHandle: 'n.reports.handle',
  actView: 'n.activities.view',
  actEnroll: 'n.activities.enroll',
  actEdit: 'n.activities.edit',
  voteView: 'n.votes.view',
  voteEdit: 'n.votes.edit'
}
const NV_REPORT_ACTIONS = ['忽略', '仅警告', '下架并警告', '封禁 7 天']

const nvItemOf = id => neighborItems.find(i => i.itemId === id) || null
const nvReportOf = id => neighborReports.find(r => r.reportId === id) || null
const nvActOf = id => neighborActivities.find(a => a.activityId === id) || null
const nvEnrollOf = id => neighborEnrolls.find(e => e.enrollId === id) || null

const NV_ENROLL_DEAD = ['已取消', '已退款']
/** 已报名人数含同行人，不含已取消 / 已退款 —— 名额判定与列表数字必须同源 */
const nvEnrolledOf = activityId => neighborEnrolls
  .filter(e => e.activityId === activityId && !NV_ENROLL_DEAD.includes(e.status))
  .reduce((s, e) => s + (Number(e.people) || 1), 0)

const NV_PHASE_TYPE = {
  草稿: 'info', 报名中: 'success', 待成行: 'warning',
  已成行: 'success', 已流团: 'danger', 已结束: ''
}

function nvPhaseOf(a) {
  if (a.status === '草稿') return '草稿'
  /* 先判流团：confirmFlow 会把 status 一并置成已结束，先判已结束就永远看不到流团痕迹 */
  if (a.flowedAt) return '已流团'
  if (a.status === '已结束') return '已结束'
  const deadline = a.enrollDeadline || String(a.startAt).slice(0, 10)
  if (deadline >= NV_TODAY) return '报名中'
  const min = Number(a.minCapacity) || 0
  if (!min) return '已成行'
  return nvEnrolledOf(a.activityId) >= min ? '已成行' : '待成行'
}

function nvItemRow(i) {
  const { sellerPhone, wechat, ...rest } = i
  return { ...rest, _ver: verOf('neighborItem', i.itemId) }
}

function nvReportRow(r) {
  const i = nvItemOf(r.itemId)
  return {
    reportId: r.reportId,
    itemId: r.itemId,
    itemTitle: i ? i.title : '（内容已删除）',
    itemStatus: i ? i.status : '',
    /* 举报记录本身没有项目字段：移动端要按项目过滤，必须由服务端从被举报内容带出来 */
    communityId: i ? i.communityId : '',
    communityName: i ? communityNameOf(i.communityId) : '',
    sellerName: i ? i.sellerName : '',
    sellerHouse: i ? i.sellerHouse : '',
    reason: r.reason,
    detail: r.detail,
    reporterName: r.reporterName,
    reporterHouse: r.reporterHouse,
    at: r.at,
    status: r.status,
    action: r.action || '',
    note: r.note || '',
    handledBy: r.handledBy || '',
    handledAt: r.handledAt || ''
  }
}

function nvActRow(a) {
  const enrolled = nvEnrolledOf(a.activityId)
  const phase = nvPhaseOf(a)
  const min = Number(a.minCapacity) || 0
  const fee = Number(a.fee) || 0
  const paidAmount = neighborEnrolls
    .filter(e => e.activityId === a.activityId && !NV_ENROLL_DEAD.includes(e.status) && fee > 0)
    .reduce((s, e) => s + r2(fee * (Number(e.people) || 1)), 0)
  return {
    activityId: a.activityId,
    title: a.title,
    category: a.category,
    /* 收费口径是派生值：免费 / 收费，与类别正交 */
    feeType: fee > 0 ? '收费' : '免费',
    fee,
    feeText: fee > 0 ? `¥${r2(fee)}/人` : '免费',
    communityId: a.communityId,
    communityName: communityNameOf(a.communityId),
    startAt: a.startAt,
    endAt: a.endAt,
    place: a.place,
    capacity: a.capacity,
    minCapacity: min,
    enrollDeadline: a.enrollDeadline,
    enrolled,
    left: Math.max(0, a.capacity - enrolled),
    /* 距成团还差几人：待成行时这是运营最想看的数 */
    gap: min ? Math.max(0, min - enrolled) : 0,
    phase: nvPhaseOf(a),
    needInsurance: !!a.needInsurance,
    attendeeLimit: a.attendeeLimit || 1,
    feeInclude: a.feeInclude || '',
    feeExclude: a.feeExclude || '',
    refundPolicy: a.refundPolicy || [],
    /* 进度条最多 100%：种子里有报名数超过名额的活动（42/20），
       按比例直接画会出 210%，看起来像算错了。超额单独给一个数。 */
    fillRate: a.capacity ? Math.min(100, r2((enrolled / a.capacity) * 100)) : 0,
    over: Math.max(0, enrolled - a.capacity),
    phaseType: NV_PHASE_TYPE[phase] || '',
    desc: a.desc || '',
    createdBy: a.createdBy || '',
    flowedAt: a.flowedAt || '',
    flowReason: a.flowReason || '',
    paidAmount: r2(paidAmount),
    organizer: a.organizer || '物业服务中心'
  }
}

/** 列表掩码、详情明文 —— 与业主档案同一条口径 */
function nvEnrollRow(e, { mask = true } = {}) {
  const a = nvActOf(e.activityId)
  const fee = a ? Number(a.fee) || 0 : 0
  const people = Number(e.people) || 1
  const settled = e.status === '已取消' || e.status === '已退款'
  return {
    enrollId: e.enrollId,
    activityId: e.activityId,
    activityTitle: a ? a.title : '（活动已删除）',
    name: e.name,
    phone: mask ? maskPhone(e.phone) : e.phone,
    houseShort: e.houseShort || '',
    people,
    at: e.at,
    status: e.status,
    fee,
    amount: r2(fee * people),
    payStatus: e.status === '已退款'
      ? '已退款'
      : fee <= 0 ? '无需支付' : (e.paidCash ? '已支付' : '待支付'),
    source: e.source || '业主自助',
    operator: e.operator || '',
    paymentMethod: e.paymentMethod || '',
    checkinBy: e.checkinBy || '',
    checkinAt: e.checkinAt || '',
    refundAmount: e.refundAmount || 0,
    refundBy: e.refundBy || '',
    cancelReason: e.cancelReason || '',
    attendees: e.attendees || [],
    _ver: verOf('neighborEnroll', e.enrollId)
  }
}

/** 按分档算退款比例：距开始 ≥N 天 → 对应比例，否则取最后一档（与 PC 同一套） */
function nvRefundRatioOf(a) {
  if (!a || !a.refundPolicy || !a.refundPolicy.length) return 100
  const start = String(a.startAt).slice(0, 10)
  const gap = Math.round((new Date(`${start}T00:00:00`) - new Date(`${NV_TODAY}T00:00:00`)) / 86400000)
  /* 从天数大的往小找：升序排第一个满足 gap>=days 的永远是「当天 0%」那档 */
  const tier = [...a.refundPolicy]
    .sort((x, y) => Number(y.days) - Number(x.days))
    .find(p => gap >= Number(p.days))
  return tier ? Number(tier.ratio) : 0
}

const nvAssertActScope = (u, a) => {
  if (!inScopeCommunity(u, a.communityId)) {
    throw forbidden(`「${a.activityId}」不在你的数据范围内（${u.dataScope}）`)
  }
}

/* ============================ 投票（意见征询） ============================
 * 口径与 `03/src/utils/api.js` 的 N 域保持一致（那边是运行时的唯一真相）：
 *   ① 不产出结论 —— 没有 `passed`，也不留 `conclusion` 这种空壳；
 *   ② `totalVotes` = 选项票数之和；
 *   ③ `target` = max(应投户数, 票数)，所以 `partRate` 恒 ≤100%。
 * 主键是 `voteId`（值 = 问卷表的 surveyId），不新造编号。
 */
const NV_ACT_CATEGORIES = ['敬老', '亲子', '文体', '出游', '公益']
const NV_VOTE_STATUS = ['草稿', '进行中', '已结束']
const NV_VOTE_TYPES = ['满意度调查', '意见征询', '方案征询']
const NV_VOTE_STATUS_TYPE = { 草稿: 'info', 进行中: 'success', 已结束: '' }

const nvVoteOf = id => neighborVotes.find(v => v.surveyId === id) || null

/** 应投户数：项目内去重业主数。租户不计 —— 征询的是产权人意见 */
const nvTargetOf = communityId => new Set(
  houses.filter(h => h.communityId === communityId && h.ownerId).map(h => h.ownerId)
).size

const nvVoteTotal = v => (v.options || []).reduce((n, o) => n + (Number(o.votes) || 0), 0)

/**
 * 票数归一：与前端 `_nvNormalizeVotes` 同一套算法。
 *
 * 种子里票数是独立随机生成的，出现过「310 票 / 189 户」这种硬伤 —— 参与率 164%，
 * 这一页的数字立刻没人信了。真实系统里不可能（一户一票），所以按户数上限压回来：
 * 超过 55% 的按比例缩到 55%，余数补给票数最高的选项，保证合计对得上。
 * 只压不回补：本来就低于 55% 的不动，避免把「参与率低」这个真实信号抹平。
 */
function nvNormalizeVotes() {
  neighborVotes.forEach(v => {
    const target = nvTargetOf(v.communityId)
    const total = nvVoteTotal(v)
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
nvNormalizeVotes()

/**
 * 问卷表里的 `type` 是「问卷 / 投票」，接口层用业务叫法。
 * 映射只做一次（在载入后），不要在 `nvVoteRow` 里映射 —— 那样「列表筛选用原值、
 * 返回用映射值」，按类型筛出来的结果会跟显示的标签对不上。
 */
const NV_TYPE_OF = { 问卷: '满意度调查', 投票: '意见征询' }
neighborVotes.forEach(v => { v.type = NV_TYPE_OF[v.type] || v.type })

function nvVoteRow(v) {
  const total = nvVoteTotal(v)
  const target = nvTargetOf(v.communityId)
  /* 分母兜住上限：出现 310 票 / 189 户 时，参与率不会算成 164% */
  const base = Math.max(target, total)
  return {
    voteId: v.surveyId,
    title: v.title,
    type: v.type,
    communityId: v.communityId,
    communityName: v.communityName,
    desc: v.desc || '',
    audience: v.audience || '全部业主',
    startAt: v.startAt || '',
    endAt: v.endAt,
    status: v.status,
    statusType: NV_VOTE_STATUS_TYPE[v.status] || '',
    multi: !!v.multi,
    maxPick: Number(v.maxPick) || 1,
    anonymous: v.anonymous !== false,
    optionCount: (v.options || []).length,
    options: (v.options || []).map(o => ({ key: o.key, label: o.label, votes: Number(o.votes) || 0 })),
    totalVotes: total,
    target: base,
    partRate: base ? r2((total / base) * 100) : 0,
    createdBy: v.createdBy || '',
    createdAt: v.createdAt || '',
    publishedAt: v.publishedAt || '',
    endedAt: v.endedAt || ''
  }
}

/** 结果聚合：分布 + 参与率 + 样本提示。**没有结论字段，也不留空壳** */
function nvVoteResultOf(v) {
  const row = nvVoteRow(v)
  const options = row.options
    .map(o => ({ ...o, pct: row.totalVotes ? r2((o.votes / row.totalVotes) * 100) : 0 }))
    .sort((a, b) => b.votes - a.votes)
  const target = row.target || 1
  return {
    ...row,
    options,
    topOption: options[0] || null,
    /* 样本提示，不是结论：作用是让人在群里转发前先看一眼"只有 12% 的人投了" */
    confidence: row.partRate >= 50 ? '有效' : row.partRate >= 30 ? '可参考' : '偏低',
    notVoted: Math.max(0, target - row.totalVotes)
  }
}

const nvVoteListOf = u => neighborVotes.filter(v => inScopeCommunity(u, v.communityId))

/** 校验投票请求体。返回规整后的字段（选项只收 label） */
function nvVoteInput(body = {}) {
  const title = String(body.title || '').trim()
  if (!title) throw invalid('投票标题必填')
  if (title.length > 40) throw invalid('标题最多 40 字')
  if (!NV_VOTE_TYPES.includes(body.type)) {
    throw invalid(`投票类型只能是 ${NV_VOTE_TYPES.join(' / ')}`)
  }
  if (!body.communityId) throw invalid('必须选择项目 —— 投票范围是按项目算的')
  if (!body.endAt) throw invalid('必须设置截止日期')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.endAt))) throw invalid('截止日期格式应为 YYYY-MM-DD')
  const opts = (body.options || []).map(o => String(o?.label ?? o ?? '').trim()).filter(Boolean)
  if (opts.length < 2) throw invalid('至少需要 2 个选项')
  if (opts.length > 10) throw invalid('选项最多 10 个')
  if (new Set(opts).size !== opts.length) throw invalid('选项有重复，请合并')
  if (opts.some(o => o.length > 30)) throw invalid('单个选项最多 30 字')
  const multi = !!body.multi
  const maxPick = multi ? (Number(body.maxPick) || 0) : 1
  if (multi && (maxPick < 1 || maxPick > opts.length)) {
    throw invalid(`多选时「最多可选」须在 1 ~ ${opts.length} 之间`)
  }
  return {
    title,
    type: body.type,
    communityId: String(body.communityId),
    desc: String(body.desc || '').trim().slice(0, 300),
    endAt: String(body.endAt),
    multi,
    maxPick,
    anonymous: body.anonymous !== false,
    audience: String(body.audience || '全部业主'),
    optionLabels: opts
  }
}

on('GET', '/neighbor/summary', (ctx) => {
  requirePerm(ctx.user, NV_PERM.workbench, `缺少权限位 ${NV_PERM.workbench}：无权查看邻里工作台`)
  const mine = c => inScopeCommunity(ctx.user, c)
  const items = neighborItems.filter(i => mine(i.communityId) && i.status === '待审核').length
  const reports = neighborReports
    .filter(r => r.status === '待处理')
    .filter(r => {
      const i = nvItemOf(r.itemId)
      return i && mine(i.communityId)
    }).length
  return { items, reports, total: items + reports }
})

on('GET', '/neighbor/items', (ctx) => {
  requirePerm(ctx.user, NV_PERM.itemView, `缺少权限位 ${NV_PERM.itemView}：无权查看闲置内容`)
  assertInScope(ctx.user, ctx.query)
  const q = ctx.query
  const list = neighborItems
    .filter(i => inScopeCommunity(ctx.user, i.communityId))
    .filter(i => eq(i.communityId, q.communityId) && eq(i.status, q.status))
    .filter(i => kwHit([i.itemId, i.title, i.sellerName, i.desc, i.sellerHouse], q.kw))
    .map(nvItemRow)
    /* 待审永远排最前：队列页要的就是"下一步做什么" */
    .sort((a, b) => {
      if ((a.status === '待审核') !== (b.status === '待审核')) return a.status === '待审核' ? -1 : 1
      return String(b.publishAt).localeCompare(String(a.publishAt))
    })
  return page(list, q)
})

on('GET', '/neighbor/items/stats', (ctx) => {
  requirePerm(ctx.user, NV_PERM.itemView, `缺少权限位 ${NV_PERM.itemView}：无权查看闲置内容`)
  assertInScope(ctx.user, ctx.query)
  const mine = i => inScopeCommunity(ctx.user, i.communityId)
  const all = neighborItems.filter(mine)
  const audited = all.filter(i => ['已上架', '已驳回'].includes(i.status))
  return {
    total: all.length,
    pending: all.filter(i => i.status === '待审核').length,
    online: all.filter(i => i.status === '已上架').length,
    rejected: all.filter(i => i.status === '已驳回').length,
    offline: all.filter(i => i.status === '已下架').length,
    expired: all.filter(i => i.status === '已过期').length,
    todayNew: all.filter(i => String(i.publishAt).slice(0, 10) === NV_TODAY).length,
    /* 通过率只算"审过的"：把待审的算进分母会把通过率稀释成看起来很低的数 */
    passRate: audited.length ? r2((audited.filter(i => i.status === '已上架').length / audited.length) * 100) : 0,
    /* 累计举报次数：只增不减，别拿它当待办角标（那个看 /reports/stats 的 pending） */
    reported: all.reduce((n, i) => n + (Number(i.reportCount) || 0), 0)
  }
})

on('GET', '/neighbor/items/categories', (ctx) => {
  requirePerm(ctx.user, NV_PERM.itemView, `缺少权限位 ${NV_PERM.itemView}：无权查看闲置内容`)
  assertInScope(ctx.user, ctx.query)
  /* 与前端 `itemCategories()` 同一口径：从已有内容里扫，顺序不保证。
     所以它只适合筛选；发布表单的分类要写死，否则"今天没人挂"的分类明天就发不出去。 */
  return [...new Set(neighborItems
    .filter(i => inScopeCommunity(ctx.user, i.communityId))
    .map(i => i.category))]
})

on('GET', '/neighbor/items/{itemId}', (ctx) => {
  requirePerm(ctx.user, NV_PERM.itemView, `缺少权限位 ${NV_PERM.itemView}：无权查看闲置内容`)
  const i = nvItemOf(ctx.params.itemId)
  if (!i) throw notFound('内容不存在')
  if (!inScopeCommunity(ctx.user, i.communityId)) throw forbidden('这条内容不在你的数据范围内')
  return nvItemRow(i)
})

on('POST', '/neighbor/items/{itemId}/audit', (ctx) => {
  requirePerm(ctx.user, NV_PERM.itemAudit, `缺少权限位 ${NV_PERM.itemAudit}：无权审核闲置内容`)
  const i = nvItemOf(ctx.params.itemId)
  if (!i) throw notFound('内容不存在')
  if (!inScopeCommunity(ctx.user, i.communityId)) throw forbidden('这条内容不在你的数据范围内')
  if (i.status !== '待审核') {
    throw new ApiError(409, 40960, `这条已经是「${i.status}」，不能重复审核`)
  }
  const body = ctx.body || {}
  if (typeof body.pass !== 'boolean') throw invalid('pass 必须是布尔值')
  const why = String(body.reason || '').trim()
  /* 驳回必须写理由 —— 业主会拿着通知来问为什么 */
  if (!body.pass && !why) throw invalid('驳回必须写理由 —— 业主会拿着通知来问为什么')
  Object.assign(i, {
    status: body.pass ? '已上架' : '已驳回',
    rejectReason: body.pass ? '' : why,
    auditBy: String(body.operator || '').trim() || ctx.user.name,
    auditAt: nowText()
  })
  bumpVer('neighborItem', i.itemId)
  return nvItemRow(i)
})

on('POST', '/neighbor/items/{itemId}/offline', (ctx) => {
  requirePerm(ctx.user, NV_PERM.itemAudit, `缺少权限位 ${NV_PERM.itemAudit}：无权下架闲置内容`)
  const i = nvItemOf(ctx.params.itemId)
  if (!i) throw notFound('内容不存在')
  if (!inScopeCommunity(ctx.user, i.communityId)) throw forbidden('这条内容不在你的数据范围内')
  const why = String((ctx.body || {}).reason || '').trim()
  if (!why) throw invalid('下架必须写理由')
  if (i.status !== '已上架') {
    throw new ApiError(409, 40961, `只有「已上架」能下架，这条是「${i.status}」`)
  }
  Object.assign(i, {
    status: '已下架',
    offlineReason: why,
    auditBy: String((ctx.body || {}).operator || '').trim() || ctx.user.name,
    auditAt: nowText()
  })
  bumpVer('neighborItem', i.itemId)
  return nvItemRow(i)
})

on('GET', '/neighbor/reports', (ctx) => {
  requirePerm(ctx.user, NV_PERM.reportView, `缺少权限位 ${NV_PERM.reportView}：无权查看举报`)
  const q = ctx.query
  const list = neighborReports
    .filter(r => {
      const i = nvItemOf(r.itemId)
      return i && inScopeCommunity(ctx.user, i.communityId)
    })
    .filter(r => eq(r.status, q.status) && eq(r.reason, q.reason))
    .map(nvReportRow)
    .filter(r => kwHit([r.itemTitle, r.reporterName, r.detail], q.kw))
    .sort((a, b) => {
      if ((a.status === '待处理') !== (b.status === '待处理')) return a.status === '待处理' ? -1 : 1
      return String(b.at).localeCompare(String(a.at))
    })
  return page(list, q)
})

on('GET', '/neighbor/reports/stats', (ctx) => {
  requirePerm(ctx.user, NV_PERM.reportView, `缺少权限位 ${NV_PERM.reportView}：无权查看举报`)
  assertInScope(ctx.user, ctx.query)
  /* 举报记录本身没有项目字段，范围判断要从被举报内容带 —— 与列表同源 */
  const mine = r => { const i = nvItemOf(r.itemId); return i && inScopeCommunity(ctx.user, i.communityId) }
  const list = neighborReports.filter(mine)
  return {
    total: list.length,
    pending: list.filter(r => r.status === '待处理').length,
    handled: list.filter(r => r.status === '已处理').length,
    /* 「下架并警告」的条数：这是唯一真伤到内容方的处置，单独数 */
    offline: list.filter(r => r.action === '下架并警告').length
  }
})

on('GET', '/neighbor/reports/{reportId}', (ctx) => {
  requirePerm(ctx.user, NV_PERM.reportView, `缺少权限位 ${NV_PERM.reportView}：无权查看举报`)
  const r = nvReportOf(ctx.params.reportId)
  if (!r) throw notFound('举报不存在')
  const row = nvReportRow(r)
  if (!inScopeCommunity(ctx.user, row.communityId)) throw forbidden('这条举报不在你的数据范围内')
  return row
})

on('POST', '/neighbor/reports/{reportId}/handle', (ctx) => {
  requirePerm(ctx.user, NV_PERM.reportHandle, `缺少权限位 ${NV_PERM.reportHandle}：无权处理举报`)
  const r = nvReportOf(ctx.params.reportId)
  if (!r) throw notFound('举报不存在')
  if (r.status === '已处理') throw new ApiError(409, 40970, '这条举报已经处理过了')
  const body = ctx.body || {}
  if (!NV_REPORT_ACTIONS.includes(body.action)) throw invalid(`处理方式只能是：${NV_REPORT_ACTIONS.join(' / ')}`)
  const note = String(body.note || '').trim()
  /* 说明必填 —— 事后要能解释为什么这么判 */
  if (!note) throw invalid('处理说明必填 —— 事后要能解释为什么这么判')

  const i = nvItemOf(r.itemId)
  if (body.action === '下架并警告' && i && i.status === '已上架') {
    Object.assign(i, {
      status: '已下架',
      offlineReason: `举报核实：${r.reason}`,
      auditBy: String(body.operator || '').trim() || ctx.user.name,
      auditAt: nowText()
    })
    bumpVer('neighborItem', i.itemId)
  }
  Object.assign(r, {
    status: '已处理',
    action: body.action,
    note,
    handledBy: String(body.operator || '').trim() || ctx.user.name,
    handledAt: nowText()
  })
  return nvReportRow(r)
})

on('GET', '/neighbor/activities', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actView, `缺少权限位 ${NV_PERM.actView}：无权查看活动`)
  assertInScope(ctx.user, ctx.query)
  const q = ctx.query
  const list = neighborActivities
    .filter(a => inScopeCommunity(ctx.user, a.communityId))
    .filter(a => eq(a.communityId, q.communityId))
    .map(nvActRow)
    /* 只列「报名中 / 待成行 / 已成行」：草稿、已流团、已结束留在 PC 做导出归档 */
    .filter(a => ['报名中', '待成行', '已成行'].includes(a.phase))
    .filter(a => eq(a.phase, q.phase))
    .filter(a => kwHit([a.title, a.activityId, a.place], q.kw))
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
  return page(list, q)
})

on('GET', '/neighbor/activities/stats', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actView, `缺少权限位 ${NV_PERM.actView}：无权查看活动`)
  assertInScope(ctx.user, ctx.query)
  const rows = neighborActivities
    .filter(a => inScopeCommunity(ctx.user, a.communityId))
    .map(a => nvActRow(a))
  const money = rows.filter(r => r.fee > 0)
  return {
    total: rows.length,
    running: rows.filter(r => r.phase === '报名中').length,
    waiting: rows.filter(r => r.phase === '待成行').length,
    odd: rows.filter(r => r.phase === '已成行').length,
    flowed: rows.filter(r => r.phase === '已流团').length,
    paidAmount: r2(money.reduce((n, r) => n + r.paidAmount, 0)),
    enrollPeople: rows.reduce((n, r) => n + r.enrolled, 0),
    /* 待成行的活动一共还差多少人成团 —— 决定要不要发推送拉一把 */
    gapTotal: rows.filter(r => r.phase === '待成行').reduce((n, r) => n + r.gap, 0)
  }
})

on('GET', '/neighbor/activities/options', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actView, `缺少权限位 ${NV_PERM.actView}：无权查看活动`)
  assertInScope(ctx.user, ctx.query)
  /* 只给未结束、非草稿的：下拉是用来代报名的，草稿和已结束的选了也没用 */
  return neighborActivities
    .filter(a => inScopeCommunity(ctx.user, a.communityId))
    .filter(a => !['已结束', '草稿'].includes(nvPhaseOf(a)))
    .map(a => ({
      value: a.activityId,
      /* label 带日期：同名活动一年办两次是常事，只给标题一定会选错 */
      label: `${a.title} · ${String(a.startAt).slice(0, 10)}`
    }))
})

on('GET', '/neighbor/activities/{activityId}', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actView, `缺少权限位 ${NV_PERM.actView}：无权查看活动`)
  const a = nvActOf(ctx.params.activityId)
  if (!a) throw notFound('活动不存在')
  nvAssertActScope(ctx.user, a)
  return nvActRow(a)
})

on('GET', '/neighbor/activities/{activityId}/enrolls', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actView, `缺少权限位 ${NV_PERM.actView}：无权查看报名名单`)
  const a = nvActOf(ctx.params.activityId)
  if (!a) throw notFound('活动不存在')
  nvAssertActScope(ctx.user, a)
  const q = ctx.query
  /* 名单统一走分页信封；行内手机号掩码，单条详情才明文 */
  return page(
    neighborEnrolls
      .filter(e => e.activityId === a.activityId)
      .filter(e => eq(e.status, q.status))
      .map(e => nvEnrollRow(e))
      .sort((x, y) => String(x.at).localeCompare(String(y.at))),
    q
  )
})

on('POST', '/neighbor/activities/{activityId}/enroll', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actEnroll, `缺少权限位 ${NV_PERM.actEnroll}：无权代报名`)
  const a = nvActOf(ctx.params.activityId)
  if (!a) throw notFound('活动不存在')
  nvAssertActScope(ctx.user, a)

  const phase = nvPhaseOf(a)
  if (phase !== '报名中') {
    throw new ApiError(409, 40946, `活动当前是「${phase}」，不能再报名`)
  }

  const body = ctx.body || {}
  const name = String(body.name || '').trim()
  if (!name) throw invalid('联系人姓名必填')
  if (name.length > 20) throw invalid('联系人姓名最多 20 字')
  const phone = String(body.phone || '').trim()
  if (!/^1\d{10}$/.test(phone)) throw invalid('联系电话须为 11 位手机号')
  const people = Number(body.people)
  if (!Number.isInteger(people) || people < 1) throw invalid('人数必须是 ≥1 的整数')
  const limit = Number(a.attendeeLimit) || 1
  if (people > limit) throw invalid(`这场活动每户最多报 ${limit} 人`)

  /* 同一手机号重复报名要拦：现场两个人同时办会重复，静默加一条后果是名单多一人、钱少收一份 */
  const dup = neighborEnrolls.find(e => e.activityId === a.activityId
    && e.phone === phone && !NV_ENROLL_DEAD.includes(e.status))
  if (dup) {
    throw new ApiError(409, 40947, `「${dup.name}」已经报过名了（${dup.status}），不要重复添加`)
  }

  const enrolled = nvEnrolledOf(a.activityId)
  if (enrolled + people > a.capacity) {
    throw new ApiError(409, 40948, `名额只剩 ${Math.max(0, a.capacity - enrolled)} 人`)
  }

  /* 要投保就必须每位出行人实名 —— 只有联系人买不了保险 */
  const attendees = (body.attendees || []).filter(t => String(t.name || '').trim())
  if (a.needInsurance) {
    if (attendees.length !== people) throw invalid(`需要投保，必须填满 ${people} 位出行人`)
    for (const t of attendees) {
      if (!String(t.idNo || '').trim()) throw invalid(`出行人「${t.name}」缺证件号，无法投保`)
    }
  }

  if (body.paid && Number(a.fee) > 0 && !['现金', '扫码'].includes(body.paymentMethod)) {
    throw invalid('现场已收款必须选收款方式（现金 / 扫码）')
  }

  const seq = neighborEnrolls.reduce((m, e) => Math.max(m, Number(String(e.enrollId).slice(2)) || 0), 0) + 1
  const row = {
    enrollId: `AE${String(seq).padStart(4, '0')}`,
    activityId: a.activityId,
    name,
    phone,
    houseShort: String(body.houseShort || '').trim(),
    people,
    at: nowText(),
    status: '已报名',
    attendees: attendees.map(t => ({
      name: t.name,
      idType: t.idType || '身份证',
      idNo: String(t.idNo || '').trim(),
      phone: t.phone || phone,
      ageType: t.ageType || '成人'
    })),
    source: '前台代报',
    remark: String(body.remark || '').trim(),
    paidCash: Number(a.fee) > 0 ? !!body.paid : false,
    operator: String(body.operator || '').trim() || ctx.user.name,
    paymentMethod: Number(a.fee) > 0 && body.paid ? body.paymentMethod : ''
  }
  neighborEnrolls.unshift(row)
  return nvEnrollRow(row, { mask: false })
})

on('POST', '/neighbor/enrolls/{enrollId}/cancel', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actEnroll, `缺少权限位 ${NV_PERM.actEnroll}：无权取消报名`)
  const e = nvEnrollOf(ctx.params.enrollId)
  if (!e) throw notFound('报名记录不存在')
  if (NV_ENROLL_DEAD.includes(e.status)) throw new ApiError(409, 40949, '这条报名已经取消了')
  if (e.status === '已签到') throw new ApiError(409, 40950, '已签到的不能再取消，请走退款并备注')
  const a = nvActOf(e.activityId)
  if (a && Number(a.fee) > 0) {
    throw new ApiError(409, 40951, '收费活动的报名取消要同时退款，请用「取消并退款」')
  }
  Object.assign(e, {
    status: '已取消',
    cancelReason: String((ctx.body || {}).reason || '').trim() || '业主主动取消'
  })
  bumpVer('neighborEnroll', e.enrollId)
  return nvEnrollRow(e, { mask: false })
})

on('POST', '/neighbor/enrolls/{enrollId}/refund', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actEnroll, `缺少权限位 ${NV_PERM.actEnroll}：无权办理退款`)
  const e = nvEnrollOf(ctx.params.enrollId)
  if (!e) throw notFound('报名记录不存在')
  if (e.status === '已退款') throw new ApiError(409, 40952, '这条报名已经退过款了')
  const a = nvActOf(e.activityId)
  if (!a || Number(a.fee) <= 0) {
    throw new ApiError(409, 40953, '公益活动的报名只需取消，无需退款')
  }
  const full = r2(Number(a.fee) * (Number(e.people) || 1))
  /* 单笔超过 ¥2000 引导到 PC —— 移动端不做大额退款 */
  if (full > 2000) throw new ApiError(409, 40954, '单笔退款超过 ¥2000，请到 PC 端办理')

  const ratio = nvRefundRatioOf(a)
  const amount = r2(full * ratio / 100)
  Object.assign(e, {
    status: '已退款',
    refundAmount: amount,
    refundAt: nowText(),
    refundBy: String((ctx.body || {}).operator || '').trim() || ctx.user.name,
    cancelReason: String((ctx.body || {}).reason || '').trim() || '现场取消'
  })
  bumpVer('neighborEnroll', e.enrollId)
  return { enroll: nvEnrollRow(e, { mask: false }), ratio, amount }
})

on('POST', '/neighbor/enrolls/{enrollId}/checkin', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actEnroll, `缺少权限位 ${NV_PERM.actEnroll}：无权签到`)
  const e = nvEnrollOf(ctx.params.enrollId)
  if (!e) throw notFound('报名记录不存在')
  if (e.status === '已签到') throw new ApiError(409, 40955, '这条已经签过到了')
  if (e.status !== '已报名') throw new ApiError(409, 40956, `「${e.status}」的报名不能签到`)
  const a = nvActOf(e.activityId)
  /* 待成行不能签到：人可能根本不成行 */
  if (a && nvPhaseOf(a) !== '已成行') {
    throw new ApiError(409, 40957, `活动当前是「${nvPhaseOf(a)}」，还不能签到`)
  }
  Object.assign(e, {
    status: '已签到',
    checkinBy: ctx.user.name,
    checkinAt: nowText()
  })
  bumpVer('neighborEnroll', e.enrollId)
  return nvEnrollRow(e, { mask: false })
})

/* ============================ 投票接口 ============================ */
const nvNextId = (rows, field, prefix) => {
  const max = rows.reduce((m, r) => Math.max(m, Number(String(r[field]).replace(/\D/g, '')) || 0), 0)
  return prefix + String(max + 1).padStart(4, '0')
}

on('GET', '/neighbor/votes', (ctx) => {
  requirePerm(ctx.user, NV_PERM.voteView, `缺少权限位 ${NV_PERM.voteView}：无权查看投票`)
  assertInScope(ctx.user, ctx.query)
  const q = ctx.query
  /* 进行中 → 草稿 → 已结束，同组内按截止日倒序：草稿还能改、还要发，排在已结束之前 */
  const rank = { 进行中: 0, 草稿: 1, 已结束: 2 }
  const list = nvVoteListOf(ctx.user)
    .filter(v => eq(v.communityId, q.communityId))
    .filter(v => eq(v.type, q.type))
    .filter(v => eq(v.status, q.status))
    .filter(v => kwHit([v.title, v.surveyId, v.desc], q.kw))
    .map(v => nvVoteRow(v))
    .sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
      return String(b.endAt).localeCompare(String(a.endAt))
    })
  return page(list, q)
})

on('GET', '/neighbor/votes/stats', (ctx) => {
  requirePerm(ctx.user, NV_PERM.voteView, `缺少权限位 ${NV_PERM.voteView}：无权查看投票`)
  assertInScope(ctx.user, ctx.query)
  const list = nvVoteListOf(ctx.user).filter(v => eq(v.communityId, ctx.query.communityId))
  const running = list.filter(v => v.status === '进行中').map(v => nvVoteRow(v))
  const ended = list.filter(v => v.status === '已结束').map(v => nvVoteRow(v))
  const avg = rows => (rows.length ? r2(rows.reduce((s, v) => s + v.partRate, 0) / rows.length) : 0)
  return {
    total: list.length,
    running: running.length,
    draft: list.filter(v => v.status === '草稿').length,
    ended: ended.length,
    /* 两组分开给：进行中的参与率还在爬，和已结束的一起取平均没法解释 */
    runningPartRate: avg(running),
    endedPartRate: avg(ended),
    /* 票数合计，多选一票勾两项算两票 —— 别拿它当户数用 */
    votesTotal: list.reduce((s, v) => s + nvVoteTotal(v), 0)
  }
})

on('GET', '/neighbor/votes/{voteId}', (ctx) => {
  requirePerm(ctx.user, NV_PERM.voteView, `缺少权限位 ${NV_PERM.voteView}：无权查看投票`)
  const v = nvVoteOf(ctx.params.voteId)
  if (!v) throw new ApiError(404, 40430, '投票不存在')
  if (!inScopeCommunity(ctx.user, v.communityId)) throw forbidden('这场投票不在你的数据范围内')
  return nvVoteRow(v)
})

on('GET', '/neighbor/votes/{voteId}/result', (ctx) => {
  requirePerm(ctx.user, NV_PERM.voteView, `缺少权限位 ${NV_PERM.voteView}：无权查看投票`)
  const v = nvVoteOf(ctx.params.voteId)
  if (!v) throw new ApiError(404, 40430, '投票不存在')
  if (!inScopeCommunity(ctx.user, v.communityId)) throw forbidden('这场投票不在你的数据范围内')
  return nvVoteResultOf(v)
})

on('POST', '/neighbor/votes', (ctx) => {
  requirePerm(ctx.user, NV_PERM.voteEdit, `缺少权限位 ${NV_PERM.voteEdit}：无权新建投票`)
  const input = nvVoteInput(ctx.body || {})
  if (!inScopeCommunity(ctx.user, input.communityId)) throw forbidden('该项目不在你的数据范围内')
  const community = LS_COMMUNITY.get(input.communityId) || {}
  const row = {
    surveyId: nvNextId(neighborVotes, 'surveyId', 'SV'),
    communityId: input.communityId,
    communityName: community.name || '',
    title: input.title,
    type: input.type,
    desc: input.desc,
    audience: input.audience,
    /* 草稿的 startAt 是空的，发布时才置为当天 */
    startAt: '',
    endAt: input.endAt,
    status: '草稿',
    multi: input.multi,
    maxPick: input.maxPick,
    anonymous: input.anonymous,
    /* key 由服务端生成：客户端生成会撞 key，而票是按 key 记的 */
    options: input.optionLabels.map((label, i) => ({ key: `A${i + 1}`, label, votes: 0 })),
    createdBy: ctx.user.name,
    createdAt: nowText(),
    publishedAt: '',
    endedAt: ''
  }
  neighborVotes.unshift(row)
  return nvVoteRow(row)
})

on('PATCH', '/neighbor/votes/{voteId}', (ctx) => {
  requirePerm(ctx.user, NV_PERM.voteEdit, `缺少权限位 ${NV_PERM.voteEdit}：无权编辑投票`)
  const v = nvVoteOf(ctx.params.voteId)
  if (!v) throw new ApiError(404, 40430, '投票不存在')
  if (!inScopeCommunity(ctx.user, v.communityId)) throw forbidden('这场投票不在你的数据范围内')
  /* 已开始的不能改：改完的选项会让已投出的票指向不存在的位置 */
  if (v.status !== '草稿') {
    throw new ApiError(409, 40930, '投票已开始，题目与选项都不能再改。要调整请复制一份新的')
  }
  const input = nvVoteInput({ ...ctx.body, communityId: v.communityId })
  const next = {
    title: input.title,
    type: input.type,
    desc: input.desc,
    audience: input.audience,
    endAt: input.endAt,
    multi: input.multi,
    maxPick: input.maxPick,
    anonymous: input.anonymous,
    /* 保留原 key 上已累积的票数；被删掉的选项连票一起丢（草稿正常没票，安全） */
    options: input.optionLabels.map((label, i) => {
      const old = (v.options || []).find(o => o.label === label)
      return { key: old ? old.key : `A${i + 1}`, label, votes: old ? Number(old.votes) || 0 : 0 }
    })
  }
  Object.assign(v, next)
  return nvVoteRow(v)
})

on('POST', '/neighbor/votes/{voteId}/publish', (ctx) => {
  requirePerm(ctx.user, NV_PERM.voteEdit, `缺少权限位 ${NV_PERM.voteEdit}：无权发布投票`)
  const v = nvVoteOf(ctx.params.voteId)
  if (!v) throw new ApiError(404, 40430, '投票不存在')
  if (!inScopeCommunity(ctx.user, v.communityId)) throw forbidden('这场投票不在你的数据范围内')
  /* 重复发布不做幂等成功：有人以为没发出去，要让他看到"已经在进行中" */
  if (v.status === '进行中') throw new ApiError(409, 40931, '这个投票已经在进行中了')
  if (v.status === '已结束') throw new ApiError(409, 40932, '已结束的投票不能重新发布，请复制一份')
  if (String(v.endAt).slice(0, 10) < NV_TODAY) throw invalid(`截止日期 ${v.endAt} 已经过了，改一下再发布`)
  if ((v.options || []).length < 2) throw invalid('至少需要 2 个选项才能发布')
  /* 草稿的 startAt 是空的，用"创建日"当开始日会让统计口径对不上 */
  Object.assign(v, { status: '进行中', startAt: NV_TODAY, publishedAt: nowText() })
  return nvVoteRow(v)
})

on('POST', '/neighbor/votes/{voteId}/end', (ctx) => {
  requirePerm(ctx.user, NV_PERM.voteEdit, `缺少权限位 ${NV_PERM.voteEdit}：无权结束投票`)
  const v = nvVoteOf(ctx.params.voteId)
  if (!v) throw new ApiError(404, 40430, '投票不存在')
  if (!inScopeCommunity(ctx.user, v.communityId)) throw forbidden('这场投票不在你的数据范围内')
  /* 草稿没有"结束"这回事，删掉即可 */
  if (v.status !== '进行中') throw new ApiError(409, 40933, '只有在进行中的投票才能结束')
  /* 结束只改状态，不产出任何结论 */
  Object.assign(v, { status: '已结束', endedAt: nowText() })
  return nvVoteRow(v)
})

on('DELETE', '/neighbor/votes/{voteId}', (ctx) => {
  requirePerm(ctx.user, NV_PERM.voteEdit, `缺少权限位 ${NV_PERM.voteEdit}：无权删除投票`)
  const v = nvVoteOf(ctx.params.voteId)
  if (!v) throw new ApiError(404, 40430, '投票不存在')
  if (!inScopeCommunity(ctx.user, v.communityId)) throw forbidden('这场投票不在你的数据范围内')
  /* 只有草稿能删：票已经投出去了，删掉等于抹掉参与记录 */
  if (v.status !== '草稿') throw new ApiError(409, 40934, '只有草稿能删除，已发布的投票要保留留痕')
  neighborVotes.splice(neighborVotes.indexOf(v), 1)
  return true
})

/* ============================ 活动（运营侧补充） ============================
 * 校验与状态机照抄 `03/src/utils/api.js` 的 N 域，错误码也沿用同一套（40940~40945）：
 * 前端已经按这些码写提示文案，改码等于改文案。
 */
function nvActivityInput(body = {}, cur = null) {
  const title = String(body.title || '').trim()
  if (!title) throw invalid('活动名称必填')
  if (title.length > 40) throw invalid('活动名称最多 40 字')
  /* 类别是枚举，必须选；收费与否看金额，不用单独传 type */
  const category = String(body.category || '').trim()
  if (!NV_ACT_CATEGORIES.includes(category)) {
    throw invalid(`活动类别只能是 ${NV_ACT_CATEGORIES.join(' / ')}`)
  }
  const communityId = String(body.communityId || '')
  if (!communityId) throw invalid('必须选择项目')
  const startAt = String(body.startAt || '').slice(0, 16)
  const endAt = String(body.endAt || '').slice(0, 16)
  if (!startAt || !endAt) throw invalid('开始与结束时间都要填')
  if (endAt < startAt) throw invalid('结束时间不能早于开始时间')
  if (!String(body.place || '').trim()) throw invalid('活动地点必填 —— 业主报名后要知道去哪')
  const capacity = Number(body.capacity) || 0
  if (capacity < 1) throw invalid('名额至少 1 人')
  const deadline = String(body.enrollDeadline || '').slice(0, 10)
  if (!deadline) throw invalid('报名截止时间必填')
  /* 活动开始了还在收人，车已经走了 */
  if (deadline > startAt.slice(0, 10)) throw invalid('报名截止不能晚于活动开始 —— 否则活动开始了还在收人')
  const enrolled = cur ? nvEnrolledOf(cur.activityId) : 0
  if (cur && capacity < enrolled) throw invalid(`名额不能小于已报名人数（${enrolled} 人）`)

  const fee = Number(body.fee) || 0
  let minCapacity = 0
  let refundPolicy = []
  /* 收费与否只看金额：fee > 0 才需要成团下限与退款档位 */
  if (fee > 0) {
    minCapacity = Number(body.minCapacity) || 0
    if (minCapacity < 1) throw invalid('收费活动必须设成团下限 —— 否则收完钱团没成，退款没依据')
    if (minCapacity > capacity) throw invalid('成团下限不能大于名额')
    refundPolicy = (body.refundPolicy || []).map(p => ({ days: Number(p.days), ratio: Number(p.ratio) }))
    if (!refundPolicy.length) throw invalid('收费活动必须配退款分档')
    for (const p of refundPolicy) {
      if (!(p.days >= 0)) throw invalid('退款分档的「提前天数」必须是 0 或正整数')
      if (!(p.ratio >= 0 && p.ratio <= 100)) throw invalid('退款比例须在 0 ~ 100 之间')
    }
    /* 提前越久退得越多：反过来就是在惩罚早取消的人 */
    const sorted = [...refundPolicy].sort((a, b) => b.days - a.days)
    for (let k = 1; k < sorted.length; k += 1) {
      if (sorted[k].ratio > sorted[k - 1].ratio) {
        throw invalid('退款比例应随「提前天数」减少而降低，请检查分档')
      }
    }
    /* 钱已经收了再改单价，已报名的人金额就对不上 */
    if (cur && enrolled > 0 && Number(cur.fee) !== fee) {
      throw invalid('已有人报名，不能再改单价。要调价请另开一场活动')
    }
  }
  return {
    title,
    category,
    communityId,
    startAt,
    endAt,
    place: String(body.place).trim(),
    capacity,
    minCapacity,
    enrollDeadline: deadline,
    fee,
    feeInclude: String(body.feeInclude || '').trim(),
    feeExclude: String(body.feeExclude || '').trim(),
    refundPolicy,
    needInsurance: !!body.needInsurance,
    attendeeLimit: Math.max(1, Number(body.attendeeLimit) || 1),
    desc: String(body.desc || '').trim()
  }
}

on('POST', '/neighbor/activities', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actEdit, `缺少权限位 ${NV_PERM.actEdit}：无权新建活动`)
  const patch = nvActivityInput(ctx.body || {})
  if (!inScopeCommunity(ctx.user, patch.communityId)) throw forbidden('该项目不在你的数据范围内')
  const act = {
    activityId: nvNextId(neighborActivities, 'activityId', 'AC'),
    ...patch,
    status: '草稿',
    organizer: '物业服务中心',
    views: 0,
    createdBy: ctx.user.name
  }
  neighborActivities.unshift(act)
  return nvActRow(act)
})

on('PATCH', '/neighbor/activities/{activityId}', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actEdit, `缺少权限位 ${NV_PERM.actEdit}：无权编辑活动`)
  const a = nvActOf(ctx.params.activityId)
  if (!a) throw new ApiError(404, 40440, '活动不存在')
  nvAssertActScope(ctx.user, a)
  /* 已结束或已流团的不能改：办完的改内容等于事后修改宣传口径，流团的改了退款依据就没了 */
  if (a.status === '已结束' || a.flowedAt) {
    throw new ApiError(409, 40940, '已结束或已流团的活动不能再改，请复制一份新的')
  }
  Object.assign(a, nvActivityInput(ctx.body || {}, a))
  return nvActRow(a)
})

on('POST', '/neighbor/activities/{activityId}/publish', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actEdit, `缺少权限位 ${NV_PERM.actEdit}：无权发布活动`)
  const a = nvActOf(ctx.params.activityId)
  if (!a) throw new ApiError(404, 40440, '活动不存在')
  nvAssertActScope(ctx.user, a)
  if (a.status === '已结束') throw new ApiError(409, 40941, '已结束的活动不能重新发布，请复制一份')
  if (a.status === '报名中' && !a.flowedAt) throw new ApiError(409, 40942, '活动已经在报名中了')
  const phase = nvPhaseOf(a)
  if (phase !== '草稿' && phase !== '已流团') {
    throw new ApiError(409, 40943, `当前状态是「${phase}」，不能重新发布`)
  }
  if (String(a.enrollDeadline).slice(0, 10) < NV_TODAY) {
    throw invalid(`报名截止 ${a.enrollDeadline} 已经过了，改一下再发布`)
  }
  if (String(a.startAt).slice(0, 10) < NV_TODAY) throw invalid('开始时间已经过了，改一下再发布')
  Object.assign(a, { status: '报名中', flowedAt: '', flowReason: '' })
  return nvActRow(a)
})

on('POST', '/neighbor/activities/{activityId}/end', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actEdit, `缺少权限位 ${NV_PERM.actEdit}：无权结束活动`)
  const a = nvActOf(ctx.params.activityId)
  if (!a) throw new ApiError(404, 40440, '活动不存在')
  nvAssertActScope(ctx.user, a)
  if (a.status === '已结束') throw new ApiError(409, 40944, '活动已经结束了')
  /* 只改状态，不动钱：办完了归档，和"没办成要退钱"是两件事 */
  a.status = '已结束'
  return nvActRow(a)
})

on('POST', '/neighbor/activities/{activityId}/flow', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actEdit, `缺少权限位 ${NV_PERM.actEdit}：无权确认流团`)
  const a = nvActOf(ctx.params.activityId)
  if (!a) throw new ApiError(404, 40440, '活动不存在')
  nvAssertActScope(ctx.user, a)
  if (nvPhaseOf(a) !== '待成行') throw new ApiError(409, 40945, '只有「待成行」的活动才能确认流团')
  const reason = String(ctx.body?.reason || '').trim()
  /* 业主会拿着通知来问"为什么没成行"，没有原因的通知等于没通知 */
  if (!reason) throw invalid('流团必须写原因 —— 业主会来问为什么没成行')
  const fee = Number(a.fee) || 0
  const list = neighborEnrolls
    .filter(e => e.activityId === a.activityId)
    .filter(e => !['已取消', '已退款'].includes(e.status))
  let refunded = 0
  list.forEach(e => {
    if (fee > 0) {
      /* 没成团是物业的问题，不是业主的：比例恒 100% */
      const money = r2(fee * (Number(e.people) || 1))
      Object.assign(e, {
        status: '已退款',
        refundAmount: money,
        refundAt: nowText(),
        refundBy: ctx.user.name,
        cancelReason: '未达成团人数，全额退款'
      })
      refunded = r2(refunded + money)
    } else {
      /* 公益没收到钱，只置取消 —— 造一张 0 元退款单只会让账更乱 */
      Object.assign(e, { status: '已取消', cancelReason: '未达成团人数' })
    }
    bumpVer('neighborEnroll', e.enrollId)
  })
  Object.assign(a, { flowedAt: nowText(), flowReason: reason, status: '已结束' })
  return { activity: nvActRow(a), count: list.length, refunded }
})

on('GET', '/neighbor/activities/{activityId}/refund-ratio', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actView, `缺少权限位 ${NV_PERM.actView}：无权查看活动`)
  const a = nvActOf(ctx.params.activityId)
  if (!a) throw new ApiError(404, 40440, '活动不存在')
  nvAssertActScope(ctx.user, a)
  /* 没有退款档位的活动（公益）恒 100 */
  if (!a.refundPolicy || !a.refundPolicy.length) return 100
  const start = String(a.startAt).slice(0, 10)
  const atDay = String(ctx.query.atDay || NV_TODAY).slice(0, 10)
  const gap = Math.floor((new Date(`${start}T00:00:00`) - new Date(`${atDay}T00:00:00`)) / 86400000)
  /* 必须从天数大的往小找：升序排第一个命中 gap>=days 的永远是 days=0 那档 */
  const tier = [...a.refundPolicy]
    .sort((x, y) => Number(y.days) - Number(x.days))
    .find(p => gap >= Number(p.days))
  return tier ? Number(tier.ratio) : 0
})

on('GET', '/neighbor/activities/{activityId}/enrolls/stats', (ctx) => {
  requirePerm(ctx.user, NV_PERM.actView, `缺少权限位 ${NV_PERM.actView}：无权查看报名名单`)
  const a = nvActOf(ctx.params.activityId)
  if (!a) throw new ApiError(404, 40440, '活动不存在')
  nvAssertActScope(ctx.user, a)
  const list = neighborEnrolls.filter(e => e.activityId === a.activityId)
  const active = list.filter(e => !['已取消', '已退款'].includes(e.status))
  const fee = Number(a.fee) || 0
  return {
    total: list.length,
    /* 含同行人、不含已取消 / 已退款 —— 与名单列表同源 */
    people: active.reduce((n, e) => n + (Number(e.people) || 1), 0),
    checkedIn: list.filter(e => e.status === '已签到').length,
    cancelled: list.filter(e => e.status === '已取消').length,
    refunded: list.filter(e => e.status === '已退款').length,
    paidAmount: r2(active.reduce((n, e) => n + fee * (Number(e.people) || 1), 0)),
    refundAmount: r2(list.reduce((n, e) => n + (Number(e.refundAmount) || 0), 0)),
    capacity: a.capacity,
    minCapacity: Number(a.minCapacity) || 0,
    gap: Math.max(0, (Number(a.minCapacity) || 0) - nvEnrolledOf(a.activityId)),
    phase: nvPhaseOf(a)
  }
})

/* ================= 业主端会话（mp 组） =================
 * 这一套与员工的 `bearerAuth` 是**两条通道**：token 只带"我是谁、我名下有哪些房"，
 * 不带角色、不带数据范围 —— 业主的可见范围就是自己名下的房，没有"范围"可配。
 *
 * 演示环境用手机号直登替代 code2Session。契约里 `mock=true` 在真实环境必须 422，
 * 这条分支不能活到线上。
 *
 * 身份三选一（与 `03` / `06` 的 identity-rule 同一套口径）：
 *   业主 owners（houseIds 由 houses.ownerId 反查）
 *   家属 members（挂在 ownerId 上，房取该业主名下的）
 *   租客 tenants（直接挂 houseId）
 */
const mpTokens = new Map()
const MP_TTL = 2 * 3600
const members = readJson('fixtures/members.json')
/* 人脸申请单（批次 83）：唯一真相；members.faceStatus 是它的投影 */
const faces = readJson('fixtures/access-faces.json')
/* 水电：表具 + 项目模式（2026-11-13）· 商业平台镜像（2026-11-11）
   预存账户的 fixtures 还留着（后台"预存清退"要看历史），端上已经没有接口读它 */
const meters = readJson('fixtures/meters.json')
const communityUtility = readJson('fixtures/community-utility.json')
const commerceAccounts = readJson('fixtures/commerce-account.json')

const MP_ROLE = { OWNER: '业主', MEMBER: '家属', TENANT: '租客' }

/** token 记录 → 会话对象（每次请求现取，实名与绑定状态都是最新的） */
const mpAuth = (req) => {
  const h = req.headers.authorization || ''
  const m = h.match(/^Bearer\s+(.+)$/)
  if (!m) throw unauthorized()
  const hit = mpTokens.get(m[1])
  if (!hit || hit.exp < Date.now()) throw unauthorized()
  return hit
}
const mpOf = (ctx) => {
  if (!ctx.mp) throw unauthorized()
  return ctx.mp
}

/* ---------------- 房屋视图（业主端） ---------------- */
/**
 * 与后台 `WorkOrder` 那种"全字段"视图不同：业主端只看自己房的基础信息与管家，
 * 不返回 houseId 之外的产权、证件类字段。
 */
function mpHouseRow(h, boundIds = []) {
  const c = LS_COMMUNITY.get(h.communityId) || {}
  const e = h.stewardEmpId ? (EMP.get(h.stewardEmpId) || {}) : {}
  return {
    houseId: h.houseId,
    fullName: h.fullName,
    communityId: h.communityId || '',
    communityName: c.name || '',
    houseType: h.houseType || '',
    area: h.area || 0,
    deliverStatus: h.deliverStatus || '',
    useStatus: h.useStatus || '',
    bound: boundIds.includes(h.houseId),
    steward: e.empId
      ? { empId: e.empId, name: e.name, position: e.position, phone: maskPhone(e.phone) }
      : null
  }
}

/* ---------------- 三项比对（业主 / 家属 / 租客） ---------------- */
/**
 * 与 `06/src/api/identity-rule.mjs` 完全同一套判定，只是搬到了服务端 ——
 * **这是本批最重要的动因**：实名比对留在前端，等于把整份业主档案发给每个客户端。
 *
 * 三类人**都有 ownerId**（家属挂在业主上、租客也记着业主），所以不能靠 ownerId 区分身份，
 * 必须看各自的专属字段：业主 = houseIds、家属 = memberId、租客 = tenantId + houseId。
 */
function mpMatch(sess, houseId = '') {
  const mismatch = { phone: false, name: false, cert: false, house: false }
  const fail = (reason, extra = {}) => ({
    ok: false, identity: '', ownerId: sess.ownerId, houseIds: [], reason, mismatch, ...extra
  })

  if (!sess.realname) throw invalid('请先完成实名（姓名 + 证件后四位）')
  const p = String(sess.phone || '').replace(/\D/g, '')
  const n = String(sess.realname.name || '').trim()
  const c = String(sess.realname.idCard4 || '').replace(/\D/g, '')

  const ownersHouses = id => houses.filter(h => h.ownerId === id)
  const ownerHit = owners.find(o => String(o.phone) === p)
  const memberHit = members.find(x => String(x.phone) === p)
  const tenantHit = tenants.find(x => String(x.phone) === p)

  if (!ownerHit && !memberHit && !tenantHit) {
    mismatch.phone = true
    return fail('该手机号在物业档案里没有登记记录')
  }
  const pool = [ownerHit, memberHit, tenantHit].filter(Boolean)
  if (!pool.some(x => x.name === n)) {
    mismatch.name = true
    return fail(`手机号登记的姓名不是「${n}」`)
  }
  const certPool = pool.filter(x => x.name === n && String(x.idCard || '').slice(-4) === c)
  if (!certPool.length) {
    mismatch.cert = true
    return fail('证件号后四位与档案不一致')
  }

  /* 业主：名下房。owners 记录没有 memberId / tenantId 字段，靠这两个反着认 */
  const o = certPool.find(x => !x.memberId && !x.tenantId)
  if (o && ownersHouses(o.ownerId).length) {
    const list = ownersHouses(o.ownerId)
    const ids = houseId ? list.filter(h => h.houseId === houseId).map(h => h.houseId) : list.map(h => h.houseId)
    if (!ids.length) {
      mismatch.house = true
      return fail('档案姓名与手机号一致，但所选房屋不在其名下', { ownerId: o.ownerId })
    }
    return { ok: true, identity: MP_ROLE.OWNER, ownerId: o.ownerId, houseIds: ids, reason: '', mismatch }
  }

  /* 家属：房取该业主名下的 */
  const mb = certPool.find(x => !!x.memberId)
  if (mb) {
    const owner = owners.find(x => x.ownerId === mb.ownerId)
    const list = owner ? ownersHouses(owner.ownerId) : []
    const ids = houseId ? list.filter(h => h.houseId === houseId).map(h => h.houseId) : list.map(h => h.houseId)
    if (!ids.length) {
      mismatch.house = true
      return fail('该住户未被登记在所选的房屋下', { ownerId: mb.ownerId })
    }
    return { ok: true, identity: MP_ROLE.MEMBER, ownerId: mb.ownerId, houseIds: ids, reason: '', mismatch }
  }

  /* 租客：直接挂房；信息不全也能进，但要标出来（门禁类功能降级） */
  const t = certPool.find(x => !!x.tenantId)
  if (t) {
    const ids = houseId ? (t.houseId === houseId ? [t.houseId] : []) : [t.houseId]
    if (!ids.length) {
      mismatch.house = true
      return fail('租约登记的房屋与所选房屋不一致', { ownerId: t.ownerId })
    }
    return {
      ok: true,
      identity: MP_ROLE.TENANT,
      ownerId: t.ownerId,
      houseIds: ids,
      reason: '',
      mismatch,
      verifyStatus: t.verifyStatus || '待核验'
    }
  }

  mismatch.house = true
  return fail('未能确定身份与房屋的对应关系')
}

/** 首页三个数：口径见契约 GET /mp/me 的说明 */
function mpCounts(sess) {
  /* 取数与欠费判定都走 mpBillList / mpIsDebt —— 首页角标与账单页必须是同一套算法，
     各自 filter 一次的结果是"角标显示欠 3 张，进去只有 2 张"。 */
  const myBills = mpBillList(sess)
  const debt = myBills.filter(mpIsDebt)
  const myOrders = workOrders.filter(w => w.ownerId === sess.ownerId && !w.isPublic)
  const DOING = ['待派单', '已派单', '处理中', '待确认']
  const addons = myOrders.flatMap(w => (w.addons || [])).filter(a => !a.confirmed)
  return {
    debtAmount: r2(debt.reduce((s, b) => s + (Number(b.unpaid) || 0), 0)),
    debtBills: debt.length,
    maxOverdueDays: debt.reduce((m, b) => Math.max(m, Number(b.overdueDays) || 0), 0),
    doingOrders: myOrders.filter(w => DOING.includes(w.status)).length,
    pendingAddons: addons.length,
    /* 增项金额字段是 `total`（= material + labor），不是 `amount` ——
       批 A 写这段时样例里一条增项都没有，`Number(undefined) || 0` 恒等于 0，
       于是"待确认金额"一直是 0 也没人发现。批 C 补上数据才露出来。 */
    pendingAddonAmount: r2(addons.reduce((s, a) => s + (Number(a.total) || 0), 0)),
    toEvaluate: myOrders.filter(w => w.status === '已完工' && !w.score).length
  }
}

const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (date, n) => {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`)
  d.setDate(d.getDate() + n)
  return fmtDate(d)
}
const gapDays = (date) => Math.round(
  (new Date(`${String(date).slice(0, 10)}T00:00:00`) - new Date(`${NV_TODAY}T00:00:00`)) / 86400000
)

/* ================= 认证四步：登录 → 实名 → 候选 → 绑定 ================= */

on('POST', '/mp/auth/wechat-login', (ctx) => {
  const body = ctx.body || {}
  /* 真机上这里应该是 code2Session + getPhoneNumber 解密；演示环境直传手机号 */
  if (!body.mock) throw invalid('演示环境须带 mock=true；真实环境请走 wx.login + 手机号授权')
  const phone = String(body.phone || '').trim()
  if (!/^1\d{10}$/.test(phone)) throw invalid('手机号须为 11 位')

  /* 三张表一起找：业主端不止有业主，家属与租客同样要能登录（权限在绑定后按身份再收一道） */
  const ow = owners.find(x => String(x.phone) === phone)
  const mb = members.find(x => String(x.phone) === phone)
  const tn = tenants.find(x => String(x.phone) === phone)

  let sess = null
  if (ow) {
    sess = {
      ownerId: ow.ownerId, identity: MP_ROLE.OWNER, memberId: '', tenantId: '',
      name: ow.name, phone, verifyStatus: ''
    }
  } else if (mb) {
    sess = {
      ownerId: mb.ownerId, identity: MP_ROLE.MEMBER, memberId: mb.memberId, tenantId: '',
      name: mb.name, phone, verifyStatus: ''
    }
  } else if (tn) {
    sess = {
      ownerId: tn.ownerId, identity: MP_ROLE.TENANT, memberId: '', tenantId: tn.tenantId,
      name: tn.name, phone, verifyStatus: tn.verifyStatus || '待核验'
    }
  }
  if (!sess) throw new ApiError(404, 40490, '未找到该手机号对应的档案，请联系物业服务中心')

  const token = 'mp.' + Buffer.from(`${sess.ownerId}:${Date.now()}`).toString('base64url')
  const rec = { ...sess, realname: null, boundHouseIds: [], exp: Date.now() + MP_TTL * 1000 }
  mpTokens.set(token, rec)

  /* 登录只发会话，**不带姓名与证件** —— 实名是下一步的事，登录时回显等于把档案先吐一遍 */
  return {
    phoneMasked: maskPhone(phone),
    realnameStatus: '未实名',
    boundCount: 0,
    token
  }
})

on('POST', '/mp/auth/realname', (ctx) => {
  const me = mpOf(ctx)
  const body = ctx.body || {}
  const name = String(body.name || '').trim()
  const idCard4 = String(body.idCard4 || '').trim()
  if (name.length < 2 || name.length > 12) throw invalid('姓名长度应是 2~12 个字')
  if (!/^\d{4}$/.test(idCard4)) throw invalid('证件号后四位须是 4 位数字')
  /* 这一步只判格式，不判"这房是不是你的" —— 房的事在 candidates 里判 */
  me.realname = { name, idCard4 }
  return {
    phoneMasked: maskPhone(me.phone),
    realnameStatus: '已实名',
    name,
    idCard4,
    boundCount: me.boundHouseIds.length
  }
})

on('GET', '/mp/auth/bindings/candidates', (ctx) => {
  const me = mpOf(ctx)
  const houseId = String(ctx.query.houseId || '')
  const r = mpMatch(me, houseId)
  const bound = me.boundHouseIds || []
  const list = r.houseIds.map(id => HOUSE.get(id)).filter(Boolean).map(h => mpHouseRow(h, bound))
  /* 管家：有命中房按房取；没命中就用这个人名下一套房的管家（"我买了房但绑不上"要知道找谁） */
  let steward = list[0]?.steward || null
  if (!steward) {
    const anyHouse = houses.find(h => h.ownerId === r.ownerId)
    if (anyHouse) steward = mpHouseRow(anyHouse, bound).steward
  }
  /* `identity` 取**档案**算出来的，不取用户自选的那个 —— 家属选了"业主"也按家属生效 */
  const base = {
    identity: r.identity,
    ownerId: r.ownerId,
    verifyStatus: r.verifyStatus || '',
    mismatch: r.mismatch,
    steward
  }
  if (!r.ok) {
    return { ...base, level: 'none', reason: r.reason, houses: [] }
  }
  return { ...base, level: list.length > 1 ? 'many' : 'one', reason: '', houses: list }
})

on('POST', '/mp/auth/bindings', (ctx) => {
  const me = mpOf(ctx)
  const body = ctx.body || {}
  const houseIds = Array.isArray(body.houseIds) ? [...new Set(body.houseIds.map(String))] : []
  if (!houseIds.length) throw invalid('至少要选一套房')
  /* **重新算一遍**，不信客户端传上来的清单：能绑的只有 candidates 算出来的那些 */
  const r = mpMatch(me)
  if (!r.ok) throw forbidden(`档案与所选房屋不一致（${r.reason}）`)
  const allowed = new Set(r.houseIds)
  const bad = houseIds.filter(id => !allowed.has(id))
  if (bad.length) {
    throw new ApiError(403, 40391, `这些房不在您名下，不能绑定：${bad.join('、')}（不能"绑上了再看"）`)
  }
  me.boundHouseIds = [...new Set([...(me.boundHouseIds || []), ...houseIds])]
  me.identity = r.identity
  me.ownerId = r.ownerId
  return {
    boundHouseIds: me.boundHouseIds,
    houses: me.boundHouseIds.map(id => HOUSE.get(id)).filter(Boolean).map(h => mpHouseRow(h, me.boundHouseIds))
  }
})

on('GET', '/mp/me', (ctx) => {
  const me = mpOf(ctx)
  const owner = OWNER.get(me.ownerId) || {}
  return {
    owner: {
      ownerId: me.ownerId,
      name: me.name,
      /* 家属/租客的"owner"是自己：姓名取本人的，证件后四位取实名时填的 */
      phoneMasked: maskPhone(me.phone),
      idCard4: me.realname ? me.realname.idCard4 : '',
      certified: !!me.realname
    },
    identity: me.identity,
    realnameStatus: me.realname ? '已实名' : '未实名',
    verifyStatus: me.verifyStatus || '',
    houses: (me.boundHouseIds || []).map(id => HOUSE.get(id)).filter(Boolean).map(h => mpHouseRow(h, me.boundHouseIds)),
    counts: mpCounts(me),
    /* 名下有房但还没绑的，首页要给"还有 N 套可绑定"的入口。
       **没实名时是 0，而且不能去算** —— mpMatch 在未实名时会抛 422，
       登录后第一屏就打 /mp/me 的客户端会被这个 422 直接噎住（批 B 踩到）。 */
    unboundCount: me.realname
      ? Math.max(0, (mpMatch(me).houseIds || []).length - (me.boundHouseIds || []).length)
      : 0
  }
})

const repairPrices = readJson('fixtures/repair-prices.json')

/* ================= 批 B：房屋 / 住户 / 账单 / 价目 =================
 * 这一组只读（租客登记一条写），口径全部按"业主自己看自己的房"：
 *   - 房屋详情：只给基础信息与管家，不给产权、不给证件；
 *   - 在住人：**业主可见租金**（他是出租方），身份证只回后四位、手机掩码；
 *   - 账单：已绑房 + 本人名下不挂房的车位费（少这一条就漏钱）。
 */

/** 已绑房集合。绑过才算"我的"，候选列表里的房不算 —— 能看不等于能查账。 */
const mpBound = (sess) => new Set(sess.boundHouseIds || [])

/**
 * 取一套"我的房"。两种失败必须分开：
 *   404 房不存在（在任何人名下都不存在，等于没有）；
 *   403 房存在但没绑给我 —— **不能回 404**：业主刚在候选列表里见过这套房，
 *       回 404 会让人以为"刚选的房消失了"，然后反复重试。
 */
function mpMyHouse(sess, houseId) {
  const h = HOUSE.get(String(houseId || ''))
  if (!h) throw notFound('房屋不存在')
  if (!mpBound(sess).has(h.houseId)) {
    throw forbidden(`${h.fullName} 不在您已绑定的房产里，请先完成房屋绑定`)
  }
  return h
}

/**
 * 欠费口径（与 PC、06 本地实现一致）：**状态在欠费三态 且 未收 > 0**。
 * 只判 `unpaid > 0` 会把「已减免」的账单算成欠费 —— 减免就是不用交，
 * 金额字段没清零是数据质量问题，不能让它变成一条催缴短信。
 */
const MP_DEBT_STATUS = ['未缴', '部分缴', '逾期']
const mpIsDebt = b => MP_DEBT_STATUS.includes(b.status) && (Number(b.unpaid) || 0) > 0

/**
 * 家庭账单取数：已绑房产的账单 + **本人名下不挂房的车位费**。
 *
 * 车位是独立资产，账单不带 houseId。只按 houseId 过滤，业主会少看一笔钱
 * （演示数据里李秀兰少 ¥362.52），然后打电话说"我明明交了"。
 */
function mpBillList(sess, q = {}) {
  const ids = mpBound(sess)
  return bills
    /* 作废单不进业主账单（2026-11-14）：项目从抄表切插卡 / 国网直收后，遗留的水电应收
       在后台作废了。作废 = 这笔钱不用交，但把 565 张「已作废」摆进业主列表，
       业主只会问"这单是什么、要不要交"。状态是内部口径，不下发给业主。
       05 / PC 后台的账单列表不过滤 —— 那边要能看到、能追溯。 */
    .filter(b => b.status !== '已作废')
    .filter(b => (b.houseId ? ids.has(b.houseId) : b.ownerId === sess.ownerId))
    .filter(b => !q.houseId || b.houseId === String(q.houseId))
    /* houseId 与 parkId 互斥：车位账单不挂房，两个一起传按房源账单处理 */
    .filter(b => !q.parkId || b.parkId === String(q.parkId))
    .filter(b => !q.period || b.period === String(q.period))
    .filter(b => !q.status || b.status === String(q.status))
    .filter(b => String(q.onlyDebt) !== 'true' || mpIsDebt(b))
    .sort((a, b) => {
      /* 欠费在前（业主进来是来交钱的），同状态按账期倒序 */
      const d = (mpIsDebt(b) ? 1 : 0) - (mpIsDebt(a) ? 1 : 0)
      if (d) return d
      if (a.period !== b.period) return String(b.period).localeCompare(String(a.period))
      return String(a.billId).localeCompare(String(b.billId))
    })
}

/**
 * 在住人。业主视角与楼管**相反**：楼管不能看租金（代收方知道了邻居收入），
 * 业主是出租方，必须能看自己房的租约金额与租期。
 *
 * 手机掩码、身份证只回后四位 —— 业主知道自己租客是谁，但不需要一屏完整的证件号。
 */
function mpResidentsOf(h) {
  const owner = OWNER.get(h.ownerId) || {}
  /* 家庭成员：fixtures 里只有 certified / liveTogether，人脸与 App 注册没有真值。
     这两个字段**宁可不给**，也不要填 false —— 前端会把 false 渲染成"未录入人脸"，
     而事实是"这套样例没这份数据"，两者在验收时是两件事。 */
  const ms = members
    .filter(m => m.ownerId === h.ownerId)
    .map(m => ({
      memberId: m.memberId,
      name: m.name,
      relation: m.relation || '其他',
      phone: maskPhone(m.phone),
      certified: !!m.certified
    }))
  const ts = tenants
    .filter(t => t.houseId === h.houseId && t.status !== '已搬离')
    .map(t => ({
      tenantId: t.tenantId,
      name: t.name,
      phone: maskPhone(t.phone),
      /* 业主自助登记的租客只填了后四位，档案里没有完整号 —— 按字段走，不要假造 */
      idCard4: t.idCard ? String(t.idCard).slice(-4) : (t.idCard4 || ''),
      leaseStart: t.leaseStart,
      leaseEnd: t.leaseEnd,
      /* 租金：业主可见。契约 MP_RESIDENTS 写明，楼管侧是另一套（不可见） */
      rent: Number(t.rent) || 0,
      residents: Number(t.residents) || 0,
      verifyStatus: t.verifyStatus || '待核验',
      source: t.source || '物业登记',
      status: t.status || '在住'
    }))
  return {
    owner: owner.name
      ? { name: owner.name, phone: maskPhone(owner.phone), relation: '业主' }
      : null,
    members: ms,
    tenants: ts
  }
}

/* ---------------- 选房三级（小区 / 楼栋 / 房间） ---------------- */
/**
 * 认证流程的第 1–3 步。三条都是只读，但仍然要求登录：房产档案不该被匿名枚举 ——
 * 756 间房的门牌加起来，等于把整个小区的户型图挂在公网上。
 *
 * **不要求 L2**：选房时人还没实名（实名在下一步），这里要的只是"你是本系统的一个用户"。
 *
 * 户数、单元数一律按房号表实算，不取 project/building 表里那个手写数字：
 * 那是"合同上写着多少户"，选房页要的是"系统里到底建了多少间"。
 */
const countBy = (list, key, id) => list.reduce((n, x) => n + (x[key] === id ? 1 : 0), 0)

on('GET', '/mp/communities', (ctx) => {
  mpOf(ctx)
  const rows = communities
    /* 已退管的小区点进去也绑不了房，列出来只是让人白点一次 */
    .filter(c => c.status === '在管')
    .map(c => ({
      communityId: c.communityId,
      name: c.name,
      bizType: c.bizType,
      address: c.address || '',
      houseCount: countBy(houses, 'communityId', c.communityId)
    }))
  return { rows }
})

on('GET', '/mp/communities/{communityId}/buildings', (ctx) => {
  mpOf(ctx)
  const c = communities.find(x => x.communityId === ctx.params.communityId)
  if (!c) throw notFound('没有这个小区')
  const rows = buildings
    .filter(b => b.communityId === c.communityId)
    .map(b => ({
      buildingId: b.buildingId,
      name: b.name,
      buildingNo: b.buildingNo || '',
      usage: b.usage || '住宅',
      unitCount: countBy(units, 'buildingId', b.buildingId),
      floorCount: b.floorCount,
      houseCount: countBy(houses, 'buildingId', b.buildingId),
      hasElevator: !!b.hasElevator
    }))
    /* 按楼号排，不按 buildingId 字符串排 —— B0110 会排到 B0102 前面 */
    .sort((x, y) => Number(x.buildingNo) - Number(y.buildingNo) || x.name.localeCompare(y.name))
  return { communityId: c.communityId, rows }
})

on('GET', '/mp/buildings/{buildingId}/rooms', (ctx) => {
  mpOf(ctx)
  const b = buildings.find(x => x.buildingId === ctx.params.buildingId)
  if (!b) throw notFound('没有这栋楼')

  const inBuilding = houses.filter(h => h.buildingId === b.buildingId)
  const groups = units
    .filter(u => u.buildingId === b.buildingId)
    .sort((x, y) => Number(x.unitNo || 0) - Number(y.unitNo || 0))
    .map(u => ({
      unitId: u.unitId,
      unitName: u.name,
      rooms: inBuilding
        .filter(h => h.unitId === u.unitId)
        /* 楼层 → 房号：与业主站在楼下抬头看门牌的顺序一致 */
        .sort((x, y) => Number(x.floor) - Number(y.floor) || String(x.room).localeCompare(String(y.room)))
        /* 只回答"这是哪一间"。业主、家属、租客、门牌人一概不下发 */
        .map(h => ({
          houseId: h.houseId,
          room: h.room,
          floor: Number(h.floor) || 0,
          fullName: h.fullName,
          area: Number(h.area) || 0,
          houseType: h.houseType || ''
        }))
    }))
    .filter(g => g.rooms.length)

  return { buildingId: b.buildingId, buildingName: b.name, groups }
})

on('GET', '/mp/houses/{houseId}', (ctx) => {
  const me = mpOf(ctx)
  const h = mpMyHouse(me, ctx.params.houseId)
  return mpHouseRow(h, me.boundHouseIds)
})

on('GET', '/mp/houses/{houseId}/residents', (ctx) => {
  const me = mpOf(ctx)
  return mpResidentsOf(mpMyHouse(me, ctx.params.houseId))
})

on('POST', '/mp/houses/{houseId}/tenants', (ctx) => {
  const me = mpOf(ctx)
  const h = mpMyHouse(me, ctx.params.houseId)
  const b = ctx.body || {}
  const name = String(b.name || '').trim()
  const phone = String(b.phone || '').trim()

  if (name.length < 2) throw invalid('租客姓名至少 2 个字')
  if (!/^1\d{10}$/.test(phone)) throw invalid('租客手机号须为 11 位')
  if (!b.leaseStart || !b.leaseEnd) throw invalid('租期起止都要填')
  if (String(b.leaseEnd) <= String(b.leaseStart)) throw invalid('租期结束日必须晚于开始日')
  if (b.rent !== undefined && Number(b.rent) < 0) throw invalid('月租金不能为负')

  /* 同一个手机号在同一套房重复登记 = 点了两次提交，不是又要住进来一个人 */
  const dup = tenants.find(t => t.houseId === h.houseId && String(t.phone) === phone && t.status === '在住')
  if (dup) {
    throw new ApiError(409, 40992, `${name}（${maskPhone(phone)}）已在本房登记为在住租客，无需重复登记`)
  }

  const seq = tenants.filter(t => String(t.tenantId).startsWith('TN9')).length
  const row = {
    tenantId: `TN9${String(seq + 1).padStart(4, '0')}`,
    tenantType: '个人',
    name,
    phone,
    /* 只收了后四位就只存后四位，别拼成假证件号 —— 后面按后四位比对的逻辑会被它带歪 */
    idCard: '',
    idCard4: String(b.idCard4 || '').replace(/\D/g, '').slice(0, 4),
    houseId: h.houseId,
    ownerId: h.ownerId,
    leaseStart: String(b.leaseStart).slice(0, 10),
    leaseEnd: String(b.leaseEnd).slice(0, 10),
    rent: Number(b.rent) || 0,
    residents: Math.max(1, Number(b.residents) || 1),
    relation: '租客',
    /* 业主登记 ≠ 核验通过：门禁授权、人脸录入要物业核验后才生效，
       否则谁都能给自己开一张门禁卡 */
    source: '业主自助',
    verifyStatus: '待核验',
    certified: false,
    faceRegistered: false,
    status: '在住'
  }
  tenants.push(row)
  return { ...row, phone: maskPhone(row.phone), idCard4: row.idCard4 }
})

/* ============================ 本房水电（2026-11-13） ============================ */

/**
 * 能不能在端上缴费，由**项目模式**决定，不由"有没有账单"决定：
 *
 *   meter 抄表出账 → 可缴（用量 × 单价 = 应缴）
 *   card  插卡买量 → 到物业服务中心买，系统不记余额
 *   none  业主自缴 → 国网 / 水司直接收，物业一分钱都不碰
 *
 * P03 就有一张电费逾期单，而 P03 的电是 card —— 那张单**不能**给支付入口，
 * 否则等于物业替插卡表代收。所以 `canPay` 只看模式，不看账单在不在。
 *
 * 预存账户体系 2026-11-13 下线：钱和账期一一对应，不存在"余额"这个中间物。
 */
const MP_UTIL = [
  { meterType: '水表', itemId: 'FI05', itemName: '水费', key: 'water' },
  { meterType: '电表', itemId: 'FI06', itemName: '电费', key: 'elec' }
]
const MP_MODE_LABEL = {
  meter: '抄表出账',
  card: '插卡表 · 到物业服务中心买量',
  none: '由自来水公司 / 国家电网直接收取'
}
/**
 * 文案要按表种说：电说"国家电网"、水说"自来水公司"。
 * 一句"由自来水公司 / 国家电网直接收取"挂在电费卡上，业主会愣一下 ——
 * 原来就是这么写的，截图里一眼就看出来了。
 */
const mpModeLabelOf = (mode, meterType) => {
  if (mode === 'none') return meterType === '电表' ? '由国家电网直接收取' : '由自来水公司直接收取'
  return MP_MODE_LABEL[mode]
}
const mpUtilModeOf = (communityId, key) => {
  const u = communityUtility.find(x => x.communityId === communityId) || {}
  return u[key] || 'none'
}
/* 账单里的 `unit` 是「元/吨」，端上要的是计价单位「吨」 */
const mpUnitOf = u => String(u || '').replace(/^元\//, '')

function mpUtilityHouse(me, houseId) {
  if (houseId) return mpMyHouse(me, houseId) // 不是我的房 → 403
  const ids = [...mpBound(me)]
  if (!ids.length) throw forbidden('还没有绑定房产，先完成业主认证')
  return HOUSE.get(ids[0])
}

on('GET', '/mp/utility', (ctx) => {
  const me = mpOf(ctx)
  const h = mpUtilityHouse(me, ctx.query?.houseId)

  const rows = MP_UTIL.map(t => {
    const mode = mpUtilModeOf(h.communityId, t.key)
    const meter = meters.find(m => m.houseId === h.houseId && m.type === t.meterType) || null
    const debt = bills
      .filter(b => b.houseId === h.houseId && b.itemId === t.itemId && mpIsDebt(b))
      .sort((a, b) => String(a.period).localeCompare(String(b.period)))
    /* 只有抄表出账才把账单摆出来；其它两种模式下这些账单不是物业能收的钱 */
    const first = mode === 'meter' ? debt[0] || null : null
    const open = mode === 'meter' ? debt : []

    const row = {
      meterType: t.meterType,
      meterNo: meter ? meter.meterNo : '',
      itemId: t.itemId,
      itemName: (meter && meter.itemName) || t.itemName,
      mode,
      modeLabel: mpModeLabelOf(mode, t.meterType),
      unit: first ? mpUnitOf(first.unit) : (meter ? meter.unit : ''),
      unpaidCount: open.length,
      unpaidTotal: r2(open.reduce((s, b) => s + (b.unpaid || 0), 0)),
      canPay: mode === 'meter' && !!first
    }
    /**
     * 账单相关的字段**只在有账单时出现**，不是给个 null。
     * null 与"没有这个字段"在端上是两件事：null 说得清"这里空着"，
     * 而没装远传表、或插卡表根本不记账时，正确的表达是"系统里没有这个数"。
     * 契约里也没给这些字段标 nullable —— 校验器不认，会直接判 schema 失败。
     */
    if (first) {
      row.price = r2(first.price)
      row.usage = r2(first.quantity)
      row.amount = r2(first.unpaid)
      row.period = first.period
      row.billId = first.billId
      row.billStatus = first.status
      if (first.lastReading != null) row.prevReading = Number(first.lastReading)
      if (first.meterReading != null) row.currReading = Number(first.meterReading)
    }
    return row
  })

  const payable = rows.filter(r => r.canPay)
  return {
    houseId: h.houseId,
    houseName: h.fullName || '',
    communityId: h.communityId,
    dueTotal: r2(payable.reduce((s, r) => s + (r.amount || 0), 0)),
    payableCount: payable.length,
    accounts: rows
  }
})

/* ============================ 商业平台账户镜像（2026-11-11） ============================ */

/**
 * **只读镜像**，不回 `balance`：商业平台储值与物业预存是两笔钱。
 * 这一层不写任何东西 —— 领券与核销都在商业平台，物业这边替它记账就是越界。
 */
on('GET', '/mp/commerce/account', (ctx) => {
  const me = mpOf(ctx)
  const c = commerceAccounts.find(x => x.ownerId === me.ownerId)
  if (!c) throw notFound('该手机号还没有在商业平台注册')
  return {
    memberName: c.memberName || me.name,
    syncedAt: c.syncedAt,
    points: c.points,
    pointsExpiring: c.pointsExpiring || 0,
    pointsExpireAt: c.pointsExpireAt || '',
    level: c.level || '',
    levelNext: c.levelNext || '',
    levelProgress: c.levelProgress || { current: 0, next: 0 },
    coupons: (c.coupons || []).map(x => ({ ...x }))
  }
})

/* ============================ 车位（批次 82） ============================ */

/**
 * 每车位每自然月的自助换绑上限。
 *
 * 真实系统从参数表 `park.plateChangeLimit` 读（后台 `/e/config` 可改、可人工重置），
 * 假服务没有配置中心，用常量 —— 只在这里写一处，页面与用例都读它返回的值，
 * 不在前端复制一份"每月 1 次"。
 */
const MP_PLATE_LIMIT = 1

const PARK = new Map(parkings.map(p => [p.parkId, p]))

/** 车牌归一化：与业主端 `park-rule.mjs` 同一口径（去空格横线、转大写、补间隔点） */
const PLATE_RE = /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-Z0-9]{5,6}$/
const mpNormalizePlate = raw => String(raw || '')
  .toUpperCase()
  .replace(/[\s-]/g, '')
  .replace(/^([京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z])(?![·])/, '$1·')
const mpPlateValid = raw => PLATE_RE.test(mpNormalizePlate(raw).replace(/·/g, ''))

const mpPeriod = () => DATA_DATE.slice(0, 7)
const mpHourMinute = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
/** 额度重置日：演示数据"当下"的下月 1 日 */
function mpQuotaResetAt() {
  const [y, m] = DATA_DATE.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
}

/**
 * 本月该车位已换绑次数：**以最后一次「物业重置」为界**，重置之前的记录不计入。
 *
 * 业主把车牌填错，客服重置一次，不该同时占掉他下个月的名额 ——
 * 所以重置不是把计数清零，而是插一条分界线（记录本身要留着，那是留痕的意义）。
 */
function mpParkUsedThisMonth(parkId) {
  const month = mpPeriod()
  const mine = parkingChangeLogs
    .filter(r => r.parkId === parkId && String(r.at || '').slice(0, 7) === month)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
  const lastReset = [...mine].reverse().find(r => r.source === '物业重置')
  const from = lastReset ? mine.indexOf(lastReset) + 1 : 0
  return mine.slice(from).filter(r => r.source !== '物业重置').length
}

/**
 * 取一个"我的车位"。两种失败分开：
 *   404 车位不存在（在谁名下都不存在）；
 *   403 车位存在但不在我名下 —— **不能回 404**，业主刚在自己列表里见过这个号。
 */
function mpMyParking(sess, parkId) {
  const p = PARK.get(String(parkId || ''))
  if (!p) throw notFound('车位不存在')
  if (p.ownerId !== sess.ownerId) throw forbidden('这个车位不在您名下')
  return p
}

function mpParkingRow(p) {
  return {
    parkId: p.parkId,
    parkNo: p.parkNo,
    zone: p.zone,
    parkType: p.parkType,
    category: p.category,
    area: p.area,
    status: p.status,
    plateNo: p.plateNo,
    bindStatus: p.bindStatus,
    feeStandard: p.feeStandard,
    /* 到期日 = 管理费已缴至的账期末，唯一真相；不在这里按"今天"改成状态词 */
    expireDate: p.expireDate,
    chargePile: !!p.chargePile,
    vehicleCount: vehicles.filter(v => v.parkId === p.parkId).length,
    usedThisMonth: mpParkUsedThisMonth(p.parkId)
  }
}

/** 车辆视图：**完整 IC 卡号不下发**，只给后四位（完整卡号可以复制去开闸） */
const mpVehicleRow = v => ({
  vehicleId: v.vehicleId,
  plateNo: v.plateNo,
  vehicleType: v.vehicleType,
  brand: v.brand,
  color: v.color,
  cardNoTail: v.cardNoTail,
  authStatus: v.authStatus,
  inOutType: v.inOutType
})

on('GET', '/mp/parkings', (ctx) => {
  const me = mpOf(ctx)
  const rows = parkings
    .filter(p => p.ownerId === me.ownerId)
    .sort((a, b) => String(a.parkNo).localeCompare(String(b.parkNo)))
    .map(mpParkingRow)
  return { rows, limit: MP_PLATE_LIMIT, period: mpPeriod(), resetAt: mpQuotaResetAt() }
})

on('GET', '/mp/parkings/{parkId}', (ctx) => {
  const me = mpOf(ctx)
  const p = mpMyParking(me, ctx.params.parkId)
  return {
    parking: mpParkingRow(p),
    vehicles: vehicles.filter(v => v.parkId === p.parkId).map(mpVehicleRow)
  }
})

on('POST', '/mp/parkings/{parkId}/plate', (ctx) => {
  const me = mpOf(ctx)
  const p = mpMyParking(me, ctx.params.parkId)

  /* 四条前置：车位在本人名下（上面已判）、业主本人、已实名、管理费未到期、额度还有。
     顺序有意把「身份」放最前 —— 家属点进来先看到"只对产权业主开放"，
     而不是"次数用完了"，后者会让他以为换个账号就行。 */
  if (me.identity !== MP_ROLE.OWNER) {
    throw forbidden('换绑只对产权业主开放；家属或租客请联系业主或管家')
  }
  if (!me.realname) throw forbidden('请先完成实名认证再换绑车牌')
  if (String(p.expireDate) < DATA_DATE) {
    throw new ApiError(409, 40930, `车位管理费已于 ${p.expireDate} 到期，续费后才能换绑`)
  }

  const plateNo = mpNormalizePlate(ctx.body?.plateNo)
  if (!mpPlateValid(plateNo)) throw invalid('车牌格式不对，例如 川B·SFV7D')
  if (plateNo === p.plateNo) throw invalid('与原车牌相同，无需换绑')

  /* 同一个牌不能同时挂在本人两个车位上 —— 道闸侧认牌不认车位，会重复计费 */
  const clash = parkings.find(x => x.ownerId === me.ownerId && x.parkId !== p.parkId && x.plateNo === plateNo)
  if (clash) throw new ApiError(409, 40931, `该车牌已绑在您的车位 ${clash.parkNo} 上，请先解绑那一个`)

  if (mpParkUsedThisMonth(p.parkId) >= MP_PLATE_LIMIT) {
    throw new ApiError(409, 40929, `本月该车位已换绑 ${MP_PLATE_LIMIT} 次，下月 1 日恢复；如填错请联系管家重置`)
  }

  const log = {
    logId: 'PL' + String(parkingChangeLogs.length + 1).padStart(5, '0'),
    parkId: p.parkId,
    parkNo: p.parkNo,
    fromPlate: p.plateNo,
    toPlate: plateNo,
    source: '业主自助',
    operatorName: me.name,
    /* 车牌识别系统（第三方）尚未对接：一律「待同步」，**不假装有回执** */
    vendorStatus: '待同步',
    at: `${DATA_DATE} ${mpHourMinute()}`,
    reason: String(ctx.body?.reason || '').slice(0, 100)
  }
  parkingChangeLogs.push(log)

  /* 车位本体与车辆表一起改 —— 只改一处，详情页会出现"车位是新牌、车辆是老牌" */
  const v = vehicles.find(x => x.parkId === p.parkId)
  if (v) v.plateNo = plateNo
  p.plateNo = plateNo
  p.bindStatus = '已绑定'

  return {
    log,
    parking: mpParkingRow(p),
    limit: MP_PLATE_LIMIT,
    period: mpPeriod(),
    resetAt: mpQuotaResetAt()
  }
})

/* ============================ 车位续费：按车位出账（批次 88） ============================ */

/**
 * 续费的本质是「**按车位出账 → 支付 → 账期顺延**」，不是"点一下把日期改掉"。
 *
 * PC 收银台的 `renewParking` 是另一种形态：钱已经在柜台收了，所以只延长有效期、不出账单。
 * 业主自助没有那个"柜台"，必须先有一张待缴账单，钱才有地方收、账才有据可查。
 *
 * 起账期取「到期月的下一期」：`expireDate` 的语义是**管理费已缴至的账期末**，
 * 2027-03-31 到期就从 2027-04 开始出。这样出账与 expireDate 是同一个坐标系，
 * 不会出现"账单从 2026-11 起、到期日却写着 2027-03"这种对不上的情况。
 */
const PARK_ITEM = { itemId: 'FI07', itemName: '车位管理服务费', unit: '元/位·月' }
/* 编号接在**最大 id** 后面：fixture 的 BL 号不连续，接 length 会撞上已有编号 */
let BILL_SEQ = bills.reduce((m, b) => Math.max(m, Number(String(b.billId).replace(/\D/g, '')) || 0), 0)
const nextBillId = () => 'BL' + String(++BILL_SEQ).padStart(6, '0')

const periodOfDate = d => String(d || '').slice(0, 7)
const addMonths = (ym, n) => {
  const [y, m] = String(ym).split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`
}
/** 账期末：2026-02 → 2026-02-28（按真实月末，不写死 30） */
const periodEnd = ym => {
  const [y, m] = String(ym).split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0))
  return `${ym}-${String(d.getUTCDate()).padStart(2, '0')}`
}

on('POST', '/mp/parkings/{parkId}/renewals', (ctx) => {
  const me = mpOf(ctx)
  const p = mpMyParking(me, ctx.params.parkId)

  /* 只对产权业主开放：家属能看见车位、能缴已有账单，但"续一年"是处分行为，
     和换绑车牌同一条线。 */
  if (me.identity !== MP_ROLE.OWNER) {
    throw forbidden('续费只对产权业主开放；家属或租客请联系业主或管家')
  }

  const months = ctx.body?.months == null ? 1 : Number(ctx.body.months)
  if (!Number.isInteger(months) || months < 1 || months > 12) {
    throw invalid('续费月数只能是 1~12 的整数')
  }

  const from = addMonths(periodOfDate(p.expireDate), 1)
  const periods = Array.from({ length: months }, (_, i) => addMonths(from, i))

  /* 幂等/防重复：这几期里只要有一期已经出过账（未作废），就整批拒绝。
     逐期跳过的做法会让"续 3 个月"变成"续了 2 个月"，页面上看不出少了哪期。 */
  const exists = bills.find(b => b.parkId === p.parkId && periods.includes(b.period) && b.status !== '已作废')
  if (exists) {
    throw new ApiError(409, 40936, `${exists.period} 的车位管理费已经出过账了，请到家庭账单里缴纳`)
  }

  const fee = r2(p.feeStandard)
  const created = periods.map(period => {
    const b = {
      billId: nextBillId(),
      communityId: p.communityId,
      houseId: '',
      ownerId: me.ownerId,
      period,
      status: '未缴',
      itemId: PARK_ITEM.itemId,
      itemName: PARK_ITEM.itemName,
      unit: PARK_ITEM.unit,
      amount: fee,
      quantity: 1,
      price: fee,
      discount: 0,
      lateFee: 0,
      payable: fee,
      paidAmount: 0,
      unpaid: fee,
      overdueDays: 0,
      /* 车位账单没有房屋宽限期那套，统一次月 15 日到期，与种子里既有车位单一致 */
      dueDate: `${addMonths(period, 1)}-15`,
      createTime: MP_NOW.slice(0, 10),
      payTime: '',
      payMethod: '',
      invoiceNo: '',
      parkId: p.parkId
    }
    bills.push(b)
    return b
  })

  return {
    months,
    fromPeriod: from,
    toPeriod: periods[periods.length - 1],
    amount: r2(fee * months),
    expireDate: p.expireDate,
    bills: created.map(billRow)
  }
})

on('GET', '/mp/parkings/{parkId}/logs', (ctx) => {
  const me = mpOf(ctx)
  const p = mpMyParking(me, ctx.params.parkId)
  const rows = parkingChangeLogs
    .filter(r => r.parkId === p.parkId)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.logId).localeCompare(String(a.logId)))
    .map(r => ({
      logId: r.logId,
      parkId: r.parkId,
      parkNo: r.parkNo,
      fromPlate: r.fromPlate,
      toPlate: r.toPlate,
      source: r.source,
      operatorName: r.operatorName,
      vendorStatus: r.vendorStatus,
      at: r.at,
      reason: r.reason
    }))
  return { rows }
})

/* ============================ 人脸 / 刷脸通行（批次 83） ============================ */

/**
 * 人脸申请单是**唯一真相**，`members.faceStatus` 是它的投影。
 *
 * 五态里「未采集」不落记录 —— 没有申请单就是没采集。为"字段齐全"造一条空记录，
 * 后面每个查询都要额外判断"这条记录算不算数"，迟早有人判错。
 *
 * 「已生效」只能由物业核验触发（后台 H4 的面核工作台），
 * 这里**没有任何"直接置为生效"的入口** —— 包括 `autoApprove` 这类看起来人畜无害的参数。
 */
const FACE_LIMIT_24H = 3
let faceSeq = faces.length
/** 提交流水（内存，不进 fixtures）：只用来算 24 小时限次 */
const faceSubmits = []

const faceKeyOf = (ownerId, memberId) => (memberId ? `m:${memberId}` : `o:${ownerId}`)

/** 某主体"当前那一条"：取该主体最后一条申请（数组顺序即创建顺序） */
function faceLatestOf(ownerId, memberId) {
  const key = String(memberId || '')
  const rows = faces.filter(f => f.ownerId === ownerId && String(f.memberId || '') === key)
  return rows.length ? rows[rows.length - 1] : null
}

/**
 * 能不能提交。返回的 `status` 是**派生**的：有申请单就取它的状态，没有就是「未采集」。
 * 注意「已驳回」与「已冻结」都允许重新提交 —— 驳回是让你改，冻结是让你想清楚了再来。
 */
function faceGate(ownerId, memberId, { readOnly = false } = {}) {
  const cur = faceLatestOf(ownerId, memberId)
  const status = cur ? cur.status : '未采集'
  const key = faceKeyOf(ownerId, memberId)
  const recent = faceSubmits.filter(x => x.key === key && Date.now() - x.ts < 86400000).length
  const remain = Math.max(0, FACE_LIMIT_24H - recent)
  if (readOnly) return { status, canSubmit: false, why: '租客的人脸由物业维护', remain: 0 }
  if (status === '待核验') {
    return { status, canSubmit: false, why: '物业正在核验，通过或驳回后才能重新提交', remain }
  }
  if (remain <= 0) {
    return { status, canSubmit: false, why: `24 小时内最多提交 ${FACE_LIMIT_24H} 次，请明天再试`, remain }
  }
  return { status, canSubmit: true, why: '', remain }
}

/** 主体通用视图（本人与成员共用的那部分） */
function faceBaseView(f, ownerId, memberId) {
  const g = faceGate(ownerId, memberId)
  return {
    faceId: f ? f.faceId : '',
    status: g.status,
    submittedAt: f ? f.submittedAt : '',
    updatedAt: f ? (f.auditAt || f.submittedAt) : '',
    /* 驳回原因与冻结原因都要让业主看见 —— 那是他下一步动作的唯一依据 */
    note: f ? (f.status === '已驳回' ? f.rejectReason : (f.note || f.frozenReason || '')) : '',
    canSubmit: g.canSubmit,
    why: g.why,
    remain24h: g.remain,
    guardian: f ? (f.guardian || '') : ''
  }
}

const firstHouseOf = ownerId => (houses.find(h => h.ownerId === ownerId) || {}).houseId || ''

function mpFaceSelf(me) {
  /* 租客只读：人脸在租约核验时由物业录（`POST /tenants/{id}/face`），业主端不给入口 */
  if (me.identity === MP_ROLE.TENANT) {
    const t = tenants.find(x => x.tenantId === me.tenantId)
    return {
      faceId: '',
      name: me.name,
      role: '租客',
      status: t && t.faceRegistered ? '已生效' : '未采集',
      submittedAt: '', updatedAt: '', note: '',
      canSubmit: false,
      why: '租客的人脸由物业在核验租约时录入',
      readOnly: true,
      readOnlyWhy: '租客的人脸由物业在核验租约时录入，业主端只读',
      remain24h: 0,
      guardian: ''
    }
  }
  const memberId = me.identity === MP_ROLE.MEMBER ? me.memberId : ''
  const f = faceLatestOf(me.ownerId, memberId)
  return {
    ...faceBaseView(f, me.ownerId, memberId),
    name: me.name,
    role: me.identity,
    readOnly: false,
    readOnlyWhy: ''
  }
}

function mpFaceMemberRow(me, m) {
  const f = faceLatestOf(me.ownerId, m.memberId)
  const base = faceBaseView(f, me.ownerId, m.memberId)
  return {
    ...base,
    memberId: m.memberId,
    name: m.name,
    relation: m.relation || '其他',
    certified: !!m.certified,
    /* 未核验的成员不能代录：没核验就录脸，等于填个名字就能给别人开门 */
    canEnroll: !!m.certified && base.canSubmit,
    why: m.certified ? base.why : '成员资料待物业核验，核验后才能帮他录人脸'
  }
}

/** 写一条新的待核验申请。旧的那条不动 —— 驳回与撤回的历史要留着 */
function mpFacePush(me, { memberId = '', guardian = false } = {}) {
  const g = faceGate(me.ownerId, memberId)
  if (!g.canSubmit) {
    if (g.status === '待核验') throw new ApiError(409, 40932, '物业正在核验，通过或驳回后才能重新提交')
    throw new ApiError(409, 40933, `24 小时内最多提交 ${FACE_LIMIT_24H} 次，请明天再试`)
  }
  const prev = faceLatestOf(me.ownerId, memberId)
  const m = memberId ? members.find(x => x.memberId === memberId) : null
  faceSeq += 1
  const row = {
    faceId: 'FC' + String(faceSeq).padStart(5, '0'),
    subjectType: memberId ? '家属' : '业主',
    ownerId: me.ownerId,
    memberId,
    houseId: (prev && prev.houseId) || firstHouseOf(me.ownerId),
    name: memberId ? (m ? m.name : me.name) : me.name,
    relation: memberId ? (m ? (m.relation || '其他') : '家属') : '本人',
    status: '待核验',
    submittedAt: `${DATA_DATE} ${mpHourMinute()}`,
    auditAt: '', auditBy: '', rejectReason: '', frozenReason: '',
    guardian: guardian ? `${me.name}（监护人，代同意）` : '',
    /* 重新采集时旧人脸继续有效 —— 不写这句，业主会以为自己这会儿刷不了门 */
    note: prev && prev.status === '已生效' ? '新照片核验期间，原人脸继续有效' : '',
    images: 2
  }
  faces.push(row)
  faceSubmits.push({ key: faceKeyOf(me.ownerId, memberId), ts: Date.now() })
  return row
}

on('GET', '/mp/access/faces', (ctx) => {
  const me = mpOf(ctx)
  /* 家属只能看自己：成员列表对他恒为空 —— 家属之间是平级关系，谁也代表不了谁 */
  const list = me.identity === MP_ROLE.OWNER
    ? members.filter(m => m.ownerId === me.ownerId).map(m => mpFaceMemberRow(me, m))
    : []
  return { self: mpFaceSelf(me), members: list }
})

on('POST', '/mp/access/faces', (ctx) => {
  const me = mpOf(ctx)
  if (me.identity === MP_ROLE.TENANT) throw forbidden('租客的人脸由物业在核验租约时录入，暂不能自助提交')
  const memberId = me.identity === MP_ROLE.MEMBER ? me.memberId : ''
  mpFacePush(me, { memberId, guardian: false })
  return mpFaceSelf(me)
})

on('POST', '/mp/access/faces/members/{memberId}', (ctx) => {
  const me = mpOf(ctx)
  if (me.identity !== MP_ROLE.OWNER) throw forbidden('只有业主能替家庭成员录入人脸')
  const m = members.find(x => x.memberId === ctx.params.memberId)
  if (!m) throw notFound('家庭成员不存在')
  if (m.ownerId !== me.ownerId) throw forbidden('这个成员不属于您')
  if (!m.certified) {
    throw new ApiError(409, 40934, '成员资料还没有通过物业核验，核验后才能帮他录人脸')
  }
  if (ctx.body?.guardian !== true) {
    throw invalid('代家人录入必须勾选监护人代同意')
  }
  mpFacePush(me, { memberId: m.memberId, guardian: true })
  return mpFaceMemberRow(me, m)
})

on('POST', '/mp/access/faces/{faceId}/withdraw', (ctx) => {
  const me = mpOf(ctx)
  const f = faces.find(x => x.faceId === ctx.params.faceId)
  if (!f) throw notFound('人脸申请不存在')
  if (f.ownerId !== me.ownerId) throw forbidden('这不是您的申请')
  /* 家属不能撤成员的人脸：他能看见成员就已经是让步了 */
  if (f.memberId && me.identity !== MP_ROLE.OWNER) throw forbidden('只有业主能撤回家庭成员的人脸')
  if (f.status === '已冻结') throw new ApiError(409, 40935, '这条人脸已经撤回过了')

  f.status = '已冻结'
  f.frozenReason = '本人主动撤回，影像件将在 30 天内删除'
  f.note = ''
  f.auditAt = `${DATA_DATE} ${mpHourMinute()}`
  f.auditBy = me.name
  return { ...faceBaseView(f, f.ownerId, f.memberId), name: f.name }
})

on('GET', '/mp/bills', (ctx) => {
  const me = mpOf(ctx)
  const q = ctx.query || {}
  /* 按车位查：先确认这个车位是本人的（否则 = 窥探别人的缴费记录） */
  if (q.parkId) mpMyParking(me, q.parkId)
  /* 带 houseId 查别人的房：直接 403，不当成"没数据"返回空数组 ——
     空数组会让业主以为"这套房没账单"，实际上是没权限 */
  if (q.houseId && !mpBound(me).has(String(q.houseId))) {
    throw forbidden('这套房不在您已绑定的房产里')
  }
  const list = mpBillList(me, q)
  const rows = list.map(billRow)
  return {
    rows,
    summary: {
      count: rows.length,
      payable: r2(rows.reduce((s, b) => s + (Number(b.payable) || 0), 0)),
      /* 欠费合计只算欠费三态：已减免的账单金额没清零是数据问题，不该变成待缴 */
      unpaid: r2(rows.filter(mpIsDebt).reduce((s, b) => s + (Number(b.unpaid) || 0), 0)),
      debtCount: rows.filter(mpIsDebt).length,
      overdueCount: rows.filter(b => mpIsDebt(b) && (Number(b.overdueDays) || 0) > 0).length
    },
    /* 账期升序：账单页按它分组，倒序会让"最近一期"排在最后 */
    periods: [...new Set(rows.map(b => b.period))].sort()
  }
})

on('GET', '/mp/pricing', (ctx) => {
  const cid = String((ctx.query || {}).communityId || '')
  const proj = repairPrices.projects.find(p => p.communityId === cid)
  if (cid && !proj) throw notFound(`项目 ${cid} 没有配置维修价目`)
  if (proj && proj.enabled === false) throw forbidden(`${proj.name || cid} 暂未开通线上报修`)
  /* 价目是**全项目共用**的一份，项目只决定"开不开"与"多久上门"。
     这里不按项目裁 items —— 裁了会出现"同一项在 A 项目 125、B 项目没有"，
     而员工端现场增项用的是全量表，两边报价就对不上。 */
  return {
    chargeMode: repairPrices.chargeMode,
    tradeOpts: repairPrices.tradeOpts,
    items: repairPrices.items,
    addons: repairPrices.addons
  }
})

/* ================= 批 C：报修 / 增项 / 支付 / 评价 =================
 * 业主端这一组的核心是**钱分三段**：
 *   originFee（价目材料 + 人工）/ addonFee（已确认增项）/ totalFee（合计），
 *   paidAmount 是已预付，dueFee = totalFee - paidAmount 才是"还要付多少"。
 * 增项确认后**不重开一单、不重付总额**，只补差额 —— 这是业主最容易被多收钱的地方。
 */

const MP_NOW = `${NV_TODAY} 11:30`
/** 待付款单（不是支付流水）。只在内存里活着，服务重启即清空 —— 演示够用。 */
const payOrders = []
let mpWoSeq = 0
let mpPaySeq = 0

const mpInMinutes = (text, n) => {
  const [d, t] = String(text).split(' ')
  const [hh, mm] = t.split(':').map(Number)
  const total = hh * 60 + mm + n
  return `${d} ${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const mpPriceOf = code => [...repairPrices.items, ...repairPrices.addons].find(i => i.code === code) || null

/** 在做的单：首页"进行中"角标、列表排序都用它 */
const MP_DOING = ['待派单', '已派单', '处理中', '待确认']

/** 我的单：个人单按已绑房，公共单按项目（跟产权无关，登录即可见） */
function mpOrderList(sess, q = {}) {
  const ids = mpBound(sess)
  const cmIds = new Set((sess.boundHouseIds || []).map(id => (HOUSE.get(id) || {}).communityId).filter(Boolean))
  const wantPublic = String(q.scope) === 'public'
  return workOrders
    .filter(w => (wantPublic
      ? !!w.isPublic && (!q.communityId || w.communityId === String(q.communityId))
      : ids.has(w.houseId)))
    .filter(w => !q.houseId || w.houseId === String(q.houseId))
    .filter(w => String(q.onlyDoing) !== 'true' || MP_DOING.includes(w.status))
    .filter(w => !q.status || w.status === String(q.status))
}

/** 进度节点：由字段推导，不另存节点表（与契约里的 timeline 一致） */
function mpTimeline(w, addons) {
  const confirmedAt = (addons || []).filter(a => a.confirmed).map(a => a.confirmedAt).filter(Boolean).sort().pop()
  const rows = [
    { key: 'create', label: '提交报修', at: w.createTime || '', done: true },
    { key: 'accept', label: '师傅接单', at: w.acceptTime || '', done: !!w.acceptTime },
    { key: 'arrive', label: '上门处理', at: w.arriveTime || '', done: !!w.arriveTime },
    { key: 'addon', label: '增项确认', at: confirmedAt || '', done: !!confirmedAt },
    { key: 'finish', label: '完工', at: w.finishTime || '', done: !!w.finishTime },
    { key: 'eval', label: '评价', at: w.evaluateAt || '', done: w.status === '已评价' }
  ]
  /* 没有增项的单不显示"增项确认"这一节：一条永远不亮的节点只会让人以为流程卡住了 */
  return (addons || []).length ? rows : rows.filter(r => r.key !== 'addon')
}

/**
 * 业主视角的工单（= 契约 MpOrderDetail）。
 * 金额一律**由数据算**，不接受前端传值 —— 前端算钱是"三处金额不一致"的根源。
 */
function mpOrderRow(w) {
  const addons = Array.isArray(w.addons) ? w.addons : []
  const originFee = r2((Number(w.materialFee) || 0) + (Number(w.laborFee) || 0))
  const addonFee = r2(addons.filter(a => a.confirmed).reduce((s, a) => s + (Number(a.total) || 0), 0))
  const pendingAddons = addons.filter(a => !a.confirmed)
  const pendingAddonFee = r2(pendingAddons.reduce((s, a) => s + (Number(a.total) || 0), 0))
  const totalFee = r2(w.totalFee || 0)
  const paidAmount = r2(w.paidAmount != null ? w.paidAmount : (w.payStatus === '已支付' ? totalFee : 0))
  const pay = payOrders.find(p => p.type === 'wo' && p.refId === w.woId && p.status === '待支付') || null
  const price = mpPriceOf(w.priceCode)
  return {
    ...w,
    addons,
    pendingAddons,
    pendingAddonFee,
    originFee,
    addonFee,
    totalFee,
    paidAmount,
    dueFee: Math.max(0, r2(totalFee - paidAmount)),
    /* 确认后会变成多少：业主点"确认"之前要看到结果，否则等于盲签 */
    willBeFee: r2(originFee + addonFee + pendingAddonFee),
    priceName: w.priceName || (price ? price.name : ''),
    priceQty: Number(w.priceQty) || 1,
    timeline: mpTimeline(w, addons),
    /* 没有待付单时**不给这个键**，不要给 null —— 契约里它是 object，
       给 null 客户端要额外判一次，用 `wo.payOrder` 真值判断就够了 */
    ...(pay ? { payOrder: pay } : {})
  }
}

const mpMyOrder = (sess, woId) => {
  const w = workOrders.find(x => x.woId === String(woId))
  if (!w) throw notFound('工单不存在')
  if (!w.isPublic && !mpBound(sess).has(w.houseId)) {
    /* 不是本人房上的单：404 还是 403？这里给 403 —— 单号是猜不出来的（WO000123 能猜到），
       但业主手上可能有过别人转来的单号。给 403 至少不会让人以为"单子没了"。 */
    throw forbidden('这张工单不在您的房产下')
  }
  return w
}

/* ---------------- 待付款单 ---------------- */

const mpPayRow = p => ({ ...p })

function mpPayPending(type, refId, ownerId) {
  return payOrders.find(p => p.type === type && p.refId === refId && p.ownerId === ownerId && p.status === '待支付') || null
}

function mpNewPay({ type, refId, ownerId, title, sub, amount, billIds = [], lines = [] }) {
  mpPaySeq += 1
  const pay = {
    payId: `PY${NV_TODAY.replace(/-/g, '')}${String(mpPaySeq).padStart(4, '0')}`,
    type,
    refId,
    ownerId,
    title,
    sub,
    amount,
    billIds,
    lines,
    status: '待支付',
    createdAt: MP_NOW,
    expireAt: mpInMinutes(MP_NOW, 30)
  }
  payOrders.unshift(pay)
  return pay
}

/* ---------------- 路由 ---------------- */

on('GET', '/mp/orders', (ctx) => {
  const me = mpOf(ctx)
  const rows = mpOrderList(me, ctx.query)
    .map(mpOrderRow)
    /* 在做的排前面，其次按时间倒序 —— 业主进来是看"我这单到哪了" */
    .sort((a, b) => {
      const d = (MP_DOING.includes(b.status) ? 1 : 0) - (MP_DOING.includes(a.status) ? 1 : 0)
      if (d) return d
      return String(b.createTime).localeCompare(String(a.createTime))
    })
  return {
    rows,
    total: rows.length,
    summary: {
      doing: rows.filter(r => MP_DOING.includes(r.status)).length,
      toEvaluate: rows.filter(r => r.status === '已完工' && !r.score).length,
      pendingAddons: rows.filter(r => r.pendingAddons.length > 0).length
    }
  }
})

on('GET', '/mp/orders/{woId}', (ctx) => mpOrderRow(mpMyOrder(mpOf(ctx), ctx.params.woId)))

on('POST', '/mp/orders', (ctx) => {
  const me = mpOf(ctx)
  const b = ctx.body || {}
  const isPublic = String(b.scope || 'personal') === 'public'
  if (!b.description || !String(b.description).trim()) throw invalid('问题描述必填')
  if (String(b.description).length > 120) throw invalid('问题描述最多 120 字')

  /* 两条线要的东西不同：
       personal —— 房 + 价目项 + 预约时段（下单即见价、即预付）
       public   —— 位置 + 描述（物业出人出料，没有价目项，也不用业主约时间）

     公共单**不再要求 `priceCode`**：以前不分 scope 一律校验价目，等于让
     "电梯有异响"先挑一个收费项目再免费处理。样例里 75 张公共单的
     `priceCode` / `serviceName` 全是空、`appointAt` 一条都没有 —— 契约此前比数据收得更紧。 */
  let price = null
  let house = null
  if (isPublic) {
    const place = String(b.place || '').trim()
    if (!place) throw invalid('公共区域报修要填位置')
    if (place.length > 40) throw invalid('位置最多 40 字')
    /* 类型是业主写的原文（前台受理时归类），不是枚举 —— 只限长度，不查白名单 */
    if (String(b.category || '').trim().length > 20) throw invalid('问题类型最多 20 字')
  } else {
    price = mpPriceOf(String(b.priceCode || ''))
    if (!price || !repairPrices.items.some(i => i.code === price.code)) {
      throw invalid(`维修项目不存在：${b.priceCode || '（空）'}`)
    }
    if (!b.houseId) throw invalid('请选择要维修的房屋')
    house = mpMyHouse(me, b.houseId) // 没绑 → 403
    if (!b.appointDate) throw invalid('请选择上门日期')
    /* 时段是 1 小时粒度（09:00-10:00）。只校验形状不校验清单：
       以后加时段不用改这里，但"上午/下午"这种词得在客户端就挡住 */
    if (!/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(String(b.appointSlot || ''))) {
      throw invalid('上门时段格式应是 09:00-10:00')
    }
  }

  const qty = Math.min(5, Math.max(1, Number(b.qty) || 1))
  const material = isPublic ? 0 : r2((price.material || 0) * qty)
  const labor = isPublic ? 0 : r2((price.labor || 0) * qty)
  const total = r2(material + labor)

  mpWoSeq += 1
  const woId = `WO9${String(mpWoSeq).padStart(5, '0')}`
  const wo = {
    woId,
    woNo: `BX${NV_TODAY.slice(0, 4)}9${String(mpWoSeq).padStart(4, '0')}`,
    communityId: house ? house.communityId : String(b.communityId || 'P01'),
    houseId: isPublic ? '' : house.houseId,
    houseName: isPublic ? String(b.place) : house.fullName,
    ownerId: me.ownerId,
    ownerName: me.name,
    /* 「入户维修」在 2026-11-02 已废弃（契约 WoType 写明）：收费的入户单是「商业服务」。
       写回旧值不会报错，只会在后台筛选里变成一个谁都搜不到的类型。 */
    type: isPublic ? '公共区域维修' : '商业服务',
    /* 公共单的 category 是**业主填写的问题类型原文**（「电梯异响」「路灯不亮」），
       不是价目分类，也不做枚举校验 —— 前台受理时按它定工种。
       传了标准部位（电梯 / 配电…）时工时积分权重能直接取到，否则落默认 1.0。 */
    category: isPublic
      ? (String(b.category || '').trim() || '公共设备')
      : (price.category || '综合维修'),
    source: '小程序',
    priority: '普通',
    /* 状态先给「待派单」，但 `payStatus=未支付` 时**不进派单池** ——
       派单池的取数条件是 `status=待派单 且 payStatus=已支付`。
       不给新状态（比如"待支付"）是为了不让后台的状态机多一个分叉。 */
    status: '待派单',
    title: isPublic
      ? `${String(b.place).trim()} · 公共区域报修`
      : `${price.category || '维修'} · ${price.name}`,
    description: String(b.description).trim(),
    dispatchMode: '系统派单',
    createTime: MP_NOW,
    slaHours: 24,
    slaDueAt: mpInMinutes(MP_NOW, 24 * 60),
    slaUsedHours: 0,
    slaBreached: false,
    serviceItemCode: price ? price.code : '',
    serviceName: price ? price.name : '',
    priceCode: price ? price.code : '',
    priceName: price ? price.name : '',
    priceQty: price ? qty : 0,
    feeType: isPublic ? '免费' : '收费',
    materialFee: material,
    laborFee: labor,
    totalFee: total,
    paidAmount: 0,
    payStatus: isPublic ? '无需支付' : '未支付',
    score: 0,
    isPublic,
    /* 公共单不落预约时间：样例里 75 张公共单一条都没有，物业按派单排期 */
    appointAt: isPublic
      ? ''
      : `${String(b.appointDate).slice(0, 10)} ${String(b.appointSlot).slice(0, 5)}`,
    appointSlot: isPublic ? '' : String(b.appointSlot),
    photos: Array.isArray(b.photos) ? b.photos : [],
    addons: [],
    _ver: 1
  }
  workOrders.unshift(wo)

  /* 下单即预付：直接生成待付款单。免费/公共单不生成 —— 生成一张 0 元的单让业主点"支付"很蠢。 */
  const pay = isPublic ? null : mpNewPay({
    type: 'wo',
    refId: woId,
    ownerId: me.ownerId,
    title: `${wo.category} · ${price.name}`,
    sub: `${wo.houseName} · 工单 ${wo.woNo}`,
    amount: total
  })
  return { order: mpOrderRow(wo), payOrder: pay ? mpPayRow(pay) : null }
})

on('POST', '/mp/orders/{woId}/addons/confirm', (ctx) => {
  const me = mpOf(ctx)
  const w = mpMyOrder(me, ctx.params.woId)
  if (['已评价', '已关闭', '已取消'].includes(w.status)) {
    throw new ApiError(409, 40993, `工单已${w.status}，不能再确认增项`)
  }
  const want = Array.isArray(ctx.body?.addonCodes) && ctx.body.addonCodes.length
    ? new Set(ctx.body.addonCodes.map(String))
    : null
  const list = Array.isArray(w.addons) ? w.addons : []
  if (!list.length) throw invalid('这单没有增项')
  const targets = list.filter(a => !a.confirmed && (!want || want.has(a.code)))
  /* 幂等：**已经有增项、但都确认过了**时返回 200 且不动 `confirmedAt` ——
     客户端超时重试很常见，重复确认让它失败会让人以为"没确认上"然后反复点。
     真正该报 422 的是"这单压根没有增项"。 */
  if (!targets.length) return mpOrderRow(w)

  for (const a of targets) {
    a.confirmed = true
    a.confirmedAt = MP_NOW
    a.confirmedBy = '业主（小程序）'
  }
  /* 总额 = 原价 + **已确认**增项。没确认的不能提前算进总额，否则业主看到的总价是虚的 */
  const origin = r2((Number(w.materialFee) || 0) + (Number(w.laborFee) || 0))
  const addonFee = r2(list.filter(a => a.confirmed).reduce((s, a) => s + (Number(a.total) || 0), 0))
  w.totalFee = r2(origin + addonFee)
  const paid = r2(w.paidAmount || 0)
  /* 还有差额就回到「未支付」，业主付的是差额；没差额就保持已支付 */
  w.payStatus = w.totalFee > paid + 0.001 ? '未支付' : (paid > 0 ? '已支付' : '无需支付')
  if (w.status === '待确认') {
    w.status = '已完工'
    w.finishTime = w.finishTime || MP_NOW
  }
  return mpOrderRow(w)
})

on('POST', '/mp/orders/{woId}/evaluate', (ctx) => {
  const me = mpOf(ctx)
  const w = mpMyOrder(me, ctx.params.woId)
  const b = ctx.body || {}
  const score = Number(b.score)
  if (!Number.isInteger(score) || score < 1 || score > 5) throw invalid('评分须是 1~5 的整数')
  if (w.status !== '已完工') {
    throw new ApiError(409, 40994, w.status === '已评价' ? '这单已经评价过了' : `工单当前是「${w.status}」，完工后才能评价`)
  }
  /* 先把账算清，再谈感受：还有待确认增项时不让评价 */
  if ((w.addons || []).some(a => !a.confirmed)) {
    throw new ApiError(409, 40995, '还有增项没确认，确认后再评价')
  }
  const TAGS = ['准时上门', '穿着规范', '讲解清楚', '收拾干净', '收费透明', '态度好']
  const tags = Array.isArray(b.tags) ? b.tags.map(String) : []
  const badTag = tags.find(t => !TAGS.includes(t))
  if (badTag) throw invalid(`评价标签只能是：${TAGS.join(' / ')}`)
  if (b.text && String(b.text).length > 200) throw invalid('评价最多 200 字')

  w.score = score
  w.evalTags = tags
  w.evaluate = String(b.text || '')
  w.evaluateAt = MP_NOW
  w.status = '已评价'
  return mpOrderRow(w)
})

on('POST', '/mp/payments', (ctx) => {
  const me = mpOf(ctx)
  const b = ctx.body || {}
  const type = String(b.type || '')

  if (type === 'bill') {
    const ids = (Array.isArray(b.billIds) ? b.billIds : []).map(String).filter(Boolean)
    if (!ids.length) throw invalid('没有选择账单')
    const list = ids.map(id => bills.find(x => x.billId === id)).filter(Boolean)
    if (list.length !== ids.length) throw notFound('有账单不存在')
    const ids_set = mpBound(me)
    for (const x of list) {
      const mine = x.houseId ? ids_set.has(x.houseId) : x.ownerId === me.ownerId
      if (!mine) throw forbidden(`账单 ${x.billId} 不在您的名下`)
      if (!mpIsDebt(x)) throw invalid(`账单 ${x.billId} 不欠费，不能缴费`)
    }
    const amount = r2(list.reduce((s, x) => s + (Number(x.unpaid) || 0), 0))
    const houses = [...new Set(list.map(x => (x.houseId ? (HOUSE.get(x.houseId) || {}).fullName : '车位')).filter(Boolean))]
    const park = list.some(x => !x.houseId)
    const exist = payOrders.find(p => p.type === 'bill' && p.ownerId === me.ownerId &&
      p.status === '待支付' && p.billIds.join(',') === ids.join(','))
    if (exist) {
      exist.amount = amount
      return mpPayRow(exist)
    }
    return mpPayRow(mpNewPay({
      type: 'bill',
      refId: ids[0],
      ownerId: me.ownerId,
      title: houses.length > 1
        ? `${houses.length} 套房合并缴费`
        : list.length > 1 ? `${list.length} 张账单合并缴费` : `${list[0].itemName}（${list[0].period}）`,
      sub: houses.length > 1
        ? `${houses[0]} 等 ${houses.length} 套${park ? '（含车位）' : ''} · 共 ${list.length} 项`
        : `${houses[0] || ''} · 共 ${list.length} 项`,
      amount,
      billIds: ids,
      lines: list.map(x => ({
        billId: x.billId,
        houseId: x.houseId || '',
        houseName: x.houseId ? (HOUSE.get(x.houseId) || {}).fullName || '' : '车位',
        itemName: x.itemName,
        period: x.period,
        status: x.status,
        overdueDays: Number(x.overdueDays) || 0,
        amount: r2(x.unpaid)
      }))
    }))
  }

  if (type === 'wo') {
    const w = mpMyOrder(me, b.woId)
    if ((w.addons || []).some(a => !a.confirmed)) {
      throw new ApiError(409, 40996, '有增项待确认，确认后才能一并支付')
    }
    const total = r2(w.totalFee || 0)
    const paid = r2(w.paidAmount != null ? w.paidAmount : (w.payStatus === '已支付' ? total : 0))
    const due = Math.max(0, r2(total - paid))
    if (due <= 0) {
      throw new ApiError(409, 40997, paid > 0 ? '该单已结清' : '该单无需支付')
    }
    const exist = mpPayPending('wo', w.woId, me.ownerId)
    if (exist) {
      exist.amount = due
      return mpPayRow(exist)
    }
    return mpPayRow(mpNewPay({
      type: 'wo',
      refId: w.woId,
      ownerId: me.ownerId,
      title: `${w.category} · ${w.priceName || w.title}`,
      sub: `${w.houseName} · 工单 ${w.woNo}${paid > 0 ? ' · 增项补付' : ''}`,
      amount: due
    }))
  }

  if (type === 'activity') {
    const e = neighborEnrolls.find(x => x.enrollId === String(b.refId || b.enrollId || ''))
    if (!e) throw notFound('报名记录不存在')
    const amount = r2(e.amount || 0)
    /* 报名费金额在业主侧报名接口里算（批 D）。现在 enrolls 样例没有 amount，
       所以收费活动到这里统一是"没有可付金额"，而不是凭空收一笔。 */
    if (amount <= 0) throw invalid('这笔报名没有应缴金额（免费活动，或报名费尚未生成）')
    const exist = mpPayPending('activity', e.enrollId, me.ownerId)
    if (exist) return mpPayRow(exist)
    return mpPayRow(mpNewPay({
      type: 'activity', refId: e.enrollId, ownerId: me.ownerId,
      title: `${e.activityTitle || '社区活动'} · 报名费`,
      sub: `${e.people} 人`,
      amount
    }))
  }

  throw invalid('type 只能是 bill / wo / activity')
})

on('POST', '/mp/payments/{payId}/simulate', (ctx) => {
  const me = mpOf(ctx)
  const pay = payOrders.find(p => p.payId === ctx.params.payId)
  if (!pay) throw notFound('订单不存在')
  if (pay.ownerId !== me.ownerId) throw forbidden('这不是您的订单')

  /* 幂等：重复回调不能重复冲账。真实接入时这条靠渠道回调 + 唯一索引，这里靠状态判断 */
  if (pay.status === '已支付') {
    const w = pay.type === 'wo' ? workOrders.find(x => x.woId === pay.refId) : null
    return { payOrder: mpPayRow(pay), ...(w ? { order: mpOrderRow(w) } : {}) }
  }
  if (pay.status !== '待支付') throw new ApiError(409, 40998, `订单${pay.status}，不能支付`)

  pay.status = '已支付'
  pay.paidAt = MP_NOW
  pay.payMethod = '微信支付（模拟）'

  if (pay.type === 'wo') {
    const w = workOrders.find(x => x.woId === pay.refId)
    if (!w) throw notFound('工单不存在')
    /* 付的是**差额**：把已付累加上去，不能直接等于总额 ——
       否则"先付 125、再补 80"会被记成只付了 205 里的一次 205。 */
    w.paidAmount = r2((Number(w.paidAmount) || 0) + pay.amount)
    w.payStatus = w.paidAmount + 0.001 >= r2(w.totalFee) ? '已支付' : '未支付'
    w.payTime = MP_NOW
    w.payMethod = '微信支付（模拟）'
    return { payOrder: mpPayRow(pay), order: mpOrderRow(w) }
  }

  if (pay.type === 'bill') {
    for (const line of pay.lines) {
      const x = bills.find(v => v.billId === line.billId)
      if (!x) continue
      x.paidAmount = r2((Number(x.paidAmount) || 0) + line.amount)
      x.unpaid = Math.max(0, r2((Number(x.payable) || 0) - x.paidAmount))
      x.status = x.unpaid > 0.001 ? '部分缴' : '已缴'
      x.payTime = MP_NOW
      x.overdueDays = x.unpaid > 0.001 ? x.overdueDays : 0
      /* 车位账单付清 → 到期日推到该账期末（取 max，不回退）。
         续费的本质是账期顺延：只把账单标成已缴、不动 expireDate 的话，
         业主付完钱回到车位页，看到的还是"已到期，请续费"。 */
      if (x.parkId && x.status === '已缴') {
        const pk = PARK.get(x.parkId)
        const end = periodEnd(x.period)
        if (pk && (!pk.expireDate || String(pk.expireDate) < end)) pk.expireDate = end
      }
      bumpVer('bill', x.billId)
    }
    return {
      payOrder: mpPayRow(pay),
      bills: (pay.billIds || []).map(id => bills.find(v => v.billId === id)).filter(Boolean).map(billRow)
    }
  }

  /* activity：付款单之外还要把**报名记录**标成已支付 ——
     只改付款单的话，"我的报名"里那条会一直显示"待支付"，用户会重复付 */
  const e = neighborEnrolls.find(x => x.enrollId === pay.refId)
  if (e) {
    e.payStatus = '已支付'
    e.paidAt = MP_NOW
    e.payMethod = '微信支付（模拟）'
  }
  return { payOrder: mpPayRow(pay) }
})

/* ================= 批 D：业主侧内容（公告 / 投票 / 活动 / 闲置） =================
 * 这一组是**业主自己写**的动作，和运营侧那套（`n.*` 权限码）不是一个模型：
 * 运营侧按"数据范围"过滤，业主侧按"这是我的"过滤。
 *
 * 状态存在内存里（`mpNv`），服务重启即清空 —— 演示够用，真实系统落三张表：
 * `notice_reads` / `vote_ballots` / `item_wants`（+ 消息表）。
 * `enrollments` 与 `items` 不另存，直接写进共享数组，这样**员工端立刻能看到**：
 * 业主发的闲置会进「待审核」队列、报名会进活动名单 —— 否则两边各存一份，永远对不上。
 */
const mpNv = {
  reads: new Map(), // ownerId -> Map(noticeId -> at)
  signs: new Map(),
  votes: new Map(), // ownerId -> Map(voteId -> [keys])
  wants: new Map(), // ownerId -> Set(itemId)
  messages: []
}
const mpNvGet = (map, key, init) => {
  if (!map.has(key)) map.set(key, init())
  return map.get(key)
}
const mpNvCommunities = (sess) => new Set(
  (sess.boundHouseIds || []).map(id => (HOUSE.get(id) || {}).communityId).filter(Boolean)
)
/**
 * 我的可见范围：**有绑定按绑定项目，游客（未绑房）放行**。
 * 放行不是设计，是让步：业主端上一版对游客就是"浏览全部"，这一批只负责把
 * "已绑 P01 的业主还能看到 P02 的投票"这个真问题修掉。正式版应按项目收敛，
 * 记在交接单 §14.5 第 4 条。
 */
const mpNvInScope = (sess, communityId) => {
  const mine = mpNvCommunities(sess)
  if (!mine.size) return true
  return !communityId || mine.has(communityId)
}
/** 我能看到的公告：已发布 + 可见范围（communityId 为空的算全公司公告） */
const mpNvNotices = (sess) => notices.filter(n => n.status === '已发布' && mpNvInScope(sess, n.communityId))
/**
 * 哪些公告要签收：**影响日常生活的两类**（停水停电 / 安全提示）。
 * 样例里没有 `needSign` 字段，也没必要为它改数据 —— 这个口径是业务规则，不是数据。
 * 反过来"所有公告都能签"是不行的：全都能签，就等于全都不用认真读。
 */
const MP_NV_SIGN_TYPES = ['停水停电', '安全提示']
const mpNvNeedSign = (n) => MP_NV_SIGN_TYPES.includes(n.type)

const mpNvNotice = (noticeId) => {
  const n = notices.find(x => x.noticeId === String(noticeId))
  if (!n) throw notFound('公告不存在')
  return n
}

const MP_NV_ENROLL_ALIVE = ['已报名', '待支付', '已签到']
/** 我的报名（含活动摘要与能否取消） */
function mpNvMyEnrolls(sess) {
  return neighborEnrolls
    .filter(e => e.ownerId === sess.ownerId)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map(e => {
      const a = neighborActivities.find(x => x.activityId === e.activityId)
      const phase = a ? nvPhaseOf(a) : ''
      return {
        ...e,
        activityTitle: e.activityTitle || (a ? a.title : ''),
        activityStart: e.activityStart || (a ? a.startAt : ''),
        communityId: e.communityId || (a ? a.communityId : ''),
        fee: Number(e.fee ?? (a ? a.fee : 0)) || 0,
        amount: Number(e.amount) || 0,
        payStatus: e.payStatus || (Number(e.fee) > 0 ? '待支付' : '无需支付'),
        phase,
        /* 已签到的不能自助取消（现场已核销），已流团/已结束的不必取消 */
        canCancel: MP_NV_ENROLL_ALIVE.includes(e.status) && ['报名中', '待成行'].includes(phase) && e.status !== '已签到'
      }
    })
}

const mpNvMyItems = (sess) => neighborItems
  .filter(i => i.ownerId === sess.ownerId)
  .sort((a, b) => String(b.publishAt).localeCompare(String(a.publishAt)))

/* ================== 公共列表与详情（业主视角的读接口） ================== */
/*
 * 与 `/neighbor/*`（运营侧）的区别不是"少几个字段"，而是**边界不同**：
 *   - 运营侧按数据范围（我管哪些项目）；
 *   - 业主侧按"我住哪个小区"（已绑房产所在项目）。
 * 混用的结果是客服能看到的内容，业主也能看到。
 *
 * 三条写死的口径：
 *   1. 已绑房 → 只看自己项目；**未绑房（游客）→ 不过滤**（与业主端原行为一致，
 *      正式版应改成按项目收敛，这条记在交接单 §14.5 第 4 条）。
 *   2. 投票未到 `canSeeResult` 时 `options[].votes` 一律置 0 —— 返回真值再靠前端
 *      不显示，等于把结果发给了每个人。
 *   3. 闲置只给到**楼栋**，`sellerHouse` / `sellerPhone` / `wechat` 不出现在响应里。
 */

/** 我的可见范围见 `mpNvInScope`（在公告那一段，与 `/mine` 共用） */

const MP_NV_ITEM_ON = '已上架'

function mpNvNoticeView(me, n) {
  const reads = mpNvGet(mpNv.reads, me.ownerId, () => new Map())
  const signs = mpNvGet(mpNv.signs, me.ownerId, () => new Map())
  const read = reads.has(n.noticeId)
  return {
    noticeId: n.noticeId,
    title: n.title,
    type: n.type,
    communityId: n.communityId || '',
    communityName: n.communityId ? communityNameOf(n.communityId) : '全公司',
    publisher: n.publisher,
    publishTime: n.publishTime,
    top: !!n.top,
    /* 自己看过的那一次也算一次阅读：否则点进去数字不动，像没生效 */
    readCount: (Number(n.readCount) || 0) + (read ? 1 : 0),
    targetHouses: Number(n.targetHouses) || 0,
    attachments: Number(n.attachments) || 0,
    content: n.content || '',
    /* 只有两类要签收，客户端据此决定显不显示「我已阅读并签收」 */
    signRequired: mpNvNeedSign(n),
    read,
    signed: signs.has(n.noticeId),
    signedAt: signs.get(n.noticeId) || ''
  }
}

function mpNvVoteView(me, v) {
  const ballot = mpNvGet(mpNv.votes, me.ownerId, () => new Map()).get(v.surveyId) || []
  const voted = ballot.length > 0
  const canSeeResult = voted || v.status === '已结束' || v.resultVisibility === '公开'
  const options = (v.options || []).map(o => ({
    key: o.key,
    label: o.label,
    /* 我那一票要算进去 —— 投完数字不动，会被当成没生效 */
    votes: (Number(o.votes) || 0) + (ballot.includes(o.key) ? 1 : 0)
  }))
  const total = options.reduce((s, o) => s + o.votes, 0)
  const owners = new Set(
    houses.filter(h => h.communityId === v.communityId && h.ownerId).map(h => h.ownerId)
  )
  /* 分母兜底：fixtures 的 houses 是裁剪版，种子票数会出现「282 票 / 16 户」。
     取 max 保证参与率不超 100%；真实环境两边同源，这个偏差不存在。 */
  return {
    voteId: v.surveyId,
    title: v.title,
    type: v.type,
    desc: v.desc || '',
    communityId: v.communityId,
    communityName: communityNameOf(v.communityId),
    status: v.status,
    startAt: v.startAt,
    endAt: v.endAt,
    multi: !!v.multi,
    maxPick: Number(v.maxPick) || (v.multi ? 2 : 1),
    anonymous: v.anonymous !== false,
    resultVisibility: v.resultVisibility || '投票后可见',
    options: canSeeResult ? options : options.map(o => ({ ...o, votes: 0 })),
    target: Math.max(owners.size, total),
    totalVotes: canSeeResult ? total : 0,
    canSeeResult,
    voted,
    /* 自己的选择对自己不是秘密；别人投了谁都不给 */
    myVote: ballot
  }
}

/**
 * 活动：**只给数据，不给阶段**。
 * 阶段依赖"今天"，而演示时钟在客户端（06/05 都是 2026-10-20，服务端数据日是 10-21）。
 * 服务端算一份、客户端再算一份，两边必然在临界那天打架（AC0015 就卡在 10-20）。
 * 客户端用 `activity-rule.mjs` 现算，`enrolled` 则由服务端给（它才是真数）。
 */
function mpNvActView(me, a) {
  const enrolled = nvEnrolledOf(a.activityId)
  const mine = neighborEnrolls
    .filter(e => e.ownerId === me.ownerId
      && e.activityId === a.activityId
      && MP_NV_ENROLL_ALIVE.includes(e.status))
    .sort((x, y) => String(y.at).localeCompare(String(x.at)))[0] || null
  return {
    activityId: a.activityId,
    title: a.title,
    category: a.category,
    cover: a.cover,
    desc: a.desc || '',
    communityId: a.communityId,
    communityName: communityNameOf(a.communityId),
    startAt: a.startAt,
    endAt: a.endAt,
    place: a.place,
    enrollDeadline: a.enrollDeadline,
    capacity: Number(a.capacity) || 0,
    minCapacity: Number(a.minCapacity) || 0,
    fee: Number(a.fee) || 0,
    needInsurance: !!a.needInsurance,
    attendeeLimit: Number(a.attendeeLimit) || 1,
    feeInclude: a.feeInclude || '',
    feeExclude: a.feeExclude || '',
    refundPolicy: a.refundPolicy || [],
    organizer: a.organizer || '物业服务中心',
    status: a.status,
    flowedAt: a.flowedAt || '',
    enrolled,
    mine: !!mine,
    /* 没报名就**不给这个键**，不要回 null —— 契约里它是 object，
       给 null 客户端要多判一次；`v-if="a.myEnroll"` 用真值就够（与 payOrder 同口径） */
    ...(mine ? { myEnroll: mine } : {})
  }
}

function mpNvItemView(me, i) {
  const wants = mpNvGet(mpNv.wants, me.ownerId, () => new Set())
  return {
    itemId: i.itemId,
    communityId: i.communityId,
    communityName: i.communityName || communityNameOf(i.communityId),
    title: i.title,
    category: i.category,
    price: Number(i.price) || 0,
    originPrice: Number(i.originPrice) || 0,
    condition: i.condition,
    cover: i.cover,
    images: Number(i.images) || 0,
    desc: i.desc || '',
    sellerName: i.sellerName,
    /* 只到楼栋。**sellerHouse / sellerPhone / wechat 不进响应** —— 门牌和手机号
       一旦下发，前端一句 console.log 就全泄了。
       `buildingName` 由生成器写在样例里（fixtures 的 houses 是裁剪版，join 不到一半）；
       业主新发布的没有这个字段，用 buildingId 现算。 */
    buildingName: i.buildingName
      || (() => {
        const h = houses.find(x => x.shortName === i.sellerHouse)
        return h ? buildingNameOf(h.buildingId) : ''
      })(),
    publishAt: i.publishAt,
    status: i.status,
    views: Number(i.views) || 0,
    wants: Number(i.wants) || 0,
    contactMode: i.contactMode || '站内私信',
    wanted: wants.has(i.itemId),
    wantCount: Number(i.wants) || 0
  }
}

/* ---------------- 我的内容（一次拉齐，客户端不用打五个请求） ---------------- */

on('GET', '/mp/neighbor/mine', (ctx) => {
  const me = mpOf(ctx)
  const reads = Object.fromEntries(mpNvGet(mpNv.reads, me.ownerId, () => new Map()))
  const signs = Object.fromEntries(mpNvGet(mpNv.signs, me.ownerId, () => new Map()))
  const votes = Object.fromEntries(mpNvGet(mpNv.votes, me.ownerId, () => new Map()))
  const wants = [...mpNvGet(mpNv.wants, me.ownerId, () => new Set())]
  const enrolls = mpNvMyEnrolls(me)
  const items = mpNvMyItems(me)
  const unread = mpNvNotices(me).filter(n => !reads[n.noticeId]).length
  return {
    noticeReads: reads,
    noticeSigns: signs,
    votes,
    wants,
    enrolls,
    items,
    unread,
    counts: {
      enroll: enrolls.filter(e => MP_NV_ENROLL_ALIVE.includes(e.status)).length,
      vote: Object.keys(votes).length,
      item: items.length,
      want: wants.length
    }
  }
})

/* ---------------- 公告：已读 / 签收 ---------------- */

on('POST', '/mp/neighbor/notices/{noticeId}/read', (ctx) => {
  const me = mpOf(ctx)
  const n = mpNvNotice(ctx.params.noticeId)
  const map = mpNvGet(mpNv.reads, me.ownerId, () => new Map())
  /* 幂等：保留第一次的阅读时间。刷一次就改一次，"读了多久"就再也算不出来 */
  if (!map.has(n.noticeId)) map.set(n.noticeId, MP_NOW)
  return { noticeId: n.noticeId, readAt: map.get(n.noticeId) }
})

on('POST', '/mp/neighbor/notices/{noticeId}/sign', (ctx) => {
  const me = mpOf(ctx)
  const n = mpNvNotice(ctx.params.noticeId)
  if (!mpNvNeedSign(n)) {
    /* 签收是**责任动作**（停水停电这类要留痕），不能对所有公告都开放：
       全都能签，就等于全都不用认真读 */
    throw invalid('该公告不需要签收')
  }
  const reads = mpNvGet(mpNv.reads, me.ownerId, () => new Map())
  const signs = mpNvGet(mpNv.signs, me.ownerId, () => new Map())
  if (!reads.has(n.noticeId)) reads.set(n.noticeId, MP_NOW)
  if (!signs.has(n.noticeId)) signs.set(n.noticeId, MP_NOW)
  return { noticeId: n.noticeId, signedAt: signs.get(n.noticeId), readAt: reads.get(n.noticeId) }
})

/* ---------------- 投票：提交 ---------------- */

on('POST', '/mp/neighbor/votes/{voteId}/submit', (ctx) => {
  const me = mpOf(ctx)
  const v = neighborVotes.find(x => x.surveyId === String(ctx.params.voteId))
  if (!v) throw notFound('投票不存在')
  if (!mpNvCommunities(me).has(v.communityId) && v.communityId) {
    throw forbidden('这个投票不在您所在的项目')
  }
  if (v.status !== '进行中') {
    throw new ApiError(409, 40997, v.status === '已结束' ? '该投票已结束' : '该投票还没开始')
  }
  const keys = [...new Set((Array.isArray(ctx.body?.keys) ? ctx.body.keys : []).map(String).filter(Boolean))]
  if (!keys.length) throw invalid('请至少选择一项')
  const limit = v.multi ? (Number(v.maxPick) || 1) : 1
  if (keys.length > limit) throw invalid(`最多选 ${limit} 项`)
  const bad = keys.find(k => !(v.options || []).some(o => o.key === k))
  if (bad) throw invalid(`选项不存在：${bad}`)

  const map = mpNvGet(mpNv.votes, me.ownerId, () => new Map())
  const prev = map.get(v.surveyId) || []
  /* 改票要**先扣掉旧票再记新票**：只加不减，多投几次就能把一个选项刷到全票 */
  for (const o of v.options) {
    const wasMine = prev.includes(o.key)
    const isMine = keys.includes(o.key)
    if (wasMine && !isMine) o.votes = Math.max(0, (Number(o.votes) || 0) - 1)
    if (!wasMine && isMine) o.votes = (Number(o.votes) || 0) + 1
  }
  map.set(v.surveyId, keys)
  v.totalVotes = nvVoteTotal(v)
  return {
    voteId: v.surveyId,
    picks: keys,
    changed: prev.length > 0,
    totalVotes: v.totalVotes,
    options: (v.options || []).map(o => ({ key: o.key, label: o.label, votes: Number(o.votes) || 0 }))
  }
})

/* ---------------- 活动：报名 / 取消 ---------------- */

on('POST', '/mp/neighbor/activities/{activityId}/enroll', (ctx) => {
  const me = mpOf(ctx)
  const a = neighborActivities.find(x => x.activityId === String(ctx.params.activityId))
  if (!a) throw notFound('活动不存在')
  const b = ctx.body || {}
  if (!mpNvCommunities(me).has(a.communityId)) throw forbidden('这个活动不在您所在的项目')

  const phase = nvPhaseOf(a)
  if (phase !== '报名中') {
    throw new ApiError(409, 40996, phase === '待成行' ? '报名已截止且未达成团人数，暂不能报名' : `活动${phase}，不能报名`)
  }
  if (neighborEnrolls.some(e => e.activityId === a.activityId && e.ownerId === me.ownerId && MP_NV_ENROLL_ALIVE.includes(e.status))) {
    throw new ApiError(409, 40995, '您已经报过名了')
  }
  const cap = Number(a.capacity) || 0
  const left = cap ? Math.max(0, cap - nvEnrolledOf(a.activityId)) : 999
  if (left <= 0) throw new ApiError(409, 40994, '名额已满')

  const list = (Array.isArray(b.attendees) ? b.attendees : []).filter(x => x && String(x.name || '').trim())
  if (!list.length) throw invalid('至少填一位出行人')
  const limit = Number(a.attendeeLimit) || 1
  if (list.length > limit) throw invalid(`最多 ${limit} 位出行人`)
  if (list.length > left) throw invalid(`只剩 ${left} 个名额`)
  for (const p of list) {
    if (!/^[\u4e00-\u9fa5·]{2,12}$/.test(String(p.name || '').trim())) throw invalid('出行人姓名需为 2~12 个汉字')
    if (!/^1\d{10}$/.test(String(p.phone || '').trim())) throw invalid('出行人手机号格式不正确')
    /* 证件号只在投保时收。不投保的活动收了就是白担风险（§12.3 第 3 条） */
    if (a.needInsurance && !/^\d{17}[\dXx]$/.test(String(p.idNo || '').trim())) {
      throw invalid('本活动为出行人投保，需填 18 位身份证号')
    }
  }
  if (!b.agreeTerms) throw invalid('请先阅读并同意活动条款')
  if (a.needInsurance && !b.agreeInsurance) throw invalid('需同意为出行人购买当日意外险')

  const people = list.length
  const fee = Number(a.fee) || 0
  const seq = neighborEnrolls.filter(e => String(e.enrollId).startsWith('AE9')).length
  const row = {
    enrollId: `AE9${String(seq + 1).padStart(3, '0')}`,
    activityId: a.activityId,
    activityTitle: a.title,
    activityStart: a.startAt,
    communityId: a.communityId,
    ownerId: me.ownerId,
    name: String(list[0].name).trim(),
    phone: String(list[0].phone).trim(),
    houseShort: (HOUSE.get(me.boundHouseIds?.[0]) || {}).shortName || '',
    people,
    attendees: list.map(p => ({
      name: String(p.name).trim(),
      phone: String(p.phone).trim(),
      idNo: a.needInsurance ? String(p.idNo || '').trim().toUpperCase() : '',
      ageType: p.ageType || '成人',
      emergencyName: String(p.emergencyName || '').trim(),
      emergencyPhone: String(p.emergencyPhone || '').trim()
    })),
    source: '业主自助',
    at: MP_NOW,
    status: '已报名',
    fee,
    amount: r2(fee * people),
    payStatus: fee > 0 ? '待支付' : '无需支付'
  }
  neighborEnrolls.unshift(row)
  return row
})

on('POST', '/mp/neighbor/enrolls/{enrollId}/cancel', (ctx) => {
  const me = mpOf(ctx)
  const e = neighborEnrolls.find(x => x.enrollId === String(ctx.params.enrollId))
  if (!e) throw notFound('报名记录不存在')
  if (e.ownerId !== me.ownerId) throw forbidden('这不是您的报名')
  if (e.status === '已签到') throw new ApiError(409, 40993, '已签到的报名不能自助取消，请联系客服')
  if (!MP_NV_ENROLL_ALIVE.includes(e.status)) throw new ApiError(409, 40992, `报名已${e.status}`)

  const a = neighborActivities.find(x => x.activityId === e.activityId)
  const fee = Number(e.fee ?? (a ? a.fee : 0)) || 0
  const ratio = fee > 0 ? nvRefundRatioOf(a) : 100
  const refund = r2((Number(e.amount) || fee * (Number(e.people) || 1)) * ratio / 100)
  e.status = fee > 0 ? '已退款' : '已取消'
  e.refundRatio = ratio
  e.refundAmount = refund
  e.cancelledAt = MP_NOW
  return { enrollId: e.enrollId, status: e.status, ratio, refundAmount: refund, refunded: fee > 0 }
})

/* ---------------- 闲置：发布 / 想要 / 私信 / 下架 / 续挂 ---------------- */

/* 敏感词只做"明显违规"的第一道闸。真实环境要接微信 msgSecCheck —— 这里写明，不假装做了 */
const MP_NV_BLOCK_WORDS = ['茅台', '香烟', '发票', '贷款', '枪支', '管制刀具', '活体', '代购', '药酒']

on('POST', '/mp/neighbor/items', (ctx) => {
  const me = mpOf(ctx)
  const b = ctx.body || {}
  const title = String(b.title || '').trim()
  const desc = String(b.desc || '').trim()
  const hit = MP_NV_BLOCK_WORDS.find(w => `${title} ${desc}`.includes(w))
  if (hit) throw invalid(`内容含「${hit}」，属平台禁售范围，请修改后再发`)
  if (title.length < 4) throw invalid('标题至少 4 个字，邻居才知道是什么')
  if (desc.length > 300) throw invalid('描述最多 300 字')
  const price = Number(b.price)
  if (!Number.isFinite(price) || price < 0) throw invalid('价格填一个数字，送人可以填 0')
  if (Number(b.images) > 9) throw invalid('图片最多 9 张')

  /* 楼栋只能选自己名下的：选了别人的楼栋，等于把"我住那栋"这张牌打给全小区 */
  const h = (me.boundHouseIds || []).map(id => HOUSE.get(id)).find(x => x && x.buildingId === String(b.buildingId || ''))
  if (!h) throw invalid('请选择您名下的楼栋')

  const seq = neighborItems.filter(i => String(i.itemId).startsWith('SH9')).length
  const row = {
    itemId: `SH9${String(seq + 1).padStart(3, '0')}`,
    title,
    category: b.category || '其他',
    price,
    originPrice: Number(b.originPrice) || 0,
    condition: b.condition || '九成新',
    cover: '',
    images: Number(b.images) || 0,
    desc,
    communityId: h.communityId,
    communityName: (LS_COMMUNITY.get(h.communityId) || {}).name || '',
    /* 存房号串，**展示只到楼栋** —— 门牌漏给邻居，等于把住址公开 */
    sellerHouse: h.shortName,
    sellerName: `${String(me.name || '业主').slice(0, 1)}**`,
    sellerType: me.identity === '租客' ? '租户' : '业主',
    ownerId: me.ownerId,
    contactMode: b.contactMode === '公开' ? '公开' : '站内私信',
    publishAt: MP_NOW,
    /* 先审后发：业主端只提交与看状态，审核在员工端 */
    status: '待审核',
    views: 0,
    wants: 0,
    source: '业主发布',
    expireAt: ''
  }
  neighborItems.unshift(row)
  return row
})

on('POST', '/mp/neighbor/items/{itemId}/want', (ctx) => {
  const me = mpOf(ctx)
  const it = neighborItems.find(x => x.itemId === String(ctx.params.itemId))
  if (!it) throw notFound('闲置不存在')
  const set = mpNvGet(mpNv.wants, me.ownerId, () => new Set())
  const on = !set.has(it.itemId)
  if (on) {
    set.add(it.itemId)
    it.wants = (Number(it.wants) || 0) + 1
  } else {
    set.delete(it.itemId)
    it.wants = Math.max(0, (Number(it.wants) || 0) - 1)
  }
  /* 想要数只记**人数**，不记"谁要了"：邻居要的是"有多少人也想要"，
     公开名单等于把每个人的兴趣挂出来；卖家要联系谁走站内私信 */
  return { itemId: it.itemId, want: on, wants: Number(it.wants) || 0 }
})

on('POST', '/mp/neighbor/items/{itemId}/messages', (ctx) => {
  const me = mpOf(ctx)
  const it = neighborItems.find(x => x.itemId === String(ctx.params.itemId))
  if (!it) throw notFound('闲置不存在')
  const content = String(ctx.body?.content || '').trim()
  if (!content) throw invalid('写一句话再发')
  if (content.length > 200) throw invalid('消息最多 200 字')
  /* 只留"发过"这条事实，不做 IM：物业类目不允许，运维也不该扛聊天记录 */
  const row = {
    msgId: `MS${String(mpNv.messages.length + 1).padStart(6, '0')}`,
    itemId: it.itemId,
    ownerId: me.ownerId,
    from: me.name,
    content,
    at: MP_NOW
  }
  mpNv.messages.unshift(row)
  return { msgId: row.msgId, itemId: row.itemId, at: row.at }
})

on('POST', '/mp/neighbor/items/{itemId}/offline', (ctx) => {
  const me = mpOf(ctx)
  const it = neighborItems.find(x => x.itemId === String(ctx.params.itemId))
  if (!it) throw notFound('闲置不存在')
  if (it.ownerId !== me.ownerId) throw forbidden('只能下架自己发布的')
  it.status = '已下架'
  it.offlineAt = MP_NOW
  return it
})

on('POST', '/mp/neighbor/items/{itemId}/renew', (ctx) => {
  const me = mpOf(ctx)
  const it = neighborItems.find(x => x.itemId === String(ctx.params.itemId))
  if (!it) throw notFound('闲置不存在')
  if (it.ownerId !== me.ownerId) throw forbidden('只能续挂自己发布的')
  if (!['已下架', '已过期', '已驳回'].includes(it.status)) {
    throw new ApiError(409, 40991, `当前状态「${it.status}」不需要续挂`)
  }
  /* 内容没改也要再审：挂了三个月的帖子，图片和描述可能早就不合当前规矩了 */
  it.status = '待审核'
  it.renewAt = MP_NOW
  it.rejectReason = ''
  return it
})

/* ---------------- 公共列表：公告 / 投票 / 活动 / 闲置 ---------------- */
/*
 * 一次返回**全部可见**，频道切换在客户端做（tab / 分类 / 排序）。
 * 每点一次 tab 打一个请求，等于把"切频道"变成网络操作 ——
 * 业主端这四个列表加起来不到 150 条，没必要。
 */

on('GET', '/mp/neighbor/notices', (ctx) => {
  const me = mpOf(ctx)
  const q = ctx.query || {}
  const type = q.type ? String(q.type) : '全部'
  const communityId = q.communityId ? String(q.communityId) : ''
  const reads = mpNvGet(mpNv.reads, me.ownerId, () => new Map())
  const rows = mpNvNotices(me)
    .filter(n => !communityId || n.communityId === communityId)
    .filter(n => type === '全部' || n.type === type)
    .map(n => mpNvNoticeView(me, n))
    .sort((a, b) => (a.top === b.top
      ? String(b.publishTime).localeCompare(String(a.publishTime))
      : (a.top ? -1 : 1)))
  return {
    rows,
    total: rows.length,
    /* 未读数按**全部可见公告**算，不跟筛选走 —— 否则切到「停水停电」未读就变 0 */
    unread: mpNvNotices(me).filter(n => !reads.has(n.noticeId)).length
  }
})

on('GET', '/mp/neighbor/notices/{noticeId}', (ctx) => {
  const me = mpOf(ctx)
  const n = notices.find(x => x.noticeId === String(ctx.params.noticeId) && x.status === '已发布')
  /* 草稿 / 待审核 / 已撤回一律 404：不是"权限不够"，是这条对业主不存在 */
  if (!n) throw notFound('公告不存在或已撤回')
  if (!mpNvInScope(me, n.communityId)) throw forbidden('该公告不在您所在项目')
  return mpNvNoticeView(me, n)
})

on('GET', '/mp/neighbor/votes', (ctx) => {
  const me = mpOf(ctx)
  const q = ctx.query || {}
  const status = q.status ? String(q.status) : ''
  const rows = neighborVotes
    .filter(v => v.status !== '草稿')
    .filter(v => mpNvInScope(me, v.communityId))
    .filter(v => !status || v.status === status)
    .map(v => mpNvVoteView(me, v))
    /* 进行中在前，同状态按开始日倒序 —— 业主进来是看"现在能投什么" */
    .sort((a, b) => (a.status === b.status
      ? String(b.startAt).localeCompare(String(a.startAt))
      : (a.status === '进行中' ? -1 : 1)))
  return { rows, total: rows.length }
})

on('GET', '/mp/neighbor/votes/{voteId}', (ctx) => {
  const me = mpOf(ctx)
  const v = neighborVotes.find(x => x.surveyId === String(ctx.params.voteId))
  if (!v || v.status === '草稿') throw notFound('投票不存在')
  if (!mpNvInScope(me, v.communityId)) throw forbidden('该投票不在您所在项目')
  return mpNvVoteView(me, v)
})

on('GET', '/mp/neighbor/activities', (ctx) => {
  const me = mpOf(ctx)
  const rows = neighborActivities
    .filter(a => a.status !== '草稿')
    .filter(a => mpNvInScope(me, a.communityId))
    .map(a => mpNvActView(me, a))
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
  return { rows, total: rows.length }
})

on('GET', '/mp/neighbor/activities/{activityId}', (ctx) => {
  const me = mpOf(ctx)
  const a = neighborActivities.find(x => x.activityId === String(ctx.params.activityId))
  if (!a || a.status === '草稿') throw notFound('活动不存在')
  if (!mpNvInScope(me, a.communityId)) throw forbidden('该活动不在您所在项目')
  return mpNvActView(me, a)
})

on('GET', '/mp/neighbor/items', (ctx) => {
  const me = mpOf(ctx)
  const q = ctx.query || {}
  const cat = q.cat ? String(q.cat) : ''
  const rows = neighborItems
    /* 待审核 / 已驳回 / 已下架 / 已过期 都不该被邻居看到 */
    .filter(i => i.status === MP_NV_ITEM_ON)
    .filter(i => mpNvInScope(me, i.communityId))
    .filter(i => !cat || cat === '全部' || i.category === cat)
    .map(i => mpNvItemView(me, i))
    .sort((a, b) => String(b.publishAt).localeCompare(String(a.publishAt)))
  return {
    rows,
    total: rows.length,
    /* 分类从**已有内容**扫出来，只适合筛选；发布表单的分类写死在前端 */
    categories: [...new Set(rows.map(r => r.category))]
  }
})

on('GET', '/mp/neighbor/items/{itemId}', (ctx) => {
  const me = mpOf(ctx)
  const it = neighborItems.find(x => x.itemId === String(ctx.params.itemId))
  if (!it) throw notFound('闲置不存在')
  const mine = !!it.ownerId && it.ownerId === me.ownerId
  /* 自己的待审 / 已驳回自己能看（要知道为什么没过）；别人的非上架内容当不存在 */
  if (it.status !== MP_NV_ITEM_ON && !mine) throw notFound('闲置不存在或已下架')
  if (!mine && !mpNvInScope(me, it.communityId)) throw forbidden('该内容不在您所在项目')
  return mpNvItemView(me, it)
})

/* ---------------- 业主视角的挂牌投影 ---------------- */
const MP_LS_ACTIVE = ['待审核', '已发布']
const lsUnitOf = (h) => {
  const m = /(\d+单元)/.exec(String(h.fullName || ''))
  return m ? m[1] : ''
}

/**
 * 与后台 `lsRow` 分开写，因为两边的边界不一样：
 * 这里有房号（是我自己的房），没有 `ownerId` / `ownerPhone` / 楼管手机号 ——
 * 业主不需要知道自己的档案号，更不需要知道楼管的号码。
 */
function mpLsRow(l) {
  const h = HOUSE.get(l.houseId) || {}
  return {
    listingId: l.listingId,
    houseId: l.houseId,
    communityId: h.communityId || '',
    communityName: lsCommunityName(h.communityId),
    buildingName: lsBuildingOf(h),
    unitName: lsUnitOf(h),
    room: h.room || '',
    houseShort: h.shortName || '',
    houseType: h.houseType || '',
    area: h.area || 0,
    orientation: h.orientation || '',
    floor: h.floor || 0,
    contentType: l.type,
    price: l.price,
    deposit: l.deposit,
    payTerm: l.payTerm,
    decorate: l.decorate,
    facilities: [...(l.facilities || [])],
    availableFrom: l.availableFrom,
    desc: l.desc || '',
    images: l.images || 0,
    status: l.status,
    /* 驳回理由原样返回：业主拿着概括来问，管家还得再查一遍 */
    rejectReason: l.rejectReason || '',
    offlineReason: l.offlineReason || '',
    offlineAt: l.offlineAt || '',
    auditAt: l.auditAt || '',
    createdAt: l.createdAt || '',
    expireAt: l.expireAt || '',
    daysLeft: l.expireAt ? gapDays(l.expireAt) : 0,
    viewCount: l.viewCount || 0,
    leadCount: listingViewings.filter(v => v.listingId === l.listingId).length,
    contentVersion: l.contentVersion || 1,
    auditedVersion: l.auditedVersion || 0,
    /* 能力位由服务端算，不让前端按状态自己推 —— 推出来的按钮灰了却说不清为什么 */
    canOffline: MP_LS_ACTIVE.includes(l.status),
    canRenew: ['已驳回', '已下架', '已过期'].includes(l.status),
    canDeal: l.status === '已发布'
  }
}

/** 非本人的挂牌一律 404：403 等于告诉探测者"这条存在但不是你的" */
const mpLsOf = (id, ownerId) => {
  const l = lsOf(id)
  if (!l || l.ownerId !== ownerId) throw notFound('挂牌不存在')
  return l
}

const mpLsInput = (body = {}) => {
  const type = body.type === '出售' ? '出售' : '出租'
  const price = Number(body.price)
  if (!Number.isFinite(price) || price < 500) throw invalid('挂牌价请填 500 元以上（明显异常的价格也会被驳回）')
  if (price > 100000) throw invalid('挂牌价超出合理范围')
  return {
    type,
    price,
    deposit: Number(body.deposit) || price,
    payTerm: String(body.payTerm || '押一付三'),
    decorate: String(body.decorate || '简装'),
    facilities: Array.isArray(body.facilities) ? body.facilities.slice(0, 12).map(String) : [],
    availableFrom: String(body.availableFrom || NV_TODAY).slice(0, 10),
    desc: String(body.desc || '').slice(0, 300),
    images: Math.min(9, Math.max(0, Number(body.images) || 0))
  }
}

on('GET', '/mp/listings', (ctx) => {
  const me = mpOf(ctx)
  const list = listings
    .filter(l => l.ownerId === me.ownerId)
    .filter(l => eq(l.status, ctx.query.status))
    .map(mpLsRow)
    .sort((a, b) => String(b.listingId).localeCompare(String(a.listingId)))
  return { rows: list, total: list.length }
})

on('POST', '/mp/listings', (ctx) => {
  const me = mpOf(ctx)
  const body = ctx.body || {}
  /* 发布要 L2（已实名）：挂牌会把"这套房是谁的"公开出去，
     只凭一个手机号就挂房，会被拿来做虚假房源 */
  if (!me.realname) throw invalid('请先完成实名认证再发布（姓名 + 证件后四位）')
  const houseId = String(body.houseId || '')
  const h = HOUSE.get(houseId)
  if (!h) throw invalid('房屋不存在')
  /* 产权校验：家属在 bindings 里也有记录，靠"有没有绑定"判断会把家属放进来 */
  if (h.ownerId !== me.ownerId) throw new ApiError(403, 40390, '这套房不在您的名下，无法发布（租客能住不能转租）')
  if (h.usage !== '住宅') throw invalid('车位 / 商铺不能挂牌出租')
  const active = listings.find(l => l.houseId === houseId && MP_LS_ACTIVE.includes(l.status))
  if (active) throw new ApiError(409, 40990, `该房已有「${active.status}」的挂牌，请先下架或直接编辑`)
  const input = mpLsInput(body)
  const row = {
    listingId: nvNextId(listings, 'listingId', 'LS'),
    houseId,
    ownerId: me.ownerId,
    publisherUserId: me.ownerId,
    stewardEmpId: h.stewardEmpId || '',
    ...input,
    status: '待审核',
    contentVersion: 1,
    /* 审核针对"内容版本"：0 表示还没审过任何版本，续挂时据此判免审 */
    auditedVersion: 0,
    createdAt: nowText(),
    expireAt: addDays(NV_TODAY, 60),
    dealAt: '', auditBy: '', auditAt: '', rejectReason: '',
    offlineBy: '', offlineAt: '', offlineReason: '',
    viewCount: 0
  }
  listings.push(row)
  return mpLsRow(row)
})

on('GET', '/mp/listings/{listingId}', (ctx) => {
  const me = mpOf(ctx)
  return mpLsRow(mpLsOf(ctx.params.listingId, me.ownerId))
})

on('PATCH', '/mp/listings/{listingId}', (ctx) => {
  const me = mpOf(ctx)
  const l = mpLsOf(ctx.params.listingId, me.ownerId)
  if (l.status === '已成交') throw new ApiError(409, 40991, '已成交的挂牌不能修改')
  const body = ctx.body || {}
  /* 换房等于换一条挂牌，改类型等于换一个业务流程 */
  if (body.houseId && body.houseId !== l.houseId) throw invalid('不能换房；换一套房请重新发布')
  if (body.type && body.type !== l.type) throw invalid('不能改出租 / 出售类型；请重新发布')
  Object.assign(l, mpLsInput({ ...body, type: l.type, price: body.price ?? l.price }), {
    /* 改内容 = 换了一份要审核的东西 */
    contentVersion: (l.contentVersion || 1) + 1,
    status: '待审核',
    auditBy: '', auditAt: '', rejectReason: ''
  })
  return mpLsRow(l)
})

on('POST', '/mp/listings/{listingId}/offline', (ctx) => {
  const me = mpOf(ctx)
  const l = mpLsOf(ctx.params.listingId, me.ownerId)
  if (l.status === '已成交') throw new ApiError(409, 40992, '已成交的挂牌不能下架')
  if (l.status === '已下架') throw new ApiError(409, 40992, '这条挂牌已经下架了')
  Object.assign(l, {
    status: '已下架',
    offlineBy: me.name,
    offlineAt: nowText(),
    /* 业主自己下架不需要理由；硬要理由的结果是有人填"1" */
    offlineReason: String(ctx.body?.reason || '')
  })
  return mpLsRow(l)
})

on('POST', '/mp/listings/{listingId}/renew', (ctx) => {
  const me = mpOf(ctx)
  const l = mpLsOf(ctx.params.listingId, me.ownerId)
  if (MP_LS_ACTIVE.includes(l.status)) {
    throw new ApiError(409, 40993, `这条挂牌是「${l.status}」，不需要续挂`)
  }
  const same = (l.contentVersion || 1) === (l.auditedVersion || 0)
  /* 已驳回又没改内容：原样再挂一次必然再驳一次 */
  if (l.status === '已驳回' && !same) {
    throw new ApiError(409, 40993, `请先按驳回理由修改内容：${l.rejectReason || '（未填理由）'}`)
  }
  Object.assign(l, {
    /* 内容没改过 → 直接上架，不再送审；挂了 60 天没人问，续一下再审是纯浪费 */
    status: same ? '已发布' : '待审核',
    expireAt: addDays(NV_TODAY, 60),
    offlineBy: '', offlineAt: '', offlineReason: ''
  })
  return mpLsRow(l)
})

on('POST', '/mp/listings/{listingId}/deal', (ctx) => {
  const me = mpOf(ctx)
  const l = mpLsOf(ctx.params.listingId, me.ownerId)
  if (l.status !== '已发布') throw new ApiError(409, 40994, `「${l.status}」的挂牌不能标记成交`)
  /* 只改状态，不收成交价、不收佣金：一记就变成房地产经纪 */
  Object.assign(l, { status: '已成交', dealAt: nowText() })
  return mpLsRow(l)
})

/* ------------------------------ 员工端（mobile） ------------------------------ */
/*
 * 这一段的接口在契约里早写好了（第 42 批），假服务一直没实现，白名单 `KNOWN_GAP` 挂了 22 条。
 * 现在补上，原则与其它域一致：**语义要真**，别做成"改个字段就返回 200"。
 *
 * 三处最容易写错、也最容易在联调时被掩盖的地方：
 *   ① 打卡的"降级"是正式能力 —— 拿不到定位必须记「人工打卡 + 待复核」，
 *      静默算正常打卡等于把这道防线取消；
 *   ② 工单状态机是单向的：待派单 → 已派单 → 处理中 → 已完工，跳步必拒；
 *   ③ 提成只按**人工费**计提，材料费是成本；并且「在途」要单独返回。
 */
const inspectTemplates = readJson('fixtures/inspect-templates.json')
const inspectPlans = readJson('fixtures/inspect-plans.json')
const PLAN_BY_ID = new Map(inspectPlans.map(p => [p.planId, p]))
const attendances = readJson('fixtures/attendance.json')
const houseMembers = readJson('fixtures/members.json')
/* 增项价目与工单收费项目是两份：`serviceItems` 是下单用的服务项目，
   `repair-prices.addons` 是现场加项价目，`projects` 是项目参数（含弃单上限） */
const repairPriceBook = readJson('fixtures/repair-prices.json')
const addonPrices = repairPriceBook.addons || []
const projectParams = repairPriceBook.projects || []

const MT_PERM = {
  inspView: 'f.inspect.view',
  inspExec: 'f.inspect.exec',
  woView: 'f.workorders.view',
  woEdit: 'f.workorders.edit',
  woDispatch: 'f.workorders.dispatch',
  attSelf: 'c.attendance.self',
  payrollSelf: 'c.payroll.self',
  stewardView: 'a.stewards.view',
  ownersView: 'a.owners.view',
  approvalHandle: 'f.approval.handle',
  metersView: 'b.meters.view',
  metersRead: 'b.meters.read'
}

/*
 * 提成比例：来自项目参数 `repairPrices.projects[].commissionRate`。
 *
 * 契约 fixture 原来没有这一项，所以这里硬编码了 35 —— 于是 P02（32%）与 P03（30%）
 * 的提成一直按 35% 算，多算了。fixture 已补齐（0.35 / 0.32 / 0.30），改成按单取。
 * **只按人工费计提** —— 材料费是成本，按总额提成等于把成本分给个人。
 */
const COMMISSION_RATE_PCT_DEFAULT = 35
const projOf = communityId => projectParams.find(p => p.communityId === communityId) || null
/** 返回**百分比**（35），不是小数 —— 契约对外一直用百分比，前端也照这个显示 */
const commissionPctOf = communityId => {
  const r = projOf(communityId)?.commissionRate
  return Number.isFinite(r) ? Math.round(r * 100) : COMMISSION_RATE_PCT_DEFAULT
}

/** 单套房的欠费：催收跟进里要看的是"这户欠多少"，不是"这个业主名下总共欠多少" */
const houseDebt = houseId => r2(bills
  .filter(b => b.houseId === houseId && ['未缴', '部分缴', '逾期'].includes(b.status))
  .reduce((s, b) => s + (b.unpaid || 0), 0))

/** 受理时限到期时间：建单时间 + slaHours 小时（格式与 fixtures 一致：YYYY-MM-DD HH:mm） */
function slaDueOf(createTime, hours) {
  const d = new Date(String(createTime).replace(/-/g, '/'))
  d.setHours(d.getHours() + Number(hours || 24))
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const woOf = id => workOrders.find(w => w.woId === id) || null
const taskOf = id => inspectTasks.find(t => t.taskId === id) || null
const templateOf = id => inspectTemplates.find(t => t.templateId === id) || null

/** 工单状态机：只允许这些「从 → 到」，跳步一律 409 */
const WO_FLOW = {
  accept: { from: ['待派单', '已派单'], to: '处理中' },
  arrive: { from: ['处理中'], to: '处理中' },
  finish: { from: ['处理中'], to: '已完工' },
  abandon: { from: ['处理中'], to: '待派单' }
}
function woGuard(w, action, label) {
  const f = WO_FLOW[action]
  if (!f.from.includes(w.status)) {
    throw new ApiError(409, 40930, `「${w.status}」的工单不能${label}（要先${f.from.join(' 或 ')}）`)
  }
}

/* ---------- 巡检：执行页聚合 + 打卡 ---------- */

on('GET', '/mobile/tasks/{taskId}/exec', (ctx) => {
  requirePerm(ctx.user, MT_PERM.inspView, `缺少权限位 ${MT_PERM.inspView}：无权查看巡检任务`)
  const t = taskOf(ctx.params.taskId)
  if (!t) throw notFound('巡检任务不存在')
  if (!inScopeCommunity(ctx.user, t.communityId)) throw forbidden('这条任务不在你的数据范围内')

  const tpl = templateOf(t.templateId)
  /* 责任员工候选只对监督任务有意义：被检班组的在职员工，排除组长本人 */
  const workers = isSupervise(t)
    ? employees
      .filter(e => e.status !== '离职' && e.orgId === t.executorOrgId && e.name !== t.executor)
      .map(e => ({ name: e.name, label: `${e.name} · ${e.position}` }))
    : []
  /*
   * plan 与 community 是详情页要的（「来源计划 · 周期」「项目名 + 地址」），
   * 执行页只要 communityName。三者一起给，是为了让一屏一请求成立 ——
   * 详情页不必为了两个字段再打两次接口（PC 侧就是查三次）。
   *
   * 缺失时给 **null** 而不是空对象：详情页写的是 `p ? ... : '—'`，
   * 空对象会渲染成「— · undefined」。
   */
  const plan = t.planId ? PLAN_BY_ID.get(t.planId) || null : null
  const c = communities.find(x => x.communityId === t.communityId) || null
  return {
    task: inspectRow(t),
    template: tpl
      ? { ...tpl, fields: tpl.fields.map(f => ({ ...f })) }
      /* 模板缺失时给 null 而不是空对象：执行页据此报"模板已下线"，不是一个没有检查项的空表 */
      : null,
    plan: plan ? { planId: plan.planId, name: plan.name, cycle: plan.cycle, post: plan.post } : null,
    community: c ? { communityId: c.communityId, name: c.name, address: c.address } : null,
    communityName: communityNameOf(t.communityId),
    workers
  }
})

on('POST', '/mobile/tasks/{taskId}/checkin', (ctx) => {
  requirePerm(ctx.user, MT_PERM.inspExec, `缺少权限位 ${MT_PERM.inspExec}：无权执行巡检任务`)
  const t = taskOf(ctx.params.taskId)
  if (!t) throw notFound('巡检任务不存在')
  if (!inScopeCommunity(ctx.user, t.communityId)) throw forbidden('这条任务不在你的数据范围内')
  if (t.status === '已完成') throw new ApiError(409, 40931, '任务已完成，不能再打卡')
  if (t.status === '执行中') throw new ApiError(409, 40931, '任务已经在执行中，重复打卡没有意义')

  const body = ctx.body || {}
  const type = String(body.type || '')
  if (!['GPS围栏', 'NFC', '扫码', '人工打卡'].includes(type)) {
    throw invalid(`打卡方式只能是 GPS围栏 / NFC / 扫码 / 人工打卡，收到「${type}」`)
  }
  /* 降级是正式能力：拿不到定位就记人工打卡 + 待复核，并且必须写原因 */
  const manual = !!body.manual || type === '人工打卡'
  const reason = String(body.reason || '').trim()
  if (manual && !reason) throw invalid('人工打卡要写原因 —— 复核的人得知道为什么没定位')

  Object.assign(t, {
    status: '执行中',
    checkedIn: true,
    checkinType: manual ? '人工打卡' : type,
    checkinAt: nowText(),
    needReview: manual,
    checkinReason: reason,
    checkinGps: String(body.gps || ''),
    checkinAccuracy: body.accuracy === undefined ? null : Number(body.accuracy)
  })
  bumpVer('task', t.taskId)
  return inspectRow(t)
})

/* ---------- 巡检异常转工单 ---------- */

on('POST', '/inspect-tasks/{taskId}/work-orders', (ctx) => {
  requirePerm(ctx.user, MT_PERM.inspExec, `缺少权限位 ${MT_PERM.inspExec}：无权从巡检转单`)
  requirePerm(ctx.user, MT_PERM.woEdit, `缺少权限位 ${MT_PERM.woEdit}：无权建工单`)
  const t = taskOf(ctx.params.taskId)
  if (!t) throw notFound('巡检任务不存在')
  const p = ctx.body || {}
  for (const k of ['itemLabel', 'type', 'priority', 'title', 'description']) {
    if (!String(p[k] || '').trim()) throw invalid(`${k} 必填`)
  }
  if (!['公共区域维修', '报事', '投诉建议', '其他'].includes(p.type)) {
    throw invalid('转单类型只能是 公共区域维修 / 报事 / 投诉建议 / 其他')
  }
  if (!['特急', '紧急', '普通'].includes(p.priority)) throw invalid('紧急度只能是 特急 / 紧急 / 普通')

  const seq = workOrders.length + 1
  const wo = {
    woId: 'WO' + String(seq).padStart(6, '0'),
    woNo: 'BX2026' + String(seq).padStart(5, '0'),
    communityId: t.communityId,
    houseId: '', houseName: '',
    ownerId: '', ownerName: '',
    type: p.type,
    category: String(p.reason || '').trim() || '巡检发现',
    /* source 不由客户端指定：固定「巡检转单」，详情页靠它回连 */
    source: '巡检转单',
    priority: p.priority,
    status: '待派单',
    title: String(p.title).trim(),
    description: `${String(p.description).trim()}（来源：${t.taskId} · ${p.itemLabel}）`,
    dispatchMode: '待派单',
    assignee: '',
    createTime: nowText(),
    acceptTime: '', arriveTime: '', finishTime: '',
    /* SLA 到期时间在建单时算死：移动端只显示倒计时，不自己算（算错就是"还剩 2 小时"其实早超了） */
    feeType: '免费',
    payStatus: '无需支付',
    score: 0,
    isPublic: p.type === '公共区域维修',
    slaHours: p.priority === '特急' ? 4 : (p.priority === '紧急' ? 8 : 24),
    materialFee: 0, laborFee: 0, totalFee: 0, serviceCost: 0,
    priceCode: '', serviceName: '',
    place: String(p.place || '').trim() || `${t.post}责任区 · 巡检点位`,
    photos: Number(p.photos) || 0,
    refTaskId: t.taskId,
    addons: [], paidAmount: 0, _ver: 1
  }
  wo.slaDueAt = slaDueOf(wo.createTime, wo.slaHours)
  wo.slaUsedHours = 0
  wo.slaBreached = false
  workOrders.unshift(wo)
  /* 只回写 refWoId，**不改任务状态** —— 任务还得提交执行结果，否则完成率与异常数漏统计 */
  t.refWoId = wo.woId
  bumpVer('task', t.taskId)
  resetSvcCache()
  return woRow(wo)
})

/* ---------- 工单流转 ---------- */

on('POST', '/work-orders/{woId}/claim', (ctx) => {
  requirePerm(ctx.user, MT_PERM.woEdit, `缺少权限位 ${MT_PERM.woEdit}：无权抢单`)
  const w = woOf(ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  if (!inScopeCommunity(ctx.user, w.communityId)) throw forbidden('这张工单不在你的数据范围内')
  /* 抢单池只有商业服务单：公共区域维修是本职工作量，不参与抢单与提成 */
  if (w.type !== '商业服务') {
    throw new ApiError(409, 40936, `「${w.type}」不参与抢单 —— 抢单池只收商业服务单`)
  }
  if (!['待派单', '已派单'].includes(w.status)) {
    throw new ApiError(409, 40930, `「${w.status}」的工单不能抢`)
  }
  if (w.assignee && w.assignee !== ctx.user.name) {
    throw new ApiError(409, 40931, `这单已派给「${w.assignee}」，不能抢`)
  }
  Object.assign(w, {
    status: '处理中',
    assignee: ctx.user.name,
    dispatchMode: '抢单',
    acceptTime: nowText()
  })
  bumpVer('wo', w.woId)
  return woRow(w)
})

on('POST', '/work-orders/{woId}/dispatch', (ctx) => {
  requirePerm(ctx.user, MT_PERM.woDispatch, `缺少权限位 ${MT_PERM.woDispatch}：无权派单`)
  const w = woOf(ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  if (!inScopeCommunity(ctx.user, w.communityId)) throw forbidden('这张工单不在你的数据范围内')
  const to = String(ctx.body?.to || '').trim()
  if (!to) throw invalid('要指定处理人')
  const emp = employees.find(e => e.name === to && e.status !== '离职')
  if (!emp) throw invalid(`「${to}」不在在职员工名册里`)
  if (!['待派单', '已派单'].includes(w.status)) {
    throw new ApiError(409, 40930, `「${w.status}」的工单不能再派`)
  }
  Object.assign(w, {
    status: '已派单',
    assignee: to,
    dispatchMode: '人工派单',
    acceptTime: '',
    remark: [w.remark, ctx.body?.note].filter(Boolean).join(' | ')
  })
  bumpVer('wo', w.woId)
  return woRow(w)
})

on('POST', '/work-orders/{woId}/accept', (ctx) => {
  requirePerm(ctx.user, MT_PERM.woEdit, `缺少权限位 ${MT_PERM.woEdit}：无权接单`)
  const w = woOf(ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  if (!inScopeCommunity(ctx.user, w.communityId)) throw forbidden('这张工单不在你的数据范围内')
  woGuard(w, 'accept', '接')
  /* 已派给别人的单不能接：除非有派单权（主管可以代接） */
  if (w.assignee && w.assignee !== ctx.user.name && !hasPerm(ctx.user, MT_PERM.woDispatch)) {
    throw new ApiError(409, 40931, `这单已派给「${w.assignee}」，你接不了`)
  }
  Object.assign(w, { status: '处理中', assignee: ctx.user.name, acceptTime: nowText() })
  bumpVer('wo', w.woId)
  return woRow(w)
})

on('POST', '/work-orders/{woId}/transfer', (ctx) => {
  requirePerm(ctx.user, MT_PERM.woEdit, `缺少权限位 ${MT_PERM.woEdit}：无权转单`)
  const w = woOf(ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  const to = String(ctx.body?.to || '').trim()
  if (!to) throw invalid('要指定转给谁')
  if (!employees.some(e => e.name === to && e.status !== '离职')) throw invalid(`「${to}」不在在职员工名册里`)
  if (to === w.assignee) throw invalid('转给当前处理人没有意义')
  if (!['待派单', '已派单', '处理中'].includes(w.status)) {
    throw new ApiError(409, 40930, `「${w.status}」的工单不能转单`)
  }
  /* 转单只换人、不推进节点：回到「已派单」等对方接，acceptTime 清空 */
  Object.assign(w, {
    status: '已派单',
    assignee: to,
    acceptTime: '',
    remark: [w.remark, `转给${to}${ctx.body?.note ? '：' + ctx.body.note : ''}`].filter(Boolean).join(' | ')
  })
  bumpVer('wo', w.woId)
  return woRow(w)
})

on('POST', '/work-orders/{woId}/arrive', (ctx) => {
  requirePerm(ctx.user, MT_PERM.woEdit, `缺少权限位 ${MT_PERM.woEdit}：无权到场打卡`)
  const w = woOf(ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  woGuard(w, 'arrive', '到场')
  if (w.arriveTime) throw new ApiError(409, 40931, '已经打过到场卡了')
  w.arriveTime = nowText()
  bumpVer('wo', w.woId)
  return woRow(w)
})

on('POST', '/work-orders/{woId}/finish', (ctx) => {
  requirePerm(ctx.user, MT_PERM.woEdit, `缺少权限位 ${MT_PERM.woEdit}：无权完工`)
  const w = woOf(ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  woGuard(w, 'finish', '完工')
  const remark = String(ctx.body?.remark || '').trim()
  /* 处理结果业主看得到，不写等于让业主自己猜修没修好 */
  if (!remark) throw invalid('处理结果必填 —— 业主看得到这一句')
  /* 未确认的增项不能完工：否则结算金额与业主认可的金额不一致 */
  const unconfirmed = (w.addons || []).filter(a => !a.confirmed)
  if (unconfirmed.length) {
    throw new ApiError(409, 40933, `有 ${unconfirmed.length} 条增项还没经业主确认，先确认再完工`)
  }
  Object.assign(w, {
    status: '已完工',
    finishTime: nowText(),
    remark,
    photos: ctx.body?.photos === undefined ? (w.photos || 0) : Number(ctx.body.photos)
  })
  if (ctx.body?.arrivedAt && !w.arriveTime) w.arriveTime = ctx.body.arrivedAt
  bumpVer('wo', w.woId)
  return woRow(w)
})

on('POST', '/work-orders/{woId}/staff-eval', (ctx) => {
  requirePerm(ctx.user, MT_PERM.woEdit, `缺少权限位 ${MT_PERM.woEdit}：无权评价`)
  const w = woOf(ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  const score = Number(ctx.body?.score)
  if (!Number.isInteger(score) || score < 1 || score > 5) throw invalid('评分是 1–5 的整数')
  if (!['已完工', '已评价'].includes(w.status)) {
    throw new ApiError(409, 40930, `「${w.status}」的工单还不能评价（先完工）`)
  }
  if (w.status === '已评价') throw new ApiError(409, 40934, '这张单已经评价过了')
  Object.assign(w, {
    status: '已评价',
    score,
    staffEvalTags: Array.isArray(ctx.body?.tags) ? ctx.body.tags : [],
    staffEvalNote: String(ctx.body?.note || '').trim()
  })
  bumpVer('wo', w.woId)
  return woRow(w)
})

on('POST', '/work-orders/{woId}/abandon', (ctx) => {
  requirePerm(ctx.user, MT_PERM.woEdit, `缺少权限位 ${MT_PERM.woEdit}：无权弃单`)
  const w = woOf(ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  woGuard(w, 'abandon', '弃单')
  /* 每日弃单上限来自**项目参数**（每个项目一条）；超了必须走主管改派，不能自己丢掉 */
  const limit = Number((projectParams.find(p => p.communityId === w.communityId) || {}).abandonLimit) || 3
  const used = workOrders.filter(x => x.abandonedBy === ctx.user.name && x.abandonAt
    && String(x.abandonAt).slice(0, 10) === DATA_DATE).length
  if (used >= limit) throw new ApiError(409, 40932, `今天已弃单 ${used} 次，达到上限 ${limit}，请联系主管改派`)
  Object.assign(w, {
    status: '待派单',
    assignee: '',
    acceptTime: '',
    abandonedBy: ctx.user.name,
    abandonAt: nowText(),
    abandonReason: String(ctx.body?.reason || '').trim()
  })
  bumpVer('wo', w.woId)
  return { ...woRow(w), used: used + 1, limit }
})

on('POST', '/work-orders/{woId}/addons', (ctx) => {
  requirePerm(ctx.user, MT_PERM.woEdit, `缺少权限位 ${MT_PERM.woEdit}：无权加项`)
  const w = woOf(ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  const code = String(ctx.body?.code || '').trim()
  if (!code) throw invalid('要选增项编码')
  const item = serviceItems.find(s => s.code === code) || addonPrices.find(r => r.code === code)
  if (!item) throw notFound(`增项「${code}」不在价目表里`)
  if (!w.acceptTime) throw new ApiError(409, 40933, '还没接单，不能加项')
  if (!w.arriveTime) throw new ApiError(409, 40933, '还没到场，不能加项 —— 增项必须是现场发现的问题')
  if (!['处理中'].includes(w.status)) {
    throw new ApiError(409, 40930, `「${w.status}」的工单不能再加项`)
  }
  const qty = Math.max(1, Number(ctx.body?.qty) || 1)
  const addon = {
    code: item.code,
    name: item.name,
    qty,
    material: r2((item.material || 0) * qty),
    labor: r2((item.labor || 0) * qty),
    total: r2(((item.material || 0) + (item.labor || 0)) * qty),
    at: nowText(),
    by: ctx.user.name,
    confirmed: false
  }
  w.addons = [...(w.addons || []), addon]
  bumpVer('wo', w.woId)
  resetSvcCache()
  return woRow(w)
})

on('POST', '/work-orders/{woId}/addons/confirm', (ctx) => {
  /* 业主端的确认接口；员工端只用「当面确认」，所以在 confirmedBy 里标来源 */
  const w = woOf(ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  const list = w.addons || []
  if (!list.length) throw new ApiError(409, 40935, '这张单没有增项')
  const code = String(ctx.body?.code || '').trim()
  const hit = code ? list.filter(a => a.code === code) : list
  if (code && !hit.length) throw notFound(`没有编码为「${code}」的增项`)
  const pending = hit.filter(a => !a.confirmed)
  if (!pending.length) throw new ApiError(409, 40935, '这些增项已经确认过了')
  pending.forEach(a => {
    a.confirmed = true
    a.confirmedAt = nowText()
    a.confirmedBy = String(ctx.body?.confirmedBy || '').trim() || ctx.user.name
  })
  bumpVer('wo', w.woId)
  resetSvcCache()
  return woRow(w)
})

/* ---------- 收款（移动端只出收款码，不经手现金） ---------- */

on('POST', '/work-orders/{woId}/payment-qr', (ctx) => {
  requirePerm(ctx.user, MT_PERM.woEdit, `缺少权限位 ${MT_PERM.woEdit}：无权生成收款码`)
  const w = woOf(ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  if (w.feeType !== '收费') throw new ApiError(422, 42207, '免费工单没有收款码')
  if (w.payStatus === '已支付') throw new ApiError(409, 40937, '这张单已经付过了')
  const amount = r2(Number(w.totalFee || 0) + (w.addons || []).reduce((s, a) => s + (a.total || 0), 0))
  if (amount <= 0) throw new ApiError(422, 42207, '金额为 0，不能生成收款码')
  return {
    woId: w.woId,
    amount,
    /* 原型不接支付网关：二维码内容是一个可读的凭据串，前端只负责展示 */
    qrUrl: `pay://wy/${w.woNo}?amount=${amount}`,
    expireAt: `${DATA_DATE} 23:59`,
    channels: ['微信支付', '支付宝']
  }
})

on('POST', '/work-orders/{woId}/payments', (ctx) => {
  requirePerm(ctx.user, MT_PERM.woEdit, `缺少权限位 ${MT_PERM.woEdit}：无权登记收款`)
  const w = woOf(ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  const amount = Number(ctx.body?.amount)
  if (!(amount > 0)) throw invalid('金额必须大于 0')
  const method = String(ctx.body?.method || '')
  if (!['微信支付', '支付宝', 'POS刷卡', '现金', '挂账'].includes(method)) {
    throw invalid('收款方式只能是 微信支付 / 支付宝 / POS刷卡 / 现金 / 挂账')
  }
  if (method === '挂账' && !String(ctx.body?.reason || '').trim()) {
    throw invalid('挂账必须写原因 —— 否则这笔钱永远挂在账上没人追')
  }
  /*
   * 应收只算**已确认**的增项（与详情、提成同一个式子）。
   * 原来这里含全部增项 —— 业主没点头的那笔也能收，现场必吵架。
   */
  const due = woDueOf(w)
  const paid = r2((w.paidAmount || 0) + amount)
  if (paid > due) throw invalid(`收款 ${amount} 超过应收 ${r2(due - (w.paidAmount || 0))}`)
  w.paidAmount = paid
  w.payStatus = paid >= due ? '已支付' : (method === '挂账' ? '已挂账' : '未支付')
  /*
   * 记流水。原来只累加 `paidAmount`，员工端"本次收了几笔、谁收的"无从查起 ——
   * 而移动端的收款是**现场动作**，事后对账全靠这张表。
   */
  if (!Array.isArray(w.payments)) w.payments = []
  w.payments.push({
    at: nowText(),
    amount,
    method,
    by: ctx.user.name,
    transNo: String(ctx.body?.transNo || ''),
    reason: String(ctx.body?.reason || '').trim()
  })
  w.payMethod = method
  if (ctx.body?.transNo) w.transNo = String(ctx.body.transNo)
  if (method === '挂账') w.hangReason = String(ctx.body.reason).trim()
  bumpVer('wo', w.woId)
  resetSvcCache()
  return woRow(w)
})

/* ---------- 考勤自助 ---------- */

const attOf = id => attendances.find(a => a.attId === id) || null
const myAtt = (u, a) => {
  const me = EMP.get(u.empId)
  if (!me) return false
  return a.empId === me.empId
}

on('POST', '/attendance/{attId}/confirm', (ctx) => {
  requirePerm(ctx.user, MT_PERM.attSelf, `缺少权限位 ${MT_PERM.attSelf}：无权确认考勤`)
  const a = attOf(ctx.params.attId)
  if (!a) throw notFound('考勤记录不存在')
  /* 「本人」是真口径：主管看别人的考勤是另一条链路，不能借这个接口代确认 */
  if (!myAtt(ctx.user, a)) throw forbidden('只能确认本人的考勤')
  if (a.status === '已确认') throw new ApiError(409, 40935, '这个月已经确认过了')
  Object.assign(a, { status: '已确认', confirmAt: nowText(), confirmBy: ctx.user.name })
  return a
})

on('POST', '/attendance/{attId}/appeal', (ctx) => {
  requirePerm(ctx.user, MT_PERM.attSelf, `缺少权限位 ${MT_PERM.attSelf}：无权申诉考勤`)
  const a = attOf(ctx.params.attId)
  if (!a) throw notFound('考勤记录不存在')
  if (!myAtt(ctx.user, a)) throw forbidden('只能申诉本人的考勤')
  const reason = String(ctx.body?.reason || '').trim()
  if (!reason) throw invalid('申诉要写清楚哪一项不对')
  if (reason.length > 120) throw invalid('申诉理由最多 120 字')
  a.appealCount = (a.appealCount || 0) + 1
  a.appealResult = '待处理'
  a.appealReason = reason
  a.appealAt = nowText()
  return { attId: a.attId, appealCount: a.appealCount, appealResult: a.appealResult }
})

/* ---------- 催收跟进（楼管现场记录） ---------- */

const mobileCollections = []

on('POST', '/mobile/collections', (ctx) => {
  requirePerm(ctx.user, MT_PERM.stewardView, `缺少权限位 ${MT_PERM.stewardView}：无权登记催收`)
  const p = ctx.body || {}
  const h = HOUSE.get(String(p.houseId || ''))
  if (!h) throw notFound('房屋不存在')
  if (!inScopeHouse(ctx.user, h.houseId)) throw forbidden('这套房不在你的责任范围内')
  if (!['电话', '上门', '短信', '微信'].includes(p.method)) throw invalid('跟进方式只能是 电话 / 上门 / 短信 / 微信')
  if (!['承诺还款', '家中无人', '拒缴', '已说明情况'].includes(p.result)) {
    throw invalid('跟进结果只能是 承诺还款 / 家中无人 / 拒缴 / 已说明情况')
  }
  const row = {
    id: `CJ${String(mobileCollections.length + 1).padStart(4, '0')}`,
    houseId: h.houseId,
    houseName: h.fullName,
    ownerId: h.ownerId,
    method: p.method,
    result: p.result,
    note: String(p.note || '').trim(),
    nextAt: String(p.nextAt || '').trim(),
    at: nowText(),
    by: ctx.user.name,
    debtAmount: houseDebt(h.houseId)
  }
  mobileCollections.unshift(row)
  return row
})

on('POST', '/mobile/collections/batch', (ctx) => {
  requirePerm(ctx.user, MT_PERM.stewardView, `缺少权限位 ${MT_PERM.stewardView}：无权批量催缴`)
  const ids = ctx.body?.houseIds
  if (!Array.isArray(ids) || !ids.length) throw bad('houseIds 不能为空')
  const method = String(ctx.body?.method || '')
  if (!['短信', '微信', '电话'].includes(method)) throw invalid('批量方式只能是 短信 / 微信 / 电话')
  const ok = []
  const failed = []
  for (const id of [...new Set(ids)]) {
    const h = HOUSE.get(id)
    if (!h) { failed.push({ houseId: id, reason: '房屋不存在' }); continue }
    if (!inScopeHouse(ctx.user, h.houseId)) { failed.push({ houseId: id, reason: '超出责任范围' }); continue }
    const debt = houseDebt(h.houseId)
    if (debt <= 0) { failed.push({ houseId: id, reason: '这套房没有欠费' }); continue }
    mobileCollections.unshift({
      id: `CJ${String(mobileCollections.length + 1).padStart(4, '0')}`,
      houseId: h.houseId, houseName: h.fullName, ownerId: h.ownerId,
      method, result: '已说明情况', note: String(ctx.body?.note || '').trim(),
      nextAt: '', at: nowText(), by: ctx.user.name, debtAmount: r2(debt), batch: true
    })
    ok.push(id)
  }
  const batchNo = `CJ${DATA_DATE.replace(/-/g, '')}-${String(mobileCollections.filter(c => c.batch).length).padStart(2, '0')}`
  return { batchNo, count: ok.length, failed, total: [...new Set(ids)].length }
})

/* ---------- 我的提成 ---------- */

on('GET', '/mobile/commission', (ctx) => {
  requirePerm(ctx.user, MT_PERM.payrollSelf, `缺少权限位 ${MT_PERM.payrollSelf}：无权查看提成`)
  const me = EMP.get(ctx.user.empId)
  const name = me ? me.name : ctx.user.name
  const period = String(ctx.query.period || DATA_DATE.slice(0, 7))
  /* 只有收了钱的单才结提成：完工未收款是「在途」，这一项必须单独返回 */
  const mine = workOrders
    .filter(w => w.assignee === name && w.feeType === '收费')
    .filter(w => ['已完工', '已评价'].includes(w.status))
    .map(w => {
      const labor = r2((w.laborFee || 0) + (w.addons || []).reduce((s, a) => s + (a.labor || 0), 0))
      const pct = commissionPctOf(w.communityId)
      return {
        woId: w.woId,
        woNo: w.woNo,
        category: w.category,
        total: r2((w.totalFee || 0) + (w.addons || []).reduce((s, a) => s + (a.total || 0), 0)),
        labor,
        rate: pct,
        commission: r2(labor * pct / 100),
        settled: w.payStatus === '已支付',
        payStatus: w.payStatus || '未支付'
      }
    })
  const settled = r2(mine.filter(x => x.settled).reduce((s, x) => s + x.commission, 0))
  const pending = r2(mine.filter(x => !x.settled).reduce((s, x) => s + x.commission, 0))
  return {
    settleNo: `TC${period.replace('-', '')}-01`,
    settleDay: '次月 10 日随工资发放',
    period,
    rate: commissionPctOf(mine[0]?.communityId),
    count: mine.length,
    settledCount: mine.filter(x => x.settled).length,
    pendingCount: mine.filter(x => !x.settled).length,
    settled,
    pending,
    rows: mine
  }
})

on('GET', '/mobile/pricing', (ctx) => {
  /* 价目是公开信息（业主端下单也要看），这里**不要**加权限码 —— 加了业主端就查不到价格 */
  return serviceItems.map(s => ({
    code: s.code,
    category: s.category,
    name: s.name,
    trade: s.trade,
    material: s.material,
    labor: s.labor,
    unit: s.unit,
    minutes: s.minutes,
    enabled: !!s.enabled
  }))
})

/* ---------- 房屋住户（业主 + 租户 + 家庭成员） ---------- */

/* ---------- 员工端工单：列表 + 详情聚合 ---------- */

/*
 * 为什么单独两条 `/mobile/*` 而不是直接用 `/work-orders`：
 *   `/work-orders` 是**管理端**视角（全量分页、按项目/状态筛选），
 *   而员工端要的是「按 tab 分组 + 页签计数 + 提成」一次给全 ——
 *   四个 tab 各请求一次不但慢，四次响应之间还可能互相矛盾（抢单池刚少一张、
 *   我的列表还没更新），用户看到"抢了但我的里没有"。
 */

/** 抢单池资格：一线维修岗 + 项目开启 + 商业服务 + 收费 + 待派单未指派 */
function woGrabPool(u) {
  if (!u || u.roleId !== 'R-ENG') return []
  const p = projOf(u.communities?.[0])
  if (p && p.enabled === false) return []
  return workOrders.filter(w =>
    w.communityId === u.communities?.[0] &&
    w.type === '商业服务' &&
    w.feeType === '收费' &&
    w.status === '待派单' &&
    !w.assignee
  )
}

/**
 * 待派池。
 *   - 项目经理：本项目所有待派/已派单（付费单点名派、公区单指派）
 *   - 客服主管：**只有公区单** —— 付费单指派会直接吃掉师傅的提成，
 *     05 的 `canDispatch` 早就这么限了，服务端要跟着限，不能只靠前端按钮灰着。
 */
function woDispatchPool(u) {
  if (!u) return []
  const mine = workOrders.filter(w =>
    w.communityId === u.communities?.[0] && ['待派单', '已派单'].includes(w.status)
  )
  if (u.roleId === 'R-PM') return mine
  if (u.roleId === 'R-SEC') return mine.filter(w => w.type === '公共区域维修')
  return []
}

const woMineOpen = u => workOrders.filter(w =>
  w.assignee === u.name && !['已完工', '已评价', '已关闭', '已取消'].includes(w.status)
)

const woMineDone = u => workOrders.filter(w =>
  w.assignee === u.name && ['已完工', '已评价'].includes(w.status)
)

/**
 * 移动端行：在管理端 `woRow` 之上补三个只有移动端看的字段。
 * 列表卡片上一眼要看到"这单能挣多少"，管理端表格不需要。
 */
function mobileWoRow(w) {
  const addon = woAddonSum(w)
  const labor = r2((Number(w.laborFee) || 0) + addon.labor)
  return {
    ...woRow(w),
    totalWithAddon: r2((Number(w.totalFee) || 0) + addon.total),
    addonCount: addon.count,
    addonPending: addon.pending,
    commission: w.feeType === '收费' ? r2(labor * commissionPctOf(w.communityId) / 100) : 0
  }
}

on('GET', '/mobile/work-orders', (ctx) => {
  requirePerm(ctx.user, MT_PERM.woView, `缺少权限位 ${MT_PERM.woView}：无权查看工单`)
  const u = ctx.user
  const tab = String(ctx.query.tab || 'mine')

  /* 页签与计数一次给全：只列**当前身份真有**的页签（一线没有"待派"） */
  const pools = {
    grab: woGrabPool(u),
    dispatch: woDispatchPool(u),
    mine: woMineOpen(u),
    done: woMineDone(u)
  }
  const LABEL = { grab: '可抢', dispatch: '待派', mine: '我的', done: '已完成' }
  const tabs = ['grab', 'dispatch', 'mine', 'done']
    .filter(k => k === 'mine' || k === 'done' || pools[k].length || k === tab)
    .map(k => ({ key: k, label: LABEL[k], count: pools[k].length }))

  if (!pools[tab]) throw bad(`tab 只能是 grab / dispatch / mine / done，收到「${tab}」`)

  return {
    tabs,
    tab,
    rows: pools[tab].map(mobileWoRow)
  }
})

on('GET', '/mobile/work-orders/{woId}', (ctx) => {
  requirePerm(ctx.user, MT_PERM.woView, `缺少权限位 ${MT_PERM.woView}：无权查看工单`)
  const w = woOf(ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  if (!inScopeCommunity(ctx.user, w.communityId)) throw forbidden('这张工单不在你的数据范围内')

  const addon = woAddonSum(w)
  const done = woAddonSum(w, true)
  const labor = r2((Number(w.laborFee) || 0) + done.labor)
  const dict = w.priceCode ? serviceItems.find(s => s.code === w.priceCode) : null

  return {
    workOrder: mobileWoRow(w),
    price: {
      code: w.priceCode || '',
      name: w.serviceName || (dict ? dict.name : '') || w.category || '',
      material: Number(w.materialFee) || 0,
      labor: Number(w.laborFee) || 0,
      total: Number(w.totalFee) || 0,
      /* 字典当前价：与下单快照不同说明后台调过价，页面要提示"按下单时价格结算" */
      dictPrice: dict ? r2((Number(dict.material) || 0) + (Number(dict.labor) || 0)) : 0
    },
    fee: {
      type: w.feeType,
      material: r2((Number(w.materialFee) || 0) + done.material),
      labor,
      total: woDueOf(w),
      baseTotal: Number(w.totalFee) || 0,
      prepaid: !!w.prepaid,
      payStatus: w.payStatus || '',
      paid: r2(Number(w.paidAmount) || 0),
      due: woDueOf(w),
      payMethod: w.payMethod || '',
      hangReason: w.hangReason || ''
    },
    addons: (w.addons || []).map(a => ({ ...a })),
    pays: (w.payments || []).map(x => ({ ...x })),
    addonSum: addon,
    commission: w.feeType === '收费' ? r2(labor * commissionPctOf(w.communityId) / 100) : 0,
    /* 已收款才结提成：完工未收款算在途，这一项前端要分开显示 */
    settled: w.payStatus === '已支付',
    ownerEval: w.score ? { score: w.score, tags: [...(w.evalTags || [])], text: w.evaluate || '' } : null,
    staffEval: w.staffEval || null,
    timeline: [
      { at: w.createTime, action: '创建', by: w.ownerName || '业主', memo: w.source || '' },
      w.acceptTime ? { at: w.acceptTime, action: '接单', by: w.assignee || '', memo: '' } : null,
      w.arriveTime ? { at: w.arriveTime, action: '到场', by: w.assignee || '', memo: '' } : null,
      w.finishTime ? { at: w.finishTime, action: '完工', by: w.assignee || '', memo: w.remark || '' } : null
    ].filter(Boolean)
  }
})

/**
 * 房屋详情（移动端聚合）。
 *
 * 为什么聚合：这一屏要「房屋 + 业主 + 最近账单 + 欠费 + 同住人 + 租户」六样东西，
 * 拆成四个接口的话 —— `/bills` 又**没有 houseId 过滤**（只有 buildingId / unitId / kw），
 * 前端拿不到"这套房最近六张账"。为了一个字段加一条筛选参数，不如直接给一个聚合读。
 *
 * 业主手机号给**明文**：这一屏的存在意义就是楼管照着拨过去，
 * 掩码在这里没有意义（列表页才是该脱敏的地方）。
 */
on('GET', '/mobile/houses/{houseId}', (ctx) => {
  requirePerm(ctx.user, MT_PERM.ownersView, `缺少权限位 ${MT_PERM.ownersView}：无权查看房屋`)
  const h = HOUSE.get(ctx.params.houseId)
  if (!h) throw notFound('房屋不存在')
  if (!inScopeHouse(ctx.user, h.houseId)) throw forbidden('这套房不在你的数据范围内')

  const owner = h.ownerId ? OWNER.get(h.ownerId) : null
  const bd = buildings.find(x => x.buildingId === h.buildingId) || {}

  const list = bills
    .filter(b => b.houseId === h.houseId)
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))
  const debtBills = list.filter(b =>
    !['已作废', '已减免'].includes(b.status) && BILL_DEBT.includes(b.status) && (Number(b.unpaid) || 0) > 0
  )
  const debt = r2(debtBills.reduce((s2, b) => s2 + (Number(b.unpaid) || 0), 0))

  const tenantsOfHouse = tenants
    .filter(t => t.houseId === h.houseId && t.status !== '已搬离')
    .map(t => ({
      tenantId: t.tenantId,
      name: t.name,
      phone: maskPhone(t.phone),
      relation: t.relation || '',
      leaseStart: t.leaseStart,
      leaseEnd: t.leaseEnd,
      residents: Number(t.residents) || 0,
      verifyStatus: t.verifyStatus,
      certified: !!t.certified,
      faceRegistered: !!t.faceRegistered,
      source: t.source || ''
    }))
  const membersOfHouse = houseMembers
    .filter(m => m.ownerId === h.ownerId && m.liveTogether !== false)
    .map(m => ({
      memberId: m.memberId,
      name: m.name,
      relation: m.relation,
      phone: maskPhone(m.phone),
      certified: !!m.certified,
      faceRegistered: !!m.faceRegistered,
      appUser: !!m.appUser
    }))

  return {
    house: {
      ...h,
      buildingName: bd.name || '',
      unitName: h.unitId ? `${String(h.unitId).slice(-1)} 单元` : ''
    },
    owner: owner ? ownerRow(owner, { mask: false }) : null,
    bills: list.slice(0, 6).map(b => ({
      billId: b.billId,
      period: b.period,
      itemName: b.itemName,
      payable: Number(b.payable) || 0,
      unpaid: Number(b.unpaid) || 0,
      status: b.status,
      dueDate: b.dueDate,
      overdueDays: Number(b.overdueDays) || 0
    })),
    debt,
    debtCount: debtBills.length,
    tenants: tenantsOfHouse,
    members: membersOfHouse
  }
})

/* ---------------- 抄表（移动端） ---------------- */

/* 与 PC 的 `METER_CAP` 同一套值：水表 99999 / 电表 999999 */
const METER_CAP = { 水表: 99999, 电表: 999999 }
/* 与 PC 的 `saveReading()` 同一套异常阈值：电表 330 度、水表 24 吨 */
const METER_ABNORMAL_LIMIT = { 水表: 24, 电表: 330 }

const meterRowOf = r => {
  const h = HOUSE.get(r.houseId)
  return {
    readingId: r.readingId,
    meterNo: r.meterNo,
    type: r.type,
    unit: r.unit,
    period: r.period,
    communityId: r.communityId,
    houseId: r.houseId,
    houseName: r.houseName,
    buildingId: h ? h.buildingId : '',
    buildingName: h ? ((buildings.find(b => b.buildingId === h.buildingId) || {}).name || '') : '',
    ownerName: r.ownerName,
    lastReading: r.lastReading,
    /* 「待录入」不下发本期读数：清单上不该出现一个"看起来已经抄过"的数字 */
    currentReading: r.status === '待录入' ? null : r.currentReading,
    usage: r.status === '待录入' ? null : r.usage,
    readDate: r.readDate,
    reader: r.reader,
    status: r.status,
    abnormal: r.abnormal
  }
}

/**
 * 待抄清单。
 *
 * 范围按**责任房屋**收敛（楼管只看到自己管的那几栋），这是与 PC 最大的不同 ——
 * 后台是管理员视角，抄全项目；端上是现场视角，只抄自己的。
 */
on('GET', '/mobile/meters', (ctx) => {
  requirePerm(ctx.user, MT_PERM.metersView, `缺少权限位 ${MT_PERM.metersView}：无权查看抄表任务`)
  const q = ctx.query || {}

  /*
   * 已计费的默认不返回：端上关心的是"还要不要抄"，推单出账是后台的事。
   * 只有显式要 `status=已计费` 时才给 —— 那也是做对账，不是抄表。
   */
  const base = meterReadings
    .filter(r => inScopeHouse(ctx.user, r.houseId))
    .filter(r => (q.status === '已计费' ? r.status === '已计费' : r.status !== '已计费'))
  const rows = base
    .filter(r => !q.communityId || r.communityId === q.communityId)
    .filter(r => !q.status || r.status === q.status)
    .filter(r => !q.period || r.period === q.period)
    .filter(r => {
      if (!q.buildingId) return true
      const h = HOUSE.get(r.houseId)
      return h && h.buildingId === q.buildingId
    })
    .map(meterRowOf)
    .sort((a, b) =>
      String(a.buildingName).localeCompare(String(b.buildingName), 'zh') ||
      String(a.houseName).localeCompare(String(b.houseName), 'zh') ||
      String(a.type).localeCompare(String(b.type), 'zh'))

  /* 汇总永远按"这个人的全部待办"算，不随筛选跳动 —— 切到某一栋时数字变来变去会让人以为抄漏了 */
  const pending = base.filter(r => r.status === '待录入').length
  const done = base.filter(r => r.status === '待复核').length
  const abnormal = base.filter(r => r.status === '待复核' && r.abnormal).length

  return {
    rows,
    summary: {
      period: (base[0] || {}).period || '',
      pending,
      done,
      abnormal,
      total: pending + done
    }
  }
})

/**
 * 录一户读数。
 *
 * 三条校验**照抄 PC 的 `saveReading()`**，一条都不重写：
 *   ① 不得小于上期读数（这是硬约束，不是提示）
 *   ② 不得超过表类型量程
 *   ③ 用量超阈值只标异常，**不拦提交**
 *
 * 第三条尤其重要：拦住提交的后果是师傅改数字凑合规 —— 数字好看了，漏水的问题被埋了。
 * 让它进「待复核」，由后台判断。
 */
on('POST', '/mobile/meters/{readingId}/reading', (ctx) => {
  requirePerm(ctx.user, MT_PERM.metersRead, `缺少权限位 ${MT_PERM.metersRead}：无权录入读数`)
  const r = meterReadings.find(x => x.readingId === ctx.params.readingId)
  if (!r) throw notFound('抄表记录不存在')
  if (!inScopeHouse(ctx.user, r.houseId)) throw forbidden('这户不在你的责任范围内')
  if (r.status !== '待录入') {
    throw new ApiError(409, 40970, `这条记录当前是「${r.status}」，不能再录入`)
  }

  const raw = (ctx.body || {}).currentReading
  const cur = Number(raw)
  if (raw === '' || raw === null || raw === undefined || Number.isNaN(cur)) {
    throw invalid('请输入有效的本期读数')
  }
  if (cur < 0) throw invalid('本期读数不能为负数')
  if (cur < r.lastReading) {
    throw invalid(`本期读数不得小于上期读数（${r.lastReading}）`)
  }
  const cap = METER_CAP[r.type] || 99999
  if (cur > cap) {
    throw invalid(`本期读数超出${r.type}量程（上限 ${cap}），请核对后重新录入`)
  }

  r.currentReading = r2(cur)
  r.usage = r2(cur - r.lastReading)
  r.abnormal = r.usage > (METER_ABNORMAL_LIMIT[r.type] || 99999)
  r.status = '待复核'
  r.reader = ctx.user.name
  r.readDate = DATA_DATE

  return {
    readingId: r.readingId,
    usage: r.usage,
    abnormal: r.abnormal,
    status: r.status,
    reader: r.reader,
    readDate: r.readDate,
    /* 异常时把阈值带上，端上直接显示"超过 24 吨"，不用自己再存一份常量 */
    abnormalLimit: r.abnormal ? METER_ABNORMAL_LIMIT[r.type] : 0
  }
})

on('GET', '/mobile/houses/{houseId}/residents', (ctx) => {
  requirePerm(ctx.user, MT_PERM.ownersView, `缺少权限位 ${MT_PERM.ownersView}：无权查看住户`)
  const h = HOUSE.get(ctx.params.houseId)
  if (!h) throw notFound('房屋不存在')
  if (!inScopeHouse(ctx.user, h.houseId)) throw forbidden('这套房不在你的数据范围内')

  const tenantsOfHouse = tenants
    .filter(t => t.houseId === h.houseId && t.status !== '已搬离')
    .map(t => ({
      name: t.name,
      /* 手机号脱敏：这一屏会被投屏，全号摆一屏迟早出事 */
      phone: maskPhone(t.phone),
      relation: t.relation || '',
      leaseStart: t.leaseStart,
      leaseEnd: t.leaseEnd,
      residents: Number(t.residents) || 0,
      verifyStatus: t.verifyStatus,
      certified: !!t.certified,
      faceRegistered: !!t.faceRegistered,
      source: t.source || ''
    }))
  const membersOfHouse = houseMembers
    .filter(m => m.ownerId === h.ownerId && m.liveTogether !== false)
    .map(m => ({
      name: m.name,
      relation: m.relation,
      phone: maskPhone(m.phone),
      certified: !!m.certified,
      faceRegistered: !!m.faceRegistered,
      appUser: !!m.appUser
    }))
  return { houseId: h.houseId, houseName: h.fullName, tenants: tenantsOfHouse, members: membersOfHouse }
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
      /* /auth/* 与 /public/* 不需要令牌，其余都要。
         /public/* 的边界不靠登录态，靠"只回白名单字段"——扫码看资产、看房源的人
         常常既没登录也不是业主。
         /mp/auth/* 也要放行：业主端登录时还没有令牌，拦在这里就永远登不上。 */
      /* 只有**登录**这一步免鉴权：`/mp/auth/realname`、`/bindings*` 都要带会话，
         整个 `/mp/auth/` 前缀放行会让这三个接口拿不到 ctx.mp（全变 401）。 */
      const isPublicPath = u.pathname.startsWith('/auth/')
        || u.pathname.startsWith('/public/')
        || u.pathname === '/mp/auth/wechat-login'
      if (!isPublicPath) {
        /* 业主端与员工端是两条会话通道，token 不能混用：
           业主的 token 里没有角色与数据范围，员工的 token 里没有 ownerId。 */
        if (u.pathname.startsWith('/mp/')) ctx.mp = mpAuth(req)
        else ctx.user = auth(req)
      }
      const data = hit.handler(ctx)
      send(res, ctx.status || 200, data)
    } catch (e) {
      sendErr(res, e instanceof ApiError ? e : new ApiError(500, 50000, e?.message || '服务异常'))
    }
  })
}

/* ================= 租售信息（A 域 · 2026-11-06 第 69 批） =================
 * 只做**信息发布**：业主把房租出去的信息挂出来，责任楼管审一道，想租的人留电话。
 * 物业全程不参与撮合与成交 —— 这条守住它是物业服务；破了它就是房地产经纪，
 * 需要《房地产经纪机构备案表》，微信类目也要换。
 *
 * 四组接口，权限边界写在路径上：
 *   /public/listings/*  游客（免登录）—— 只回公开字段，房号/业主/楼管手机号一律不出
 *   /listings           后台 —— 需 a.listings.view / .audit / .viewing
 *
 * 三条硬口径：
 *   ① 审核人是该房的责任楼管（house.stewardEmpId），超 24h 升直属上级；
 *   ② 楼管手机号不出现在**任何**返回里，包括后台 —— 对外只给姓名、微信号、二维码；
 *   ③ 面积 / 户型 / 朝向 / 楼层从 houses join，不在挂牌表里存副本。
 */
const listings = readJson('fixtures/listings.json')
const listingViewings = readJson('fixtures/listings-viewings.json')

const LS_PERM = { view: 'a.listings.view', audit: 'a.listings.audit', viewing: 'a.listings.viewing' }
const LS_STATUS_TYPE = {
  待审核: 'warning', 已发布: 'success', 已驳回: 'danger',
  已下架: 'info', 已过期: 'info', 已成交: ''
}
const LS_VIEWING_TYPE = { 待联系: 'warning', 已联系: 'success', 已带看: 'success', 已关闭: 'info' }

const LS_COMMUNITY = new Map(communities.map(c => [c.communityId || c.id, c]))
const lsCommunityName = id => (LS_COMMUNITY.get(id) || {}).name || ''
/** 契约只加载了 communities（没有 buildings 表），楼栋从房屋全名的「N栋」取 */
const lsBuildingOf = h => {
  const m = /(\d+栋)/.exec(String(h.fullName || ''))
  return m ? m[1] : ''
}

const lsOf = id => listings.find(l => l.listingId === id) || null
const lsViewOf = id => listingViewings.find(v => v.viewingId === id) || null

/** 距创建过了多少小时（演示时钟 DATA_DATE 10:00 为"现在"） */
function lsHoursSince(at) {
  const t = new Date(String(at || '').replace(/-/g, '/')).getTime()
  if (Number.isNaN(t)) return 0
  const now = new Date(`${DATA_DATE}T10:00:00`).getTime()
  return Math.max(0, Math.round((now - t) / 3600000))
}

/**
 * 挂牌行。`pub = true` 是**对外视图**：只回公开字段。
 * 房号（room）、houseShort、业主姓名电话、楼管手机号**都不在公开视图里** ——
 * 房号线上不给，看房由楼管带过去；给了等于把"这户空着"公示出去。
 */
function lsRow(l, pub = false) {
  const h = houses.find(x => x.houseId === l.houseId) || {}
  const o = owners.find(x => x.ownerId === l.ownerId) || {}
  const e = EMP.get(l.stewardEmpId) || {}
  const hours = lsHoursSince(l.createdAt)
  const pending = l.status === '待审核'
  const base = {
    listingId: l.listingId,
    communityId: h.communityId || '',
    communityName: lsCommunityName(h.communityId),
    buildingName: lsBuildingOf(h),
    houseType: h.houseType || '',
    area: h.area || 0,
    orientation: h.orientation || '',
    floor: h.floor || 0,
    price: l.price,
    deposit: l.deposit,
    payTerm: l.payTerm,
    decorate: l.decorate,
    facilities: [...(l.facilities || [])],
    availableFrom: l.availableFrom,
    desc: l.desc,
    images: l.images || 0,
    status: l.status
  }
  if (pub) {
    return {
      ...base,
      /* 对外只给"谁在管这套房"，不给"这套房在几零几" */
      stewardName: e.name || '',
      stewardWechat: e.wechatId || '',
      stewardQrUrl: e.contactQrUrl || ''
    }
  }
  return {
    ...base,
    statusType: LS_STATUS_TYPE[l.status] || '',
    houseId: l.houseId,
    houseShort: h.shortName || '',
    room: h.room || '',
    ownerId: l.ownerId,
    ownerName: o.name || '',
    /* 列表脱敏、详情给全号 —— 会被投屏的页面不摆全号 */
    ownerPhone: maskPhone(o.phone),
    stewardEmpId: l.stewardEmpId,
    stewardName: e.name || '',
    stewardPosition: e.position || '',
    contentVersion: l.contentVersion,
    auditedVersion: l.auditedVersion,
    needAudit: l.contentVersion !== l.auditedVersion,
    createdAt: l.createdAt,
    hoursWaiting: hours,
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
    leadCount: listingViewings.filter(v => v.listingId === l.listingId).length,
    _ver: verOf('listing', l.listingId)
  }
}

/** 看房请求行。列表脱敏，详情给全号 */
function lsViewRow(v, full = false) {
  const l = lsOf(v.listingId)
  const h = l ? (houses.find(x => x.houseId === l.houseId) || {}) : {}
  const e = l ? (EMP.get(l.stewardEmpId) || {}) : {}
  const hours = lsHoursSince(v.createdAt)
  const pending = v.status === '待联系'
  return {
    viewingId: v.viewingId,
    listingId: v.listingId,
    communityId: h.communityId || '',
    communityName: lsCommunityName(h.communityId),
    buildingName: lsBuildingOf(h),
    houseType: h.houseType || '',
    area: h.area || 0,
    price: l ? l.price : 0,
    name: v.name,
    phone: full ? v.phone : maskPhone(v.phone),
    preferredTime: v.preferredTime,
    note: v.note,
    status: v.status,
    statusType: LS_VIEWING_TYPE[v.status] || '',
    createdAt: v.createdAt,
    hoursWaiting: hours,
    overdue: pending && hours > 24,
    escalated: pending && hours > 48,
    stewardEmpId: l ? l.stewardEmpId : '',
    stewardName: e.name || '',
    handledBy: v.handledBy || '',
    handledAt: v.handledAt || '',
    resultNote: v.resultNote || '',
    _ver: verOf('listingViewing', v.viewingId)
  }
}

/* ---------- 对外（游客，免登录） ---------- */

on('GET', '/public/listings', (ctx) => {
  /* 故意不 requirePerm：想租房的人基本不是本小区业主，登录墙会把客源挡光。
     边界由"只回公开字段"保证，不靠登录态。 */
  const q = ctx.query
  const list = listings
    .filter(l => l.status === '已发布')
    .map(l => lsRow(l, true))
    .filter(r => eq(r.communityId, q.communityId) && eq(r.houseType, q.houseType))
    .filter(r => {
      if (!q.minPrice && !q.maxPrice) return true
      const min = Number(q.minPrice) || 0
      const max = Number(q.maxPrice) || Infinity
      return r.price >= min && r.price <= max
    })
    .filter(r => kwHit([r.communityName, r.houseType, r.desc, r.buildingName], q.kw))
  const sorted = [...list].sort((a, b) => {
    if (q.sort === 'priceAsc') return a.price - b.price
    if (q.sort === 'priceDesc') return b.price - a.price
    return String(b.listingId).localeCompare(String(a.listingId))
  })
  return page(sorted, q)
})

on('GET', '/public/listings/{listingId}', (ctx) => {
  const l = lsOf(ctx.params.listingId)
  if (!l || l.status !== '已发布') throw new ApiError(404, 40470, '该房源已下架或不存在')
  return { ...lsRow(l, true), viewingsCount: 0 }
})

on('POST', '/public/listings/{listingId}/viewing', (ctx) => {
  const l = lsOf(ctx.params.listingId)
  if (!l || l.status !== '已发布') throw new ApiError(404, 40470, '该房源已下架或不存在')
  const body = ctx.body || {}
  const name = String(body.name || '').trim()
  if (!name) throw new ApiError(422, 42270, '请填写称呼')
  const phone = String(body.phone || '').trim()
  if (!/^1\d{10}$/.test(phone)) throw new ApiError(422, 42271, '手机号须为 11 位')
  /* 同一手机号同一房源 24h 内只允许一条：防连点，也防同行刷号码 */
  const dup = listingViewings.find(v =>
    v.listingId === l.listingId && v.phone === phone && lsHoursSince(v.createdAt) < 24)
  if (dup) throw new ApiError(409, 40970, '已收到你的看房请求，楼管会联系你，无需重复提交')
  const seq = listingViewings.length + 1
  const v = {
    viewingId: `VW${String(seq).padStart(5, '0')}`,
    listingId: l.listingId,
    name,
    phone,
    preferredTime: String(body.preferredTime || '工作日白天'),
    note: String(body.note || '').slice(0, 100),
    status: '待联系',
    createdAt: `${DATA_DATE} 10:00`,
    handledBy: '',
    handledAt: '',
    resultNote: ''
  }
  listingViewings.push(v)
  return {
    ...lsViewRow(v),
    /* 这句是承诺，前端必须原样显示 —— 不展示电话之后，访客唯一的出路就是等 */
    promise: '楼管会在 24 小时内联系你',
    privacy: '该号码仅提供给本房责任楼管，用于本次看房联系；90 天后自动删除'
  }
})

/* ---------- 后台 ---------- */

/*
 * 我的对外联系方式：**必须注册在 `/listings/{listingId}` 之前**。
 * 路由表是「按注册顺序取第一个匹配」，晚注册的话 GET 会被当成 listingId='my-contact'，
 * 报「挂牌不存在」——`/listings/stats` 排在前面也是同一个原因。
 */
const myContactOf = empId => {
  const e = EMP.get(empId) || {}
  return {
    empId: e.empId || '',
    name: e.name || '',
    position: e.position || '',
    wechatId: e.wechatId || '',
    contactQrUrl: e.contactQrUrl || ''
  }
}

on('GET', '/listings/my-contact', (ctx) => {
  const empId = String(ctx.query.empId || ctx.user.empId)
  if (empId !== ctx.user.empId && !hasPerm(ctx.user, 'e.org.edit')) {
    throw forbidden('只能查看自己的联系方式')
  }
  return myContactOf(empId)
})

on('PATCH', '/listings/my-contact', (ctx) => {
  const body = ctx.body || {}
  const empId = String(body.empId || ctx.user.empId)
  /* 本人自助不需要权限码；改他人是 HR 的活 */
  if (empId !== ctx.user.empId && !hasPerm(ctx.user, 'e.org.edit')) {
    throw forbidden('只能维护自己的联系方式')
  }
  const e = EMP.get(empId)
  if (!e) throw notFound('员工不存在')
  const wx = String(body.wechatId || '').trim()
  if (wx.length > 30) throw invalid('微信号最多 30 个字符')
  e.wechatId = wx
  e.contactQrUrl = String(body.contactQrUrl || '').trim()
  return myContactOf(empId)
})

on('GET', '/listings/stats', (ctx) => {
  requirePerm(ctx.user, LS_PERM.view, `缺少权限位 ${LS_PERM.view}：无权查看租售信息`)
  const rows = listings.map(l => lsRow(l)).filter(r => inScopeCommunity(ctx.user, r.communityId))
  const pending = rows.filter(r => r.status === '待审核')
  const views = listingViewings.map(v => lsViewRow(v))
  return {
    total: rows.length,
    pending: pending.length,
    escalated: pending.filter(r => r.overdue).length,
    published: rows.filter(r => r.status === '已发布').length,
    rejected: rows.filter(r => r.status === '已驳回').length,
    offline: rows.filter(r => r.status === '已下架').length,
    expired: rows.filter(r => r.status === '已过期').length,
    dealt: rows.filter(r => r.status === '已成交').length,
    viewingPending: views.filter(v => v.status === '待联系').length,
    viewingOverdue: views.filter(v => v.status === '待联系' && v.overdue).length,
    viewTotal: rows.reduce((s, r) => s + r.viewCount, 0)
  }
})

on('GET', '/listings/viewings/stats', (ctx) => {
  requirePerm(ctx.user, LS_PERM.viewing, `缺少权限位 ${LS_PERM.viewing}：无权查看看房请求`)
  const rows = listingViewings.map(v => lsViewRow(v))
  return {
    total: rows.length,
    pending: rows.filter(r => r.status === '待联系').length,
    overdue: rows.filter(r => r.status === '待联系' && r.overdue).length,
    contacted: rows.filter(r => r.status === '已联系').length,
    visited: rows.filter(r => r.status === '已带看').length,
    closed: rows.filter(r => r.status === '已关闭').length
  }
})

on('GET', '/listings/viewings', (ctx) => {
  requirePerm(ctx.user, LS_PERM.viewing, `缺少权限位 ${LS_PERM.viewing}：无权查看看房请求`)
  const q = ctx.query
  const list = listingViewings
    .map(v => lsViewRow(v))
    .filter(r => inScopeCommunity(ctx.user, r.communityId))
    .filter(r => eq(r.status, q.status) && eq(r.listingId, q.listingId))
    .filter(r => kwHit([r.viewingId, r.name, r.phone, r.buildingName], q.kw))
    .sort((a, b) => {
      if ((a.status === '待联系') !== (b.status === '待联系')) return a.status === '待联系' ? -1 : 1
      return String(a.createdAt).localeCompare(String(b.createdAt))
    })
  const rows = q.overdue ? list.filter(r => r.overdue) : list
  return page(rows, q)
})

on('GET', '/listings/viewings/{viewingId}', (ctx) => {
  requirePerm(ctx.user, LS_PERM.viewing, `缺少权限位 ${LS_PERM.viewing}：无权查看看房请求`)
  const v = lsViewOf(ctx.params.viewingId)
  if (!v) throw new ApiError(404, 40471, '看房请求不存在')
  /* 详情给全号：楼管要打这个电话 */
  return lsViewRow(v, true)
})

/**
 * 标记看房请求已联系 / 已关闭。
 *
 * 只能从「待联系」转出：重复标记会把 handledAt 覆盖成最后一次，
 * 时间线就查不出"到底是谁第一次联系上的"。
 * 结果必填 —— 下一个人接手时要能知道上次聊到哪，否同一个访客会被三个人各打一遍。
 */
on('POST', '/listings/viewings/{viewingId}/contact', (ctx) => {
  requirePerm(ctx.user, LS_PERM.viewing, `缺少权限位 ${LS_PERM.viewing}：无权处理看房请求`)
  const v = lsViewOf(ctx.params.viewingId)
  if (!v) throw new ApiError(404, 40471, '看房请求不存在')
  if (v.status !== '待联系') {
    throw new ApiError(409, 40942, `这条已经是「${v.status}」，不用再标记`)
  }
  const body = ctx.body || {}
  const status = String(body.status || '已联系')
  if (!['已联系', '已关闭'].includes(status)) throw invalid('只能标成「已联系」或「已关闭」')
  const note = String(body.note || '').trim()
  if (!note) throw invalid('要写一句联系结果 —— 下个人接手时得知道聊到哪了')
  Object.assign(v, {
    status,
    handledBy: String(body.operator || '').trim() || ctx.user.name,
    handledAt: nowText(),
    resultNote: note
  })
  bumpVer('listingViewing', v.viewingId)
  return lsViewRow(v, true)
})

on('GET', '/listings', (ctx) => {
  requirePerm(ctx.user, LS_PERM.view, `缺少权限位 ${LS_PERM.view}：无权查看租售信息`)
  assertInScope(ctx.user, ctx.query)
  const q = ctx.query
  const list = listings
    .map(l => lsRow(l))
    .filter(r => inScopeCommunity(ctx.user, r.communityId) && inScopeHouse(ctx.user, r.houseId))
    .filter(r => eq(r.communityId, q.communityId) && eq(r.status, q.status) && eq(r.stewardEmpId, q.stewardEmpId))
    .filter(r => kwHit([r.listingId, r.houseShort, r.ownerName], q.kw))
    .sort((a, b) => {
      if ((a.status === '待审核') !== (b.status === '待审核')) return a.status === '待审核' ? -1 : 1
      if (a.status === '待审核') return String(a.createdAt).localeCompare(String(b.createdAt))
      return String(b.createdAt).localeCompare(String(a.createdAt))
    })
  const rows = q.overdue ? list.filter(r => r.overdue) : list
  return page(rows, q)
})

on('GET', '/listings/{listingId}', (ctx) => {
  requirePerm(ctx.user, LS_PERM.view, `缺少权限位 ${LS_PERM.view}：无权查看租售信息`)
  const l = lsOf(ctx.params.listingId)
  if (!l) throw new ApiError(404, 40470, '挂牌不存在')
  if (!inScopeHouse(ctx.user, l.houseId)) throw forbidden('这条挂牌不在你的数据范围内')
  const row = lsRow(l)
  const o = owners.find(x => x.ownerId === l.ownerId) || {}
  /* 详情是操作场景（审核要看、楼管要打给业主），这里给全号 */
  return {
    ...row,
    ownerPhone: o.phone || '',
    viewings: listingViewings.filter(v => v.listingId === l.listingId).map(v => lsViewRow(v))
  }
})

on('POST', '/listings/{listingId}/audit', (ctx) => {
  requirePerm(ctx.user, LS_PERM.audit, `缺少权限位 ${LS_PERM.audit}：无权审核租售信息`)
  const l = lsOf(ctx.params.listingId)
  if (!l) throw new ApiError(404, 40470, '挂牌不存在')
  if (!inScopeHouse(ctx.user, l.houseId)) throw forbidden('这条挂牌不在你的数据范围内')
  if (l.status !== '待审核') throw new ApiError(409, 40971, `这条已经是「${l.status}」，不能重复审核`)
  const pass = ctx.body?.pass !== false
  const reason = String(ctx.body?.reason || '').trim()
  if (!pass && !reason) throw new ApiError(422, 42272, '驳回必须写理由 —— 业主看得到这句')
  l.status = pass ? '已发布' : '已驳回'
  l.rejectReason = pass ? '' : reason
  if (pass) l.auditedVersion = l.contentVersion
  l.auditBy = ctx.user.name
  l.auditAt = `${DATA_DATE} 10:00`
  bumpVer('listing', l.listingId)
  return lsRow(l)
})

on('POST', '/listings/{listingId}/offline', (ctx) => {
  requirePerm(ctx.user, LS_PERM.audit, `缺少权限位 ${LS_PERM.audit}：无权下架租售信息`)
  const l = lsOf(ctx.params.listingId)
  if (!l) throw new ApiError(404, 40470, '挂牌不存在')
  if (l.status !== '已发布') throw new ApiError(409, 40972, `只有「已发布」的挂牌能下架，当前是「${l.status}」`)
  const reason = String(ctx.body?.reason || '').trim()
  if (!reason) throw new ApiError(422, 42273, '下架必须写原因')
  l.status = '已下架'
  l.offlineReason = reason
  l.offlineBy = ctx.user.name
  l.offlineAt = `${DATA_DATE} 10:00`
  bumpVer('listing', l.listingId)
  return lsRow(l)
})

on('PATCH', '/listings/{listingId}/steward', (ctx) => {
  requirePerm(ctx.user, LS_PERM.audit, `缺少权限位 ${LS_PERM.audit}：无权改派责任楼管`)
  const l = lsOf(ctx.params.listingId)
  if (!l) throw new ApiError(404, 40470, '挂牌不存在')
  const empId = String(ctx.body?.empId || '')
  const e = EMP.get(empId)
  if (!e || e.status === '离职') throw new ApiError(422, 42274, '该员工不存在或已离职')
  /* 改的是房源的责任楼管，不是单条请求 —— 审核权与联系方式都挂在这一个人身上 */
  l.stewardEmpId = empId
  bumpVer('listing', l.listingId)
  return lsRow(l)
})

/** 已注册的路由清单（`GET /neighbor/votes` 这种形态），供契约与实现的一致性守卫使用 */
export const routeKeys = () => routes.map(r => `${r.method} ${r.pattern}`)

/* ============================================================
 * 后台侧收尾接口（2026-11-11）
 *   ① 系统参数       GET /system/params · PATCH /system/params/{key}
 *   ② 车位换绑记录   GET/POST /parkings/{parkId}/changes · POST .../changes/reset
 *   ③ 人脸核验       GET /access/faces · GET /access/faces/stats · POST /access/faces/{faceId}/audit
 *
 * 这三组此前**契约里一条都没有**：03 的页面全跑内存态，业主端却已经能
 * 提交人脸（/mp/access/faces）、能自助换绑（/mp/parkings/{id}/plate）。
 * 提交了没有接口受理，正是 H4 当初要解决的毛病 —— 这里把受理侧补上。
 * ============================================================ */

const systemParams = readJson('fixtures/system-params.json')
const tenantFaceRows = readJson('fixtures/access-faces-tenants.json')

/** 后台视图里所有能审的人脸：业主/家属（批次 83）+ 租客（H5） */
const bgAllFaces = () => faces.concat(tenantFaceRows)

const bgNow = () => `${DATA_DATE} 10:00`
const bgHoursSince = at => {
  const t = Date.parse(String(at || '').replace(/-/g, '/'))
  const now = Date.parse(bgNow().replace(/-/g, '/'))
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 3600000)) : 0
}
/*
 * 到秒，不是到分：同一分钟内连续办两笔换绑（客服边打电话边改）在分粒度上时间戳相同，
 * 排序就退回成"谁先插入谁在前"，看上去像记录乱序。契约测试也会因此偶发失败。
 */
const bgClock = () => {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/* ---------------- ① 系统参数 ---------------- */
/*
 * 权限：参数是运维面，03 的 /e/config 目前**没有页面级权限码**，
 * 所以这里只要求登录（401），不编一个 `e.config.*` 出来 ——
 * 编了就要同步 03/02 的 permissions、roles、seed 四处，为两个接口不值当。
 * 真要拆细粒度时，加 `e.config.view/edit` 并把这里换掉即可。
 */
on('GET', '/system/params', (ctx) => {
  const g = ctx.query?.group
  const rows = systemParams.filter(p => eq(p.group, g))
  return { rows: rows.map(p => ({ ...p })) }
})

on('PATCH', '/system/params/{key}', (ctx) => {
  const p = systemParams.find(x => x.key === ctx.params.key)
  if (!p) throw notFound('参数不存在')
  const value = String(ctx.body?.value ?? '').trim()
  if (!value) throw invalid('参数值不得为空')
  p.value = value
  return { ...p }
})

/* ---------------- ② 车位换绑记录 ---------------- */
const PARK_LIMIT_KEY = 'park.plateChangeLimit'
const bgParkLimitOf = () => {
  const n = Number((systemParams.find(p => p.key === PARK_LIMIT_KEY) || {}).value)
  return Number.isFinite(n) && n > 0 ? n : 1
}
const parkMonth = () => String(DATA_DATE).slice(0, 7)

/** 本月已换次数：以「最后一次重置」为界，重置之前的不计入 —— 与 03 的算法保持一致 */
const bgParkMonthCount = parkId => {
  const mine = parkingChangeLogs
    .filter(r => r.parkId === parkId && String(r.at).slice(0, 7) === parkMonth())
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
  const lastReset = [...mine].reverse().find(r => r.source === '物业重置')
  const from = lastReset ? mine.indexOf(lastReset) + 1 : 0
  return mine.slice(from).filter(r => r.source !== '物业重置').length
}
const bgParkRow = parkId => {
  const p = parkings.find(x => x.parkId === parkId)
  if (!p) throw notFound('车位不存在')
  return p
}
const bgParkChangesView = parkId => {
  const p = bgParkRow(parkId)
  const rows = parkingChangeLogs
    .filter(r => r.parkId === parkId)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map(r => ({
      ...r,
      sourceType: r.source === '业主自助' ? 'warning' : (r.source === '物业重置' ? 'info' : ''),
      vendorType: r.vendorStatus === '已同步' ? 'success' : (r.vendorStatus === '失败' ? 'danger' : 'warning')
    }))
  const monthChanges = bgParkMonthCount(parkId)
  const limit = bgParkLimitOf()
  return {
    parking: { parkId: p.parkId, parkNo: p.parkNo, plateNo: p.plateNo || '', bindStatus: p.bindStatus || '' },
    rows,
    monthChanges,
    limit,
    left: Math.max(0, limit - monthChanges)
  }
}
const bgPushParkLog = rec => {
  const seq = parkingChangeLogs.reduce((m, r) => Math.max(m, Number(String(r.logId).replace(/\D/g, '')) || 0), 0) + 1
  const row = {
    logId: 'PL' + String(seq).padStart(5, '0'),
    parkNo: bgParkRow(rec.parkId).parkNo,
    vendorStatus: '待同步',
    at: `${DATA_DATE} ${bgClock()}`,
    ...rec
  }
  parkingChangeLogs.push(row)
  return row
}

on('GET', '/parkings/{parkId}/changes', (ctx) => {
  requirePerm(ctx.user, 'a.vehicles.view', '缺少权限位 a.vehicles.view：无权查看车位换绑记录')
  assertInScope(ctx.user, { communityId: bgParkRow(ctx.params.parkId).communityId })
  return bgParkChangesView(ctx.params.parkId)
})

on('POST', '/parkings/{parkId}/changes', (ctx) => {
  requirePerm(ctx.user, 'a.vehicles.edit', '缺少权限位 a.vehicles.edit：无权办理换绑')
  const p = bgParkRow(ctx.params.parkId)
  assertInScope(ctx.user, { communityId: p.communityId })
  const toPlate = String(ctx.body?.toPlate || '').trim()
  const reason = String(ctx.body?.reason || '').trim()
  if (!toPlate && !p.plateNo) throw invalid('该车位没有车牌，无需解绑')
  if (!reason) throw invalid('换绑必须写原因 —— 出纠纷时要能举证')
  const log = bgPushParkLog({
    parkId: p.parkId,
    fromPlate: p.plateNo || '',
    toPlate,
    source: '物业代操作',
    operatorName: ctx.user?.name || '物业前台',
    reason
  })
  /* 真源只有一个：日志写了，车位本体必须跟着改，否则详情页读完还是老车牌 */
  if (toPlate) {
    p.plateNo = toPlate
    p.bindStatus = '已绑定'
  } else {
    p.plateNo = ''
    p.bindStatus = '未绑定'
  }
  return { ...bgParkChangesView(p.parkId), change: log }
})

on('POST', '/parkings/{parkId}/changes/reset', (ctx) => {
  requirePerm(ctx.user, 'a.vehicles.edit', '缺少权限位 a.vehicles.edit：无权重置换绑次数')
  const p = bgParkRow(ctx.params.parkId)
  assertInScope(ctx.user, { communityId: p.communityId })
  const reason = String(ctx.body?.reason || '').trim()
  if (!reason) throw invalid('重置必须写原因')
  const used = bgParkMonthCount(p.parkId)
  if (!used) throw new ApiError(409, 40941, '本月还没有换绑记录，无需重置')
  bgPushParkLog({
    parkId: p.parkId,
    fromPlate: '',
    toPlate: '',
    source: '物业重置',
    operatorName: ctx.user?.name || '物业前台',
    vendorStatus: '已同步',
    reason: `${reason}（重置前本月 ${used} 次）`
  })
  return bgParkChangesView(p.parkId)
})

/* ---------------- ③ 人脸核验 ---------------- */
const FACE_SUBJECT_LABEL = { 业主: '业主', 家属: '业主', 租客: '租客' }
const bgFaceRow = f => {
  const h = houses.find(x => x.houseId === f.houseId) || {}
  const hours = bgHoursSince(f.submittedAt)
  const subject = FACE_SUBJECT_LABEL[f.subjectType] || '业主'
  return {
    ...f,
    subjectType: subject,
    communityId: h.communityId || '',
    communityName: (communities.find(c => c.communityId === h.communityId) || {}).name || '',
    houseShort: h.shortName || '',
    hoursWaiting: hours,
    overdue: f.status === '待核验' && hours >= 24,
    statusType: f.status === '已生效' ? 'success' : (f.status === '已驳回' ? 'danger' : 'warning'),
    label: subject === '租客'
      ? `租客 · ${f.relation || '承租人'}`
      : (f.relation === '本人' ? '业主本人' : `家庭成员 · ${f.relation}`)
  }
}

on('GET', '/access/faces', (ctx) => {
  requirePerm(ctx.user, 'a.owners.view', '缺少权限位 a.owners.view：无权查看人脸核验队列')
  const q = ctx.query || {}
  const rows = bgAllFaces()
    .map(bgFaceRow)
    .filter(r => inScopeCommunity(ctx.user, r.communityId))
    .filter(r => eq(r.subjectType, q.subjectType) && eq(r.status, q.status))
    .filter(r => kwHit([r.name, r.houseShort, r.relation], q.kw))
    .filter(r => (q.overdue ? r.overdue : true))
    .sort((a, b) => {
      const w = x => (x.status === '待核验' ? 0 : 1)
      return w(a) - w(b) || b.hoursWaiting - a.hoursWaiting
    })
  return page(rows, q)
})

on('GET', '/access/faces/stats', (ctx) => {
  requirePerm(ctx.user, 'a.owners.view', '缺少权限位 a.owners.view：无权查看人脸核验队列')
  const rows = bgAllFaces().map(bgFaceRow).filter(r => inScopeCommunity(ctx.user, r.communityId))
  const pending = rows.filter(r => r.status === '待核验')
  return {
    total: rows.length,
    pending: pending.length,
    pendingOwner: pending.filter(r => r.subjectType === '业主').length,
    pendingTenant: pending.filter(r => r.subjectType === '租客').length,
    overdue: rows.filter(r => r.overdue).length,
    activated: rows.filter(r => r.status === '已生效').length,
    rejected: rows.filter(r => r.status === '已驳回').length
  }
})

on('POST', '/access/faces/{faceId}/audit', (ctx) => {
  requirePerm(ctx.user, 'a.owners.edit', '缺少权限位 a.owners.edit：无权核验人脸')
  const f = bgAllFaces().find(x => x.faceId === ctx.params.faceId)
  if (!f) throw notFound('人脸申请单不存在')
  if (f.status !== '待核验') {
    throw new ApiError(409, 40942, `这条申请已处理（${f.status}），不能重复审核`)
  }
  const pass = ctx.body?.pass === true
  const reason = String(ctx.body?.reason || '').trim()
  if (!pass && !reason) throw invalid('驳回必须写原因 —— 业主端会原样展示给业主')

  f.status = pass ? '已生效' : '已驳回'
  f.auditBy = ctx.user?.name || '物业前台'
  f.auditAt = bgNow()
  f.rejectReason = pass ? '' : reason

  /* 申请单是唯一真相，主体的 faceRegistered 只是它的投影 ——
     所以这里写投影，页面不再自己算 */
  if (pass) {
    if (f.subjectType === '租客') {
      const t = tenants.find(x => x.tenantId === f.tenantId)
      if (t) { t.faceRegistered = true; bumpVer('tenant', t.tenantId) }
    } else if (f.memberId) {
      const m = members.find(x => x.memberId === f.memberId)
      if (m) m.faceRegistered = true
    } else {
      const o = owners.find(x => x.ownerId === f.ownerId)
      if (o) o.faceRegistered = true
    }
  } else {
    /* 驳回不动已有的人脸：重新采集期间原人脸继续有效，
       否则业主会以为自己这会儿刷不了门 */
  }
  return bgFaceRow(f)
})


/* ================= 费用体系（批 1~6，2026-11-13） =================
 * 假服务只实现「能跑通、语义对」的最小面，并且**明确标注它与正式实现的差别**：
 *   · 三率按**账单口径**算（应收 = 账单金额）：fixtures 没有应收矩阵，
 *     硬造一张矩阵会让联调误以为后端已经有了；
 *     正式实现必须回到 openapi.yaml 里写的"应收按面积铺、未收不减到 0"。
 *   · 预缴率 / 清欠额在账单口径下无法区分（账单不带"归属期 > T2"的信息），假服务返回 0 并带说明字段。
 *   · 抄表推单没有读数 fixtures，返回空结构 —— 让前端拿到形状，而不是 404。
 */

/** 手工补录：内存态。**分类白名单**模拟"只有 allowSources 含 manual 的二级分类能进" */
const MANUAL_ENTRIES = []
const MANUAL_CATEGORIES = {
  EXP_OP_TAX: '税金及附加',
  EXP_OP_FEE: '通道手续费',
  EXP_OP_OTHER: '其他运营费用',
  INC_NONOP_COMP: '赔偿收入'
}
const MANUAL_DIRECTION = {
  EXP_OP_TAX: 'expense', EXP_OP_FEE: 'expense', EXP_OP_OTHER: 'expense', INC_NONOP_COMP: 'income'
}
let manualSeq = 0

/** 两个账期之间的月数（含首尾） */
const monthsBetween = (from, to) => {
  const [fy, fm] = String(from).split('-').map(Number)
  const [ty, tm] = String(to).split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm) + 1
}

on('GET', '/reports/three-rate', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const { from, to } = ctx.query
  const itemId = ctx.query.itemId || 'FI01'
  const cid = ctx.query.communityId || ''
  if (!from || !to) throw bad('from / to 必填（YYYY-MM）')
  if (String(from) > String(to)) throw bad('起始账期不能晚于结束账期')

  /* 作废单不进三率（Q1 口径：作废与减免都不进分母）。2026-11-14 之前这里含作废，
     因为当时全站只有 11 张作废单，差几十块钱看不出来；把「模式与账单不符」的 565 张
     水电单作废之后，含作废会让应收凭空多出一大截，与 PC 的矩阵口径对不上。 */
  const list = bills.filter(b => b.itemId === itemId
    && b.status !== '已作废'
    && String(b.period) >= from && String(b.period) <= to
    && (!cid || b.communityId === cid))
  const sum = k => r2(list.reduce((s, b) => s + (Number(b[k]) || 0), 0))
  const receivable = sum('amount')
  const received = sum('paidAmount')
  const waived = sum('discount')
  const unpaid = r2(receivable - received - waived)
  const base = r2(receivable - waived)

  const pm = new Map()
  for (const b of list) {
    const r = pm.get(b.period) || { period: b.period, receivable: 0, received: 0, waived: 0, unpaid: 0 }
    r.receivable = r2(r.receivable + (Number(b.amount) || 0))
    r.received = r2(r.received + (Number(b.paidAmount) || 0))
    r.waived = r2(r.waived + (Number(b.discount) || 0))
    r.unpaid = r2(r.receivable - r.received - r.waived)
    pm.set(b.period, r)
  }

  /* 减免率：分母是应收（不扣减免）—— 与欠费率分开，减免不是"收不到" */
  const waiveRate = receivable > 0 ? Math.round(waived / receivable * 10000) / 100 : 0

  /* 按房屋用途分列：客户线下是「住宅收费率 / 商铺收费率」两列分开看的 */
  const um = new Map()
  for (const b of list) {
    const u = (HOUSE.get(b.houseId) || {}).usage || '未分类'
    const r = um.get(u) || { usage: u, houseSet: new Set(), receivable: 0, received: 0, waived: 0 }
    r.houseSet.add(b.houseId)
    r.receivable = r2(r.receivable + (Number(b.amount) || 0))
    r.received = r2(r.received + (Number(b.paidAmount) || 0))
    r.waived = r2(r.waived + (Number(b.discount) || 0))
    um.set(u, r)
  }
  const byUsage = [...um.values()].map(r => {
    const b2 = r2(r.receivable - r.waived)
    return {
      usage: r.usage,
      houses: r.houseSet.size,
      receivable: r.receivable,
      received: r.received,
      waived: r.waived,
      unpaid: r2(r.receivable - r.received - r.waived),
      collectionRate: b2 > 0 ? Math.round(r.received / b2 * 10000) / 100 : 0,
      waiveRate: r.receivable > 0 ? Math.round(r.waived / r.receivable * 10000) / 100 : 0
    }
  }).sort((a, b2) => b2.receivable - a.receivable)

  /* 本期现金按归属账期三分。**只算本收费项** —— 三率是按 itemId 算的，
     现金扫全表会让"已收"和"现金收入"差出一个车位费 */
  let cashCurrent = 0
  let cashClearing = 0
  let cashPrepaid = 0
  let cashNoPeriod = 0
  for (const p of payments) {
    const mm = String(p.payTime || '').slice(0, 7)
    if (mm < from || mm > to) continue
    if (p.channel === '预存抵扣') continue
    const b = BILL.get(p.billId)
    if (!b || b.itemId !== itemId) continue
    if (cid && b.communityId !== cid) continue
    const amt = Number(p.amount) || 0
    const per = String(b.period || '')
    if (!per) cashNoPeriod += amt
    else if (per < from) cashClearing += amt
    else if (per > to) cashPrepaid += amt
    else cashCurrent += amt
  }
  const cashTotal = r2(cashCurrent + cashClearing + cashPrepaid + cashNoPeriod)

  const houses_ = [...new Set(list.map(b => b.houseId))]
  const top = houses_.map(hid => {
    const rows = list.filter(b => b.houseId === hid)
    const rc = r2(rows.reduce((s, b) => s + (Number(b.amount) || 0), 0))
    const pd = r2(rows.reduce((s, b) => s + (Number(b.paidAmount) || 0), 0))
    const wv = r2(rows.reduce((s, b) => s + (Number(b.discount) || 0), 0))
    return { houseId: hid, houseName: (HOUSE.get(hid) || {}).fullName || hid, receivable: rc, received: pd, waived: wv, unpaid: r2(rc - pd - wv) }
  }).sort((a, b) => b.unpaid - a.unpaid).slice(0, 8)

  return {
    from, to, itemId,
    itemName: (serviceItems.find(i => i.itemId === itemId) || {}).name || '',
    periods: pm.size,
    houses: houses_.length,
    receivable, received, waived, unpaid,
    collectionRate: base > 0 ? Math.round(received / base * 10000) / 100 : 0,
    arrearsRate: base > 0 ? Math.round((1 - received / base) * 10000) / 100 : 0,
    /* 账单口径下拿不到"归属期 > to"的信息；正式实现从应收矩阵出这两个数 */
    prepayRate: 0, prepayReceived: 0, prepayReceivable: 0,
    clearingAmount: 0,
    waiveRate,
    byUsage,
    /* 预存抵扣是「账户余额搬家」，不是新进来的钱；这个值只会出现在历史流水里 */
    cashIncome: cashTotal,
    cashByAttribution: {
      current: r2(cashCurrent), clearing: r2(cashClearing), prepaid: r2(cashPrepaid),
      noPeriod: r2(cashNoPeriod), total: cashTotal,
      ok: Math.abs(r2(cashCurrent + cashClearing + cashPrepaid + cashNoPeriod) - cashTotal) < 0.01
    },
    overpaid: top.filter(x => x.unpaid < 0).length,
    identity: { ok: true, diff: 0 },
    byPeriod: [...pm.values()].sort((a, b) => String(a.period).localeCompare(String(b.period))),
    topDebtors: top
  }
})

/**
 * 收支分项计算（2026-11-14 抽出来）：
 * 原来是 `/reports/income-expense` 的内联逻辑，预算对比也要用同一套实际数 ——
 * 复制一份就是"两张报表同一个科目两个数"的老毛病，所以抽成函数。
 */
function incomeExpenseOf(from, to, cid) {
  const houseComm = new Map(houses.map(h => [h.houseId, h.communityId]))
  const pays = payments.filter(p => {
    const m = String(p.payTime || '').slice(0, 7)
    if (m < from || m > to) return false
    if (p.channel === '预存抵扣' || p.channel === '临时收费') return false
    if (cid && houseComm.get(p.houseId) !== cid) return false
    return true
  })
  const im = new Map()
  for (const p of pays) {
    const b = bills.find(x => x.billId === p.billId)
    const key = b ? b.itemId : 'INC_OTHER_SERVICE'
    const cur = im.get(key) || { code: key, name: b ? b.itemName : '其他业务收入', parentCode: 'INC_MAIN', parentName: '主营业务收入', amount: 0 }
    cur.amount = r2(cur.amount + (Number(p.amount) || 0))
    im.set(key, cur)
  }

  /* 支出：只有合同可摊（fixtures 里没有报销单与工资表），按月摊到区间 */
  const em = new Map()
  const span = monthsBetween(from, to)
  for (const c of contracts) {
    if (cid && c.communityId !== cid) continue
    /* 合同分类改为 6 个一级主项（2026-11-13）：支出侧是 劳动合同 / 运维服务 / 采购协议 */
    if (!['劳动合同', '运维服务', '采购协议'].includes(c.type)) continue
    const total = monthsBetween(c.startDate, c.endDate)
    if (!total) continue
    /* 区间与合同期的重叠月数 */
    const s = String(c.startDate).slice(0, 7)
    const e = String(c.endDate).slice(0, 7)
    const lo = s > from ? s : from
    const hi = e < to ? e : to
    if (lo > hi) continue
    const months = monthsBetween(lo, hi)
    const amount = r2((Number(c.amount) || 0) / total * months)
    const key = c.type === '劳动合同' ? 'EXP_LABOR_OUTSOURCE' : 'EXP_CONTRACT'
    const cur = em.get(key) || {
      code: key, name: key === 'EXP_LABOR_OUTSOURCE' ? '外包人力' : '合同支出',
      parentCode: key === 'EXP_LABOR_OUTSOURCE' ? 'EXP_LABOR' : 'EXP_CONTRACT',
      parentName: key === 'EXP_LABOR_OUTSOURCE' ? '人力成本' : '合同支出', amount: 0
    }
    cur.amount = r2(cur.amount + amount)
    em.set(key, cur)
  }

  const incomeRows = [...im.values()].sort((a, b) => b.amount - a.amount)
  const expenseRows = [...em.values()].sort((a, b) => b.amount - a.amount)
  const incomeTotal = r2(incomeRows.reduce((s, r) => s + r.amount, 0))
  const expenseTotal = r2(expenseRows.reduce((s, r) => s + r.amount, 0))
  const byMonth = []
  for (let i = 0; i < span; i++) {
    const [y, m] = from.split('-').map(Number)
    const d = new Date(y, m - 1 + i, 1)
    const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (p > to) break
    const inc = r2(pays.filter(x => String(x.payTime).slice(0, 7) === p).reduce((s, x) => s + (Number(x.amount) || 0), 0))
    byMonth.push({ period: p, income: inc, expense: 0, balance: inc })
  }


  return {
    from, to, periods: monthsBetween(from, to), incomeRows, expenseRows,
    incomeTotal, expenseTotal, balance: r2(incomeTotal - expenseTotal),
    margin: incomeTotal > 0 ? Math.round((incomeTotal - expenseTotal) / incomeTotal * 10000) / 100 : 0,
    byMonth
  }
}

/* ---------- 公司经营月报（2026-11-15 · 多项目并排） ----------
 * 客户线下月报的第一张表就是这个形状。假服务里按 03 的同一套口径算一遍：
 *   · 收缴率按 itemId（物业费），收支是全科目 —— 两列不是一套数；
 *   · 合计的率**重算**，不是各行相加；
 *   · 不摊管理费用（系统没有分摊能力，不给假数）。
 */
const COMPANY_OVERHEAD = readJson('fixtures/company-overhead.json')
/* 假服务没有费用分类字典，公司级费用的分类名单独给一份 —— 不然页面上显示的是 EXP_OP_OFFICE */
const OH_CAT_NAME = {
  EXP_OP_OFFICE: { name: '办公费用', parentName: '运营费用' },
  EXP_OP_OTHER: { name: '其他运营费用', parentName: '运营费用' },
  EXP_OP_TRAVEL: { name: '差旅费', parentName: '运营费用' },
  EXP_OP_ENTERTAIN: { name: '业务招待', parentName: '运营费用' },
  EXP_OP_TAX: { name: '税金及附加', parentName: '运营费用' }
}

on('GET', '/reports/company', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const { from, to } = ctx.query
  const itemId = ctx.query.itemId || 'FI01'
  if (!from || !to) throw bad('from / to 必填（YYYY-MM）')
  if (String(from) > String(to)) throw bad('开始账期不能晚于结束账期')

  const usageOf = hid => (HOUSE.get(hid) || {}).usage || '未分类'
  const pool = bills.filter(b => b.itemId === itemId && b.status !== '已作废'
    && String(b.period) >= from && String(b.period) <= to)

  const rows = communities.map(c => {
    const cid = c.communityId
    const pl = incomeExpenseOf(from, to, cid)
    const list = pool.filter(b => b.communityId === cid)
    const tot = (arr, k) => r2(arr.reduce((a, b) => a + (Number(b[k]) || 0), 0))

    const rcv = tot(list, 'amount')
    const got = tot(list, 'paidAmount')
    const wv = tot(list, 'discount')
    const base = r2(rcv - wv)

    /* 住宅 + 公寓合并，商业单列 —— 客户只有"住宅 / 商铺"两列 */
    const agg = usages => {
      const hit = list.filter(b => usages.includes(usageOf(b.houseId)))
      return { rcv: tot(hit, 'amount'), got: tot(hit, 'paidAmount'), wv: tot(hit, 'discount') }
    }
    const rateOf = x => (x.rcv - x.wv) > 0 ? Math.round(x.got / (x.rcv - x.wv) * 10000) / 100 : null
    const resi = agg(['住宅', '公寓'])
    const biz = agg(['商业'])

    return {
      communityId: cid, name: c.name, manager: c.manager || '', houses: c.houseCount || 0,
      receivable: rcv, received: got, waived: wv,
      collectionRate: base > 0 ? Math.round(got / base * 10000) / 100 : null,
      houseRate: rateOf(resi), bizRate: rateOf(biz),
      houseReceivable: resi.rcv, houseReceived: resi.got, houseWaived: resi.wv,
      bizReceivable: biz.rcv, bizReceived: biz.got, bizWaived: biz.wv,
      income: pl.incomeTotal, expense: pl.expenseTotal, balance: pl.balance,
      margin: pl.incomeTotal > 0 ? Math.round(pl.balance / pl.incomeTotal * 10000) / 100 : 0,
      hasRate: list.length > 0,
      active: pl.incomeTotal > 0 || pl.expenseTotal > 0
    }
  }).sort((a, b) => b.income - a.income)

  const sum = k => r2(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0))
  const rateOfSum = (rcv, got, wv) => (rcv - wv) > 0 ? Math.round(got / (rcv - wv) * 10000) / 100 : null
  const tIncome = sum('income')
  const tExpense = sum('expense')
  const tBalance = r2(tIncome - tExpense)
  const item = serviceItems.find(i => i.itemId === itemId)

  /* 公司级费用：只汇总、不摊。项目结余 ≠ 公司结余，差的正是这一笔 */
  const months = monthsBetween(from, to)
  const periods = []
  {
    const [yy, mm] = from.split('-').map(Number)
    for (let i = 0; i < months; i++) {
      const dd = new Date(yy, mm - 1 + i, 1)
      periods.push(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`)
    }
  }
  const inRange = new Set(periods)
  const ohAll = COMPANY_OVERHEAD.filter(e => inRange.has(String(e.period).slice(0, 7)))
  const ohPaid = ohAll.filter(e => e.status === '已付款')
  const ohByCat = new Map()
  const ohByPeriod = new Map(periods.map(p => [p, 0]))
  for (const e of ohPaid) {
    const code = e.categoryId || 'EXP_OP_OTHER'
    const nm = OH_CAT_NAME[code] || { name: code, parentName: '' }
    const cur = ohByCat.get(code) || { categoryId: code, name: nm.name, parentName: nm.parentName, amount: 0, count: 0 }
    cur.amount = r2(cur.amount + (Number(e.amount) || 0))
    cur.count += 1
    ohByCat.set(code, cur)
    const p = String(e.period).slice(0, 7)
    ohByPeriod.set(p, r2((ohByPeriod.get(p) || 0) + (Number(e.amount) || 0)))
  }
  const ohTotal = r2([...ohByCat.values()].reduce((a, x) => a + x.amount, 0))
  const overhead = {
    from, to, total: ohTotal, count: ohPaid.length,
    pending: r2(ohAll.filter(e => e.status !== '已付款').reduce((a, e) => a + (Number(e.amount) || 0), 0)),
    byCategory: [...ohByCat.values()].sort((a, b) => b.amount - a.amount),
    byPeriod: periods.map(p => ({ period: p, amount: ohByPeriod.get(p) || 0 })),
    rows: ohPaid.map(e => ({ ...e, amount: r2(e.amount) }))
  }
  const expenseAll = r2(tExpense + ohTotal)
  const balanceAll = r2(tIncome - expenseAll)

  return {
    from, to,
    months: monthsBetween(from, to),
    itemId,
    itemName: item ? item.name : '',
    rows,
    totals: {
      name: '合计', manager: '',
      houses: rows.reduce((a, r) => a + (Number(r.houses) || 0), 0),
      receivable: sum('receivable'), received: sum('received'), waived: sum('waived'),
      collectionRate: rateOfSum(sum('receivable'), sum('received'), sum('waived')),
      houseRate: rateOfSum(sum('houseReceivable'), sum('houseReceived'), sum('houseWaived')),
      bizRate: rateOfSum(sum('bizReceivable'), sum('bizReceived'), sum('bizWaived')),
      income: tIncome, expense: tExpense, balance: tBalance,
      margin: tIncome > 0 ? Math.round(tBalance / tIncome * 10000) / 100 : 0,
      overhead: ohTotal, expenseAll, balanceAll,
      marginAll: tIncome > 0 ? Math.round(balanceAll / tIncome * 10000) / 100 : 0,
      hasRate: true, active: true
    },
    overhead,
    note: '收缴率按「' + (item ? item.name : itemId) + '」算，收入/支出是全部科目；合计的率是重算的，不是各行相加',
    allocated: false
  }
})

const BUDGETS = readJson('fixtures/budgets.json')

on('GET', '/reports/budget-vs-actual', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const { from, to } = ctx.query
  const cid = ctx.query.communityId || ''
  if (!from || !to) throw bad('from / to 必填（YYYY-MM）')
  /* 倒挂要拦：返一张全 0 的表会被当成"这个区间没预算" */
  if (from > to) throw bad('开始账期不能晚于结束账期')

  /* 实际数复用收支分项：同一个函数，不复制计算逻辑 */
  const pl = incomeExpenseOf(from, to, cid)
  const months = monthsBetween(from, to)
  const periods = []
  for (let i = 0; i < months; i++) {
    const [y, m] = from.split('-').map(Number)
    const d = new Date(y, m - 1 + i, 1)
    periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const budgetOf = code => periods.reduce((sum, p) => {
    const y = Number(String(p).slice(0, 4))
    const hit = BUDGETS.find(b => b.categoryCode === code && Number(b.year) === y && (b.communityId || '') === cid)
    return sum + (hit ? Number(hit.monthBudget) || 0 : 0)
  }, 0)

  const build = (rows, direction) => {
    const seen = new Set()
    const out = []
    for (const r of rows) {
      seen.add(r.code)
      const budget = budgetOf(r.code)
      const has = budget > 0
      const rate = has ? Math.round(r.amount / budget * 1000) / 10 : null
      out.push({
        code: r.code, name: r.name, parentName: r.parentName || '', direction,
        budget: has ? budget : null, actual: r.amount,
        diff: has ? r2(r.amount - budget) : null, rate,
        status: !has ? '未编预算'
          : direction === 'income'
            ? (rate >= 100 ? '达成' : rate >= 90 ? '接近' : '欠收')
            : (rate > 100 ? '超支' : rate >= 95 ? '接近' : '正常')
      })
    }
    /* 编了预算但没发生的也要出现 —— 漏一行比空着更容易被忽略 */
    for (const b of BUDGETS) {
      if (seen.has(b.categoryCode)) continue
      if ((b.communityId || '') !== cid) continue
      if (!periods.some(p => Number(String(p).slice(0, 4)) === Number(b.year))) continue
      const budget = budgetOf(b.categoryCode)
      if (!budget) continue
      /* fixture 只有 categoryCode，方向靠 code 前缀判断：INC_ 是收入，其余是支出 */
      const dir = String(b.categoryCode).startsWith('INC_') ? 'income' : 'expense'
      if (dir !== direction) continue
      out.push({
        code: b.categoryCode, name: b.categoryName || b.categoryCode, parentName: '', direction,
        budget, actual: 0, diff: r2(0 - budget), rate: 0,
        status: direction === 'income' ? '欠收' : '正常'
      })
    }
    out.sort((a, b) => (b.budget || 0) - (a.budget || 0))
    const budgetTotal = r2(out.reduce((s2, r) => s2 + (r.budget || 0), 0))
    const actualTotal = r2(out.reduce((s2, r) => s2 + r.actual, 0))
    return {
      rows: out, budgetTotal, actualTotal,
      rate: budgetTotal > 0 ? Math.round(actualTotal / budgetTotal * 1000) / 10 : null,
      diff: budgetTotal > 0 ? r2(actualTotal - budgetTotal) : null,
      overCount: out.filter(r => r.status === '超支').length,
      shortCount: out.filter(r => r.status === '欠收').length,
      unbudgetedCount: out.filter(r => r.status === '未编预算').length,
      unbudgetedAmount: r2(out.filter(r => r.status === '未编预算').reduce((s2, r) => s2 + r.actual, 0))
    }
  }

  return {
    from, to, months, communityId: cid,
    scope: cid ? 'project' : 'group',
    scopeNote: cid
      ? '预算按集团编制，项目维度只比实际；要看执行率请切回「全部项目」'
      : `集团预算，${months} 个月（月度预算 × ${months}）`,
    income: build(pl.incomeRows, 'income'),
    expense: build(pl.expenseRows, 'expense')
  }
})

on('GET', '/reports/income-expense', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const { from, to } = ctx.query
  const cid = ctx.query.communityId || ''
  if (!from || !to) throw bad('from / to 必填（YYYY-MM）')
  const r = incomeExpenseOf(from, to, cid)
  return {
    from: r.from, to: r.to, periods: r.periods,
    incomeTotal: r.incomeTotal, expenseTotal: r.expenseTotal,
    balance: r.balance, margin: r.margin,
    incomeRows: r.incomeRows, expenseRows: r.expenseRows, byMonth: r.byMonth
  }
})

/* ---------- 报表批（2026-11-14）：减免分析 / 实时账龄 / 押金在账 ----------
 * 三张表与 PC 的经营报表同口径。契约数据集的差别写在每个 handler 里，
 * 别让联调以为是假服务算错了。
 */

on('GET', '/reports/waive-analysis', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const { from, to } = ctx.query
  const cid = ctx.query.communityId || ''
  if (!from || !to) throw bad('from / to 必填（YYYY-MM）')

  /* 数据来自 `fixtures/bills.json` 的 discount / discountReasonId —— 由
     `scripts/gen-waive-seeds.mjs` 把 PC `_seedWaives()` 的同一套规则施加到 fixture 上（90 笔）。
     2026-11-14 之前这里恒为空表：种子文件里 discount 全是 0，减免只在 PC 运行时注入。
     正式实现读**减免流水**（一张账单可以分两次减），这里读账单上的累计值 —— 演示够用，
     分次减免的场景要等真实流水接口。 */
  const rows = bills.filter(b => (Number(b.discount) || 0) > 0
    && String(b.period) >= from && String(b.period) <= to
    && (!cid || b.communityId === cid))

  const total = r2(rows.reduce((s, b) => s + (Number(b.discount) || 0), 0))
  const byKey = new Map()
  const periodMap = new Map()
  for (const b of rows) {
    const id = b.discountReasonId || ''
    const key = id || '__none__'
    /* 原因的 type / 是否计考核 / 免审额度都从字典取，不在聚合里写死：
       写死过一版（type 恒「个案」、approveAbove 恒 0），跑出来的「超免审额度」永远是 0，
       看上去像"没人超权减免"，实际是这一列没算 */
    const rec = id ? WAIVE_REASONS.find(r => r.reasonId === id) : null
    const disc = Number(b.discount) || 0
    const cur = byKey.get(key) || {
      reasonId: id,
      name: (rec && rec.name) || b.discountReason || '未填原因（历史数据）',
      type: rec ? rec.type : '历史',
      countInAssess: rec ? !!rec.countInAssess : false,
      approveAbove: rec ? Number(rec.approveAbove) || 0 : 0,
      count: 0, amount: 0, overLimit: 0, houseSet: new Set()
    }
    cur.count += 1
    cur.amount = r2(cur.amount + disc)
    if (cur.approveAbove > 0 && disc > cur.approveAbove) cur.overLimit += 1
    cur.houseSet.add(b.houseId)
    byKey.set(key, cur)

    const p = periodMap.get(b.period) || { period: b.period, count: 0, amount: 0 }
    p.count += 1
    p.amount = r2(p.amount + (Number(b.discount) || 0))
    periodMap.set(b.period, p)
  }

  const reasons = [...byKey.values()]
    .map(x => ({ ...x, houses: x.houseSet.size, share: total > 0 ? Math.round(x.amount / total * 1000) / 10 : 0 }))
    .map(({ houseSet, ...rest }) => rest)
    .sort((a, b) => b.amount - a.amount)

  return {
    from, to,
    total,
    count: rows.length,
    houses: new Set(rows.map(b => b.houseId)).size,
    avg: rows.length ? r2(total / rows.length) : 0,
    overLimitCount: reasons.reduce((s, r) => s + r.overLimit, 0),
    reasons,
    byPeriod: [...periodMap.values()].sort((a, b) => String(a.period).localeCompare(String(b.period))),
    detail: [...rows].sort((a, b) => (Number(b.discount) || 0) - (Number(a.discount) || 0)).slice(0, 12)
      .map(b => ({
        houseId: b.houseId, houseName: b.houseName || b.houseId, period: b.period,
        itemName: b.itemName || '', amount: r2(b.discount),
        reasonId: b.discountReasonId || '', reasonName: b.discountReason || '未填原因', at: b.payTime || ''
      }))
  }
})

on('GET', '/reports/aging-live', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const q = ctx.query
  const cid = q.communityId || ''
  const asOf = String(q.asOf || DATA_DATE).slice(0, 10)
  const DEBT = new Set(['未缴', '部分缴', '逾期'])
  /* 与 AgingBucket 枚举一致（5 档）：报表中心 / 员工端账龄筛选 / 这张看板同一套分类 */
  const BUCKETS = ['未到期', '0-30天', '31-90天', '91-180天', '180天以上']
  const bucketOf = d => (d <= 0 ? '未到期' : d <= 30 ? '0-30天'
    : d <= 90 ? '31-90天' : d <= 180 ? '91-180天' : '180天以上')

  const rows = bills.filter(b => DEBT.has(b.status) && (Number(b.unpaid) || 0) > 0
    && (!cid || b.communityId === cid))

  const agg = new Map(BUCKETS.map(k => [k, { bucket: k, count: 0, amount: 0, houseSet: new Set() }]))
  const commAgg = new Map()
  const detail = []
  for (const b of rows) {
    const days = Math.floor((new Date(`${asOf}T00:00:00`) - new Date(`${String(b.dueDate).slice(0, 10)}T00:00:00`)) / 86400000)
    const k = bucketOf(days)
    const cur = agg.get(k)
    cur.count += 1
    cur.amount = r2(cur.amount + (Number(b.unpaid) || 0))
    cur.houseSet.add(b.houseId)

    const ca = commAgg.get(b.communityId) || { communityId: b.communityId, name: (communities.find(c => c.id === b.communityId) || {}).name || b.communityId, amount: 0, houseSet: new Set() }
    ca.amount = r2(ca.amount + (Number(b.unpaid) || 0))
    ca.houseSet.add(b.houseId)
    commAgg.set(b.communityId, ca)

    detail.push({ billId: b.billId, period: b.period, dueDate: b.dueDate, aging: k, overdueDays: days, unpaid: r2(b.unpaid) })
  }

  const total = r2([...agg.values()].reduce((s, r) => s + r.amount, 0))
  return {
    asOf,
    total,
    count: rows.length,
    houses: new Set(rows.map(b => b.houseId)).size,
    rows: BUCKETS.map(k => {
      const r = agg.get(k)
      return {
        bucket: k, count: r.count, houses: r.houseSet.size, amount: r.amount,
        share: total > 0 ? Math.round(r.amount / total * 1000) / 10 : 0
      }
    }),
    byCommunity: [...commAgg.values()]
      .map(x => ({ communityId: x.communityId, name: x.name, houses: x.houseSet.size, amount: x.amount }))
      .sort((a, b) => b.amount - a.amount),
    oldest: detail.filter(d => d.overdueDays > 0).sort((a, b) => b.overdueDays - a.overdueDays).slice(0, 8)
  }
})

/* ---------- 经营日报（2026-11-14 · 客户三张表批） ----------
 * 结构说明见 openapi 的 /reports/daily-revenue。
 * 这一份是**假服务**，所以按 03 的同一套实现走一遍，不另起算法 ——
 * 契约测试要验的是"结构对不对、恒等式成不成立"，不是"数字像不像真账"。
 */
const DAILY_ITEM_CAT = {
  FI01: { code: 'INC_MAIN_PROPERTY', name: '物业费' },
  FI02: { code: 'INC_MAIN_ELEV', name: '电梯运行费' },
  FI03: { code: 'INC_MAIN_ENERGY', name: '公共能耗费' },
  FI04: { code: 'INC_OTHER_SERVICE', name: '临时服务费' },
  FI05: { code: 'INC_OTHER_UTILITY', name: '水电费' },
  FI06: { code: 'INC_OTHER_UTILITY', name: '水电费' },
  FI07: { code: 'INC_MAIN_PARK', name: '车位管理费' },
  FI08: { code: 'LIA_DEPOSIT', name: '押金' },
  FI09: { code: 'INC_OTHER_PARKING', name: '临时停车费' },
  FI10: { code: 'INC_OTHER_CARD', name: '工本费' }
}
const DAILY_PAY_POINTS = ['现金', '车辆现金', 'POS刷卡', '车辆POS', '转账', '车辆云平台', '线上支付']
const DAILY_PARK = new Set(['INC_MAIN_PARK', 'INC_OTHER_PARKING'])

/**
 * 「收款点 + 渠道」→ 日报上的七个展示位。
 * 流水与押金都带 payPoint 了（fixtures 里已补），不再靠"业务是不是停车"去猜。
 */
function dailyPayPointName(payPoint, channel) {
  const pt = String(payPoint || '前台')
  const ch = String(channel || '')
  if (pt === '车辆云平台') return '车辆云平台'
  if (ch === '微信支付' || ch === '支付宝') return '线上支付'
  if (ch === '银行代扣') return '转账'
  const park = pt === '停车场'
  if (ch === 'POS刷卡') return park ? '车辆POS' : 'POS刷卡'
  return park ? '车辆现金' : '现金'
}

on('GET', '/reports/daily-revenue', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const month = String(ctx.query.month || '')
  const cid = ctx.query.communityId || ''
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('month 必填（YYYY-MM）')

  const [y, m] = month.split('-').map(Number)
  const n = new Date(y, m, 0).getDate()
  const days = Array.from({ length: n }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
  const idxOf = d => {
    const str = String(d || '').slice(0, 10)
    if (!str.startsWith(month)) return -1
    const day = Number(str.slice(8, 10))
    return day >= 1 && day <= n ? day - 1 : -1
  }
  const zeros = () => new Array(n).fill(0)
  const addTo = (arr, i, v) => { arr[i] = r2(arr[i] + (Number(v) || 0)) }
  const sumOf = arr => r2(arr.reduce((s2, v) => s2 + (Number(v) || 0), 0))

  /* 收入段：按账单所属项目筛（车位费 houseId 为空，不能按房筛） */
  const incomeRows = new Map()
  const incomeSub = zeros()
  const pointAgg = new Map(DAILY_PAY_POINTS.map(k => [k, zeros()]))

  for (const p of payments) {
    if (p.channel === '预存抵扣') continue
    const b = BILL.get(p.billId)
    if (!b) continue
    if (cid && b.communityId !== cid) continue
    const i = idxOf(p.payTime)
    if (i < 0) continue
    const cat = DAILY_ITEM_CAT[b.itemId] || { code: 'INC_OTHER_SERVICE', name: '临时服务费' }
    const amount = Number(p.amount) || 0
    const row = incomeRows.get(cat.code) || { code: cat.code, name: cat.name, group: 'income', amounts: zeros() }
    addTo(row.amounts, i, amount)
    incomeRows.set(cat.code, row)
    addTo(incomeSub, i, amount)
    const pt = p.payPoint || (DAILY_PARK.has(cat.code) ? '停车场' : '前台')
    addTo(pointAgg.get(dailyPayPointName(pt, p.channel)), i, amount)
  }

  /* 往来款 / 退款：押金台账。2026-11-15 起带 payMethod / payPoint，所以能进收款点 */
  const liaisonRows = new Map()
  const refundRows = new Map()
  const liaisonSub = zeros()
  const refundSub = zeros()
  for (const d of DEPOSITS) {
    if (cid && d.communityId !== cid) continue
    const type = d.type || '未分类'
    const iPaid = idxOf(d.paidDate)
    if (iPaid >= 0) {
      const amount = Number(d.amount) || 0
      const row = liaisonRows.get(type) || { code: type, name: type, group: 'liaison', amounts: zeros() }
      addTo(row.amounts, iPaid, amount)
      liaisonRows.set(type, row)
      addTo(liaisonSub, iPaid, amount)
      addTo(pointAgg.get(dailyPayPointName(d.payPoint || '前台', d.payMethod || '现金')), iPaid, amount)
    }
    const iRef = idxOf(d.refundDate)
    const refund = Number(d.refundAmount) || 0
    if (iRef >= 0 && refund > 0) {
      const row = refundRows.get(type) || { code: type, name: type, group: 'refund', amounts: zeros() }
      addTo(row.amounts, iRef, refund)
      refundRows.set(type, row)
      addTo(refundSub, iRef, refund)
      addTo(pointAgg.get(dailyPayPointName(d.refundPoint || '前台', d.refundMethod || '现金')), iRef, -refund)
    }
  }

  /* 抵减：当日减免（不参与差额） */
  const discount = zeros()
  for (const b of bills) {
    if (!(Number(b.discount) > 0)) continue
    if (cid && b.communityId !== cid) continue
    const i = idxOf(b.payTime)
    if (i < 0) continue
    addTo(discount, i, b.discount)
  }

  const cashByDay = zeros()
  DAILY_PAY_POINTS.forEach(k => pointAgg.get(k).forEach((v, i) => { cashByDay[i] = r2(cashByDay[i] + v) }))
  const grand = days.map((_, i) => r2(incomeSub[i] + liaisonSub[i] - refundSub[i]))
  /* 差额 = 合计 − 收款点。押金带收款方式了，校验范围扩到全部现金流 */
  const diff = days.map((_, i) => r2(grand[i] - cashByDay[i]))

  /* 每行自带 total：契约里 DailyRevenueRow.total 是必需字段 */
  const rowsOf = map => [...map.values()].map(r => ({ ...r, total: sumOf(r.amounts) }))
  return {
    month, communityId: cid, days,
    groups: [
      { key: 'income', name: '收入', rows: rowsOf(incomeRows), subtotal: incomeSub, total: sumOf(incomeSub) },
      { key: 'liaison', name: '往来款（押金收取）', rows: rowsOf(liaisonRows), subtotal: liaisonSub, total: sumOf(liaisonSub) },
      { key: 'refund', name: '退款（押金退还）', rows: rowsOf(refundRows), subtotal: refundSub, total: sumOf(refundSub) }
    ],
    grand: { amounts: grand, total: sumOf(grand) },
    payPoints: DAILY_PAY_POINTS.map(name => ({ name, amounts: pointAgg.get(name), total: sumOf(pointAgg.get(name)) })),
    discount: { amounts: discount, total: sumOf(discount) },
    diff: {
      amounts: diff,
      total: sumOf(diff),
      ok: diff.every(v => Math.abs(v) < 0.01),
      badDays: diff.map((v, i) => ({ day: days[i], diff: v })).filter(x => Math.abs(x.diff) >= 0.01)
    },
    summary: {
      income: sumOf(incomeSub), liaison: sumOf(liaisonSub), refund: sumOf(refundSub),
      grand: sumOf(grand), discount: sumOf(discount), cash: sumOf(cashByDay),
      days: n, activeDays: days.filter((_, i) => Math.abs(grand[i]) > 0.01).length
    }
  }
})

on('GET', '/reports/deposit-ledger', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const { from, to } = ctx.query
  const cid = ctx.query.communityId || ''
  if (!from || !to) throw bad('from / to 必填（YYYY-MM-DD）')

  const rows = DEPOSITS.filter(d => !cid || d.communityId === cid)
  const inRange = d => d && d >= from && d <= to
  const typeAgg = new Map()
  const bump = (type, field, amount) => {
    const cur = typeAgg.get(type) || { type, count: 0, received: 0, refunded: 0, deducted: 0, balance: 0 }
    cur[field] = r2(cur[field] + amount)
    typeAgg.set(type, cur)
  }

  let received = 0, refunded = 0, deducted = 0, balance = 0
  for (const d of rows) {
    const amount = Number(d.amount) || 0
    const refund = Number(d.refundAmount) || 0
    const deduct = Number(d.deductAmount) || 0
    const cur = typeAgg.get(d.type) || { type: d.type, count: 0, received: 0, refunded: 0, deducted: 0, balance: 0 }
    cur.count += 1
    typeAgg.set(d.type, cur)

    /* 三个日期各归各的期：收款看 paidDate、退款看 refundDate、扣款看 checkDate */
    if (inRange(String(d.paidDate || '').slice(0, 10))) { received = r2(received + amount); bump(d.type, 'received', amount) }
    if (inRange(String(d.refundDate || '').slice(0, 10))) { refunded = r2(refunded + refund); bump(d.type, 'refunded', refund) }
    if (deduct > 0 && inRange(String(d.checkDate || '').slice(0, 10))) { deducted = r2(deducted + deduct); bump(d.type, 'deducted', deduct) }
    if (String(d.paidDate || '').slice(0, 10) <= to) {
      balance = r2(balance + (Number(d.balance) || 0))
      bump(d.type, 'balance', Number(d.balance) || 0)
    }
  }

  const allReceived = r2(rows.reduce((s, d) => s + (Number(d.amount) || 0), 0))
  const allRefunded = r2(rows.reduce((s, d) => s + (Number(d.refundAmount) || 0), 0))
  const allDeducted = r2(rows.reduce((s, d) => s + (Number(d.deductAmount) || 0), 0))
  const allBalance = r2(rows.reduce((s, d) => s + (Number(d.balance) || 0), 0))
  const diff = r2(allReceived - allRefunded - allDeducted - allBalance)

  return {
    from, to, received, refunded, deducted, balance,
    byType: [...typeAgg.values()].sort((a, b) => b.balance - a.balance),
    identity: {
      received: allReceived, refunded: allRefunded, deducted: allDeducted, balance: allBalance,
      diff, ok: Math.abs(diff) <= 0.01
    }
  }
})

on('GET', '/manual-entries', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const q = ctx.query
  const list = MANUAL_ENTRIES
    .filter(x => !q.direction || x.direction === q.direction)
    .filter(x => !q.categoryCode || x.categoryCode === q.categoryCode)
    .filter(x => !q.period || x.period === q.period)
    .filter(x => !q.communityId || x.communityId === q.communityId)
    .filter(x => !q.kw || `${x.entryNo}${x.reason}${x.source}`.includes(q.kw))
  return page(list, q)
})
on('POST', '/manual-entries', (ctx) => {
  const body = ctx.body || {}
  const code = String(body.categoryCode || '')
  if (!MANUAL_CATEGORIES[code]) {
    throw new ApiError(422, 42204, `「${code}」不接受手工补录：日常费用请走报销，合同类请走合同台账`)
  }
  const direction = body.direction === 'income' ? 'income' : 'expense'
  if (MANUAL_DIRECTION[code] !== direction) throw bad('方向与分类不一致')
  if (!(Number(body.amount) > 0)) throw bad('金额必须大于 0')
  if (!/^\d{4}-\d{2}$/.test(String(body.period || ''))) throw bad('账期格式应为 YYYY-MM')
  if (!String(body.reason || '').trim()) throw bad('必须写补录原因')
  manualSeq += 1
  const rec = {
    entryId: 'ME' + String(manualSeq).padStart(4, '0'),
    entryNo: `BL-${String(body.period).slice(0, 4)}-${String(manualSeq).padStart(3, '0')}`,
    direction, categoryCode: code, categoryName: MANUAL_CATEGORIES[code],
    amount: r2(body.amount), period: body.period,
    bizDate: body.bizDate || `${body.period}-01`,
    objectType: body.objectType || '项目', objectName: body.objectName || '',
    communityId: body.communityId || '', source: body.source || '',
    attachment: body.attachment || '', reason: String(body.reason).trim(),
    operator: ctx.user.name, status: '已入账',
    createdAt: `${new Date().toISOString().slice(0, 10)} 09:00`
  }
  MANUAL_ENTRIES.unshift(rec)
  return rec
})
on('POST', '/manual-entries/{entryId}/void', (ctx) => {
  const rec = MANUAL_ENTRIES.find(x => x.entryId === ctx.params.entryId)
  if (!rec) throw notFound('补录单不存在')
  if (rec.status === '已作废') throw new ApiError(409, 40927, '该单据已作废')
  const why = String(ctx.body?.reason || '').trim()
  if (!why) throw bad('作废必须写原因')
  rec.status = '已作废'
  rec.voidReason = why.slice(0, 60)
  rec.voidAt = new Date().toISOString().slice(0, 10)
  return rec
})

on('GET', '/public-revenue', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const cid = ctx.query.communityId || ''
  const year = ctx.query.year || ''
  const rows = contracts
    .filter(c => (Number(c.publicRevenue) || 0) > 0)
    .filter(c => !cid || c.communityId === cid)
    .filter(c => !year || (String(c.startDate).slice(0, 4) <= year && String(c.endDate).slice(0, 4) >= year))
    .map(c => {
      const pub = Math.min(Number(c.publicRevenue) || 0, Number(c.amount) || 0)
      const m = monthsBetween(c.startDate, c.endDate) || 1
      return {
        ...c,
        ownerShare: pub,
        companyShare: r2(Number(c.amount) - pub),
        publicRate: c.amount ? Math.round(pub / c.amount * 10000) / 100 : 0,
        annualOwner: r2(pub / m * 12),
        communityName: (COMMUNITIES.find(x => x.communityId === c.communityId) || {}).name || ''
      }
    })
  const sum = k => r2(rows.reduce((s, x) => s + (Number(x[k]) || 0), 0))
  return {
    count: rows.length,
    amount: sum('amount'), ownerShare: sum('ownerShare'), companyShare: sum('companyShare'),
    annualOwner: sum('annualOwner'), annualCompany: 0,
    avgRate: sum('amount') ? Math.round(sum('ownerShare') / sum('amount') * 10000) / 100 : 0,
    rows, byCommunity: []
  }
})

on('GET', '/meter-bills/preview', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  if (!ctx.query.period) throw bad('period 必填')
  /* fixtures 里没有抄表读数：返回空结构让前端拿到形状，而不是 404 */
  return {
    period: ctx.query.period, total: 0, billableCount: 0, amount: 0,
    waterUsage: 0, elecUsage: 0, billedCount: 0, blockingCount: 0,
    blockingTop: [], byMode: { card: 0, none: 0 }, rows: []
  }
})
on('POST', '/meter-bills', (ctx) => {
  if (!ctx.body?.period) throw bad('period 必填')
  return { period: ctx.body.period, count: 0, amount: 0, waterCount: 0, elecCount: 0, skipped: 0 }
})


/* ================= 第 83 批（2026-11-13）：押金 / 减免原因 / 工单评价 / 报销付款 =================
 * 假服务只保证「形状对、语义对」，注释里写明它与正式实现的差别：
 *   · 押金与减免原因从内存字典起（真实实现读配置表）；
 *   · 报销明细由 PC 侧 OA 审批生成，这里只保留待付款与付款动作；
 *   · 工单评价直接写 workOrders 的 score/evalTags/evaluate（与业主端同一组字段）。
 */

const WAIVE_REASONS = [
  { reasonId: 'WR01', code: 'POLICY', name: '政策性减免', type: '政策性', countInAssess: false, needProof: true, scope: '全部', communityIds: [], approveAbove: 0, enabled: true, sort: 10, desc: '政府或行业规定必须减免的' },
  { reasonId: 'WR02', code: 'HARDSHIP', name: '困难户减免', type: '个案', countInAssess: false, needProof: true, scope: '全部', communityIds: [], approveAbove: 1000, enabled: true, sort: 20, desc: '低保、重病、独居老人等' },
  { reasonId: 'WR03', code: 'ERROR_FIX', name: '差错纠正', type: '差错', countInAssess: true, needProof: false, scope: '全部', communityIds: [], approveAbove: 2000, enabled: true, sort: 30, desc: '计费错误冲减' },
  { reasonId: 'WR04', code: 'NEGOTIATION', name: '协商减免', type: '个案', countInAssess: false, needProof: true, scope: '全部', communityIds: [], approveAbove: 500, enabled: true, sort: 40, desc: '诉讼和解、投诉补偿' },
  { reasonId: 'WR05', code: 'OTHER', name: '其他', type: '个案', countInAssess: false, needProof: true, scope: '全部', communityIds: [], approveAbove: 0, enabled: true, sort: 90, desc: '以上都不属于时选它' }
]
let WR_SEQ = WAIVE_REASONS.length

on('GET', '/waive-reasons', (ctx) => {
  const q = ctx.query || {}
  return WAIVE_REASONS
    .filter(r => q.enabled === undefined || q.enabled === '' || String(r.enabled) === String(q.enabled))
    .filter(r => !q.communityId || r.scope !== '指定项目' || (r.communityIds || []).includes(q.communityId))
    .slice().sort((a, b) => a.sort - b.sort)
})
on('POST', '/waive-reasons', (ctx) => {
  const b = ctx.body || {}
  if (!b.name || !b.type) throw bad('name / type 必填')
  if (WAIVE_REASONS.some(r => r.name === b.name)) throw new ApiError(409, 40930, '该原因已存在')
  WR_SEQ += 1
  const rec = {
    reasonId: 'WR' + String(WR_SEQ).padStart(2, '0'),
    code: String(b.code || 'CUSTOM_' + WR_SEQ).toUpperCase(),
    name: b.name, type: b.type,
    countInAssess: !!b.countInAssess, needProof: b.needProof !== false,
    scope: b.scope || '全部', communityIds: b.communityIds || [],
    approveAbove: Number(b.approveAbove) || 0,
    enabled: b.enabled !== false, sort: Number(b.sort) || WR_SEQ * 10,
    desc: b.desc || ''
  }
  WAIVE_REASONS.push(rec)
  return rec
})
on('PATCH', '/waive-reasons/{reasonId}', (ctx) => {
  const r = WAIVE_REASONS.find(x => x.reasonId === ctx.params.reasonId)
  if (!r) throw notFound('减免原因不存在')
  Object.assign(r, ctx.body || {}, { reasonId: r.reasonId })
  /* 至少要留一条启用的，否则收银台减免提交不了 */
  if (!r.enabled && WAIVE_REASONS.filter(x => x.enabled && x !== r).length === 0) {
    throw bad('至少要保留一条启用的减免原因')
  }
  return r
})

const DEPOSIT_TYPES = [
  { typeId: 'DT01', name: '装修押金', standardAmount: 3000, needDates: true, needCheck: true, allowPartial: true, byQuantity: false, enabled: true, sort: 10, desc: '装修前收取，验收后退还' },
  { typeId: 'DT02', name: '门禁卡押金', standardAmount: 50, needDates: false, needCheck: false, allowPartial: false, byQuantity: true, enabled: true, sort: 20, desc: '按张收取，退卡即退' },
  { typeId: 'DT03', name: '非机动车牌押金', standardAmount: 20, needDates: false, needCheck: false, allowPartial: false, byQuantity: true, enabled: true, sort: 30, desc: '按牌收取' },
  { typeId: 'DT04', name: '履约保证金', standardAmount: 0, needDates: false, needCheck: true, allowPartial: true, byQuantity: false, enabled: true, sort: 40, desc: '供应商履约担保，合同期满退还' },
  { typeId: 'DT05', name: '租约押金', standardAmount: 0, needDates: false, needCheck: true, allowPartial: true, byQuantity: false, enabled: true, sort: 50, desc: '车位 / 场地 / 商铺出租收取' },
  /* 2026-11-15 补两类：客户实际在收这两个钱，字典里没有的话，收银台开不出单、
     台账归不了类、日报也看不到。这是业务配置，跟"版式不照抄"是两件事。 */
  { typeId: 'DT06', name: '电卡押金', standardAmount: 30, needDates: false, needCheck: false, allowPartial: false, byQuantity: true, enabled: true, sort: 60, desc: '按张收取，退卡即退；卡丢失或损坏按工本费扣款' },
  { typeId: 'DT07', name: '交房保证金', standardAmount: 0, needDates: false, needCheck: true, allowPartial: true, byQuantity: false, enabled: true, sort: 70, desc: '业主收房时按合同/面积收取，验房后退还；担保「按图施工、不违建」' }
]
/* 接在**最大 id** 后面，不接 length：删过一条再建，length 会小于最大编号，就撞号了
   （押金台账那边已经踩过同一个坑，见 DP_SEQ） */
let DT_SEQ = DEPOSIT_TYPES.reduce((m, t) => Math.max(m, Number(String(t.typeId).replace(/\D/g, '')) || 0), 0)

/* 押金样例：2026-11-14 起改为投影 03 的真实台账（352 条），不再现场造。
 * 造数据那版只有 12 条：报表算出来的在账余额与真实台账无关，分页/筛选也翻不出边界。
 * 生成脚本 `scripts/gen-deposit-fixtures.mjs`（幂等，字段按契约 Deposit schema 白名单投影）。 */
const DEPOSITS = readJson('fixtures/deposits.json')
/* 编号要接在**最大 id** 后面，不能接 length：fixture 的 DP 号不连续（1..352 打散），
   接 length 会撞上已有编号 —— 撞了以后「按 id 查找」会随机命中两条中的一条 */
let DP_SEQ = DEPOSITS.reduce((m, d) => Math.max(m, Number(String(d.depositId).replace(/\D/g, '')) || 0), 0)

on('GET', '/deposit-types', (ctx) => {
  const q = ctx.query || {}
  return DEPOSIT_TYPES
    .filter(t => q.enabled === undefined || q.enabled === '' || String(t.enabled) === String(q.enabled))
    .slice().sort((a, b) => a.sort - b.sort)
})
on('POST', '/deposit-types', (ctx) => {
  const b = ctx.body || {}
  if (!b.name) throw bad('name 必填')
  if (DEPOSIT_TYPES.some(t => t.name === b.name)) throw new ApiError(409, 40931, '该押金类型已存在')
  DT_SEQ += 1
  const rec = {
    typeId: 'DT' + String(DT_SEQ).padStart(2, '0'),
    name: b.name,
    standardAmount: Number(b.standardAmount) || 0,
    needDates: !!b.needDates, needCheck: !!b.needCheck,
    allowPartial: b.allowPartial !== false, byQuantity: !!b.byQuantity,
    enabled: b.enabled !== false, sort: Number(b.sort) || DT_SEQ * 10,
    desc: b.desc || ''
  }
  DEPOSIT_TYPES.push(rec)
  return rec
})
on('PATCH', '/deposit-types/{typeId}', (ctx) => {
  const t = DEPOSIT_TYPES.find(x => x.typeId === ctx.params.typeId)
  if (!t) throw notFound('押金类型不存在')
  Object.assign(t, ctx.body || {}, { typeId: t.typeId })
  return t
})

on('GET', '/deposits', (ctx) => {
  assertInScope(ctx.user, ctx.query)
  const q = ctx.query || {}
  const list = DEPOSITS
    .filter(d => !q.type || d.type === q.type)
    .filter(d => !q.status || d.status === q.status)
    .filter(d => !q.communityId || d.communityId === q.communityId)
    .filter(d => !q.kw || `${d.applyNo}${d.houseId}${d.type}`.includes(q.kw))
    .slice().sort((a, b) => String(b.paidDate).localeCompare(String(a.paidDate)))
  const sum = k => r2(list.reduce((s, d) => s + (Number(d[k]) || 0), 0))
  const byType = [...new Set(list.map(d => d.type))].map(type => {
    const rows = list.filter(d => d.type === type)
    return {
      type, count: rows.length,
      amount: r2(rows.reduce((s, d) => s + d.amount, 0)),
      balance: r2(rows.reduce((s, d) => s + d.balance, 0))
    }
  })
  const p = page(list, q)
  return {
    ...p,
    summary: {
      count: list.length, payable: sum('amount'), paid: sum('refundAmount'),
      deduct: sum('deductAmount'), unpaid: sum('balance'), byType
    }
  }
})
on('POST', '/deposits', (ctx) => {
  const b = ctx.body || {}
  if (!b.type || !b.houseId || !b.paidDate) throw bad('type / houseId / paidDate 必填')
  const def = DEPOSIT_TYPES.find(t => t.name === b.type)
  if (!def) throw notFound('押金类型不存在')
  if (!def.enabled) throw bad('该押金类型已停用')
  if (def.needDates && (!b.startDate || !b.planEndDate)) throw bad('该类型需要工期：请填写开工与计划完工日期')
  const amount = def.standardAmount > 0
    ? r2(def.standardAmount * (def.byQuantity ? (Number(b.quantity) || 1) : 1))
    : r2(b.amount)
  if (!(amount > 0)) throw bad('金额必须大于 0')
  const h = HOUSE.get(b.houseId) || {}
  DP_SEQ += 1
  const rec = {
    depositId: 'DP' + String(DP_SEQ).padStart(5, '0'),
    applyNo: 'YJ2026-' + String(DP_SEQ).padStart(4, '0'),
    type: def.name, communityId: h.communityId || '', houseId: b.houseId,
    ownerId: h.ownerId || '', amount, quantity: def.byQuantity ? (Number(b.quantity) || 1) : 1,
    paidDate: b.paidDate,
    startDate: def.needDates ? b.startDate : '', planEndDate: def.needDates ? b.planEndDate : '',
    checkDate: null, status: def.needDates ? '装修中' : '在押',
    deductAmount: 0, deductReason: '', refundAmount: 0, refundDate: null,
    balance: amount, operator: ctx.user.name, remark: b.remark || ''
  }
  DEPOSITS.unshift(rec)
  return rec
})
on('POST', '/deposits/{depositId}/check', (ctx) => {
  const d = DEPOSITS.find(x => x.depositId === ctx.params.depositId)
  if (!d) throw notFound('押金记录不存在')
  const def = DEPOSIT_TYPES.find(t => t.name === d.type)
  if (def && !def.needCheck) throw bad(`「${d.type}」不需要验收：退卡/退牌时直接退款`)
  const b = ctx.body || {}
  if (!b.checkDate) throw bad('请填写验收日期')
  const deduct = Number(b.deductAmount) || 0
  if (deduct < 0 || deduct > d.amount) throw bad('扣款金额不得为负且不得超过押金总额')
  if (deduct > 0 && !b.deductReason) throw bad('有扣款时必须填写扣款原因')
  d.checkDate = b.checkDate
  d.deductAmount = r2(deduct)
  d.deductReason = deduct ? b.deductReason : ''
  d.status = deduct >= d.amount ? '已没收' : (deduct > 0 ? '部分扣除' : '待退款')
  return d
})
on('POST', '/deposits/{depositId}/refund', (ctx) => {
  const d = DEPOSITS.find(x => x.depositId === ctx.params.depositId)
  if (!d) throw notFound('押金记录不存在')
  const def = DEPOSIT_TYPES.find(t => t.name === d.type)
  if (def && def.needCheck && !d.checkDate) throw bad('请先完成验收')
  const can = r2(d.amount - d.deductAmount - d.refundAmount)
  if (can <= 0) throw bad('该押金已无余额可退')
  const b = ctx.body || {}
  const amt = b.refundAmount === undefined || b.refundAmount === null ? can : Number(b.refundAmount)
  if (!(amt > 0) || amt > can) throw bad(`退款金额应在 0 ~ ${can} 之间`)
  if (def && def.allowPartial === false && Math.abs(amt - can) > 0.01) throw bad(`「${d.type}」不支持部分退`)
  d.refundAmount = r2(d.refundAmount + amt)
  d.balance = r2(d.amount - d.refundAmount - d.deductAmount)
  d.refundDate = b.refundDate || new Date().toISOString().slice(0, 10)
  if (d.balance <= 0) d.status = d.deductAmount > 0 ? '部分扣除' : '已退还'
  return d
})

/* 工单评价：与业主端写的是同一组字段 */
const WO_EVAL_TAGS = ['准时上门', '讲解清楚', '收拾干净', '收费透明', '态度好']
const satisfactionOf = (list) => {
  const rated = list.filter(w => Number(w.score) > 0)
  const rateable = list.filter(w => ['已完工', '已评价', '已关闭'].includes(w.status))
  const avg = rated.length ? Math.round(rated.reduce((s, w) => s + Number(w.score), 0) / rated.length * 100) / 100 : 0
  return {
    total: list.length, rateable: rateable.length,
    ratedCount: rated.length,
    unratedCount: rateable.filter(w => !(Number(w.score) > 0)).length,
    evalRate: rateable.length ? Math.round(rated.length / rateable.length * 10000) / 100 : 0,
    avg,
    lowCount: rated.filter(w => Number(w.score) <= 2).length,
    dist: [1, 2, 3, 4, 5].map(n => ({ score: n, n: rated.filter(w => Number(w.score) === n).length })),
    tags: [...new Set(rated.flatMap(w => w.evalTags || []))]
      .map(name => ({ name, n: rated.filter(w => (w.evalTags || []).includes(name)).length }))
      .sort((a, b) => b.n - a.n),
    lowList: rated.filter(w => Number(w.score) <= 2)
      .map(w => ({ woId: w.woId, woNo: w.woNo, score: Number(w.score), assignee: w.assignee, evaluate: w.evaluate || '' }))
  }
}
on('POST', '/work-orders/{woId}/evaluate', (ctx) => {
  const w = workOrders.find(x => x.woId === ctx.params.woId)
  if (!w) throw notFound('工单不存在')
  if (w.score > 0) throw new ApiError(409, 40932, '该工单已评价')
  const b = ctx.body || {}
  const score = Number(b.score)
  if (!(score >= 1 && score <= 5)) throw bad('score 应为 1~5')
  w.score = score
  w.evalTags = (b.tags || []).filter(t => WO_EVAL_TAGS.includes(t))
  w.evaluate = String(b.text || '')
  w.evaluateAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
  if (['已完工', '待确认'].includes(w.status)) w.status = '已评价'
  return satisfactionOf(workOrders)
})
on('GET', '/work-orders/satisfaction', (ctx) => {
  const q = ctx.query || {}
  const list = workOrders.filter(w => !q.communityId || w.communityId === q.communityId)
  return satisfactionOf(list)
})

/* 报销：审批通过 → 待付款；财务确认付款后才计入支出 */
const EXPENSES = []
on('GET', '/expenses/pending', () => EXPENSES.filter(x => x.status === '待付款'))
on('POST', '/expenses/{expenseId}/pay', (ctx) => {
  const x = EXPENSES.find(e => e.expenseId === ctx.params.expenseId)
  if (!x) throw notFound('报销单不存在')
  if (x.status === '已付款') throw new ApiError(409, 40933, '该报销单已付款')
  x.status = '已付款'
  x.payDate = (ctx.body || {}).payDate || new Date().toISOString().slice(0, 10)
  return x
})

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
    console.log(`邻里：${neighborItems.length} 闲置 / ${neighborReports.length} 举报 / ${neighborActivities.length} 活动 / ${neighborEnrolls.length} 报名`)
    console.log(`契约测试账号：gm（全部项目）/ pm（本项目 P01）/ steward（责任范围 ${stewardCommunities.join(',')} · ${(EMP.get(stewardEmpId) || {}).name}）/ staff（仅本人）`)
    console.log('员工端账号：zhou-ming 周明 / wang-lei 汪磊 / mo-rui 莫瑞 / xu-yue 徐悦，密码 123456')
  })
}
