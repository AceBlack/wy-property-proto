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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MOCK = path.resolve(__dirname, '../../03-原型/src/mock')
const read = n => JSON.parse(fs.readFileSync(path.join(MOCK, `${n}.json`), 'utf8'))

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
add('老表零改动', '房屋', houses.length, 736)
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
add('金额', '价目 11 项都能算出合计', prices.items.filter(i => r2(i.material + i.labor) > 0).length, 11)
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
