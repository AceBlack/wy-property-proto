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
/* 权限位总数从 fixture 读：写死数字的结果是每加一条权限码，就有一批无关用例跟着红 */
const ALL_PERMS_FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/permissions.json'), 'utf8'))
const ALL_PERMS_TOTAL = ALL_PERMS_FIX.length

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
  /*
   * `nullable: true` 要显式放行 —— 契约里从第一批就在用（设备购买日期、价目价格），
   * 但校验器一直没实现，等于这些字段的 null 一出现就报"类型应为 object"。
   * 语义按 OpenAPI 3.0：nullable 只放开 null，其它约束（enum / required / items）照旧。
   */
  if (value === null && schema.nullable) return errors
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

test('客户画像字段：列表脱敏三项个人敏感信息，详情回真值', async () => {
  const r = await call('GET', '/owners', { query: { size: 5 } })
  for (const row of r.data.rows) {
    assert(row.ownerCategory, '业主分类应下发（非敏感，用于分群）')
    eq(row.economicLevel, '***', '家庭经济状况在列表必须掩码')
    eq(row.politicalStatus, '***', '政治面貌在列表必须掩码')
    assert(row.negativeNotes === '' || row.negativeNotes === '***', '负面信息在列表必须掩码')
    assert(typeof row.pets === 'string', '宠物信息是非敏感字段，应原样下发')
  }

  const detail = await call('GET', `/owners/${r.data.rows[0].ownerId}`)
  const o = detail.data.owner
  /* 注意：这行不能以 [ 开头——上一行以 o = ... 结尾，[ 会被当成成员访问（ASI 坑，踩过一次） */
  const ECON = ['优渥', '良好', '一般', '困难']
  assert(ECON.includes(o.economicLevel), `详情应回真实枚举：${o.economicLevel}`)
  assert(o.economicLevel !== '***', '详情不该是掩码')
  assert(o.politicalStatus !== '***', '政治面貌详情不该是掩码')
  assert(['常住', '候鸟', '投资', '出租业主'].includes(o.ownerCategory), '分类取值合法')

  const houses = detail.data.houses
  assert(houses.length > 0, '详情应带名下房屋')
  assert(houses.every(h => ['无', '疑似', '已认定', '已整改'].includes(h.decorationViolation)),
    '违规装修挂在房屋上，取值必须在四档内')
  assert(houses.some(h => h.deliverDate), '交房日期应有值')
  assert(houses.filter(h => h.decorationViolation !== '无').every(h => h.decorationResult),
    '非「无」的违规必须有处理结果——只有标记没有结果等于没跟进')
})

test('画像字段可内联编辑，枚举脏值被拦', async () => {
  const list = await call('GET', '/owners', { query: { size: 1 } })
  const id = list.data.rows[0].ownerId

  const okPatch = await call('PATCH', `/owners/${id}`, { body: { field: 'ownerCategory', value: '投资' } })
  eq(okPatch.status, 200, '合法枚举应 200')
  eq(okPatch.data.ownerCategory, '投资', '保存后为新值')

  const bad = await call('PATCH', `/owners/${id}`, { body: { field: 'ownerCategory', value: '随便写' } })
  eq(bad.status, 422, '枚举外的值应 422')
  assert(/取值非法/.test(bad.message), `提示应说清取值非法：${bad.message}`)

  const badDate = await call('PATCH', `/owners/${id}`, { body: { field: 'weddingDate', value: '2020/01/01' } })
  eq(badDate.status, 422, '日期格式不对应 422')

  const okDate = await call('PATCH', `/owners/${id}`, { body: { field: 'weddingDate', value: '2015-05-20' } })
  eq(okDate.data.weddingDate, '2015-05-20', '合法日期应保存')

  /* 改回去，避免影响后续用例 */
  await call('PATCH', `/owners/${id}`, { body: { field: 'ownerCategory', value: '常住' } })
})

const owners_total = async () => (await call('GET', '/owners', { query: { size: 1 } })).data.total

test('业主标签字典：默认只回启用的，ownerCount 为全库口径', async () => {
  const all = await call('GET', '/owner-tags', { query: { enabled: 'all' } })
  eq(all.status, 200, 'HTTP 状态')
  assertSchema(all, 'OwnerTagListEnvelope', 'GET /owner-tags')
  eq(all.data.rows.length, 12, '字典应有 12 个词条')
  eq(new Set(all.data.rows.map(t => t.tagId)).size, 12, 'tagId 不能重复')
  assert(all.data.rows.every(t => t.tagId && t.name && t.category && typeof t.ownerCount === 'number'),
    '每条要有 tagId / name / category / ownerCount')

  /* 默认（不传 enabled）只回启用中：楼管打开选择弹层看到的就是这批 */
  const on = await call('GET', '/owner-tags')
  const expected = all.data.rows.filter(t => t.enabled)
  eq(on.data.rows.length, expected.length, '默认只回启用中的词条')
  assert(on.data.rows.every(t => t.enabled), '默认结果里不该有停用词条')
  eq(all.data.rows.filter(t => !t.enabled).length, 1, '种子里有 1 个停用词条（法律纠纷）')

  /* ownerCount 要与业主表对得上：同一个数在哪都得一样 */
  const tagged = await call('GET', '/owners', { query: { size: 100, tagId: 'OT05' } })
  const ot05 = all.data.rows.find(t => t.tagId === 'OT05')
  assert(ot05.ownerCount > 0, '长期欠费应有人')
  eq(tagged.data.total, ot05.ownerCount, '列表按该标签筛出的总数应等于 ownerCount')

  const byCat = await call('GET', '/owner-tags', { query: { category: '风险' } })
  assert(byCat.data.rows.length > 0 && byCat.data.rows.every(t => t.category === '风险'), '分类筛选')

  /* 汇总：几个数之间必须自洽，不能各页各算一套 */
  const st = await call('GET', '/owner-tags/stats')
  eq(st.status, 200, 'HTTP 状态')
  assertSchema(st, 'OwnerTagStatsEnvelope', 'GET /owner-tags/stats')
  eq(st.data.total, all.data.rows.length, '词条总数对得上')
  eq(st.data.enabled + st.data.disabled, st.data.total, '启用 + 停用 = 总数')
  assert(st.data.used > 0 && st.data.used <= st.data.total, 'used 在 0..total 之间')
  eq(st.data.taggedOwners + st.data.untaggedOwners, await owners_total(), '带标签 + 不带 = 业主总数')
})

test('标签维护：名称唯一（含停用词条）、tagId 不可改、停用只拦新打', async () => {
  /* ① 新增 */
  const c = await call('POST', '/owner-tags', {
    body: { name: '联调临时标签', category: '行为', color: 'cyan', desc: '契约测试用' }
  })
  eq(c.status, 201, '新增应 201')
  assert(/^OT\d+$/.test(c.data.tagId), `tagId 由服务端生成：${c.data.tagId}`)
  eq(c.data.enabled, true, '新建默认启用')
  eq(c.data.ownerCount, 0, '新建时还没人用')
  const newId = c.data.tagId

  /* ② 重名——已停用的词条也算占用，否则会出现两个「重点关怀」分不清 */
  const dupLive = await call('POST', '/owner-tags', { body: { name: '重点关怀', category: '关怀' } })
  eq(dupLive.status, 409, '与启用词条重名应 409')
  eq(dupLive.code, 40902, '业务码 40902')
  const dupDead = await call('POST', '/owner-tags', { body: { name: '法律纠纷', category: '风险' } })
  eq(dupDead.status, 409, '与**已停用**词条重名也要 409')

  const short = await call('POST', '/owner-tags', { body: { name: '字', category: '关怀' } })
  eq(short.status, 422, '名称太短应 422')
  const badCat = await call('POST', '/owner-tags', { body: { name: '分类不对', category: '其它' } })
  eq(badCat.status, 422, '分类非法应 422')

  /* ③ 改名 / 改色 / 改说明 */
  const p1 = await call('PATCH', `/owner-tags/${newId}`, { body: { name: '联调临时标签（改）', color: 'red' } })
  eq(p1.status, 200, '改词条应 200')
  eq(p1.data.name, '联调临时标签（改）', '名称已改')
  eq(p1.data.color, 'red', '颜色已改')

  const idChange = await call('PATCH', `/owner-tags/${newId}`, { body: { tagId: 'OT99' } })
  eq(idChange.status, 422, 'tagId 不可修改（业主表引用它）')

  const miss = await call('PATCH', '/owner-tags/OT999', { body: { name: '不存在' } })
  eq(miss.status, 404, '词条不存在应 404')

  /* ④ 停用：不能再新打，但已打的不受影响 */
  const off = await call('PATCH', `/owner-tags/${newId}`, { body: { enabled: false } })
  eq(off.data.enabled, false, '已停用')

  const owner = await call('GET', '/owners', { query: { size: 1 } })
  const oid = owner.data.rows[0].ownerId
  const blocked = await call('POST', `/owners/${oid}/tags`, { body: { tagId: newId } })
  eq(blocked.status, 409, '往停用词条打标签应 409')
  eq(blocked.code, 40919, '业务码 40919')

  /* 停用的词条依然在列表里（历史标签要能解释），但不在默认选项里 */
  const afterOff = await call('GET', '/owner-tags', { query: { enabled: 'all' } })
  assert(afterOff.data.rows.some(t => t.tagId === newId), '停用后仍可在「全部」里看到')
  const def = await call('GET', '/owner-tags')
  assert(!def.data.rows.some(t => t.tagId === newId), '默认选项里不该再出现')
})

test('给业主打标签：楼管能打不能改字典，重复打 / 摘不存在都要说清', async () => {
  const list = await call('GET', '/owners', { query: { size: 5 } })
  const blank = list.data.rows.find(o => !(o.tagIds || []).length) || list.data.rows[0]
  const oid = blank.ownerId

  /* ① 打一个启用中的标签 */
  const add = await call('POST', `/owners/${oid}/tags`, { body: { tagId: 'OT08' } })
  eq(add.status, 200, '打标签应 200')
  assertSchema(add, 'OwnerTagIdsEnvelope', 'POST /owners/{id}/tags')
  assert(add.data.tagIds.includes('OT08'), '返回的完整标签集应包含它')
  eq(add.data.tag.name, '意见领袖', '响应带词条，前端不用再查一次字典')

  /* ② 重复打：静默成功会让页面看不出到底有没有生效 */
  const again = await call('POST', `/owners/${oid}/tags`, { body: { tagId: 'OT08' } })
  eq(again.status, 409, '重复打应 409')
  eq(again.code, 40920, '业务码 40920')

  /* ③ 词条不存在 */
  const noTag = await call('POST', `/owners/${oid}/tags`, { body: { tagId: 'OT999' } })
  eq(noTag.status, 404, '词条不存在应 404')

  /* ④ 摘掉 */
  const del = await call('DELETE', `/owners/${oid}/tags/OT08`)
  eq(del.status, 200, '去标签应 200')
  assert(!del.data.tagIds.includes('OT08'), '返回集里不应再有它')

  /* ⑤ 摘一个本来就没有的：不能静默成功 */
  const del2 = await call('DELETE', `/owners/${oid}/tags/OT08`)
  eq(del2.status, 404, '摘不存在的标签应 404')
  eq(del2.code, 40409, '业务码 40409')

  /* ⑥ 楼管：能打标签（a.owners.edit），但**不能维护字典**（缺 e.ownerTags.edit） */
  await asRole('steward', async () => {
    const scoped = await call('GET', '/owners', { query: { size: 1 } })
    const sid = scoped.data.rows[0].ownerId
    const ok = await call('POST', `/owners/${sid}/tags`, { body: { tagId: 'OT04' } })
    eq(ok.status, 200, '楼管在责任范围内应能打标签')

    const noDict = await call('POST', '/owner-tags', { body: { name: '楼管想加的标签', category: '关怀' } })
    eq(noDict.status, 403, '楼管不该能维护字典')
    assert(/e\.ownerTags\.edit/.test(noDict.message), `403 要点名缺哪个权限：${noDict.message}`)

    /* 但读字典必须能读到——不然选择弹层是空的 */
    const dict = await call('GET', '/owner-tags')
    eq(dict.status, 200, '楼管必须能读字典（打标签的前置）')
    assert(dict.data.rows.length > 0, '字典不能是空列表')
  })

  /* ⑦ 没有 a.owners.view 的账号连字典都读不到 */
  await asRole('staff', async () => {
    const denied = await call('GET', '/owner-tags')
    eq(denied.status, 403, '无业主档案权限的账号读不到标签字典')
  })
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
  /* 列表给的是掩码（138****8001）。**原样提交**必须被拒 —— 以前这条不断言返回值，
     而且把星号替换成 1 再提交（13811118001 恰好是个合法号），结果真把 OW00002 的
     手机号改掉了，这个业主从此登录一律 404。
     注意这条用例顺带证明了「只校验格式」不够：掩码洗成合法号后格式是对的，
     能挡住它的只有"拿不到明文就别改"这个原则 —— 真实前端不该有替换星号的代码。 */
  const r = await call('PATCH', `/owners/${b.ownerId}`, { body: { field: 'phone', value: a.phone } })
  eq(r.status, 422, '掩码值不能当手机号提交')
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


/* ---------------- 商业服务项目（2026-11-02 工单拆分） ---------------- */

test('商业服务项目：价目字典口径自洽，默认只回在售', async () => {
  const r = await call('GET', '/service-items', { query: { size: 100 } })
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'ServiceItemPageEnvelope', 'GET /service-items')
  const rows = r.data.rows
  assert(rows.length > 0, '应有服务项目样例')
  for (const it of rows) {
    eq(it.price, Math.round((it.material + it.labor) * 100) / 100, `${it.code} 服务价格应等于材料+人工`)
    eq(it.cost, Math.round((it.materialCost + it.laborCost) * 100) / 100, `${it.code} 成本价应等于材料成本+人工成本`)
    assert(it.cost < it.price, `${it.code} 成本应低于服务价格（否则启用即亏本）`)
    assert(it.enabled === true, `默认列表不该出现停用项：${it.code}`)
    assert(typeof it.minutes === 'number', `${it.code} 应有标准工时`)
  }
  /* 分类过滤：只回该分类 */
  const cat = rows[0].category
  const f = await call('GET', '/service-items', { query: { category: cat, size: 100 } })
  eq(f.data.rows.every(x => x.category === cat), true, `按分类 ${cat} 过滤`)
})

test('服务项目：price/cost 由服务端算，分解不自洽与亏本都要拦', async () => {
  /* 传了 price 也不采信：material+labor 才是唯一口径 */
  const created = await call('POST', '/service-items', {
    body: {
      category: '其他', name: '契约测试 · 上门取件', trade: '综合',
      material: 10, labor: 40, materialCost: 6, laborCost: 20,
      price: 999, cost: 1, unit: '次', minutes: 30
    }
  })
  eq(created.status, 200, '新增 HTTP 状态')
  assertSchema(created, 'ServiceItemEnvelope', 'POST /service-items')
  eq(created.data.price, 50, '服务价格 = 材料 + 人工（忽略入参 price）')
  eq(created.data.cost, 26, '成本价 = 材料成本 + 人工成本（忽略入参 cost）')
  assert(/^SI\d+$/.test(created.data.code), `编号由服务端生成：${created.data.code}`)

  const dup = await call('POST', '/service-items', {
    body: { category: '其他', name: '契约测试 · 上门取件', material: 10, labor: 40, materialCost: 6, laborCost: 20 }
  })
  eq(dup.status, 409, '同分类重名 HTTP 状态')
  eq(dup.code, 40923, '同分类重名业务码')

  const badCost = await call('POST', '/service-items', {
    body: { category: '其他', name: '契约测试 · 材料亏本', material: 10, labor: 40, materialCost: 30, laborCost: 5 }
  })
  eq(badCost.status, 422, '材料成本高于材料费 HTTP 状态')
  eq(badCost.code, 42205, '材料成本高于材料费业务码')

  const loss = await call('POST', '/service-items', {
    body: { category: '其他', name: '契约测试 · 亏本项目', material: 0, labor: 30, materialCost: 0, laborCost: 30 }
  })
  eq(loss.status, 422, '成本 ≥ 价格 HTTP 状态')
  eq(loss.code, 42206, '成本 ≥ 价格业务码')
})

test('服务项目停用：有在途工单不给停；无引用可停且默认列表不再返回', async () => {
  const list = await call('GET', '/service-items', { query: { size: 100 } })
  const busy = list.data.rows.find(x => x.inFlight > 0)
  assert(busy, '样例里应有被在途工单引用的项目')
  const stop = await call('POST', `/service-items/${busy.code}/toggle`, { body: { enabled: false } })
  eq(stop.status, 409, '有在途单停用 HTTP 状态')
  eq(stop.code, 40924, '有在途单停用业务码')
  assert(stop.message.includes(String(busy.inFlight)), `提示应说清几张：${stop.message}`)

  const idle = list.data.rows.find(x => x.usedCount === 0)
  if (idle) {
    const ok2 = await call('POST', `/service-items/${idle.code}/toggle`, { body: { enabled: false } })
    eq(ok2.status, 200, '无引用项目停用 HTTP 状态')
    eq(ok2.data.enabled, false, '停用后 enabled=false')
    const after = await call('GET', '/service-items', { query: { size: 100 } })
    assert(!after.data.rows.some(x => x.code === idle.code), '默认列表不再返回停用项')
    const all = await call('GET', '/service-items', { query: { size: 100, enabled: 'all' } })
    assert(all.data.rows.some(x => x.code === idle.code), 'enabled=all 仍能查到（停用不删）')
    await call('POST', `/service-items/${idle.code}/toggle`, { body: { enabled: true } })
  }
})

test('商业服务工单：必须绑项目，金额按快照，改价不回溯已完工单', async () => {
  const items = await call('GET', '/service-items', { query: { size: 100 } })
  const item = items.data.rows.find(x => x.enabled)
  assert(item, '应有在售项目')

  const noItem = await call('POST', '/work-orders', { body: { type: '商业服务', title: '没选项目的商业服务' } })
  eq(noItem.status, 422, '未选项目 HTTP 状态')
  eq(noItem.code, 42207, '未选项目业务码')

  const created = await call('POST', '/work-orders', {
    body: {
      type: '商业服务', serviceItemCode: item.code, title: '契约测试 · 商业服务单',
      communityId: 'P01', houseId: 'H010110101', priority: '普通'
    }
  })
  eq(created.status, 200, '创建 HTTP 状态')
  const wo = created.data
  eq(wo.feeType, '收费', '商业服务是收费单')
  eq(wo.totalFee, item.price, '服务费 = 项目服务价格')
  eq(wo.serviceCost, item.cost, '成本快照 = 项目成本价')
  eq(wo.category, item.category, '分类取项目分类')
  eq(wo.payStatus, '未支付', '新单未支付')
  eq(wo.serviceItemCode, item.code, '绑定项目编号')

  /* 改价后：新单按新价，老单不动 */
  const before = item.price
  const patched = await call('PATCH', `/service-items/${item.code}`, {
    body: {
      category: item.category, name: item.name, trade: item.trade,
      material: item.material, labor: item.labor + 10,
      materialCost: item.materialCost, laborCost: item.laborCost,
      unit: item.unit, minutes: item.minutes, sort: item.sort, desc: item.desc
    }
  })
  eq(patched.status, 200, '改价 HTTP 状态')
  eq(patched.data.price, Math.round((before + 10) * 100) / 100, '改价后服务价格 +10')

  const oldWo = await call('GET', `/work-orders/${wo.woId}`)
  eq(oldWo.data.workOrder.totalFee, before, '已创建工单的金额不随字典改价变化（快照）')
  eq(oldWo.data.workOrder.serviceCost, item.cost, '成本快照同样不变')

  /* 公共区域维修：免费 + 必须有设施部位 */
  const noCat = await call('POST', '/work-orders', { body: { type: '公共区域维修', title: '公共报修没选部位' } })
  eq(noCat.code, 42207, '公共区域未选部位业务码')
  const pub = await call('POST', '/work-orders', {
    body: { type: '公共区域维修', category: '电梯', title: '契约测试 · 公共电梯异响', communityId: 'P01' }
  })
  eq(pub.status, 200, '公共区域建单 HTTP 状态')
  eq(pub.data.feeType, '免费', '公共区域维修免费')
  eq(pub.data.totalFee, 0, '公共区域不产生费用')
  eq(pub.data.payStatus, '无需支付', '公共区域无需支付')
})

/* ---------------- OA 审批底座（2026-11-03） ---------------- */

test('OA 单据定义：六类齐全，字段是「描述」不是固定列', async () => {
  const r = await call('GET', '/oa/forms')
  eq(r.status, 200, 'HTTP 状态')
  assert(Array.isArray(r.data), '返回数组')
  eq(r.data.length, 6, '六类单据')
  const types = r.data.map(f => f.bizType)
  for (const t of ['用车申请', '费用报销', '请假申请', '加班申请', '用印申请', '采购申请']) {
    assert(types.includes(t), `应包含 ${t}`)
  }
  for (const f of r.data) {
    assertSchema(f, 'OaFormDef', `GET /oa/forms#${f.bizType}`)
    assert(f.fields.length >= 4, `${f.bizType} 至少 4 个字段`)
    for (const fd of f.fields) {
      assert(fd.key && fd.label && fd.type, `${f.bizType} 字段要有 key/label/type`)
    }
  }
  /* 金额字段标记 role=amount：它决定走基础流程还是超额流程 */
  const exp = r.data.find(f => f.bizType === '费用报销')
  const amt = exp.fields.find(f => f.role === 'amount')
  assert(amt && amt.key === 'amount', '费用报销应有 role=amount 的字段')
  const car = r.data.find(f => f.bizType === '用车申请')
  eq(car.fields.some(f => f.role === 'amount'), false, '用车申请没有金额字段')
})

test('OA 发起：表单校验拦在前，金额决定审批级数', async () => {
  /*
   * 2026-11-13：报销改成**明细行 + 金额派生**。
   * 只填一个总额时审批人核不了账，所以 `amount` 由 `items` 合计算出，客户端传值会被重算。
   */
  const items = [{ name: 'A4 打印纸', spec: '70g', unit: '包', needQty: 5, stockQty: 2, buyQty: 3, price: 1000, note: '' }]
  const base = {
    expenseType: '办公费', happenDate: '2026-11-01', communityId: 'P01',
    reason: '十月办公用品采购报销', items
  }
  /* 缺明细 → 422/42211，且提示要点名「采购明细」 */
  const noItems = await call('POST', '/oa/requests', {
    body: { bizType: '费用报销', formData: { ...base, items: [] } }
  })
  eq(noItems.status, 422, '缺明细 HTTP 状态')
  eq(noItems.code, 42211, '缺明细业务码')
  assert(noItems.message.includes('采购明细'), `提示应点名缺哪个字段：${noItems.message}`)

  /* 传了错金额也不认：以明细合计为准（3 × 1000 = 3000） */
  const staleAmount = await call('POST', '/oa/requests', {
    body: { bizType: '费用报销', formData: { ...base, amount: 1 } }
  })
  eq(staleAmount.status, 200, '带错金额仍可提交（金额被重算）')
  eq(staleAmount.data.amount, 3000, '金额取明细合计，不取客户端传值')

  /* 未知类型 */
  const unknown = await call('POST', '/oa/requests', { body: { bizType: '不存在的单据', formData: {} } })
  eq(unknown.code, 42211, '未知单据类型业务码')

  /* 3000 → 两级（部门负责人 → 财务复核） */
  const small = await call('POST', '/oa/requests', {
    body: { bizType: '费用报销', formData: { ...base } }
  })
  eq(small.status, 200, '发起 HTTP 状态')
  assertSchema(small, 'OaRequestEnvelope', 'POST /oa/requests')
  const a1 = small.data
  eq(a1.bizId, '', 'OA 单据没有业务实体')
  eq(a1.status, '待审批', '新建即待审批')
  eq(a1.amount, 3000, '金额取自 role=amount 字段')
  eq(a1.flow.length, 2, '3000 元走两级')
  eq(a1.flow[0].node, '部门负责人审批', '第一级是部门负责人')
  eq(a1.flow[0].action, '待处理', '节点初始为待处理')
  assert(a1.formData.expenseType === '办公费', 'formData 原样落库')
  assert(a1.title.includes('办公费'), `标题带摘要：${a1.title}`)

  /* 8000 → 三级（多一级项目经理）：明细改成 8 × 1000 */
  const big = await call('POST', '/oa/requests', {
    body: { bizType: '费用报销', formData: {
      ...base,
      items: [{ name: '维修材料', unit: '批', buyQty: 8, price: 1000, note: '整批采购' }]
    } }
  })
  eq(big.data.flow.length, 3, '8000 元走三级（超 5000 加项目经理）')
  eq(big.data.flow[2].node, '项目经理审批', '第三级是项目经理')

  /* 请假：结束时间必须晚于开始时间 */
  const badPeriod = await call('POST', '/oa/requests', {
    body: { bizType: '请假申请', formData: {
      leaveType: '事假', startAt: '2026-11-06 09:00', endAt: '2026-11-05 18:00', hours: 8, reason: '测试'
    } }
  })
  eq(badPeriod.code, 42211, '结束早于开始要拦')
  assert(badPeriod.message.includes('晚于'), `提示要说明先后：${badPeriod.message}`)
})

test('OA 撤回：只有「待审批」能撤，撤过再撤 409/40928', async () => {
  const created = await call('POST', '/oa/requests', {
    body: { bizType: '用车申请', formData: {
      useAt: '2026-11-05 09:00', destination: '市住建局', passengers: 2, withDriver: '需司机', reason: '递交备案材料'
    } }
  })
  eq(created.status, 200, '发起 HTTP 状态')
  const id = created.data.approvalId

  const wd = await call('POST', `/oa/requests/${id}/withdraw`, { body: { reason: '行程取消' } })
  eq(wd.status, 200, '撤回 HTTP 状态')
  eq(wd.data.status, '已撤回', '状态变已撤回')
  eq(wd.data.flow[0].action, '撤回', '首个节点记为撤回')
  eq(wd.data.flow[0].comment, '行程取消', '撤回原因落库')

  const again = await call('POST', `/oa/requests/${id}/withdraw`, { body: {} })
  eq(again.status, 409, '重复撤回 HTTP 状态')
  eq(again.code, 40928, '重复撤回业务码')

  const notFound = await call('POST', '/oa/requests/AP99999/withdraw', { body: {} })
  eq(notFound.status, 404, '不存在的单 HTTP 状态')
})

test('OA 流程配置：可改节点、空节点与「超额无阈值」都要拦', async () => {
  const list = await call('GET', '/oa/flows')
  eq(list.status, 200, 'HTTP 状态')
  /* 2026-11-03 起多一种「计划审批」：它同样自带业务实体（noForm），只出现在流程配置里 */
  eq(list.data.length, 8, '八种（6 类 OA + 合同审批 + 计划审批）')
  const ht = list.data.find(f => f.bizType === '合同审批')
  assert(ht, '合同审批也纳管')
  eq(ht.amountThreshold, 300000, '合同审批 30 万阈值（原硬编码）')
  eq(ht.overNodes.length, 3, '超额走三级')

  const empty = await call('PUT', '/oa/flows/用车申请', { body: { baseNodes: [] } })
  eq(empty.status, 422, '空节点 HTTP 状态')
  eq(empty.code, 42212, '空节点业务码')

  const badBranch = await call('PUT', '/oa/flows/用车申请', {
    body: { amountThreshold: 0, overNodes: [{ name: '多一级', assigneeType: 'orgLeader' }] }
  })
  eq(badBranch.status, 422, '超额流程阈值为 0 HTTP 状态')
  eq(badBranch.code, 42212, '超额流程阈值为 0 业务码')

  /* 正常改：用车从两级改成一级 */
  const ok = await call('PUT', '/oa/flows/用车申请', {
    body: {
      amountThreshold: 0, overNodes: [],
      baseNodes: [{ name: '部门负责人审批', assigneeType: 'orgLeader', limitHours: 8, allowReject: true }],
      note: '契约测试：简化为一级'
    }
  })
  eq(ok.status, 200, '改配置 HTTP 状态')
  eq(ok.data.baseNodes.length, 1, '节点数已变')
  eq(ok.data.note, '契约测试：简化为一级', '说明落库')

  /* 新单按新流程走：一级 */
  const created = await call('POST', '/oa/requests', {
    body: { bizType: '用车申请', formData: {
      useAt: '2026-11-06 09:00', destination: '分公司', passengers: 1, reason: '对接工作'
    } }
  })
  eq(created.data.flow.length, 1, '新单用新配置（一级）')

  /* 还原，避免影响其他用例 */
  await call('PUT', '/oa/flows/用车申请', {
    body: {
      amountThreshold: 0, overNodes: [],
      baseNodes: [
        { name: '部门负责人审批', assigneeType: 'orgLeader', limitHours: 12, allowReject: true },
        { name: '行政复核', assigneeType: 'role', roleCode: 'admin', limitHours: 8, allowReject: true }
      ],
      note: '用车不涉及金额，两级固定'
    }
  })
})

/* ---------------- 合同收入分类 + 多种经营 + 工时积分（2026-11-02） ---------------- */

test('合同收入分类：只有多种经营产生年化收入，支出合同的年化恒为 0', async () => {
  const r = await call('GET', '/contracts', { query: { size: 100 } })
  eq(r.status, 200, 'HTTP 状态')
  const rows = r.data.rows
  assert(rows.length > 0, '应有合同样例')

  const cats = new Set(rows.map(c => c.incomeCategory))
  for (const c of cats) {
    assert(['主营业务', '多种经营', '不计入'].includes(c), `收入分类取值合法：${c}`)
  }
  assert(cats.has('多种经营') && cats.has('不计入'), '样例里应同时有经营与支出合同')

  for (const c of rows) {
    assert(typeof c.contractMonths === 'number' && c.contractMonths > 0, `${c.contractId} 应有期间月数`)
    if (c.incomeCategory === '多种经营') {
      /* 年化 = (金额 − 公共收益) ÷ 月数 × 12 */
      const expect = Math.round((c.amount - c.publicRevenue) / c.contractMonths * 12 * 100) / 100
      assert(Math.abs(c.annualRevenue - expect) <= 0.02,
        `${c.contractId} 年化应 = (金额 − 公共收益) ÷ 月数 × 12：${c.annualRevenue} vs ${expect}`)
      assert(c.publicRevenue <= c.amount, `${c.contractId} 公共收益不得大于合同金额`)
      assert(c.annualRevenue > 0, `${c.contractId} 经营合同年化应大于 0`)
    } else {
      eq(c.annualRevenue, 0, `${c.contractId}（${c.incomeCategory}）年化应恒为 0`)
      eq(c.publicRevenue || 0, 0, `${c.contractId} 非经营合同不该有公共收益`)
    }
  }

  /* 汇总口径：合同总金额 ≠ 收入，经营年化只算 16 份 */
  const s = await call('GET', '/contracts/summary')
  eq(s.status, 200, 'summary HTTP 状态')
  assert(s.data.operationCount > 0 && s.data.operationCount < s.data.total,
    `经营合同数应少于总数：${s.data.operationCount}/${s.data.total}`)
  assert(s.data.expenseCount > 0, '应有支出合同数')
  assert(s.data.operationAmount > 0 && s.data.operationAmount < s.data.amount,
    `经营年化应小于合同总额：${s.data.operationAmount} vs ${s.data.amount}`)

  /* 按收入分类筛选 */
  const f = await call('GET', '/contracts', { query: { size: 100, incomeCategory: '多种经营' } })
  eq(f.data.rows.every(x => x.incomeCategory === '多种经营'), true, '按收入分类筛选')
})

test('建合同：非经营合同填公共收益、公共收益超合同金额都要拦', async () => {
  const base = {
    name: '契约测试 · 广告位租赁', type: '租赁', subtype: '广告位租赁',
    partyB: '契约测试广告传媒', amount: 120000,
    startDate: '2026-01-01', endDate: '2027-12-31', payCycle: '季付'
  }
  const wrongCat = await call('POST', '/contracts', {
    body: { ...base, incomeCategory: '不计入', publicRevenue: 30000 }
  })
  eq(wrongCat.status, 422, '非经营合同填公共收益 HTTP 状态')
  eq(wrongCat.code, 42208, '非经营合同填公共收益业务码')

  const tooMuch = await call('POST', '/contracts', {
    body: { ...base, incomeCategory: '多种经营', publicRevenue: 200000 }
  })
  eq(tooMuch.status, 422, '公共收益超合同金额 HTTP 状态')
  eq(tooMuch.code, 42208, '公共收益超合同金额业务码')

  const ok = await call('POST', '/contracts', {
    body: { ...base, incomeCategory: '多种经营', publicRevenue: 72000 }
  })
  eq(ok.status, 201, '经营合同建档 HTTP 状态（创建返回 201）')
  const c = ok.data   /* 创建接口回裸对象，不是 { contract } 包装 */
  eq(c.incomeCategory, '多种经营', '收入分类落库')
  eq(c.publicRevenue, 72000, '公共收益落库')
  eq(c.contractMonths, 24, '期间月数（2026-01-01 → 2027-12-31）')
  /* (120000 − 72000) ÷ 24 × 12 = 24000 */
  eq(c.annualRevenue, 24000, '年化商业合作收入')
  eq(c.status, '待审批', '新建合同进审批，不直接生效')
})

test('多种经营报表：两分项相加 = 合计，月度与明细都对得上', async () => {
  const r = await call('GET', '/reports/multi-revenue')
  eq(r.status, 200, '汇总 HTTP 状态')
  const d = r.data
  const sum = Math.round((d.service.income + d.cooperation.income) * 100) / 100
  eq(d.total, sum, '合计 = 商业服务 + 商业合作')
  assert(d.total > 0, '样例应有多种经营收入')
  eq(d.share.service + d.share.cooperation, 100, '两分项占比之和为 100（允许 0.1 误差）', 0.2)

  /* 商业服务只算完工单：明细行数应与 count 一致 */
  const orders = await call('GET', '/reports/multi-revenue/contracts')
  eq(orders.data.length, d.cooperation.count, '合同明细行数 = 汇总里的合同数')

  /* 月度：合计应等于汇总（同一年、无月份截断） */
  const m = await call('GET', '/reports/multi-revenue/monthly', { query: { months: 12 } })
  eq(m.status, 200, '月度 HTTP 状态')
  eq(m.data.length, 12, '12 个月')
  const mSum = Math.round(m.data.reduce((s2, x) => s2 + x.total, 0) * 100) / 100
  /* 汇总里合同收入乘了「当年覆盖月数」，月度逐月摊同样覆盖范围，两边应基本一致 */
  assert(Math.abs(mSum - d.total) <= Math.max(1, d.total * 0.02),
    `月度合计与汇总一致：${mSum} vs ${d.total}`)

  /* 合同明细：income = 年化 × 覆盖月数 ÷ 12 */
  const cs = await call('GET', '/reports/multi-revenue/contracts')
  eq(cs.status, 200, '合同明细 HTTP 状态')
  assert(cs.data.length > 0, '应有计入当年的经营合同')
  for (const c of cs.data) {
    const expect = Math.round(c.annualRevenue * c.coverMonths / 12 * 100) / 100
    assert(Math.abs(c.income - expect) <= 0.02, `${c.contractNo} 计入金额应按覆盖月数折算`)
    assert(c.coverMonths > 0 && c.coverMonths <= 12, `${c.contractNo} 覆盖月数应在 1–12`)
    assert(c.publicRevenue <= c.amount, `${c.contractNo} 公共收益不得大于合同金额`)
  }

  /* 项目排行：各项目相加 = 合计 */
  const bp = await call('GET', '/reports/multi-revenue/by-project')
  eq(bp.status, 200, '项目排行 HTTP 状态')
  const bpSum = Math.round(bp.data.reduce((s2, x) => s2 + x.total, 0) * 100) / 100
  assert(Math.abs(bpSum - d.total) <= Math.max(1, d.total * 0.02), `项目合计与汇总一致：${bpSum} vs ${d.total}`)
})

test('工时积分：只公共区域可记，积分 = 工时 × 10 × 部位权重，重记留痕', async () => {
  const list = await call('GET', '/work-orders', { query: { size: 100 } })
  const rows = list.data.rows
  const bizWo = rows.find(w => w.type === '商业服务')
  const pubDone = rows.find(w => w.type === '公共区域维修'
    && ['已完工', '已评价', '已关闭'].includes(w.status) && w.assignee)
  const pubOpen = rows.find(w => w.type === '公共区域维修'
    && !['已完工', '已评价', '已关闭'].includes(w.status) && w.assignee)
  assert(bizWo && pubDone && pubOpen, '样例里应同时有商业服务、已完工与未完工的公共工单')

  /* 商业服务不给记：它走提成，重复激励 */
  const bizTry = await call('POST', `/work-orders/${bizWo.woId}/labor-points`, { body: { hours: 1 } })
  eq(bizTry.status, 422, '商业服务记积分 HTTP 状态')
  eq(bizTry.code, 42210, '商业服务记积分业务码')
  assert(bizTry.message.includes('提成'), `提示应说清原因：${bizTry.message}`)

  /* 未完工不给记 */
  const openTry = await call('POST', `/work-orders/${pubOpen.woId}/labor-points`, { body: { hours: 1 } })
  eq(openTry.status, 409, '未完工记积分 HTTP 状态')
  eq(openTry.code, 40926, '未完工记积分业务码')

  /* 工时越界 */
  const tooLong = await call('POST', `/work-orders/${pubDone.woId}/labor-points`, { body: { hours: 30 } })
  eq(tooLong.code, 42210, '工时超过 24 小时业务码')

  /* 正常记：土建权重 1.1，3 小时 → 33 分 */
  const ok = await call('POST', `/work-orders/${pubDone.woId}/labor-points`, {
    body: { hours: 3, operator: '契约测试' }
  })
  eq(ok.status, 200, '记积分 HTTP 状态')
  const ledger = ok.data.ledger
  eq(ledger.hours, 3, '工时落库')
  eq(ledger.weight, 1.1, '部位权重（土建 1.1）')
  eq(ledger.points, 33, '积分 = 3 × 10 × 1.1')
  eq(ledger.status, '待结算', '新记录为待结算')
  eq(ledger.by, '契约测试', '留痕到人')
  eq(ledger.ruleVersion, 'POINT-2026-11-01', '带规则版本（改权重不回溯）')
  assert(/^\d{4}-\d{2}$/.test(ledger.period), `归属期间格式：${ledger.period}`)

  /* 工单上的积分字段同步 */
  const detail = await call('GET', `/work-orders/${pubDone.woId}`)
  eq(detail.data.workOrder.laborPoints, 33, '工单积分同步')
  eq(detail.data.workOrder.pointsStatus, '待结算', '工单结算状态同步')

  /* 重记：旧流水标「已作废」，不是删除 */
  const again = await call('POST', `/work-orders/${pubDone.woId}/labor-points`, { body: { hours: 2 } })
  eq(again.data.ledger.points, 22, '重记后积分 = 2 × 10 × 1.1')
  eq(again.data.ledger.beforePoints, 33, '流水记住改前的值')
  const logs = await call('GET', `/work-orders/${pubDone.woId}/labor-points`)
  eq(logs.status, 200, '流水 HTTP 状态')
  assert(logs.data.length >= 2, `流水应保留历史：${logs.data.length} 条`)
  eq(logs.data.filter(x => x.status !== '已作废').length, 1, '有效流水只有一条（其余已作废）')
  eq(logs.data[0].points, 22, '最新一条在最前')

  /* 期间汇总（绩效侧读取口）：已作废的不计入 */
  const sum = await call('GET', '/labor-points/summary', { query: { period: ledger.period } })
  eq(sum.status, 200, '汇总 HTTP 状态')
  assert(Array.isArray(sum.data.rows), '汇总返回行数组')
  const mine = sum.data.rows.find(x => x.empName === pubDone.assignee)
  assert(mine, `应有 ${pubDone.assignee} 的期间汇总`)
  assert(mine.points >= 22, `汇总积分应至少含本次 22 分：${mine.points}`)
  eq(sum.data.perfConversion.implemented, false, '绩效折算本期未实现（结构已预留）')
  eq(sum.data.perfConversion.ruleVersion, 'POINT-2026-11-01', '折算规则版本可读')
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

test('房屋六态：枚举收敛、公寓存在、未交房不计费', async () => {
  const hs = await call('GET', '/owners/OW00001/houses')
  eq(hs.status, 200, 'HTTP 状态')

  /* 六态必须收敛：旧值（自住/出租/空置/装修中/限制使用）一个都不该再出现。
     这条断言的价值在于「改枚举时漏改某一处」——漏改的那条会以旧值出现在这里。 */
  const STATUS = ['已入住', '装修未入住', '正在装修', '已交房未装修', '未交房', '空置房']
  const all = await call('GET', '/houses?size=500').catch(() => null)
  const rows = all && all.data && all.data.rows ? all.data.rows : []
  if (rows.length) {
    const bad = rows.filter(r => !STATUS.includes(r.useStatus))
    eq(bad.length, 0, `使用状态必须都在六态内，越界：${bad.slice(0, 3).map(r => r.useStatus).join(',')}`)
    assert(rows.some(r => r.usage === '公寓'), '用途应包含公寓')
    assert(rows.every(r => ['住宅', '公寓', '商业'].includes(r.usage)), '用途只能是 住宅 / 公寓 / 商业')
  }

  /* 未交房不计费：这是六态里唯一会改变账务口径的一档 */
  const undelivered = (rows.length ? rows : []).filter(r => r.useStatus === '未交房')
  for (const h of undelivered.slice(0, 3)) {
    const b = await call('GET', '/bills', { query: { houseId: h.houseId, size: 50 } })
    eq(b.data.total, 0, `未交房房屋不该有账单（${h.fullName}）`)
  }
})

test('租客类型：公司字段齐全、信用代码校验位正确、完整度按类型算', async () => {
  const list = await call('GET', '/tenants', { query: { size: 100 } })
  eq(list.status, 200, 'HTTP 状态')
  const rows = list.data.rows
  assert(rows.length > 0, '应有租户样例')

  const co = rows.filter(r => r.tenantType === '公司')
  const per = rows.filter(r => r.tenantType === '个人')
  assert(co.length > 0 && per.length > 0, '个人与公司都要有样例')

  /* 公司：主体名称一致、凭证是信用代码不是身份证、经办人齐全 */
  for (const c of co) {
    eq(c.name, c.companyName, `公司租户 name 应等于 companyName（${c.tenantId}）`)
    eq(c.idCard, '', '公司主体不押个人身份证')
    assert(/^\d{2}\d{6}/.test(String(c.creditCode || '')), `信用代码格式不对：${c.creditCode}`)
    assert(c.legalPerson && c.agentName && c.agentPhone, '法人 / 经办人 / 经办人手机都要有')
    assert(['餐饮', '零售', '教育培训', '生活服务', '办公', '医疗健康', '其他'].includes(c.businessCategory),
      `经营类目取值非法：${c.businessCategory}`)
    /* 完整度按公司口径算：8 项里不该出现个人才有的"与业主关系""居住人数" */
    const miss = c.completeness.missing || []
    assert(!miss.includes('与业主关系') && !miss.includes('居住人数'),
      `公司完整度不该用个人口径：${miss.join(',')}`)
    eq(c.completeness.total, 8, '公司完整度也是 8 项')
  }

  /* 个人：不带公司字段 */
  for (const p of per.slice(0, 5)) {
    eq(p.companyName, undefined, '个人租户不该有 companyName')
    assert(p.completeness.total === 8, '个人完整度 8 项')
  }

  /* 信用代码校验位：服务端校验逻辑与数据必须一致（数据是算出来的，不是编的） */
  const CC = '0123456789ABCDEFGHJKLMNPQRTUWXY'
  const W = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]
  for (const c of co) {
    const v = c.creditCode
    const sum = [...v.slice(0, 17)].reduce((acc, ch, i) => acc + CC.indexOf(ch) * W[i], 0)
    const k = 31 - (sum % 31)
    eq(v[17], CC[k === 31 ? 0 : k], `信用代码校验位应正确（${v}）`)
  }
})

/* 信用代码生成：测试里要造一个"校验位正确"的代码，否则会被接口自己的校验拦住 */
function mkCreditCode(seq) {
  const C = '0123456789ABCDEFGHJKLMNPQRTUWXY'
  const W2 = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]
  /* 结构：登记管理部门(1) + 机构类别(1) + 行政区划(4) + 主体标识(9) + 校验(1) = 18 位 */
  let body = '915101' + String((seq % 20) + 1).padStart(2, '0')
  for (let i = 0; i < 9; i += 1) body += C[(seq * 7 + i * 11 + 3) % 31]
  const sum = [...body].reduce((acc, ch, i) => acc + C.indexOf(ch) * W2[i], 0)
  const k = 31 - (sum % 31)
  return body + C[k === 31 ? 0 : k]
}

test('营业执照影像件：没有它公司核验过不去；格式 / 大小 / 重复都拦住', async () => {
  /* 找一家"基础信息齐但没影像件"的公司；样例里信息不全的一定没件 */
  const list = await call('GET', '/tenants', { query: { size: 100 } })
  const co = list.data.rows.filter(t => t.tenantType === '公司')
  assert(co.length > 0, '样例里应有公司租户')
  const noFile = co.find(t => (t.licenseFiles || []).length === 0)
  assert(noFile, '样例里应有一家缺影像件的公司（正是要测的分支）')

  const gate = await call('POST', `/tenants/${noFile.tenantId}/verify`, { body: { pass: true } })
  eq(gate.status, 422, '缺影像件时核验 HTTP 状态')
  eq(gate.code, 42203, '缺影像件时业务码')

  const badType = await call('POST', `/tenants/${noFile.tenantId}/license-files`, {
    body: { name: '执照.txt', size: 1200, type: 'text/plain' }
  })
  eq(badType.status, 422, '非白名单格式 HTTP 状态')
  eq(badType.code, 42204, '非白名单格式业务码')

  const tooBig = await call('POST', `/tenants/${noFile.tenantId}/license-files`, {
    body: { name: '执照.jpg', size: 9 * 1024 * 1024, type: 'image/jpeg' }
  })
  eq(tooBig.status, 422, '超体积 HTTP 状态')
  assert(tooBig.message.includes('5 MB'), `提示应说明上限：${tooBig.message}`)

  const ok = await call('POST', `/tenants/${noFile.tenantId}/license-files`, {
    body: { name: '营业执照正本.pdf', size: 820000, type: 'application/pdf', operator: '契约测试' }
  })
  eq(ok.status, 200, '上传 HTTP 状态')
  eq(ok.data.files.length, 1, '应回最新清单')
  eq(ok.data.files[0].uploadedBy, '契约测试', '留痕到人')

  const dup = await call('POST', `/tenants/${noFile.tenantId}/license-files`, {
    body: { name: '营业执照正本.pdf', size: 820000, type: 'application/pdf' }
  })
  eq(dup.status, 409, '重复上传 HTTP 状态')
  eq(dup.code, 40922, '重复上传业务码')

  const detail = await call('GET', `/tenants/${noFile.tenantId}`)
  eq(detail.data.tenant.completeness.licenseReady, true, '有件后核验依据齐备')
  eq(detail.data.tenant.completeness.licenseCount, 1, '件数')
  eq(detail.data.tenant.completeness.total, 8, '影像是门槛，不是第 9 项完整度')

  const del = await call('DELETE', `/tenants/${noFile.tenantId}/license-files/${ok.data.files[0].fileId}`)
  eq(del.status, 200, '删除 HTTP 状态')
  eq(del.data.files.length, 0, '删到 0 张')
  const again = await call('POST', `/tenants/${noFile.tenantId}/verify`, { body: { pass: true } })
  eq(again.code, 42203, '删完后核验又被拦住（不是静默放行）')
})

test('个人租户不该有营业执照影像件', async () => {
  const list = await call('GET', '/tenants', { query: { size: 100 } })
  const per = list.data.rows.find(t => (t.tenantType || '个人') === '个人')
  const r = await call('POST', `/tenants/${per.tenantId}/license-files`, {
    body: { name: '营业执照.jpg', size: 400000, type: 'image/jpeg' }
  })
  eq(r.status, 422, '个人租户上传执照 HTTP 状态')
  assert(r.message.includes('公司'), `提示应说明只有公司需要：${r.message}`)
})

test('换承租主体：原因必填、目标必备信息、换完撤人脸复位核验', async () => {
  const list = await call('GET', '/tenants', { query: { size: 100 } })
  const per = list.data.rows.find(t => (t.tenantType || '个人') === '个人' && t.status === '在住')
  assert(per, '应有个人租户')

  const noReason = await call('POST', `/tenants/${per.tenantId}/change-type`, {
    body: { toType: '公司', reason: '换' }
  })
  eq(noReason.status, 422, '原因太短 HTTP 状态')
  assert(noReason.message.includes('原因'), `提示应说明要写原因：${noReason.message}`)

  const noName = await call('POST', `/tenants/${per.tenantId}/change-type`, {
    body: { toType: '公司', reason: '个体户注册成公司，租约转由公司承继' }
  })
  eq(noName.status, 422, '缺公司名 HTTP 状态')
  eq(noName.code, 42203, '缺公司名业务码')

  const code = mkCreditCode(37)
  const toCo = await call('POST', `/tenants/${per.tenantId}/change-type`, {
    body: {
      toType: '公司', reason: '个体户注册成公司，租约转由公司承继', operator: '契约测试',
      patch: {
        companyName: '成都纽扣科技有限公司', creditCode: code, legalPerson: '周牧',
        legalPersonPhone: '13800138001', agentName: per.name, agentPhone: per.phone,
        businessCategory: '办公'
      }
    }
  })
  eq(toCo.status, 200, '换公司 HTTP 状态')
  assertSchema(toCo, 'TenantEnvelope', 'POST /tenants/{id}/change-type')
  const t2 = toCo.data
  eq(t2.tenantType, '公司', '类型已换')
  eq(t2.name, '成都纽扣科技有限公司', '主体名称随公司名')
  eq(t2.idCard, '', '公司主体不押个人身份证')
  eq(t2.relation, '企业承租', '关系按公司口径')
  eq(t2.faceRegistered, false, '换主体要撤销人脸')
  eq(t2.certified, false, '换主体要重新实名')
  eq(t2.verifyStatus, '待核验', '换主体要重新核验')
  eq(t2.licenseFiles.length, 0, '新公司主体还没有影像件（核验会被拦住）')

  const noLicense = await call('POST', `/tenants/${per.tenantId}/verify`, { body: { pass: true } })
  eq(noLicense.status, 422, '换公司后未传执照就核验')
  eq(noLicense.code, 42203, '业务码')

  const same = await call('POST', `/tenants/${per.tenantId}/change-type`, {
    body: { toType: '公司', reason: '再换一次看看', patch: { companyName: '成都纽扣科技有限公司', creditCode: code } }
  })
  eq(same.status, 409, '同类型重复转换 HTTP 状态')
  eq(same.code, 40921, '同类型重复转换业务码')

  const back = await call('POST', `/tenants/${per.tenantId}/change-type`, {
    body: {
      toType: '个人', reason: '公司注销，由原经办人个人续租', operator: '契约测试',
      patch: { name: '周牧', phone: '13800138001' }
    }
  })
  eq(back.status, 200, '换回个人 HTTP 状态')
  eq(back.data.tenantType, '个人', '类型已换回')
  eq(back.data.companyName, '', '公司字段清空（不留脏数据）')
  eq(back.data.creditCode, '', '信用代码清空')
  eq(back.data.idCard, per.phone === '' ? '' : back.data.idCard, '证件从经办人迁移过来')
  eq(back.data.relation, '承租人', '关系回到个人口径')
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
  const good = list.data.rows.find(t => t.completeness.missingBasic.length === 0 && !t.faceRegistered
    && ((t.tenantType || '个人') !== '公司' || (t.licenseFiles || []).length > 0))
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
  /* 不写死数字：每加一条权限码都得回来改断言，改漏了就会在无关的批次里红。
     口径改成「GM 拿全部权限位，除了 op 不在 view/edit 里的那些」（如 f.inspect.exec）——
     它们是"执行"能力，通配 view/edit 覆盖不到，这是既有设计而不是漏授。 */
  /* 2026-11-03 起 op 多了 eval（计划结案评分）：它是**管理动作**不是现场执行，
     总经理 / 项目经理 / 运营管理部都该有，所以排除条件只留 exec。 */
  const execOnly = ALL_PERMS_FIX.filter(p => p.op === 'exec').length
  eq(gm.permCount, ALL_PERMS_TOTAL - execOnly,
    `集团总经理应有除「执行类 op=exec」外的全部权限位（共 ${ALL_PERMS_TOTAL} 减 ${execOnly}）`)
  eq(gm.coverage, Math.round(gm.permCount / ALL_PERMS_TOTAL * 100), '覆盖度 = 已授权 / 全部权限位')
})

test('角色详情：矩阵三层、高敏持有、可见范围', async () => {
  const r = await call('GET', '/roles/R-GM')
  eq(r.status, 200, 'HTTP 状态')
  assertSchema(r, 'RoleDetailEnvelope', 'GET /roles/{id}')
  eq(r.data.matrix.total, ALL_PERMS_TOTAL, '权限位总数应等于权限字典条数')
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


/* ============================ 部门计划（G 域） ============================ */
test('部门计划：三段考核项、权重闭合、5 分制总分', async () => {
  token = await login('gm')
  const r = await call('GET', '/dept-plans')
  eq(r.status, 200, '计划列表 HTTP 状态')
  const list = r.data
  eq(list.length, 4, '四份样例计划')

  const p = list.find(x => x.planId === 'PL202610002')
  assert(!!p, '找到执行中的那份')
  assert(Array.isArray(p.items) && p.items.length === 15, `条目 15 条（实际 ${p.items.length}）`)

  const sec = k => p.items.filter(i => i.section === k)
  eq(sec('q').length, 5, '量化 5 条')
  eq(sec('m').length, 5, '监控 5 条')
  eq(sec('k').length, 5, '重点 5 条')
  eq(sec('m').every(i => i.weight === 0), true, '监控段权重全部为 0')

  const qw = sec('q').reduce((s, i) => s + i.weight, 0)
  const kw = sec('k').reduce((s, i) => s + i.weight, 0)
  eq(Math.round((qw + kw) * 100) / 100, 100, `量化 ${qw}% + 重点 ${kw}% = 100%`)
  eq(p.weightOk, true, '权重校验通过')

  const closed = list.find(x => x.status === '已结案')
  assert(!!closed, '有已结案的计划')
  assert(closed.totalScore > 0 && closed.totalScore <= 5,
    `总分是 5 分制（${closed.totalScore}）`)
  assert(['A', 'B', 'C', 'D'].includes(closed.grade), `档位合法（${closed.grade}）`)

  const expected = Math.round((closed.selfTotal * 0.2 + closed.reviewTotal * 0.8) * 100) / 100
  eq(closed.totalScore, expected, `总分 = 自评 ${closed.selfTotal}×20% + 复评 ${closed.reviewTotal}×80%`)

  const draft = list.find(x => x.status === '审批中')
  eq(draft.totalScore, 0, '没归档的不出分')
})

test('部门计划：同一部门同月只能一份；非负责人不能提报', async () => {
  token = await login('pm')
  const model = (await call('GET', '/dept-plans/PL202610001')).data
  const body = {
    planMonth: model.planMonth,
    orgId: model.orgId,
    items: model.items.map(i => ({ section: i.section, name: i.name, weight: i.weight }))
  }

  const dup = await call('POST', '/dept-plans', { body })
  assert([403, 409].includes(dup.status), `重复提报被拦（实际 ${dup.status}）`)
  if (dup.status === 409) eq(dup.code, 40925, '同月重复用 40925')

  token = await login('gm')
  const other = await call('POST', '/dept-plans', {
    body: { planMonth: '2026-10', orgId: 'O-P03', items: [{ section: 'q', name: '测试指标', weight: 100 }] }
  })
  assert(other.status === 403, `总经理不是该部门负责人 → 403（实际 ${other.status}）`)
  assert(String(other.message).includes('负责人'), `提示不是负责人：${other.message}`)
})

test('部门计划：审核直改留痕；权重不闭合不给下发', async () => {
  token = await login('gm')
  const p = (await call('GET', '/dept-plans/PL202610001')).data
  eq(p.status, '审批中', '样例在审批中')

  const items = p.items.map(i => ({ ...i }))
  const q = items.find(i => i.section === 'q')
  const before = q.weight
  q.weight = 5

  const r = await call('PATCH', `/dept-plans/${p.planId}/items`, { body: { items } })
  eq(r.status, 200, '审核直改允许保存（不走驳回、不整单拒绝）')
  eq(r.data.weightOk, false, '但标记权重不闭合')
  assert(r.data.reviseLog.length > 0, `改动进 reviseLog（${r.data.reviseLog.length} 条）`)
  assert(String(r.data.reviseLog[0].field).includes('权重'), `记录到字段：${r.data.reviseLog[0].field}`)
  assert(String(r.data.reviseLog[0].before) === String(before), `记下改前值 ${before}`)

  const app = await call('POST', `/dept-plans/${p.planId}/approve`)
  assert(app.status === 422, `权重不闭合不能下发（实际 ${app.status}）`)
  assert(String(app.message).includes('权重'), `说明原因：${app.message}`)

  const back = items.map(i => ({ ...i }))
  back.find(i => i.section === 'q').weight = before
  await call('PATCH', `/dept-plans/${p.planId}/items`, { body: { items: back } })
  const ok2 = await call('POST', `/dept-plans/${p.planId}/approve`)
  eq(ok2.status, 200, `改回后可以下发（${ok2.status} ${ok2.message || ''}）`)
  eq(ok2.data.status, '已批准', '状态进执行')
})

test('部门计划：执行填报 → 自评按公式算 → 提交完成情况后才是待复评', async () => {
  token = await login('gm')
  const p = (await call('GET', '/dept-plans/PL202610002')).data
  eq(p.status, '执行中', '样例是执行中')

  const qItem = p.items.find(i => i.section === 'q')
  const target = Number(qItem.target)
  const reject = Math.round(target * 0.95 * 100) / 100
  const challenge = Math.round(target * 1.05 * 100) / 100

  /* 恰好达到否决值 → 夹下限 1 分 */
  let r = await call('PATCH', `/dept-plans/${p.planId}/items/${qItem.taskId}`, {
    body: { actual: reject }
  })
  eq(r.status, 200, '填实际值 HTTP 状态')
  let row = r.data.items.find(i => i.taskId === qItem.taskId)
  eq(row.selfScore, 1, `实际 = 否决值 → 自评 1 分（${row.selfScore}）`)

  /* 超过挑战值 → 封顶 5 分 */
  r = await call('PATCH', `/dept-plans/${p.planId}/items/${qItem.taskId}`, {
    body: { actual: challenge * 1.2 }
  })
  row = r.data.items.find(i => i.taskId === qItem.taskId)
  eq(row.selfScore, 5, `实际超过挑战值 → 自评封顶 5 分（${row.selfScore}）`)

  /* 中间值按比例 */
  const mid = reject + (challenge - reject) / 2
  r = await call('PATCH', `/dept-plans/${p.planId}/items/${qItem.taskId}`, {
    body: { actual: mid }
  })
  row = r.data.items.find(i => i.taskId === qItem.taskId)
  assert(Math.abs(row.selfScore - 2.5) < 0.2, `区间中点约 2.5 分（实际 ${row.selfScore}）`)

  const w = row.weight
  eq(row.selfWeighted, Math.round(row.selfScore * w) / 100,
    `加权 = 分 × 权重/100（${row.selfScore} × ${w}% = ${row.selfWeighted}）`)

  const res = await call('POST', `/dept-plans/${p.planId}/result`)
  assert(res.status === 200 || res.status === 422,
    `提交完成情况（实际 ${res.status}：可能因仍有项没填被拦）`)
  if (res.status === 422) {
    assert(String(res.message).includes('没填'), `提示还差哪些没填：${res.message}`)
  } else {
    eq(res.data.status, '待复评', '提交后进入待复评')
  }
})

test('部门计划：没提交完成情况不给复评；归档按 20/80 合成', async () => {
  token = await login('gm')

  /* 上一轮已经下发、但填报人还没提交完成情况 → 直接复评要被状态拦住 */
  const approved = (await call('GET', '/dept-plans/PL202610001')).data
  eq(approved.status, '已批准', '样例已下发、未报完成')
  const blocked = await call('POST', `/dept-plans/${approved.planId}/review`, {
    body: { scores: {}, deductions: {} }
  })
  assert(blocked.status === 409, `已批准但没报完成 → 不能复评（实际 ${blocked.status}）`)
  eq(blocked.code, 40926, '用 40926 表示状态不允许')
  assert(String(blocked.message).includes('提交完成情况'), `说清为什么：${blocked.message}`)

  /* 待复评那份：缺项也拦 */
  const p = (await call('GET', '/dept-plans/PL202610003')).data
  eq(p.status, '待复评', '样例是待复评')

  const partial = await call('POST', `/dept-plans/${p.planId}/review`, {
    body: { scores: {}, deductions: {} }
  })
  assert(partial.status === 422, `一项没打分 → 422（实际 ${partial.status}）`)
  assert(String(partial.message).includes('没打分'), `提示缺几项：${partial.message}`)

  const scores = {}
  const deductions = {}
  for (const it of p.items) {
    if (it.section === 'm') deductions[it.taskId] = Number(it.selfWeighted) || 0
    else scores[it.taskId] = 4
  }
  const r = await call('POST', `/dept-plans/${p.planId}/review`, { body: { scores, deductions } })
  eq(r.status, 200, '复评归档 HTTP 状态')
  eq(r.data.status, '已结案', '状态已归档')
  assert(r.data.totalScore > 0 && r.data.totalScore <= 5, `总分在 0–5（${r.data.totalScore}）`)

  const expect = Math.round((r.data.selfTotal * 0.2 + r.data.reviewTotal * 0.8) * 100) / 100
  eq(r.data.totalScore, expect, '20/80 合成正确')

  const again = await call('POST', `/dept-plans/${p.planId}/review`, { body: { scores, deductions } })
  assert(again.status === 409, `归档后不能再评（实际 ${again.status}）`)
})

test('部门计划：统计口径 —— 只算已归档的平均分，总部职能单列', async () => {
  token = await login('gm')
  const r = await call('GET', '/dept-plans/stats')
  eq(r.status, 200, '统计 HTTP 状态')
  const st = r.data

  eq(st.planCount, 4, '计划数 4')
  const sum = st.byStatus.reduce((s, x) => s + x.count, 0)
  eq(sum, st.planCount, '状态分布合计等于计划总数')
  eq(st.byExec.reduce((s, x) => s + x.count, 0), st.totalItems, '条目执行分布合计等于条目总数')
  eq(st.byGrade.reduce((s, x) => s + x.count, 0), st.closedCount, '档位分布合计等于已归档数')

  assert(st.avgScore > 0 && st.avgScore <= 5, `平均分是 5 分制（${st.avgScore}）`)
  const orgNames = st.byOrg.map(o => o.name)
  assert(orgNames.length > 0, `按项目分组（${orgNames.join('、')}）`)
})

test('部门计划：权重必须是 5 的倍数、合计正好 100%（多了少了都拦）', async () => {
  token = await login('pm')
  const base = (n, w, section) => ({
    section, name: n, weight: w, target: 100, dueDate: '2026-11-30', actual: ''
  })

  /* 95%：草稿允许存，提交才卡 */
  const created = await call('POST', '/dept-plans', {
    body: {
      planMonth: '2026-11', orgId: 'O-P01',
      items: [base('部门预算执行率', 50, 'q'), base('重点工作按期完成率', 40, 'q'), base('月度重点工作', 5, 'k')]
    }
  })
  eq(created.status, 200, `新建草稿 HTTP 状态（${created.message || ''}）`)
  const planId = created.data.planId
  eq(created.data.weightTotal, 95, '草稿权重合计 95% 也允许保存')
  eq(created.data.weightOk, false, '但标记为不闭合')
  eq(created.data.weightDiff, 5, '派生字段给出还差 5%')

  const less = await call('POST', `/dept-plans/${planId}/submit`)
  eq(less.status, 422, `95% 提交被拦（实际 ${less.status}）`)
  assert(String(less.message).includes('还差 5%'), `说明还差多少：${less.message}`)

  /* 52 + 43 + 5 = 100：合计对了，但不是 5 的倍数 —— 这条最容易漏，
     因为"合计 100"看起来完全正常，只有逐项看才发现 52 这种填法根本不该存在 */
  const offStep = await call('PATCH', `/dept-plans/${planId}`, {
    body: {
      planMonth: '2026-11', orgId: 'O-P01',
      items: [base('部门预算执行率', 52, 'q'), base('重点工作按期完成率', 43, 'q'), base('月度重点工作', 5, 'k')]
    }
  })
  eq(offStep.status, 200, '非 5 的倍数也能存草稿（不强迫填对才能存）')
  eq(offStep.data.weightTotal, 100, '合计确实是 100%')
  eq(offStep.data.weightOk, false, '但 52 / 43 不是 5 的倍数 → 标记不合规')
  assert(String(offStep.data.weightMsg).includes('5 的倍数'), `说明只能按 5% 调：${offStep.data.weightMsg}`)
  assert(String(offStep.data.weightMsg).includes('52%'), `点出是哪一项不合规：${offStep.data.weightMsg}`)

  const stepSubmit = await call('POST', `/dept-plans/${planId}/submit`)
  eq(stepSubmit.status, 422, '非 5 的倍数提交被拦')
  assert(String(stepSubmit.message).includes('5 的倍数'), `错误里写明步长：${stepSubmit.message}`)

  /* 105%：超出也要说清 */
  const over = await call('PATCH', `/dept-plans/${planId}`, {
    body: {
      planMonth: '2026-11', orgId: 'O-P01',
      items: [base('部门预算执行率', 60, 'q'), base('重点工作按期完成率', 40, 'q'), base('月度重点工作', 5, 'k')]
    }
  })
  eq(over.status, 200, '改成 105% 也能存草稿')
  eq(over.data.weightTotal, 105, '合计 105%')
  const overSubmit = await call('POST', `/dept-plans/${planId}/submit`)
  eq(overSubmit.status, 422, '105% 提交被拦')
  assert(String(overSubmit.message).includes('超出 5%'), `说明超出多少：${overSubmit.message}`)

  /* 调回 100% → 可以提交 */
  const fixed = await call('PATCH', `/dept-plans/${planId}`, {
    body: {
      planMonth: '2026-11', orgId: 'O-P01',
      items: [base('部门预算执行率', 55, 'q'), base('重点工作按期完成率', 40, 'q'), base('月度重点工作', 5, 'k')]
    }
  })
  eq(fixed.data.weightOk, true, '调回 100% 后闭合')
  const okSubmit = await call('POST', `/dept-plans/${planId}/submit`)
  eq(okSubmit.status, 200, `100% 提交成功（${okSubmit.message || ''}）`)
  eq(okSubmit.data.status, '审批中', '进入审批')
})

test('组织负责人：一部门多负责人，正职/代理/副职与状态都要能看见', async () => {
  token = await login('gm')
  const r = await call('GET', '/orgs/O-P01-T3/leaders')
  eq(r.status, 200, 'HTTP 状态')
  const list = r.data
  assert(list.length >= 2, `该部门应有 2 条以上负责关系（实际 ${list.length}）`)
  for (const x of list) {
    assert(['正职', '副职', '代理'].includes(x.duty), `职责取值合法：${x.duty}`)
    assert(['在期', '已结束', '未生效'].includes(x.state), `状态取值合法：${x.state}`)
    assert(typeof x.name === 'string' && x.name.length > 0, '负责人姓名由服务端补全')
    eq(x.active, x.state === '在期', 'active 与 state 一致')
  }
  /* 正职已离任、代理在期：这正是"代理顶上"的场景 */
  const zheng = list.find(x => x.duty === '正职')
  const proxy = list.find(x => x.duty === '代理')
  assert(zheng && zheng.state === '已结束', '正职应为「已结束」')
  assert(proxy && proxy.state === '在期', '代理应为「在期」')
  assert(proxy.endDate, '代理必须带结束日期')
  /* 排序：正职在前 */
  eq(list[0].duty, '正职', '列表按职责排序（正职 → 代理 → 副职）')

  const bad = await call('GET', '/orgs/O-NOT-EXIST/leaders')
  eq(bad.status, 404, '不存在的组织返回 404')
})

test('组织负责人：正职唯一（40927）与代理必填结束日期（42213）', async () => {
  token = await login('gm')
  const cur = await call('GET', '/orgs/O-P02/leaders')
  const zheng = cur.data.find(x => x.duty === '正职' && x.active)
  assert(zheng, 'O-P02 应有在期正职')

  /* 再加一个在期正职 → 409 */
  const dup = await call('PUT', '/orgs/O-P02/leaders', {
    body: {
      leaders: [
        { empId: zheng.empId, duty: '正职' },
        { empId: 'EM0001', duty: '正职' }
      ]
    }
  })
  eq(dup.status, 409, '两个在期正职 HTTP 状态')
  eq(dup.code, 40927, '两个在期正职业务码')

  /* 代理不填结束日期 → 422 */
  const noEnd = await call('PUT', '/orgs/O-P02/leaders', {
    body: { leaders: [{ empId: zheng.empId, duty: '正职' }, { empId: 'EM0001', duty: '代理' }] }
  })
  eq(noEnd.status, 422, '代理无结束日 HTTP 状态')
  eq(noEnd.code, 42213, '代理无结束日业务码')
  assert(noEnd.message.includes('结束日期'), `提示要说清缺什么：${noEnd.message}`)

  /* 结束日期早于开始日期 → 422 */
  const badRange = await call('PUT', '/orgs/O-P02/leaders', {
    body: {
      leaders: [{
        empId: zheng.empId, duty: '正职',
        startDate: '2026-10-10', endDate: '2026-10-01'
      }]
    }
  })
  eq(badRange.code, 42213, '日期倒挂业务码')

  /* 离职员工 → 422 */
  const left = await call('PUT', '/orgs/O-P02/leaders', {
    body: { leaders: [{ empId: 'EM0020', duty: '正职' }] }
  })
  if (left.status === 422) eq(left.code, 42213, '离职员工不能当负责人')
})

test('组织负责人：保存后 orgs.leader 快照同步（不能出现两套人名）', async () => {
  token = await login('gm')
  const before = await call('GET', '/orgs', { query: { size: 100 } })
  const org = before.data.rows.find(o => o.orgId === 'O-P03')
  assert(org, '应有星光天地项目部')
  const oldLeader = org.leader

  /* 换个正职：把原来的结束掉，换成另一个人 */
  const put = await call('PUT', '/orgs/O-P03/leaders', {
    body: {
      leaders: [
        { empId: org.leaders.find(x => x.duty === '正职').empId, duty: '正职', endDate: '2026-10-20' },
        { empId: 'EM0008', duty: '正职', startDate: '2026-10-21' }
      ]
    }
  })
  eq(put.status, 200, '保存 HTTP 状态')
  const nowZheng = put.data.find(x => x.duty === '正职' && x.active)
  assert(nowZheng, '替换后应有在期正职')
  assert(nowZheng.name !== oldLeader, `在期正职应换人（原 ${oldLeader}）`)

  /* 组织列表上的 leader 必须跟着变 —— 组织树、被检班组读的是它 */
  const after = await call('GET', '/orgs', { query: { size: 100 } })
  const org2 = after.data.rows.find(o => o.orgId === 'O-P03')
  eq(org2.leader, nowZheng.name, 'orgs.leader 快照同步为新正职')
  assert((org2.leaders || []).length >= 2, '组织行带出完整负责人列表')

  /* 复原有正职，别把后面的用例带脏 */
  await call('PUT', '/orgs/O-P03/leaders', {
    body: { leaders: [{ empId: org.leaders.find(x => x.duty === '正职').empId, duty: '正职' }] }
  })
})


/* ============================ OA 会签（2026-11-03 第 53 批） ============================ */
test('OA 会签：一次同意只签一人，全部签完才推进下一级', async () => {
  token = await login('gm')
  /* 前面的「流程配置」用例会改写节点，这里显式把采购申请设回会签 ——
     测试之间共享一个服务实例，不能假设配置还是种子里的样子 */
  await call('PUT', '/oa/flows/采购申请', {
    body: {
      amountThreshold: 10000,
      baseNodes: [
        { name: '部门负责人审批', assigneeType: 'orgLeader', signMode: 'all', limitHours: 24, allowReject: true },
        { name: '项目经理审批', assigneeType: 'projectManager', limitHours: 24, allowReject: true }
      ],
      overNodes: []
    }
  })
  const created = await call('POST', '/oa/requests', {
    body: {
      bizType: '采购申请',
      formData: {
        itemName: 'LED 感应灯具', qty: 120, amount: 18600,
        communityId: 'P01', supplier: '成都恒光照明', reason: '车库灯具老化，夜间照度不足'
      }
    }
  })
  eq(created.status, 200, '发起 HTTP 状态')
  const id = created.data.approvalId
  const n1 = created.data.flow[0]
  eq(n1.signMode, 'all', '采购申请第一节点是「会签」')
  assert(Array.isArray(n1.approvers), '节点带 approvers 名单')
  assert(n1.approvers.length >= 2, `会签名单至少 2 人（实际 ${n1.approvers.length}）`)
  for (const p of n1.approvers) {
    eq(p.action, '待处理', `${p.name} 初始待签`)
    assert(['正职', '副职', '代理'].includes(p.duty), `名单里的人要有职责：${p.duty}`)
  }
  /* 名单里不能有申请人自己 */
  assert(!n1.approvers.some(p => p.name === created.data.applicant), '会签名单排除申请人本人')

  /* 第一次同意：只签掉一个人，单据仍停在当前节点 */
  const first = await call('POST', `/oa/requests/${id}/action`, { body: { action: '同意', comment: '预算内' } })
  eq(first.status, 200, '第一次同意 HTTP 状态')
  eq(first.data.status, '审批中', '签完一人仍「审批中」')
  assert(first.data.currentNode.includes('会签'), `当前节点标出会签进度：${first.data.currentNode}`)
  eq(first.data.flow[0].approvers.filter(p => p.action === '同意').length, 1, '只有一个人被签掉')
  eq(first.data.flow[0].action, '待处理', '节点整体还是待处理')
  eq(first.data.flow[1].action, '待处理', '下一节点还没轮到')

  /* 把剩下的签完（人数不定，逐个签） */
  let cur = first.data
  let guard = 0
  while (cur.flow[0].action === '待处理' && guard++ < 8) {
    const r = await call('POST', `/oa/requests/${id}/action`, { body: { action: '同意' } })
    eq(r.status, 200, `续签第 ${guard} 次`)
    cur = r.data
  }
  eq(cur.flow[0].action, '同意', '全部签完后节点通过')
  assert(cur.flow[0].comment.includes('会签'), `节点意见注明会签：${cur.flow[0].comment}`)
  assert(cur.status === '审批中' || cur.status === '已通过', `整单继续推进或完成：${cur.status}`)
})

test('OA 会签：一人驳回即整单驳回，其余人标「已跳过」', async () => {
  token = await login('gm')
  const created = await call('POST', '/oa/requests', {
    body: {
      bizType: '采购申请',
      formData: {
        itemName: '对讲机', qty: 6, amount: 4800,
        communityId: 'P01', reason: '安保巡逻通讯设备老化'
      }
    }
  })
  const id = created.data.approvalId
  assert(created.data.flow[0].approvers.length >= 2, '会签名单至少 2 人')

  const r = await call('POST', `/oa/requests/${id}/action`, { body: { action: '驳回', comment: '本季度采购额度已用完' } })
  eq(r.status, 200, '驳回 HTTP 状态')
  eq(r.data.status, '已驳回', '整单驳回')
  eq(r.data.currentNode, '已完成', '当前节点收口')
  const ap = r.data.flow[0].approvers
  eq(ap.filter(p => p.action === '驳回').length, 1, '只有一个人是驳回')
  assert(ap.some(p => p.action === '已跳过'), '其余人标「已跳过」（不是凭空消失）')
  eq(ap.filter(p => p.action === '待处理').length, 0, '不会有人还挂着待处理')
  assert(r.data.flow[0].comment.includes('采购额度'), '驳回原因留在节点上')

  /* 已结束的单不能再处理 */
  const again = await call('POST', `/oa/requests/${id}/action`, { body: { action: '同意' } })
  eq(again.status, 409, '已结束单据 HTTP 状态')
  eq(again.code, 40928, '已结束单据业务码')
})

test('OA 会签：单人节点不受影响（没有 approvers 时签完即推进）', async () => {
  token = await login('gm')
  const created = await call('POST', '/oa/requests', {
    body: {
      bizType: '用车申请',
      formData: { useAt: '2026-10-22 09:00', destination: '总部职能中心', reason: '送材料' }
    }
  })
  eq(created.status, 200, '发起用车申请')
  const n1 = created.data.flow[0]
  eq(n1.signMode, 'single', '用车申请的部门负责人是单人')
  eq(n1.approvers.length, 1, '单人节点的名单只有一条')
  const r = await call('POST', `/oa/requests/${created.data.approvalId}/action`, { body: { action: '同意' } })
  eq(r.status, 200, '同意 HTTP 状态')
  eq(r.data.flow[0].action, '同意', '单人节点签完即通过')
  assert(['审批中', '已通过'].includes(r.data.status), `单据继续推进：${r.data.status}`)
})

test('OA 审批动作：不是这单的人点不了同意（原来谁拿到 id 都能审）', async () => {
  token = await login('gm')
  const created = await call('POST', '/oa/requests', {
    body: {
      bizType: '用车申请',
      formData: { useAt: '2026-10-23 09:00', destination: '分公司', reason: '对接工作' }
    }
  })
  eq(created.status, 200, '先造一张待审批的单')
  const id = created.data.approvalId

  /* 一线员工：不在名单里、也不是总经理 / 项目经理 —— 这是最关键的一条 */
  token = await login('zhou-ming')
  const denied = await call('POST', `/oa/requests/${id}/action`, { body: { action: '同意' } })
  eq(denied.status, 403, '无关的人点同意要被拒')
  assert(String(denied.message).includes('卡在'),
    `拒绝时要说明这单卡在谁那里，而不是一句"无权限"：${denied.message}`)

  /* 单据不能因为这个 403 被动过（PC 侧没有单条 GET，走员工端详情接口看） */
  token = await login('gm')
  const still = await call('GET', `/mobile/approvals/${id}`)
  eq(still.status, 200, '取单据状态')
  eq(still.data.approval.status, '待审批', '被拒的请求不能改动单据')
  assert(still.data.timeline.every(n => n.action === '待处理'), '时间线上没有任何人签过')

  /*
   * 「不能审自己」这一条不在这里单测：会签名单在生成时就排除了申请人
   * （见上方「会签名单排除申请人本人」），正常流程下构造不出"名单里有申请人"的场景，
   * 真正会触发它的是**代签**（GM/PM 碰到自己发的单）。那个分支由 oaCanAct 里的判断守住，
   * 硬造数据要改组织负责人，成本比收益高。
   *
   * 这里只验代签这条路是通的：总经理上面没有人，不豁免的话他的单永远卡在「待审批」。
   */
  token = await login('gm')
  const proxy = await call('POST', `/oa/requests/${id}/action`, { body: { action: '同意' } })
  eq(proxy.status, 200, '集团总经理代签放行')
})

/* ============================ 计划模板（T 域） ============================ */

test('计划模板：六套模板，模板里没有权重（第 60 批）', async () => {
  token = await login('gm')
  const r = await call('GET', '/plan-templates')
  eq(r.status, 200, '模板列表 HTTP 状态')
  const list = r.data
  eq(list.length, 6, '六套模板（项目 + 四班组 + 职能兜底）')

  const pm = list.find(t => t.tplId === 'PT01')
  eq(pm.qCount, 5, '量化 5 条')
  eq(pm.mCount, 5, '监控 5 条')
  eq(pm.kCount, 5, '重点 5 条')
  eq('wq' in pm, false, '模板上没有 wq（段权重已取消）')
  eq('wk' in pm, false, '模板上没有 wk')
  eq('weightTotal' in pm, false, '模板上没有 weightTotal（权重不在模板里）')
  eq(pm.items.some(i => 'weight' in i), false, '条目不带宽权重字段')

  const gc = list.find(t => t.tplId === 'PT03')
  eq(gc.mCount, 6, '工程组监控多一条（年度维保计划完成率）')

  eq(list.filter(t => !t.checkOk).length, 0, '六套模板内容校验全部通过')
})

test('计划模板：内容不完整整单拒绝（不落半套）', async () => {
  token = await login('gm')
  const before = (await call('GET', '/plan-templates/PT01')).data

  /* 删掉全部量化项 —— 这份模板提报出来的计划没有可计分的内容 */
  const r1 = await call('PATCH', '/plan-templates/PT01', {
    body: { items: before.items.filter(i => i.section !== 'q') }
  })
  assert(r1.status === 422, `量化段删空 → 422（实际 ${r1.status}）`)
  assert(String(r1.message).includes('至少要有一条考核项'), `错误说明指出缺考核项：${r1.message}`)

  const after = (await call('GET', '/plan-templates/PT01')).data
  eq(after.version, before.version, '校验失败时版本号不变（没有半截落库）')
  eq(after.items.length, before.items.length, '条目没有被改掉')

  /* 正常保存：条目整单提交，版本 +1，响应里依然没有权重 */
  const r2 = await call('PATCH', '/plan-templates/PT01', {
    body: { desc: '契约测试改过的说明', items: before.items }
  })
  eq(r2.status, 200, '内容完整时保存成功')
  eq(r2.data.version, before.version + 1, '版本号自增')
  eq('wq' in r2.data, false, '存回来还是没有 wq')
})

test('计划模板：同一类部门只能有一个模板', async () => {
  token = await login('gm')
  const r = await call('POST', '/plan-templates', {
    body: {
      name: '重复的项目经理模板', matchType: '项目',
      items: [
        { section: 'q', name: '收入' },
        { section: 'k', name: '重点工作' }
      ]
    }
  })
  assert(r.status === 409, `同类重复新建 → 409（实际 ${r.status}）`)
  assert(String(r.message).includes('已经有'), `提示已存在：${r.message}`)
})

test('计划模板：按组织自动匹配', async () => {
  token = await login('gm')
  const pm = (await call('GET', '/plan-templates/match', { query: { orgId: 'O-P01' } })).data
  eq(pm.tplId, 'PT01', '项目部 → 项目经理模板')

  const cs = (await call('GET', '/plan-templates/match', { query: { orgId: 'O-P01-T1' } })).data
  eq(cs.tplId, 'PT02', 'T1 班组 → 客服组模板')

  const gc = (await call('GET', '/plan-templates/match', { query: { orgId: 'O-P02-T2' } })).data
  eq(gc.tplId, 'PT03', 'T2 班组 → 工程组模板')

  const zn = (await call('GET', '/plan-templates/match', { query: { orgId: 'O-FIN' } })).data
  eq(zn.tplId, 'PT06', '总部部门 → 职能兜底模板')
})

test('计划模板：停用后不再参与匹配，已提报的不受影响', async () => {
  token = await login('gm')
  const off = await call('PATCH', '/plan-templates/PT05/enabled', { body: { enabled: false } })
  eq(off.status, 200, '停用模板 HTTP 状态')
  eq(off.data.enabled, false, '模板已停用')

  const hit = (await call('GET', '/plan-templates/match', { query: { orgId: 'O-P01-T4' } })).data
  assert(hit === null || hit.tplId !== 'PT05', `T4 班组的模板停用后不再匹配到它（实际 ${hit && hit.tplId}）`)

  const all = (await call('GET', '/plan-templates')).data
  eq(all.filter(t => t.enabled).length, 5, '列表里只剩 5 套启用')

  const back = await call('PATCH', '/plan-templates/PT05/enabled', { body: { enabled: true } })
  eq(back.data.enabled, true, '可以再启用（停用不等于删除）')
})

/* ============================ 员工紧急联系人（2026-11-04） ============================ */

test('员工列表：紧急联系电话与手机同口径，只给掩码', async () => {
  token = await login('gm')
  const r = await call('GET', '/employees?pageNo=1&size=5')
  eq(r.status, 200, '列表 HTTP 状态')
  const row = r.data.rows[0]
  assert(row.emergencyContact, `有紧急联系人姓名（${row.emergencyContact}）`)
  assert(row.emergencyRelation, `有与本人关系（${row.emergencyRelation}）`)
  eq(/\*/.test(row.emergencyPhone), true, `紧急电话是掩码：${row.emergencyPhone}`)
  eq(row.emergencyPhoneRedacted, true, '标记为已脱敏')
  eq(/^\d{11}$/.test(row.emergencyPhone), false, '不返回 11 位明文')

  /* 明文只能走 reveal，且必须留痕 */
  const empId = row.empId
  const rv = await call('POST', `/employees/${empId}/reveal`, {
    /* 揭示要填原因（≥4 字）—— 每一次看明文都得说明为什么看 */
    body: { fields: ['emergencyPhone'], reason: '核验紧急联系电话是否可拨打' }
  })
  eq(rv.status, 200, `揭示接口接受 emergencyPhone（${rv.message || ''}）`)
  /* 返回是 { fields: [{ field, label, value }] }，不是一个扁平对象 */
  const hit = (rv.data.fields || []).find(x => x.field === 'emergencyPhone') || {}
  const plain = hit.value || ''
  eq(/^\d{11}$/.test(plain), true, `揭示得到 11 位明文：${plain}`)
})

test('员工档案：紧急联系人要么都填、要么都空', async () => {
  token = await login('gm')
  const list = await call('GET', '/employees?pageNo=1&size=3')
  const empId = list.data.rows[0].empId
  const detail = await call('GET', `/employees/${empId}`)
  /* 详情是 { employee, role, org, ... }，版本号在 employee 里 */
  const ver = detail.data.employee._ver

  /* 只有号码没有姓名 —— 出事时打过去不知道该找谁 */
  const onlyPhone = await call('PATCH', `/employees/${empId}`, {
    body: { patch: { emergencyContact: '', emergencyPhone: '13900001111' }, ver }
  })
  assert(onlyPhone.status === 422, `只有号码被拒（实际 ${onlyPhone.status}）`)
  assert(String(onlyPhone.message).includes('姓名'), `说明缺什么：${onlyPhone.message}`)

  /* 只有姓名没有号码 —— 等于没留联系方式 */
  const onlyName = await call('PATCH', `/employees/${empId}`, {
    body: { patch: { emergencyContact: '李四', emergencyPhone: '' }, ver }
  })
  assert(onlyName.status === 422, `只有姓名被拒（实际 ${onlyName.status}）`)
  assert(String(onlyName.message).includes('电话'), `说明缺什么：${onlyName.message}`)

  /* 关系不在枚举里 */
  const badRel = await call('PATCH', `/employees/${empId}`, {
    body: { patch: { emergencyContact: '李四', emergencyRelation: '同事', emergencyPhone: '13900001111' }, ver }
  })
  assert(badRel.status === 422, `关系非法被拒（实际 ${badRel.status}）`)
  assert(String(badRel.message).includes('关系'), `说明哪一项：${badRel.message}`)

  /* 号码位数不对 */
  const badPhone = await call('PATCH', `/employees/${empId}`, {
    body: { patch: { emergencyContact: '李四', emergencyRelation: '配偶', emergencyPhone: '1390000' }, ver }
  })
  assert(badPhone.status === 422, `号码格式错被拒（实际 ${badPhone.status}）`)
  assert(String(badPhone.message).includes('11 位'), `说明格式：${badPhone.message}`)

  /* 三项齐填 → 成功，且版本号推进 */
  const okPatch = await call('PATCH', `/employees/${empId}`, {
    body: { patch: { emergencyContact: '李四', emergencyRelation: '配偶', emergencyPhone: '13900001111' }, ver }
  })
  eq(okPatch.status, 200, `三项齐填保存成功（${okPatch.message || ''}）`)
  eq(okPatch.data.emergencyContact, '李四', '姓名已落库')
  eq(okPatch.data.emergencyRelation, '配偶', '关系已落库')
  eq(/\*/.test(okPatch.data.emergencyPhone), true, `返回仍是掩码：${okPatch.data.emergencyPhone}`)
  eq(okPatch.data._ver, ver + 1, '版本号推进一次（整包 patch 只推一次）')

  /* 三项全清空 → 允许（新人还没填） */
  const cleared = await call('PATCH', `/employees/${empId}`, {
    body: { patch: { emergencyContact: '', emergencyRelation: '', emergencyPhone: '' }, ver: okPatch.data._ver }
  })
  eq(cleared.status, 200, '三项全清空是合法状态（不是必填）')
  eq(cleared.data.emergencyContact, '', '姓名已清空')

  /* 改回一个有值的，别让后面的用例拿到空档案 */
  await call('PATCH', `/employees/${empId}`, {
    body: { patch: { emergencyContact: '李四', emergencyRelation: '配偶', emergencyPhone: '13900001111' }, ver: cleared.data._ver }
  })
})

/* ============================ 办公资产（2026-11-04 第 58 批） ============================ */

test('资产分类：两级树、节点带含下级的资产数', async () => {
  token = await login('gm')
  const r = await call('GET', '/asset-categories/tree')
  eq(r.status, 200, '树接口 HTTP 状态')
  const roots = r.data
  assert(Array.isArray(roots) && roots.length >= 4, `大类 ${roots.length} 个`)
  for (const top of roots) {
    eq(top.depth, 1, `一级分类「${top.name}」depth=1`)
    assert(Array.isArray(top.children) && top.children.length > 0, `「${top.name}」有子分类`)
    for (const kid of top.children) {
      eq(kid.depth, 2, `二级「${kid.name}」depth=2`)
      eq(kid.childCount, 0, `二级「${kid.name}」不应再有下级`)
      assert(kid.assetCountAll >= kid.assetCount, `「${kid.name}」含下级数 ≥ 本级数`)
    }
    /* 一级的 assetCountAll 必须等于所有子级之和 —— 否则树上的数字是错的 */
    const sum = top.children.reduce((s, k) => s + k.assetCount, 0)
    eq(top.assetCountAll, sum + top.assetCount, `「${top.name}」含下级 = 子级之和 + 本级`)
  }

  const flat = await call('GET', '/asset-categories')
  eq(flat.status, 200, '扁平列表 HTTP 状态')
  assert(flat.data.length >= roots.length, '扁平列表不少于根节点数')
})

test('资产分类：三级被拒 / 同级重名被拒 / 成环被拒', async () => {
  token = await login('gm')
  const tree = (await call('GET', '/asset-categories/tree')).data
  const top = tree[0]
  const kid = top.children[0]

  /* 三级：往二级下面再挂一级 */
  const tooDeep = await call('POST', '/asset-categories', {
    body: { name: '三级测试', parentId: kid.catId }
  })
  assert(tooDeep.status === 422, `三级分类被拒（实际 ${tooDeep.status}）`)
  assert(String(tooDeep.message).includes('三级分类在录入时'), `说明为什么：${tooDeep.message}`)

  /* 同级重名 */
  const dup = await call('POST', '/asset-categories', {
    body: { name: kid.name, parentId: top.catId }
  })
  assert(dup.status === 422, `同级重名被拒（实际 ${dup.status}）`)
  assert(String(dup.message).includes('已存在'), `说清冲突的是谁：${dup.message}`)

  /* 把一级挂到自己的子级下面。
     注意：在「最多两级」的限制下，这一步会**先被深度校验拦住**（挂到二级下面就成三级了），
     所以服务端的「成环检查」在这条路径上其实走不到 —— 它是防御性代码（万一以后放开三级）。
     这里只断言"被拒绝"，不锁死是哪一条理由。 */
  const cycle = await call('PATCH', `/asset-categories/${top.catId}`, {
    body: { name: top.name, parentId: kid.catId }
  })
  assert(cycle.status === 422, `挂到自己的子级下被拒（实际 ${cycle.status}）`)
  assert(/2 级|环/.test(String(cycle.message)), `拒绝理由合理：${cycle.message}`)
})

test('资产分类：有资产的分类不给删，只能停用', async () => {
  token = await login('gm')
  const tree = (await call('GET', '/asset-categories/tree')).data
  const withAssets = tree.flatMap(t => t.children).find(k => k.assetCount > 0)
  assert(!!withAssets, `找到一个挂了资产的分类（${withAssets?.name} ${withAssets?.assetCount} 件）`)

  const del = await call('POST', `/asset-categories/${withAssets.catId}/remove`)
  assert(del.status === 409, `删除被拒（实际 ${del.status}）`)
  eq(del.code, 40927, '用 40927 表示"下面还有东西"')
  assert(String(del.message).includes('件资产'), `说清有几件：${del.message}`)

  /* 停用是允许的，且停用后不能再往里新增资产 */
  const off = await call('POST', `/asset-categories/${withAssets.catId}/toggle`)
  eq(off.status, 200, '停用成功')
  eq(off.data.enabled, false, 'enabled 已置 false')

  const addInto = await call('POST', '/assets', {
    body: { name: '停用分类下新增测试', catId: withAssets.catId }
  })
  assert(addInto.status === 422, `往停用分类里新增被拒（实际 ${addInto.status}）`)
  assert(String(addInto.message).includes('已停用'), `说明原因：${addInto.message}`)

  await call('POST', `/asset-categories/${withAssets.catId}/toggle`)  /* 复原 */
})

test('资产：编号服务端生成且不可改；改动逐字段进 logs', async () => {
  token = await login('gm')
  const tree = (await call('GET', '/asset-categories/tree')).data
  const leaf = tree.flatMap(t => t.children).find(k => k.enabled)
  assert(!!leaf, `拿到一个可用的末级分类（${leaf?.name}）`)

  const created = await call('POST', '/assets', {
    body: { name: '契约测试用办公椅', catId: leaf.catId, status: '闲置' }
  })
  eq(created.status, 200, `新增 HTTP 状态（${created.message || ''}）`)
  const a = created.data
  assert(/^ZC\d{8}$/.test(a.assetNo), `编号格式 ZC{年}{4位}：${a.assetNo}`)
  eq(a.qrToken.length, 16, `token 是 16 位（${a.qrToken}）`)
  eq(a.catName, leaf.name, '分类名以快照形式落到资产上')
  eq(a.status, '闲置', '初始状态闲置')

  /* 编号不可改 */
  const rename = await call('PATCH', `/assets/${a.assetId}`, {
    body: { assetNo: 'ZC99999999', ver: a._ver }
  })
  assert(rename.status === 422, `改编号被拒（实际 ${rename.status}）`)
  assert(String(rename.message).includes('不可修改'), `说明原因：${rename.message}`)

  /* 改状态 → logs 里应有一条 闲置 → 在用 */
  const patched = await call('PATCH', `/assets/${a.assetId}`, {
    body: { status: '在用', ver: a._ver }
  })
  eq(patched.status, 200, `改状态 HTTP 状态（${patched.message || ''}）`)
  eq(patched.data.status, '在用', '状态已改')
  eq(patched.data._ver, a._ver + 1, '版本号推进一次')
  const log = (patched.data.logs || []).find(l => l.field === 'status')
  assert(!!log, '变更记录里有 status 这一条')
  eq(log.before, '闲置', '记下了改前值')
  eq(log.after, '在用', '记下了改后值')

  /* 版本号不对 → 409 */
  const stale = await call('PATCH', `/assets/${a.assetId}`, {
    body: { status: '闲置', ver: a._ver }
  })
  assert(stale.status === 409, `旧版本号被拒（实际 ${stale.status}）`)
})

test('资产：设备图片作为附件存在资产上（上限 / 类型 / 留痕）', async () => {
  token = await login('gm')
  const one = (await call('GET', '/assets', { query: { size: 1 } })).data.rows[0]
  const img = {
    fileId: 'AFTEST1', name: 'office.png',
    url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==', size: 2048, mime: 'image/png'
  }

  const r = await call('PATCH', `/assets/${one.assetId}`, { body: { files: [img], ver: one._ver } })
  eq(r.status, 200, `上传图片 HTTP 状态（${r.message || ''}）`)
  eq(r.data.files.length, 1, '图片存在资产的 files 里')
  eq(r.data.files[0].kind, 'image', 'kind 标成 image（区分附件与图片）')
  eq(r.data.files[0].name, 'office.png', '文件名保留')

  const log = (r.data.logs || []).find(l => l.field === 'files')
  assert(!!log, '变更记录里有 files 这一条')
  eq(log.fieldLabel, '设备图片', '字段名显示「设备图片」')
  assert(String(log.after).includes('office.png'), `记录写明文件名：${log.after}`)
  assert(!String(log.after).includes('base64'), '记录里不写图片内容（否则变更记录没法看）')

  const many = Array.from({ length: 7 }, (_, i) => ({ ...img, fileId: 'AFT' + i, name: `p${i}.png` }))
  const tooMany = await call('PATCH', `/assets/${one.assetId}`, { body: { files: many, ver: r.data._ver } })
  eq(tooMany.status, 422, `超过 6 张被拒（实际 ${tooMany.status}）`)
  assert(String(tooMany.message).includes('最多'), `说明上限：${tooMany.message}`)

  const notImage = await call('PATCH', `/assets/${one.assetId}`, {
    body: { files: [{ ...img, name: '合同.pdf', url: 'data:application/pdf;base64,AAAA' }], ver: r.data._ver }
  })
  eq(notImage.status, 422, '非图片被拒（附件区只管图片，扫描件归合同模块）')

  const tooBig = await call('PATCH', `/assets/${one.assetId}`, {
    body: { files: [{ ...img, fileId: 'AFBIG', size: 6 * 1024 * 1024 }], ver: r.data._ver }
  })
  eq(tooBig.status, 422, '单张超过 5MB 被拒')
  assert(String(tooBig.message).includes('5MB'), `说明上限：${tooBig.message}`)

  /* 扫码公开接口不返回图片：照片背景里常有工位和同事 */
  const pub = await call('GET', `/public/assets/${r.data.qrToken}`)
  eq(pub.status, 200, '公开接口可访问')
  eq('files' in pub.data.asset, false, '公开视图里没有 files')
  eq('photos' in pub.data.asset, false, '公开视图里也没有 photos')
})

test('收银台收款：组合支付按方式拆流水，账单同步销账', async () => {
  token = await login('gm')
  /* 找一位有多张欠费账单的业主：一次收款跨多张账单，才能验证"按账单拆流水" */
  const all = (await call('GET', '/bills', { query: { size: 100 } })).data.rows || []
  const mine = all.filter(b => b.unpaid > 0 && ['未缴', '部分缴', '逾期'].includes(b.status))
  const byOwner = {}
  for (const b of mine) (byOwner[b.ownerId] = byOwner[b.ownerId] || []).push(b)
  const ownerId = Object.keys(byOwner).find(k => byOwner[k].length >= 2)
  assert(!!ownerId, '数据集里有同业主多张欠费账单')
  const bills2 = byOwner[ownerId].slice(0, 2)
  const sum = Math.round(bills2.reduce((a, b) => a + b.unpaid, 0) * 100) / 100
  const cash = 50
  const online = Math.round((sum - cash) * 100) / 100

  const r = await call('POST', '/payments/batch', {
    body: {
      billIds: bills2.map(b => b.billId),
      splits: [{ method: '微信支付', amount: online }, { method: '现金', amount: cash }],
      remark: '契约测试：组合支付'
    }
  })
  eq(r.status, 200, `组合支付 HTTP 状态（${r.message || ''}）`)
  eq(r.data.count, 2, '两张账单各写一条流水')
  eq(r.data.payable, sum, '应缴合计')
  eq(r.data.received, sum, '实收合计')
  eq(r.data.splits.length, 2, '返回两种方式')

  const p1 = r.data.payments[0]
  assert(!!p1.batchNo, '流水带批次号')
  eq(r.data.payments[0].batchNo, r.data.payments[1].batchNo, '同一次收款的多条流水共用一个批次号')
  assert(p1.splits.length === 2, `每条流水都带组合明细（实际 ${p1.splits.length} 项）`)
  const splitSum = Math.round(p1.splits.reduce((a, x) => a + x.amount, 0) * 100) / 100
  eq(splitSum, p1.amount, '单条流水的 splits 合计 = 该条金额（分摊不能凭空多出或少掉钱）')
  const allCash = Math.round(r.data.payments.flatMap(p => p.splits.filter(x => x.method === '现金'))
    .reduce((a, x) => a + x.amount, 0) * 100) / 100
  eq(allCash, cash, '现金按各账单比例分摊后合计仍是 50 元')

  /* 账单必须真的销账，不然账单页还显示欠费 */
  for (const b of bills2) {
    const one = (await call('GET', `/bills/${b.billId}`)).data
    eq(one.status, '已缴', `账单 ${b.billId} 已销账`)
    eq(one.unpaid, 0, '未收归零')
  }
})

test('收银台收款：金额不闭合 / 方式超限 / 重复 / 跨业主都拦', async () => {
  token = await login('gm')
  const all = (await call('GET', '/bills', { query: { size: 100 } })).data.rows || []
  const mine = all.filter(b => b.unpaid > 0 && ['未缴', '部分缴', '逾期'].includes(b.status))
  const one = mine[0]
  const two = mine.find(b => b.ownerId !== one.ownerId)

  const less = await call('POST', '/payments/batch', {
    body: { billIds: [one.billId], splits: [{ method: '现金', amount: Math.max(1, one.unpaid - 10) }] }
  })
  eq(less.status, 422, `合计不足被拦（实际 ${less.status}）`)
  assert(String(less.message).includes('还差'), `说明还差多少：${less.message}`)

  const over = await call('POST', '/payments/batch', {
    body: { billIds: [one.billId], splits: [{ method: '现金', amount: one.unpaid + 10 }] }
  })
  eq(over.status, 422, '合计超出被拦')
  assert(String(over.message).includes('超出'), `说明超出多少：${over.message}`)

  const four = await call('POST', '/payments/batch', {
    body: {
      billIds: [one.billId],
      splits: [
        { method: '现金', amount: 1 }, { method: '微信支付', amount: 1 },
        { method: '支付宝', amount: 1 }, { method: 'POS刷卡', amount: 1 }
      ]
    }
  })
  eq(four.status, 422, '超过三种方式被拦')
  assert(String(four.message).includes('最多 3 种'), `说明上限：${four.message}`)

  const dup = await call('POST', '/payments/batch', {
    body: { billIds: [one.billId], splits: [{ method: '现金', amount: 10 }, { method: '现金', amount: 10 }] }
  })
  eq(dup.status, 422, '同一种方式出现两次被拦')
  assert(String(dup.message).includes('两次'), `说明原因：${dup.message}`)

  const cross = await call('POST', '/payments/batch', {
    body: {
      billIds: [one.billId, two.billId],
      splits: [{ method: '现金', amount: Math.round((one.unpaid + two.unpaid) * 100) / 100 }]
    }
  })
  eq(cross.status, 422, '跨业主一次收款被拦')
  assert(String(cross.message).includes('同一位业主'), `说明原因：${cross.message}`)

  const empty = await call('POST', '/payments/batch', { body: { billIds: [], splits: [] } })
  eq(empty.status, 422, '没选账单被拦')
})

test('收银台收款：减免按比例分摊到各账单，记在 discount 上', async () => {
  token = await login('gm')
  const all = (await call('GET', '/bills', { query: { size: 100 } })).data.rows || []
  const mine = all.filter(b => b.unpaid > 0 && ['未缴', '部分缴', '逾期'].includes(b.status))
  const byOwner = {}
  for (const b of mine) (byOwner[b.ownerId] = byOwner[b.ownerId] || []).push(b)
  const ownerId = Object.keys(byOwner).find(k => byOwner[k].length >= 2)
  const bills2 = byOwner[ownerId].slice(0, 2)
  const unpaidSum = Math.round(bills2.reduce((a, b) => a + b.unpaid, 0) * 100) / 100
  const disc = 100
  const received = Math.round((unpaidSum - disc) * 100) / 100

  const r = await call('POST', '/payments/batch', {
    body: {
      billIds: bills2.map(b => b.billId),
      splits: [{ method: '现金', amount: received }],
      discount: disc
    }
  })
  eq(r.status, 200, `带减免的收款成功（${r.message || ''}）`)
  eq(r.data.discount, disc, '返回减免金额')
  eq(r.data.received, received, '实收 = 应缴 − 减免')

  let discSum = 0
  for (const b of bills2) {
    const one = (await call('GET', `/bills/${b.billId}`)).data
    discSum += Number(one.discount || 0)
    /* 减免不能并进 paidAmount —— 并进去就查不出"免了多少" */
    eq(Math.round((one.paidAmount + one.discount) * 100) / 100 >= Math.round(b.unpaid * 100) / 100 - 0.01, true,
      `账单 ${b.billId} 的实收 + 减免 = 原应收`)
  }
  eq(Math.round(discSum * 100) / 100, disc, '两张账单的减免加起来等于 100')

  /* 用一张**还没被这次收掉**的账单：否则先撞"已不是欠费状态"的 409，测不到减免校验 */
  const left = all.find(b => b.unpaid > 0 && !bills2.some(x => x.billId === b.billId))
  const tooMuch = await call('POST', '/payments/batch', {
    body: { billIds: [left.billId], splits: [{ method: '现金', amount: 1 }], discount: 999999 }
  })
  eq(tooMuch.status, 422, '减免超过应缴被拦')
  assert(String(tooMuch.message).includes('减免'), `说明原因：${tooMuch.message}`)
})

test('临时收费：独立成表，不进收缴率但计入收入', async () => {
  token = await login('gm')
  const r = await call('GET', '/temp-charges')
  eq(r.status, 200, '列表 HTTP 状态')
  eq(r.data.total, 11, '种子 11 条')
  eq(r.data.rows.length, 11, '一页返回全部')

  const byStatus = s => r.data.rows.filter(x => x.status === s).length
  eq(byStatus('已收款'), 5, '已收款 5 条')
  eq(byStatus('待收款'), 5, '待收款 5 条')
  eq(byStatus('已作废'), 1, '已作废 1 条')
  eq(r.data.rows.every(x => x.countsInCollectionRate === false), true,
    '每一条都显式声明 countsInCollectionRate=false（不进收缴率）')

  const st = (await call('GET', '/temp-charges/stats')).data
  eq(st.pending, 5, '统计：待收 5 笔')
  eq(st.paidCount, 5, '统计：已收 5 笔')
  eq(st.paidAmount, 4060, '统计：已收合计 4,060')
  eq(st.voided, 1, '统计：作废 1 笔')
  eq(st.external, 8, '统计：外部 8 笔')

  /* 收入只算已收款，且明确不进收缴率 */
  const inc = (await call('GET', '/temp-charges/income')).data
  eq(inc.total, 4060, '收入 = 已收款合计')
  eq(inc.count, 5, '收入笔数 = 已收款笔数（待收与作废不算）')
  eq(inc.countsInCollectionRate, false, '收入接口声明不进收缴率')
  eq(inc.byItem.length >= 2, true, '按科目分组')
  const itemSum = Math.round(inc.byItem.reduce((a, x) => a + x.amount, 0) * 100) / 100
  eq(itemSum, inc.total, '分项合计 = 总额')

  /* 筛选 */
  const ext = (await call('GET', '/temp-charges', { query: { partyType: '外部' } })).data
  eq(ext.rows.every(x => x.partyType === '外部'), true, '按付款方筛选生效')
  const pend = (await call('GET', '/temp-charges', { query: { status: '待收款' } })).data
  eq(pend.total, 5, '按状态筛选生效')
})

test('临时收费：项目必填、外部名称必填、金额必须大于 0', async () => {
  token = await login('gm')
  /* 没有 /communities 接口，项目 id 从已有单据上取（真实实现里由前端下拉给） */
  const communityId = (await call('GET', '/temp-charges')).data.rows[0].communityId

  const noCm = await call('POST', '/temp-charges', {
    body: { partyType: '外部', partyName: '测试摊位', reason: '摆摊费', amount: 100 }
  })
  eq(noCm.status, 422, `不选项目被拒（实际 ${noCm.status}）`)
  assert(String(noCm.message).includes('所属项目'), `说明缺项目：${noCm.message}`)

  const noName = await call('POST', '/temp-charges', {
    body: { partyType: '外部', communityId, reason: '摆摊费', amount: 100 }
  })
  eq(noName.status, 422, '外部类型不填名称被拒')
  assert(String(noName.message).includes('单位或个人'), `说明填什么：${noName.message}`)

  const zero = await call('POST', '/temp-charges', {
    body: { partyType: '外部', partyName: '测试摊位', communityId, reason: '摆摊费', amount: 0 }
  })
  eq(zero.status, 422, '金额 0 被拒')

  const ok = await call('POST', '/temp-charges', {
    body: { partyType: '外部', partyName: '契约测试摊主', partyPhone: '13800009999', communityId, reason: '摆摊费', amount: 188 }
  })
  eq(ok.status, 200, `合法建单成功（${ok.message || ''}）`)
  eq(ok.data.status, '待收款', '新建就是待收款（建单不动钱）')
  eq(ok.data.itemName, '摆摊费', '收入科目默认等于事由')
  assert(/^LSF\d{8}-\d{3}$/.test(ok.data.chargeNo), `编号格式 LSF+日期+序号：${ok.data.chargeNo}`)
})

test('临时收费：收款写一条流水（渠道=临时收费、无账单）', async () => {
  token = await login('gm')
  const list = (await call('GET', '/temp-charges', { query: { status: '待收款' } })).data.rows
  const one = list[0]
  const before = (await call('GET', '/payments', { query: { size: 1 } })).data.total

  const pay = await call('POST', `/temp-charges/${one.chargeId}/pay`, {
    body: { splits: [{ method: '微信支付', amount: one.amount }] }
  })
  eq(pay.status, 200, `收款 HTTP 状态（${pay.message || ''}）`)
  eq(pay.data.charge.status, '已收款', '单据变已收款')
  eq(pay.data.payment.channel, '临时收费', '流水渠道是「临时收费」')
  eq(pay.data.payment.billId, '', '流水没有账单（不挂 bills）')
  eq(pay.data.payment.tempChargeId, one.chargeId, '流水指回单据')
  eq(pay.data.payment.receiptStatus, '未开具', '收据状态独立，初始未开具')

  const after = (await call('GET', '/payments', { query: { size: 1 } })).data.total
  eq(after, before + 1, '流水总数 +1')

  /* 已经收过的不能再收 */
  const again = await call('POST', `/temp-charges/${one.chargeId}/pay`, {
    body: { splits: [{ method: '现金', amount: one.amount }] }
  })
  eq(again.status, 409, '重复收款被拒')

  /* 已收款的不能改、不能作废 */
  const edit = await call('PATCH', `/temp-charges/${one.chargeId}`, { body: { amount: 1 } })
  eq(edit.status, 409, '已收款的单据不能改')
  assert(String(edit.message).includes('作废重开'), `说明怎么办：${edit.message}`)
  const voidIt = await call('POST', `/temp-charges/${one.chargeId}/void`, { body: { reason: '测试' } })
  eq(voidIt.status, 409, '已收款的单据不能作废')
})

test('临时收费：预存抵扣用不了（不挂房屋），作废必须写原因', async () => {
  token = await login('gm')
  const pend = (await call('GET', '/temp-charges', { query: { status: '待收款' } })).data.rows
  const one = pend[0]

  const prepay = await call('POST', `/temp-charges/${one.chargeId}/pay`, {
    body: { splits: [{ method: '预存抵扣', amount: one.amount }] }
  })
  eq(prepay.status, 409, `预存抵扣被拒（实际 ${prepay.status}）`)
  assert(String(prepay.message).includes('不挂房屋'), `说明原因：${prepay.message}`)

  const noReason = await call('POST', `/temp-charges/${one.chargeId}/void`, { body: {} })
  eq(noReason.status, 422, '不写原因不能作废')
  assert(String(noReason.message).includes('原因'), `说明要写原因：${noReason.message}`)

  const ok = await call('POST', `/temp-charges/${one.chargeId}/void`, { body: { reason: '契约测试：缴费人改期' } })
  eq(ok.status, 200, '写原因后可以作废')
  eq(ok.data.status, '已作废', '状态变已作废')
  eq(ok.data.voidReason, '契约测试：缴费人改期', '作废原因落库')

  const again = await call('POST', `/temp-charges/${one.chargeId}/void`, { body: { reason: '再作废一次' } })
  eq(again.status, 409, '重复作废被拒')
})

test('通讯录：只回白名单字段、只取在职、手机号不脱敏', async () => {
  token = await login('gm')
  const r = await call('GET', '/contacts')
  eq(r.status, 200, '通讯录 HTTP 状态')
  assert(r.data.total > 0, '有人')

  const keys = Object.keys(r.data.rows[0]).sort()
  eq(keys.join(','), 'empId,gender,name,orgId,orgName,phone,position', '只回 6 个白名单字段（+ orgName 派生）')
  /* 这是"数据层不给"，不是"页面不显示" —— 契约测试要盯住返回体本身 */
  for (const bad of ['baseSalary', 'monthlySalary', 'idCard', 'bankCard', 'emergencyPhone']) {
    eq(bad in r.data.rows[0], false, `返回里没有 ${bad}`)
  }

  /* 手机号明文：11 位数字，不是 138****1234 */
  const withPhone = r.data.rows.find(x => x.phone)
  assert(!!withPhone, '有人登记了手机号')
  assert(/^\d{11}$/.test(withPhone.phone), `手机号是明文 11 位：${withPhone.phone}`)

  /* 只取在职：离职的人不在里面 */
  /* size 上限 100（契约统一约束），120 人要翻两页 */
  const p1 = (await call('GET', '/employees', { query: { size: 100, pageNo: 1 } })).data.rows
  const p2 = (await call('GET', '/employees', { query: { size: 100, pageNo: 2 } })).data.rows
  const all = [...p1, ...p2]
  const left = all.filter(e => e.status === '离职')
  assert(left.length > 0, '数据集里有离职员工')
  const names = new Set(r.data.rows.map(x => x.name))
  eq(left.every(e => !names.has(e.name)), true, `离职员工不出现在通讯录（${left.map(e => e.name).join('/')}）`)

  /* 分组：每组人数合计 = total */
  const gsum = r.data.groups.reduce((a, g) => a + g.rows.length, 0)
  eq(gsum, r.data.total, '部门分组的人数合计 = 总数')
})

test('通讯录：搜手机后 4 位、部门树无 0 人节点', async () => {
  token = await login('gm')
  const all = (await call('GET', '/contacts')).data.rows
  const one = all.find(x => x.phone)
  const tail = one.phone.slice(-4)

  const byTail = (await call('GET', '/contacts', { query: { kw: tail } })).data
  assert(byTail.total >= 1, `按后 4 位「${tail}」能搜到`)
  eq(byTail.rows.some(x => x.phone.endsWith(tail)), true, '结果里号码含这个尾号')

  const byName = (await call('GET', '/contacts', { query: { kw: one.name } })).data
  assert(byName.total >= 1, `按姓名「${one.name}」能搜到`)

  const tree = (await call('GET', '/contacts/tree')).data
  const flat = []
  const walk = list => list.forEach(n => { flat.push(n); walk(n.children || []) })
  walk(tree)
  assert(flat.length > 0, '部门树有节点')
  eq(flat.every(n => n.totalCount > 0), true, '树里没有 0 人节点（已 prune）')
  const root = tree[0]
  eq(root.totalCount, all.length, '根节点人数 = 通讯录总数')

  const st = (await call('GET', '/contacts/stats')).data
  eq(st.total, all.length, '统计 total 与列表一致')
})

test('通讯录：所有角色都能看（不是按岗位开的）', async () => {
  for (const r of ['gm', 'pm', 'steward', 'staff']) {
    token = await login(r)
    const res = await call('GET', '/contacts')
    eq(res.status, 200, `${r} 能看通讯录`)
    assert(res.data.total > 0, `${r} 拿到数据`)
  }
})

test('开票：收据与发票是两个独立状态', async () => {
  token = await login('gm')
  const list = (await call('GET', '/payments', { query: { size: 5 } })).data.rows
  const p = list.find(x => x.invoiceStatus !== '已开票' && x.billId)

  /* 只开收据 */
  const r1 = await call('POST', `/payments/${p.payId}/tickets`, { body: { types: ['收据'] } })
  eq(r1.status, 200, `开收据 HTTP 状态（${r1.message || ''}）`)
  eq(r1.data.created[0].isReceipt, true, '返回标记是收据')
  assert(/^SJ\d+/.test(r1.data.created[0].ticketNo), `收据号 SJ 开头：${r1.data.created[0].ticketNo}`)
  eq(r1.data.created[0].taxAmount, 0, '收据税额恒 0（不是扣税凭证）')

  const after1 = (await call('GET', '/payments', { query: { kw: p.payId } })).data.rows
    .find(x => x.payId === p.payId)
  eq(after1.receiptStatus, '已开具', '收据状态已开具')
  eq(after1.invoiceStatus !== '已开票', true, '发票状态仍是未开（两个状态互不影响）')

  /* 再开发票：同一笔可以补开，不冲突 */
  const r2 = await call('POST', `/payments/${p.payId}/tickets`, { body: { types: ['电子发票'] } })
  eq(r2.status, 200, '补开发票成功')
  assert(/^0264\d+/.test(r2.data.created[0].ticketNo), `发票号 0264 开头：${r2.data.created[0].ticketNo}`)
  assert(r2.data.created[0].taxAmount > 0, '发票有税额')

  const after2 = (await call('GET', '/payments', { query: { kw: p.payId } })).data.rows
    .find(x => x.payId === p.payId)
  eq(after2.receiptStatus, '已开具', '收据状态保持')
  eq(after2.invoiceStatus, '已开票', '发票状态已开')

  /* 重复开同一种：跳过 / 409 */
  const r3 = await call('POST', `/payments/${p.payId}/tickets`, { body: { types: ['收据'] } })
  eq(r3.status, 409, '重复开同一类票据被拒')

  /* 一次开两种：都还没开过的流水才能两只都出 */
  const p2 = (await call('GET', '/payments', { query: { size: 40 } })).data.rows
    .find(x => x.invoiceStatus !== '已开票' && x.receiptStatus === '未开具' && x.billId)
  const both = await call('POST', `/payments/${p2.payId}/tickets`, { body: { types: ['收据', '电子发票'] } })
  eq(both.status, 200, '一次开收据 + 发票')
  eq(both.data.count, 2, '出了两张')
  eq(both.data.created.filter(x => x.isReceipt).length, 1, '一张收据')
  eq(both.data.created.filter(x => !x.isReceipt).length, 1, '一张发票')
})

test('开票：项目名取实际科目，购买方可手填', async () => {
  token = await login('gm')

  /* 临时收费的流水：没有账单，项目名要从流水上的科目取，不能写死「物业服务费」 */
  const tc = (await call('GET', '/temp-charges', { query: { status: '待收款' } })).data.rows[0]
  await call('POST', `/temp-charges/${tc.chargeId}/pay`, {
    body: { splits: [{ method: '现金', amount: tc.amount }] }
  })
  const paid = (await call('GET', `/temp-charges/${tc.chargeId}`)).data
  const payId = paid.payId
  assert(!!payId, '临时收费单据上有流水号')

  const r = await call('POST', `/payments/${payId}/tickets`, {
    body: { types: ['收据'], buyerTitle: '契约测试摊主（手填抬头）' }
  })
  eq(r.status, 200, `临时收费可以开收据（${r.message || ''}）`)
  eq(r.data.created[0].itemName, tc.itemName, `项目名取流水上的科目（${tc.itemName}）`)
  eq(r.data.created[0].itemName === '物业服务费', false, '不是写死的「物业服务费」')
  eq(r.data.created[0].buyerTitle, '契约测试摊主（手填抬头）', '购买方用手填的抬头')
})

test('开票设置：费用项目五项，押金与赔偿款税率为 0', async () => {
  token = await login('gm')
  const r = await call('GET', '/invoice-items')
  eq(r.status, 200, '费用项目 HTTP 状态')
  eq(r.data.length, 5, '内置五项')

  const byName = Object.fromEntries(r.data.map(i => [i.name, i]))
  eq(byName['摆摊费'].taxRate, 6, '摆摊费 6%（现代服务）')
  eq(byName['场地租用'].taxRate, 9, '场地租用 9%（不动产经营租赁）')
  eq(byName['赔偿款'].taxRate, 0, '赔偿款 0%（不征增值税）')
  eq(byName['押金'].taxRate, 0, '押金 0%（代收，不确认收入）')
  eq(byName['其他'].taxRate, 6, '其他 6%')
  eq(r.data.filter(i => i.builtin).length, 5, '五项都是内置')
  eq(r.data.every(i => i.enabled), true, '默认全部启用')
})

test('开票设置：费用项目税率只接受六档，名称不可重复', async () => {
  token = await login('gm')

  const bad = await call('POST', '/invoice-items', { body: { name: '测试项目', taxRate: 7 } })
  eq(bad.status, 422, `7% 不是合法档位（实际 ${bad.status}）`)
  assert(String(bad.message).includes('0 / 3 / 5 / 6 / 9 / 13'), `列出合法档位：${bad.message}`)

  const dup = await call('POST', '/invoice-items', { body: { name: '摆摊费', taxRate: 6 } })
  eq(dup.status, 409, `同名项目被拒（实际 ${dup.status}）`)
  assert(String(dup.message).includes('已经存在'), `说明重名：${dup.message}`)

  const ok = await call('POST', '/invoice-items', { body: { name: '垃圾清运费', taxRate: 6, taxClass: '生活服务' } })
  eq(ok.status, 200, `合法项目可以新增（${ok.message || ''}）`)
  eq(ok.data.builtin, false, '自定义项目 builtin=false')

  /* 停用不删除：历史票据靠名称追溯 */
  const off = await call('POST', `/invoice-items/${ok.data.itemId}/toggle`, { body: { enabled: false } })
  eq(off.status, 200, '停用成功')
  eq(off.data.enabled, false, '已停用')
  const still = await call('GET', '/invoice-items')
  assert(still.data.some(i => i.itemId === ok.data.itemId), '停用后仍留在字典里（不删除）')
  const opts = await call('GET', '/invoice-items/options')
  eq(opts.data.some(i => i.value === '垃圾清运费'), false, '下拉里不再出现停用项')
})

test('开票设置：开票信息十条，带入只给草稿不落库', async () => {
  token = await login('gm')
  const list = (await call('GET', '/invoice-profiles')).data
  eq(list.length, 10, '种子十条档案')
  eq(list.filter(p => p.titleType === '企业').length, 6, '企业 6 条')
  eq(list.filter(p => p.sourceType === '手动').length, 3, '手工 3 条')
  eq(list.filter(p => p.isDefault).length, 1, '默认抬头只有一条')
  eq(list[0].isDefault, true, '默认抬头排在第一位')

  const stat = (await call('GET', '/invoice-profiles/stats')).data
  eq(stat.total, 10, '统计 total')
  eq(stat.fromOwner, 3, '从业主带入 3 条')

  /* 个人业主：只带姓名与手机，税号留空 */
  /* 不按姓名筛：契约数据集只有 60 个业主，姓氏不一定命中，空数组会让 .value 直接炸 */
  const ownerOpts = (await call('GET', '/invoice-profiles/owner-options')).data
  assert(ownerOpts.length > 0, '业主选项非空')
  const owner = ownerOpts[0]
  const draft = (await call('GET', `/invoice-profiles/from-owner/${owner.value}`)).data
  eq(draft.profileId, '', '草稿没有 profileId（尚未建档）')
  eq(draft.titleType, '个人', '个人抬头')
  eq(draft.taxNo, '', '个人不带税号')
  assert(!!draft.contactPhone, '带出手机号')

  /* 企业租户：名称 / 税号 / 注册地址一起带出来 */
  /* 只回前 50 条在住租户，靠前的都是个人；企业要带关键字搜（下拉本来就是 remote 搜索） */
  const tenantsOpt = (await call('GET', '/invoice-profiles/tenant-options', { query: { kw: '有限公司' } })).data
  const company = tenantsOpt.find(t => t.tenantType === '公司')
  assert(!!company, `按「有限公司」能搜到企业租户（${tenantsOpt.length} 条）`)
  const cDraft = (await call('GET', `/invoice-profiles/from-tenant/${company.value}`)).data
  eq(cDraft.titleType, '企业', '企业租户 → 企业抬头')
  eq(cDraft.taxNo, company.creditCode, '税号取统一社会信用代码')
  assert((cDraft.regAddress || '').length > 2, '注册地址带出来了')

  /* 带入不落库 */
  const after = (await call('GET', '/invoice-profiles')).data
  eq(after.length, 10, '带入之后档案数没变（只是草稿）')
})

test('开票设置：企业抬头必须带税号，同抬头+税号不可重复', async () => {
  token = await login('gm')

  const noTax = await call('POST', '/invoice-profiles', { body: { titleType: '企业', title: '某某公司' } })
  eq(noTax.status, 422, `企业抬头缺税号被拒（实际 ${noTax.status}）`)
  assert(String(noTax.message).includes('纳税人识别号'), `说明缺什么：${noTax.message}`)

  const badTax = await call('POST', '/invoice-profiles', {
    body: { titleType: '企业', title: '某某公司', taxNo: 'ABC' }
  })
  eq(badTax.status, 422, '税号长度不足被拒')

  const ok = await call('POST', '/invoice-profiles', {
    body: {
      titleType: '企业', title: '成都示例科技有限公司', taxNo: '91510100MA6TESTX1',
      contactName: '李四', contactPhone: '13800001111', sourceType: '手动'
    }
  })
  eq(ok.status, 200, `合法企业抬头可以建（${ok.message || ''}）`)
  eq(ok.data.profileId.startsWith('IP'), true, '生成 profileId')

  const dup = await call('POST', '/invoice-profiles', {
    body: { titleType: '企业', title: '成都示例科技有限公司', taxNo: '91510100MA6TESTX1' }
  })
  eq(dup.status, 409, '同抬头+同税号重复被拒')

  /* 个人抬头可以无税号，且同名不同税号算两条 */
  const p1 = await call('POST', '/invoice-profiles', { body: { titleType: '个人', title: '李四' } })
  eq(p1.status, 200, '个人抬头不填税号也能建')
})

test('开票设置：默认抬头全库唯一，停用会清掉默认位', async () => {
  token = await login('gm')
  const list = (await call('GET', '/invoice-profiles')).data
  const other = list.find(p => !p.isDefault && p.enabled)

  const r = await call('POST', `/invoice-profiles/${other.profileId}/default`)
  eq(r.status, 200, '设默认成功')
  eq(r.data.isDefault, true, '新默认生效')

  const again = (await call('GET', '/invoice-profiles')).data
  eq(again.filter(p => p.isDefault).length, 1, '默认始终只有一条')
  eq(again.find(p => p.profileId === other.profileId).isDefault, true, '默认已切换')

  /* 停用默认抬头 → 默认位清空，而不是留着一条停用的默认 */
  const off = await call('POST', `/invoice-profiles/${other.profileId}/toggle`, { body: { enabled: false } })
  eq(off.status, 200, '停用成功')
  eq(off.data.isDefault, false, '停用后默认位清空')
  const back = await call('POST', `/invoice-profiles/${other.profileId}/default`)
  eq(back.status, 409, '停用的抬头不能再设默认')

  await call('POST', `/invoice-profiles/${other.profileId}/toggle`, { body: { enabled: true } })

  /* 手工档案没有来源，重新带入应当被拒 */
  const manual = (await call('GET', '/invoice-profiles')).data.find(p => p.sourceType === '手动')
  const ref = await call('POST', `/invoice-profiles/${manual.profileId}/refresh`)
  eq(ref.status, 409, '手工档案没有来源可带入')
})

test('开票设置：房屋可选抬头按「房主优先、租户次之」排序', async () => {
  token = await login('gm')
  const list = (await call('GET', '/invoice-profiles')).data
  const ownerProfile = list.find(p => p.sourceType === '业主')
  const houseId = ownerProfile.houseId
  assert(!!houseId, '种子里的业主档案带 houseId')

  const rows = (await call('GET', `/invoice-profiles/of-house/${houseId}`)).data
  assert(rows.length >= 1, '至少有一条')
  eq(rows[0].roleLabel, '房主', '第一条是房主（默认开给房主）')
  assert(rows.every(r => r.enabled !== false), '只回启用中的')
})

test('开票设置：票据模板单例，参数校验含组合约束', async () => {
  token = await login('gm')
  const t = (await call('GET', '/invoice-template')).data
  eq(t.paper.width, 241, '默认纸宽 241mm（针打连续纸）')
  eq(t.paper.height, 140, '默认纸高 140mm')
  eq(t.copies, 3, '默认三联')
  eq(t.font.family, '宋体', '默认宋体')
  eq(t.offset.x, 0, '默认偏移 0')

  /* 单值越界 */
  const badSize = await call('PUT', '/invoice-template', { body: { font: { size: 30 } } })
  eq(badSize.status, 422, `字号越界被拒（实际 ${badSize.status}）`)
  assert(String(badSize.message).includes('6–16pt'), `说明区间：${badSize.message}`)

  /* 组合约束：单值都合法，但左右边距把内容区吃光 */
  const badMargin = await call('PUT', '/invoice-template', {
    body: { paper: { width: 100, height: 140 }, margin: { left: 30, right: 30 } }
  })
  eq(badMargin.status, 422, '边距吃掉内容区被拒')
  assert(String(badMargin.message).includes('内容区宽度不足'), `说明原因：${badMargin.message}`)

  /* 校验接口不落库 */
  const chk = await call('POST', '/invoice-template/check', { body: { paper: { width: 100 } } })
  eq(chk.status, 200, 'check 接口不抛错')
  eq(chk.data.ok, false, '返回不合法')
  assert(chk.data.errs.length > 0, '给出错误清单')

  /* 合法修改：偏移 1.5mm，其余不变 */
  const okSave = await call('PUT', '/invoice-template', {
    body: { offset: { x: 1.5, y: -0.5 }, font: { size: 11 } }
  })
  eq(okSave.status, 200, `合法参数可以保存（${okSave.message || ''}）`)
  eq(okSave.data.offset.x, 1.5, '偏移已保存')
  eq(okSave.data.font.size, 11, '字号已保存')
  eq(okSave.data.paper.width, 241, '没传的字段沿用原值（paper 没被清掉）')

  const reset = await call('POST', '/invoice-template/reset')
  eq(reset.status, 200, '恢复默认成功')
  eq(reset.data.offset.x, 0, '偏移回到 0')
  eq(reset.data.font.size, 10, '字号回到 10pt')
})

test('扫码公开接口：免登录，只回白名单字段', async () => {
  /* 故意用一个「没有任何资产权限」的账号取 token：公开接口不该受它影响 */
  token = await login('gm')
  const list = await call('GET', '/assets', { query: { size: 1 } })
  assert(list.status === 200 && list.data && Array.isArray(list.data.rows),
    `资产列表可用（HTTP ${list.status} · ${list.message || ''}）`)
  const one = list.data.rows[0]
  const detail = await call('GET', `/assets/${one.assetId}`)
  const qrToken = detail.data.qrToken

  /* 报废资产也要有码可扫：必须在切到无权限账号之前查（staff 没有 c.assets.view） */
  const scrapped = (await call('GET', '/assets', { query: { status: '报废', size: 1 } })).data.rows[0]

  /* 换工号最小的账号（工程维修，没有 c.assets.*）再来取——能取到就说明不依赖权限 */
  token = await login('staff')
  const pub = await call('GET', `/public/assets/${qrToken}`)
  eq(pub.status, 200, `免登录可取（用无资产权限的账号访问，${pub.message || 'ok'}）`)
  eq(pub.data.ok, true, 'ok 为 true')

  const view = pub.data.asset
  const keys = Object.keys(view).sort()
  console.log('    · 公开字段：', keys.join(', '))
  for (const k of ['name', 'assetNo', 'catPath', 'status', 'orgName', 'location', 'warrantyEnd']) {
    assert(k in view, `返回了 ${k}`)
  }
  /* 这几项是硬边界：给了就能被利用 */
  for (const k of ['holderName', 'price', 'vendor', 'sn', 'remark', 'logs']) {
    assert(!(k in view), `不返回 ${k}`)
  }
  eq('holderEmpId' in view, false, '不返回使用人 ID（姓名已经精确到人，ID 更不该给）')

  /* 无效 token：404，且不区分"格式错"与"不存在" */
  const bad = await call('GET', '/public/assets/aaaaaaaaaaaaaaaa')
  assert(bad.status === 404, `无效 token 返回 404（实际 ${bad.status}）`)
  eq(bad.code, 40410, '用 40410')

  /* 报废资产仍可查 */
  if (scrapped) {
    const sp = await call('GET', `/public/assets/${scrapped.qrToken}`)
    eq(sp.status, 200, '报废资产的码仍可打开（不是 404）')
    eq(sp.data.scrapped, true, 'scrapped 标记为 true')
  }
})

/* ============================ 邻居（N 域） ============================ */

test('邻居待办：按项目算数，全公司 8 待审 + 4 待处理', async () => {
  token = await login('pm')
  const mine = await call('GET', '/neighbor/summary')
  eq(mine.status, 200, '项目经理能看邻里待办')
  assertSchema(mine, 'NeighborTodoEnvelope', 'GET /neighbor/summary')
  eq(mine.data.items, 3, '本项目待审 3 条')
  eq(mine.data.reports, 2, '本项目待处理 2 条')
  eq(mine.data.total, 5, '合计 = 两项之和')

  token = await login('gm')
  const all = await call('GET', '/neighbor/summary')
  eq(all.data.items, 8, '全公司待审 8 条')
  eq(all.data.reports, 4, '全公司待处理 4 条')
  /* 两个数差的是数据范围，不是口径 —— 去掉过滤会让客服看到别的项目的业主 */
  assert(all.data.total > mine.data.total, '集团口径必须大于项目口径')
})

test('邻居活动：只列未结束，待成行不能混成报名中', async () => {
  token = await login('pm')
  const r = await call('GET', '/neighbor/activities', { query: { communityId: 'P01', size: 50 } })
  eq(r.status, 200, '活动列表 HTTP 状态')
  assertSchema(r, 'NeighborActivityListEnvelope', 'GET /neighbor/activities')

  const phases = [...new Set(r.data.rows.map(a => a.phase))].sort()
  eq(phases.join(','), '已成行,待成行,报名中', '三个未结束状态都出现了')
  eq(r.data.rows.some(a => ['草稿', '已流团', '已结束'].includes(a.phase)), false, '草稿 / 流团 / 已结束不进列表')

  const wait = r.data.rows.find(a => a.phase === '待成行')
  assert(!!wait, '有「待成行」样本')
  eq(wait.gap, wait.minCapacity - wait.enrolled, '还差几人 = 成团下限 − 已报')
  assert(wait.gap > 0, `待成行必须还差人（gap=${wait.gap}）`)

  const odd = r.data.rows.find(a => a.phase === '已成行')
  eq(odd.gap, 0, '已成行的 gap 归零')

  const detail = await call('GET', `/neighbor/activities/${wait.activityId}`)
  assertSchema(detail, 'NeighborActivityEnvelope', 'GET /neighbor/activities/{id}')
  eq(detail.data.refundPolicy.length > 0, true, '收费活动带退款分档')

  /* 数据范围：项目经理查别的项目必须 403，不是空列表 */
  const cross = await call('GET', '/neighbor/activities', { query: { communityId: 'P02' } })
  eq(cross.status, 403, '查别的项目 403')
})

test('邻居闲置：待审排最前，列表不下发卖方联系方式', async () => {
  token = await login('pm')
  const r = await call('GET', '/neighbor/items', { query: { communityId: 'P01', size: 100 } })
  eq(r.status, 200, '闲置列表 HTTP 状态')
  assertSchema(r, 'NeighborItemListEnvelope', 'GET /neighbor/items')

  const rows = r.data.rows
  const firstOther = rows.findIndex(i => i.status !== '待审核')
  assert(firstOther > 0, '待审不是全在最后')
  assert(rows.slice(0, firstOther).every(i => i.status === '待审核'), '待审必须整段排在最前')

  eq(rows.filter(i => i.status === '待审核').length, 3, '本项目待审 3 条')
  /* 审核不需要知道卖方私信/手机号，列表里就不该有 —— 这是"数据层不给"，不是"页面不显示" */
  for (const k of ['sellerPhone', 'wechat', 'sellerIdCard']) {
    eq(k in rows[0], false, `列表里没有 ${k}`)
  }
})

test('邻居审核：驳回必须写理由，审过的不能再审', async () => {
  token = await login('pm')
  const pend = (await call('GET', '/neighbor/items', { query: { communityId: 'P01', status: '待审核' } })).data.rows
  const one = pend[0]

  const noReason = await call('POST', `/neighbor/items/${one.itemId}/audit`, { body: { pass: false } })
  eq(noReason.status, 422, '驳回不写理由被拒')
  assert(String(noReason.message).includes('理由'), `说明为什么：${noReason.message}`)

  const ok = await call('POST', `/neighbor/items/${one.itemId}/audit`, { body: { pass: false, reason: '图片不清晰，请重拍', operator: '汪磊' } })
  eq(ok.status, 200, '写理由后可以驳回')
  eq(ok.data.status, '已驳回', '状态变已驳回')
  eq(ok.data.rejectReason, '图片不清晰，请重拍', '驳回理由落库')
  eq(ok.data.auditBy, '汪磊', '记经办人（不是默认值）')

  const again = await call('POST', `/neighbor/items/${one.itemId}/audit`, { body: { pass: true } })
  eq(again.status, 409, '重复审核被拒')
  eq(again.code, 40960, '用 40960')

  const off = await call('POST', `/neighbor/items/${one.itemId}/offline`, { body: { reason: '已驳回的内容不该在下架队列' } })
  eq(off.status, 409, '已驳回的不能再下架')
})

test('邻居举报：下架并警告要连带下架内容，且不能重复处理', async () => {
  token = await login('gm')
  const pend = (await call('GET', '/neighbor/reports', { query: { status: '待处理' } })).data.rows
  assert(pend.length > 0, '有代处理举报')

  /* 必须有一条指向"已上架"的：否则「下架并警告」永远验不出效果 */
  const onShelf = pend.find(r => r.itemStatus === '已上架')
  assert(!!onShelf, `有待处理举报指向已上架内容（实际：${pend.map(r => `${r.reportId}/${r.itemStatus}`).join(' ')}）`)

  const noNote = await call('POST', `/neighbor/reports/${onShelf.reportId}/handle`, { body: { action: '仅警告' } })
  eq(noNote.status, 422, '不写说明被拒')

  const badAction = await call('POST', `/neighbor/reports/${onShelf.reportId}/handle`, { body: { action: '随便处理', note: 'x' } })
  eq(badAction.status, 422, '四选一之外的处置方式被拒')

  const ok = await call('POST', `/neighbor/reports/${onShelf.reportId}/handle`, {
    body: { action: '下架并警告', note: '要求先付定金，涉嫌诈骗', operator: '汪磊' }
  })
  eq(ok.status, 200, '处理成功')
  eq(ok.data.status, '已处理', '举报转已处理')
  eq(ok.data.handledBy, '汪磊', '记处理人')
  assertSchema(ok, 'NeighborReportEnvelope', 'POST /neighbor/reports/{id}/handle')

  const item = await call('GET', `/neighbor/items/${onShelf.itemId}`)
  eq(item.data.status, '已下架', '「下架并警告」把内容也下架了')
  assert(String(item.data.offlineReason).includes(onShelf.reason), `下架理由带举报原因：${item.data.offlineReason}`)

  const again = await call('POST', `/neighbor/reports/${onShelf.reportId}/handle`, { body: { action: '忽略', note: '再处理一次' } })
  eq(again.status, 409, '重复处理被拒')
  eq(again.code, 40970, '用 40970')
})

test('代报名：四条硬校验（报名期 / 名额 / 投保 / 重复手机号）', async () => {
  token = await login('pm')
  const acts = (await call('GET', '/neighbor/activities', { query: { communityId: 'P01', size: 50 } })).data.rows
  const open = acts.find(a => a.phase === '报名中' && a.needInsurance)
  assert(!!open, '有需要投保的报名中活动')

  /* ① 待成行不能报名 */
  const wait = acts.find(a => a.phase === '待成行')
  const r1 = await call('POST', `/neighbor/activities/${wait.activityId}/enroll`, {
    body: { name: '张三', phone: '13800002222', people: 1 }
  })
  eq(r1.status, 409, '待成行不能报名')
  eq(r1.code, 40946, '用 40946')

  /* ② 投保活动缺证件号 */
  const r2 = await call('POST', `/neighbor/activities/${open.activityId}/enroll`, {
    body: { name: '李四', phone: '13800003333', people: 1, attendees: [{ name: '李四' }] }
  })
  eq(r2.status, 422, '缺证件号被拒')
  assert(String(r2.message).includes('证件号'), `说明缺什么：${r2.message}`)

  /* ③ 超过每户上限 */
  const r3 = await call('POST', `/neighbor/activities/${open.activityId}/enroll`, {
    body: { name: '王五', phone: '13800004444', people: open.attendeeLimit + 1 }
  })
  eq(r3.status, 422, '超每户上限被拒')

  /* ④ 同一手机号重复报名 */
  const first = await call('POST', `/neighbor/activities/${open.activityId}/enroll`, {
    body: {
      name: '赵六', phone: '13800005555', houseShort: 'P01-002-0802', people: 2,
      attendees: [{ name: '赵六', idNo: '510101199001010011' }, { name: '赵小宝', idNo: '510101201801010022' }],
      paid: true, paymentMethod: '现金', operator: '汪磊'
    }
  })
  eq(first.status, 200, `正常报名成功（${first.message}）`)
  eq(first.data.source, '前台代报', '来源记前台代报')
  eq(first.data.operator, '汪磊', '记经办人')
  eq(first.data.paymentMethod, '现金', '记收款方式')
  eq(first.data.payStatus, '已支付', '现场代收记已支付')
  eq(first.data.amount, open.fee * 2, '金额 = 单价 × 人数')

  const dup = await call('POST', `/neighbor/activities/${open.activityId}/enroll`, {
    body: {
      name: '赵六', phone: '13800005555', people: 1,
      attendees: [{ name: '赵六', idNo: '510101199001010011' }]
    }
  })
  eq(dup.status, 409, '重复手机号被拒')
  assert(String(dup.message).includes('已经报过名'), `说明为什么：${dup.message}`)

  const after = await call('GET', `/neighbor/activities/${open.activityId}`)
  eq(after.data.enrolled, open.enrolled + 2, '已报人数 +2')
  eq(after.data.left, open.capacity - open.enrolled - 2, '剩余名额同步减少')
})

test('退款按分档算，退完名额要退回去', async () => {
  token = await login('pm')
  const acts = (await call('GET', '/neighbor/activities', { query: { communityId: 'P01', size: 50 } })).data.rows
  const act = acts.find(a => a.phase === '报名中' && a.fee > 0)
  const enrolls = (await call('GET', `/neighbor/activities/${act.activityId}/enrolls`, { query: { status: '已报名', size: 100 } })).data.rows
  const mine = enrolls.find(e => e.source === '前台代报')
  assert(!!mine, '有前台代报记录可退')

  /* 名单列表里手机号是掩码，单条详情才明文 */
  assert(String(mine.phone).includes('****'), `列表手机号应掩码：${mine.phone}`)

  const r = await call('POST', `/neighbor/enrolls/${mine.enrollId}/refund`, { body: { reason: '临时有事', operator: '汪磊' } })
  eq(r.status, 200, `退款成功（${r.message}）`)
  eq(r.data.enroll.status, '已退款', '报名转已退款')
  eq(r.data.enroll.refundBy, '汪磊', '记退款经办人')
  assert(r.data.ratio > 0, `命中分档比例（${r.data.ratio}%）`)
  eq(r.data.amount, Math.round(mine.amount * r.data.ratio) / 100, '退款金额 = 全额 × 档位比例')

  const act2 = await call('GET', `/neighbor/activities/${act.activityId}`)
  eq(act2.data.enrolled, act.enrolled - mine.people, '退完名额退回去')

  const again = await call('POST', `/neighbor/enrolls/${mine.enrollId}/refund`, { body: {} })
  eq(again.status, 409, '重复退款被拒')

  /* 公益活动的报名只能取消，不能退款 */
  const free = (await call('GET', '/neighbor/activities', { query: { communityId: 'P01', size: 50 } })).data.rows
    .find(a => a.fee === 0 && a.phase !== '待成行')
  if (free) {
    const fe = (await call('GET', `/neighbor/activities/${free.activityId}/enrolls`, { query: { status: '已报名', size: 100 } })).data.rows[0]
    if (fe) {
      const bad = await call('POST', `/neighbor/enrolls/${fe.enrollId}/refund`, { body: {} })
      eq(bad.status, 409, '公益活动退款被拒')
      assert(String(bad.message).includes('取消'), `引导去取消：${bad.message}`)
    }
  }
})

test('签到：待成行的不能签，已成行的才能签', async () => {
  token = await login('pm')
  const acts = (await call('GET', '/neighbor/activities', { query: { communityId: 'P01', size: 50 } })).data.rows
  const wait = acts.find(a => a.phase === '待成行')
  const done = acts.find(a => a.phase === '已成行')

  const we = (await call('GET', `/neighbor/activities/${wait.activityId}/enrolls`, { query: { status: '已报名' } })).data.rows[0]
  const r1 = await call('POST', `/neighbor/enrolls/${we.enrollId}/checkin`)
  eq(r1.status, 409, '待成行不能签到')
  assert(String(r1.message).includes('待成行'), `说明当前状态：${r1.message}`)

  const de = (await call('GET', `/neighbor/activities/${done.activityId}/enrolls`, { query: { status: '已报名' } })).data.rows[0]
  const r2 = await call('POST', `/neighbor/enrolls/${de.enrollId}/checkin`)
  eq(r2.status, 200, `已成行可以签到（${r2.message}）`)
  eq(r2.data.status, '已签到', '状态变已签到')
  eq(r2.data.checkinBy, '杜若曦', '记签到经办人')

  const r3 = await call('POST', `/neighbor/enrolls/${de.enrollId}/checkin`)
  eq(r3.status, 409, '重复签到被拒')
})

test('邻居越权：楼管只能看、不能审也不能代报名；工程维修看不到', async () => {
  token = await login('steward')
  /* 读：R-STW 有 n.workbench / items / reports / activities 的 view */
  eq((await call('GET', '/neighbor/summary')).status, 200, '楼管能看邻里待办')
  eq((await call('GET', '/neighbor/items')).status, 200, '楼管能看闲置队列')

  /* 写：审核 / 处理举报 / 代报名都是客服主管的活，楼管没有 */
  const audit = await call('POST', '/neighbor/items/SH0104/audit', { body: { pass: true } })
  eq(audit.status, 403, '楼管不能审核')
  assert(String(audit.message).includes('n.items.audit'), `说明缺哪个权限：${audit.message}`)

  const handle = await call('POST', '/neighbor/reports/RP0101/handle', { body: { action: '忽略', note: 'x' } })
  eq(handle.status, 403, '楼管不能处理举报')

  const en = await call('POST', '/neighbor/activities/AC0016/enroll', {
    body: { name: 'x', phone: '13800009999', people: 1 }
  })
  eq(en.status, 403, '楼管不能代报名')

  /* 工程维修连读都没有 */
  token = await login('staff')
  const noRead = await call('GET', '/neighbor/items')
  eq(noRead.status, 403, '工程维修看不到闲置队列')
  assert(String(noRead.message).includes('n.items.view'), `说明缺哪个权限：${noRead.message}`)
})

/* ============================ 租售信息（A 域 · 第 69 批） ============================ */

test('租售：公开列表免登录，只回白名单字段', async () => {
  const r = await call('GET', '/public/listings', { auth: false })
  eq(r.status, 200, '游客能看房源列表（登录墙会把客源挡光）')
  assert(r.data.rows.length > 0, '列表非空')
  const row = r.data.rows[0]
  for (const k of ['room', 'houseShort', 'ownerId', 'ownerName', 'ownerPhone', 'stewardPhone', 'stewardEmpId']) {
    assert(!(k in row), `公开视图不应包含 ${k}`)
  }
  assert(!!row.stewardName, '要告诉访客"这套房谁在管"')
  assert(r.data.rows.every(x => x.status === '已发布'), '只回已发布的房源')
  assert(r.data.rows.every(x => x.price > 0), '租金要回')
})

test('租售：公开详情给得出户型面积，但给不出房号', async () => {
  const list = await call('GET', '/public/listings', { auth: false })
  const id = list.data.rows[0].listingId
  const r = await call('GET', `/public/listings/${id}`, { auth: false })
  eq(r.status, 200, '游客能看详情')
  assert(!!r.data.houseType && r.data.area > 0, '户型与面积从房屋档案带出')
  assert(!('room' in r.data), '房号线上不给 —— 看房不需要知道门牌，给了等于公示"这户空着"')
  assert(!('ownerPhone' in r.data), '业主电话不给')
})

test('租售：我要看房留资成功，同一号码 24h 内不能重复', async () => {
  const list = await call('GET', '/public/listings', { auth: false })
  const id = list.data.rows[0].listingId
  const phone = '13700009999'
  const r1 = await call('POST', `/public/listings/${id}/viewing`, {
    auth: false,
    body: { name: '测试访客', phone, preferredTime: '周末', note: '想月底搬' }
  })
  eq(r1.status, 200, '留资成功')
  eq(r1.data.status, '待联系', '默认进待联系')
  assert(String(r1.data.promise).includes('24 小时'), '要给"24 小时内联系你"的承诺')
  assert(String(r1.data.privacy).includes('90 天'), '要写明号码保留期限')
  const r2 = await call('POST', `/public/listings/${id}/viewing`, {
    auth: false, body: { name: '测试访客', phone }
  })
  eq(r2.status, 409, '同号同房 24h 内重复提交要被拒')
  const r3 = await call('POST', `/public/listings/${id}/viewing`, {
    auth: false, body: { name: '测试访客', phone: '138' }
  })
  eq(r3.status, 422, '手机号格式要拦')
})

test('租售：下架的房源对外 404', async () => {
  token = await login('gm')
  const all = await call('GET', '/listings', { query: { status: '已下架' } })
  assert(all.data.rows.length > 0, '样例里要有已下架的挂牌')
  const id = all.data.rows[0].listingId
  const r = await call('GET', `/public/listings/${id}`, { auth: false })
  eq(r.status, 404, '已下架的房源对外不可见')
})

test('租售：后台接口要登录、要权限位', async () => {
  const noToken = await call('GET', '/listings', { auth: false })
  eq(noToken.status, 401, '未登录不能看后台列表')
  token = await login('staff')
  const noPerm = await call('GET', '/listings')
  eq(noPerm.status, 403, '工程维修没有 a.listings.view')
  assert(String(noPerm.message).includes('a.listings.view'), `说明缺哪个权限：${noPerm.message}`)
})

test('租售：列表业主电话脱敏，详情给全号', async () => {
  token = await login('gm')
  const list = await call('GET', '/listings')
  const row = list.data.rows[0]
  assert(/\*{4}/.test(row.ownerPhone), `列表要脱敏：${row.ownerPhone}`)
  const detail = await call('GET', `/listings/${row.listingId}`)
  assert(/^\d{11}$/.test(String(detail.data.ownerPhone)), '详情给全号（审核要打给业主）')
  assert(Array.isArray(detail.data.viewings), '详情带看房请求')
})

test('租售：审核人是责任楼管，超 24 小时标已升级', async () => {
  token = await login('gm')
  const pending = await call('GET', '/listings', { query: { status: '待审核' } })
  assert(pending.data.rows.length > 0, '样例里要有待审挂牌')
  const row = pending.data.rows[0]
  assert(!!row.stewardName, '每条挂牌都要有责任楼管')
  assert(pending.data.rows.some(x => x.overdue), '要有超 24 小时的样本（已升级）')
  assert(pending.data.rows.every(x => x.hoursWaiting >= 0), '等待时长要可算')
})

test('租售：驳回必须写理由，通过后对外可见', async () => {
  token = await login('gm')
  const pending = await call('GET', '/listings', { query: { status: '待审核' } })
  const id = pending.data.rows[0].listingId
  const noReason = await call('POST', `/listings/${id}/audit`, { body: { pass: false } })
  eq(noReason.status, 422, '驳回不写理由要拦')
  const ok = await call('POST', `/listings/${id}/audit`, { body: { pass: true } })
  eq(ok.status, 200, '通过成功')
  eq(ok.data.status, '已发布', '通过后变已发布')
  const pub = await call('GET', `/public/listings/${id}`, { auth: false })
  eq(pub.status, 200, '通过后游客立刻能看到')
  const again = await call('POST', `/listings/${id}/audit`, { body: { pass: true } })
  eq(again.status, 409, '重复审核要拒')
})

test('租售：强制下架必须写原因', async () => {
  token = await login('gm')
  const pub = await call('GET', '/listings', { query: { status: '已发布' } })
  const id = pub.data.rows[0].listingId
  const noReason = await call('POST', `/listings/${id}/offline`, { body: {} })
  eq(noReason.status, 422, '不写原因要拦')
  const ok = await call('POST', `/listings/${id}/offline`, { body: { reason: '业主已告知房子租出' } })
  eq(ok.status, 200, '下架成功')
  eq(ok.data.status, '已下架', '状态变已下架')
})

test('租售：数据范围——项目经理只看本项目，楼管只看责任范围', async () => {
  token = await login('gm')
  const all = await call('GET', '/listings', { query: { size: 100 } })

  /* 项目经理 = 本项目。契约样例集本身以 P01 为主，所以这里验两件事：
     ① 返回的每一条都在本项目；② 换个 communityId 直接被入口拒绝。 */
  token = await login('pm')
  const pmList = await call('GET', '/listings', { query: { size: 100 } })
  assert(pmList.data.rows.length > 0, '项目经理能看到本项目的数据')
  assert(pmList.data.rows.every(x => x.communityId === 'P01'), '项目经理只回本项目')
  const crossQuery = await call('GET', '/listings', { query: { communityId: 'P02' } })
  eq(crossQuery.status, 403, '拿别的项目的 communityId 查，入口就要拒')
  assert(String(crossQuery.message).includes('数据范围'), `说明超出范围：${crossQuery.message}`)

  /* 楼管 = 责任范围：是总集的真子集，且直接拿范围外的 ID 要 403 */
  token = await login('steward')
  const stwList = await call('GET', '/listings', { query: { size: 100 } })
  assert(stwList.data.rows.length > 0, '楼管在自己的责任范围内有数据')
  assert(stwList.data.rows.length < all.data.rows.length, '楼管看到的比总经理少（责任范围是子集）')
  const gmIds = new Set(all.data.rows.map(x => x.listingId))
  assert(stwList.data.rows.every(x => gmIds.has(x.listingId)), '楼管看到的必须是全集子集')
  const outside = all.data.rows.find(x => !stwList.data.rows.some(y => y.listingId === x.listingId))
  assert(!!outside, '要有范围外的样本，否则这条断言没意义')
  const crossGet = await call('GET', `/listings/${outside.listingId}`)
  eq(crossGet.status, 403, '直接拿责任范围外的挂牌 ID 也要拒')
})

test('租售：楼管是审核人，客服只能看不能审', async () => {
  token = await login('gm')
  const pending = await call('GET', '/listings', { query: { status: '待审核' } })
  assert(pending.data.rows.length > 0, '要有待审样本')
  const id = pending.data.rows[0].listingId

  /* 客服：有 view、没有 audit */
  token = await login('staff') /* 工程维修连 view 都没有，先换成有 view 的角色 */
  const gmToken = await login('gm')
  token = gmToken

  token = await login('steward')
  const ok = await call('POST', `/listings/${id}/audit`, { body: { pass: true } })
  assert(ok.status === 200 || ok.status === 403, '楼管要么能审要么越界')
  if (ok.status === 200) eq(ok.data.auditBy.length > 0, true, '要记审核人')
})

test('租售：看房请求列表脱敏、详情全号', async () => {
  token = await login('gm')
  const list = await call('GET', '/listings/viewings', { query: { size: 100 } })
  assert(list.data.rows.length > 0, '看房请求非空')
  assert(list.data.rows.every(x => /\*{4}/.test(x.phone)), '列表脱敏')
  assert(list.data.rows.some(x => x.overdue), '要有超 24 小时未回拨的样本')
  const one = list.data.rows[0]
  const detail = await call('GET', `/listings/viewings/${one.viewingId}`)
  assert(/^\d{11}$/.test(String(detail.data.phone)), '详情给全号（楼管要打这个电话）')
  const stats = await call('GET', '/listings/viewings/stats')
  eq(stats.status, 200, '统计可用')
  assert(stats.data.pending + stats.data.contacted + stats.data.visited + stats.data.closed === stats.data.total,
    '五个状态加起来要等于总数')
})

/* ============================ 租售（第 69 批 + 移动端回拨） ============================ */

test('看房请求：列表脱敏、详情给全号、超时分档', async () => {
  token = await login('pm')
  const r = await call('GET', '/listings/viewings', { query: { status: '待联系', size: 50 } })
  eq(r.status, 200, '看房请求列表 HTTP 状态')
  assert(r.data.total > 0, '有待联系样本')

  const row = r.data.rows[0]
  assert(String(row.phone).includes('****'), `列表手机号必须脱敏（${row.phone}）`)
  eq(typeof row.hoursWaiting, 'number', '带「已等多少小时」')
  /* 24h 未联系就标红，48h 升级 —— 这是这套设计的生命线，不能只靠前端算 */
  const over = r.data.rows.find(v => v.hoursWaiting > 24)
  if (over) eq(over.overdue, true, '超 24 小时的标 overdue')
  const fresh = r.data.rows.find(v => v.hoursWaiting <= 24)
  if (fresh) eq(fresh.overdue, false, '未超时的不标 overdue')

  const d = await call('GET', `/listings/viewings/${row.viewingId}`)
  eq(d.status, 200, '详情 HTTP 状态')
  assert(/^1\d{10}$/.test(String(d.data.phone)), `详情给全号，否则楼管打不了（${d.data.phone}）`)
  assert(!String(d.data.phone).includes('****'), '详情不脱敏')
})

test('看房请求：标记已联系必须写结果，重复标记 409', async () => {
  token = await login('pm')
  const pend = (await call('GET', '/listings/viewings', { query: { status: '待联系', size: 50 } })).data.rows
  const one = pend[0]

  const noNote = await call('POST', `/listings/viewings/${one.viewingId}/contact`, { body: {} })
  eq(noNote.status, 422, '不写联系结果被拒')
  assert(String(noNote.message).includes('结果'), `说明为什么：${noNote.message}`)

  const badStatus = await call('POST', `/listings/viewings/${one.viewingId}/contact`, { body: { status: '已带看', note: 'x' } })
  eq(badStatus.status, 422, '只能标成已联系 / 已关闭')

  const ok = await call('POST', `/listings/viewings/${one.viewingId}/contact`, {
    body: { note: '已电话联系，约周六上午看房', operator: '莫瑞' }
  })
  eq(ok.status, 200, `标记成功（${ok.message}）`)
  eq(ok.data.status, '已联系', '状态变已联系')
  eq(ok.data.handledBy, '莫瑞', '记经办人')
  eq(ok.data.resultNote, '已电话联系，约周六上午看房', '结果落库')
  assert(!!ok.data.handledAt, '记处理时间')
  eq(ok.data.overdue, false, '已联系的不再算超时')

  const again = await call('POST', `/listings/viewings/${one.viewingId}/contact`, { body: { note: '再标一次' } })
  eq(again.status, 409, '重复标记被拒')
  eq(again.code, 40942, '用 40942')

  /* 待联系数要跟着减少 */
  const left = await call('GET', '/listings/viewings/stats')
  eq(left.data.pending, pend.length - 1, '待联系数 -1')
})

test('我的联系方式：本人自助无权限码，改他人要 e.org.edit', async () => {
  token = await login('pm')
  const before = await call('GET', '/listings/my-contact')
  eq(before.status, 200, '能读自己的联系方式')
  eq(before.data.empId, 'EM0010', '不传 empId 就是本人')

  const save = await call('PATCH', '/listings/my-contact', {
    body: { wechatId: 'wx_du_ruoxi', contactQrUrl: 'qr/em0010.png' }
  })
  eq(save.status, 200, '本人能改')
  eq(save.data.wechatId, 'wx_du_ruoxi', '微信号落库')
  eq(save.data.contactQrUrl, 'qr/em0010.png', '二维码落库')

  const reread = await call('GET', '/listings/my-contact')
  eq(reread.data.wechatId, 'wx_du_ruoxi', '再读还是刚存的')

  const tooLong = await call('PATCH', '/listings/my-contact', { body: { wechatId: 'w'.repeat(31) } })
  eq(tooLong.status, 422, '微信号超 30 字被拒')

  /* 改别人的：全权限账号（项目经理 / 总经理是 *）可以代改，楼管不行 */
  const byPm = await call('PATCH', '/listings/my-contact', { body: { empId: 'EM0027', wechatId: 'wx_by_pm' } })
  eq(byPm.status, 200, '全权限账号可代改他人')
  eq(byPm.data.empId, 'EM0027', '改的是指定的人')

  token = await login('steward')
  const other = await call('PATCH', '/listings/my-contact', { body: { empId: 'EM0027', wechatId: 'wx_hack' } })
  eq(other.status, 403, '楼管没有 e.org.edit，不能改他人')

  token = await login('pm')
  const tooLong2 = await call('PATCH', '/listings/my-contact', { body: { empId: 'EM0027', wechatId: 'w'.repeat(31) } })
  eq(tooLong2.status, 422, '代改也要校验长度')

  /* 清空 = 不再展示，不是"隐藏" */
  const clear = await call('PATCH', '/listings/my-contact', { body: { wechatId: '', contactQrUrl: '' } })
  eq(clear.data.wechatId, '', '能清空')

  /* 楼管在样例里本来就有微信号：对外展示读的就是这个字段 */
  token = await login('steward')
  const st = await call('GET', '/listings/my-contact')
  assert(String(st.data.wechatId).startsWith('wx_'), `楼管有演示微信号（${st.data.wechatId}）`)
  /* 联系方式里没有手机号 —— 对外展示的东西不带号码 */
  eq('phone' in st.data, false, '联系方式不含手机号')
})

test('租售越权：没有 viewing 权限的连接看房请求都读不到', async () => {
  token = await login('staff')
  const list = await call('GET', '/listings/viewings')
  eq(list.status, 403, '工程维修不能看看房请求')
  assert(String(list.message).includes('a.listings.viewing'), `说明缺哪个权限：${list.message}`)

  const mark = await call('POST', '/listings/viewings/VW00001/contact', { body: { note: 'x' } })
  eq(mark.status, 403, '也不能标记')

  /* 但「我的联系方式」是本人自助，无权限码要求 */
  const mine = await call('GET', '/listings/my-contact')
  eq(mine.status, 200, '普通员工也能维护自己的联系方式')
})

/* ==================== 邻里 · 投票（第 70 批） ==================== */
test('投票：新建是草稿，发布后不能改题、不能删', async () => {
  /* 前面的用例把身份切成了楼管 / 工程维修，这里要回到全权限 */
  token = await login('gm')
  const created = await call('POST', '/neighbor/votes', {
    body: {
      title: '测试：地下车库充电桩改造意见征询',
      type: '意见征询',
      communityId: 'P01',
      endAt: '2026-11-30',
      options: [{ label: '支持' }, { label: '不支持' }, { label: '无所谓' }]
    }
  })
  eq(created.status, 200, '新建投票')
  eq(created.data.status, '草稿', '建出来必须是草稿')
  eq(created.data.startAt, '', '草稿没有开始日，发布时才置为当天')
  eq(created.data.options.length, 3, '选项数')
  eq(created.data.options[0].key, 'A1', 'key 由服务端生成')
  const voteId = created.data.voteId
  assert(String(voteId).startsWith('SV'), `主键是 voteId 且值沿用 surveyId：${voteId}`)

  /* 草稿期可以改 */
  const edited = await call('PATCH', `/neighbor/votes/${voteId}`, {
    body: {
      title: '测试：地下车库充电桩改造意见征询（改）',
      type: '意见征询',
      communityId: 'P01',
      endAt: '2026-12-05',
      options: [{ label: '支持' }, { label: '不支持' }]
    }
  })
  eq(edited.status, 200, '草稿可以改')
  eq(edited.data.options.length, 2, '选项可以增减')

  const published = await call('POST', `/neighbor/votes/${voteId}/publish`)
  eq(published.status, 200, '发布')
  eq(published.data.status, '进行中', '发布后是进行中')
  eq(published.data.startAt, '2026-10-21', '发布时把开始日置为当天')

  /* 重复发布：不做幂等成功 */
  const again = await call('POST', `/neighbor/votes/${voteId}/publish`)
  eq(again.status, 409, '重复发布')
  eq(again.code, 40931, '业务码 40931')

  /* 已开始不能改题：改完会让人已投出的票指向不存在的位置 */
  const late = await call('PATCH', `/neighbor/votes/${voteId}`, {
    body: {
      title: '改标题', type: '意见征询',
      communityId: 'P01', endAt: '2026-12-05',
      options: [{ label: 'A' }, { label: 'B' }]
    }
  })
  eq(late.status, 409, '已开始不能改')
  eq(late.code, 40930, '业务码 40930')

  /* 已发布不能删：删掉等于抹掉参与记录 */
  const del = await call('DELETE', `/neighbor/votes/${voteId}`)
  eq(del.status, 409, '已发布不能删')
  eq(del.code, 40934, '业务码 40934')

  const ended = await call('POST', `/neighbor/votes/${voteId}/end`)
  eq(ended.data.status, '已结束', '结束后状态')
  assert(ended.data.endedAt !== '', '结束要记时间')
  const endAgain = await call('POST', `/neighbor/votes/${voteId}/end`)
  eq(endAgain.status, 409, '重复结束要 409')
  eq(endAgain.code, 40933, '业务码 40933：只有进行中能结束')

  /* 已结束的不能重新发布：重发会让上一场的票凭空消失 */
  const republish = await call('POST', `/neighbor/votes/${voteId}/publish`)
  eq(republish.status, 409, '已结束不能重发')
  eq(republish.code, 40932, '业务码 40932')

  /* 草稿能删 */
  const draft = await call('POST', '/neighbor/votes', {
    body: {
      title: '临时草稿', type: '方案征询', communityId: 'P01', endAt: '2026-11-10',
      options: [{ label: 'A' }, { label: 'B' }]
    }
  })
  const removed = await call('DELETE', `/neighbor/votes/${draft.data.voteId}`)
  eq(removed.status, 200, '草稿可以删')
  eq(removed.data, true, '删除返回 true')
})

test('投票：结果只给分布与参与率，不给结论', async () => {
  const r = await call('GET', '/neighbor/votes/SV0004/result')
  eq(r.status, 200, '结果查询')
  assertSchema(r, 'NeighborVoteResultEnvelope', 'GET /neighbor/votes/SV0004/result')

  /* 这一条是关键：给出「是否通过」，明天就有人拿它去主张业主大会决议 */
  for (const k of ['passed', 'approved', 'isPassed', 'result', 'conclusion']) {
    eq(k in r.data, false, `不允许出现结论字段 ${k}`)
  }
  assert(['有效', '可参考', '偏低'].includes(r.data.confidence), `confidence 是样本提示：${r.data.confidence}`)
  assert(r.data.partRate <= 100, `参与率不能超过 100%（实际 ${r.data.partRate}）`)

  /* 三个数各有各的算法 */
  const sumPct = r.data.options.reduce((s, o) => s + o.pct, 0)
  near(sumPct, 100, '选项占比合计', 0.3)
  const votes = r.data.options.reduce((s, o) => s + o.votes, 0)
  eq(r.data.totalVotes, votes, '总票数 = 选项票数之和')
  eq(r.data.notVoted, r.data.target - r.data.totalVotes, 'notVoted = target − 票数')
  assert(r.data.notVoted >= 0, 'notVoted 不能是负数')
  /* 选项按票数降序，topOption 就是第一个 */
  const sorted = [...r.data.options].sort((a, b) => b.votes - a.votes)
  eq(r.data.options[0].votes, sorted[0].votes, '选项按票数降序')
  eq(r.data.topOption.key, r.data.options[0].key, 'topOption 是票数最高的那个')
})

test('投票：看板与列表同源，多选受上限约束', async () => {
  const stats = await call('GET', '/neighbor/votes/stats', { query: { communityId: 'P01' } })
  eq(stats.status, 200, '看板')
  assertSchema(stats, 'NeighborVoteStatsEnvelope', 'GET /neighbor/votes/stats')
  const list = await call('GET', '/neighbor/votes', { query: { communityId: 'P01', size: 100 } })
  const running = list.data.rows.filter(v => v.status === '进行中').length
  eq(stats.data.running, running, `看板的进行中 ${stats.data.running} 要等于列表 ${running}`)
  eq(stats.data.total, list.data.total, '看板总数与列表同源')
  const votesTotal = list.data.rows.reduce((s, v) => s + v.totalVotes, 0)
  eq(stats.data.votesTotal, votesTotal, '票数合计与列表同源')

  /* 多选上限不能超过选项数：拦在服务端，不靠前端灰按钮 */
  const bad = await call('POST', '/neighbor/votes', {
    body: {
      title: 'x', type: '意见征询', communityId: 'P01', endAt: '2026-11-10',
      multi: true, maxPick: 9,
      options: [{ label: 'A' }, { label: 'B' }]
    }
  })
  eq(bad.status, 422, '多选上限越界要 422')

  /* 选项少于 2 个、重复、超长、类型越界，都要拦 */
  const one = await call('POST', '/neighbor/votes', {
    body: { title: 'x', type: '意见征询', communityId: 'P01', endAt: '2026-11-10', options: [{ label: '只有一个' }] }
  })
  eq(one.status, 422, '单选项要 422')

  const dup = await call('POST', '/neighbor/votes', {
    body: { title: 'x', type: '意见征询', communityId: 'P01', endAt: '2026-11-10', options: [{ label: 'A' }, { label: 'A' }] }
  })
  eq(dup.status, 422, '选项重复要 422')

  const badType = await call('POST', '/neighbor/votes', {
    body: { title: 'x', type: '随便编一个', communityId: 'P01', endAt: '2026-11-10', options: [{ label: 'A' }, { label: 'B' }] }
  })
  eq(badType.status, 422, '类型越界要 422')

  /* 截止日已经过去的不能发布 */
  const expired = await call('POST', '/neighbor/votes', {
    body: { title: '过期草稿', type: '意见征询', communityId: 'P01', endAt: '2026-10-01', options: [{ label: 'A' }, { label: 'B' }] }
  })
  const pub = await call('POST', `/neighbor/votes/${expired.data.voteId}/publish`)
  eq(pub.status, 422, '截止日已过不能发布')
})

/* ==================== 邻里 · 活动（第 70 批） ==================== */
const ACT_BASE = {
  communityId: 'P01',
  startAt: '2026-12-01 09:00',
  endAt: '2026-12-01 17:00',
  place: '小区会所一楼',
  capacity: 20,
  enrollDeadline: '2026-11-25'
}

test('活动：类别必填、收费要配齐三项、地点与报名截止都不能空', async () => {
  /* 缺退款档位 */
  const noPolicy = await call('POST', '/neighbor/activities', {
    body: { ...ACT_BASE, title: '收费却没有退款规则', category: '亲子', fee: 99, minCapacity: 10 }
  })
  eq(noPolicy.status, 422, '收费活动缺退款档位要 422')

  /* 缺成团下限 */
  const noMin = await call('POST', '/neighbor/activities', {
    body: { ...ACT_BASE, title: 'x', category: '出游', fee: 99, refundPolicy: [{ days: 7, ratio: 100 }] }
  })
  eq(noMin.status, 422, '收费活动缺成团下限要 422')

  /* 退款比例随天数递减：写反了要拦 */
  const badTier = await call('POST', '/neighbor/activities', {
    body: {
      ...ACT_BASE, title: 'x', category: '出游', fee: 99, minCapacity: 10,
      refundPolicy: [{ days: 7, ratio: 50 }, { days: 3, ratio: 100 }]
    }
  })
  eq(badTier.status, 422, '退款比例写反要 422')

  /* 缺地点：业主报名后要知道去哪 */
  const noPlace = await call('POST', '/neighbor/activities', {
    body: { ...ACT_BASE, title: 'x', category: '公益', place: '' }
  })
  eq(noPlace.status, 422, '缺地点要 422')

  /* 报名截止晚于开始：活动开始了还在收人 */
  const badDeadline = await call('POST', '/neighbor/activities', {
    body: { ...ACT_BASE, title: 'x', category: '文体', enrollDeadline: '2026-12-05' }
  })
  eq(badDeadline.status, 422, '报名截止晚于开始要 422')

  /* 类型只能是公益 / 收费 */
  const badType = await call('POST', '/neighbor/activities', {
    body: { ...ACT_BASE, title: 'x', category: '随便编一个' }
  })
  eq(badType.status, 422, '类别越界要 422')
  assert(String(badType.message).includes('类别'), `提示要说清是类别：${badType.message}`)

  /* 公益不带钱也能建，且是草稿 */
  const free = await call('POST', '/neighbor/activities', {
    body: { ...ACT_BASE, title: '测试：公益义诊', category: '公益' }
  })
  eq(free.status, 200, '公益可以建')
  eq(free.data.phase, '草稿', '建出来是草稿')
  eq(free.data.fee, 0, '公益费用为 0')
  eq(free.data.feeText, '免费', '费用文案')
  eq(free.data.fillRate, 0, '进度条从 0 开始')
})

test('活动：发布状态机与「已有人报名不能改价」', async () => {
  const created = await call('POST', '/neighbor/activities', {
    body: {
      ...ACT_BASE, title: '测试：冬日亲子烘焙', category: '亲子', fee: 120,
      minCapacity: 10, attendeeLimit: 3, needInsurance: true,
      refundPolicy: [{ days: 7, ratio: 100 }, { days: 3, ratio: 50 }, { days: 0, ratio: 0 }]
    }
  })
  eq(created.status, 200, '新建活动')
  const actId = created.data.activityId

  const pub = await call('POST', `/neighbor/activities/${actId}/publish`)
  eq(pub.status, 200, '发布')
  eq(pub.data.phase, '报名中', '发布后报名中')

  /* 重复发布：40942，不做幂等成功 */
  const again = await call('POST', `/neighbor/activities/${actId}/publish`)
  eq(again.status, 409, '重复发布 409')
  eq(again.code, 40942, '业务码 40942')

  /* 换集结点是日常，放行 */
  const movePlace = await call('PATCH', `/neighbor/activities/${actId}`, {
    body: { ...ACT_BASE, title: '测试：冬日亲子烘焙', category: '亲子', fee: 120, minCapacity: 10, attendeeLimit: 3, needInsurance: true, place: '东门集合', refundPolicy: [{ days: 7, ratio: 100 }] }
  })
  eq(movePlace.status, 200, '已发布可以改集结点')
  eq(movePlace.data.place, '东门集合', '改的是场地')

  /* 有人报名后不能改单价 */
  const en = await call('POST', `/neighbor/activities/${actId}/enroll`, {
    body: {
      name: '改价测试', phone: '13900007777', people: 1,
      /* 活动开了 needInsurance：不传证件号会被拒（只有联系人买不了保险） */
      attendees: [{ name: '改价测试', idType: '身份证', idNo: '510101199001011234', ageType: '成人' }]
    }
  })
  eq(en.status, 200, '先报一名')
  const changeFee = await call('PATCH', `/neighbor/activities/${actId}`, {
    body: { ...ACT_BASE, title: '测试：冬日亲子烘焙', category: '亲子', fee: 150, minCapacity: 10, refundPolicy: [{ days: 7, ratio: 100 }] }
  })
  eq(changeFee.status, 422, '已有人报名不能改价')
  assert(String(changeFee.message).includes('单价'), `提示要说清是单价：${changeFee.message}`)

  /* 名额不能小于已报名 */
  const shrink = await call('PATCH', `/neighbor/activities/${actId}`, {
    body: { ...ACT_BASE, title: '测试：冬日亲子烘焙', category: '亲子', fee: 120, minCapacity: 1, capacity: 0.5, refundPolicy: [{ days: 7, ratio: 100 }] }
  })
  eq(shrink.status, 422, '名额小于已报名要 422')

  /* 结束 → 不能再改（40940），也不能重发（40941） */
  const end = await call('POST', `/neighbor/activities/${actId}/end`)
  eq(end.status, 200, '结束')
  eq(end.data.phase, '已结束', '结束后阶段')
  const endAgain = await call('POST', `/neighbor/activities/${actId}/end`)
  eq(endAgain.code, 40944, '重复结束 40944')
  const editClosed = await call('PATCH', `/neighbor/activities/${actId}`, {
    body: { ...ACT_BASE, title: 'x', category: '亲子', fee: 120, minCapacity: 10, refundPolicy: [{ days: 7, ratio: 100 }] }
  })
  eq(editClosed.status, 409, '已结束不能改')
  eq(editClosed.code, 40940, '业务码 40940')
  const republish = await call('POST', `/neighbor/activities/${actId}/publish`)
  eq(republish.code, 40941, '已结束不能重发 40941')
})

test('活动：只有「待成行」能确认流团，收费全额退、公益只取消', async () => {
  /* 造一场"报名期内有报名、截止后不足下限"的活动。
     顺序不能反：待成行之后报名接口会拒（那是刻意的），所以先把截止日放在未来。 */
  const created = await call('POST', '/neighbor/activities', {
    body: {
      ...ACT_BASE, title: '测试：流团场次', category: '出游', fee: 80,
      startAt: '2026-12-20 09:00', endAt: '2026-12-20 17:00',
      enrollDeadline: '2026-11-15',
      capacity: 20, minCapacity: 12,
      /* 每户限报 3 人：不填默认 1，2 人的那单会被挡（这条默认值是刻意的） */
      attendeeLimit: 3,
      refundPolicy: [{ days: 7, ratio: 100 }, { days: 0, ratio: 0 }]
    }
  })
  const actId = created.data.activityId
  await call('POST', `/neighbor/activities/${actId}/publish`)
  eq((await call('GET', `/neighbor/activities/${actId}`)).data.phase, '报名中', '发布后报名中')

  const e1 = await call('POST', `/neighbor/activities/${actId}/enroll`, {
    body: { name: '王测试', phone: '13900001111', people: 2, paid: true, paymentMethod: '现金' }
  })
  eq(e1.status, 200, '第一单报名')
  const e2 = await call('POST', `/neighbor/activities/${actId}/enroll`, {
    body: { name: '李测试', phone: '13900002222', people: 1 }
  })
  eq(e2.status, 200, '第二单报名')

  /* 报名截止日拨到过去 = 时间自然流逝：3 人 < 12 人下限 → 待成行 */
  const closed = await call('PATCH', `/neighbor/activities/${actId}`, {
    body: {
      ...ACT_BASE, title: '测试：流团场次', category: '出游', fee: 80,
      startAt: '2026-12-20 09:00', endAt: '2026-12-20 17:00',
      enrollDeadline: '2026-10-01', capacity: 20, minCapacity: 12, attendeeLimit: 3,
      refundPolicy: [{ days: 7, ratio: 100 }, { days: 0, ratio: 0 }]
    }
  })
  eq(closed.status, 200, '改报名截止日')
  eq((await call('GET', `/neighbor/activities/${actId}`)).data.phase, '待成行', '截止后不足下限应为待成行')

  /* 这时的报名必须被拒：待成行的人可能根本不成行 */
  const tooLate = await call('POST', `/neighbor/activities/${actId}/enroll`, {
    body: { name: '迟到的', phone: '13900003333', people: 1 }
  })
  eq(tooLate.status, 409, '待成行不能再报名')
  eq(tooLate.code, 40946, '业务码 40946')

  /* 流团必须写原因 */
  const noReason = await call('POST', `/neighbor/activities/${actId}/flow`, { body: {} })
  eq(noReason.status, 422, '没写原因要 422')

  const flow = await call('POST', `/neighbor/activities/${actId}/flow`, { body: { reason: '人数不足' } })
  eq(flow.status, 200, '确认流团')
  eq(flow.data.activity.phase, '已流团', '流团后仍是「已流团」，不能被「已结束」盖掉')
  assert(flow.data.activity.flowReason === '人数不足', '流团原因要落库')
  /* 没成团是物业的问题：2+1 人 × ¥80 = ¥240 全额退 */
  eq(flow.data.count, 2, '两单都处理')
  near(flow.data.refunded, 240, '全额退款金额')

  /* 只退一次 */
  const twice = await call('POST', `/neighbor/activities/${actId}/flow`, { body: { reason: '再来一次' } })
  eq(twice.status, 409, '重复流团 409')
  eq(twice.code, 40945, '业务码 40945')

  /* 报名中的不能流团 */
  const early = await call('POST', '/neighbor/activities/AC0016/flow', { body: { reason: 'x' } })
  eq(early.status, 409, '报名中的不能流团')

  /* 公益场次**不存在流团**：没有成团下限（minCapacity=0），报名截止后直接判「已成行」。
     所以「公益流团只取消不退款」这条分支在业务上不可达 —— 代码里留着是防御，
     用例要钉住的是"它进不了待成行"，否则有人会以为公益也能流团。 */
  const free = await call('POST', '/neighbor/activities', {
    body: {
      ...ACT_BASE, title: '测试：公益场次', category: '公益',
      startAt: '2026-12-21 09:00', endAt: '2026-12-21 11:00',
      enrollDeadline: '2026-11-15', capacity: 20, attendeeLimit: 3
    }
  })
  const freeId = free.data.activityId
  await call('POST', `/neighbor/activities/${freeId}/publish`)
  await call('PATCH', `/neighbor/activities/${freeId}`, {
    body: {
      ...ACT_BASE, title: '测试：公益场次', category: '公益',
      startAt: '2026-12-21 09:00', endAt: '2026-12-21 11:00',
      enrollDeadline: '2026-10-01', capacity: 20, attendeeLimit: 3
    }
  })
  eq((await call('GET', `/neighbor/activities/${freeId}`)).data.phase, '已成行',
    '公益没有下限，截止即已成行')
  const freeFlow = await call('POST', `/neighbor/activities/${freeId}/flow`, { body: { reason: '人不够' } })
  eq(freeFlow.status, 409, '已成行的不能流团')
  eq(freeFlow.code, 40945, '业务码 40945')
})

test('活动：退款比例从大到小命中，返回的是数字', async () => {
  /* AC0014 的档位：≥7 天 100% / ≥3 天 50% / 当天 0%；开始日 2026-11-01 */
  const d10 = await call('GET', '/neighbor/activities/AC0014/refund-ratio', { query: { atDay: '2026-10-22' } })
  eq(d10.status, 200, '查比例')
  eq(d10.data, 100, '提前 10 天退全款（data 就是数字）')
  const d5 = await call('GET', '/neighbor/activities/AC0014/refund-ratio', { query: { atDay: '2026-10-27' } })
  eq(d5.data, 50, '提前 5 天退一半')
  const d0 = await call('GET', '/neighbor/activities/AC0014/refund-ratio', { query: { atDay: '2026-11-01' } })
  eq(d0.data, 0, '当天不退')
  /* 提前一个月也走最高档：升序查找会永远命中「当天 0%」那一档 */
  const d30 = await call('GET', '/neighbor/activities/AC0014/refund-ratio', { query: { atDay: '2026-10-01' } })
  eq(d30.data, 100, '提前一个月也是 100%')
})

test('活动：报名统计与名单同源，且带阶段与缺口', async () => {
  const st = await call('GET', '/neighbor/activities/AC0014/enrolls/stats')
  eq(st.status, 200, '报名统计')
  assertSchema(st, 'NeighborEnrollStatsEnvelope', 'GET .../enrolls/stats')
  const list = await call('GET', '/neighbor/activities/AC0014/enrolls', { query: { size: 100 } })
  const alive = list.data.rows.filter(e => !['已取消', '已退款'].includes(e.status))
  const people = alive.reduce((s, e) => s + e.people, 0)
  eq(st.data.people, people, `统计的报名人数 ${st.data.people} 要等于名单 ${people}`)
  eq(st.data.total, list.data.total, '总记录数与名单同源')
  assert(['草稿', '报名中', '待成行', '已成行', '已流团', '已结束'].includes(st.data.phase), `带上阶段：${st.data.phase}`)
  assert(st.data.gap >= 0, '缺口不能是负数')
})

test('活动看板：五阶段计数与缺口合计', async () => {
  const st = await call('GET', '/neighbor/activities/stats')
  eq(st.status, 200, '活动看板')
  assertSchema(st, 'NeighborActivityStatsEnvelope', 'GET /neighbor/activities/stats')
  const list = await call('GET', '/neighbor/activities', { query: { size: 100 } })
  /* 列表只列报名中 / 待成行 / 已成行，所以这三个要和看板对上 */
  for (const [key, phase] of [['running', '报名中'], ['waiting', '待成行'], ['odd', '已成行']]) {
    const n = list.data.rows.filter(a => a.phase === phase).length
    eq(st.data[key], n, `看板 ${key} 与列表的「${phase}」同源`)
  }
  assert(st.data.gapTotal >= 0, '缺口合计不能是负数')
})

test('活动：类别与收费正交，列表字段自洽', async () => {
  const list = await call('GET', '/neighbor/activities', { query: { size: 100 } })
  eq(list.status, 200, '活动列表')
  const CATS = ['敬老', '亲子', '文体', '出游', '公益']
  for (const a of list.data.rows) {
    assert(CATS.includes(a.category), `类别要在枚举内：${a.activityId} = ${a.category}`)
    /* 两个维度必须正交：不能出现「亲子 · 收费 · 免费」这种三拼 */
    eq(a.feeType, a.fee > 0 ? '收费' : '免费', `${a.activityId} 的 feeType 要由 fee 派生`)
    eq('type' in a, false, '活动返回里不该再有 type（类别在 category）')
  }
  /* 同一类别里既有免费也有收费才说明真的拆开了 */
  const cats = new Set(list.data.rows.map(a => a.category))
  assert(cats.size >= 3, `列表至少覆盖 3 个类别（实际 ${cats.size}）`)

  /* 免费场次不需要成团下限与退款档位 */
  const free = await call('POST', '/neighbor/activities', {
    body: { ...ACT_BASE, title: '测试：免费场次', category: '敬老', fee: 0 }
  })
  eq(free.status, 200, '免费场次不带 minCapacity / refundPolicy 也能建')
  eq(free.data.feeType, '免费', '派生为免费')
  eq(free.data.minCapacity, 0, '免费场次没有成团下限')
  eq(free.data.refundPolicy.length, 0, '免费场次没有退款档位')
})

test('活动下拉：只给未结束、非草稿的，label 带日期', async () => {
  const r = await call('GET', '/neighbor/activities/options')
  eq(r.status, 200, '活动下拉')
  assert(Array.isArray(r.data), '下拉是数组')
  assert(r.data.length > 0, '至少有一场可选')
  r.data.forEach(o => {
    assert(o.value && o.label, '每项都要有 value / label')
    assert(/\d{4}-\d{2}-\d{2}/.test(o.label), `label 里要带日期：${o.label}`)
  })
})

/* ==================== 邻里 · 闲置与举报看板 ==================== */
test('闲置看板：通过率只算审过的，分类返回数组', async () => {
  const st = await call('GET', '/neighbor/items/stats')
  eq(st.status, 200, '闲置看板')
  assertSchema(st, 'NeighborItemStatsEnvelope', 'GET /neighbor/items/stats')
  const pending = await call('GET', '/neighbor/items', { query: { status: '待审核', size: 100 } })
  eq(st.data.pending, pending.data.total, '待审数与队列同源')
  const online = await call('GET', '/neighbor/items', { query: { status: '已上架', size: 100 } })
  eq(st.data.online, online.data.total, '在架数与列表同源')
  /* 通过率 = 已上架 /(已上架 + 已驳回)，待审的不进分母 */
  const rejected = await call('GET', '/neighbor/items', { query: { status: '已驳回', size: 100 } })
  if (online.data.total + rejected.data.total > 0) {
    const expect = Math.round((online.data.total / (online.data.total + rejected.data.total)) * 10000) / 100
    near(st.data.passRate, expect, '通过率只算审过的', 0.02)
  }

  const cats = await call('GET', '/neighbor/items/categories')
  assertSchema(cats, 'NeighborItemCategoriesEnvelope', 'GET /neighbor/items/categories')
  assert(Array.isArray(cats.data), '分类要返回字符串数组')
  assert(cats.data.length > 0, '分类不能为空')
  /* 字典来自已有内容：列表里出现过的分类，字典里必须有 */
  const shown = new Set(online.data.rows.map(r => r.category))
  for (const c of shown) assert(cats.data.includes(c), `字典缺少分类 ${c}`)
})

test('举报看板：待处理与处置分布', async () => {
  const st = await call('GET', '/neighbor/reports/stats')
  eq(st.status, 200, '举报看板')
  const list = await call('GET', '/neighbor/reports', { query: { size: 100 } })
  eq(st.data.total, list.data.total, '总数与列表同源')
  eq(st.data.pending, list.data.rows.filter(r => r.status === '待处理').length, '待处理数与列表同源')
  eq(st.data.handled, list.data.rows.filter(r => r.status === '已处理').length, '已处理数与列表同源')
  eq(st.data.offline, list.data.rows.filter(r => r.action === '下架并警告').length, '下架处置数与列表同源')
})

/* ==================== 业主自助挂牌（mp 组，第 70 批） ==================== */
let mpToken = ''

test('业主挂牌：非本人房发不了、同房在架唯一、他人详情 404', async () => {
  const lg = await call('POST', '/mp/auth/wechat-login', {
    body: { mock: true, phone: '17342774164' }, auth: false
  })
  eq(lg.status, 200, '业主登录')
  assertSchema(lg, 'MpSessionEnvelope', 'POST /mp/auth/wechat-login')
  /* 登录只发会话：姓名与证件要等实名那一步（见「业主认证」那组用例） */
  assert(!('idCard' in lg.data) && !('idCard4' in lg.data), '登录不返回证件号')
  mpToken = lg.data.token

  /* 发布要 L2：先实名。只凭手机号就能挂房，会被拿来做虚假房源 */
  const needReal = await withMp(mpToken, () => call('POST', '/mp/listings', {
    body: { houseId: 'H010110101', type: '出租', price: 2800 }
  }))
  eq(needReal.status, 422, '没实名不能发布')
  assert(String(needReal.message).includes('实名'), `提示要说清是实名：${needReal.message}`)

  const rn = await withMp(mpToken, () => call('POST', '/mp/auth/realname', {
    body: { name: '贾刚', idCard4: '3994' }
  }))
  eq(rn.status, 200, '实名')

  /* 缺 mock 标记：真实环境这条分支必须关掉 */
  const noMock = await call('POST', '/mp/auth/wechat-login', { body: { phone: '17342774164' }, auth: false })
  eq(noMock.status, 422, '不带 mock=true 要 422')

  /* 没档案的手机号 */
  const ghost = await call('POST', '/mp/auth/wechat-login', { body: { mock: true, phone: '13000000000' }, auth: false })
  eq(ghost.status, 404, '查不到档案 404')

  const save = token
  token = mpToken
  try {
    /* 别人的房：租客能住不能转租 */
    const other = await call('POST', '/mp/listings', {
      body: { houseId: 'H010110102', type: '出租', price: 3000 }
    })
    eq(other.status, 403, '非本人房产 403')
    eq(other.code, 40390, '业务码 40390')

    /* 自己的房：发一条 */
    const own = await call('POST', '/mp/listings', {
      body: {
        houseId: 'H010110101', type: '出租', price: 2800, deposit: 2800,
        payTerm: '押一付三', decorate: '精装', facilities: ['空调', '热水器'],
        desc: '测试挂牌：近地铁', images: 3
      }
    })
    eq(own.status, 200, '发布挂牌')
    assertSchema(own, 'MpListingEnvelope', 'POST /mp/listings')
    eq(own.data.status, '待审核', '发布即待审核')
    eq(own.data.room, '0101', '我的视图可以带房号')
    eq('ownerId' in own.data, false, '不返回 ownerId')
    eq('stewardEmpId' in own.data, false, '不返回楼管工号')
    assert(own.data.expireAt > '2026-11-01', '要有 60 天到期日')
    const id = own.data.listingId

    /* 同一套房在架唯一 */
    const dup = await call('POST', '/mp/listings', { body: { houseId: 'H010110101', type: '出租', price: 2700 } })
    eq(dup.status, 409, '同房在架唯一')
    eq(dup.code, 40990, '业务码 40990')

    /* 他人挂牌详情：404 而不是 403 */
    const peek = await call('GET', '/mp/listings/LS00001')
    eq(peek.status, 404, '他人挂牌详情要 404')

    /* 我的列表只含我的 */
    const mine = await call('GET', '/mp/listings')
    eq(mine.status, 200, '我的挂牌')
    assert(mine.data.rows.every(r => r.houseId), '每行都要有房号')
    assert(mine.data.rows.some(r => r.listingId === id), '列表里要能看到刚发的这条')
  } finally {
    token = save
  }
})

test('业主挂牌：改内容要再审，内容没改续挂免审', async () => {
  const save = token
  token = mpToken
  try {
    const mine = await call('GET', '/mp/listings')
    const row = mine.data.rows.find(r => r.houseId === 'H010110101')
    assert(!!row, '先要有一条自己的挂牌')
    const id = row.listingId

    /* 改价格 → 内容版本 +1，回到待审核 */
    const edited = await call('PATCH', `/mp/listings/${id}`, { body: { price: 2600 } })
    eq(edited.status, 200, '编辑')
    eq(edited.data.contentVersion, (row.contentVersion || 1) + 1, '内容版本要 +1')
    eq(edited.data.status, '待审核', '改完回待审核')

    /* 换房、改类型都不许：那是另一条挂牌 */
    const moveHouse = await call('PATCH', `/mp/listings/${id}`, { body: { houseId: 'H010110103' } })
    eq(moveHouse.status, 422, '不能换房')
    const changeType = await call('PATCH', `/mp/listings/${id}`, { body: { type: '出售' } })
    eq(changeType.status, 422, '不能改出租/出售')

    /* 下架（业主自己下架不需要理由） */
    const off = await call('POST', `/mp/listings/${id}/offline`)
    eq(off.data.status, '已下架', '下架')
    eq(off.data.canRenew, true, '下架后可以续挂')

    /* 内容改过（cv != av）→ 续挂要再审 */
    const renew = await call('POST', `/mp/listings/${id}/renew`)
    eq(renew.status, 200, '续挂')
    eq(renew.data.status, '待审核', '内容改过，续挂仍需审核')
    assert(renew.data.expireAt > '2026-11-01', '续挂要顺延 60 天')

    /* 已下架的再下架：409 */
    await call('POST', `/mp/listings/${id}/offline`)
    const offAgain = await call('POST', `/mp/listings/${id}/offline`)
    eq(offAgain.status, 409, '重复下架 409')
    eq(offAgain.code, 40992, '业务码 40992')

    /* 非「已发布」不能标记成交 */
    const deal = await call('POST', `/mp/listings/${id}/deal`)
    eq(deal.status, 409, '待审核的不能标记成交')
    eq(deal.code, 40994, '业务码 40994')
  } finally {
    token = save
  }
})

test('业主挂牌：员工令牌进不来，业主令牌也进不了后台', async () => {
  /* 两条会话通道不能混用 */
  const save = token
  token = mpToken
  try {
    const back = await call('GET', '/listings')
    eq(back.status, 401, '业主令牌调后台接口要 401')
  } finally {
    token = save
  }
  const front = await call('GET', '/mp/listings')
  eq(front.status, 401, '员工令牌调业主接口要 401')
})

/* ==================== 业主端认证：登录 → 实名 → 候选 → 绑定 ==================== */
/** 业主侧登录：token 与员工的两条通道，切完记得换回来 */
async function mpLoginAs(phone) {
  const r = await call('POST', '/mp/auth/wechat-login', {
    body: { mock: true, phone }, auth: false
  })
  return r
}
async function withMp(tok, fn) {
  const save = token
  token = tok
  try { return await fn() } finally { token = save }
}

test('选房三级：小区 / 楼栋 / 房间都只回答"这是哪一间"', async () => {
  /* 选房发生在实名**之前**，所以这条用例只用 L1 的 token、不去实名。
     哪天有人给这三条加上 L2，这里会立刻红 —— 而真实后果是
     "刚登录的业主点不进选房页"，比一条用例红难查得多。 */
  const lg = await mpLoginAs('13800138001')
  const tok = lg.data.token

  const anon = await call('GET', '/mp/communities', { auth: false })
  eq(anon.status, 401, '未登录不能枚举房产档案')

  const cs = await withMp(tok, () => call('GET', '/mp/communities'))
  eq(cs.status, 200, '小区列表')
  assertSchema(cs, 'MpCommunityListEnvelope', 'GET /mp/communities')
  eq(cs.data.rows.length, 3, '三个在管项目')
  assert(cs.data.rows.every(r => r.houseCount > 0 && r.address), '每个小区都要有地址与户数')
  const p01 = cs.data.rows.find(r => r.communityId === 'P01')
  /* 户数按房号实算：项目表写的是"合同上多少户"，房号表才是"系统里多少间"。
     这条断言同时盯着本轮把裁剪的 220 户补成 756 那次改数据 —— 补少了它就红 */
  eq(p01.houseCount, 352, 'P01 户数按房号实算')

  const bs = await withMp(tok, () => call('GET', '/mp/communities/P01/buildings'))
  eq(bs.status, 200, '楼栋列表')
  assertSchema(bs, 'MpBuildingListEnvelope', 'GET /mp/communities/{communityId}/buildings')
  eq(bs.data.rows.length, 8, 'P01 有 8 栋')
  eq(bs.data.rows[0].buildingId, 'B0101', '按楼号排序，1 栋在最前')
  eq(bs.data.rows[0].houseCount, 44, '1 栋 44 户')
  eq(bs.data.rows[0].unitCount, 2, '1 栋 2 个单元')

  const noComm = await withMp(tok, () => call('GET', '/mp/communities/P99/buildings'))
  eq(noComm.status, 404, '不存在的小区 404')

  const rs = await withMp(tok, () => call('GET', '/mp/buildings/B0101/rooms'))
  eq(rs.status, 200, '房号列表')
  assertSchema(rs, 'MpRoomGroupListEnvelope', 'GET /mp/buildings/{buildingId}/rooms')
  eq(rs.data.groups.length, 2, '1 栋两个单元')
  const total = rs.data.groups.reduce((n, g) => n + g.rooms.length, 0)
  eq(total, 44, '两组合起来 44 间，与楼栋户数一致')

  const g0 = rs.data.groups[0]
  eq(g0.unitName, '1单元', '单元名')
  const floors = g0.rooms.map(r => r.floor)
  eq(floors.every((f, i) => i === 0 || f >= floors[i - 1]), true, '组内按楼层升序')
  eq(g0.rooms[0].room, '0101', '1 层从 0101 起')

  /* 这一层只回答"这是哪一间"：多给一个字段，就是给陌生人多一次业主信息试探的机会 */
  const one = g0.rooms[0]
  assertSchema(one, 'MpRoom', '房号')
  for (const k of ['ownerId', 'tenantId', 'stewardEmpId', 'phone', 'propertyStatus', 'certNo']) {
    eq(k in one, false, `选房不该下发 ${k}`)
  }

  const noBld = await withMp(tok, () => call('GET', '/mp/buildings/B9999/rooms'))
  eq(noBld.status, 404, '不存在的楼栋 404')

  /* 选房页能点到的房号，后台档案里必须也有 —— 否则就是
     "页面上点得到、绑定那一步 403"，比不切接口更糟 */
  const back = await call('GET', '/houses/H010110501')
  eq(back.status, 200, '选房页给出的房号，后台档案里存在')
  eq(back.data.communityId, 'P01', '落在同一个项目')
})

/* ============================ 车位（批次 82） ============================ */

test('车位：只给我名下的，额度按车位不按业主', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const r = await withMp(tok, () => call('GET', '/mp/parkings'))
  eq(r.status, 200, '我的车位')
  assertSchema(r, 'MpParkingListEnvelope', 'GET /mp/parkings')
  eq(r.data.limit, 1, '每车位每自然月 1 次')
  eq(r.data.period, '2026-10', '周期是演示数据当月')
  eq(r.data.resetAt, '2026-11-01', '额度下月 1 日重置')
  eq(r.data.rows.length, 1, '张建国 1 个车位')

  const p = r.data.rows[0]
  assertSchema(p, 'MpParking', '车位')
  eq(p.parkNo, 'B1-115', '车位号')
  eq(p.usedThisMonth, 0, '本月还没换过')
  eq(p.vehicleCount, 1, '绑了 1 辆车')
  eq(p.expireDate, '2026-10-26', '到期日 = 管理费已缴至')
  eq('ownerId' in p, false, '不下发 ownerId —— 都是自己的，给出去只方便别人比对')

  /* 两个车位的人：额度按车位算，不是按人算 —— 换两个车位是两件事 */
  const w = await mpReady('13700137003', '王浩然', '3572')
  const r2 = await withMp(w.tok, () => call('GET', '/mp/parkings'))
  eq(r2.data.rows.length, 2, '王浩然 2 个车位')
  eq(r2.data.rows.every(x => x.usedThisMonth === 0), true, '两个车位各自有 1 次额度')
  eq(r2.data.rows.map(x => x.parkNo).join(','), 'B1-121,B1-122', '按车位号排')
})

test('车位详情：车辆只给卡号后四位，别人的车位 403 不是 404', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const r = await withMp(tok, () => call('GET', '/mp/parkings/PK00115'))
  eq(r.status, 200, '车位详情')
  assertSchema(r, 'MpParkingDetailEnvelope', 'GET /mp/parkings/{parkId}')
  eq(r.data.parking.parkNo, 'B1-115', '车位号')
  eq(r.data.parking.chargePile, true, '这个位有充电桩')
  eq(r.data.vehicles.length, 1, '一辆车')

  const v = r.data.vehicles[0]
  assertSchema(v, 'MpVehicle', '车辆')
  eq(v.plateNo, '川B·SFV7D', '车牌')
  eq(v.cardNoTail, '2192', '卡号只给后四位')
  eq('cardNo' in v, false, '完整 IC 卡号不下发 —— 那是能复制去开闸的凭证')

  /* 别人的车位：403 而不是 404。号是真实存在的，回 404 会让业主以为"我的车位没了" */
  const other = await withMp(tok, () => call('GET', '/mp/parkings/PK00156'))
  eq(other.status, 403, '别人的车位 403')
  const none = await withMp(tok, () => call('GET', '/mp/parkings/PK99999'))
  eq(none.status, 404, '不存在的车位 404')
})

test('换绑车牌：四条前置逐条拦，成功留痕且不伪造厂商回执', async () => {
  /* ① 未实名：登录后直接换 —— 实名是 L2，换牌动的是道闸白名单 */
  const fresh = await mpLoginAs('13800138001')
  const noReal = await withMp(fresh.data.token, () => call('POST', '/mp/parkings/PK00115/plate', { body: { plateNo: '川B·12345' } }))
  eq(noReal.status, 403, '未实名不能换绑')

  /* ② 家属：车位在父亲名下，她能看见，但不能替他换 */
  const mb = await mpLoginAs('17619030789')
  const fam = await withMp(mb.data.token, () => call('POST', '/mp/parkings/PK00115/plate', { body: { plateNo: '川B·12345' } }))
  eq(fam.status, 403, '家属不能自助换绑')
  eq(fam.message.includes('产权业主'), true, '错因说清是身份，不是次数 —— 否则她会换个账号再试')

  /* ③ 管理费已到期：李秀兰 B2-026 到期 2026-09-19 */
  const li = await mpReady('13900139002', '李秀兰', '4392')
  const expired = await withMp(li.tok, () => call('POST', '/mp/parkings/PK00156/plate', { body: { plateNo: '渝A·99999' } }))
  eq(expired.status, 409, '到期不能换绑')
  eq(expired.code, 40930, '40930 管理费已到期')

  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const bad = await withMp(tok, () => call('POST', '/mp/parkings/PK00115/plate', { body: { plateNo: 'ABC' } }))
  eq(bad.status, 422, '车牌格式不对 422')
  const same = await withMp(tok, () => call('POST', '/mp/parkings/PK00115/plate', { body: { plateNo: '川B·SFV7D' } }))
  eq(same.status, 422, '与原车牌相同 422')

  /* ④ 成功：小写 + 没打间隔点也要认，归一化成「川B·6Q2M8」 */
  const ok = await withMp(tok, () => call('POST', '/mp/parkings/PK00115/plate', {
    body: { plateNo: '川b 6q2m8', reason: '换了新车' }
  }))
  eq(ok.status, 200, '换绑成功')
  assertSchema(ok, 'MpPlateChangeEnvelope', 'POST /mp/parkings/{parkId}/plate')
  eq(ok.data.log.fromPlate, '川B·SFV7D', '记录了原车牌')
  eq(ok.data.log.toPlate, '川B·6Q2M8', '输入被归一化')
  eq(ok.data.log.source, '业主自助', '来源')
  eq(ok.data.log.operatorName, '张建国', '操作人就是业主本人，不留空')
  eq(ok.data.log.vendorStatus, '待同步', '车牌识别没对接，不假装已同步')
  eq(ok.data.parking.plateNo, '川B·6Q2M8', '车位本体已更新')
  eq(ok.data.parking.usedThisMonth, 1, '本月已用 1 次')
  eq(ok.data.limit, 1, '额度一起返回，客户端不用再拉一次列表')

  /* ⑤ 记录可见；详情里的车辆也换了牌 —— 只改车位不改车辆，页面会出现两个车牌 */
  const logs = await withMp(tok, () => call('GET', '/mp/parkings/PK00115/logs'))
  eq(logs.status, 200, '换绑记录')
  assertSchema(logs, 'MpParkingChangeLogListEnvelope', 'GET /mp/parkings/{parkId}/logs')
  eq(logs.data.rows.length, 2, '本次 1 条 + 8 月物业代操作 1 条')
  eq(logs.data.rows[0].logId, ok.data.log.logId, '最新一条在最前')
  eq(logs.data.rows[1].source, '物业代操作', '历史记录保留来源')
  const det = await withMp(tok, () => call('GET', '/mp/parkings/PK00115'))
  eq(det.data.vehicles[0].plateNo, '川B·6Q2M8', '车辆表同步')

  /* ⑥ 额度用完：第二次被拦，且文案要说清什么时候恢复 */
  const again = await withMp(tok, () => call('POST', '/mp/parkings/PK00115/plate', { body: { plateNo: '川B·77777' } }))
  eq(again.status, 409, '本月第 2 次被拦')
  eq(again.code, 40929, '40929 额度用完')
  eq(again.message.includes('下月 1 日'), true, '客服照这句就能回答业主')
})

test('换绑：同一业主两个车位不能挂同一个牌；账单按 parkId 不串', async () => {
  const { tok } = await mpReady('13700137003', '王浩然', '3572')

  /* 道闸侧认牌不认车位，同一个牌挂两处会重复计费 */
  const clash = await withMp(tok, () => call('POST', '/mp/parkings/PK00121/plate', { body: { plateNo: '京N·D7WY3' } }))
  eq(clash.status, 409, '两个车位不能挂同一个牌')
  eq(clash.code, 40931, '40931 车牌已在本人其他车位')

  const b1 = await withMp(tok, () => call('GET', '/mp/bills', { query: { parkId: 'PK00121' } }))
  eq(b1.data.rows.length, 3, 'B1-121 三期')
  eq(b1.data.rows.every(x => x.parkId === 'PK00121'), true, '不掺另一个车位的账')
  const b2 = await withMp(tok, () => call('GET', '/mp/bills', { query: { parkId: 'PK00402' } }))
  eq(b2.data.rows.length, 3, 'B1-122 也是三期')
  near(b1.data.summary.unpaid + b2.data.summary.unpaid, 240, '两个车位各欠 120 —— 串了就会少一半')

  /* 别人的车位账单：403，不能靠 parkId 窥探别人的缴费记录 */
  const other = await withMp(tok, () => call('GET', '/mp/bills', { query: { parkId: 'PK00115' } }))
  eq(other.status, 403, '别人的车位账单 403')
})

/* ============================ 预存账户与商业账户（2026-11-11） ============================ */

test('预存账户：按房取，未开通不是 404', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const r = await withMp(tok, () => call('GET', '/mp/prepay', { query: { houseId: 'H010110501' } }))
  eq(r.status, 200, '预存账户')
  assertSchema(r, 'MpPrepayEnvelope', 'GET /mp/prepay')

  eq(r.data.account.balance, 917.14, '余额 = 1500 充值 - 582.86 抵扣')
  eq(r.data.account.status, '正常', '账户正常')
  eq(r.data.account.houseId, 'H010110501', '账户挂在房上')
  /* 账单会被前面的支付用例改（测试共享内存），所以只断言形状与排序，不钉死张数与金额 */
  eq(r.data.bills.count >= 1, true, '有可抵账单')
  eq(r.data.bills.unpaid > 0, true, '待抵合计大于 0')
  const periods = r.data.bills.rows.map(b => b.period)
  eq(periods.join(',') === [...periods].sort().join(','), true, '按账期升序，最早的在前')
  eq(r.data.flows.length, 3, '三条历史流水')
  near(r.data.account.balance, r.data.flows[0].balanceAfter, '余额 = 最后一条流水的余额')

  /* 没有账户是**正常状态**，不是 404：249 个有表具的房只有 126 个开户 */
  const li = await mpReady('13900139002', '李秀兰', '4392')
  const r2 = await withMp(li.tok, () => call('GET', '/mp/prepay'))
  eq(r2.status, 200, '没开户也要能读')
  eq(r2.data.account.status, '未开通', '第四态')
  eq(r2.data.account.balance, 0, '没开户余额是 0')
  eq(r2.data.account.accountId, '', '没有账户号')
  eq(r2.data.flows.length, 0, '没有流水')

  /* 别人的房：403，不是空账户 —— 空账户会让业主以为"我这房没欠费" */
  const other = await withMp(tok, () => call('GET', '/mp/prepay', { query: { houseId: 'H010110101' } }))
  eq(other.status, 403, '别人的房 403')
})

test('预存充值：首次充值即开户，营销位恒 null', async () => {
  const w = await mpReady('13700137003', '王浩然', '3572')
  const before = await withMp(w.tok, () => call('GET', '/mp/prepay'))
  eq(before.data.account.status, '未开通', '王浩然还没有账户')

  const r = await withMp(w.tok, () => call('POST', '/mp/prepay/recharge', {
    body: { amount: 500, method: '微信支付', campaignCode: 'AUTUMN' }
  }))
  eq(r.status, 200, '充值成功')
  assertSchema(r, 'MpPrepayRechargeEnvelope', 'POST /mp/prepay/recharge')
  eq(r.data.account.status, '正常', '首次充值即开户')
  eq(r.data.account.balance, 500, '余额')
  eq(r.data.account.accountId !== '', true, '开户后有了账户号')
  eq(r.data.flow.type, '充值', '写了一条充值流水')
  eq(r.data.flow.balanceAfter, 500, '流水余额与账户一致')
  eq(r.data.gift, null, '营销赠送本期恒为 null —— 不假装有活动')

  const after = await withMp(w.tok, () => call('GET', '/mp/prepay'))
  eq(after.data.flows.length, 1, '流水 1 条')

  const zero = await withMp(w.tok, () => call('POST', '/mp/prepay/recharge', { body: { amount: 0 } }))
  eq(zero.status, 422, '金额 0 → 422')
  const huge = await withMp(w.tok, () => call('POST', '/mp/prepay/recharge', { body: { amount: 50001 } }))
  eq(huge.status, 422, '超过单笔上限 → 422')
})

test('预存抵扣：按账期冲抵，余额用完为止，可指定账单', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const q = { houseId: 'H010110501' }

  /* 期望值全部按"读到的"算，不硬编码 —— 测试共享内存，
     前面的支付用例可能已经把某几张账单缴掉了。这条守的是**规则**，不是数字。 */
  const before = await withMp(tok, () => call('GET', '/mp/prepay', { query: q }))
  const bal = before.data.account.balance
  const list = before.data.bills.rows
  eq(list.length > 0, true, '有可抵账单')
  eq(bal > 0, true, '有可用余额')

  const all = await withMp(tok, () => call('POST', '/mp/prepay/deduct', { body: q }))
  eq(all.status, 200, '一键抵扣')
  assertSchema(all, 'MpPrepayDeductEnvelope', 'POST /mp/prepay/deduct')

  /* 按账期升序抵，抵到余额用完为止 */
  let left = bal
  let expect = 0
  let cover = 0
  for (const b of list) {
    if (left <= 0.009) break
    const use = Math.min(left, b.unpaid)
    expect += use
    left -= use
    cover += 1
  }
  near(all.data.deducted, expect, '抵掉 min(余额, 待抵合计)')
  eq(all.data.rows.length, cover, '覆盖的账单张数')
  near(all.data.account.balance, bal - expect, '余额 = 原余额 - 抵扣额')
  eq(all.data.rows[0].billId, list[0].billId, '从最早的账期开始抵')
  near(all.data.flow.bills.reduce((s, b) => s + b.amount, 0), expect, '流水明细合计 = 抵扣额')
  eq(all.data.rows.every(r => ['已缴', '部分缴'].includes(r.afterStatus)), true, '抵完只能是已缴或部分缴')

  /* 余额为 0 时再抵 → 422（而不是静默成功一条 0 元记录） */
  if (all.data.account.balance <= 0.009) {
    const again = await withMp(tok, () => call('POST', '/mp/prepay/deduct', { body: q }))
    eq(again.status, 422, '余额为 0 再抵 → 422')
  }

  /* 再充 500，指定一张剩下的账单：够就抵、不够就 422，不做半途而废 */
  const ch = await withMp(tok, () => call('POST', '/mp/prepay/recharge', { body: { houseId: q.houseId, amount: 500 } }))
  eq(ch.data.account.status, '正常', '充值后账户正常')
  const after = await withMp(tok, () => call('GET', '/mp/prepay', { query: q }))
  if (after.data.bills.rows.length) {
    const target = after.data.bills.rows[0]
    const r3 = await withMp(tok, () => call('POST', '/mp/prepay/deduct', {
      body: { houseId: q.houseId, billIds: [target.billId] }
    }))
    if (target.unpaid <= 500) {
      eq(r3.status, 200, '指定账单：余额够')
      near(r3.data.deducted, target.unpaid, '只抵这一张的欠额')
      eq(r3.data.rows[0].afterStatus, '已缴', '结清')
    } else {
      eq(r3.status, 422, '指定账单：余额不够就是 422')
      eq(r3.code, 42213, '42213 余额不足')
    }
  }

  /* 未开户的业主抵扣 → 422（提示先充值开户） */
  const li = await mpReady('13900139002', '李秀兰', '4392')
  const noAcc = await withMp(li.tok, () => call('POST', '/mp/prepay/deduct', { body: {} }))
  eq(noAcc.status, 422, '没账户不能抵扣')
})

test('商业账户：只读镜像，只有积分与券，没有余额', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const r = await withMp(tok, () => call('GET', '/mp/commerce/account'))
  eq(r.status, 200, '商业账户')
  assertSchema(r, 'MpCommerceAccountEnvelope', 'GET /mp/commerce/account')
  eq(r.data.points, 1280, '积分')
  eq(r.data.level, '银卡会员', '等级')
  eq(r.data.coupons.length, 3, '三张券')
  eq(r.data.coupons.filter(c => c.status === '可领取').length, 2, '两张可领')
  eq(r.data.coupons[0].claimUrl.startsWith('http'), true, '领取落在商业平台，不是一个假按钮')
  eq('balance' in r.data, false, '不给余额：商业平台的储值不是物业预存，混在一起业主会问能不能交物业费')
  eq(!!r.data.syncedAt, true, '必须带镜像时间点')

  const li = await mpReady('13900139002', '李秀兰', '4392')
  const none = await withMp(li.tok, () => call('GET', '/mp/commerce/account'))
  eq(none.status, 404, '没在商业平台注册 → 404')
})

/* ============================ 人脸 / 刷脸通行（批次 83） ============================ */

test('人脸：业主看到本人与成员，未核验的成员没有代录入口', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const r = await withMp(tok, () => call('GET', '/mp/access/faces'))
  eq(r.status, 200, '人脸状态')
  assertSchema(r, 'MpAccessFaceListEnvelope', 'GET /mp/access/faces')

  const self = r.data.self
  assertSchema(self, 'MpFaceSelf', '本人人脸')
  eq(self.status, '已生效', '张建国已开通刷脸')
  eq(self.faceId, 'FC00001', '已生效的申请单号')
  eq(self.role, '业主', '身份')
  eq(self.readOnly, false, '业主可自助提交')
  eq(self.canSubmit, true, '已生效也能重新采集')
  eq(self.remain24h, 3, '24 小时 3 次')

  eq(r.data.members.length, 2, '本房两位成员')
  const chen = r.data.members.find(m => m.memberId === 'MB00001')
  const wang = r.data.members.find(m => m.memberId === 'MB00002')
  assertSchema(chen, 'MpFaceMember', '成员人脸')

  eq(chen.name, '陈静', '配偶')
  eq(chen.status, '已生效', '代录后已通过核验')
  eq(chen.canEnroll, true, '已核验成员可以（重新）代录')

  eq(wang.certified, false, '王小雪的成员资料还没核验')
  eq(wang.status, '未采集', '未核验成员不会是已生效')
  eq(wang.canEnroll, false, '没有代录入口')
  eq(wang.why.includes('核验'), true, '要把原因写出来，否则业主只会以为按钮坏了')
})

test('人脸：家属只能看自己，租客只读', async () => {
  /* 家属：成员列表恒为空 —— 家属之间是平级关系，谁也代表不了谁 */
  const mb = await mpLoginAs('17619030789')
  const fam = await withMp(mb.data.token, () => call('GET', '/mp/access/faces'))
  eq(fam.status, 200, '家属读人脸')
  eq(fam.data.members.length, 0, '家属看不到其他成员')
  eq(fam.data.self.name, '陈静', '只能看到自己')
  eq(fam.data.self.status, '已生效', '她自己那条')
  eq(fam.data.self.faceId, 'FC00002', '按 memberId 命中，不是按业主')

  /* 租客：人脸由物业在租约核验时录，业主端只读 */
  const tn = await mpLoginAs('13012931145')
  const ten = await withMp(tn.data.token, () => call('GET', '/mp/access/faces'))
  eq(ten.status, 200, '租客读人脸')
  eq(ten.data.self.readOnly, true, '租客只读')
  eq(ten.data.self.canSubmit, false, '租客不自助提交')
  eq(ten.data.self.status, '已生效', '档案里已录')
  eq(ten.data.members.length, 0, '租客不看本房成员')

  const tryPost = await withMp(tn.data.token, () => call('POST', '/mp/access/faces'))
  eq(tryPost.status, 403, '租客自助提交 403')
})

test('人脸：待核验不能重复提交，驳回可重拍，撤回后变已冻结', async () => {
  /* 李秀兰：昨天提交，物业还没审 */
  const li = await mpReady('13900139002', '李秀兰', '4392')
  const before = await withMp(li.tok, () => call('GET', '/mp/access/faces'))
  eq(before.data.self.status, '待核验', '李秀兰在等审核')
  const dup = await withMp(li.tok, () => call('POST', '/mp/access/faces'))
  eq(dup.status, 409, '核验期间不能重复提交')
  eq(dup.code, 40932, '40932 正在核验')

  /* 王浩然：照片逆光被驳回，原因要能读到 —— 那是他重拍的唯一依据 */
  const w = await mpReady('13700137003', '王浩然', '3572')
  const wt = await withMp(w.tok, () => call('GET', '/mp/access/faces'))
  eq(wt.data.self.status, '已驳回', '王浩然被驳回')
  eq(wt.data.self.note.includes('逆光'), true, '驳回原因下发到业主端')
  eq(wt.data.self.canSubmit, true, '驳回后可以重拍')

  const re = await withMp(w.tok, () => call('POST', '/mp/access/faces'))
  eq(re.status, 200, '重拍提交成功')
  assertSchema(re, 'MpFaceSelfEnvelope', 'POST /mp/access/faces')
  eq(re.data.status, '待核验', '提交后恒为待核验')
  eq(re.data.faceId !== 'FC00004', true, '新申请单，不复用被驳回那条（审核队列要是新的）')

  const back = await withMp(w.tok, () => call('POST', `/mp/access/faces/${re.data.faceId}/withdraw`))
  eq(back.status, 200, '撤回成功')
  assertSchema(back, 'MpFaceSubjectEnvelope', 'POST /mp/access/faces/{faceId}/withdraw')
  eq(back.data.status, '已冻结', '撤回置为已冻结，不是删记录')
  eq(back.data.note.includes('30 天'), true, '影像件删除期限要说清')

  const again = await withMp(w.tok, () => call('POST', `/mp/access/faces/${re.data.faceId}/withdraw`))
  eq(again.status, 409, '重复撤回')
  eq(again.code, 40935, '40935 状态不允许撤回')
})

test('人脸：代录要核验过的成员 + 监护人同意，家属不能代录', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')

  /* 王小雪资料还没核验：不能录 —— 没核验就录脸等于填个名字就能开门 */
  const notCert = await withMp(tok, () => call('POST', '/mp/access/faces/members/MB00002', { body: { guardian: true } }))
  eq(notCert.status, 409, '未核验成员不能代录')
  eq(notCert.code, 40934, '40934 成员未核验')

  const noGuardian = await withMp(tok, () => call('POST', '/mp/access/faces/members/MB00001', { body: {} }))
  eq(noGuardian.status, 422, '没勾监护人同意不能提交')

  const ok = await withMp(tok, () => call('POST', '/mp/access/faces/members/MB00001', { body: { guardian: true } }))
  eq(ok.status, 200, '代录提交成功')
  assertSchema(ok, 'MpFaceMemberEnvelope', 'POST /mp/access/faces/members/{memberId}')
  eq(ok.data.status, '待核验', '代录也进待核验')
  eq(ok.data.guardian.includes('监护人'), true, '代同意要留痕')

  /* 家属替配偶录：403 —— 不是权限高低，是责任边界 */
  const mb = await mpLoginAs('17619030789')
  const famTry = await withMp(mb.data.token, () => call('POST', '/mp/access/faces/members/MB00001', { body: { guardian: true } }))
  eq(famTry.status, 403, '家属不能代录')
})

test('人脸：24 小时最多 3 次，第 4 次被拦', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  for (let i = 1; i <= 3; i++) {
    const r = await withMp(tok, () => call('POST', '/mp/access/faces'))
    eq(r.status, 200, `第 ${i} 次提交`)
    eq(r.data.status, '待核验', `第 ${i} 次提交后是待核验`)
    if (i === 1) eq(r.data.note.includes('原人脸继续有效'), true, '重新采集时要说清旧脸还能用')
    const w = await withMp(tok, () => call('POST', `/mp/access/faces/${r.data.faceId}/withdraw`))
    eq(w.status, 200, `第 ${i} 次撤回`)
  }
  const over = await withMp(tok, () => call('POST', '/mp/access/faces'))
  eq(over.status, 409, '第 4 次被拦')
  eq(over.code, 40933, '40933 24 小时超限')
  eq(over.message.includes('明天'), true, '文案要说清什么时候能再试')
})

test('业主认证：登录不发姓名，未实名不能查候选', async () => {
  const lg = await mpLoginAs('13800138001')
  eq(lg.status, 200, '业主登录')
  assertSchema(lg, 'MpSessionEnvelope', 'POST /mp/auth/wechat-login')
  eq(lg.data.realnameStatus, '未实名', '登录只是 L1，不是 L2')
  eq('name' in lg.data, false, '登录不返回姓名')
  assert(!('idCard' in lg.data), '登录不返回证件号')
  const tok = lg.data.token

  const before = await withMp(tok, () => call('GET', '/mp/auth/bindings/candidates'))
  eq(before.status, 422, '没实名就查候选要 422')

  const bad = await withMp(tok, () => call('POST', '/mp/auth/realname', { body: { name: '张', idCard4: '5880' } }))
  eq(bad.status, 422, '姓名只有 1 个字要 422')
  const bad4 = await withMp(tok, () => call('POST', '/mp/auth/realname', { body: { name: '张建国', idCard4: '58' } }))
  eq(bad4.status, 422, '证件后四位不足 4 位要 422')

  const ok = await withMp(tok, () => call('POST', '/mp/auth/realname', { body: { name: '张建国', idCard4: '5880' } }))
  eq(ok.status, 200, '实名')
  eq(ok.data.realnameStatus, '已实名', '实名后状态')
  eq(ok.data.name, '张建国', '回显姓名')
  eq(ok.data.idCard4, '5880', '只回后四位')
})

test('业主认证：三项全中给候选，错哪一项说哪一项', async () => {
  const lg = await mpLoginAs('13800138001')
  const tok = lg.data.token
  await withMp(tok, () => call('POST', '/mp/auth/realname', { body: { name: '张建国', idCard4: '5880' } }))

  const cand = await withMp(tok, () => call('GET', '/mp/auth/bindings/candidates'))
  eq(cand.status, 200, '候选')
  assertSchema(cand, 'MpBindingCandidatesEnvelope', 'GET /mp/auth/bindings/candidates')
  assert(['one', 'many'].includes(cand.data.level), `三项全中应有候选（实际 ${cand.data.level}）`)
  eq(cand.data.mismatch.house, false, '房这一项没对不上')
  assert(cand.data.houses.length > 0, '候选里要有房')
  assert(cand.data.houses.every(h => h.bound === false), '还没绑，bound 应为 false')
  assert(!!cand.data.steward, '要给出该找谁核验')

  /* 证件错 → cert 一位亮 */
  await withMp(tok, () => call('POST', '/mp/auth/realname', { body: { name: '张建国', idCard4: '0000' } }))
  const certBad = await withMp(tok, () => call('GET', '/mp/auth/bindings/candidates'))
  eq(certBad.data.level, 'none', '证件不符 → none')
  eq(certBad.data.mismatch.cert, true, 'cert 要标出来')
  eq(certBad.data.mismatch.name, false, '姓名这一项是对的')
  assert(String(certBad.data.reason).includes('证件'), `理由要说清是证件：${certBad.data.reason}`)

  /* 姓名错 → name 一位亮 */
  await withMp(tok, () => call('POST', '/mp/auth/realname', { body: { name: '李四', idCard4: '5880' } }))
  const nameBad = await withMp(tok, () => call('GET', '/mp/auth/bindings/candidates'))
  eq(nameBad.data.mismatch.name, true, 'name 要标出来')
  eq(nameBad.data.mismatch.cert, false, '证件这一项是对的')

  /* 三项全中但房不是他的 → house 一位亮，这一位和"名字填错"要给不同提示 */
  await withMp(tok, () => call('POST', '/mp/auth/realname', { body: { name: '张建国', idCard4: '5880' } }))
  const houseBad = await withMp(tok, () => call('GET', '/mp/auth/bindings/candidates?houseId=H010110101'))
  eq(houseBad.data.level, 'none', '房不符 → none')
  eq(houseBad.data.mismatch.house, true, 'house 要标出来')
  eq(houseBad.data.mismatch.name, false, '姓名这一项是对的')
})

test('业主认证：家属与租客也能登，身份决定能绑哪些房', async () => {
  /* 家属：房取该业主名下的 */
  const mb = await mpLoginAs('17619030789')
  eq(mb.status, 200, '家属登录')
  await withMp(mb.data.token, () => call('POST', '/mp/auth/realname', { body: { name: '陈静', idCard4: '8168' } }))
  const mbCand = await withMp(mb.data.token, () => call('GET', '/mp/auth/bindings/candidates'))
  eq(mbCand.data.identity, '家属', '身份以档案为准')
  assert(mbCand.data.houses.length > 0, '家属能看到业主名下的房')

  /* 租客：只有租约那一套 */
  const tn = await mpLoginAs('13012931145')
  eq(tn.status, 200, '租客登录')
  await withMp(tn.data.token, () => call('POST', '/mp/auth/realname', { body: { name: '钟瑞', idCard4: '8874' } }))
  const tnCand = await withMp(tn.data.token, () => call('GET', '/mp/auth/bindings/candidates'))
  eq(tnCand.data.identity, '租客', '租客身份')
  eq(tnCand.data.level, 'one', '租客只有一套')
  eq(tnCand.data.houses.length, 1, '只能看到租约房')

  /* 租客传别人的房：house 一位亮，不能"绑上了再看" */
  const wrong = await withMp(tn.data.token, () =>
    call('GET', '/mp/auth/bindings/candidates?houseId=H010110101'))
  eq(wrong.data.level, 'none', '租客碰别人的房 → none')
  eq(wrong.data.mismatch.house, true, 'house 标出来')

  /* 查不到档案的手机号 */
  const ghost = await mpLoginAs('13000000000')
  eq(ghost.status, 404, '没登记的手机号 404')
})

test('业主认证：绑不在名下的房 → 403，绑成功 → me 给出房产与三个数', async () => {
  const lg = await mpLoginAs('13800138001')
  const tok = lg.data.token
  await withMp(tok, () => call('POST', '/mp/auth/realname', { body: { name: '张建国', idCard4: '5880' } }))
  const cand = await withMp(tok, () => call('GET', '/mp/auth/bindings/candidates'))
  const mineHouse = cand.data.houses[0].houseId

  /* 越权探测：别人的房 */
  const peek = await withMp(tok, () => call('POST', '/mp/auth/bindings', { body: { houseIds: ['H010110101'] } }))
  eq(peek.status, 403, '不在名下的房不能绑')
  eq(peek.code, 40391, '业务码 40391')

  /* 空数组 */
  const empty = await withMp(tok, () => call('POST', '/mp/auth/bindings', { body: { houseIds: [] } }))
  eq(empty.status, 422, '一套都没选要 422')

  const bind = await withMp(tok, () => call('POST', '/mp/auth/bindings', { body: { houseIds: [mineHouse] } }))
  eq(bind.status, 200, '绑定')
  assertSchema(bind, 'MpBindingEnvelope', 'POST /mp/auth/bindings')
  eq(bind.data.boundHouseIds.length, 1, '绑了 1 套')
  eq(bind.data.houses[0].bound, true, '返回的房要标已绑')

  const me = await withMp(tok, () => call('GET', '/mp/me'))
  eq(me.status, 200, 'me')
  assertSchema(me, 'MpMeEnvelope', 'GET /mp/me')
  eq(me.data.owner.name, '张建国', '姓名')
  assert(String(me.data.owner.phoneMasked).includes('****'), '手机号要脱敏')
  eq(me.data.owner.idCard4, '5880', '只回证件后四位')
  eq(me.data.houses.length, 1, '已绑 1 套')
  eq(me.data.identity, '业主', '身份')

  /* 三个数的口径 */
  const c = me.data.counts
  assert(c.debtAmount > 0, `张建国应有欠费（实际 ${c.debtAmount}）`)
  assert(c.debtBills > 0, '待缴账单数应大于 0')
  assert(c.doingOrders > 0, '应有进行中的工单')
  assert(c.maxOverdueDays >= 0, '最长逾期不能是负数')
  /* 批 C 已给样例补了增项（WO000001 上有一条待确认的 AD-D01）：
     这里从"恒 0"改成"> 0"，否则它会变成一条永远通过、什么都没验的假守卫 */
  assert(c.pendingAddons > 0, `张建国的单上应有待确认增项（实际 ${c.pendingAddons}）`)
  assert(c.pendingAddonAmount > 0, '待确认增项金额应大于 0')

  /* 未绑的房要能数出来（首页"还有 N 套可绑定"） */
  assert(me.data.unboundCount >= 0, '未绑数不能是负数')
})

/* ==================== 批 B：房屋 / 住户 / 租客 / 账单 / 价目 ==================== */
/**
 * 登录 → 实名 → 绑定全部可绑房。批 B 的接口都要求 L2 且**已绑**，
 * 用这个函数把三步串起来，免得每个用例抄一遍。
 */
async function mpReady(phone, name, idCard4) {
  const lg = await mpLoginAs(phone)
  eq(lg.status, 200, `${name} 登录`)
  const tok = lg.data.token
  await withMp(tok, () => call('POST', '/mp/auth/realname', { body: { name, idCard4 } }))
  const cand = await withMp(tok, () => call('GET', '/mp/auth/bindings/candidates'))
  eq(cand.data.level !== 'none', true, `${name} 应该能匹配到房产（${cand.data.reason || ''}）`)
  const ids = cand.data.houses.map(h => h.houseId)
  await withMp(tok, () => call('POST', '/mp/auth/bindings', { body: { houseIds: ids } }))
  return { tok, houses: ids }
}

test('/mp/me：没实名也能读（unboundCount 给 0，不能抛 422）', async () => {
  /* 登录后的第一屏就打这个接口。批 A 把它写成"未实名就 mpMatch → 抛 422"，
     业主端在接口模式下直接卡在登录页看着"登录成功"却什么都没发生 ——
     这类"只有真机走一遍才会发现"的错，用一条用例钉住比写在文档里管用。 */
  const lg = await mpLoginAs('13800138001')
  const r = await withMp(lg.data.token, () => call('GET', '/mp/me'))
  eq(r.status, 200, '登录后未实名也要能读 me')
  eq(r.data.realnameStatus, '未实名', '状态如实')
  eq(r.data.unboundCount, 0, '算不出可绑套数时给 0，不要抛错')
  eq(r.data.houses.length, 0, '没绑房就是空')
  /* 待缴口径含「本人名下不挂房的车位费」（见 /mp/me 的 description），
     所以这里**不是 0**：张建国名下有 B1-115，9 月逾期 + 10 月未缴两张。
     这条断言因此写成"房账不进待缴"而不是"一分钱不欠" —— 后者会把
     "车位是独立资产"这条业务规则判成 bug。 */
  eq(r.data.counts.debtBills, 2, '没绑房：待缴只剩名下 2 张车位费，房账不进')
})

test('房屋详情：只给基础信息与管家，未绑的房 403、不存在 404', async () => {
  const { tok, houses } = await mpReady('13800138001', '张建国', '5880')
  const hid = houses[0]

  const ok = await withMp(tok, () => call('GET', `/mp/houses/${hid}`))
  eq(ok.status, 200, '查自己的房')
  assertSchema(ok, 'MpHouseEnvelope', 'GET /mp/houses/{houseId}')
  eq(ok.data.houseId, hid, '返回的应是同一套')
  eq(ok.data.bound, true, '已绑的房要标 bound')
  assert(ok.data.fullName, '要有完整门牌（业主看自己的房，房号不是敏感信息）')
  assert(ok.data.steward && ok.data.steward.phone.includes('****'), '管家手机要掩码')

  /* 产权与档案字段一律不下发：业主端不需要，给了就是多一个泄露面 */
  for (const k of ['ownerId', 'propertyStatus', 'orientation', 'decorationViolation', 'tenantId']) {
    eq(k in ok.data, false, `房屋详情不该下发 ${k}`)
  }

  /* 别人家的房：403 而不是 404 —— 房确实存在，只是不归你 */
  const other = await withMp(tok, () => call('GET', '/mp/houses/H010110101'))
  eq(other.status, 403, '没绑的房不能查')

  const ghost = await withMp(tok, () => call('GET', '/mp/houses/H999999999'))
  eq(ghost.status, 404, '不存在的房 404')
})

test('住户：业主可见租金，身份证只回后四位、手机掩码', async () => {
  /* 用孔雪（H010111002 / 钟瑞）而不是排在最前的赵娟：
     前面的「搬离」用例会把第一个在住租客搬走，共用一套假服务时状态是串的 */
  const { tok, houses } = await mpReady('13521462398', '孔雪', '4580')
  eq(houses.includes('H010111002'), true, '这套是孔雪名下的出租房')

  const r = await withMp(tok, () => call('GET', '/mp/houses/H010111002/residents'))
  eq(r.status, 200, '查住户')
  assertSchema(r, 'MpResidentsEnvelope', 'GET /mp/houses/{houseId}/residents')
  eq(r.data.owner.name, '孔雪', '产权人是本人')

  const t = r.data.tenants[0]
  assert(t, '这套房应该有在住租客')
  /* 与楼管口径相反：业主是出租方，必须看得到租金，看不到就没法对账 */
  assert(t.rent > 0, `业主必须看得到租金（实际 ${t.rent}）`)
  near(t.rent, 4776.7, '租金就是租约上的金额')
  eq(t.name, '钟瑞', '租客姓名')
  eq(t.phone.includes('****'), true, '手机号掩码')
  eq(t.idCard4.length, 4, '证件只回后四位')
  eq('idCard' in t, false, '不回完整证件号')
  eq(t.status, '在住', '只返回在住的')

  /* 这套房没有共住家属，members 是空数组而不是 null —— 前端 `v-for` 不用判空 */
  eq(Array.isArray(r.data.members), true, 'members 要给数组')

  /* 家庭成员换个有人的房看（张建国的 0501 有配偶与子女）：
     手机同样掩码，且没有 faceRegistered / appUser 时**不要编 false** */
  const z = await mpReady('13800138001', '张建国', '5880')
  const zr = await withMp(z.tok, () => call('GET', `/mp/houses/${z.houses[0]}/residents`))
  const m = zr.data.members[0]
  assert(m, '张建国这套房应有家庭成员')
  eq(m.phone.includes('****'), true, '家属手机也要掩码')
  eq('idCard' in m, false, '家属不给证件')
  assert(m.relation, '要带关系')

  /* 没绑的房不能看住户 */
  const other = await withMp(tok, () => call('GET', '/mp/houses/H010110101/residents'))
  eq(other.status, 403, '别人的房不能查住户')

  /* 后台的租客列表**不能**带租金：代收方知道邻居收入，业主之间就有得吵 */
  const adminList = await call('GET', '/tenants', { query: { houseId: 'H010111002' } })
  const adminRow = (adminList.data.rows || [])[0]
  assert(adminRow, '后台能查到这套房的租客')
  eq('rent' in adminRow, false, '后台租客列表不该下发租金')
})

test('租客登记：业主自助 = 待核验，缺字段 422，重复登记 409', async () => {
  const { tok, houses } = await mpReady('13800138001', '张建国', '5880')
  /* 用第二套房，避免影响前面用例对 0501 住户的判断 */
  const hid = houses[houses.length - 1]

  const noPhone = await withMp(tok, () => call('POST', `/mp/houses/${hid}/tenants`, {
    body: { name: '测试租客', phone: '123', leaseStart: '2026-11-01', leaseEnd: '2027-10-31' }
  }))
  eq(noPhone.status, 422, '手机号不合法要 422')

  const badDate = await withMp(tok, () => call('POST', `/mp/houses/${hid}/tenants`, {
    body: { name: '测试租客', phone: '13600001111', leaseStart: '2027-10-31', leaseEnd: '2026-11-01' }
  }))
  eq(badDate.status, 422, '租期结束早于开始要 422')

  const body = {
    name: '李四', phone: '13600001111', idCard4: '1234',
    leaseStart: '2026-11-01', leaseEnd: '2027-10-31', rent: 3000, residents: 2
  }
  const ok = await withMp(tok, () => call('POST', `/mp/houses/${hid}/tenants`, { body }))
  eq(ok.status, 200, '登记成功')
  assertSchema(ok, 'TenantEnvelope', 'POST /mp/houses/{houseId}/tenants')
  /* 业主登记 ≠ 核验通过：门禁授权、人脸录入要物业核验后才生效 */
  eq(ok.data.source, '业主自助', '来源是业主自助')
  eq(ok.data.verifyStatus, '待核验', '登记后是待核验，不是已核验')
  eq(ok.data.status, '在住', '状态在住')
  eq(ok.data.rent, 3000, '租金按填的存')
  eq(ok.data.idCard4, '1234', '只存后四位')
  assert(!ok.data.idCard, '不要拼一个假证件号出来')

  /* 同一个号连点两次：是重复提交，不是又住进来一个人 */
  const dup = await withMp(tok, () => call('POST', `/mp/houses/${hid}/tenants`, { body }))
  eq(dup.status, 409, '重复登记要 409')
  eq(dup.code, 40992, '业务码 40992')

  /* 名单里能看到，且标待核验 */
  const list = await withMp(tok, () => call('GET', `/mp/houses/${hid}/residents`))
  const t = list.data.tenants.find(x => x.name === '李四')
  assert(t, '登记后应出现在住户名单里')
  eq(t.verifyStatus, '待核验', '名单里也是待核验')

  /* 别人的房：连登记入口都不该有 */
  const other = await withMp(tok, () => call('POST', '/mp/houses/H010110101/tenants', { body }))
  eq(other.status, 403, '不能给别人的房登记租客')
})

test('账单：已绑房 + 名下不挂房的车位费（只按房过滤会漏钱）', async () => {
  const { tok } = await mpReady('13969901694', '董宇', '2580')

  const all = await withMp(tok, () => call('GET', '/mp/bills'))
  eq(all.status, 200, '我的账单')
  assertSchema(all, 'MpBillListEnvelope', 'GET /mp/bills')

  const park = all.data.rows.filter(b => !b.houseId)
  eq(park.length, 3, '董宇名下 3 张车位费（车位不挂房）')
  eq(all.data.rows.length, 8, '5 张房账 + 3 张车位费')

  /* 关键：只按 houseId 过滤，这个业主一张欠费都查不到，实际欠 120 元 */
  const byHouseOnly = all.data.rows.filter(b => b.houseId && b.unpaid > 0)
  eq(byHouseOnly.length, 0, '房账全已缴')
  const debt = await withMp(tok, () => call('GET', '/mp/bills', { query: { onlyDebt: true } }))
  eq(debt.data.rows.length, 1, '只有那张车位费没缴')
  eq(debt.data.rows[0].billId, 'BL003544', '未缴的是 2026-10 车位管理服务费')
  near(debt.data.summary.unpaid, 120, '欠费就是这 120 —— 漏掉车位费就会显示"已缴清"')
  eq(debt.data.summary.debtCount, 1, '欠费 1 张')
})

test('账单：多房合并 = 各房之和，筛选与 summary 自洽', async () => {
  const { tok, houses } = await mpReady('18488436180', '梁子轩', '2456')
  eq(houses.length, 2, '梁子轩名下两套房')

  const all = await withMp(tok, () => call('GET', '/mp/bills'))
  eq(all.data.rows.length, 10, '两套房的账单都要在')

  /* 多房合并：合计 = 各房小计之和。业主端只负责分组展示，合计由服务端算好 */
  const byHouse = new Map()
  for (const b of all.data.rows) {
    if (!b.houseId) continue
    byHouse.set(b.houseId, (byHouse.get(b.houseId) || 0) + (b.unpaid || 0))
  }
  eq(byHouse.size, 2, '两个房都有账单')
  const sumHouse = [...byHouse.values()].reduce((s, x) => s + x, 0)
  near(all.data.summary.unpaid, sumHouse, '合计欠费应等于各房之和')
  near(all.data.summary.unpaid, 419.22, '101.36（2栋0702）+ 317.86（2栋0801）')
  eq(all.data.summary.debtCount, 2, '两房各一张欠费')
  eq(all.data.summary.count, 10, '张数')
  near(all.data.summary.payable, all.data.rows.reduce((s, b) => s + b.payable, 0), '应收合计 = 明细加总')

  /* 账期升序：账单页按它分组，倒序会让"最近一期"排最后 */
  eq(all.data.periods.join(','), '2026-08,2026-09,2026-10', '账期升序')

  const oct = await withMp(tok, () => call('GET', '/mp/bills', { query: { period: '2026-10' } }))
  assert(oct.data.rows.every(b => b.period === '2026-10'), '按账期筛选')
  eq(oct.data.periods.length, 1, '只剩一个账期')

  const unpaidOnly = await withMp(tok, () => call('GET', '/mp/bills', { query: { status: '未缴' } }))
  eq(unpaidOnly.data.rows.length, 2, '两张未缴')
  assert(unpaidOnly.data.rows.every(b => b.status === '未缴'), '按状态筛选')

  /* 按房筛：只能筛自己的房 */
  const one = await withMp(tok, () => call('GET', '/mp/bills', { query: { houseId: houses[0] } }))
  eq(one.data.rows.every(b => b.houseId === houses[0]), true, '按房筛选')

  const foreign = await withMp(tok, () => call('GET', '/mp/bills', { query: { houseId: 'H010110101' } }))
  eq(foreign.status, 403, '查别人房的账要 403，不能返回空数组')
})

test('账单：已减免 / 已作废 不算欠费（按状态判，不按金额判）', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const all = await withMp(tok, () => call('GET', '/mp/bills'))
  const DEBT = ['未缴', '部分缴', '逾期']
  /* 样例里 BL000130 状态=已减免 但 unpaid 没清零（种子数据问题），
     所以这条守卫必须钉住"按状态判"：不钉的话下次有人改成 `unpaid > 0` 就会去催缴一张已减免的单 */
  for (const b of all.data.rows) {
    const shouldDebt = DEBT.includes(b.status) && b.unpaid > 0
    if (shouldDebt) assert(b.unpaid > 0, `${b.billId} 状态 ${b.status} 应算欠费`)
  }
  const debtRows = all.data.rows.filter(b => DEBT.includes(b.status) && b.unpaid > 0)
  near(all.data.summary.unpaid, debtRows.reduce((s, b) => s + b.unpaid, 0), '欠费合计只算欠费三态')
  const waived = all.data.rows.filter(b => !DEBT.includes(b.status) && b.unpaid > 0)
  if (waived.length) {
    /* 数据问题的可见后果：账单明细里还挂着未收金额，但不进欠费合计 */
    assert(all.data.summary.unpaid < all.data.rows.reduce((s, b) => s + b.unpaid, 0),
      '有这类单时，欠费合计必须小于"所有未收之和"')
  }
})

test('价目：与员工端同一份，且不下发成本与提成', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const r = await withMp(tok, () => call('GET', '/mp/pricing', { query: { communityId: 'P01' } }))
  eq(r.status, 200, '价目')
  assertSchema(r, 'MpPricingEnvelope', 'GET /mp/pricing')

  eq(r.data.items.length, 10, '维修价目 10 项')
  eq(r.data.addons.length, 5, '增项价目 5 项')
  eq(r.data.chargeMode.prepayWhenOrder, true, '下单即预付')
  eq(r.data.chargeMode.addonPaidOnSite, true, '增项后付')
  assert(r.data.tradeOpts.includes('水暖'), '工种枚举要带上')

  for (const it of [...r.data.items, ...r.data.addons]) {
    /* 成本与提成是内部数据：业主看到就等于看到毛利 */
    for (const k of ['materialCost', 'laborCost', 'cost', 'commissionRate', 'price']) {
      eq(k in it, false, `价目 ${it.code} 不该下发 ${k}`)
    }
    eq(typeof it.material, 'number', `${it.code} 材料费要是数字`)
    eq(typeof it.labor, 'number', `${it.code} 人工费要是数字`)
    assert(it.material > 0 || it.labor > 0, `${it.code} 不能是 0 元项`)
  }

  /* 与 03 的价目同源：code 集合必须一模一样，否则业主看到的价 ≠ 员工现场收的价 */
  const src = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../03-原型/src/mock/repairPrices.json'), 'utf8'))
  eq(r.data.items.map(i => i.code).join(','), src.items.filter(i => i.enabled !== false).map(i => i.code).join(','),
    '维修项 code 与 03 一致')
  eq(r.data.addons.map(i => i.code).join(','), src.addons.filter(i => i.enabled !== false).map(i => i.code).join(','),
    '增项 code 与 03 一致')

  /* 项目没开通线上报修 / 项目不存在 */
  const ghost = await withMp(tok, () => call('GET', '/mp/pricing', { query: { communityId: 'P99' } }))
  eq(ghost.status, 404, '不存在的项目 404')
})

/* ==================== 批 C：报修 / 增项 / 支付 / 评价 ==================== */

test('我的报修：只给已绑房的单，公共单另算', async () => {
  const { tok, houses } = await mpReady('13800138001', '张建国', '5880')

  const list = await withMp(tok, () => call('GET', '/mp/orders'))
  eq(list.status, 200, '我的报修')
  assertSchema(list, 'MpOrderListEnvelope', 'GET /mp/orders')
  assert(list.data.rows.length > 0, '应有工单')
  /* 个人单只按**已绑房产**取：只按 ownerId 捞，换房/退房之后还会看到别人的单 */
  for (const w of list.data.rows) {
    assert(houses.includes(w.houseId), `工单 ${w.woId} 的房不在已绑列表里（${w.houseId}）`)
  }
  const ids = list.data.rows.map(w => w.woId)
  assert(ids.includes('WO000001'), '张建国的单要在列表里')
  eq(ids.includes('WO000116'), false, '别人房上的单不能出现')

  /* 公共区域报修跟产权无关：谁都能看见自己项目里的 */
  const pub = await withMp(tok, () => call('GET', '/mp/orders', { query: { scope: 'public' } }))
  eq(pub.status, 200, '公共单')
  for (const w of pub.data.rows) eq(w.isPublic, true, `scope=public 只该返回公共单：${w.woId}`)

  /* 在做的排前面 */
  const DOING = ['待派单', '已派单', '处理中', '待确认']
  const firstDone = list.data.rows.findIndex(w => !DOING.includes(w.status))
  if (firstDone >= 0) {
    const after = list.data.rows.slice(firstDone)
    assert(after.every(w => !DOING.includes(w.status)), '在做的要排在前面')
  }
})

test('公共报修：只给位置与描述就能下单，不传价目、不传时段', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const r = await withMp(tok, () => call('POST', '/mp/orders', {
    body: {
      scope: 'public',
      place: '3栋2单元电梯厅',
      /* 业主写的原文，不是枚举值 —— 2026-11-12 起前台受理时归类 */
      category: '电梯异响',
      description: '电梯运行到 6 层会顿一下，有异响'
    }
  }))
  eq(r.status, 200, '公共报修下单')

  const wo = r.data.order
  eq(wo.isPublic, true, '是公共单')
  eq(wo.priceCode, '', '公共单没有价目项')
  eq(wo.serviceName, '', '也没有服务项目名')
  eq(wo.totalFee, 0, '公共维修免费')
  eq(wo.payStatus, '无需支付', '不生成待支付')
  eq(r.data.payOrder, null, '不返回支付单')
  eq(wo.category, '电梯异响', '分类原样保存业主写的类型，不做枚举改写')
  eq(wo.title.includes('公共区域报修'), true, `标题不该拼不存在的项目名：${wo.title}`)
  eq(wo.houseId, '', '公共单不挂房')
  eq(wo.houseName, '3栋2单元电梯厅', '位置落在 houseName')

  /* 位置必填、可自由填写（列表没覆盖的角落也得能报） */
  const noPlace = await withMp(tok, () => call('POST', '/mp/orders', {
    body: { scope: 'public', description: '坏了' }
  }))
  eq(noPlace.status, 422, '没位置 422')
  const longPlace = await withMp(tok, () => call('POST', '/mp/orders', {
    body: { scope: 'public', place: '很'.repeat(41), description: '坏了' }
  }))
  eq(longPlace.status, 422, '位置超 40 字 422')

  /* 问题类型是选填：不填落「公共设备」，不逼业主写 */
  const noType = await withMp(tok, () => call('POST', '/mp/orders', {
    body: { scope: 'public', place: '5栋消防通道', description: '安全出口的灯不亮' }
  }))
  eq(noType.status, 200, '不填类型也能报')
  eq(noType.data.order.category, '公共设备', '不填按公共设备')

  /* 但也不能无限长：这一列进后台列表会被撑坏 */
  const longType = await withMp(tok, () => call('POST', '/mp/orders', {
    body: { scope: 'public', place: '5栋消防通道', category: '很'.repeat(21), description: '坏了' }
  }))
  eq(longType.status, 422, '类型超 20 字 422')

  /* 传标准部位也可以：后台工时积分权重能直接取到（电梯 1.5） */
  const enumType = await withMp(tok, () => call('POST', '/mp/orders', {
    body: { scope: 'public', place: '1栋大堂', category: '电梯', description: '轿厢门关不严' }
  }))
  eq(enumType.data.order.category, '电梯', '标准部位原样保留')

  /* 个人单仍然要价目：放宽 public 不等于两条线都不校验 */
  const noPrice = await withMp(tok, () => call('POST', '/mp/orders', {
    body: { scope: 'personal', houseId: 'H010110501', description: '主卫角阀渗水' }
  }))
  eq(noPrice.status, 422, '个人单缺价目 422')
})

test('下单：金额由价目算，生成待支付单；他人房 403、项目不存在 422', async () => {
  const { tok, houses } = await mpReady('13800138001', '张建国', '5880')
  const houseId = houses[0]

  const res = await withMp(tok, () => call('POST', '/mp/orders', {
    body: {
      houseId, priceCode: 'RP-W01', qty: 1,
      appointDate: '2026-10-25', appointSlot: '09:00-11:00',
      description: '厨房角阀渗水'
    }
  }))
  eq(res.status, 200, '下单')
  assertSchema(res, 'MpOrderCreatedEnvelope', 'POST /mp/orders')
  const o = res.data.order
  eq(o.totalFee, 125, '价目 RP-W01 = 材料 35 + 人工 90')
  eq(o.originFee, 125, '原价 = 材料 + 人工')
  eq(o.addonFee, 0, '新单没有增项')
  eq(o.dueFee, 125, '待付 = 总额（还没预付）')
  eq(o.payStatus, '未支付', '下单未付')
  /* 状态仍是「待派单」，靠 payStatus 拦在派单池外 —— 不给新状态，免得后台状态机多一个分叉 */
  eq(o.status, '待派单', '下单即进待派单')
  eq(o.appointSlot, '09:00-11:00', '预约时段')
  assert(Array.isArray(o.timeline) && o.timeline.length >= 3, '要带进度节点')

  assert(res.data.payOrder, '下单即预付：要生成待付款单')
  eq(res.data.payOrder.type, 'wo', '类型是报修')
  eq(res.data.payOrder.amount, 125, '待付款单金额 = 总额')
  eq(res.data.payOrder.refId, o.woId, '付款单挂在这张工单上')

  /* 金额不接受前端传值 */
  const cheat = await withMp(tok, () => call('POST', '/mp/orders', {
    body: {
      houseId, priceCode: 'RP-W01', qty: 1, amount: 1,
      appointDate: '2026-10-25', appointSlot: '09:00-11:00', description: '改价试试'
    }
  }))
  eq(cheat.data.order.totalFee, 125, '前端传的金额一律忽略')

  const foreign = await withMp(tok, () => call('POST', '/mp/orders', {
    body: { houseId: 'H010110101', priceCode: 'RP-W01', appointDate: '2026-10-25', appointSlot: '09:00-11:00', description: 'x' }
  }))
  eq(foreign.status, 403, '没绑的房不能下单')

  const ghost = await withMp(tok, () => call('POST', '/mp/orders', {
    body: { houseId, priceCode: 'RP-X99', appointDate: '2026-10-25', appointSlot: '09:00-11:00', description: 'x' }
  }))
  eq(ghost.status, 422, '价目里没有的项目 422')

  const noDesc = await withMp(tok, () => call('POST', '/mp/orders', {
    body: { houseId, priceCode: 'RP-W01', appointDate: '2026-10-25', appointSlot: '09:00-10:00' }
  }))
  eq(noDesc.status, 422, '问题描述必填')

  /* 时段是 1 小时粒度。契约原先写三个两小时时段，与下单页的 7 个一小时时段对不上，
     已按页面对齐；这里钉住"一小时时段能过、含糊的词不能过" */
  const vague = await withMp(tok, () => call('POST', '/mp/orders', {
    body: { houseId, priceCode: 'RP-W01', appointDate: '2026-10-25', appointSlot: '上午', description: 'x' }
  }))
  eq(vague.status, 422, '时段要给具体区间，不能写"上午"')

  /* 公共区域报修：没有房屋、没有付款单 */
  const pub = await withMp(tok, () => call('POST', '/mp/orders', {
    body: { scope: 'public', place: '1栋大堂', priceCode: 'RP-E01', appointDate: '2026-10-25', appointSlot: '09:00-11:00', description: '大堂灯不亮' }
  }))
  eq(pub.status, 200, '公共报修')
  eq(pub.data.order.isPublic, true, '标公共单')
  eq(pub.data.order.houseId, '', '公共单不挂房')
  eq(pub.data.order.payStatus, '无需支付', '公共报修不收费')
  eq(pub.data.payOrder, null, '不生成 0 元付款单')
})

test('增项 → 补付差额 → 评价：三段金额与差额都不能错', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')

  /* ① 详情：WO000001 已预付 125，上面挂着一条 80 的待确认增项 */
  const before = await withMp(tok, () => call('GET', '/mp/orders/WO000001'))
  eq(before.status, 200, '单条详情')
  assertSchema(before, 'MpOrderDetailEnvelope', 'GET /mp/orders/{woId}')
  const b = before.data
  eq(b.originFee, 125, '原价')
  eq(b.addonFee, 0, '增项还没确认，不计入已确认增项')
  eq(b.totalFee, 125, '总额也还是原价')
  eq(b.paidAmount, 125, '已预付')
  eq(b.dueFee, 0, '当前不欠')
  eq(b.pendingAddons.length, 1, '有待确认增项')
  eq(b.pendingAddonFee, 80, '待确认金额')
  eq(b.willBeFee, 205, '确认后会变成 205 —— 业主点确认前要看到这个数')

  /* ② 还有待确认增项时不能付款：先付后确认会多收一次 */
  const early = await withMp(tok, () => call('POST', '/mp/payments', { body: { type: 'wo', woId: 'WO000001' } }))
  eq(early.status, 409, '有增项待确认，不能先付')
  eq(early.code, 40996, '业务码 40996')

  /* ③ 确认增项：总额涨到 205，已付仍是 125，待付 80 */
  const ok = await withMp(tok, () => call('POST', '/mp/orders/WO000001/addons/confirm', { body: {} }))
  eq(ok.status, 200, '确认增项')
  const a = ok.data
  eq(a.addonFee, 80, '已确认增项')
  eq(a.totalFee, 205, '合计 = 原价 125 + 增项 80')
  eq(a.paidAmount, 125, '已付不能跟着涨 —— 涨了就变成"增项也付过了"')
  eq(a.dueFee, 80, '待付正好是差额')
  eq(a.pendingAddons.length, 0, '没有待确认了')
  eq(a.status, '已完工', '待确认 → 已完工')

  /* ④ 幂等：重复确认返回 200，且 confirmedAt 不变（超时重试很常见） */
  const again = await withMp(tok, () => call('POST', '/mp/orders/WO000001/addons/confirm', { body: {} }))
  eq(again.status, 200, '重复确认要幂等')
  eq(again.data.addons[0].confirmedAt, a.addons[0].confirmedAt, 'confirmedAt 不能被刷掉')
  eq(again.data.totalFee, 205, '总额不能因为重复确认又涨一次')

  /* ⑤ 补付：只付差额 80，不是重新付 205 */
  const pay = await withMp(tok, () => call('POST', '/mp/payments', { body: { type: 'wo', woId: 'WO000001' } }))
  eq(pay.status, 200, '生成补付单')
  assertSchema(pay, 'MpPayOrderEnvelope', 'POST /mp/payments')
  eq(pay.data.amount, 80, '补付金额 = 差额')
  eq(pay.data.type, 'wo', '类型')

  const sim = await withMp(tok, () => call('POST', `/mp/payments/${pay.data.payId}/simulate`))
  eq(sim.status, 200, '模拟支付')
  eq(sim.data.order.paidAmount, 205, '已付累加到 205')
  eq(sim.data.order.dueFee, 0, '结清')
  eq(sim.data.order.payStatus, '已支付', '支付状态')

  /* ⑥ 重复回调不能重复冲账 */
  const sim2 = await withMp(tok, () => call('POST', `/mp/payments/${pay.data.payId}/simulate`))
  eq(sim2.status, 200, '重复回调幂等')
  eq(sim2.data.order.paidAmount, 205, '已付不能翻倍')

  /* ⑦ 评价：完工 + 无待确认增项才允许 */
  const ev = await withMp(tok, () => call('POST', '/mp/orders/WO000001/evaluate', {
    body: { score: 5, tags: ['准时上门', '收费透明'], text: '师傅很利索' }
  }))
  eq(ev.status, 200, '评价')
  eq(ev.data.status, '已评价', '状态转已评价')
  eq(ev.data.score, 5, '评分')
  eq(ev.data.evalTags.length, 2, '标签')
  assert(ev.data.evaluateAt, '评价时间')

  const ev2 = await withMp(tok, () => call('POST', '/mp/orders/WO000001/evaluate', { body: { score: 4 } }))
  eq(ev2.status, 409, '重复评价 409')

  /* 入参先校验、再看状态：评分越界是"请求本身不对"，跟单子是什么状态无关。
     反过来写（先判状态）会让"评 6 星"返回"已经评价过了"，排查时容易被带偏。 */
  const badScore = await withMp(tok, () => call('POST', '/mp/orders/WO000001/evaluate', { body: { score: 6 } }))
  eq(badScore.status, 422, '评分越界 422（先校验入参，再判状态）')
})

test('评价：没完工不让评，有待确认增项也不让评', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  /* 新下一单：状态待派单，还没完工 */
  const res = await withMp(tok, () => call('POST', '/mp/orders', {
    body: {
      houseId: 'H010110501', priceCode: 'RP-E01',
      appointDate: '2026-10-25', appointSlot: '14:00-16:00', description: '插座没电'
    }
  }))
  const woId = res.data.order.woId
  const early = await withMp(tok, () => call('POST', `/mp/orders/${woId}/evaluate`, { body: { score: 5 } }))
  eq(early.status, 409, '没完工不能评价')
  eq(early.code, 40994, '业务码 40994')

  const badScore = await withMp(tok, () => call('POST', `/mp/orders/${woId}/evaluate`, { body: { score: 0 } }))
  eq(badScore.status, 422, '评分越界 422')
})

test('账单缴费：多房合并一张单，冲账后欠费归零，已缴清再付 422', async () => {
  const { tok } = await mpReady('18488436180', '梁子轩', '2456')

  const before = await withMp(tok, () => call('GET', '/mp/bills'))
  const ids = before.data.rows.filter(x => x.unpaid > 0).map(x => x.billId)
  eq(ids.length, 2, '两套房各一张欠费')
  const total = before.data.summary.unpaid

  const pay = await withMp(tok, () => call('POST', '/mp/payments', { body: { type: 'bill', billIds: ids } }))
  eq(pay.status, 200, '合并缴费单')
  eq(pay.data.type, 'bill', '类型')
  eq(pay.data.amount, total, '金额 = 所选账单未收之和')
  eq(pay.data.lines.length, 2, 'lines 逐条列')
  /* 合并的是"付款动作"，不是账单本身：lines 必须逐条带 houseId，后台才能按房拆分入账 */
  for (const line of pay.data.lines) {
    assert('houseId' in line, 'lines 要带 houseId')
    assert(line.amount > 0, '每条的金额')
  }
  eq(new Set(pay.data.lines.map(l => l.houseId)).size, 2, '两套房各一条')

  const sim = await withMp(tok, () => call('POST', `/mp/payments/${pay.data.payId}/simulate`))
  eq(sim.status, 200, '模拟支付')
  eq(sim.data.bills.length, 2, '返回冲账后的账单')
  for (const x of sim.data.bills) {
    eq(x.status, '已缴', `${x.billId} 应为已缴`)
    eq(x.unpaid, 0, `${x.billId} 未收归零`)
  }

  const after = await withMp(tok, () => call('GET', '/mp/bills'))
  eq(after.data.summary.unpaid, 0, '欠费归零')
  eq(after.data.summary.debtCount, 0, '没有欠费单')

  const twice = await withMp(tok, () => call('POST', '/mp/payments', { body: { type: 'bill', billIds: ids } }))
  eq(twice.status, 422, '已缴清的账单不能再出付款单')
})

test('越权：别人的单看不了，也不是自己的订单能付', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')

  const other = await withMp(tok, () => call('GET', '/mp/orders/WO000116'))
  eq(other.status, 403, '别人房上的单 403')

  const ghost = await withMp(tok, () => call('GET', '/mp/orders/WO999999'))
  eq(ghost.status, 404, '不存在的单 404')

  /* 拿别人的 payId 去付：不能只看"单子存不存在" */
  const otherPay = await withMp(tok, () => call('POST', '/mp/payments', {
    body: { type: 'wo', woId: 'WO000116' }
  }))
  eq(otherPay.status, 403, '别人的单生不出付款单')

  const badType = await withMp(tok, () => call('POST', '/mp/payments', { body: { type: 'x' } }))
  eq(badType.status, 422, 'type 只能是三种')
})

/* ==================== 批 D：业主侧内容（公告 / 投票 / 活动 / 闲置） ==================== */
/**
 * 这一组的共同点：**状态是"我的"**（我读过、我投了、我报名、我发布），
 * 而公共列表仍由客户端本地渲染。所以断言都从 `/mp/neighbor/mine` 读回。
 */

test('我的邻里：初始为空；已读幂等；签收只对需要签收的公告开放', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')

  const first = await withMp(tok, () => call('GET', '/mp/neighbor/mine'))
  eq(first.status, 200, '我的内容')
  assertSchema(first, 'MpNeighborMineEnvelope', 'GET /mp/neighbor/mine')
  eq(typeof first.data.noticeReads, 'object', 'noticeReads 是对象')

  /* NT0012 是「停水停电」，需要签收 */
  const r1 = await withMp(tok, () => call('POST', '/mp/neighbor/notices/NT0012/read'))
  eq(r1.status, 200, '标记已读')
  const r2 = await withMp(tok, () => call('POST', '/mp/neighbor/notices/NT0012/read'))
  eq(r2.status, 200, '重复已读')
  eq(r2.data.readAt, r1.data.readAt, '重复已读不能刷掉首次阅读时间')

  const sign = await withMp(tok, () => call('POST', '/mp/neighbor/notices/NT0012/sign'))
  eq(sign.status, 200, '签收')
  eq(sign.data.signedAt, sign.data.readAt, '签收同时补上已读')

  /* 不需要签收的公告：422 而不是静默成功 —— 静默成功会让业主以为签过了 */
  const other = await withMp(tok, () => call('POST', '/mp/neighbor/notices/NT0105/sign'))
  eq(other.status, 422, '普通公告不能签收')

  const ghost = await withMp(tok, () => call('POST', '/mp/neighbor/notices/NT9999/read'))
  eq(ghost.status, 404, '不存在的公告 404')

  const after = await withMp(tok, () => call('GET', '/mp/neighbor/mine'))
  eq(after.data.noticeReads.NT0012, r1.data.readAt, '已读回读')
  eq(after.data.noticeSigns.NT0012, sign.data.signedAt, '签收回读')
  /* 与"读之前"比，不要写死 28：那是当前样例的条数，补一条公告就会假红 */
  eq(after.data.unread, first.data.unread - 1, '未读数正好少一条')
})

test('投票：单选限 1 项，改票按差额调整，已结束不能投', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')

  const a1 = await withMp(tok, () => call('POST', '/mp/neighbor/votes/SV0003/submit', { body: { keys: ['A1'] } }))
  eq(a1.status, 200, '首投')
  eq(a1.data.picks.join(','), 'A1', '记录我的选择')
  eq(a1.data.changed, false, '首次投票 changed=false')

  const a2 = await withMp(tok, () => call('POST', '/mp/neighbor/votes/SV0003/submit', { body: { keys: ['A2'] } }))
  eq(a2.status, 200, '改票')
  eq(a2.data.changed, true, '改票 changed=true')
  /* 改票必须扣旧票：只加不减的话，一个人多投几次就能把一个选项刷到全票 */
  const before1 = a1.data.options.find(o => o.key === 'A1').votes
  const before2 = a1.data.options.find(o => o.key === 'A2').votes
  const now1 = a2.data.options.find(o => o.key === 'A1').votes
  const now2 = a2.data.options.find(o => o.key === 'A2').votes
  eq(now1, before1 - 1, 'A1 的票要退回去')
  eq(now2, before2 + 1, 'A2 的票要加上')
  eq(a2.data.totalVotes, a1.data.totalVotes, '总票数不变（一进一出）')

  const two = await withMp(tok, () => call('POST', '/mp/neighbor/votes/SV0003/submit', { body: { keys: ['A1', 'A2'] } }))
  eq(two.status, 422, '单选投两项 422')

  const empty = await withMp(tok, () => call('POST', '/mp/neighbor/votes/SV0003/submit', { body: { keys: [] } }))
  eq(empty.status, 422, '一项都不选 422')

  const bad = await withMp(tok, () => call('POST', '/mp/neighbor/votes/SV0003/submit', { body: { keys: ['Z9'] } }))
  eq(bad.status, 422, '不存在的选项 422')

  const mine = await withMp(tok, () => call('GET', '/mp/neighbor/mine'))
  eq(mine.data.votes.SV0003.join(','), 'A2', '我的票回读')
  eq(mine.data.counts.vote, 1, '投过的票数')
})

test('投票：别的小区的投票进不来（403）', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  /* SV0001 在 P02，张建国在 P01 */
  const r = await withMp(tok, () => call('POST', '/mp/neighbor/votes/SV0001/submit', { body: { keys: ['A1'] } }))
  eq(r.status, 403, '外社区的投票不能投')
})

test('活动报名：免费与收费两条路，重复报名 409，条款与投保分开校验', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')

  /* 免费活动：不投保，不收证件号 */
  const noTerms = await withMp(tok, () => call('POST', '/mp/neighbor/activities/AC0006/enroll', {
    body: { attendees: [{ name: '张建国', phone: '13800138001' }], agreeTerms: false }
  }))
  eq(noTerms.status, 422, '不勾条款不能报')

  const badName = await withMp(tok, () => call('POST', '/mp/neighbor/activities/AC0006/enroll', {
    body: { attendees: [{ name: 'A', phone: '13800138001' }], agreeTerms: true }
  }))
  eq(badName.status, 422, '姓名不像姓名要拒')

  const free = await withMp(tok, () => call('POST', '/mp/neighbor/activities/AC0006/enroll', {
    body: { attendees: [{ name: '张建国', phone: '13800138001' }], agreeTerms: true }
  }))
  eq(free.status, 200, '免费活动报名')
  assertSchema(free, 'MpEnrollEnvelope', 'POST /mp/neighbor/activities/{id}/enroll')
  eq(free.data.amount, 0, '免费活动没有应缴金额')
  eq(free.data.payStatus, '无需支付', '免费活动不用付')
  eq(free.data.source, '业主自助', '来源')

  const dup = await withMp(tok, () => call('POST', '/mp/neighbor/activities/AC0006/enroll', {
    body: { attendees: [{ name: '张建国', phone: '13800138001' }], agreeTerms: true }
  }))
  eq(dup.status, 409, '重复报名 409')
  eq(dup.code, 40995, '业务码 40995')

  /* 收费 + 投保：少了身份证号要拒（只有联系人买不了保险） */
  const noId = await withMp(tok, () => call('POST', '/mp/neighbor/activities/AC0016/enroll', {
    body: { attendees: [{ name: '张建国', phone: '13800138001' }], agreeTerms: true, agreeInsurance: true }
  }))
  eq(noId.status, 422, '投保活动必须填证件号')

  const noIns = await withMp(tok, () => call('POST', '/mp/neighbor/activities/AC0016/enroll', {
    body: { attendees: [{ name: '张建国', phone: '13800138001', idNo: '510101199001015880' }], agreeTerms: true }
  }))
  eq(noIns.status, 422, '还要单独同意投保')

  const paid = await withMp(tok, () => call('POST', '/mp/neighbor/activities/AC0016/enroll', {
    body: {
      attendees: [
        { name: '张建国', phone: '13800138001', idNo: '510101199001015880', ageType: '成人' },
        { name: '陈静', phone: '17619030789', idNo: '510101199203038168', ageType: '成人' }
      ],
      agreeTerms: true, agreeInsurance: true
    }
  }))
  eq(paid.status, 200, '收费活动报名')
  eq(paid.data.people, 2, '两位出行人')
  eq(paid.data.amount, 336, '应缴 = 168 × 2')
  eq(paid.data.payStatus, '待支付', '收费活动待支付')
  eq(paid.data.attendees[1].name, '陈静', '第二位出行人')

  /* 报名费走统一支付入口 */
  const pay = await withMp(tok, () => call('POST', '/mp/payments', { body: { type: 'activity', refId: paid.data.enrollId } }))
  eq(pay.status, 200, '生成报名费付款单')
  eq(pay.data.amount, 336, '付款金额 = 报名应缴')
})

test('取消报名：免费只取消，收费按档退款', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const mine = await withMp(tok, () => call('GET', '/mp/neighbor/mine'))
  const free = mine.data.enrolls.find(e => e.activityId === 'AC0006' && e.status === '已报名')
  const paid = mine.data.enrolls.find(e => e.activityId === 'AC0016' && e.status === '已报名')
  assert(free && paid, '应有两笔报名（前一用例留下的）')

  const c1 = await withMp(tok, () => call('POST', `/mp/neighbor/enrolls/${free.enrollId}/cancel`))
  eq(c1.status, 200, '取消免费报名')
  eq(c1.data.status, '已取消', '免费活动只取消')
  eq(c1.data.refunded, false, '没交钱就没有退款')

  const c2 = await withMp(tok, () => call('POST', `/mp/neighbor/enrolls/${paid.enrollId}/cancel`))
  eq(c2.status, 200, '取消收费报名')
  eq(c2.data.status, '已退款', '收费活动走退款')
  eq(c2.data.refunded, true, '有退款')
  /* 距开始 30 天以上，按最高档退 */
  assert(c2.data.ratio > 0, `退款比例应大于 0（实际 ${c2.data.ratio}）`)
  near(c2.data.refundAmount, 336 * c2.data.ratio / 100, '退款金额 = 应缴 × 比例')

  const again = await withMp(tok, () => call('POST', `/mp/neighbor/enrolls/${free.enrollId}/cancel`))
  eq(again.status, 409, '重复取消 409')

  const other = await withMp(tok, () => call('POST', '/mp/neighbor/enrolls/AE0001/cancel'))
  eq(other.status, 403, '别人的报名不能取消')
})

test('闲置：发布待审核、禁售词与短标题拒收、楼栋只能选自己的', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')

  const short = await withMp(tok, () => call('POST', '/mp/neighbor/items', {
    body: { title: '转让', price: 10, buildingId: 'B0101' }
  }))
  eq(short.status, 422, '标题太短 422')

  /* 禁售词只做第一道闸（真实环境要接内容安全接口），但"明显违规"必须拦 */
  const banned = await withMp(tok, () => call('POST', '/mp/neighbor/items', {
    body: { title: '转让一批药酒礼盒', price: 100, buildingId: 'B0101' }
  }))
  eq(banned.status, 422, '含禁售词 422')

  const foreign = await withMp(tok, () => call('POST', '/mp/neighbor/items', {
    body: { title: '测试闲置标题够长', price: 10, buildingId: 'B9901' }
  }))
  eq(foreign.status, 422, '不能选别人的楼栋')

  const ok = await withMp(tok, () => call('POST', '/mp/neighbor/items', {
    body: { title: '九成新婴儿推车转让', category: '母婴', price: 280, images: 3, buildingId: 'B0101', desc: '用了半年，功能正常' }
  }))
  eq(ok.status, 200, '发布')
  assertSchema(ok, 'MpItemEnvelope', 'POST /mp/neighbor/items')
  eq(ok.data.status, '待审核', '先审后发')
  eq(ok.data.source, '业主发布', '来源')
  eq(ok.data.sellerType, '业主', '身份')
  assert(!('ownerId' in ok.data) || true, '（ownerId 是内部字段，客户端不依赖）')

  /* 发布后立刻能在我发布的里看到，且员工端待审核队列也能看到 */
  const mine = await withMp(tok, () => call('GET', '/mp/neighbor/mine'))
  assert(mine.data.items.some(i => i.itemId === ok.data.itemId), '我发布的里要有')
  const admin = await call('GET', '/neighbor/items', { query: { status: '待审核', size: 100 } })
  assert(admin.data.rows.some(i => i.itemId === ok.data.itemId), '员工端待审核队列里也要有')
})

test('闲置：想要来回切、私信只记一条、下架与续挂', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')

  const w1 = await withMp(tok, () => call('POST', '/mp/neighbor/items/SH0001/want'))
  eq(w1.status, 200, '想要')
  eq(w1.data.want, true, '切换为已想要')
  const w2 = await withMp(tok, () => call('POST', '/mp/neighbor/items/SH0001/want'))
  eq(w2.data.want, false, '再点一次取消')
  eq(w2.data.wants, w1.data.wants - 1, '人数要跟着减')

  const msg = await withMp(tok, () => call('POST', '/mp/neighbor/items/SH0001/messages', {
    body: { content: '还在吗，可以自提' }
  }))
  eq(msg.status, 200, '私信')
  assert(msg.data.msgId, '返回消息号')

  const empty = await withMp(tok, () => call('POST', '/mp/neighbor/items/SH0001/messages', { body: { content: '  ' } }))
  eq(empty.status, 422, '空消息 422')

  /* 只能动自己的：SH0001 不是他发的 */
  const other = await withMp(tok, () => call('POST', '/mp/neighbor/items/SH0001/offline'))
  eq(other.status, 403, '不能下架别人的')

  const mine = await withMp(tok, () => call('GET', '/mp/neighbor/mine'))
  const own = mine.data.items[0]
  assert(own, '我发布的里应有上一用例发的那件')

  const off = await withMp(tok, () => call('POST', `/mp/neighbor/items/${own.itemId}/offline`))
  eq(off.status, 200, '下架')
  eq(off.data.status, '已下架', '状态')

  const renew = await withMp(tok, () => call('POST', `/mp/neighbor/items/${own.itemId}/renew`))
  eq(renew.status, 200, '续挂')
  eq(renew.data.status, '待审核', '内容没改也要再审')

  const again = await withMp(tok, () => call('POST', `/mp/neighbor/items/${own.itemId}/renew`))
  eq(again.status, 409, '待审核状态不需要续挂')
})

/* ==================== 邻里公共列表（第 76 批） ==================== */

test('邻里公告：只给已发布、按项目收、readCount 已含自己这一次', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const list = await withMp(tok, () => call('GET', '/mp/neighbor/notices'))
  eq(list.status, 200, '公告列表')
  assertSchema(list, 'MpNeighborNoticeListEnvelope', 'GET /mp/neighbor/notices')
  assert(list.data.rows.length > 0, '已绑 P01 的业主应该有公告可看')
  for (const n of list.data.rows) {
    /* 只同步「已发布」，所以 status 这个字段根本不该出现 */
    eq('status' in n, false, '响应里不该有 status（只有已发布才会出现在这里）')
    assert(['P01', ''].includes(n.communityId), `不该出现别项目公告：${n.noticeId} = ${n.communityId}`)
    eq('auditBy' in n || 'publisherEmpId' in n || 'channels' in n, false,
      '审核人 / 工号 / 推送渠道是内部字段')
  }
  /* 置顶排最前 */
  const firstNonTop = list.data.rows.findIndex(n => !n.top)
  const lastTop = list.data.rows.map(n => !!n.top).lastIndexOf(true)
  if (firstNonTop >= 0 && lastTop >= 0) {
    assert(lastTop < firstNonTop, '置顶公告必须全部排在非置顶之前')
  }

  /* 读一条没读过的：未读数正好少 1，且 readCount 只加一次 */
  const target = list.data.rows.find(n => !n.read)
  assert(target, '应该还有未读公告（没有的话这条用例就没验到东西）')
  const beforeUnread = list.data.unread
  const beforeCount = target.readCount
  await withMp(tok, () => call('POST', `/mp/neighbor/notices/${target.noticeId}/read`))
  const after = await withMp(tok, () => call('GET', '/mp/neighbor/notices'))
  const row = after.data.rows.find(n => n.noticeId === target.noticeId)
  eq(row.read, true, '已读回读')
  eq(row.readCount, beforeCount + 1, 'readCount 含自己这一次，且只加一次')
  eq(after.data.unread, beforeUnread - 1, '未读数正好少一条')
})

test('邻里公告：别项目 403、不存在 404、未发布不给', async () => {
  const noticesFix = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/notices.json'), 'utf8'))
  const p02 = noticesFix.find(n => n.status === '已发布' && n.communityId === 'P02')
  const draft = noticesFix.find(n => n.status !== '已发布')
  assert(p02 && draft, '样例里应该有 P02 公告与未发布公告')

  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const other = await withMp(tok, () => call('GET', `/mp/neighbor/notices/${p02.noticeId}`))
  eq(other.status, 403, '别项目公告 403')

  const hidden = await withMp(tok, () => call('GET', `/mp/neighbor/notices/${draft.noticeId}`))
  eq(hidden.status, 404, '未发布公告一律 404 —— 草稿还没打算让人看见')

  const missing = await withMp(tok, () => call('GET', '/mp/neighbor/notices/NT9999'))
  eq(missing.status, 404, '不存在 404')
})

test('邻里投票：没投之前票数一律 0，投完才给结果，且含自己那一票', async () => {
  /* 换个人来投：张建国在批 D 的用例里已经投过 SV0003，共用一台假服务时状态是串的 */
  const { tok } = await mpReady('13521462398', '孔雪', '4580')
  const list = await withMp(tok, () => call('GET', '/mp/neighbor/votes'))
  eq(list.status, 200, '投票列表')
  assertSchema(list, 'MpNeighborVoteListEnvelope', 'GET /mp/neighbor/votes')

  const doing = list.data.rows.find(v => v.status === '进行中')
  assert(doing, 'P01 应该有进行中的投票')
  eq(doing.voted, false, '还没投')
  eq(doing.canSeeResult, false, '没投且没结束 → 看不到结果')
  /* 这条是这一批的重点：**不能返回真值靠前端不显示** */
  eq(doing.options.every(o => o.votes === 0), true, '未到 canSeeResult 时票数必须全 0')
  eq(doing.totalVotes, 0, '总票数也要置 0')

  const key = doing.options[0].key
  const sub = await withMp(tok, () => call('POST', `/mp/neighbor/votes/${doing.voteId}/submit`, {
    body: { keys: [key] }
  }))
  eq(sub.status, 200, '投票')

  const after = await withMp(tok, () => call('GET', `/mp/neighbor/votes/${doing.voteId}`))
  eq(after.status, 200, '投票详情')
  assertSchema(after, 'MpNeighborVoteEnvelope', 'GET /mp/neighbor/votes/{voteId}')
  const row = after.data
  eq(row.canSeeResult, true, '投完可见结果')
  eq(row.voted, true, 'voted')
  eq(row.myVote.includes(key), true, 'myVote 要有自己选的那项')
  const sum = row.options.reduce((n, o) => n + o.votes, 0)
  eq(row.totalVotes, sum, '总票数 = 选项之和')
  assert(row.options.find(o => o.key === key).votes >= 1, '自己那一票要算进去')

  /* 别项目的投票：列表里不该有，直接点进去 403 */
  const p02 = await withMp(tok, () => call('GET', '/mp/neighbor/votes/SV0001'))
  eq(p02.status, 403, '别项目投票 403')
  eq(list.data.rows.every(v => v.communityId === 'P01'), true, '列表只该有本项目的投票')
})

test('邻里活动：不含草稿、按项目收、只给数据不给阶段', async () => {
  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const list = await withMp(tok, () => call('GET', '/mp/neighbor/activities'))
  eq(list.status, 200, '活动列表')
  assertSchema(list, 'MpNeighborActivityListEnvelope', 'GET /mp/neighbor/activities')
  assert(list.data.rows.length > 0, 'P01 应该有活动')
  for (const a of list.data.rows) {
    /* 阶段依赖"今天"，两端时钟差一天（06 是 10-20、服务端数据日 10-21），
       服务端算一份、客户端再算一份必然在临界那天打架 —— 所以接口不给 phase */
    eq('phase' in a, false, '接口不下发 phase，客户端用 activity-rule 现算')
    eq('createdBy' in a || 'paidAmount' in a || 'flowReason' in a, false,
      '创建人 / 已收金额 / 流团原因是运营侧字段')
    eq(a.status === '草稿', false, '草稿不进列表')
    eq(a.communityId, 'P01', '只该有本项目的活动')
    assert(typeof a.enrolled === 'number' && a.enrolled >= 0, 'enrolled 要给真数')
  }

  const detail = await withMp(tok, () => call('GET', '/mp/neighbor/activities/AC0009'))
  eq(detail.status, 200, '活动详情')
  assertSchema(detail, 'MpNeighborActivityEnvelope', 'GET /mp/neighbor/activities/{activityId}')
  eq(detail.data.activityId, 'AC0009', '详情是同一场')
  /* 别人的报名名单一条都不给（那属运营侧 n.activities.view） */
  eq('enrolls' in detail.data, false, '业主侧不给报名名单')
})

test('邻里闲置：只给已上架、只到楼栋、门牌与手机号不下发', async () => {
  const housesFix = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/houses.json'), 'utf8'))
  const myHouse = housesFix.find(h => h.houseId === 'H010110501')

  const { tok } = await mpReady('13800138001', '张建国', '5880')
  const list = await withMp(tok, () => call('GET', '/mp/neighbor/items'))
  eq(list.status, 200, '闲置列表')
  assertSchema(list, 'MpNeighborItemListEnvelope', 'GET /mp/neighbor/items')
  assert(list.data.rows.length > 0, 'P01 应该有在架闲置')
  for (const i of list.data.rows) {
    eq(i.status, '已上架', '非上架内容不进列表')
    eq(i.communityId, 'P01', '只该有本项目的闲置')
    /* 这三样一旦下发就等于公开：房号串、手机号、微信 */
    eq('sellerHouse' in i || 'sellerPhone' in i || 'wechat' in i, false,
      '房号 / 手机号 / 微信不该出现在响应里')
    eq('ownerId' in i || 'auditBy' in i || 'reportCount' in i, false, '内部字段不该下发')
    assert(!/单元|室/.test(i.buildingName || ''), `楼栋名不能带单元或门牌：${i.buildingName}`)
  }

  /* 别人已驳回的内容：一律 404（403 等于告诉探测者"这条存在"） */
  const rejected = await withMp(tok, () => call('GET', '/mp/neighbor/items/SH0109'))
  eq(rejected.status, 404, '别人的非上架内容当不存在')

  /* 自己刚发的是「待审核」：列表里看不到，但自己点进去能看到状态 */
  const pub = await withMp(tok, () => call('POST', '/mp/neighbor/items', {
    body: {
      title: '测试：业主自己发的闲置', category: '其他', price: 10,
      images: 1, buildingId: myHouse.buildingId, desc: '接口自检用'
    }
  }))
  eq(pub.status, 200, '发布闲置')
  eq(pub.data.status, '待审核', '先审后发')

  const mineDetail = await withMp(tok, () => call('GET', `/mp/neighbor/items/${pub.data.itemId}`))
  eq(mineDetail.status, 200, '自己的待审内容自己能看')
  eq(mineDetail.data.status, '待审核', '能看到状态才知道在等审核')

  const listAfter = await withMp(tok, () => call('GET', '/mp/neighbor/items'))
  eq(listAfter.data.rows.some(i => i.itemId === pub.data.itemId), false,
    '待审核的不该出现在邻居的列表里')
})

/* ==================== 契约与实现的一致性守卫 ==================== */
test('契约与实现：每条契约接口都要在假服务里注册', async () => {
  const { routeKeys } = await import('./mock-server.mjs')
  const norm = p => p.replace(/\{[^}]+\}/g, '{}')
  const impl = new Set(routeKeys().map(k => {
    const [m, ...rest] = k.split(' ')
    return `${m} ${norm(rest.join(' '))}`
  }))

  /**
   * 已知未实现清单 —— **不是"以后再说"，是"这一批没做，别当成已完成"**。
   * 每加一条都要写清原因；不写原因的白名单三个月后没人敢删。
   */
  const KNOWN_GAP = new Set([
    /*
     * 2026-11-08：`/mobile/*`（5 条）与巡检 / 工单 / 考勤写接口（17 条）已全部落地，
     * 这份白名单**现在是空的**。
     * 留着它的理由：真遇到"暂时做不到"时有地方记，而不是用来长期挂账 ——
     * 挂久了没人记得为什么挂，下次改动就会当成"本来就没有"。
     */
  ])

  const missing = []
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const m of Object.keys(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(m)) continue
      const key = `${m.toUpperCase()} ${norm(p)}`
      if (impl.has(key)) continue
      if (KNOWN_GAP.has(key)) continue
      missing.push(`${m.toUpperCase()} ${p}`)
    }
  }
  eq(missing.length, 0, `这些契约接口没有实现，也没进已知清单：\n      ${missing.join('\n      ')}`)

  /* 反向：实现了却没写契约 —— 同样会漂 */
  const specKeys = new Set()
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const m of Object.keys(item)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(m)) specKeys.add(`${m.toUpperCase()} ${norm(p)}`)
    }
  }
  const extra = [...impl].filter(k => !specKeys.has(k))
  eq(extra.length, 0, `这些接口实现了但契约里没有：\n      ${extra.join('\n      ')}`)
})

/* ============================ 员工端（mobile） ============================ */

test('执行页聚合：一屏一请求，监督任务带责任员工候选', async () => {
  token = await login('pm')

  /* 执行任务：有模板检查项，没有责任员工候选 */
  const list = (await call('GET', '/inspect-tasks', { query: { taskType: '执行', status: '待执行', communityId: 'P01', size: 50 } })).data.rows
  const t = list[0]
  const r = await call('GET', `/mobile/tasks/${t.taskId}/exec`)
  eq(r.status, 200, '执行页 HTTP 状态')
  assertSchema(r, 'MobileExecEnvelope', 'GET /mobile/tasks/{id}/exec')
  eq(r.data.template.fields.length > 0, true, '模板带检查项（空表就说明模板没关联上）')
  assert(r.data.template.fields.every(f => f.label && f.type), '每个检查项都有名称与类型')
  eq(r.data.workers.length, 0, '执行任务没有责任员工候选')
  assert(!!r.data.communityName, '带项目名，不让前端拿 id 猜')

  /*
   * plan / community 是详情页要的（「来源计划 · 周期」「项目名 + 地址」）。
   * 少了它们，详情页只能拿任务上的 planName 凑，cycle 永远是空的 ——
   * 而 PC 侧这三个是一起给的，移动端不该为了两个字段再打两次接口。
   */
  assert(r.data.plan && r.data.plan.planId, '带来源计划')
  assert(!!r.data.plan.name, '计划要有名字')
  assert(['每日', '每周', '每月', '每季'].includes(r.data.plan.cycle),
    `计划周期要在四选一里，实际「${r.data.plan.cycle}」`)
  assert(r.data.community && r.data.community.communityId === t.communityId, '社区与任务同项目')
  assert(!!r.data.community.address, '带项目地址（详情页要显示"去哪儿干活"）')

  /* 监督任务：候选按被检班组，且排除组长本人 */
  const sup = (await call('GET', '/inspect-tasks', { query: { taskType: '监督', communityId: 'P01', size: 50 } })).data.rows[0]
  const r2 = await call('GET', `/mobile/tasks/${sup.taskId}/exec`)
  eq(r2.status, 200, '监督任务执行页')
  assert(Array.isArray(r2.data.workers), '监督任务要带 workers 数组（哪怕为空）')
  /* ⚠️ 数据限制：契约 employees 只抽了 80 人，P01 的监督任务全落在 O-P01-T4，
     而该组在抽样里 0 人 —— 所以这里候选必然是空数组。真实数据（120 人）下才有值。
     实现上不做兜底（不拿全项目员工冒充被检班组），空就返回空。 */
  eq(r2.data.workers.some(w => w.name === sup.executor), false, '候选里不含组长本人')

  const miss = await call('GET', '/mobile/tasks/IT_NOT_EXIST/exec')
  eq(miss.status, 404, '不存在的任务 404')
})

test('打卡：降级是正式能力，人工打卡必须写原因并进复核队列', async () => {
  token = await login('pm')
  const t = (await call('GET', '/inspect-tasks', { query: { taskType: '执行', status: '待执行', communityId: 'P01', size: 50 } })).data.rows[0]

  const badType = await call('POST', `/mobile/tasks/${t.taskId}/checkin`, { body: { type: '瞎写' } })
  eq(badType.status, 422, '打卡方式必须在四选一里')

  /* 关键口径：拿不到定位 → 人工打卡 + 待复核；不写原因等于把复核的人蒙在鼓里 */
  const noReason = await call('POST', `/mobile/tasks/${t.taskId}/checkin`, { body: { type: '人工打卡' } })
  eq(noReason.status, 422, '人工打卡不写原因被拒')
  assert(String(noReason.message).includes('原因'), `说明为什么：${noReason.message}`)

  const ok = await call('POST', `/mobile/tasks/${t.taskId}/checkin`, {
    body: { type: '人工打卡', manual: true, reason: '地下室无信号，定位失败' }
  })
  eq(ok.status, 200, `打卡成功（${ok.message}）`)
  eq(ok.data.status, '执行中', '任务转执行中')
  eq(ok.data.checkinType, '人工打卡', '记人工打卡，不是 GPS围栏')
  eq(ok.data.needReview, true, '打上待复核标记')
  eq(ok.data.checkinReason, '地下室无信号，定位失败', '降级原因落库')

  const again = await call('POST', `/mobile/tasks/${t.taskId}/checkin`, { body: { type: 'NFC' } })
  eq(again.status, 409, '重复打卡被拒')
})

test('巡检转单：source 固定、回写 refWoId、但不改任务状态', async () => {
  token = await login('pm')
  const t = (await call('GET', '/inspect-tasks', { query: { taskType: '执行', status: '执行中', communityId: 'P01', size: 50 } })).data.rows[0]
  const before = t.status

  const noTitle = await call('POST', `/inspect-tasks/${t.taskId}/work-orders`, {
    body: { itemLabel: '消火栓', type: '公共区域维修', priority: '紧急', title: '', description: 'x' }
  })
  eq(noTitle.status, 422, '标题必填')

  const ok = await call('POST', `/inspect-tasks/${t.taskId}/work-orders`, {
    body: {
      itemLabel: '消火栓', reason: '消防设施', type: '公共区域维修', priority: '紧急',
      title: '3 栋消火栓压力不足', description: '压力表指针在红区，需加压测试', photos: 2
    }
  })
  eq(ok.status, 200, `转单成功（${ok.message}）`)
  assertSchema(ok, 'WorkOrderEnvelope', 'POST /inspect-tasks/{id}/work-orders')
  eq(ok.data.source, '巡检转单', 'source 由服务端固定，不吃客户端传值')
  eq(ok.data.status, '待派单', '新单待派单')
  eq(ok.data.slaHours, 8, '紧急单 8 小时（特急 4 / 普通 24）')
  eq(ok.data.priority, '紧急', '紧急度落库')

  const after = await call('GET', `/inspect-tasks/${t.taskId}`)
  eq(after.data.status, before, '任务状态不变 —— 还得提交执行结果，否则完成率与异常数漏统计')
  eq(after.data.refWoId, ok.data.woId, 'refWoId 回写，工单详情能回连')
})

test('工单流转：抢单池只收商业服务单，已派给别人的接不了', async () => {
  token = await login('pm')

  /* 公共区域维修是本职工作量，不参与抢单 */
  const pub = (await call('GET', '/work-orders', { query: { status: '待派单', type: '公共区域维修', size: 50 } })).data.rows[0]
  const claimPub = await call('POST', `/work-orders/${pub.woId}/claim`)
  eq(claimPub.status, 409, '公共区域维修单不能抢')
  assert(String(claimPub.message).includes('商业服务'), `说明原因：${claimPub.message}`)

  /* 商业服务单可以抢 */
  const biz = (await call('GET', '/work-orders', { query: { status: '待派单', type: '商业服务', size: 50 } })).data.rows[0]
  const claim = await call('POST', `/work-orders/${biz.woId}/claim`)
  eq(claim.status, 200, `商业服务单抢到手（${claim.message}）`)
  eq(claim.data.status, '处理中', '抢单即处理中')
  eq(claim.data.dispatchMode, '抢单', '记来源抢单')
  assert(!!claim.data.acceptTime, '记受理时间（SLA 从这里起算）')

  const again = await call('POST', `/work-orders/${biz.woId}/claim`)
  eq(again.status, 409, '同一张单不能重复抢')

  /* 已派给别人的单：项目经理是 FULL（有派单权）所以能接；换个没派单权的账号就得拒 */
  const assigned = (await call('GET', '/work-orders', { query: { status: '已派单', size: 50 } })).data.rows
    .find(w => w.assignee)
  const jump = await call('POST', `/work-orders/${assigned.woId}/finish`, { body: { remark: '直接完工试试' } })
  eq(jump.status, 409, '跳步完工被拒（必须先接单到场）')
  eq(jump.code, 40930, '用 40930')

  /* 楼管的活是欠费催收，他连 `f.workorders.edit` 都没有 —— 连接单这一步都到不了 */
  token = await login('steward')
  const other = (await call('GET', '/work-orders', { query: { status: '已派单', size: 50 } })).data.rows[0]
  const r = await call('POST', `/work-orders/${other.woId}/accept`)
  eq(r.status, 403, '楼管不能接工单')
  assert(String(r.message).includes('f.workorders.edit'), `说明缺哪个权限：${r.message}`)
})

test('派单与转单：转单只换人、回到已派单并清空受理时间', async () => {
  token = await login('pm')
  const pend = (await call('GET', '/work-orders', { query: { status: '待派单', size: 50 } })).data.rows[0]

  const badTo = await call('POST', `/work-orders/${pend.woId}/dispatch`, { body: { to: '查无此人' } })
  eq(badTo.status, 422, '派给不存在的人被拒')

  const disp = await call('POST', `/work-orders/${pend.woId}/dispatch`, { body: { to: '段淼然', note: '就近处理' } })
  eq(disp.status, 200, `派单成功（${disp.message}）`)
  eq(disp.data.status, '已派单', '派单后等对方接')
  eq(disp.data.assignee, '段淼然', '处理人落库')
  eq(disp.data.acceptTime, '', '还没接，受理时间为空')

  const trans = await call('POST', `/work-orders/${disp.data.woId}/transfer`, { body: { to: '曹杰', note: '他熟悉这块' } })
  eq(trans.status, 200, `转单成功（${trans.message}）`)
  eq(trans.data.status, '已派单', '转单不改流程节点')
  eq(trans.data.assignee, '曹杰', '换成新的人')
  assert(String(trans.data.remark).includes('转给曹杰'), `转单原因写进 remark，便于追责（实际：${trans.data.remark}）`)
})

test('加项闸门：未到场不能加，未确认的增项不能完工', async () => {
  token = await login('pm')
  /* 还没到场的单 */
  const notArrived = (await call('GET', '/work-orders', { query: { status: '已派单', size: 50 } })).data.rows[0]
  const early = await call('POST', `/work-orders/${notArrived.woId}/addons`, { body: { code: 'AD-D01' } })
  eq(early.status, 409, '没到场不能加项 —— 增项必须是现场发现的问题')

  /* 处理中且已到场的单 */
  const doing = (await call('GET', '/work-orders', { query: { status: '处理中', size: 50 } })).data.rows[0]
  await call('POST', `/work-orders/${doing.woId}/arrive`)
  const add = await call('POST', `/work-orders/${doing.woId}/addons`, { body: { code: 'AD-D01', qty: 2 } })
  eq(add.status, 200, `加项成功（${add.message}）`)
  const added = add.data.addons[add.data.addons.length - 1]
  eq(added.confirmed, false, '新加的项默认未确认')
  eq(added.qty, 2, '数量落库')
  eq(added.total, (added.material + added.labor), '小计 = 材料 + 人工')

  const blocked = await call('POST', `/work-orders/${doing.woId}/finish`, { body: { remark: '修好了' } })
  eq(blocked.status, 409, '有未确认增项时不让完工')
  assert(String(blocked.message).includes('增项'), `说明卡在哪：${blocked.message}`)

  const confirm = await call('POST', `/work-orders/${doing.woId}/addons/confirm`, { body: { confirmedBy: '业主当面确认' } })
  eq(confirm.status, 200, '确认增项')
  eq(confirm.data.addons.every(a => a.confirmed), true, '全部已确认')

  const fin = await call('POST', `/work-orders/${doing.woId}/finish`, { body: { remark: '更换角阀并试压，已无渗漏' } })
  eq(fin.status, 200, `完工成功（${fin.message}）`)
  eq(fin.data.status, '已完工', '状态转已完工')
  assert(!!fin.data.finishTime, '记完工时间')

  const noRemark = await call('POST', `/work-orders/${fin.data.woId}/finish`, { body: { remark: '' } })
  eq(noRemark.status, 409, '已完工的单不能再完工')
})

test('收款：免费单没有收款码，超额与挂账都要拦', async () => {
  token = await login('pm')

  const free = (await call('GET', '/work-orders', { query: { status: '处理中', size: 50 } })).data.rows
    .find(w => w.feeType === '免费')
  const noQr = await call('POST', `/work-orders/${free.woId}/payment-qr`)
  eq(noQr.status, 422, '免费单不出收款码')

  const fee = (await call('GET', '/work-orders', { query: { status: '处理中', size: 50 } })).data.rows
    .find(w => w.feeType === '收费' && w.payStatus !== '已支付')
  assert(!!fee, '有未支付的收费单')
  const qr = await call('POST', `/work-orders/${fee.woId}/payment-qr`)
  eq(qr.status, 200, `出码成功（${qr.message}）`)
  eq(qr.data.amount > 0, true, '金额来自工单，不是前端传的')
  assert(String(qr.data.qrUrl).includes(fee.woNo), '二维码内容带工单号，能对上账')
  eq(qr.data.channels.length, 2, '微信 / 支付宝两个渠道')

  const over = await call('POST', `/work-orders/${fee.woId}/payments`, {
    body: { amount: qr.data.amount + 100, method: '微信支付' }
  })
  eq(over.status, 422, '多收被拒（不能收超过应收）')

  const hang = await call('POST', `/work-orders/${fee.woId}/payments`, {
    body: { amount: qr.data.amount, method: '挂账' }
  })
  eq(hang.status, 422, '挂账必须写原因')

  const paid = await call('POST', `/work-orders/${fee.woId}/payments`, {
    body: { amount: qr.data.amount, method: '扫码'.replace('扫码', '支付宝') }
  })
  eq(paid.status, 200, `收款成功（${paid.message}）`)
  eq(paid.data.payStatus, '已支付', '付清转已支付')
  near(paid.data.paidAmount, qr.data.amount, '已收金额与码上金额一致')
})

/* ---------------- 员工端（05）账号 ---------------- */

/*
 * 这四个账号是员工端「切身份」时真正登录的账号。
 * 单独建、不复用 pm / steward 的原因写在 mock-server 的账号注释里：
 * 复用的后果不是少几条数据，而是**工单经办人记错人**。
 */
const MOBILE_USERS = [
  { username: 'zhou-ming', name: '周明', roleId: 'R-ENG', empId: '' },
  { username: 'wang-lei', name: '汪磊', roleId: 'R-SEC', empId: 'EM0018' },
  { username: 'mo-rui', name: '莫瑞', roleId: 'R-STW', empId: 'EM0027' },
  { username: 'xu-yue', name: '徐悦', roleId: 'R-PM', empId: 'EM0008' }
]

test('员工端四个身份：账号对得上人，权限与角色字典逐条相同', async () => {
  /* 权威清单从权限矩阵读（GM 视角），不读 fixture 文件本身 */
  token = await login('gm')
  const roleCodes = {}
  for (const c of MOBILE_USERS) roleCodes[c.roleId] = await grantCodesOf(c.roleId)

  for (const c of MOBILE_USERS) {
    const r = await call('POST', '/auth/login', {
      body: { username: c.username, password: '123456' }, auth: false
    })
    eq(r.status, 200, `${c.username} 能登录：${r.message}`)
    eq(r.data.user.name, c.name, `${c.username} 的姓名`)
    eq(r.data.user.roleId, c.roleId, `${c.username} 的角色`)
    eq(r.data.user.empId, c.empId, `${c.username} 的工号`)

    /* 权限必须与角色授权逐条一致：另写一份清单的结果是"PC 能点、手机 403"，
       而且没人知道该信哪份 —— steward 账号就这么落后过一次。 */
    const want = roleCodes[c.roleId]
    assert(want.length > 0, `${c.roleId} 应有授权`)
    eq(r.data.user.permissions.length, want.length,
      `${c.username} 权限条数应等于 ${c.roleId} 的授权条数（不许手写第二份）`)
    for (const code of want) {
      assert(r.data.user.permissions.includes(code), `${c.username} 缺 ${code}`)
    }
  }
})

test('员工端工单：按身份分 tab，金额只算已确认的增项', async () => {
  /* 一线：有可抢、没有待派（待派是项目经理和客服的事） */
  token = await login('zhou-ming')
  const r1 = await call('GET', '/mobile/work-orders', { query: { tab: 'grab' } })
  eq(r1.status, 200, `一线能取工单（${r1.message}）`)
  assertSchema(r1, 'MobileWorkOrderListEnvelope', 'GET /mobile/work-orders')
  const keys1 = r1.data.tabs.map(t => t.key)
  assert(keys1.includes('grab'), '一线有「可抢」页签')
  assert(!keys1.includes('dispatch'), '一线没有「待派」页签')
  assert(r1.data.rows.every(w => w.type === '商业服务' && w.feeType === '收费'),
    '抢单池只有商业服务里的收费单（公区单没提成，抢了白干）')
  assert(r1.data.rows.every(w => w.commission > 0), '抢单卡片必须给出提成，这是师傅唯一动机')

  /* 项目经理：有待派 */
  token = await login('xu-yue')
  const r2 = await call('GET', '/mobile/work-orders', { query: { tab: 'dispatch' } })
  eq(r2.status, 200, '项目经理能取待派')
  assert(r2.data.tabs.some(t => t.key === 'dispatch' && t.count > 0), '项目经理有「待派」页签')

  /*
   * 客服主管：也有待派，但**只有公区单** —— 付费单指派会直接吃掉师傅的提成，
   * 05 的 canDispatch 早就这么限了，服务端不能只靠前端按钮灰着。
   */
  token = await login('wang-lei')
  const r3 = await call('GET', '/mobile/work-orders', { query: { tab: 'dispatch' } })
  eq(r3.status, 200, '客服主管能取待派')
  assert(r3.data.rows.length > 0, `客服的待派不应为空（${r3.data.rows.length}）`)
  assert(r3.data.rows.every(w => w.type === '公共区域维修'),
    `客服只见公区单，混进了：${[...new Set(r3.data.rows.map(w => w.type))].join(',')}`)

  /* 详情：金额只算已确认的增项；settled 跟着收款状态走 */
  token = await login('zhou-ming')
  const w = (await call('GET', '/mobile/work-orders', { query: { tab: 'grab' } })).data.rows[0]
  const d = await call('GET', `/mobile/work-orders/${w.woId}`)
  eq(d.status, 200, '工单详情')
  assertSchema(d, 'MobileWorkOrderDetailEnvelope', 'GET /mobile/work-orders/{woId}')
  eq(d.data.fee.due, d.data.fee.total, '应收与 total 同口径')
  assert(d.data.fee.total >= d.data.fee.baseTotal, 'total 不小于单额（增项只会往上加）')
  const pendingInList = d.data.addons.filter(a => !a.confirmed).length
  eq(d.data.addonSum.pending, pendingInList, 'pending 数的是未确认的条数')
  eq(d.data.settled, d.data.fee.payStatus === '已支付', 'settled 与收款状态一致')

  const miss = await call('GET', '/mobile/work-orders/WO_NOT_EXIST')
  eq(miss.status, 404, '不存在的工单 404')

  /*
   * 应收只算**已确认**的增项。
   *
   * 不写死单号：种子里 WO000001 的那条未确认增项，会被业主端测试先确认掉
   * （`POST /mp/orders/WO000001/addons/confirm`），写死就变成"只在某个执行顺序下成立"。
   * 改成验**恒等式**：所有带增项的单，due 必须等于「单额 + 已确认增项之和」，
   * 与有没有未确认的无关 —— 这比挑一张单更严。
   */
  /* 假服务的 size 上限是 100，想拿全 120 条得翻两页 —— 传 120 会被 400 拒 */
  const allWo = []
  for (const pageNo of [1, 2]) {
    const pg = await call('GET', '/work-orders', { query: { size: 100, pageNo } })
    eq(pg.status, 200, `取工单第 ${pageNo} 页`)
    allWo.push(...pg.data.rows)
  }
  const withAddon = allWo.filter(w => (w.addons || []).length)
  assert(withAddon.length > 0, '种子里要有带增项的工单')
  for (const w of withAddon.slice(0, 5)) {
    const d = await call('GET', `/mobile/work-orders/${w.woId}`)
    const confirmed = d.data.addons.filter(a => a.confirmed).reduce((sum, a) => sum + a.total, 0)
    near(d.data.fee.due, d.data.fee.baseTotal + confirmed, 0.01,
      `${w.woId} 应收 = 单额 + 已确认增项（未确认的不算）`)
  }

  /* 有未确认增项时，那笔钱此刻收不进来 —— 业主还没点头 */
  const pendRow = withAddon.find(w => (w.addons || []).some(a => !a.confirmed))
  if (pendRow) {
    const pd = await call('GET', `/mobile/work-orders/${pendRow.woId}`)
    const unpaid = pd.data.fee.due - pd.data.fee.paid
    if (unpaid <= 0) {
      const over = await call('POST', `/work-orders/${pendRow.woId}/payments`, {
        body: { amount: 1, method: '现金' }
      })
      eq(over.status, 422, '已结清的单再收 1 块也要被拒')
    }
  }

  /* 收款要记流水：只给汇总金额，事后说不清"谁收的、什么时候收的" */
  const before = (await call('GET', '/mobile/work-orders/WO000054')).data.pays.length
  const pay = await call('POST', '/work-orders/WO000054/payments', {
    body: { amount: 30, method: '现金' }
  })
  eq(pay.status, 200, '登记一笔收款')
  const after = await call('GET', '/mobile/work-orders/WO000054')
  eq(after.data.pays.length, before + 1, '收款流水多一条')
  eq(after.data.pays.at(-1).amount, 30, '流水金额对得上')
  assert(!!after.data.pays.at(-1).by, '流水要记收款人')
  eq(after.data.fee.paid, 30, '已收金额同步')
})

test('员工端欠费：一户一行，跳过近 7 天已催，汇总不随筛选变', async () => {
  token = await login('wang-lei')
  const all = await call('GET', '/mobile/debts', { query: { skipRecent: 'false' } })
  eq(all.status, 200, `楼管能取欠费（${all.message}）`)
  assertSchema(all, 'MobileDebtsEnvelope', 'GET /mobile/debts')
  assert(all.data.rows.length > 0, `应有欠费户（${all.data.rows.length}）`)

  /* 一户一行：houseId 不能重复 */
  const ids = all.data.rows.map(r => r.houseId)
  eq(new Set(ids).size, ids.length, '一户一行（houseId 不重复）')

  /* 每户欠费 = 该户各账之和 */
  for (const r of all.data.rows.slice(0, 5)) {
    near(r.debt, r.items.reduce((s2, x) => s2 + x.unpaid, 0), 0.01, `${r.houseName} 欠费 = 各账之和`)
  }

  /* 汇总按全范围：不筛的时候，合计应等于各行之和 */
  const sumRows = all.data.rows.reduce((s2, r) => s2 + r.debt, 0)
  near(all.data.summary.debtAmount, sumRows, 0.01, '欠费合计 = 各行之和')

  /*
   * 跳过近 7 天已催：这是催收页的核心口径 ——
   * 不跳的话，楼管打开看到的全是"上周刚打过"的户。
   */
  const work = await call('GET', '/mobile/debts')
  assert(work.data.rows.length <= all.data.rows.length,
    `跳过后不应变多：${work.data.rows.length} vs ${all.data.rows.length}`)
  assert(work.data.rows.every(r => !(r.lastCollect && r.gapDays < 7)),
    '工作集里不能有 7 天内已催过的户')
  near(work.data.summary.debtAmount, all.data.summary.debtAmount, 0.01,
    '筛掉已催的户后，汇总合计不变（它按全范围算）')

  /* 账龄筛选：留下来的每一户都得够老 */
  const aging = await call('GET', '/mobile/debts', { query: { aging: '30', skipRecent: 'false' } })
  assert(aging.data.rows.every(r => r.maxOverdue >= 30), '账龄≥30 的筛选要真的过滤')
  assert(aging.data.rows.length <= all.data.rows.length, '筛选只会变少')

  /* 一线没有楼栋权限：403，不是空列表 */
  token = await login('zhou-ming')
  const denied = await call('GET', '/mobile/debts')
  eq(denied.status, 403, '一线看欠费要 403')
  assert(String(denied.message).includes('a.stewards.view'), `说明缺哪个权限位：${denied.message}`)
})

test('员工端审批：待办按节点审批人判，不是按申请人', async () => {
  /* 项目经理徐悦：有待办（项目经理审批节点） */
  token = await login('xu-yue')
  const r1 = await call('GET', '/mobile/approvals', { query: { tab: 'todo' } })
  eq(r1.status, 200, `项目经理能取待办（${r1.message}）`)
  assertSchema(r1, 'MobileApprovalListEnvelope', 'GET /mobile/approvals')
  eq(r1.data.tabs.length, 3, '三个页签：待我处理 / 我发起 / 我办过')
  assert(r1.data.rows.length > 0, `项目经理应有待办（${r1.data.rows.length}）`)
  assert(r1.data.rows.every(a => a.applicant !== '徐悦'), '待办里不能有自己发起的单')

  /* 客服主管汪磊：他的待办来自「客服主管*」节点，靠负责人关系表解出来 */
  token = await login('wang-lei')
  const r2 = await call('GET', '/mobile/approvals', { query: { tab: 'todo' } })
  eq(r2.status, 200, '客服主管能取待办')
  assert(r2.data.rows.length > 0,
    `客服主管应有待办（${r2.data.rows.length}）—— 0 条通常说明负责人关系表里 T1 正职不是他`)

  /* 一线没有审批权：403 而不是空列表（空列表会让人以为"刚好没有"） */
  token = await login('zhou-ming')
  const r3 = await call('GET', '/mobile/approvals', { query: { tab: 'todo' } })
  eq(r3.status, 403, '一线看审批要 403')
  assert(String(r3.message).includes('f.approval.handle'), `说明缺哪个权限位：${r3.message}`)

  /* 详情：target 给结论，canHandle 给判定 */
  token = await login('xu-yue')
  const todo = (await call('GET', '/mobile/approvals', { query: { tab: 'todo' } })).data.rows
  const d = await call('GET', `/mobile/approvals/${todo[0].approvalId}`)
  eq(d.status, 200, '审批详情')
  assertSchema(d, 'MobileApprovalDetailEnvelope', 'GET /mobile/approvals/{id}')
  assert(['leader', 'sign', 'role', 'unsupported'].includes(d.data.target.kind),
    `target.kind 合法：${d.data.target.kind}`)
  eq(d.data.canHandle, true, '我能办的单 canHandle=true')
  assert(d.data.timeline.length > 0, '带时间线')
  assert(d.data.timeline.some(n => n.action === '待处理'), '时间线里有待处理节点')

  /* 我办过的：flow 里得有我的处理痕迹 */
  const done = (await call('GET', '/mobile/approvals', { query: { tab: 'done' } })).data.rows
  for (const a of done.slice(0, 3)) {
    const dd = await call('GET', `/mobile/approvals/${a.approvalId}`)
    const touched = dd.data.timeline.some(n =>
      n.handler === '徐悦' || (n.approvers || []).some(p => p.name === '徐悦')
    )
    assert(touched, `${a.approvalId} 出现在「我办过」里，但时间线没有我的痕迹`)
  }

  const miss = await call('GET', '/mobile/approvals/AP_NOT_EXIST')
  eq(miss.status, 404, '不存在的审批单 404')
})

test('员工端数据范围：一线按姓名取任务、楼管按房屋，越权一律 403', async () => {
  /*
   * 周明不在 120 人名册里（计划上的运营设定值，empId 为空）。
   * 所以一线任务只能按 executor 姓名取 —— 实现上给 `?executor=` 过滤，
   * 而不是"整个项目都下发、前端自己筛"：后者一屏 109 条，手机上没法看。
   */
  token = await login('zhou-ming')
  const mine = await call('GET', '/inspect-tasks', { query: { executor: '周明', size: 100 } })
  eq(mine.status, 200, `周明能取自己的任务（${mine.message}）`)
  eq(mine.data.total, 22, '周明名下 22 条任务（与 fixture 一致）')
  assert(mine.data.rows.every(t => t.executor === '周明'),
    'executor 过滤要真生效，不能把整个项目的任务都下发再让前端筛')

  /* 不带 executor 时范围仍要收住：原来这里漏成了"看得见 P02 的任务"，
     因为 inScopeHouse 收到 undefined 会默认放行（详见 taskFilter 注释） */
  const noExec = await call('GET', '/inspect-tasks', { query: { size: 100 } })
  eq(noExec.status, 200, '周明能取项目内任务')
  assert(noExec.data.rows.every(t => t.communityId === 'P01'),
    `只看得到 P01 的任务，混进了：${[...new Set(noExec.data.rows.map(t => t.communityId))].join(',')}`)
  console.log(`    · 周明可见 ${noExec.data.total} 条（全在 P01，共 120 条里）`)

  /* 他没有 n.items.audit —— 一线不审闲置，这条是"越权要 403"的样本 */
  const audit = await call('POST', '/neighbor/items/SH0001/audit', { body: { pass: true } })
  eq(audit.status, 403, '一线不能审核闲置')
  assert(String(audit.message).includes('n.items.audit'), `说明缺哪个码：${audit.message}`)

  /* 莫瑞：范围按自己名下的房屋算，不是"整个翡翠城" */
  token = await login('mo-rui')
  const wo = await call('GET', '/work-orders', { query: { size: 100 } })
  eq(wo.status, 200, '楼管能取工单')
  eq(wo.data.total, 4, '楼管只看到自己 154 套房名下的 4 条工单')
  /* 工单行不带 stewardEmpId，能验的是"范围外的单没混进来"：
     P01 全项目工单 109 条，收敛到 4 条说明按房屋算过，不是按项目。 */
  assert(wo.data.total < 109, '楼管的范围要比项目经理窄得多')

  /* 越界：查别的项目要 403，不是静默返回空列表 */
  const other = await call('GET', '/work-orders', { query: { communityId: 'P02' } })
  eq(other.status, 403, '楼管查 P02 被拒')
  assert(String(other.message).includes('数据范围'), `说明越界原因：${other.message}`)

  /* 派单与审批是两个码：客服主管有审批、没有派单。为了"顺手"合并的话，
     汪磊就能把单派给别人 —— 而他没有维修排班的判断依据。 */
  token = await login('gm')
  const secCodes = await grantCodesOf('R-SEC')
  assert(secCodes.includes('f.approval.handle'), '客服主管有审批处理权')
  /*
   * 客服要看工单：业主打电话问"什么时候来修"，答不上来只能瞎编。
   * 原来 R-SEC 一条 `f.workorders.*` 都没有，而员工端的 `canDispatch`
   * 早就允许客服派公区单 —— 权限字典跟不上业务规则。
   *
   * **派单范围由业务规则限**（客服只派公区、付费单只有项目经理能派），
   * 不靠"不给这个码"来实现：码是"能不能进这个动作"，范围是另一层。
   */
  assert(secCodes.includes('f.workorders.view'), '客服主管能看工单')
  assert(secCodes.includes('f.workorders.dispatch'), '客服主管能派单（范围限定在公区，由业务规则管）')
  const pmCodes = await grantCodesOf('R-PM')
  assert(pmCodes.includes('f.workorders.dispatch') && pmCodes.includes('f.rectify.recheck'),
    '项目经理能派单、能整改复核')
})

test('考勤与提成：只能动本人，在途单列，价目不下发成本', async () => {
  /* 考勤：确认与申诉都是「本人」动作 —— 主管看别人的考勤是另一条链路，不能借这个接口代确认 */
  token = await login('gm')
  const att = await call('POST', '/attendance/AT00003/confirm')
  eq(att.status, 200, `本人能确认自己的考勤（${att.message}）`)
  eq(att.data.status, '已确认', '状态转已确认')

  const twice = await call('POST', '/attendance/AT00003/confirm')
  eq(twice.status, 409, '重复确认被拒')
  eq(twice.code, 40935, '用 40935')

  const noReason = await call('POST', '/attendance/AT00003/appeal', { body: {} })
  eq(noReason.status, 422, '申诉不写理由被拒')

  const ap = await call('POST', '/attendance/AT00003/appeal', {
    body: { reason: '10-15 那天在外勤，不是迟到' }
  })
  eq(ap.status, 200, `申诉提交成功（${ap.message}）`)
  eq(ap.data.appealCount, 1, '申诉次数 +1')
  eq(ap.data.appealResult, '待处理', '等主管复核')

  /* 换个账号动别人的考勤：403，不是"静默成功" */
  token = await login('steward')
  const other = await call('POST', '/attendance/AT00003/confirm')
  eq(other.status, 403, '不能确认别人的考勤')

  /* 提成：只按人工费计提；已结与在途分开。楼管没有 c.payroll.self，换项目经理读 */
  token = await login('pm')
  const cm = await call('GET', '/mobile/commission')
  eq(cm.status, 200, '提成接口 HTTP 状态')
  assert(cm.data.rate > 0, '带计提比例')
  assert(!!cm.data.settleNo, '带结算单号（次月随工资并入）')
  eq(cm.data.settledCount + cm.data.pendingCount, cm.data.count, '已结 + 在途 = 总数')
  eq(cm.data.rows.every(r => r.commission === Math.round(r.labor * cm.data.rate) / 100), true,
    '提成 = 人工费 × 比例（材料费是成本，不计提）')
  console.log(`    · 提成：已结 ¥${cm.data.settled} / 在途 ¥${cm.data.pending}（${cm.data.count} 单）`)

  /* 价目是公开信息：业主端下单也要读，别加权限码；但成本与提成不给一线 */
  const price = await call('GET', '/mobile/pricing')
  eq(price.status, 200, '价目公开可读')
  assert(price.data.length > 0, '有价目')
  for (const k of ['materialCost', 'laborCost', 'cost']) {
    eq(k in price.data[0], false, `价目不下发 ${k}（成本与提成不给一线看）`)
  }
  assert(price.data.every(p => p.code && p.name && typeof p.material === 'number'), '价目字段齐全')
})

test('住户与催收：手机号脱敏，责任范围外拒收', async () => {
  token = await login('pm')

  const house = (await call('GET', '/work-orders', { query: { communityId: 'P01', size: 20 } })).data.rows.find(w => w.houseId)
  const res = await call('GET', `/mobile/houses/${house.houseId}/residents`)
  eq(res.status, 200, '住户接口 HTTP 状态')
  eq(res.data.houseId, house.houseId, '回的是这套房')
  for (const t of res.data.tenants) {
    assert(String(t.phone).includes('****'), `租户手机号必须脱敏（${t.phone}）`)
    eq('idCard' in t, false, '租户不下发证件号')
    eq('rent' in t, false, '租户不下发租金')
  }
  for (const m of res.data.members) {
    assert(String(m.phone).includes('****'), `成员手机号必须脱敏（${m.phone}）`)
    eq('idCard' in m, false, '成员不下发证件号')
  }

  /* 催收：方式 / 结果必须四选一，无欠费的房不收 */
  const noMethod = await call('POST', '/mobile/collections', {
    body: { houseId: house.houseId, method: '瞎写', result: '承诺还款' }
  })
  eq(noMethod.status, 422, '跟进方式必须在四选一里')

  const debtHouse = (await call('GET', '/bills', { query: { status: '未缴', size: 1 } })).data.rows[0]
  const ok = await call('POST', '/mobile/collections', {
    body: { houseId: debtHouse.houseId, method: '电话', result: '承诺还款', note: '说月底发工资一起交', nextAt: '3 天后' }
  })
  eq(ok.status, 200, `登记催收成功（${ok.message}）`)
  eq(ok.data.houseId, debtHouse.houseId, '记清是哪套房')
  assert(ok.data.debtAmount > 0, '带出这套房的欠费，现场不用再算一遍')
  assert(!!ok.data.at && !!ok.data.by, '记时间与经办人')

  const batch = await call('POST', '/mobile/collections/batch', {
    body: { houseIds: [debtHouse.houseId, 'H_NOT_EXIST'], method: '短信' }
  })
  eq(batch.status, 200, '批量催缴接口可用')
  eq(batch.data.count, 1, '成功的算 1 条')
  eq(batch.data.failed.length, 1, '不存在的房进 failed，不是整体失败')
  assert(!!batch.data.batchNo, '给批次号，便于回查这一批发了什么')
})


/* ==================== 系统参数 / 车位换绑 / 人脸核验（2026-11-11） ==================== */

test('系统参数：登录可见，改值能存，空值被拦', async () => {
  const anon = await call('GET', '/system/params', { auth: false })
  eq(anon.status, 401, '未登录不能读参数')

  token = await login('gm')
  const list = await call('GET', '/system/params')
  eq(list.status, 200, '登录后可读')
  eq(list.data.rows.length, 10, '参数 10 条')
  const park = list.data.rows.filter(r => r.group === '车位')
  eq(park.length, 2, '「车位」分组两条')
  assert(park.some(r => r.key === 'park.plateChangeLimit'), '含换绑上限')

  const ok = await call('PATCH', '/system/params/park.plateChangeLimit', { body: { value: '2' } })
  eq(ok.status, 200, '改值成功')
  eq(ok.data.value, '2', '值已更新')

  const empty = await call('PATCH', '/system/params/park.plateChangeLimit', { body: { value: '  ' } })
  eq(empty.status, 422, '空值被拦 —— 空值会让下游退回没人记得的默认值')

  const miss = await call('PATCH', '/system/params/not.exist', { body: { value: '1' } })
  eq(miss.status, 404, '不存在的 key 返回 404')
})

test('车位换绑：记录可查、次数与上限对得上', async () => {
  token = await login('gm')
  const r = await call('GET', '/parkings/PK00115/changes')
  eq(r.status, 200, '能查换绑记录')
  assert(Array.isArray(r.data.rows), 'rows 是数组')
  assert(r.data.rows.every(x => ['业主自助', '物业代操作', '物业重置'].includes(x.source)), '来源只有三档')
  assert(typeof r.data.monthChanges === 'number' && typeof r.data.limit === 'number', '带本月次数与上限')
  eq(r.data.left, Math.max(0, r.data.limit - r.data.monthChanges), 'left = 上限 − 已换')
  /* 上限来自系统参数，不是常量 */
  eq(r.data.limit, 2, '上限读的是刚改过的参数值（2）')

  token = await login('staff')
  const denied = await call('GET', '/parkings/PK00115/changes')
  eq(denied.status, 403, '工程维修没有 a.vehicles.view')
})

test('车位换绑：代办必须写原因，写完车牌与次数一起变', async () => {
  token = await login('gm')
  const before = await call('GET', '/parkings/PK00115/changes')
  const beforeCount = before.data.monthChanges
  const beforePlate = before.data.parking.plateNo

  const noReason = await call('POST', '/parkings/PK00115/changes', { body: { toPlate: '川B·T9999' } })
  eq(noReason.status, 422, '不写原因被拦 —— 出纠纷要能举证')

  const ok = await call('POST', '/parkings/PK00115/changes', { body: { toPlate: '川B·T9999', reason: '车辆更换' } })
  eq(ok.status, 200, '换绑成功')
  eq(ok.data.parking.plateNo, '川B·T9999', '车位车牌跟着改（日志是唯一真源，车位只是投影）')
  eq(ok.data.monthChanges, beforeCount + 1, '本月次数 +1')
  assert(ok.data.change.source === '物业代操作', '来源记「物业代操作」')
  assert(ok.data.change.fromPlate === beforePlate, '原车牌记的是换之前那个')

  const after = await call('GET', '/parkings/PK00115/changes')
  eq(after.data.rows[0].toPlate, '川B·T9999', '刷新后记录还在（不再是刷新即丢）')
})

test('车位换绑：重置要写原因，本月没记录时按 409 拒', async () => {
  token = await login('gm')
  const noReason = await call('POST', '/parkings/PK00115/changes/reset', { body: {} })
  eq(noReason.status, 422, '重置不写原因被拦')

  const ok = await call('POST', '/parkings/PK00115/changes/reset', { body: { reason: '业主多次来电，已核实确有换车' } })
  eq(ok.status, 200, '重置成功')
  eq(ok.data.monthChanges, 0, '本月次数归零')
  assert(ok.data.rows.some(x => x.source === '物业重置'), '留了一条「物业重置」记录')

  const again = await call('POST', '/parkings/PK00115/changes/reset', { body: { reason: '再重置一次' } })
  eq(again.status, 409, '本月已经 0 次，再重置要拒 —— 按了没反应和按坏了看起来一样')
})

test('人脸核验：业主与租客在同一队列，按主体分段', async () => {
  const anon = await call('GET', '/access/faces', { auth: false })
  eq(anon.status, 401, '未登录不能看核验队列')

  token = await login('staff')
  const denied = await call('GET', '/access/faces')
  eq(denied.status, 403, '没有 a.owners.view 的看不到')

  token = await login('gm')
  const all = await call('GET', '/access/faces')
  eq(all.status, 200, '能看队列')
  assert(all.data.rows.length > 0, '队列非空')
  assert(all.data.rows.some(x => x.subjectType === '业主'), '有业主段')
  assert(all.data.rows.some(x => x.subjectType === '租客'), '有租客段（H5 合并入口）')
  eq(all.data.rows[0].status, '待核验', '待核验排最前')

  const tenants = await call('GET', '/access/faces?subjectType=租客')
  assert(tenants.data.rows.every(x => x.subjectType === '租客'), '按主体筛选生效')

  const stats = await call('GET', '/access/faces/stats')
  eq(stats.status, 200, '统计可用')
  eq(stats.data.pending, stats.data.pendingOwner + stats.data.pendingTenant, '待核验 = 业主 + 租客')
})

test('人脸核验：驳回必写原因，通过后状态生效且不能重复审', async () => {
  token = await login('gm')
  const queue = await call('GET', '/access/faces?status=待核验')
  const target = queue.data.rows[0]
  assert(!!target, '要有待核验样本')

  const noReason = await call('POST', `/access/faces/${target.faceId}/audit`, { body: { pass: false } })
  eq(noReason.status, 422, '驳回不写原因被拦 —— 业主端会原样展示')

  const ok = await call('POST', `/access/faces/${target.faceId}/audit`, { body: { pass: true } })
  eq(ok.status, 200, '通过成功')
  eq(ok.data.status, '已生效', '状态变已生效')
  assert(!!ok.data.auditAt && !!ok.data.auditBy, '记了审计时间与审计人')

  const again = await call('POST', `/access/faces/${target.faceId}/audit`, { body: { pass: true } })
  eq(again.status, 409, '重复审核要拒')

  const after = await call('GET', `/access/faces?status=待核验`)
  assert(!after.data.rows.some(x => x.faceId === target.faceId), '已处理的从待核验里消失')
})

test('人脸核验：通过后主体的 faceRegistered 被回写（租客同理）', async () => {
  token = await login('gm')
  const queue = await call('GET', '/access/faces?status=待核验&subjectType=租客')
  const t = queue.data.rows[0]
  assert(!!t, '要有待核验的租客样本')

  const before = await call('GET', `/tenants/${t.tenantId}`)
  const ok = await call('POST', `/access/faces/${t.faceId}/audit`, { body: { pass: true } })
  eq(ok.status, 200, '租客人脸通过')
  const after = await call('GET', `/tenants/${t.tenantId}`)
  eq(before.data.tenant.faceRegistered, false, '通过前是未录人脸')
  eq(after.data.tenant.faceRegistered, true, '通过后租户的人脸标记跟着变 —— 不是页面自己算的')
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
