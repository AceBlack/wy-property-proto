/**
 * 契约测试 · 后端交付时用同一套断言验收
 * ----------------------------------------------------------------
 * 覆盖三类：
 *   ① **结构性**：响应必须符合 openapi.yaml 的 schema（字段缺失、类型错、枚举越界都会被抓）；
 *   ② **语义性**：越权 403、版本冲突 409、业务校验 422、分页越界 400——这些是"看起来对、其实错"的重灾区；
 *   ③ **业务不变量**：账单 payable = paidAmount + unpaid；退款必须冲回账单；SLA 停表不计超时。
 *
 * 用法：npm test        （会自己拉起假服务，随机端口，跑完自动关）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { startServer } from './mock-server.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const spec = YAML.parse(fs.readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf8'))
const enums = JSON.parse(fs.readFileSync(path.join(__dirname, 'enums.json'), 'utf8')).enums

/* ============================ mini schema 校验 ============================ */
const resolveRef = ref => {
  if (!ref.startsWith('#/')) throw new Error(`不支持的 $ref：${ref}`)
  return ref.slice(2).split('/').reduce((o, k) => o?.[k], spec)
}
const typeOf = v => {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (Number.isInteger(v)) return 'integer'
  return typeof v
}
function validate(value, schema, at = '$', errors = []) {
  if (!schema || typeof schema !== 'object') return errors
  if (schema.$ref) return validate(value, resolveRef(schema.$ref), at, errors)
  if (Array.isArray(schema.allOf)) {
    for (const s of schema.allOf) validate(value, s, at, errors)
  }
  const t = schema.type
  if (t) {
    const want = Array.isArray(t) ? t : [t]
    const got = typeOf(value)
    const ok = want.some(w => w === got || (w === 'number' && got === 'integer'))
    if (!ok) { errors.push(`${at} 类型应为 ${want.join('|')}，实际 ${got}`); return errors }
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${at} 枚举越界：${JSON.stringify(value)} 不在 ${JSON.stringify(schema.enum)}`)
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at} 长度应 ≥ ${schema.minLength}`)
    if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors.push(`${at} 不是 date：${value}`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at} 应 ≥ ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at} 应 ≤ ${schema.maximum}`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at} 至少 ${schema.minItems} 项`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at} 最多 ${schema.maxItems} 项`)
    if (schema.items) value.forEach((v, i) => validate(v, schema.items, `${at}[${i}]`, errors))
  } else if (value && typeof value === 'object') {
    for (const k of schema.required || []) {
      if (value[k] === undefined) errors.push(`${at}.${k} 缺失（required）`)
    }
    for (const [k, s] of Object.entries(schema.properties || {})) {
      if (value[k] !== undefined) validate(value[k], s, `${at}.${k}`, errors)
    }
  }
  return errors
}
function assertSchema(body, schemaName, label) {
  const errors = validate(body, spec.components.schemas[schemaName])
  if (errors.length) throw new Error(`${label}：schema 校验失败\n      - ${errors.slice(0, 6).join('\n      - ')}`)
}

/* ============================ 断言工具 ============================ */
const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}：期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`) }
const near = (a, b, msg, eps = 0.02) => {
  if (Math.abs((a || 0) - (b || 0)) > eps) throw new Error(`${msg}：${a} vs ${b}`)
}

/* ============================ HTTP 客户端 ============================ */
let BASE = ''
let token = ''
async function call(method, p, { query, body, auth = true, raw = false } = {}) {
  const url = new URL(BASE + p)
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const json = await res.json()
  if (raw) return { status: res.status, json }
  return { status: res.status, ...json }
}
async function login(username) {
  const r = await call('POST', '/auth/login', { body: { username, password: '123456' }, auth: false })
  assert(r.status === 200 && r.code === 0, `登录失败：${r.message}`)
  return r.data.token
}

/* ============================ 用例 ============================ */
const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('登录返回令牌与权限（schema）', async () => {
  const r = await call('POST', '/auth/login', { body: { username: 'gm', password: '123456' }, auth: false })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'LoginEnvelope', 'POST /auth/login')
  assert(r.data.user.permissions.length > 0, '权限列表为空')
  assert(r.data.expiresIn > 0, 'expiresIn 应大于 0')
})

test('未带令牌 → 401 / 40101', async () => {
  const r = await call('GET', '/owners', { auth: false })
  eq(r.status, 401, 'HTTP 状态')
  eq(r.code, 40101, '业务码')
})

test('分页越界 → 400 / 40001', async () => {
  const r = await call('GET', '/owners', { query: { size: 1000 } })
  eq(r.status, 400, 'HTTP 状态')
  eq(r.code, 40001, '业务码')
  const r2 = await call('GET', '/owners', { query: { pageNo: 0 } })
  eq(r2.status, 400, 'pageNo=0 应 400')
})

test('业主列表 schema + 敏感字段只回掩码', async () => {
  const r = await call('GET', '/owners', { query: { pageNo: 1, size: 5 } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'OwnerPageEnvelope', 'GET /owners')
  assert(r.data.rows.length === 5, '应返回 5 行')
  assert(r.data.total > 5, 'total 应大于本页')
  for (const row of r.data.rows) {
    assert(/\*{4}/.test(row.phone), `手机号未脱敏：${row.phone}`)
    assert(row.phoneRedacted === true, 'phoneRedacted 应为 true')
    assert(/\*{4}/.test(row.idCard || '****'), `证件号未脱敏：${row.idCard}`)
  }
})

test('业主详情回明文（详情是已授权语境）', async () => {
  const list = await call('GET', '/owners', { query: { size: 1 } })
  const id = list.data.rows[0].ownerId
  const r = await call('GET', `/owners/${id}`)
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'OwnerDetailEnvelope', 'GET /owners/{id}')
  assert(!/\*{4}/.test(r.data.owner.phone), `详情不该脱敏：${r.data.owner.phone}`)
  assert(r.data.owner.phoneRedacted === false, 'phoneRedacted 应为 false')
  assert(Array.isArray(r.data.houses), 'houses 应为数组')
})

test('业主不存在 → 404 / 40401', async () => {
  const r = await call('GET', '/owners/OW99999')
  eq(r.status, 404, 'HTTP 状态')
  eq(r.code, 40401, '业务码')
})

test('乐观锁：版本不一致 → 409 / 40901', async () => {
  const list = await call('GET', '/owners', { query: { size: 1 } })
  const row = list.data.rows[0]
  const r = await call('PATCH', `/owners/${row.ownerId}`, {
    body: { field: 'remark', value: '并发冲突测试', ver: row._ver + 99 }
  })
  eq(r.status, 409, 'HTTP 状态')
  eq(r.code, 40901, '业务码')
})

test('乐观锁：正常修改后版本递增', async () => {
  const list = await call('GET', '/owners', { query: { size: 1 } })
  const row = list.data.rows[0]
  const before = row._ver
  const r = await call('PATCH', `/owners/${row.ownerId}`, {
    body: { field: 'remark', value: '契约测试改备注', ver: before }
  })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'OwnerEnvelope', 'PATCH /owners/{id}')
  eq(r.data._ver, before + 1, '版本号应递增')
  eq(r.data.remark, '契约测试改备注', '字段值')
})

test('唯一约束：手机号重复 → 409 / 40902', async () => {
  const list = await call('GET', '/owners', { query: { size: 2 } })
  const [a, b] = list.data.rows
  const r = await call('PATCH', `/owners/${b.ownerId}`, { body: { field: 'phone', value: a.phone.replace(/\*/g, '1') } })
  /* 掩码值拿去改本身会触发格式外的比较，这里直接用详情里的明文更准确 */
  const da = await call('GET', `/owners/${a.ownerId}`)
  const r2 = await call('PATCH', `/owners/${b.ownerId}`, { body: { field: 'phone', value: da.data.owner.phone } })
  eq(r2.status, 409, 'HTTP 状态')
  eq(r2.code, 40902, '业务码')
})

/** 切角色跑一段：一定要 finally 还原，否则一条用例失败会污染后面全部用例 */
async function asRole(username, fn) {
  const saved = token
  token = await login(username)
  try { return await fn() } finally { token = saved }
}

test('越权：楼管传范围外项目 → 403 / 40301（不是空列表）', async () => {
  await asRole('steward', async () => {
    /* P03 一定不在楼管责任范围内 */
    const r = await call('GET', '/bills', { query: { communityId: 'P03', size: 5 } })
    eq(r.status, 403, 'HTTP 状态')
    eq(r.code, 40301, '业务码')
  })
})

test('楼管只看到责任范围内的数据', async () => {
  /* 全量基线必须先用管理员令牌取，切到楼管后再取就变成"自己跟自己比" */
  const full = {
    owners: (await call('GET', '/owners', { query: { size: 1 } })).data.total,
    bills: (await call('GET', '/bills', { query: { size: 1 } })).data.total
  }
  await asRole('steward', async () => {
    const bills = await call('GET', '/bills', { query: { size: 100 } })
    eq(bills.status, 200, 'HTTP 状态')
    assert(bills.data.total > 0, '楼管应能看到自己范围内的账单')
    assert(bills.data.total < full.bills, `楼管可见账单应少于全量（${bills.data.total} vs ${full.bills}）`)

    const owners = await call('GET', '/owners', { query: { size: 100 } })
    assert(owners.data.total > 0, '楼管应能看到自己范围内的业主')
    assert(owners.data.total < full.owners, `楼管可见业主应少于全量（${owners.data.total} vs ${full.owners}）`)
  })
})

test('账单列表 schema + 金额自洽（payable = paid + unpaid）', async () => {
  const r = await call('GET', '/bills', { query: { pageNo: 1, size: 20 } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'BillPageEnvelope', 'GET /bills')
  for (const b of r.data.rows) {
    near(b.payable, (b.paidAmount || 0) + (b.unpaid || 0), `账单 ${b.billId} 应收 ≠ 已收 + 未收`)
    assert(['house', 'park'].includes(b.subjectType), `subjectType 非法：${b.subjectType}`)
  }
})

test('账单小计与列表 total 同源', async () => {
  const q = { period: '2026-10', size: 1 }
  const list = await call('GET', '/bills', { query: q })
  const sum = await call('GET', '/bills/summary', { query: { period: '2026-10' } })
  assertSchema(sum, 'BillSummaryEnvelope', 'GET /bills/summary')
  eq(sum.data.count, list.data.total, '小计张数应等于列表 total')
})

test('批量催缴：部分成功要按条回报', async () => {
  const debts = await call('GET', '/bills', { query: { vf: 'debt', size: 2 } })
  const paid = await call('GET', '/bills', { query: { status: '已缴', size: 1 } })
  assert(debts.data.rows.length > 0, '样例里应有欠费账单')
  const ids = [...debts.data.rows.map(b => b.billId), ...paid.data.rows.map(b => b.billId)]
  const r = await call('POST', '/bills/batch-remind', { body: { billIds: ids, method: '短信' } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'BatchResultEnvelope', 'POST /bills/batch-remind')
  eq(r.data.total, ids.length, '总数')
  assert(r.data.ok >= 1, '至少成功 1 条')
  assert(r.data.failed.length >= 1, '已缴账单应进 failed')
  assert(r.data.failed[0].reason.includes('没有欠费'), `失败原因不明确：${r.data.failed[0].reason}`)
})

test('批量减免：缺原因 → 422 / 42201', async () => {
  const r = await call('POST', '/bills/batch-reduce', { body: { billIds: ['BL000001'], reason: '短' } })
  eq(r.status, 422, 'HTTP 状态')
  eq(r.code, 42201, '业务码')
})

test('退款：缺原因 → 422', async () => {
  const p = await call('GET', '/payments', { query: { size: 1 } })
  const r = await call('POST', `/payments/${p.data.rows[0].payId}/refund`, { body: { reason: '退' } })
  eq(r.status, 422, 'HTTP 状态')
})

test('退款：成功后退回冲账单 + 已开票红冲', async () => {
  /* 找一笔「已开票且有对应账单」的流水，才能验证红冲与账单回落 */
  const list = await call('GET', '/payments', { query: { invoiceStatus: '已开票', size: 50 } })
  let target = null
  for (const p of list.data.rows) {
    const d = await call('GET', `/payments/${p.payId}`)
    if (d.data.bill && (d.data.bill.paidAmount || 0) > 0) { target = d.data; break }
  }
  assert(target, '样例里找不到可退款的已开票流水')
  const before = target.bill
  const pay = target.payment
  const amount = Math.min(10, pay.amount)

  const r = await call('POST', `/payments/${pay.payId}/refund`, { body: { amount, reason: '契约测试退款' } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'RefundEnvelope', 'POST /payments/{id}/refund')
  assert(r.data.refundNo.startsWith('TK-'), `退款单号格式：${r.data.refundNo}`)

  const after = await call('GET', `/bills/${before.billId}`)
  near(after.data.paidAmount, before.paidAmount - amount, '账单已收应减少')
  near(after.data.unpaid, before.unpaid + amount, '账单未收应增加')
  near(after.data.payable, (after.data.paidAmount || 0) + (after.data.unpaid || 0), '退款后金额仍须自洽')

  const payAfter = await call('GET', `/payments/${pay.payId}`)
  eq(payAfter.data.payment.invoiceStatus, '已冲红', '已开票的退款应红冲发票')
  assert(payAfter.data.refunds.length >= 1, '退款记录应挂在流水下')

  /* 再退超过剩余额度 → 422 */
  const left = pay.amount - (payAfter.data.payment.refundAmount || 0)
  const over = await call('POST', `/payments/${pay.payId}/refund`, { body: { amount: left + 1, reason: '超额测试' } })
  eq(over.status, 422, '超额退款应 422')
})

test('工单列表 schema + SLA 字段由服务端下发', async () => {
  const r = await call('GET', '/work-orders', { query: { size: 20 } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'WorkOrderPageEnvelope', 'GET /work-orders')
  for (const w of r.data.rows) {
    assert(w.slaDueAt && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(w.slaDueAt), `slaDueAt 格式：${w.slaDueAt}`)
    assert(typeof w.slaBreached === 'boolean', 'slaBreached 应为布尔')
    if (w.status === '待确认') assert(w.slaBreached === false, `停表不该超时：${w.woNo}`)
  }
})

test('工单 nohouse=true 全是无房屋工单', async () => {
  const r = await call('GET', '/work-orders', { query: { nohouse: true, size: 50 } })
  eq(r.status, 200, 'HTTP 状态')
  for (const w of r.data.rows) assert(!w.houseId, `${w.woNo} 不该有 houseId`)
})

test('工单 KPI：overdue ≤ open，且与列表口径一致', async () => {
  const sum = await call('GET', '/work-orders/summary')
  assertSchema(sum, 'WorkOrderSummaryEnvelope', 'GET /work-orders/summary')
  assert(sum.data.overdue <= sum.data.open, `overdue(${sum.data.overdue}) 不应大于 open(${sum.data.open})`)
  const overdueList = await call('GET', '/work-orders', { query: { vf: 'overdue', size: 100 } })
  eq(overdueList.data.total, sum.data.overdue, '「已超时」视图条数应等于 KPI')
})

test('枚举取值与 enums.json 一致', async () => {
  const bills = await call('GET', '/bills', { query: { size: 100 } })
  const badBill = bills.data.rows.filter(b => !enums.billStatus.values.includes(b.status))
  assert(badBill.length === 0, `账单状态越界：${badBill.slice(0, 3).map(b => b.status)}`)

  const wos = await call('GET', '/work-orders', { query: { size: 100 } })
  const badWo = wos.data.rows.filter(w => !enums.woStatus.values.includes(w.status))
  assert(badWo.length === 0, `工单状态越界：${badWo.slice(0, 3).map(w => w.status)}`)
  const badPri = wos.data.rows.filter(w => !enums.woPriority.values.includes(w.priority))
  assert(badPri.length === 0, `优先级越界：${badPri.slice(0, 3).map(w => w.priority)}`)

  const pays = await call('GET', '/payments', { query: { size: 100 } })
  const badPay = pays.data.rows.filter(p => !enums.payMethod.values.includes(p.method))
  assert(badPay.length === 0, `收款方式越界：${badPay.slice(0, 3).map(p => p.method)}`)
})

test('分页：第 2 页与第 1 页不重叠', async () => {
  const p1 = await call('GET', '/payments', { query: { pageNo: 1, size: 10 } })
  const p2 = await call('GET', '/payments', { query: { pageNo: 2, size: 10 } })
  eq(p1.data.rows.length, 10, '第 1 页条数')
  eq(p2.data.rows.length, 10, '第 2 页条数')
  const ids1 = new Set(p1.data.rows.map(x => x.payId))
  const dup = p2.data.rows.filter(x => ids1.has(x.payId))
  assert(dup.length === 0, `两页出现重复流水：${dup.map(x => x.payId)}`)
})


/* ---------------- 第二批：租户 / 巡检 / 整改 ---------------- */

test('租户列表 schema + 掩码 + 默认不含已搬离', async () => {
  const r = await call('GET', '/tenants', { query: { size: 20 } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'TenantPageEnvelope', 'GET /tenants')
  assert(r.data.total > 0, '应有租户数据')
  for (const t of r.data.rows) {
    assert(/\*{4}/.test(t.phone), `租户手机号未脱敏：${t.phone}`)
    assert(t.status === '在住', `默认列表不该出现「${t.status}」`)
    assert(t.completeness && t.completeness.basicTotal === 5, '核验门槛应为 5 项')
    assert(t.rent === undefined, '租金不该出现在后台接口里')
  }
})

test('租户详情回明文 + 完整度结构', async () => {
  const list = await call('GET', '/tenants', { query: { size: 1 } })
  const id = list.data.rows[0].tenantId
  const r = await call('GET', `/tenants/${id}`)
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'TenantDetailEnvelope', 'GET /tenants/{id}')
  assert(!/\*{4}/.test(r.data.tenant.phone), '详情不该脱敏')
  const c = r.data.tenant.completeness
  eq(c.total, 8, '完整度总项')
  eq(c.basicTotal, 5, '核验门槛项')
  assert(Array.isArray(c.missingBasic), 'missingBasic 应为数组')
})

test('核验：门槛缺项 → 422/42202 并点名缺什么', async () => {
  const list = await call('GET', '/tenants', { query: { verifyStatus: '待核验', size: 100 } })
  const bad = list.data.rows.find(t => t.completeness.missingBasic.length > 0)
  assert(bad, '样例里应有门槛缺项的租户（生成时人为留了 7 条）')
  const r = await call('POST', `/tenants/${bad.tenantId}/verify`, { body: { pass: true, verifier: '契约测试' } })
  eq(r.status, 422, 'HTTP 状态')
  eq(r.code, 42202, '业务码')
  assert(r.message.includes(bad.completeness.missingBasic[0]), `提示应点名缺项：${r.message}`)
})

test('核验通过 → 已核验 + 实名成立；随后可录人脸，重复录 422', async () => {
  const list = await call('GET', '/tenants', { query: { verifyStatus: '待核验', size: 100 } })
  const good = list.data.rows.find(t => t.completeness.missingBasic.length === 0 && !t.faceRegistered)
  assert(good, '应有基础信息齐全的待核验租户')
  const r = await call('POST', `/tenants/${good.tenantId}/verify`, { body: { pass: true, verifier: '契约测试' } })
  eq(r.status, 200, 'HTTP 状态')
  eq(r.data.verifyStatus, '已核验', '核验状态')
  eq(r.data.certified, true, '核验通过应同时实名')

  const f1 = await call('POST', `/tenants/${good.tenantId}/face`, { body: { operator: '契约测试' } })
  eq(f1.status, 200, '录人脸 HTTP 状态')
  eq(f1.data.faceRegistered, true, '人脸应已录入')
  const f2 = await call('POST', `/tenants/${good.tenantId}/face`, { body: { operator: '契约测试' } })
  eq(f2.status, 422, '重复录人脸应 422')
})

test('未核验不得录人脸 → 422', async () => {
  const list = await call('GET', '/tenants', { query: { verifyStatus: '待核验', size: 100 } })
  const t = list.data.rows.find(x => !x.faceRegistered)
  const r = await call('POST', `/tenants/${t.tenantId}/face`, { body: {} })
  eq(r.status, 422, 'HTTP 状态')
  assert(r.message.includes('核验'), `提示应说明需先核验：${r.message}`)
})

test('搬离 → 已搬离 + 停人脸 + 释放在住关系', async () => {
  const list = await call('GET', '/tenants', { query: { size: 50 } })
  const t = list.data.rows.find(x => x.houseId && x.status === '在住')
  assert(t, '应有在住租户')
  const houseBefore = await call('GET', `/houses/${t.houseId}`)
  eq(houseBefore.data.tenantId, t.tenantId, '搬离前房屋应挂着该租户')

  const r = await call('POST', `/tenants/${t.tenantId}/move-out`, {
    body: { date: '2026-10-21', reason: '租约到期退租', operator: '契约测试' }
  })
  eq(r.status, 200, 'HTTP 状态')
  eq(r.data.status, '已搬离', '状态')
  eq(r.data.faceRegistered, false, '搬离应停用人脸')

  const houseAfter = await call('GET', `/houses/${t.houseId}`)
  eq(houseAfter.data.tenantId, null, '搬离后房屋应释放在住关系')
})

test('批量核验：按人回报（已核验过 / 缺项）', async () => {
  const list = await call('GET', '/tenants', { query: { size: 100 } })
  const verified = list.data.rows.find(t => t.verifyStatus === '已核验')
  const incomplete = list.data.rows.find(t => t.completeness.missingBasic.length > 0)
  const ok2 = list.data.rows.find(t => t.verifyStatus === '待核验' && t.completeness.missingBasic.length === 0)
  assert(verified && incomplete, '样例应同时存在已核验与缺项租户')
  const ids = [verified.tenantId, incomplete.tenantId, ...(ok2 ? [ok2.tenantId] : [])]
  const r = await call('POST', '/tenants/batch-verify', { body: { tenantIds: ids } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'BatchResultEnvelope', 'POST /tenants/batch-verify')
  eq(r.data.total, ids.length, '总数')
  assert(r.data.failed.length >= 2, `已核验与缺项都应进 failed（实际 ${r.data.failed.length}）`)
})

test('巡检任务列表：按任务类型筛监督', async () => {
  const all = await call('GET', '/inspect-tasks', { query: { size: 1 } })
  const sup = await call('GET', '/inspect-tasks', { query: { taskType: '监督', size: 20 } })
  eq(sup.status, 200, 'HTTP 状态')
  assertSchema(sup, 'InspectTaskPageEnvelope', 'GET /inspect-tasks')
  assert(sup.data.total > 0, '应有监督任务')
  assert(sup.data.total < all.data.total, '监督任务应少于全部')
  for (const t of sup.data.rows) eq(t.taskType, '监督', '任务类型')
})

test('监督任务提交：不合格项必须指定责任员工 → 否则 422', async () => {
  const list = await call('GET', '/inspect-tasks', { query: { taskType: '监督', size: 100 } })
  const t = list.data.rows.find(x => x.status !== '已完成')
  assert(t, '应有未完成的监督任务')
  const nm = t.itemCount || 3
  const results = Array.from({ length: nm }, (_, i) => ({
    item: `检查项 ${i + 1}`,
    result: i === 0 ? '不合格' : '合格'
  }))
  const bad = await call('POST', `/inspect-tasks/${t.taskId}/submit`, { body: { results, photos: 2, checkedIn: true } })
  eq(bad.status, 422, '未指定责任人应 422')

  results[0].responsibleEmpId = 'EM0001'
  results[0].responsibleName = '韦秀兰'
  const ok = await call('POST', `/inspect-tasks/${t.taskId}/submit`, { body: { results, photos: 2, checkedIn: true } })
  eq(ok.status, 200, 'HTTP 状态')
  assertSchema(ok, 'InspectTaskEnvelope', 'POST /inspect-tasks/{id}/submit')
  eq(ok.data.status, '已完成', '状态')
  eq(ok.data.issueCount, 1, '问题数应按 results 重算')
  eq(ok.data.normalCount, nm - 1, '合格数应按 results 重算')
})

test('整改列表 schema + 超期为派生字段', async () => {
  const r = await call('GET', '/rectify-orders', { query: { size: 20 } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'RectifyPageEnvelope', 'GET /rectify-orders')
  for (const o of r.data.rows) {
    eq(typeof o.overdue, 'boolean', 'overdue 应为布尔')
    assert(o.progress.total === o.items.length, `进度合计应等于项数：${o.rectifyNo}`)
    if (o.overdue) assert(o.status !== '已闭环', '已闭环不该标超期')
  }
})

test('整改提交：有未完成项 → 422；全完成 → 待复核', async () => {
  const list = await call('GET', '/rectify-orders', { query: { vf: 'todo', size: 50 } })
  const withPending = list.data.rows.find(o => o.progress.done < o.progress.total)
  assert(withPending, '应有未完成整改项的单')
  const bad = await call('POST', `/rectify-orders/${withPending.rectifyId}/submit`, {
    body: { itemNos: [1], submitBy: '部门经理' }
  })
  if (withPending.progress.total > 1) {
    eq(bad.status, 422, '未全部完成应 422')
    assert(bad.message.includes('未处理'), `提示应说明还剩几项：${bad.message}`)
  }
  const ok = await call('POST', `/rectify-orders/${withPending.rectifyId}/submit`, {
    body: { submitBy: '部门经理', submitRemark: '已按要求整改' }
  })
  eq(ok.status, 200, 'HTTP 状态')
  assertSchema(ok, 'RectifyEnvelope', 'POST /rectify-orders/{id}/submit')
  eq(ok.data.status, '待复核', '状态')
  eq(ok.data.progress.done, ok.data.progress.total, '提交后应全部完成')
})

test('复核：提交人不能自己复核；通过 → 已闭环；退回 → 整改项归零', async () => {
  const list = await call('GET', '/rectify-orders', { query: { vf: 'recheck', size: 50 } })
  assert(list.data.rows.length >= 2, '样例应有至少 2 张待复核单')
  const [a, b] = list.data.rows

  const self = await call('POST', `/rectify-orders/${a.rectifyId}/recheck`, {
    body: { pass: true, recheckBy: a.submitBy || '部门经理' }
  })
  eq(self.status, 422, '自己复核应 422')

  const pass = await call('POST', `/rectify-orders/${a.rectifyId}/recheck`, {
    body: { pass: true, recheckBy: '品质督导', remark: '现场复核通过' }
  })
  eq(pass.status, 200, 'HTTP 状态')
  eq(pass.data.status, '已闭环', '通过后状态')

  const reject = await call('POST', `/rectify-orders/${b.rectifyId}/recheck`, {
    body: { pass: false, recheckBy: '品质督导', remark: '照片不清晰，重做' }
  })
  eq(reject.status, 200, 'HTTP 状态')
  eq(reject.data.status, '已退回', '退回后状态')
  eq(reject.data.progress.done, 0, '退回应把整改项归零重做')
})


/* ---------------- 第三批：品质检查记录 ---------------- */

test('品质记录列表 schema + 枚举 + 按等级筛选', async () => {
  const r = await call('GET', '/quality-checks', { query: { size: 20 } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'QualityPageEnvelope', 'GET /quality-checks')
  assert(r.data.total > 0, '应有品质记录')
  for (const c of r.data.rows) {
    assert(enums.qualityGrade.values.includes(c.grade), `等级越界：${c.grade}`)
    assert(['现场抽查', '任务评价'].includes(c.sourceType), `来源越界：${c.sourceType}`)
  }
  const bad = await call('GET', '/quality-checks', { query: { grade: '不合格', size: 50 } })
  for (const c of bad.data.rows) assert(c.grade === '不合格' || c.veto, `筛选未生效：${c.checkNo} ${c.grade}`)
})

test('品质记录详情：带出关联整改单', async () => {
  const list = await call('GET', '/quality-checks', { query: { size: 100 } })
  const withRectify = list.data.rows.find(c => c.rectifyCount > 0)
  assert(withRectify, '应有开过整改单的记录')
  const r = await call('GET', `/quality-checks/${withRectify.checkId}`)
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'QualityDetailEnvelope', 'GET /quality-checks/{id}')
  assert(Array.isArray(r.data.rectifies), 'rectifies 应为数组')
  assert(r.data.rectifies.length >= 1, '该记录应能带出整改单')

  const miss = await call('GET', '/quality-checks/QC99999')
  eq(miss.status, 404, '不存在的记录应 404')
})

/* ---------------- 汇总接口：列表页 KPI 不能前端自己 reduce ---------------- */

test('缴费汇总：与列表同口径，分组金额加总等于合计', async () => {
  const all = await call('GET', '/payments/summary')
  eq(all.status, 200, 'HTTP 状态')
  assertSchema(all, 'PaymentSummaryEnvelope', 'GET /payments/summary')

  /* 快捷视图必须和列表同一套过滤，否则「视图 15 笔 / 合计 160 笔」 */
  const cashList = await call('GET', '/payments', { query: { vf: 'cash', size: 1 } })
  const cashSum = await call('GET', '/payments/summary', { query: { vf: 'cash' } })
  eq(cashSum.data.count, cashList.data.total, '汇总笔数应等于同参数列表的 total')
  eq(cashSum.data.cashCount, cashSum.data.count, '现金视图里现金笔数应等于总笔数')
  near(cashSum.data.cashAmount, cashSum.data.amount, '现金视图金额应等于现金合计')

  const bySum = all.data.byMethod.reduce((s, x) => s + x.amount, 0)
  near(bySum, all.data.amount, '按收款方式分组之和应等于合计金额', 0.05)
  const chSum = all.data.byChannel.reduce((s, x) => s + x.amount, 0)
  near(chSum, all.data.amount, '按渠道分组之和应等于合计金额', 0.05)
  assert(all.data.refundAmount >= 0, '退款金额不应为负')
})

test('品质汇总：与列表同口径，不合格含一票否决', async () => {
  const r = await call('GET', '/quality-checks/summary')
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'QualitySummaryEnvelope', 'GET /quality-checks/summary')
  const list = await call('GET', '/quality-checks', { query: { size: 1 } })
  eq(r.data.count, list.data.total, '汇总条数应等于列表 total')
  assert(r.data.avgScore >= 0 && r.data.avgScore <= 100, `平均分越界：${r.data.avgScore}`)
  assert(r.data.unqualified >= r.data.veto, '不合格数应不小于一票否决数（否决也算不合格）')

  const un = await call('GET', '/quality-checks/summary', { query: { grade: '不合格' } })
  eq(un.data.unqualified, un.data.count, '按不合格筛选时，不合格数应等于总条数')
})

/* ---------------- 期次：月报 / 年报 ---------------- */

test('时点型月报：取月末那天，未月结的月份标试算且时点落在今天', async () => {
  const sep = await call('GET', '/reports/arrears', { query: { month: '2026-09', size: 100 } })
  eq(sep.status, 200, 'HTTP 状态')
  assertSchema(sep, 'ArrearsEnvelope', 'GET /reports/arrears?month=')
  eq(sep.data.meta.periodType, '月', '期次粒度')
  eq(sep.data.meta.period, '2026-09', '期次值')
  eq(sep.data.meta.statDate, '2026-09-30', '已月结的月份应取月末那天')
  eq(sep.data.meta.provisional, false, '已月结的月份不是试算值')
  assert(/^RPT-202609-M\d{2}$/.test(sep.data.meta.batchNo), `月批次号格式不对：${sep.data.meta.batchNo}`)

  const oct = await call('GET', '/reports/arrears', { query: { month: '2026-10' } })
  eq(oct.status, 200, '未月结月份也应能出数（试算）')
  eq(oct.data.meta.provisional, true, '未月结的月份必须标试算')
  eq(oct.data.meta.statDate, '2026-10-21', '未月结时点应落在数据集当天，而不是月末（月末还没到）')
})

test('年报拆两张：余额（时点）与发生额（区间）口径不同', async () => {
  /* 余额：一年的最后可得时点，不做整期汇总 */
  const bal = await call('GET', '/reports/arrears', { query: { year: '2026', size: 100 } })
  eq(bal.status, 200, 'HTTP 状态')
  eq(bal.data.meta.periodType, '年', '期次粒度')
  eq(bal.data.meta.period, '2026', '期次值')
  eq(bal.data.meta.statDate, '2026-10-21', '当年未结束，时点落在今天')
  assert(/^RPT-2026-Y\d{2}$/.test(bal.data.meta.batchNo), `年批次号格式不对：${bal.data.meta.batchNo}`)
  for (const r of bal.data.rows) assert(enums.agingBucket.values.includes(r.aging), '年视图仍是余额分档')

  /* 发生额：整年区间重算 */
  const amt = await call('GET', '/reports/collection-rate', { query: { periodType: '年', period: '2026', size: 100 } })
  eq(amt.status, 200, 'HTTP 状态')
  eq(amt.data.meta.periodType, '年', '期次粒度')
  const periods = [...new Set(amt.data.rows.map(r => r.period))].sort()
  assert(periods.length > 1, `年报应覆盖多个账期，实际：${periods.join(',')}`)
  assert(periods.every(p => p.startsWith('2026')), '年报不应混入其它年份的账期')
})

test('期间型月报：按月筛行、合计与明细自洽、带环比', async () => {
  const r = await call('GET', '/reports/collection-rate', { query: { periodType: '月', period: '2026-09', size: 100 } })
  eq(r.status, 200, 'HTTP 状态')
  eq(r.data.meta.period, '2026-09', '期次值')
  assert(r.data.rows.length > 0, '9 月应有账期行')
  for (const x of r.data.rows) eq(x.period, '2026-09', `月报不应混入其它账期：${x.period}`)
  const payable = r.data.rows.reduce((s, x) => s + x.payable, 0)
  near(r.data.summary.payable, payable, '月报合计应等于明细加总', 0.05)
  const cmp = r.data.meta.compare
  assert(cmp, '期间型月报应带环比')
  eq(cmp.prevPeriod, '2026-08', '环比应指向上一个月')
  assert(typeof cmp.prevValue === 'number', '上个月有批次时应给出数值')
})

test('期间型年报表：部门按年累加再算比率，不是 12 个月取平均', async () => {
  const m = await call('GET', '/reports/dept-target', { query: { periodType: '月', period: '2026-10', size: 100 } })
  const y = await call('GET', '/reports/dept-target', { query: { periodType: '年', period: '2026', size: 100 } })
  eq(y.status, 200, 'HTTP 状态')
  for (const r of y.data.rows) eq(r.period, '2026', '年视图的期次应为年')
  assert(y.data.rows.length > 0, '年报应有部门行')
  /* 同一部门：年报表 planned 应 ≥ 该月 planned；且任一行都不能由月行直接平均得出 */
  const mRow = m.data.rows[0]
  const yRow = y.data.rows.find(x => x.orgId === mRow.orgId)
  assert(yRow, '月报里的部门应出现在年报里')
  assert(yRow.planned >= mRow.planned, '年累计任务量不应少于单月')
  near(yRow.weighted, yRow.passRate * yRow.weightPass + yRow.doneRate * yRow.weightDone,
    '年报表的加权达标率必须按年度累计重算', 0.02)
  eq(y.data.meta.compare.prevValue, null, '没有上一年批次时环比应为 null，不能给 0')
})

test('期次参数互斥与格式校验', async () => {
  const both = await call('GET', '/reports/arrears', { query: { month: '2026-09', year: '2025' } })
  eq(both.status, 400, 'statDate / month / year 同时给应 400')
  const badMonth = await call('GET', '/reports/arrears', { query: { month: '2026-13' } })
  eq(badMonth.status, 400, '月份越界应 400')
  const noPeriod = await call('GET', '/reports/collection-rate', { query: { periodType: '月' } })
  eq(noPeriod.status, 400, '给了 periodType 就必须给 period')
  const miss = await call('GET', '/reports/collection-rate', { query: { periodType: '年', period: '2019' } })
  eq(miss.status, 404, '没跑过的期次应 404 / 40402')
  eq(miss.code, 40402, '业务码')
})

test('按月重算：202 → 同粒度新批次，旧批次仍可读', async () => {
  const before = await call('GET', '/reports/dept-target', { query: { periodType: '月', period: '2026-10' } })
  const oldBatch = before.data.meta.batchNo
  const post = await call('POST', '/reports/recalc', {
    body: { reportCode: 'dept-target', periodType: '月', period: '2026-10', note: '月末补跑' }
  })
  eq(post.status, 202, '异步受理')
  eq(post.data.periodType, '月', '任务应记住期次粒度')
  eq(post.data.period, '2026-10', '任务期次值')
  let task = null
  for (let i = 0; i < 5; i++) {
    task = (await call('GET', `/reports/recalc/${post.data.taskId}`)).data
    if (task.status === '成功') break
  }
  eq(task.status, '成功', '重算应成功')
  assert(/^RPT-202610-M\d{2}$/.test(task.batchNo), `按月重算应生成月批次号：${task.batchNo}`)
  assert(task.batchNo !== oldBatch, '应生成新批次而不是覆盖旧批次')
  const after = await call('GET', '/reports/dept-target', { query: { periodType: '月', period: '2026-10' } })
  eq(after.data.meta.batchNo, task.batchNo, '缺省应读取该期次的最新批次')
})

/* ---------------- 第三批：报表快照（跑批产物，不是实时算） ---------------- */

test('统计批次列表：按统计日倒序、失败批次保留但不进 latest', async () => {
  const r = await call('GET', '/reports/snapshots', { query: { limit: 50 } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'SnapshotListEnvelope', 'GET /reports/snapshots')
  const rows = r.data.rows
  assert(rows.length >= 6, `批次太少：${rows.length}`)
  for (let i = 1; i < rows.length; i++) {
    assert(rows[i - 1].statDate >= rows[i].statDate, '批次未按统计日倒序')
  }
  for (const s of rows) {
    /* 日 RPT-20261021-01 / 月 RPT-202610-M01 / 年 RPT-2026-Y01 */
    assert(/^RPT-(\d{8}-\d{2}|\d{6}-M\d{2}|\d{4}-Y\d{2})$/.test(s.batchNo), `批次号格式不对：${s.batchNo}`)
    assert(enums.reportBatchStatus.values.includes(s.status), `批次状态越界：${s.status}`)
  }
  const failed = rows.filter(x => x.status === '失败')
  assert(failed.length >= 1, '样例应保留失败批次（否则测不到「失败不被选中」）')
  assert(r.data.latest, 'latest 不应为空')
  eq(r.data.latest.status, '成功', 'latest 必须是成功批次')
  assert(!failed.some(f => f.batchNo === r.data.latest.batchNo), 'latest 不能是失败批次')

  const one = await call('GET', '/reports/snapshots', { query: { reportCode: 'arrears' } })
  assert(one.data.rows.every(x => x.reportCode === 'arrears'), 'reportCode 过滤未生效')
})

test('三张报表都带 meta（批次/生成时间/公式版本），且 schema 通过', async () => {
  const cases = [
    ['/reports/arrears', 'ArrearsEnvelope'],
    ['/reports/collection-rate', 'CollectionRateEnvelope'],
    ['/reports/dept-target', 'DeptTargetEnvelope']
  ]
  for (const [p, schema] of cases) {
    const r = await call('GET', p, { query: { size: 5 } })
    eq(r.status, 200, `${p} HTTP 状态`)
    assertSchema(r, schema, `GET ${p}`)
    const m = r.data.meta
    for (const k of ['batchNo', 'calcAt', 'dataCutoff', 'formulaVersion']) {
      assert(m[k], `${p} meta.${k} 缺失`)
    }
    eq(m.formulaVersion, 'v1.0', `${p} 公式版本`)
    assert(typeof m.partial === 'boolean' && typeof m.stale === 'boolean', `${p} partial/stale 应为布尔`)
    eq(m.rowCount, r.data.total, `${p} 不带筛选时 rowCount 应等于 total`)
  }
})

test('缺省取最新成功批次；指定历史批次可复现；没跑过的日期 404/40402', async () => {
  const latest = (await call('GET', '/reports/snapshots', { query: { reportCode: 'arrears' } })).data.latest
  const now = await call('GET', '/reports/arrears')
  eq(now.data.meta.batchNo, latest.batchNo, '缺省应取最新成功批次')

  const hist = await call('GET', '/reports/arrears', { query: { statDate: '2026-10-19' } })
  eq(hist.status, 200, '历史批次应可读')
  eq(hist.data.meta.statDate, '2026-10-19', '历史批次统计日')
  eq(hist.data.meta.stale, true, '落后最新批次 >1 天应标 stale')

  const miss = await call('GET', '/reports/arrears', { query: { statDate: '2026-10-05' } })
  eq(miss.status, 404, '没跑过的日期应 404')
  eq(miss.code, 40402, '业务码应为 40402（不是回空表）')
})

test('欠费账龄：合计 = 明细加总，账龄分档合法', async () => {
  const r = await call('GET', '/reports/arrears', { query: { size: 100 } })
  const { rows, summary } = r.data
  assert(rows.length > 0, '应有欠费行')
  const sum = k => rows.reduce((s, x) => s + x[k], 0)
  near(summary.unpaid, sum('unpaid'), '合计欠费应等于明细加总')
  near(summary.payable, sum('payable'), '合计应收应等于明细加总')
  eq(summary.billCount, sum('billCount'), '合计笔数应等于明细加总')
  const overdue = rows.filter(x => x.aging !== '未到期').reduce((s, x) => s + x.unpaid, 0)
  near(summary.overdueUnpaid, overdue, '已逾期欠费应等于非「未到期」档加总')
  /* 排序是口径的一部分：账龄从老到新，同档按欠费倒序（催缴先看欠最久的） */
  const RANK = ['180天以上', '91-180天', '31-90天', '0-30天', '未到期']
  for (let i = 1; i < rows.length; i++) {
    const a = RANK.indexOf(rows[i - 1].aging)
    const b = RANK.indexOf(rows[i].aging)
    assert(a <= b, `账龄排序应为从老到新：${rows[i - 1].aging} → ${rows[i].aging}`)
    if (a === b) assert(rows[i - 1].unpaid >= rows[i].unpaid, `同档应按欠费倒序：${rows[i - 1].buildingName}/${rows[i].buildingName}`)
  }
  for (const x of rows) {
    assert(enums.agingBucket.values.includes(x.aging), `账龄档越界：${x.aging}`)
    assert(x.unpaid <= x.payable + 0.01, `欠费不应大于应收：${x.buildingName} ${x.aging}`)
    assert(x.houseCount <= x.billCount, `涉及房屋数不应大于账单数：${x.buildingName} ${x.aging}`)
    if (x.aging === '未到期') eq(x.avgOverdueDays, 0, '「未到期」行平均逾期天数应为 0')
  }
})

test('收缴率：rate = 已收 ÷ 应收，分母剔除作废与减免', async () => {
  const r = await call('GET', '/reports/collection-rate', { query: { size: 100 } })
  const { rows, summary } = r.data
  assert(rows.length > 0, '应有收缴率行')
  for (const x of rows) {
    if (x.rate === null) {
      eq(x.payable, 0, `rate 为 null 时应收必须为 0（否则是算漏了）：${x.itemName} ${x.period}`)
    } else {
      near(x.rate, (x.paid / x.payable) * 100, `收缴率与金额不符：${x.itemName} ${x.period}`, 0.02)
      assert(x.rate >= 0 && x.rate <= 100, `收缴率越界：${x.rate}`)
    }
    assert(x.reduction >= 0 && x.voided >= 0, '减免/作废金额不应为负')
  }
  const payable = rows.reduce((s, x) => s + x.payable, 0)
  const paid = rows.reduce((s, x) => s + x.paid, 0)
  near(summary.payable, payable, '合计应收')
  near(summary.rate, (paid / payable) * 100, '合计收缴率', 0.02)
})

test('部门达标率：加权达标率与得分按同一份公式，权重和为 1', async () => {
  const r = await call('GET', '/reports/dept-target', { query: { size: 100 } })
  const { rows, summary } = r.data
  assert(rows.length > 0, '应有部门行')
  for (const x of rows) {
    near(x.weightPass + x.weightDone, 1, `权重之和应为 1：${x.deptName}`, 0.001)
    near(x.weighted, x.passRate * x.weightPass + x.doneRate * x.weightDone,
      `加权达标率不符：${x.deptName} ${x.post}`, 0.02)
    eq(x.doneRate, x.planned ? Math.round((x.finished / x.planned) * 10000) / 100 : 0, `完成率不符：${x.deptName}`)
    const expectScore = Math.max(0, Math.round((x.weighted - x.selfIssues * 1 - x.crossIssues * 3) * 10) / 10)
    near(x.score, expectScore, `得分不符：${x.deptName} ${x.score} vs ${expectScore}`, 0.15)
    const wantGrade = x.score >= 90 ? '优秀' : x.score >= 80 ? '良好' : x.score >= 70 ? '合格' : '不合格'
    eq(x.grade, wantGrade, `等级与得分不符：${x.deptName} ${x.score}`)
    assert(x.planned > 0, `不应出现没有执行任务的班子：${x.deptName}（会被误判 0 分）`)
  }
  near(summary.avgWeighted, rows.reduce((s, x) => s + x.weighted, 0) / rows.length, '平均达标率', 0.02)
})

test('快照冻结：同一批次两次读取完全一致', async () => {
  const a = await call('GET', '/reports/arrears', { query: { statDate: '2026-10-19', size: 100 } })
  const b = await call('GET', '/reports/arrears', { query: { statDate: '2026-10-19', size: 100 } })
  eq(JSON.stringify(a.data.rows), JSON.stringify(b.data.rows), '同一批次两次读取应完全一致')
  eq(a.data.meta.batchNo, b.data.meta.batchNo, '批次号应一致')
})

test('重算：202 + 幂等复用；轮询至成功后才产出批次号', async () => {
  const post = await call('POST', '/reports/recalc', {
    body: { reportCode: 'arrears', statDate: '2026-10-22', note: '契约测试补跑' }
  })
  eq(post.status, 202, '重算是异步，应返回 202 而不是 200')
  assertSchema(post, 'ReportTaskEnvelope', 'POST /reports/recalc')
  eq(post.data.status, '运行中', '受理后状态')
  eq(post.data.batchNo, '', '未跑完不应给批次号')

  const dup = await call('POST', '/reports/recalc', {
    body: { reportCode: 'arrears', statDate: '2026-10-22' }
  })
  eq(dup.status, 200, '幂等命中应 200')
  eq(dup.data.reused, true, '幂等命中应标 reused')
  eq(dup.data.taskId, post.data.taskId, '幂等命中应复用同一个任务')

  let task = null
  for (let i = 0; i < 5; i++) {
    const r = await call('GET', `/reports/recalc/${post.data.taskId}`)
    eq(r.status, 200, '任务查询 HTTP 状态')
    task = r.data
    if (task.status === '成功') break
  }
  eq(task.status, '成功', '轮询后应成功')
  eq(task.progress, 100, '成功后进度应为 100')
  assert(task.batchNo, '成功后必须给批次号')

  const now = await call('GET', '/reports/arrears')
  eq(now.data.meta.statDate, '2026-10-22', '新批次应成为缺省统计日')
  eq(now.data.meta.batchNo, task.batchNo, '缺省应读到新批次')

  const old = await call('GET', '/reports/arrears', { query: { statDate: '2026-10-21' } })
  eq(old.status, 200, '旧批次应保留可查（报表要能复现）')

  const miss = await call('GET', '/reports/recalc/RCL-19700101-99')
  eq(miss.status, 404, '不存在的任务应 404')
})

test('物化证据：改了账单，旧批次不动，重算后才变', async () => {
  const before = await call('GET', '/reports/arrears')
  const beforeUnpaid = before.data.summary.unpaid
  const batchNo = before.data.meta.batchNo
  /* 历史批次单独取一次快照当基线：它和最新批次的数字本来就可能不同
     （前面的用例退过款、减过免，而历史批次是服务启动时算的），这正是「物化」该有的样子 */
  const histBefore = await call('GET', '/reports/arrears', { query: { statDate: '2026-10-21', size: 100 } })
  const histUnpaid = histBefore.data.summary.unpaid

  const debt = await call('GET', '/bills', { query: { vf: 'debt', size: 20 } })
  const target = debt.data.rows.find(x => x.houseId && x.unpaid > 1)
  assert(target, '应有可核销的欠费账单')
  const reduced = await call('POST', '/bills/batch-reduce', {
    body: { billIds: [target.billId], reason: '契约测试：欠费核销' }
  })
  eq(reduced.status, 200, '减免 HTTP 状态')
  eq(reduced.data.ok, 1, '应减免 1 笔')

  const still = await call('GET', '/reports/arrears')
  eq(still.data.meta.batchNo, batchNo, '未重算前不应凭空生成新批次')
  near(still.data.summary.unpaid, beforeUnpaid, '快照应冻结：账单变了，历史批次不许跟着变')

  const post = await call('POST', '/reports/recalc', {
    body: { reportCode: 'arrears', statDate: '2026-10-22', note: '核销后重算' }
  })
  eq(post.status, 202, '重算受理')
  let task = null
  for (let i = 0; i < 5; i++) {
    task = (await call('GET', `/reports/recalc/${post.data.taskId}`)).data
    if (task.status === '成功') break
  }
  eq(task.status, '成功', '重算应成功')
  const after = await call('GET', '/reports/arrears')
  eq(after.data.meta.batchNo, task.batchNo, '应读到新批次')
  assert(after.data.summary.unpaid < beforeUnpaid - 0.5,
    `重算后欠费应减少：${beforeUnpaid} → ${after.data.summary.unpaid}`)

  const historic = await call('GET', '/reports/arrears', { query: { statDate: '2026-10-21', size: 100 } })
  near(historic.data.summary.unpaid, histUnpaid, '历史批次（10-21）不应被后来的数据改动污染')
})

test('报表按数据范围裁剪；越界项目 403', async () => {
  const saved = token
  try {
    const gmRows = (await call('GET', '/reports/arrears', { query: { size: 100 } })).data
    token = await login('pm')
    const pmRows = (await call('GET', '/reports/arrears', { query: { size: 100 } })).data
    assert(pmRows.rows.every(x => x.communityId === 'P01'), '项目经理只应看到本项目行')
    assert(pmRows.rows.length <= gmRows.rows.length, '项目视角行数不应多于集团视角')
    const deny = await call('GET', '/reports/arrears', { query: { communityId: 'P02' } })
    eq(deny.status, 403, '越权项目应 403（不是空列表）')
    eq(deny.code, 40301, '越权业务码')

    token = await login('steward')
    const stw = (await call('GET', '/reports/arrears', { query: { size: 100 } })).data
    assert(stw.rows.length <= pmRows.rows.length, '楼管视角行数不应多于项目经理')
    assert(stw.summary.unpaid <= pmRows.summary.unpaid + 0.01, '楼管欠费合计不应大于本项目合计')
    assert(stw.rows.every(x => x.communityId === 'P01'), '楼管只应看到本责任范围内项目')
    const deny2 = await call('GET', '/reports/dept-target', { query: { communityId: 'P03' } })
    eq(deny2.status, 403, '楼管越权项目应 403')

    const dept = (await call('GET', '/reports/dept-target', { query: { size: 100 } })).data
    assert(dept.rows.every(x => x.communityId === 'P01'), '部门达标率同样按范围裁剪')
  } finally {
    token = saved
  }
})

test('参数校验：statDate 格式、limit 越界、reportCode 非法 → 400', async () => {
  const badDate = await call('GET', '/reports/arrears', { query: { statDate: '2026-13-40' } })
  eq(badDate.status, 400, 'statDate 格式非法应 400')
  const badLimit = await call('GET', '/reports/snapshots', { query: { limit: 999 } })
  eq(badLimit.status, 400, 'limit 越界应 400')
  const badCode = await call('GET', '/reports/snapshots', { query: { reportCode: 'nope' } })
  eq(badCode.status, 400, 'reportCode 非法应 400')
  const noStat = await call('POST', '/reports/recalc', { body: { reportCode: 'arrears' } })
  eq(noStat.status, 400, '重算缺 statDate 应 400')
})

/* ---------------- 月结：期间关账 ---------------- */

test('月结预览：与流水/账单同源，未结账才可结，上月净额有值', async () => {
  const r = await call('GET', '/month-closes/preview', { query: { period: '2026-10' } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'MonthClosePreviewEnvelope', 'GET /month-closes/preview')
  const d = r.data
  eq(d.period, '2026-10', '期间')
  eq(d.closable, true, '未结账的当月应可结')
  assert(d.count > 0, '当月应有收款笔数')
  near(d.net, d.income - d.refund, '净额 = 收款 − 退款')
  near(d.count, d.rows.reduce((s, x) => s + x.count, 0), '总笔数应等于各方式笔数之和')
  near(d.income, d.rows.reduce((s, x) => s + x.amount, 0), '收款合计应等于各方式之和', 0.05)
  eq(d.prevPeriod, '2026-09', '环比期间应指向上一个月')
  assert(typeof d.prevNet === 'number', '上月已结账，prevNet 应给出数值')
  /* 预览数字必须与列表同源：拿流水汇总接口交叉验证 */
  const sum = await call('GET', '/payments/summary', {
    query: { startDate: '2026-10-01', endDate: '2026-10-31' }
  })
  eq(d.count, sum.data.count, '月结笔数必须等于同期间流水列表笔数（同一份数据源）')
  near(d.income, sum.data.amount, '月结收款必须等于同期间流水合计', 0.05)
})

/** 全公司结账的前置：先把每个项目结掉（汇总前明细必须清） */
async function closeAllProjects(period, memo = '各项目月结') {
  const res = []
  for (const cid of ['P01', 'P02', 'P03']) {
    res.push(await call('POST', '/month-closes', { body: { period, communityId: cid, memo } }))
  }
  return res
}

test('月结校验顺序：未来期间 422、格式错 400、空说明 422 且点名笔数', async () => {
  const fut = await call('POST', '/month-closes', { body: { period: '2026-12', memo: '提前结一下' } })
  eq(fut.status, 422, '未来期间不能提前月结')
  const badFmt = await call('POST', '/month-closes', { body: { period: '2026-13' } })
  eq(badFmt.status, 400, '月份越界应 400')

  /* 全公司结账的前置：有业务的项目必须先结 */
  const needProj = await call('POST', '/month-closes', { body: { period: '2026-10', memo: '直接全公司结' } })
  eq(needProj.status, 422, '有业务的项目未结时不能全公司结')
  assert(/翡翠城/.test(needProj.message), `要点名未结项目，实际：${needProj.message}`)

  /* 用项目级来测 memo 校验：全公司结账会被「项目未结」前置先拦住，测不到这一条 */
  const noMemo = await call('POST', '/month-closes', { body: { period: '2026-10', communityId: 'P01' } })
  eq(noMemo.status, 422, '有未核销事项时说明必填')
  assert(/未开票|欠费/.test(noMemo.message), `提示应点名具体未核销项，实际：${noMemo.message}`)
  /* 拦住了就要真的没写进去 */
  const pv = await call('GET', '/month-closes/preview', { query: { period: '2026-10', communityId: 'P01' } })
  eq(pv.data.closable, true, '被拦下的提交不应改变状态')
})

test('提交月结：记录与预览同源，同期间不能重复提交（409/40904）', async () => {
  const pre = await call('GET', '/month-closes/preview', { query: { period: '2026-10' } })
  const projRes = await closeAllProjects('2026-10')
  const p01 = projRes.find(r => r.status === 201)
  assert(p01, '项目级结账应成功')
  eq(p01.data.scope, 'community', '项目级结账的 scope 应为 community')
  eq(p01.data.communityId, 'P01', '记录要带项目 ID')
  assert(/^YJ-202610-P01-01$/.test(p01.data.closeNo), `项目级单号应带项目号：${p01.data.closeNo}`)
  const r = await call('POST', '/month-closes', { body: { period: '2026-10', memo: '10 月欠费转 11 月催缴，未开票下月补开' } })
  assert(r.status === 201, `全公司结账应成功，实际 ${r.status} ${r.message || ''}`)
  assertSchema(r, 'MonthCloseEnvelope', 'POST /month-closes')
  const d = r.data
  eq(d.status, '已结账', '状态')
  eq(d.locked, true, '结账后应锁定')
  assert(/^YJ-202610-\d{2}$/.test(d.closeNo), `结账单号格式不对：${d.closeNo}`)
  /* 结完记录里的数字必须和预览一致——这是"同源"最直接的证据 */
  eq(d.count, pre.data.count, '结账笔数应与预览一致')
  near(d.income, pre.data.income, '结账收款应与预览一致')
  near(d.net, pre.data.net, '结账净额应与预览一致')
  near(d.receivable, pre.data.receivable, '应收应与预览一致')
  near(d.debt, pre.data.debt, '欠费应与预览一致')

  const dup = await call('POST', '/month-closes', { body: { period: '2026-10', memo: '再结一次' } })
  eq(dup.status, 409, '重复提交月结应 409')
  eq(dup.code, 40904, '业务码应为 40904（已月结），不是 40901（版本冲突）')

  const pv = await call('GET', '/month-closes/preview', { query: { period: '2026-10' } })
  eq(pv.data.closable, false, '已结账后不可再结')
  assert(pv.data.closed, '预览应带出已有结账记录')
})

test('反结：原因不足 10 字 422；成功后留痕且期间恢复可写', async () => {
  const list = await call('GET', '/month-closes', { query: { year: '2026' } })
  assertSchema(list, 'MonthClosePageEnvelope', 'GET /month-closes')
  /* 10 月现在有 4 条记录（3 个项目 + 1 个全公司），反结测的是全公司那条 */
  const rec = list.data.rows.find(x => x.period === '2026-10' && !x.communityId)
  assert(rec, '10 月全公司结账记录应存在')
  eq(rec.scope, 'group', '全公司结账的 scope 应为 group')

  const short = await call('POST', `/month-closes/${rec.closeId}/reopen`, { body: { reason: '错了' } })
  eq(short.status, 422, '反结原因过短应 422')

  const r = await call('POST', `/month-closes/${rec.closeId}/reopen`, {
    body: { reason: '10 月漏记一笔车位费收款，需补录后重新结账' }
  })
  eq(r.status, 200, 'HTTP 状态')
  eq(r.data.status, '已反结', '状态应转已反结')
  eq(r.data.locked, false, '反结后应解锁')
  eq(r.data.reopenCount, 1, '反结次数应记 1')
  assert(/^HC-202610-\d{2}$/.test(r.data.reversalNo), `红冲凭证号格式不对：${r.data.reversalNo}`)
  assert(r.data.reopenReason.length >= 10, '反结原因应留存')

  const again = await call('POST', `/month-closes/${rec.closeId}/reopen`, { body: { reason: '再反结一次试试看行不行呢' } })
  eq(again.status, 409, '重复反结应 409')
  eq(again.code, 40905, '业务码应为 40905')

  /* 全公司反结要级联反结项目级记录，否则明细还锁着，反结之后依然补录不了 */
  const allCloses = await call('GET', '/month-closes', { query: { year: '2026', size: 50 } })
  const p01rec = allCloses.data.rows.find(x => x.period === '2026-10' && x.communityId === 'P01')
  assert(p01rec, '10 月项目级结账记录应存在')
  eq(p01rec.status, '已反结', '全公司反结应级联反结项目级结账')

  const pv = await call('GET', '/month-closes/preview', { query: { period: '2026-10' } })
  eq(pv.data.closable, true, '反结后该期间应恢复可结')
  const pvProj = await call('GET', '/month-closes/preview', { query: { period: '2026-10', communityId: 'P01' } })
  eq(pvProj.data.closable, true, '项目级也应恢复可结（级联反结的效果）')
  eq(pvProj.data.scope, 'community', '项目级预览的 scope')
  eq(pvProj.data.unclosedCommunities.length, 0, '项目级预览不该有"未结项目"列表')
})

test('反结作废该期间报表批次（保留可查），重结后转定稿且批次递增', async () => {
  const before = await call('GET', '/reports/collection-rate', { query: { periodType: '月', period: '2026-10' } })
  eq(before.status, 200, '反结后该期间报表仍可读（作废不删除）')
  eq(before.data.meta.provisional, true, '反结后报表应回到试算')
  eq(before.data.meta.voided, true, '被反结的批次应标作废')
  const voidedBatch = before.data.meta.batchNo

  await closeAllProjects('2026-10', '补录后各项目重结')
  const again = await call('POST', '/month-closes', { body: { period: '2026-10', memo: '补录车位费后重新结账' } })
  eq(again.status, 201, '重结应成功')
  assert(/-02$/.test(again.data.closeNo), `重结应生成新单号而不是覆盖旧单号：${again.data.closeNo}`)
  eq(again.data.reopenCount !== undefined, true, '记录应有反结次数')

  const after = await call('GET', '/reports/collection-rate', { query: { periodType: '月', period: '2026-10' } })
  eq(after.data.meta.provisional, false, '重结后报表应转定稿')
  assert(!after.data.meta.voided, '重结后的新批次不应带作废标记')
  assert(after.data.meta.batchNo !== voidedBatch, `重结应生成新批次：${after.data.meta.batchNo}`)
})

test('已月结期间的流水只读：退款 409/40903，反结后才可退', async () => {
  const pays = await call('GET', '/payments', { query: { startDate: '2026-08-01', endDate: '2026-08-31', size: 1 } })
  const pay = pays.data.rows[0]
  assert(pay, '8 月应有流水')

  const locked = await call('POST', `/payments/${pay.payId}/refund`, { body: { reason: '客户要求退款', amount: 10 } })
  eq(locked.status, 409, '已月结期间的流水不能直接退')
  eq(locked.code, 40903, '业务码应为 40903（期间只读）')
  assert(/反结/.test(locked.message), `提示应告诉用户先反结，实际：${locked.message}`)

  /* 反结 8 月后同一笔就能退了 —— 证明拦截来自"期间锁定"而不是别的规则 */
  const aug = (await call('GET', '/month-closes', { query: { year: '2026' } })).data.rows.find(x => x.period === '2026-08')
  const ro = await call('POST', `/month-closes/${aug.closeId}/reopen`, { body: { reason: '8 月漏记一笔退款，需补做后重结' } })
  eq(ro.status, 200, '反结 8 月应成功')
  const ok = await call('POST', `/payments/${pay.payId}/refund`, { body: { reason: '客户要求退款', amount: 10 } })
  eq(ok.status, 200, '反结后应允许退款')
  eq(ok.code, 0, '退款业务码')
})

/* ---------------- 员工档案（人事口径，不含薪资） ---------------- */

test('员工列表：手机 / 证件恒掩码，绝不返回薪资字段', async () => {
  const r = await call('GET', '/employees', { query: { size: 100 } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'EmployeePageEnvelope', 'GET /employees')
  assert(r.data.total > 0, '应有员工数据')
  for (const e of r.data.rows) {
    assert(/^\d{3}\*{4}\d{4}$/.test(e.phone || ''), `手机号必须掩码，实际：${e.phone}`)
    assert(e.phoneRedacted === true && e.idCardRedacted === true, `${e.empId} 应标记为已脱敏`)
    const keys = Object.keys(e)
    for (const k of ['baseSalary', 'monthlySalary', 'bankCard', 'salary']) {
      assert(!keys.includes(k), `${e.empId} 不该返回薪资字段 ${k}——员工域不管工资`)
    }
    eq(e.assignable, e.status !== '离职', `${e.empId} 的 assignable 与状态不一致`)
    if (e.status === '离职') eq(e.roleId, null, `${e.empId} 已离职，roleId 必须为空（离职即收权）`)
  }
})

test('员工汇总与列表同源；快捷视图命中数逐项一致', async () => {
  const list = await call('GET', '/employees', { query: { size: 1 } })
  const sum = await call('GET', '/employees/summary')
  eq(sum.status, 200, 'HTTP 状态')
  assertSchema(sum, 'EmployeeSummaryEnvelope', 'GET /employees/summary')
  eq(sum.data.total, list.data.total, '汇总 total 必须等于列表 total（同一套谓词）')
  eq(sum.data.onjob + sum.data.probation + sum.data.left, sum.data.total,
    '在职 + 试用 + 离职 应正好等于总数，不能有第三种状态')
  for (const vf of ['onjob', 'probation', 'noRole', 'contractExpired']) {
    const v = await call('GET', '/employees', { query: { vf, size: 1 } })
    eq(v.data.total, sum.data[vf], `vf=${vf} 的命中数应等于汇总分项`)
  }
  assert(sum.data.contractExpiring >= 1, '30 天内到期的至少 1 人（EM0001 合同 2026-10-23 到期）')
})

test('组织树：人数含子树，根节点人数之和等于总人数', async () => {
  const r = await call('GET', '/employees/org-tree')
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'OrgTreeEnvelope', 'GET /employees/org-tree')
  const roots = r.data.roots
  assert(roots.length >= 3, `根应有 3 个项目 + 总部，实际 ${roots.length}`)
  const walk = n => {
    assert(n.headcount >= n.selfHeadcount, `${n.name}：含子树人数 ${n.headcount} < 本节点 ${n.selfHeadcount}`)
    if (!n.children) return n.headcount
    const sum = n.children.reduce((s, c) => s + walk(c), 0)
    assert(n.headcount >= sum, `${n.name}：${n.headcount} 小于子节点之和 ${sum}`)
    return n.headcount
  }
  const total = roots.reduce((s, n) => s + walk(n), 0)
  const sum = await call('GET', '/employees/summary')
  eq(total, sum.data.total, '树上人数之和必须等于总人数——否则有员工在两个视图里凭空消失')
})

test('员工详情：组织全路径 / 角色来源 / 工资条只给 null', async () => {
  const list = await call('GET', '/employees', { query: { size: 100 } })
  const target = list.data.rows.find(e => e.status === '在职' && e.roleId)
  assert(target, '应有在职且有角色的员工')
  const r = await call('GET', `/employees/${target.empId}`)
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'EmployeeDetailEnvelope', 'GET /employees/{id}')
  eq(r.data.employee.name, target.name, '详情应是同一个人')
  eq(r.data.employee.orgId, target.orgId, '详情与列表的组织归属必须一致')
  assert(r.data.org.path.includes('/'), `组织路径应为全路径，实际：${r.data.org.path}`)
  assert(['position', 'override'].includes(r.data.employee.roleSource),
    `roleSource 非法：${r.data.employee.roleSource}`)
  assert(Array.isArray(r.data.role.domains), '角色应带业务域（权限抽屉要画）')
  eq(r.data.related.payrollRecords, null, '员工域不统计工资条：给 null 不给 0')
  const miss = await call('GET', '/employees/EM9999')
  eq(miss.status, 404, '不存在的员工应 404')
})

test('揭示敏感字段：必须写原因并留痕；无权限账号 403', async () => {
  const list = await call('GET', '/employees', { query: { size: 5 } })
  const e0 = list.data.rows[0]
  const short = await call('POST', `/employees/${e0.empId}/reveal`, {
    body: { fields: ['phone'], reason: '看看' }
  })
  eq(short.status, 422, '原因不足 4 字应 422（不写原因等于没审计）')

  const ok = await call('POST', `/employees/${e0.empId}/reveal`, {
    body: { fields: ['phone', 'idCard'], reason: '核对劳动合同签署信息' }
  })
  eq(ok.status, 200, 'HTTP 状态')
  assertSchema(ok, 'SensitiveRevealEnvelope', 'POST /employees/{id}/reveal')
  eq(ok.data.fields.length, 2, '应回两个字段的明文')
  assert(/^\d{11}$/.test(ok.data.fields[0].value), `应回明文手机号，实际：${ok.data.fields[0].value}`)
  assert(/^AL\d+/.test(ok.data.accessLogId || ''), '必须返回访问日志号，没留痕的揭示等于没发生')
  assert(ok.data.reason.includes('劳动合同'), '原因要原样记下来')

  await asRole('steward', async () => {
    const deny = await call('POST', `/employees/${e0.empId}/reveal`, {
      body: { fields: ['phone'], reason: '核对联系方式' }
    })
    eq(deny.status, 403, '无权揭示应 403')
    eq(deny.code, 40301, '业务码')
  })
})

test('修改档案：只读字段明确拒绝，改手机号要原因，版本冲突 40901', async () => {
  const list = await call('GET', '/employees', { query: { size: 100 } })
  const e0 = list.data.rows.find(e => e.status === '在职')

  const ro = await call('PATCH', `/employees/${e0.empId}`, { body: { patch: { roleId: 'R-GM' } } })
  eq(ro.status, 422, '改角色必须走专用接口，直接改字段应 422（不能静默忽略）')
  const sal = await call('PATCH', `/employees/${e0.empId}`, { body: { patch: { baseSalary: 99999 } } })
  eq(sal.status, 422, '员工域不能改薪资')
  const noReason = await call('PATCH', `/employees/${e0.empId}`, {
    body: { patch: { phone: '13900001111' } }
  })
  eq(noReason.status, 422, '改手机号不写原因应 422')
  const stale = await call('PATCH', `/employees/${e0.empId}`, {
    body: { patch: { level: 'P9' }, ver: 999 }
  })
  eq(stale.status, 409, '版本不符应 409')
  eq(stale.code, 40901, '业务码应为乐观锁冲突')

  const ok = await call('PATCH', `/employees/${e0.empId}`, {
    body: { patch: { phone: '13900001111', level: 'P9' }, ver: e0._ver, reason: '换号并调级' }
  })
  eq(ok.status, 200, 'HTTP 状态')
  assertSchema(ok, 'EmployeeEnvelope', 'PATCH /employees/{id}')
  eq(ok.data.phone, '139****1111', '返回的仍是掩码')
  eq(ok.data.level, 'P9', '改后的字段应生效')
  assert(ok.data._ver > e0._ver, '版本号应递增')
})

test('调整角色：写覆盖不改岗位；重复调 409/40911；离职 409/40910', async () => {
  const list = await call('GET', '/employees', { query: { size: 100 } })
  const e0 = list.data.rows.find(e => e.status === '在职' && e.roleId !== 'R-SEC')
  const beforePos = e0.position

  const r = await call('PATCH', `/employees/${e0.empId}/role`, {
    body: { roleId: 'R-SEC', reason: '临时兼管项目部' }
  })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'EmployeeRoleChangeEnvelope', 'PATCH /employees/{id}/role')
  eq(r.data.to.roleId, 'R-SEC', '角色已切换')
  eq(r.data.employee.position, beforePos, '调角色不该动岗位（岗位是人事口径）')
  eq(r.data.employee.roleSource, 'override', '人工调整必须标记为 override')
  eq(r.data.affected.length, 2, '应回两个受影响角色的人数')
  for (const a of r.data.affected) assert(a.userCount >= 0, `${a.roleName} 人数不能为负`)

  const dup = await call('PATCH', `/employees/${e0.empId}/role`, { body: { roleId: 'R-SEC' } })
  eq(dup.status, 409, '已是该角色应 409')
  eq(dup.code, 40911, '业务码 40911')

  const left = list.data.rows.find(e => e.status === '离职')
  const deny = await call('PATCH', `/employees/${left.empId}/role`, { body: { roleId: 'R-CS' } })
  eq(deny.status, 409, '离职员工不能调角色')
  eq(deny.code, 40910, '业务码 40910')

  const miss = await call('PATCH', `/employees/${e0.empId}/role`, { body: { roleId: 'R-NONE' } })
  eq(miss.status, 404, '角色不存在应 404（不是 422）')
})

test('调岗清覆盖：角色按新岗位重算，不保留上一任权限', async () => {
  const list = await call('GET', '/employees', { query: { size: 100 } })
  const e0 = list.data.rows.find(e => e.status === '在职' && e.roleSource === 'override')
  assert(e0, '上一条用例应已产生一条 override 记录')
  const r = await call('PATCH', `/employees/${e0.empId}`, {
    body: { patch: { position: '保安' }, ver: e0._ver }
  })
  eq(r.status, 200, 'HTTP 状态')
  assert(r.data.roleRecalculated, '调岗后应返回角色重算结果')
  eq(r.data.roleSource, 'position', '调岗必须清掉覆盖，回到岗位反推')
  eq(r.data.roleName, '秩序维护员', '保安岗位应对应「秩序维护员」角色')
})

test('员工按数据范围裁剪：项目经理只看本项目；楼管无档案权限但能选人', async () => {
  const full = await call('GET', '/employees', { query: { size: 100 } })
  await asRole('pm', async () => {
    const r = await call('GET', '/employees', { query: { size: 100 } })
    eq(r.status, 200, 'HTTP 状态')
    assert(r.data.total > 0, '项目经理应能看到本项目员工')
    assert(r.data.total < full.data.total, `应少于全量（${r.data.total} vs ${full.data.total}）`)
    for (const e of r.data.rows) {
      eq(e.projName, '翡翠城项目部', `${e.empId} 归属「${e.projName}」，超出项目经理范围`)
    }
  })
  await asRole('steward', async () => {
    const r = await call('GET', '/employees', { query: { size: 5 } })
    eq(r.status, 403, '楼管没有 c.employees.view，看档案应 403（不是空列表）')
    eq(r.code, 40301, '业务码')
    /* 但选人下拉要能用：排班与派单都需要选人 */
    const opts = await call('GET', '/employees/options', { query: { size: 10 } })
    eq(opts.status, 200, '选人下拉不该要求档案权限')
    assertSchema(opts, 'EmployeeOptionsEnvelope', 'GET /employees/options')
    eq(opts.data.rows.length, opts.data.total, '下拉的 total 应等于返回条数')
    for (const o of opts.data.rows) {
      assert(!('phone' in o), '选人下拉不该带手机号')
      eq(o.assignable, true, '下拉只给可指派的人（离职的不出现）')
    }
  })
})

test('新增成员：工号服务端生成、默认无角色、手机号唯一', async () => {
  const before = await call('GET', '/employees', { query: { size: 1 } })
  const r = await call('POST', '/employees', {
    body: { name: '测试新人', orgId: 'O-P01', position: '客服专员', phone: '13700001234', empNo: '前端传的工号' }
  })
  eq(r.status, 201, 'HTTP 状态')
  assertSchema(r, 'EmployeeEnvelope', 'POST /employees')
  assert(r.data.empId.startsWith('EM'), `工号应由服务端生成，实际：${r.data.empId}`)
  assert(r.data.empNo !== '前端传的工号', '前端传的工号必须被忽略')
  eq(r.data.roleSource, 'position', '新员工角色由岗位反推，不是建档案时手填')
  eq(r.data.roleId, 'R-CS', '客服专员岗位对应「客服专员」角色')
  eq(r.data.status, '在职', '默认在职')
  const after = await call('GET', '/employees', { query: { size: 1 } })
  eq(after.data.total, before.data.total + 1, '列表应多一人')

  const dup = await call('POST', '/employees', {
    body: { name: '重号测试', orgId: 'O-P01', position: '客服专员', phone: '13700001234' }
  })
  eq(dup.status, 409, '手机号重复应 409')
  eq(dup.code, 40902, '业务码 40902')

  const orphan = await call('POST', '/employees', {
    body: { name: '无角色岗', orgId: 'O-P01', position: '园艺师' }
  })
  eq(orphan.data.roleId, null, '岗位没配角色时应为「未分配」，不能给个默认宽角色')

  const bad = await call('POST', '/employees', { body: { name: '缺组织', position: '客服专员' } })
  eq(bad.status, 422, '缺所属组织应 422')
  const badPhone = await call('POST', '/employees', {
    body: { name: '错号', orgId: 'O-P01', position: '客服专员', phone: '12345' }
  })
  eq(badPhone.status, 422, '手机号格式错应 422')
})

test('员工列表支持 E 域数据范围视图（服务端过滤，不是前端筛当前页）', async () => {
  const all = await call('GET', '/employees', { query: { size: 1 } })
  for (const vf of ['selfOnly', 'deptOnly', 'groupAll']) {
    const r = await call('GET', '/employees', { query: { vf, size: 100 } })
    eq(r.status, 200, `vf=${vf}`)
    assert(r.data.total <= all.data.total, `vf=${vf} 是子集`)
    if (vf === 'selfOnly') {
      for (const e of r.data.rows) eq(e.dataScope, '仅本人', 'selfOnly 里只能有「仅本人」范围的人')
    }
    if (vf === 'groupAll') {
      for (const e of r.data.rows) eq(e.dataScope, '全部项目', 'groupAll 里只能有「全部项目」范围的人')
    }
  }
  const byScope = await call('GET', '/employees', { query: { dataScope: '仅本人', size: 100 } })
  const byVf = await call('GET', '/employees', { query: { vf: 'selfOnly', size: 100 } })
  eq(byScope.data.total, byVf.data.total, 'dataScope 与 vf=selfOnly 应命中同一批人')
})

/* ---------------- 工资表（核算快照） ---------------- */

const PAY_PERIOD = '2026-10'

test('工资列表：每行金额自洽，银行卡只回后四位', async () => {
  const r = await call('GET', '/payrolls', { query: { period: PAY_PERIOD, size: 100 } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'PayrollPageEnvelope', 'GET /payrolls')
  assert(r.data.total > 0, '应有工资行')
  for (const p of r.data.rows) {
    near(p.netPay, p.grossPay - p.deductionTotal, `工资条 ${p.payrollId} 实发 ≠ 应发 − 代扣`, 0.02)
    near(p.grossPay, p.base + p.performance + p.overtime + p.allowance,
      `工资条 ${p.payrollId} 应发 ≠ 各项之和`, 0.02)
    assert(/^\*{4} \*{4} \*{4} \d{4}$/.test(p.bankCardMasked || ''),
      `银行卡必须掩码，实际：${p.bankCardMasked}`)
    const keys = Object.keys(p)
    for (const k of ['bankCard', 'phone', 'idCard']) {
      assert(!keys.includes(k), `工资行不该返回 ${k}——工资域不是员工档案的后门`)
    }
    assert(['草稿', '已核算', '待发放审批', '已发放', '已冲正'].includes(p.status),
      `状态非法：${p.status}`)
  }
})

test('工资汇总 = 行加总；已冲正单列不混进实发', async () => {
  const list = await call('GET', '/payrolls', { query: { period: PAY_PERIOD, size: 100 } })
  const sum = await call('GET', '/payrolls/summary', { query: { period: PAY_PERIOD } })
  eq(sum.status, 200, 'HTTP 状态')
  assertSchema(sum, 'PayrollSummaryEnvelope', 'GET /payrolls/summary')
  eq(sum.data.employeeCount, list.data.total, '汇总人数必须等于列表 total')
  const alive = list.data.rows.filter(p => p.status !== '已冲正')
  near(sum.data.grossTotal, alive.reduce((s, p) => s + p.grossPay, 0), '应发合计 = 行加总', 0.05)
  near(sum.data.netTotal, alive.reduce((s, p) => s + p.netPay, 0), '实发合计 = 行加总', 0.05)
  near(sum.data.netTotal, sum.data.grossTotal - sum.data.deductionTotal, '实发 = 应发 − 代扣', 0.05)
  eq(sum.data.reversedCount, list.data.rows.filter(p => p.status === '已冲正').length,
    '冲正笔数单列')
})

test('期次列表：状态与列表一致；不带 period 时取最新一期', async () => {
  const ps = await call('GET', '/payrolls/periods')
  eq(ps.status, 200, 'HTTP 状态')
  assertSchema(ps, 'PayrollPeriodsEnvelope', 'GET /payrolls/periods')
  assert(ps.data.rows.length >= 2, '至少应有 9 月与 10 月两期（同一套样例）')
  const oct = ps.data.rows.find(p => p.period === PAY_PERIOD)
  assert(oct, `期次列表应含 ${PAY_PERIOD}`)
  eq(oct.status, '草稿', '10 月样例应为草稿')

  const latest = ps.data.rows[0].period
  const none = await call('GET', '/payrolls', { query: { size: 1 } })
  const explicit = await call('GET', '/payrolls', { query: { period: latest, size: 1 } })
  eq(none.data.total, explicit.data.total, '缺省 period 应等于最新一期')
})

test('工资条详情：calc 分解项加总还原应发与实发', async () => {
  const list = await call('GET', '/payrolls', { query: { period: PAY_PERIOD, size: 5 } })
  const target = list.data.rows[0]
  const r = await call('GET', `/payrolls/${target.payrollId}`)
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'PayrollDetailEnvelope', 'GET /payrolls/{id}')
  const g = r.data.calc.gross.reduce((s, i) => s + i.amount, 0)
  const d = r.data.calc.deductions.reduce((s, i) => s + i.amount, 0)
  near(g, target.grossPay, '应发分解项之和 = grossPay', 0.02)
  near(d, target.deductionTotal, '代扣分解项之和 = deductionTotal', 0.02)
  near(r.data.calc.netPay, target.netPay, 'calc.netPay 与行一致', 0.02)
  assert(Array.isArray(r.data.timeline) && r.data.timeline.length > 0, '应带事件时间线')
  eq(r.data.bankCard.revealable, true, 'gm 有双权限，应可揭示')
  const miss = await call('GET', '/payrolls/PR0000-0000')
  eq(miss.status, 404, '不存在的工资条应 404')
})

test('状态机：草稿不能直接发放，先核算再提交；重复核算 409/40914', async () => {
  const early = await call('POST', `/payrolls/${PAY_PERIOD}/pay`, { body: { payDate: '2026-11-10' } })
  eq(early.status, 409, '草稿直接提交发放应 409')
  eq(early.code, 40914, '业务码 40914（状态不允许，不是参数错）')

  const ok = await call('POST', `/payrolls/${PAY_PERIOD}/confirm`)
  eq(ok.status, 200, 'HTTP 状态')
  assertSchema(ok, 'PayrollPeriodEnvelope', 'POST /payrolls/{period}/confirm')
  eq(ok.data.status, '已核算', '核算后状态应为已核算')
  assert(ok.data.employeeCount > 0, '核算应带人数')

  const twice = await call('POST', `/payrolls/${PAY_PERIOD}/confirm`)
  eq(twice.status, 409, '重复核算应 409')
  eq(twice.code, 40914, '业务码 40914')

  /* 已核算后不能再重算：金额已经锁了 */
  const regen = await call('POST', '/payrolls/generate', { body: { period: PAY_PERIOD, overwrite: true } })
  eq(regen.status, 409, '已核算期不能重算')
  eq(regen.code, 40913, '业务码 40913（已锁定）')
})

test('审批双人原则：提交人不能批自己的单，换人才能通过', async () => {
  const sub = await call('POST', `/payrolls/${PAY_PERIOD}/pay`, { body: { payDate: '2026-11-10' } })
  eq(sub.status, 200, 'HTTP 状态')
  eq(sub.data.status, '待发放审批', '提交后应进入待审批')
  assert(sub.data.batchNo, '应生成代发批次号')

  const self = await call('POST', `/payrolls/${PAY_PERIOD}/approve`, { body: { decision: 'approve' } })
  eq(self.status, 409, '提交人自己审批应 409')
  eq(self.code, 40915, '业务码 40915（双人原则）')

  await asRole('pm', async () => {
    const bad = await call('POST', `/payrolls/${PAY_PERIOD}/approve`, { body: { decision: 'reject', reason: '太短' } })
    eq(bad.status, 422, '驳回不写原因应 422')
    const ok = await call('POST', `/payrolls/${PAY_PERIOD}/approve`, { body: { decision: 'approve' } })
    eq(ok.status, 200, '换人审批应通过')
    eq(ok.data.status, '已发放', '审批通过后状态为已发放')
    assert(ok.data.paidAt, '应记录发放时间')
  })
})

test('冲正：只对已发放；冲正后不进汇总的实发', async () => {
  const before = await call('GET', '/payrolls/summary', { query: { period: PAY_PERIOD } })
  const list = await call('GET', '/payrolls', { query: { period: PAY_PERIOD, size: 100 } })
  const target = list.data.rows[0]

  const short = await call('POST', `/payrolls/${target.payrollId}/reverse`, { body: { reason: '退票' } })
  eq(short.status, 422, '冲正原因不足 10 字应 422（这笔要留档）')

  const ok = await call('POST', `/payrolls/${target.payrollId}/reverse`, {
    body: { reason: '银行卡已注销，代发退票，需重新收款' }
  })
  eq(ok.status, 200, 'HTTP 状态')
  assertSchema(ok, 'PayrollEnvelope', 'POST /payrolls/{id}/reverse')
  eq(ok.data.status, '已冲正', '冲正后行状态为已冲正')
  assert(ok.data.reversedAt, '应记录冲正时间')

  const after = await call('GET', '/payrolls/summary', { query: { period: PAY_PERIOD } })
  eq(after.data.reversedCount, before.data.reversedCount + 1, '冲正笔数 +1')
  near(after.data.reversedAmount, before.data.reversedAmount + target.netPay, '冲正金额累计', 0.02)
  near(after.data.netTotal, before.data.netTotal - target.netPay,
    '实发合计要扣掉冲正的那笔——钱已经退回去了', 0.02)

  /* 已冲正的不能再冲一次 */
  const again = await call('POST', `/payrolls/${target.payrollId}/reverse`, {
    body: { reason: '再冲一次试试看会不会重复扣钱' }
  })
  eq(again.status, 409, '已冲正不能重复冲正')
  eq(again.code, 40914, '业务码 40914')
})

test('仅本人视角：只回自己那一条，不是下发全表让前端藏', async () => {
  await asRole('staff', async () => {
    const r = await call('GET', '/payrolls', { query: { period: PAY_PERIOD, size: 100 } })
    eq(r.status, 200, 'HTTP 状态')
    eq(r.data.total, 1, '「仅本人」应只回 1 条（下放全表再前端隐藏 = 没做隔离）')
    eq(r.data.rows[0].empId, 'EM0020', '回的是自己那条')
    const sum = await call('GET', '/payrolls/summary', { query: { period: PAY_PERIOD } })
    eq(sum.data.employeeCount, 1, '汇总也应按可见范围算')
  })
})

test('银行卡揭示：双权限；只有 payroll.view 的人 403', async () => {
  const list = await call('GET', '/payrolls', { query: { period: PAY_PERIOD, size: 1 } })
  const id = list.data.rows[0].payrollId

  const short = await call('POST', `/payrolls/${id}/reveal`, { body: { reason: '看' } })
  eq(short.status, 422, '原因不足 4 字应 422')

  const ok = await call('POST', `/payrolls/${id}/reveal`, { body: { reason: '制作 10 月代发文件' } })
  eq(ok.status, 200, 'HTTP 状态')
  assertSchema(ok, 'BankCardRevealEnvelope', 'POST /payrolls/{id}/reveal')
  assert(/^\d{19}$/.test(ok.data.bankCard), `应回 19 位完整卡号，实际：${ok.data.bankCard}`)
  assert(/^AL\d+/.test(ok.data.accessLogId || ''), '必须返回访问日志号')

  await asRole('staff', async () => {
    const deny = await call('POST', `/payrolls/${id}/reveal`, { body: { reason: '看一下卡号' } })
    eq(deny.status, 403, 'staff 有 c.payroll.view 但没有 a.sensitive.view，应 403')
    eq(deny.code, 40301, '业务码')
  })
})

test('生成工资表：已存在 409/40912，overwrite 重算，非法期次 400', async () => {
  const P = '2026-12'
  const first = await call('POST', '/payrolls/generate', { body: { period: P } })
  eq(first.status, 201, '首次生成应 201')
  assertSchema(first, 'PayrollGenerateEnvelope', 'POST /payrolls/generate')
  eq(first.data.overwritten, false, '首次生成 overwritten=false')
  assert(first.data.employeeCount > 0, '应生成在职员工的工资行')
  const n1 = first.data.employeeCount

  const dup = await call('POST', '/payrolls/generate', { body: { period: P } })
  eq(dup.status, 409, '同期重复生成应 409')
  eq(dup.code, 40912, '业务码 40912（需 overwrite）')

  const over = await call('POST', '/payrolls/generate', { body: { period: P, overwrite: true } })
  eq(over.status, 200, '草稿期 overwrite 应 200')
  eq(over.data.overwritten, true, 'overwritten=true')
  eq(over.data.employeeCount, n1, '重算人数应与首次一致（同一批在职员工）')

  const bad = await call('POST', '/payrolls/generate', { body: { period: '2026-13' } })
  eq(bad.status, 400, '非法期次应 400')
})

/* ---------------- 组织与权限（纯 RBAC） ---------------- */

/** 取某角色当前的全部已授权权限码（从矩阵里读，不另造接口） */
async function grantCodesOf(roleId) {
  const d = await call('GET', `/roles/${roleId}`)
  const out = []
  for (const g of d.data.matrix.groups) for (const f of g.funcs) for (const o of f.ops) if (o.on) out.push(o.code)
  return out
}

test('角色列表：使用人数按岗位反推，与员工域同一口径', async () => {
  const r = await call('GET', '/roles')
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'RoleListEnvelope', 'GET /roles')
  assert(r.data.rows.length >= 10, '应有 10 个以上角色')

  const pm = r.data.rows.find(x => x.roleId === 'R-PM')
  assert(pm, '应含项目经理角色')
  const emp = await call('GET', '/employees', { query: { roleId: 'R-PM', size: 1 } })
  eq(pm.userCount, emp.data.total, '角色上的人数必须等于员工域按 roleId 筛出来的条数')

  const gm = r.data.rows.find(x => x.roleId === 'R-GM')
  eq(gm.permCount, 71, '集团总经理应有 71 个权限位')
  eq(gm.coverage, Math.round(71 / 72 * 100), '覆盖度 = 已授权 / 全部权限位')
})

test('角色详情：矩阵三层、高敏持有、可见范围', async () => {
  const r = await call('GET', '/roles/R-GM')
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'RoleDetailEnvelope', 'GET /roles/{id}')
  eq(r.data.matrix.total, 72, '权限位总数应为 72')
  eq(r.data.matrix.granted, r.data.role.permCount, '矩阵已授权数应等于角色 permCount')
  eq(r.data.posture.sensitive.length, 5, 'GM 应持有全部 5 类高敏权限')
  eq(r.data.posture.wideScope, true, 'GM 可跨项目')
  assert(r.data.byDomain.length >= 5, '应带按域统计')
  assert(Array.isArray(r.data.members), '应带成员样本')

  const stw = await call('GET', '/roles/R-STW')
  assert(stw.data.posture.sensitive.includes('a.sensitive.view'),
    '楼栋管家为了联系业主确实持有 a.sensitive.view——这正是它不能顺带看员工身份证的原因')
  const miss = await call('GET', '/roles/R-NONE')
  eq(miss.status, 404, '不存在的角色应 404')
})

test('保存权限：纯降权立即生效并留 diff', async () => {
  const before = await grantCodesOf('R-VIEW')
  const target = 'a.vehicles.view'
  assert(before.includes(target), '前置：R-VIEW 应有该权限')

  const r = await call('PUT', '/roles/R-VIEW/perms', { body: { perms: before.filter(c => c !== target) } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'PermSaveEnvelope', 'PUT /roles/{id}/perms')
  eq(r.data.applied, true, '降权应立刻生效（不用等审批）')
  eq(r.data.noChange, false, '有变化')
  eq(r.data.diff.removed[0], target, 'diff 要写清收回了哪个权限码')
  eq(r.data.diff.added.length, 0, '没有新增')

  const after = await grantCodesOf('R-VIEW')
  assert(!after.includes(target), '权限应已被收回')

  const logs = await call('GET', '/perm-logs', { query: { roleId: 'R-VIEW', size: 5 } })
  assertSchema(logs, 'PermLogPageEnvelope', 'GET /perm-logs')
  assert(logs.data.rows.length >= 1, '应留下一条变更日志')
  eq(logs.data.rows[0].action, '直接保存', '动作应为直接保存')
  assert(logs.data.rows[0].removed.includes(target), '日志里要有具体权限码，不是"改过权限"四个字')
})

test('保存权限：提权命中高敏 → 202 不生效，重复提交 409/40916', async () => {
  const before = await grantCodesOf('R-CLN')
  const body = { perms: [...before, 'a.sensitive.view'], reason: '客服需要核对业主证件号' }

  const r = await call('PUT', '/roles/R-CLN/perms', { body })
  eq(r.status, 202, '提权命中高敏应 202（已提交审批，未生效）')
  eq(r.data.applied, false, 'applied 必须是 false —— 别让前端以为已经生效')
  eq(r.data.request.status, '待审批', '应生成待审批申请')
  eq(r.data.request.risks[0].code, 'a.sensitive.view', '要写明为什么需要审批')

  const after = await grantCodesOf('R-CLN')
  assert(!after.includes('a.sensitive.view'), '审批通过前权限不能生效')

  const dup = await call('PUT', '/roles/R-CLN/perms', { body })
  eq(dup.status, 409, '同内容重复提交应 409')
  eq(dup.code, 40916, '业务码 40916')
})

test('原样保存不写日志（日志不能被噪声淹没）', async () => {
  const codes = await grantCodesOf('R-STW')
  const beforeLogs = await call('GET', '/perm-logs', { query: { roleId: 'R-STW', size: 100 } })
  const r = await call('PUT', '/roles/R-STW/perms', { body: { perms: codes } })
  eq(r.status, 200, 'HTTP 状态')
  eq(r.data.noChange, true, 'noChange 应为 true')
  eq(r.data.log, null, '不写日志')
  const afterLogs = await call('GET', '/perm-logs', { query: { roleId: 'R-STW', size: 100 } })
  eq(afterLogs.data.total, beforeLogs.data.total, '日志条数不该变')
})

test('权限申请：提交人不能批自己的，换人批完才生效', async () => {
  const codes = await grantCodesOf('R-CLN')
  const sub = await call('PUT', '/roles/R-CLN/perms', {
    body: { perms: [...codes, 'e.monthReopen.edit'], reason: '客服主管兼管月结复核' }
  })
  eq(sub.status, 202, '应进审批')
  const reqId = sub.data.request.reqId

  const self = await call('POST', `/perm-requests/${reqId}/approve`, { body: { note: '自己批' } })
  eq(self.status, 409, '提交人自己审批应 409')
  eq(self.code, 40917, '业务码 40917（双人原则）')

  await asRole('pm', async () => {
    const ok = await call('POST', `/perm-requests/${reqId}/approve`, { body: { note: '同意' } })
    eq(ok.status, 200, '换人审批应通过')
    assertSchema(ok, 'PermRequestEnvelope', 'POST /perm-requests/{id}/approve')
    eq(ok.data.status, '已通过', '状态应为已通过')
    assert(ok.data.changeId, '通过后应落一条变更记录 ID')
  })

  const after = await grantCodesOf('R-CLN')
  assert(after.includes('e.monthReopen.edit'), '审批通过后权限才生效')

  const twice = await call('POST', `/perm-requests/${reqId}/approve`)
  eq(twice.status, 409, '重复审批应 409')
  eq(twice.code, 40918, '业务码 40918（状态不允许）')
})

test('权限申请：驳回要原因，权限不生效', async () => {
  const codes = await grantCodesOf('R-CLN')
  const sub = await call('PUT', '/roles/R-CLN/perms', {
    body: { perms: [...codes, 'c.payroll.edit'], reason: '客服想顺手看看工资表' }
  })
  const reqId = sub.data.request.reqId

  await asRole('pm', async () => {
    const short = await call('POST', `/perm-requests/${reqId}/reject`, { body: { reason: '不行' } })
    eq(short.status, 422, '驳回不写够原因应 422')

    const ok = await call('POST', `/perm-requests/${reqId}/reject`, {
      body: { reason: '保洁岗不需要改工资表，走财务流程' }
    })
    eq(ok.status, 200, 'HTTP 状态')
    eq(ok.data.status, '已驳回', '状态应为已驳回')
  })

  const after = await grantCodesOf('R-CLN')
  assert(!after.includes('c.payroll.edit'), '驳回后权限不能生效')
})

test('权限申请：只有提交人能撤回', async () => {
  const codes = await grantCodesOf('R-CLN')
  const sub = await call('PUT', '/roles/R-CLN/perms', {
    body: { perms: [...codes, 'e.org.edit'], reason: '想试试能不能自己改权限' }
  })
  const reqId = sub.data.request.reqId

  await asRole('staff', async () => {
    const deny = await call('POST', `/perm-requests/${reqId}/withdraw`)
    eq(deny.status, 403, '非提交人不能撤回')
  })
  const ok = await call('POST', `/perm-requests/${reqId}/withdraw`)
  eq(ok.status, 200, 'HTTP 状态')
  eq(ok.data.status, '已撤回', '状态应为已撤回')
  const after = await grantCodesOf('R-CLN')
  assert(!after.includes('e.org.edit'), '撤回后权限不能生效')
})

test('数据范围变更：变宽进审批、变窄即时、改名不审', async () => {
  const before = await call('GET', '/roles/R-SEC')
  eq(before.data.role.dataScope, '本部门', '前置：部门经理的数据范围是「本部门」')

  /* ① 变宽 → 202，范围不变 */
  const wide = await call('PATCH', '/roles/R-SEC', {
    body: { dataScope: '全部项目', reason: '部门经理需要跨项目协调' }
  })
  eq(wide.status, 202, '变宽应 202（今天能批的范围，明天不能自己改）')
  eq(wide.data.applied, false, 'applied=false：还没生效')
  eq(wide.data.request.kind, 'scope', '申请类型应为 scope')
  eq(wide.data.request.scope.from, '本部门', '记录原范围')
  eq(wide.data.request.scope.to, '全部项目', '记录新范围')
  const stillNarrow = await call('GET', '/roles/R-SEC')
  eq(stillNarrow.data.role.dataScope, '本部门', '审批通过前范围不能变')

  const dup = await call('PATCH', '/roles/R-SEC', {
    body: { dataScope: '全部项目', reason: '再提一次' }
  })
  eq(dup.status, 409, '同内容重复提交应 409')
  eq(dup.code, 40916, '业务码 40916')

  /* ② 换人审批 → 生效 */
  const reqId = wide.data.request.reqId
  await asRole('pm', async () => {
    const ok = await call('POST', `/perm-requests/${reqId}/approve`)
    eq(ok.status, 200, '审批通过')
    eq(ok.data.status, '已通过', '状态为已通过')
  })
  const afterApprove = await call('GET', '/roles/R-SEC')
  eq(afterApprove.data.role.dataScope, '全部项目', '通过后范围才变')

  /* ③ 变窄 → 立即生效，不用审批 */
  const narrow = await call('PATCH', '/roles/R-SEC', { body: { dataScope: '本部门' } })
  eq(narrow.status, 200, '收紧应 200 立即生效（收回权限不用等谁批准）')
  eq(narrow.data.applied, true, 'applied=true')
  const afterNarrow = await call('GET', '/roles/R-SEC')
  eq(afterNarrow.data.role.dataScope, '本部门', '收窄已生效')

  /* ④ 改名 / 改备注不需要审批 */
  const rename = await call('PATCH', '/roles/R-SEC', { body: { name: '部门经理（改名）' } })
  eq(rename.status, 200, '改名应 200')
  eq(rename.data.noChange, false, '有变化')

  /* ⑤ 不能改适用层级 */
  const bad = await call('PATCH', '/roles/R-SEC', { body: { scope: '集团' } })
  eq(bad.status, 422, '改适用层级应 422（那是新建角色的事）')

  const miss = await call('PATCH', '/roles/R-NONE', { body: { name: '不存在' } })
  eq(miss.status, 404, '角色不存在应 404')

  /* 改回去，避免影响后续用例 */
  await call('PATCH', '/roles/R-SEC', { body: { name: '部门经理' } })
})

test('审批超时：挂满 24 小时的申请要能挑出来', async () => {
  const all = await call('GET', '/perm-requests', { query: { status: '待审批' } })
  eq(all.status, 200, 'HTTP 状态')
  assert(all.data.rows.length >= 2, '预置的待审批单应至少 2 条')
  for (const r of all.data.rows) {
    assert(typeof r.ageHours === 'number', `${r.reqId} 应带 ageHours`)
    assert(typeof r.overdue === 'boolean', `${r.reqId} 应带 overdue`)
  }
  const overdue = all.data.rows.filter(r => r.overdue)
  assert(overdue.length >= 1, '应有一条挂了超过 24 小时（预置的那条 10-19 提交）')
  for (const r of overdue) assert(r.ageHours >= 24, '超时的 ageHours 应 ≥ 24')

  const only = await call('GET', '/perm-requests', { query: { status: '待审批', vf: 'overdue' } })
  eq(only.data.rows.length, overdue.length, 'vf=overdue 只回超时那些')
  assert(only.data.rows.every(r => r.overdue), '筛选结果必须全部超时')
})

test('访问日志：哈希链连续，结果三态齐全', async () => {
  const r = await call('GET', '/access-logs', { query: { size: 100 } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'AccessLogPageEnvelope', 'GET /access-logs')
  assert(r.data.total >= 10, '应有访问日志样例')
  const rows = [...r.data.rows].sort((a, b) => a.logId.localeCompare(b.logId))
  for (let i = 1; i < rows.length; i++) {
    eq(rows[i].prevHash, rows[i - 1].hash, `第 ${i + 1} 条的 prevHash 应等于上一条的 hash（链断了就是被改过）`)
  }
  const results = new Set(r.data.rows.map(x => x.result))
  assert(results.has('成功') && results.has('脱敏') && results.has('拦截'),
    `结果三态都要有样例，实际：${[...results].join('/')}`)
  const denied = r.data.rows.find(x => x.result === '拦截')
  assert(denied.memo, '被拦截的记录要写原因，否则看不出为什么被拦')
})

test('访问日志汇总：与列表同源，被拦截次数单列', async () => {
  const sum = await call('GET', '/access-logs/summary', { query: { days: 7 } })
  eq(sum.status, 200, 'HTTP 状态')
  assertSchema(sum, 'AccessLogSummaryEnvelope', 'GET /access-logs/summary')
  const list = await call('GET', '/access-logs', { query: { days: 7, size: 100 } })
  eq(sum.data.rows, list.data.total, '汇总条数应等于列表 total（同一套谓词）')
  eq(sum.data.blocked, list.data.rows.filter(r => r.result === '拦截').length, '拦截次数要一致')
  eq(sum.data.reveals, list.data.rows.filter(r => r.action === '查看明文').length, '揭示次数要一致')
  assert(sum.data.operators > 0, '应统计到操作人')
  assert(sum.data.owners <= sum.data.reveals, '被查看对象数不该超过揭示次数（同一条看多次只算一个）')
})

test('导出日志与数据范围六档', async () => {
  const e = await call('GET', '/export-logs', { query: { size: 50 } })
  eq(e.status, 200, 'HTTP 状态')
  assertSchema(e, 'ExportLogPageEnvelope', 'GET /export-logs')
  assert(e.data.total >= 5, '应有导出日志样例')
  assert(e.data.rows.every(x => x.name && x.rows > 0), '每条要有文件名与行数')

  /* 筛选：结果 / 关键字 / 天数。天数不能默认卡死——「查全部」被悄悄截成 7 天，排查时看不出少在哪 */
  const blocked = await call('GET', '/export-logs', { query: { result: '拦截', size: 50 } })
  eq(blocked.data.rows.length > 0, true, '应存在被拦截的导出（被拦的才最值得看）')
  assert(blocked.data.rows.every(x => x.result === '拦截'), 'result 筛选必须全部命中')

  const kw = e.data.rows[0].name.slice(0, 2)
  const hit = await call('GET', '/export-logs', { query: { kw, size: 50 } })
  assert(hit.data.rows.length > 0 && hit.data.rows.length <= e.data.total, '关键字筛选应返回子集')
  assert(hit.data.rows.every(x => `${x.name}${x.memo}${x.operator}`.includes(kw)), 'kw 必须真的命中文件名/说明/人')

  const narrow = await call('GET', '/export-logs', { query: { days: 1, size: 50 } })
  assert(narrow.data.total <= e.data.total, '天数越小结果不能变多')

  const d = await call('GET', '/data-scopes')
  eq(d.status, 200, 'HTTP 状态')
  assertSchema(d, 'DataScopeListEnvelope', 'GET /data-scopes')
  eq(d.data.rows.length, 6, '数据范围应正好六档')
  const sum = d.data.rows.reduce((s, x) => s + x.userCount, 0)
  const emp = await call('GET', '/employees', { query: { size: 1 } })
  const es = await call('GET', '/employees/summary')
  eq(sum + es.data.noRole, emp.data.total,
    `六档人数之和 + 无角色人数（${es.data.noRole}）应等于员工总数——离职员工没有角色，不该被算进任何一档`)
})

test('E 域无权限账号：角色列表 403（不是空列表）', async () => {
  await asRole('staff', async () => {
    const r = await call('GET', '/roles')
    eq(r.status, 403, '无 e.org.view 应 403')
    eq(r.code, 40301, '业务码')
    const w = await call('PUT', '/roles/R-VIEW/perms', { body: { perms: [] } })
    eq(w.status, 403, '无 e.org.edit 不能改权限')
  })
})

test('新增角色：默认 0 权限、默认仅本人、不接受 perms', async () => {
  const before = await call('GET', '/roles')
  const r = await call('POST', '/roles', { body: { name: '测试角色', scope: '项目' } })
  eq(r.status, 201, 'HTTP 状态')
  assertSchema(r, 'RoleEnvelope', 'POST /roles')
  eq(r.data.permCount, 0, '新角色权限位应为 0')
  eq(r.data.dataScope, '仅本人', '默认数据范围应为「仅本人」（最小可见）')
  eq(r.data.userCount, 0, '还没人挂这个角色')
  const after = await call('GET', '/roles')
  eq(after.data.rows.length, before.data.rows.length + 1, '角色列表应多一个')

  const withPerms = await call('POST', '/roles', {
    body: { name: '带权限的角色', scope: '项目', perms: ['a.owners.view'] }
  })
  eq(withPerms.status, 422, '新建角色不接受 perms（授权要走矩阵，那一步有日志与审批）')

  const dup = await call('POST', '/roles', { body: { name: '测试角色', scope: '项目' } })
  eq(dup.status, 409, '角色重名应 409')
  eq(dup.code, 40902, '业务码 40902')

  const badScope = await call('POST', '/roles', { body: { name: '层级错的角色', scope: '全公司' } })
  eq(badScope.status, 422, '适用层级非法应 422')

  /* 新角色可以立刻在矩阵里授权，且走的是同一条保存路径 */
  const ok = await call('PUT', `/roles/${r.data.roleId}/perms`, {
    body: { perms: ['a.owners.view', 'a.houses.view'] }
  })
  eq(ok.status, 200, '普通权限新增应直接生效')
  eq(ok.data.applied, true, 'applied=true')
  const d = await call('GET', `/roles/${r.data.roleId}`)
  eq(d.data.matrix.granted, 2, '授权后矩阵应有 2 项')
})

test('组织列表：扁平结构带上级与人数，人数不虚高', async () => {
  const r = await call('GET', '/orgs')
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'OrgNodeListEnvelope', 'GET /orgs')
  assert(r.data.rows.length >= 20, '应有 20 个以上组织节点')
  for (const o of r.data.rows) {
    assert(o.headcount >= o.selfHeadcount, `${o.name}：含子树人数不能小于本节点人数`)
    assert(typeof o.parentId === 'string', '必须带 parentId（前端要靠它建树）')
  }
  const p01 = r.data.rows.find(o => o.orgId === 'O-P01')
  assert(p01 && p01.headcount > 0, '项目部应有下级人数')
  const t2 = r.data.rows.find(o => o.orgId === 'O-P01-T2')
  assert(t2 && t2.selfHeadcount >= 0, '班组节点应存在')

  /* 按 type / parentId 过滤 */
  const teams = await call('GET', '/orgs', { query: { type: '班组' } })
  assert(teams.data.rows.every(o => o.type === '班组'), 'type 过滤应生效')
  const kids = await call('GET', '/orgs', { query: { parentId: 'O-P01' } })
  assert(kids.data.rows.every(o => o.parentId === 'O-P01'), 'parentId 过滤应生效')

  /* 组织树（员工域）与组织列表是同一棵树：根节点 headcount 之和 = 总人数 */
  const tree = await call('GET', '/employees/org-tree')
  const sum = tree.data.roots.reduce((s, n) => s + n.headcount, 0)
  const es = await call('GET', '/employees/summary')
  eq(sum, es.data.total, '组织树与员工汇总必须对得上')
})

test('新增组织：只能建部门/班组，ID 服务端生成，同级不能重名', async () => {
  const r = await call('POST', '/orgs', {
    body: { name: '实测班组', parentId: 'O-P01', type: '班组', leader: '测试组长', orgId: '前端传的ID' }
  })
  eq(r.status, 201, 'HTTP 状态')
  assertSchema(r, 'OrgNodeEnvelope', 'POST /orgs')
  assert(r.data.orgId !== '前端传的ID', 'orgId 必须由服务端生成')
  assert(r.data.orgId.startsWith('O-P01-T'), `班组 ID 应挂在上级下，实际：${r.data.orgId}`)
  eq(r.data.parentId, 'O-P01', '上级正确')
  eq(r.data.selfHeadcount, 0, '新组织没人')

  const listed = await call('GET', '/orgs', { query: { parentId: 'O-P01' } })
  assert(listed.data.rows.some(o => o.orgId === r.data.orgId), '新组织应出现在列表里（引用闭环）')

  const dup = await call('POST', '/orgs', { body: { name: '实测班组', parentId: 'O-P01', type: '班组' } })
  eq(dup.status, 409, '同级重名应 409')
  eq(dup.code, 40902, '业务码 40902')

  const badType = await call('POST', '/orgs', { body: { name: '新项目', parentId: 'O-ROOT', type: '项目' } })
  eq(badType.status, 422, '不允许建「项目」（要伴随立项流程）')

  const noParent = await call('POST', '/orgs', { body: { name: '孤儿班组', parentId: 'O-NONE', type: '班组' } })
  eq(noParent.status, 404, '上级不存在应 404')
})

test('修改组织：改名生效；改类型 422；改上级防环', async () => {
  const list = await call('GET', '/orgs', { query: { parentId: 'O-P01', type: '班组' } })
  const t = list.data.rows[list.data.rows.length - 1]

  const renamed = await call('PATCH', `/orgs/${t.orgId}`, { body: { name: '实测班组改名', leader: '新组长', sort: 88 } })
  eq(renamed.status, 200, 'HTTP 状态')
  eq(renamed.data.name, '实测班组改名', '改名生效')
  eq(renamed.data.leader, '新组长', '负责人生效')
  eq(renamed.data.sort, 88, '排序生效')

  const badType = await call('PATCH', `/orgs/${t.orgId}`, { body: { type: '部门' } })
  eq(badType.status, 422, '不能改组织类型（下面的人归属语义会整体变化）')

  const cyc = await call('PATCH', `/orgs/${t.orgId}`, { body: { parentId: t.orgId } })
  eq(cyc.status, 422, '不能把组织挂到自己下面（会形成环）')

  const rootMove = await call('PATCH', '/orgs/O-ROOT', { body: { parentId: 'O-P01' } })
  eq(rootMove.status, 422, '集团节点不能改上级')

  const miss = await call('PATCH', '/orgs/O-NONE', { body: { name: '不存在' } })
  eq(miss.status, 404, '组织不存在应 404')
})

/* ---------------- 合同台账 ---------------- */

test('合同列表：电话一律掩码，汇总与列表同源', async () => {
  const r = await call('GET', '/contracts', { query: { size: 5 } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'ContractPageEnvelope', 'GET /contracts')
  assert(r.data.total > 0, '应有合同数据')
  for (const c of r.data.rows) {
    assert(/^\d{3}\*{4}\d{4}$/.test(c.phone || '') || !c.phone,
      `合同电话必须掩码（相对方是个人时就是个人信息），实际：${c.phone}`)
    assert(c.contractNo && c.status, '单号与状态必填')
    assert(typeof c.restDays === 'number', `restDays 应为数字：${c.restDays}`)
  }
  const sum = await call('GET', '/contracts/summary')
  eq(sum.status, 200, 'HTTP 状态')
  assertSchema(sum, 'ContractSummaryEnvelope', 'GET /contracts/summary')
  eq(sum.data.total, r.data.total, '汇总 total 必须等于列表 total（同一套谓词）')
  /* 各状态分项相加不能超过总数 */
  const parts = sum.data.running + sum.data.expiring + sum.data.expired + sum.data.pending
  assert(parts <= sum.data.total, `分项之和 ${parts} 不该超过总数 ${sum.data.total}`)
})

test('合同快捷视图由服务端算：命中条数与列表 total 一致', async () => {
  for (const vf of ['pending', 'expiring', 'expired']) {
    const list = await call('GET', '/contracts', { query: { vf, size: 1 } })
    eq(list.status, 200, `vf=${vf} 列表`)
    const sum = await call('GET', '/contracts/summary', { query: { vf } })
    eq(sum.data.total, list.data.total, `vf=${vf}：汇总应只统计视图命中项`)
  }
  /* 全量口径下，expiring 分项必须等于 expiring 视图的条数 */
  const all = await call('GET', '/contracts/summary')
  const exp = await call('GET', '/contracts', { query: { vf: 'expiring', size: 1 } })
  eq(all.data.expiring, exp.data.total, '≥ 即将到期：分项计数必须与视图一致')
})

test('合同详情：断链的关联对象给 null，不让详情页 500', async () => {
  const list = await call('GET', '/contracts', { query: { size: 100 } })
  const target = list.data.rows.find(c => c.refType) || list.data.rows[0]
  const r = await call('GET', `/contracts/${target.contractId}`)
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'ContractDetailEnvelope', 'GET /contracts/{id}')
  eq(r.data.contract.contractId, target.contractId, '详情应是同一个合同')
  assert(r.data.ref === null || typeof r.data.ref === 'object', 'ref 要么对象要么 null')
  assert(Array.isArray(r.data.changes), '变更记录应是数组（可为空）')
  const miss = await call('GET', '/contracts/CT9999')
  eq(miss.status, 404, '不存在的合同应 404')
})

test('合同变更：进审批不改合同，重复提交 409/40906，终态 422', async () => {
  const list = await call('GET', '/contracts', { query: { status: '履行中', size: 20 } })
  const c = list.data.rows[0]
  assert(c, '应有履行中的合同')
  const beforeAmount = c.amount

  const ok = await call('POST', `/contracts/${c.contractId}/changes`, {
    body: { changeType: '金额调整', reason: '材料涨价，按补充协议调整', patch: { amount: beforeAmount + 10000 } }
  })
  eq(ok.status, 201, 'HTTP 状态')
  assertSchema(ok, 'ContractChangeEnvelope', 'POST /contracts/{id}/changes')
  eq(ok.data.change.status, '待审批', '变更单应为待审批')
  eq(ok.data.change.before.amount, beforeAmount, 'before 应是发起时的快照')
  near(ok.data.change.after.amount, beforeAmount + 10000, 'after 应是变更后的值')
  assert(ok.data.approval && ok.data.approval.approvalId, '应同步生成审批单')

  /* 关键：合同本身不能被改 */
  const after = await call('GET', `/contracts/${c.contractId}`)
  near(after.data.contract.amount, beforeAmount, '变更单在审批中时，合同金额不能变')
  eq(after.data.contract.changePending, true, '合同应标记「有变更在审批中」')

  const dup = await call('POST', `/contracts/${c.contractId}/changes`, {
    body: { changeType: '期限调整', reason: '再改一次试试', patch: { endDate: '2027-12-31' } }
  })
  eq(dup.status, 409, '已有变更在审批中应 409')
  eq(dup.code, 40906, '业务码应为 40906（不是 422：这不是参数错）')

  const empty = await call('POST', `/contracts/${c.contractId}/changes`, {
    body: { changeType: '金额调整', reason: '空变更测试' }
  })
  eq(empty.status, 409, '仍是在审批中的那一单，先拦 409')

  const closed = (await call('GET', '/contracts', { query: { status: '已终止', size: 1 } })).data.rows[0]
  const term = await call('POST', `/contracts/${closed.contractId}/changes`, {
    body: { changeType: '金额调整', reason: '终态变更测试', patch: { amount: 1 } }
  })
  eq(term.status, 422, '已终止的合同不能再变更')

  const noReason = await call('POST', `/contracts/${closed.contractId}/changes`, { body: { changeType: '金额调整' } })
  eq(noReason.status, 422, '缺原因应 422')
})

test('新建合同：单号服务端生成，前端传了也忽略；日期倒挂 422', async () => {
  const r = await call('POST', '/contracts', {
    body: {
      name: '联调测试合同', type: '采购', partyB: '某某供应商', amount: 88000,
      startDate: '2026-11-01', endDate: '2027-10-31',
      contractNo: 'HT-自己编的-0001'
    }
  })
  eq(r.status, 201, 'HTTP 状态')
  assertSchema(r, 'ContractEnvelope', 'POST /contracts')
  assert(r.data.contractNo.startsWith('HT-'), `单号格式不对：${r.data.contractNo}`)
  assert(r.data.contractNo !== 'HT-自己编的-0001', '前端传的单号必须被忽略')
  eq(r.data.status, '待审批', '新建合同应为待审批，不直接生效')

  const bad = await call('POST', '/contracts', {
    body: { name: '日期倒挂', type: '采购', partyB: 'X', amount: 1, startDate: '2027-01-01', endDate: '2026-01-01' }
  })
  eq(bad.status, 422, '结束日期早于开始日期应 422')
  const miss = await call('POST', '/contracts', { body: { name: '缺字段' } })
  eq(miss.status, 422, '缺必填字段应 422')
  assert(/缺少必填字段/.test(miss.message), `提示应点名缺哪些：${miss.message}`)
})

test('合同附件：列表只回元数据，下载签发临时链接并记导出日志', async () => {
  const list = await call('GET', '/contracts', { query: { size: 30 } })
  const c = list.data.rows.find(x => (x.attachments || 0) > 0)
  assert(c, '应有带附件的合同')

  const a = await call('GET', `/contracts/${c.contractId}/attachments`)
  eq(a.status, 200, 'HTTP 状态')
  assertSchema(a, 'ContractAttachmentListEnvelope', 'GET /contracts/{id}/attachments')
  eq(a.data.rows.length, c.attachments, '附件份数应与合同上记录的一致')
  assert(!('url' in a.data.rows[0]), '列表不该带下载地址（地址一旦被复制就永远有效）')

  const file = a.data.rows[0]
  const dl = await call('POST', `/contracts/${c.contractId}/attachments/${file.fileId}/download`)
  eq(dl.status, 200, 'HTTP 状态')
  assertSchema(dl, 'AttachmentDownloadEnvelope', 'POST .../download')
  assert(/sign=/.test(dl.data.url), '应签发带签名的临时链接')
  assert(dl.data.expiresAt, '必须给过期时间（不能永久有效）')
  assert(/^EL\d+/.test(dl.data.accessLogId || ''), '下载要写导出日志')

  const logs = await call('GET', '/export-logs', { query: { size: 50 } })
  assert(logs.data.rows.some(x => x.logId === dl.data.accessLogId), '导出日志里要能查到这次下载')

  const bad = await call('POST', `/contracts/${c.contractId}/attachments/CT9999-F9/download`)
  eq(bad.status, 404, '不存在的附件应 404')
})

/* ---------------- 公告通知 ---------------- */

test('公告列表：阅读率服务端算，汇总只统计已发布', async () => {
  const r = await call('GET', '/notices', { query: { size: 5 } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'NoticePageEnvelope', 'GET /notices')
  for (const n of r.data.rows) {
    assert(Array.isArray(n.channels) && n.channels.length > 0, `公告必须有推送渠道：${n.noticeId}`)
    assert(typeof n.readRate === 'number', 'readRate 必须是数字（列表要能排序）')
    assert(n.communityName, `社区名应由服务端带出：${n.noticeId}`)
  }
  const sum = await call('GET', '/notices/summary')
  assertSchema(sum, 'NoticeSummaryEnvelope', 'GET /notices/summary')
  eq(sum.data.total, r.data.total, '汇总 total 与列表同源')
  const pub = await call('GET', '/notices', { query: { status: '已发布', size: 1 } })
  eq(sum.data.published, pub.data.total, 'published 应与「已发布」列表条数一致')
  assert(sum.data.avgReadRate >= 0 && sum.data.avgReadRate <= 100, `平均阅读率越界：${sum.data.avgReadRate}`)
})

test('公告状态机：已发布不能改、不能重发，撤回要原因且已读不清零', async () => {
  const pub = (await call('GET', '/notices', { query: { status: '已发布', size: 1 } })).data.rows[0]
  assert(pub, '应有已发布公告')
  const readBefore = pub.readCount

  const patch = await call('PATCH', `/notices/${pub.noticeId}`, { body: { title: '改个标题试试' } })
  eq(patch.status, 409, '已发布不能改内容')
  eq(patch.code, 40907, '业务码应为 40907')

  const pub2 = await call('POST', `/notices/${pub.noticeId}/publish`)
  eq(pub2.status, 409, '已发布不能再发布')
  eq(pub2.code, 40908, '业务码应为 40908')

  const noReason = await call('POST', `/notices/${pub.noticeId}/withdraw`, { body: { reason: '短' } })
  eq(noReason.status, 422, '撤回必须写原因（≥4 字）')

  const wd = await call('POST', `/notices/${pub.noticeId}/withdraw`, { body: { reason: '内容有误，重发前先撤回' } })
  eq(wd.status, 200, 'HTTP 状态')
  eq(wd.data.status, '已撤回', '状态应转已撤回')
  eq(wd.data.readCount, readBefore, '撤回不能清零已读数——业主确实看过')

  const again = await call('POST', `/notices/${pub.noticeId}/withdraw`, { body: { reason: '再撤一次' } })
  eq(again.status, 409, '非已发布状态不能再撤回')

  /* 撤回后要重新走一遍：提审 → 发布。提审与发布是两个角色的事，不能一步到位 */
  const direct = await call('POST', `/notices/${pub.noticeId}/publish`)
  eq(direct.status, 409, '已撤回不能直接发布（要先提交审核）')
  eq(direct.code, 40914, '业务码 40914')

  const submit = await call('POST', `/notices/${pub.noticeId}/submit-audit`)
  eq(submit.status, 200, '已撤回应能提交审核')
  eq(submit.data.status, '待审核', '提审后状态为待审核')

  const repub = await call('POST', `/notices/${pub.noticeId}/publish`)
  eq(repub.status, 200, '待审核应能发布')
  eq(repub.data.status, '已发布', '重新发布后状态回到已发布')
})

test('新建公告：草稿态、必须选渠道、标题与正文有下限', async () => {
  const noCh = await call('POST', '/notices', {
    body: { title: '没有渠道的公告', type: '收费通知', content: '这条公告没有任何推送渠道，业主收不到', channels: [] }
  })
  eq(noCh.status, 422, '没有渠道应 422（发出去业主也收不到）')

  const ok = await call('POST', '/notices', {
    body: { title: '联调测试公告', type: '停水停电', content: '因管网改造，11 月 2 日 8:00-18:00 停水，请提前储水。', channels: ['App 推送'] }
  })
  eq(ok.status, 201, 'HTTP 状态')
  assertSchema(ok, 'NoticeEnvelope', 'POST /notices')
  eq(ok.data.status, '草稿', '新建只能是草稿，发布是独立动作')
  eq(ok.data.readCount, 0, '新建未读')
  assert(ok.data.readRate === 0, '新建阅读率应为 0')

  /* 草稿可以改；但草稿**不能直接发布**——先提审，再发布 */
  const patch = await call('PATCH', `/notices/${ok.data.noticeId}`, { body: { title: '联调测试公告（已修订）' } })
  eq(patch.status, 200, '草稿应可修改')

  const skip = await call('POST', `/notices/${ok.data.noticeId}/publish`)
  eq(skip.status, 409, '草稿直接发布应 409（跳过审核，谁审的那栏永远是空的）')
  eq(skip.code, 40914, '业务码 40914')

  const submit = await call('POST', `/notices/${ok.data.noticeId}/submit-audit`)
  eq(submit.status, 200, '草稿应能提交审核')
  eq(submit.data.status, '待审核', '提审后为待审核')

  const pub = await call('POST', `/notices/${ok.data.noticeId}/publish`)
  eq(pub.status, 200, '待审核应能发布')
  eq(pub.data.status, '已发布', '发布后状态')
  assert(pub.data.publishTime, '发布后应有发布时间')
  eq(pub.data.readCount, 0, '发布时已读归零（新一轮推送）')

  const short = await call('POST', '/notices', {
    body: { title: '短', type: '收费通知', content: '太短', channels: ['App 推送'] }
  })
  eq(short.status, 422, '标题或正文过短应 422')
})

/* ---------------- 批次保留与清理（放最后：会真删批次） ---------------- */

test('保留现状：过期与"受保护"分开计数，年报永不清理', async () => {
  const r = await call('GET', '/reports/retention')
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'ReportRetentionEnvelope', 'GET /reports/retention')
  const d = r.data
  eq(d.keepDays, 90, '日快照默认保留 90 天')
  eq(d.keepMonths, 24, '月快照默认保留 24 期')
  const day = d.byType.find(x => x.periodType === '日')
  const mon = d.byType.find(x => x.periodType === '月')
  const yr = d.byType.find(x => x.periodType === '年')
  assert(day && mon && yr, '三种粒度都要出现（缺一种说明分组写错了）')
  assert(day.expired > 0, `90 天前的日批次应计入 expired，实际 ${day.expired}`)
  eq(day.protectedClosed, 0, '7 月没月结，那两个日批次不该被计入受保护')
  eq(yr.expired, 0, '年报永不过期')
  eq(yr.keep, '永久', '年报保留说明')
  assert(mon.total > 0 && mon.expired === 0, '24 期以内不该有过期月批次')

  const bad = await call('GET', '/reports/retention', { query: { keepDays: 0 } })
  eq(bad.status, 400, '保留参数必须是正整数')
})

test('清理：dryRun 只算不删，真删后老批次 404/40402，重复跑幂等', async () => {
  const before = await call('GET', '/reports/arrears', { query: { statDate: '2026-07-15' } })
  eq(before.status, 200, '清理前老批次应可读')

  const dry = await call('POST', '/reports/purge', { body: { dryRun: true } })
  eq(dry.status, 200, 'HTTP 状态')
  assertSchema(dry, 'ReportPurgeEnvelope', 'POST /reports/purge')
  assert(dry.data.removed > 0, 'dryRun 应给出"将删除"的数量')
  eq(dry.data.dryRun, true, 'dryRun 标记')
  const still = await call('GET', '/reports/arrears', { query: { statDate: '2026-07-15' } })
  eq(still.status, 200, 'dryRun 不能真删')

  const real = await call('POST', '/reports/purge', { body: {} })
  assert(real.data.removed === dry.data.removed, `真删数量应与 dryRun 一致：${real.data.removed} vs ${dry.data.removed}`)
  eq(real.data.dryRun, false, '非 dryRun')
  assert(Array.isArray(real.data.batches) && real.data.batches.length > 0, '应回批次号便于核对')

  const gone = await call('GET', '/reports/arrears', { query: { statDate: '2026-07-15' } })
  eq(gone.status, 404, '被清理的批次应 404')
  eq(gone.code, 40402, '业务码 40402：空表和"没这个批次"必须能区分')

  const keep = await call('GET', '/reports/arrears', { query: { statDate: '2026-10-19' } })
  eq(keep.status, 200, '保留期内的批次不能动')

  const again = await call('POST', '/reports/purge', { body: {} })
  eq(again.data.removed, 0, '清理必须幂等：重复跑不能多删')
})

test('已月结期间的批次受保护：收紧保留期也删不掉', async () => {
  /* 用极端参数（日 1 天 / 月 1 期）模拟"存储吃紧临时收紧"，
     该删的照删，但已月结的期间必须活下来 —— 这是审计底线 */
  const tight = await call('POST', '/reports/purge', { body: { keepDays: 1, keepMonths: 1 } })
  eq(tight.status, 200, 'HTTP 状态')
  assert(tight.data.keptProtected > 0, `应收紧后仍有受保护批次，实际 ${tight.data.keptProtected}`)

  /* 9 / 10 月都已月结 → 必须都还在；8 月已被反结（未结）→ 允许被清 */
  const sep = await call('GET', '/reports/arrears', { query: { month: '2026-09' } })
  eq(sep.status, 200, '已月结的 9 月批次不能删')
  const oct = await call('GET', '/reports/collection-rate', { query: { periodType: '月', period: '2026-10' } })
  eq(oct.status, 200, '已重结的 10 月批次不能删')

  const aug = await call('GET', '/reports/arrears', { query: { month: '2026-08' } })
  eq(aug.status, 404, '已反结（未结）的 8 月批次不在保护范围，收紧后可清')

  const ret = await call('GET', '/reports/retention', { query: { keepDays: 1, keepMonths: 1 } })
  eq(ret.data.keepDays, 1, '参数应透出（运维要能确认自己刚才用了什么策略）')
})

/* ============================ 跑 ============================ */
const server = await startServer(0)
const port = server.address().port
BASE = `http://127.0.0.1:${port}`
token = await login('gm')

let pass = 0
const failed = []
console.log(`\n契约测试 · ${BASE}\n`)
for (const t of tests) {
  try {
    await t.fn()
    pass++
    console.log(`  ✓ ${t.name}`)
  } catch (e) {
    failed.push({ name: t.name, msg: e.message })
    console.log(`  ✗ ${t.name}\n      ${e.message}`)
  }
}
server.close()
console.log(`\n结果：${pass}/${tests.length} 通过${failed.length ? `，${failed.length} 失败` : ''}\n`)
if (failed.length) process.exit(1)
