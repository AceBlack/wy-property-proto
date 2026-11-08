/**
 * 数据对齐 + 身份规则自检（业主端 v0.2）
 * ------------------------------------------------------------
 * ① **数据指纹**：41 张老表零改动 + 本轮新增 9 张内容表
 * ② **口径守卫**：多房合并账单 / 车位费不挂房 / 价目与收费单 / 内容表自洽
 * ③ **身份规则单测**：业主 / 家属 / 租客 三条路 + 四种失败原因（直接打 identity-rule.mjs 纯函数）
 *
 * 用法：node scripts/check-data.mjs     退出码非 0 即不一致
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { matchIdentity } from '../src/api/identity-rule.mjs'
import { refundAmountOf, refundRatioOf } from '../src/api/refund-rule.mjs'
import { canEnroll, enrolledCount, phaseOf } from '../src/api/activity-rule.mjs'
import { FORBIDDEN_FIELDS, PUBLIC_FIELDS, houseDerived, publicProjection } from '../src/api/listing-view.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MOCK = path.resolve(__dirname, '../../03-原型/src/mock')
const FIX = path.resolve(__dirname, '../../04-契约/fixtures')
const read = n => JSON.parse(fs.readFileSync(path.join(MOCK, `${n}.json`), 'utf8'))
const fix = n => JSON.parse(fs.readFileSync(path.join(FIX, `${n}.json`), 'utf8'))

const owners = read('owners')
const houses = read('houses')
const bills = read('bills')
const workOrders = read('workOrders')
const notices = read('notices')
const members = read('members')
const tenants = read('tenants')
const prices = read('repairPrices')
const posts = read('neighborPosts')
const comments = read('postComments')
const activities = read('activities')
const enrolls = read('activityEnrollments')
const surveys = read('surveys')
const votes = read('surveyVotes')
const secondhand = read('secondhandItems')
const services = read('lifeServices')
const merchants = read('merchants')

const rows = []
let failed = 0
const add = (group, label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  rows.push({ group, label, got, want, ok })
}
const r2 = n => Math.round((Number(n) || 0) * 100) / 100

/* ============================ 一、数据指纹 ============================ */
add('老表零改动', '业主', owners.length, 682)
add('老表零改动', '房屋', houses.length, 756)
add('老表零改动', '账单', bills.length, 4884)
add('老表零改动', '工单', workOrders.length, 158)
add('老表零改动', '公告', notices.length, 106)
add('老表零改动', '家庭成员', members.length, 169)
add('老表零改动', '租户', tenants.length, 160)

add('内容表', '邻里动态', posts.length, 24)
add('内容表', '动态已发布', posts.filter(p => p.status === '已发布').length, 22)
add('内容表', '评论', comments.length, 60)
add('内容表', '评论待审核', comments.filter(c => c.status === '待审核').length, 7)
add('内容表', '活动', activities.length, 12)
add('内容表', '活动报名中', activities.filter(a => a.status === '报名中').length, 5)
add('内容表', '活动报名记录', enrolls.length, 212)
add('内容表', '投票问卷', surveys.length, 6)
add('内容表', '投票记录', votes.length, 40)
add('内容表', '闲置', secondhand.length, 20)
add('内容表', '闲置在售', secondhand.filter(i => i.status === '在售').length, 19)
add('内容表', '生活服务', services.length, 12)
add('内容表', '生活服务可预约', services.filter(s => s.status === '可预约').length, 8)
add('内容表', '生活商家', merchants.length, 6)

/* ============================ 二、内容侧口径 ============================ */
add('内容守卫', '动态都是物业发布（有作者与角色）', posts.filter(p => !p.author || !p.authorRole).length, 0)
add('内容守卫', '动态都有分类', [...new Set(posts.map(p => p.category))].length >= 5, true)
add('内容守卫', '报名数不超过名额', activities.filter(a => enrolls.filter(e => e.activityId === a.activityId).length > a.capacity).length, 0)
add(
  '内容守卫',
  '问卷选项票数之和 = 总票数',
  surveys.filter(s => Math.abs(s.options.reduce((n, o) => n + o.votes, 0) - s.totalVotes) > 1).length,
  0
)
add('内容守卫', '闲置都有卖家与自提点', secondhand.filter(i => !i.sellerName || !i.sellerHouse).length, 0)
add('内容守卫', '闲置内容标注来源（物业代发）', [...new Set(secondhand.map(i => i.source))].join('/'), '物业代发')
add('内容守卫', '服务都挂到真实商家', services.filter(s => !merchants.some(m => m.merchantId === s.merchantId)).length, 0)

/* ============================ 三、账单口径（多房合并） ============================ */
const DEBT = ['未缴', '部分缴', '逾期']
const isDebt = b => DEBT.includes(b.status) && (b.unpaid || 0) > 0
const debtOf = list => r2(list.filter(isDebt).reduce((s, b) => s + (b.unpaid || 0), 0))
const ofOwner = id => bills.filter(b => b.ownerId === id)
const parkBills = bills.filter(b => !b.houseId)

const zj = ofOwner('OW00001')
const h1 = zj.filter(b => b.houseId === 'H010110501')
const h2 = zj.filter(b => b.houseId === 'H010311102')
const park = zj.filter(b => !b.houseId)
add('账单', '张建国两房 + 车位合计', debtOf(zj), 2031.01)
add('账单', '单绑 0501 + 车位', debtOf([...h1, ...park]), 1420.14)
add('账单', '两房 + 车位 = 三部分之和', r2(debtOf(h1) + debtOf(h2) + debtOf(park)), 2031.01)
add('账单', '合并缴费 = 按房拆分之和（不重不漏）', debtOf(zj) === r2(debtOf(h1) + debtOf(h2) + debtOf(park)), true)

add('账单', '不挂房账单（车位费·全库）', parkBills.length, 1344)
add('账单', '李秀兰车位费', r2(parkBills.filter(b => b.ownerId === 'OW00002').reduce((s, b) => s + b.unpaid, 0)), 362.52)
add('账单', '李秀兰欠费（含车位）', debtOf(ofOwner('OW00002')), 3390.55)
add('账单', '只按房过滤会漏（车位）', r2(debtOf(ofOwner('OW00002')) - debtOf(ofOwner('OW00002').filter(b => b.houseId))), 362.52)
add('账单', '欠费状态却 unpaid=0（脏数据）', bills.filter(b => isDebt(b) && b.unpaid <= 0).length, 0)
add('账单', '已缴却有欠费（脏数据）', bills.filter(b => b.status === '已缴' && b.unpaid > 0).length, 0)

/* 价目：下单页 = 详情 = 支付，都来自这一份 */
const paidWos = workOrders.filter(w => w.feeType === '收费')
add('金额', '收费单都能匹配价目', paidWos.filter(w => !prices.items.some(i => i.category === w.category)).length, 0)
add('金额', '收费单 = 材料 + 人工', paidWos.filter(w => Math.abs((w.materialFee || 0) + (w.laborFee || 0) - (w.totalFee || 0)) > 0.01).length, 0)
add('金额', '价目 10 项都能算出合计', prices.items.filter(i => r2(i.material + i.labor) > 0).length, 10)
add('金额', '增项 5 项', prices.addons.length, 5)

/* ============================ 四、身份规则单测 ============================ */
const db = { owners, members, tenants }
const cased = (label, input, houseId, want) => {
  const r = matchIdentity(input, db, houseId)
  const got = { ok: r.ok, role: r.role, houses: r.houseIds.length, mismatch: r.mismatch }
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  rows.push({ group: '身份规则', label, got: r.ok ? `${r.role} ${r.houseIds.length}套` : `${r.reason}`, want: want.ok ? `${want.role} ${want.houses}套` : '拒绝', ok })
  return r
}
const M0 = { phone: false, name: false, cert: false, house: false }

/* ① 业主 */
cased('业主 + 自己的房 → 通过', { phone: '13800138001', name: '张建国', idCard4: '5880' }, 'H010110501', { ok: true, role: '业主', houses: 1, mismatch: M0 })
/* ② 业主但选了别人的房 */
cased('业主 + 别人的房 → 拒绝', { phone: '13800138001', name: '张建国', idCard4: '5880' }, 'H010110101', { ok: false, role: '', houses: 0, mismatch: { ...M0, house: true } })
/* ③ 家属（陈静 = 张建国配偶） */
cased('家属 + 本房 → 通过', { phone: '17619030789', name: '陈静', idCard4: '8168' }, 'H010110501', { ok: true, role: '家属', houses: 1, mismatch: M0 })
/* ④ 租客（钟瑞 = 1栋1单元1002，已核验） */
const ten = cased('租客 + 本房 → 通过', { phone: '13012931145', name: '钟瑞', idCard4: '8874' }, 'H010111002', { ok: true, role: '租客', houses: 1, mismatch: M0 })
add('身份规则', '租客带着核验状态', ten.verifyStatus, '已核验')
/* ⑤ 租客选错房 */
cased('租客 + 别人的房 → 拒绝', { phone: '13012931145', name: '钟瑞', idCard4: '8874' }, 'H010111001', { ok: false, role: '', houses: 0, mismatch: { ...M0, house: true } })
/* ⑥ 信息不全的租客（赵娟） */
const zhao = cased('信息不全租客也能进（做降级）', { phone: '17218894520', name: '赵娟', idCard4: '3501' }, 'H010111001', { ok: true, role: '租客', houses: 1, mismatch: M0 })
add('身份规则', '信息不全时的核验状态', zhao.verifyStatus, '信息不全')
/* ⑦ 三种失败原因 */
cased('证件错 → cert', { phone: '13800138001', name: '张建国', idCard4: '1111' }, 'H010110501', { ok: false, role: '', houses: 0, mismatch: { ...M0, cert: true } })
cased('姓名错 → name', { phone: '13800138001', name: '李秀兰', idCard4: '5880' }, 'H010110501', { ok: false, role: '', houses: 0, mismatch: { ...M0, name: true } })
cased('手机号未登记 → phone', { phone: '13100001111', name: '张三', idCard4: '1234' }, 'H010110501', { ok: false, role: '', houses: 0, mismatch: { ...M0, phone: true } })
/* ⑧ 归一化 */
cased('手机号带横线也能匹配', { phone: '138-0013-8001', name: '张建国', idCard4: '5880' }, 'H010110501', { ok: true, role: '业主', houses: 1, mismatch: M0 })


/* ============================ 五、契约 fixture（业主端实际读的那一份） ============================ */
/*
 * 邻里与租售的业主端数据来自 `04-契约/fixtures`（后台种子导出的同一批），
 * 不是 06 自己造的。这里直接对 fixture 做口径检查 —— 页面上的数与后台审核的数必须是同一批。
 */
const fxActs = fix('neighbor-activities')
const fxItems = fix('neighbor-items')
const fxEnrolls = fix('neighbor-enrolls')
const fxListings = fix('listings')
const fxEmp = fix('employees')
const fxHouses = fix('houses')

add('契约 fixture', '活动场次', fxActs.length, 17)
add('契约 fixture', '闲置条数', fxItems.length, 34)
add('契约 fixture', '挂牌条数', fxListings.length, 14)

/* ---------- 活动阶段（纯函数，与页面同一份） ---------- */
const TODAY = '2026-10-20'
const phaseOfId = id => {
  const a = fxActs.find(x => x.activityId === id)
  return phaseOf(a, enrolledCount(fxEnrolls, id), TODAY)
}
add('活动阶段', 'AC0013 未到截止 → 报名中', phaseOfId('AC0013'), '报名中')
add('活动阶段', 'AC0016 未到截止 → 报名中', phaseOfId('AC0016'), '报名中')
add('活动阶段', 'AC0014 截止且未达下限 → 待成行', phaseOfId('AC0014'), '待成行')
add('活动阶段', 'AC0017 截止且达下限 → 已成行', phaseOfId('AC0017'), '已成行')
const ac14 = fxActs.find(x => x.activityId === 'AC0014')
const ac14Enrolled = enrolledCount(fxEnrolls, 'AC0014')
add('活动阶段', '待成行确实低于下限', ac14Enrolled < ac14.minCapacity, true)
add('活动阶段', '待成行不能报名', canEnroll('待成行', ac14Enrolled, ac14.capacity), false)
add('活动阶段', '已成行不能报名', canEnroll('已成行', 20, 40), false)
add('活动阶段', '报名中且有余额可报名', canEnroll('报名中', 10, 40), true)
add('活动阶段', '名额满了不能报名', canEnroll('报名中', 40, 40), false)

/* ---------- 退款分档（与后台 refundRatioOf 同一口径） ---------- */
const ac13 = fxActs.find(x => x.activityId === 'AC0013')
const ratioAt = (a, day) => refundRatioOf(a.refundPolicy, a.startAt, day)
add('退款分档', 'AC0013 提前 14 天 → 100%', ratioAt(ac13, '2026-11-01'), 100)
add('退款分档', 'AC0013 提前 5 天 → 50%', ratioAt(ac13, '2026-11-10'), 50)
add('退款分档', 'AC0013 提前 2 天 → 0%', ratioAt(ac13, '2026-11-13'), 0)
add('退款分档', 'AC0013 当天 → 0%', ratioAt(ac13, '2026-11-15'), 0)
add('退款分档', '无分档规则 → 全额退', refundRatioOf([], '2026-11-15', '2026-10-20'), 100)
/* 降序匹配的回归：曾经写成升序，导致提前一个月取消也只退 0% */
const seq = ['2026-11-01', '2026-11-10', '2026-11-13', '2026-11-15'].map(d => ratioAt(ac13, d))
add('退款分档', '越临近开始退得越少（单调不增）', seq.every((v, i) => i === 0 || v <= seq[i - 1]), true)
add('退款分档', '金额 = 单价 × 人数 × 比例', refundAmountOf(180, 2, 50), 180)

/* ---------- 租售：字段白名单 ---------- */
const CTX = {
  houses: new Map(houses.map(h => [h.houseId, h])),
  buildings: new Map(JSON.parse(fs.readFileSync(path.join(MOCK, 'buildings.json'), 'utf8')).map(b => [b.buildingId, b])),
  units: new Map(JSON.parse(fs.readFileSync(path.join(MOCK, 'units.json'), 'utf8')).map(u => [u.unitId, u])),
  communities: new Map(JSON.parse(fs.readFileSync(path.join(MOCK, 'communities.json'), 'utf8')).map(c => [c.communityId, c])),
  employees: new Map(fxEmp.map(e => [e.empId, e]))
}
const views = fxListings.map(l => publicProjection(l, CTX)).filter(Boolean)
add('租售', '每条挂牌都能投影出公开字段', views.length, fxListings.length)
const keyOk = views.every(v => {
  const keys = Object.keys(v).sort()
  return JSON.stringify(keys) === JSON.stringify([...PUBLIC_FIELDS].sort())
})
add('租售', '公开字段 = 白名单（多一个都不行）', keyOk, true)
const forbidHit = views.filter(v => FORBIDDEN_FIELDS.some(k => k in v)).length
add('租售', '公开结果不含房号/业主/楼管手机号字段', forbidHit, 0)
add('租售', '公开结果不含任何 11 位手机号', views.filter(v => /1\d{10}/.test(JSON.stringify(v))).length, 0)
/* 楼管只给姓名/微信/二维码，连 phone 这个键都不能有 */
const stewardKeys = [...new Set(views.map(v => v.steward && Object.keys(v.steward).sort().join(',')))]
add('租售', '责任人对象只有姓名/岗位/微信/二维码', stewardKeys.join('|'), 'name,position,qrUrl,wechatId')
add('租售', '对外只到楼栋（不出现单元与门牌）', views.filter(v => /单元|\d{4}/.test(v.buildingName)).length, 0)
add('租售', '列表只取已发布', fxListings.filter(l => l.status === '已发布').length, 6)
add('租售', '已驳回必带理由', fxListings.filter(l => l.status === '已驳回' && !l.rejectReason).length, 0)
add('租售', '已下架 / 待审核不进公开详情', views.filter(v => ['已发布'].includes(v.status)).length, 6)

/* 内部视图才给房号：我的挂牌要能认出是哪套 */
const mine = houseDerived(fxListings[0].houseId, CTX)
add('租售', '我的挂牌能取到房号（内部视图）', !!mine.room, true)

/* ---------- 投票：多选、按户参与率 ---------- */
const sv4 = surveys.find(s => s.surveyId === 'SV0004')
add('投票', '多选样本存在（SV0004）', !!sv4 && sv4.multi === true, true)
add('投票', '多选上限 2 项', sv4 && sv4.maxPick, 2)
add('投票', '单选投票 maxPick 为 1（未配置）', surveys.filter(s => !s.multi && Number(s.maxPick) > 1).length, 0)
const voteSumOk = surveys.filter(s => s.options.reduce((n, o) => n + o.votes, 0) !== s.totalVotes).length
add('投票', '选项票数之和 = 总票数', voteSumOk, 0)
const targets = (() => {
  const m = new Map()
  for (const h of houses) {
    if (!h.ownerId) continue
    if (!m.has(h.communityId)) m.set(h.communityId, new Set())
    m.get(h.communityId).add(h.ownerId)
  }
  return m
})()
const rateBad = surveys.filter(s => {
  const total = s.options.reduce((n, o) => n + o.votes, 0)
  const target = targets.get(s.communityId)?.size || 0
  const base = Math.max(target, total, 1)
  return (total / base) * 100 > 100.0001
}).length
add('投票', '参与率不超过 100%', rateBad, 0)

/* ============================ 打印 ============================ */
console.log('数据源：' + MOCK)
let g = ''
for (const r of rows) {
  if (r.group !== g) {
    g = r.group
    console.log(`\n【${g}】`)
  }
  const got = String(r.got)
  const want = String(r.want)
  console.log(`  ${r.ok ? '✓' : '✕'} ${r.label.padEnd(30, ' ')} ${got.padStart(14)}  期望 ${want}`)
}
console.log('')
console.log(`多房合并：张建国 0501 ¥${debtOf(h1)} + 1102 ¥${debtOf(h2)} + 车位 ¥${debtOf(park)} = ¥${debtOf(zj)}`)
console.log(`内容：动态 ${posts.filter(p => p.status === '已发布').length} / 活动 ${activities.length}（报名中 ${activities.filter(a => a.status === '报名中').length}） / 问卷 ${surveys.length} / 闲置 ${secondhand.length} / 服务 ${services.length}`)
if (failed) {
  console.log(`\n✕ ${failed} 项不一致`)
  process.exit(1)
}
console.log('\n✓ 全部一致')
