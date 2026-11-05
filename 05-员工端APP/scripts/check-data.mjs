/**
 * 数字对齐自检（数据层）
 * ------------------------------------------------------------
 * 两端共用 03-原型/src/mock，这里直接从 JSON 读，不经过框架，算「数据源指纹」。
 * 覆盖：交接单要求比对的 5 个数 + 本轮新增模块（审批 / 工单 / 整改 / 考勤 / 楼栋责任）的基数
 * 与四条口径守卫（防止「我的」按人拆分时漏算、防止归属靠姓名反查）。
 *
 * 用法：node scripts/check-data.mjs   退出码非 0 即不一致
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MOCK = path.resolve(__dirname, '../../03-原型/src/mock')
const read = name => JSON.parse(fs.readFileSync(path.join(MOCK, `${name}.json`), 'utf8'))

const tasks = read('inspectTasks')
const employees = read('employees')
const notices = read('notices')
const templates = read('inspectTemplates')
const orgs = read('orgs')
const approvals = read('approvals')
const workOrders = read('workOrders')
const attendance = read('attendance')
const stewards = read('buildingStewards')
const bills = read('bills')
const qualityChecks = read('qualityChecks')
const tenants = read('tenants')
const members = read('members')
const prices = read('repairPrices')
const houses = read('houses')
const ownerTags = read('ownerTags')
const owners = read('owners')

const EXPECT = [
  // —— 交接单 §七.4 的 5 个数字（与 PC 对齐的硬指标）
  { group: 'PC 对齐', label: '巡检任务', got: tasks.length, want: 306 },
  { group: 'PC 对齐', label: '待执行', got: tasks.filter(t => t.status === '待执行').length, want: 40 },
  { group: 'PC 对齐', label: '执行中', got: tasks.filter(t => t.status === '执行中').length, want: 20 },
  { group: 'PC 对齐', label: '员工', got: employees.length, want: 120 },
  { group: 'PC 对齐', label: '公告', got: notices.length, want: 106 },
  // —— 本轮新增模块的基数
  { group: '审批', label: '审批单据', got: approvals.length, want: 98 },
  { group: '审批', label: '未结（待审批 + 审批中）', got: approvals.filter(a => ['待审批', '审批中'].includes(a.status)).length, want: 41 },
  { group: '工单', label: '工单', got: workOrders.length, want: 158 },
  { group: '工单', label: '待派单', got: workOrders.filter(w => w.status === '待派单').length, want: 21 },
  { group: '抢单', label: '收费入户单', got: workOrders.filter(w => w.feeType === '收费').length, want: 36 },
  { group: '抢单', label: '抢单池（P01 可抢）', got: workOrders.filter(w => w.communityId === 'P01' && w.status === '待派单' && w.feeType === '收费' && !w.assignee).length, want: 8 },
  { group: '抢单', label: '维修价目条目', got: prices.items.length, want: 10 },
  { group: '抢单', label: '增项条目', got: prices.addons.length, want: 5 },
  { group: '抢单', label: '项目提成参数', got: prices.projects.length, want: 3 },
  { group: '住户', label: '租户', got: tenants.length, want: 160 },
  { group: '住户', label: '业主标签字典', got: ownerTags.length, want: 12 },
  { group: '住户', label: '启用中的标签', got: ownerTags.filter(t => t.enabled).length, want: 11 },
  { group: '住户', label: '家庭成员', got: members.length, want: 169 },
  { group: '考勤', label: '考勤记录（人 × 月）', got: attendance.length, want: 315 },
  { group: '楼栋', label: '楼栋责任行', got: stewards.length, want: 18 },
  { group: '费用', label: '账单', got: bills.length, want: 4884 },
  { group: '品质', label: '品质记录（整改单来源）', got: qualityChecks.length, want: 90 }
]

const rows = []
let failed = 0
for (const e of EXPECT) {
  const ok = e.got === e.want
  if (!ok) failed++
  rows.push({ ...e, ok })
}

/* ---------- 口径守卫 ---------- */
const byStatus = {}
for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1
const statusSum = Object.values(byStatus).reduce((s, n) => s + n, 0)

const byExecutor = {}
for (const t of tasks) byExecutor[t.executor] = (byExecutor[t.executor] || 0) + 1
const executorSum = Object.values(byExecutor).reduce((s, n) => s + n, 0)

const byType = {}
for (const t of tasks) byType[t.taskType] = (byType[t.taskType] || 0) + 1

const orgIds = new Set(orgs.map(o => o.orgId))
const openTasks = tasks.filter(t => ['待执行', '执行中', '逾期'].includes(t.status))
const missingOrg = openTasks.filter(t => !t.executorOrgId || !orgIds.has(t.executorOrgId))

const tplIds = new Set(templates.map(t => t.templateId))
const missingTpl = tasks.filter(t => !tplIds.has(t.templateId))
const badSup = tasks.filter(t => (t.taskType === '监督') !== !!t.targetDept)

/* 审批：每个未结单的 currentNode 必须能解析出处理角色（oa.js 的 nodeActor 规则） */
/* 合同初审/复核属于合同审批，移动端不办（oa.js 里显式标注），但必须能识别出来，不能算"解析不出处理角色" */
const NODE_LABELS = ['工程主管', '客服主管', '环境主管', '安保主管', '项目经理', '财务', '品质', '总经理', '合同初审', '合同复核']
const openApprovals = approvals.filter(a => ['待审批', '审批中'].includes(a.status))
const orphanNodes = openApprovals.filter(a => !NODE_LABELS.some(l => String(a.currentNode).includes(l)))
/* 审批流的处理人字段：PC 的 approvalAction 不写 handler，前端补写；这里只查"未结单是否都有待处理节点" */
const noPendingNode = openApprovals.filter(a => !(a.flow || []).some(n => n.action === '待处理'))

/* 工单：可接池里不该有已关闭/已取消 */
const poolRows = workOrders.filter(w => ['待派单', '已派单'].includes(w.status))

/* P01 组织：员工端演示的 5 个身份都指向这里，负责人必须查得到（关系表种子的前提） */
const p01Orgs = orgs.filter(o => String(o.orgId).startsWith('O-P01'))

/* 抢单口径：付费入户才进池，公区一律派人 */
const grabPool = workOrders.filter(
  w => w.communityId === 'P01' && w.status === '待派单' && w.feeType === '收费' && !w.assignee && w.dispatchMode === '抢单'
)
const paidOrders = workOrders.filter(w => w.feeType === '收费')
const priceCats = new Set(prices.items.map(i => i.category))

/* 楼栋：责任行必须有 empId（管家工作台靠它取范围） */
const badSteward = stewards.filter(s => !s.empId)

/* 账单：欠费口径（未缴/部分缴/逾期 且 unpaid > 0） */
const debtBills = bills.filter(b => ['未缴', '部分缴', '逾期'].includes(b.status) && (b.unpaid || 0) > 0)

const guards = [
  { group: '守卫', label: '各状态之和 = 总数', got: statusSum, want: tasks.length },
  { group: '守卫', label: '按执行人求和 = 总数', got: executorSum, want: tasks.length },
  { group: '守卫', label: '类型拆分：执行 / 监督', got: `${byType['执行'] || 0} / ${byType['监督'] || 0}`, want: '240 / 66' },
  { group: '守卫', label: '未完成任务都带有效 executorOrgId', got: openTasks.length - missingOrg.length, want: openTasks.length },
  { group: '守卫', label: '任务引用的模板都存在', got: tasks.length - missingTpl.length, want: tasks.length },
  { group: '守卫', label: '监督任务与被检班组一一对应', got: tasks.length - badSup.length, want: tasks.length },
  { group: '守卫', label: '未结审批节点都能解析出处理角色', got: openApprovals.length - orphanNodes.length, want: openApprovals.length },
  { group: '守卫', label: '未结审批都有待处理节点', got: openApprovals.length - noPendingNode.length, want: openApprovals.length },
  { group: '守卫', label: '楼栋责任行都有 empId', got: stewards.length - badSteward.length, want: stewards.length },
  { group: '守卫', label: '抢单池里全是商业服务单', got: grabPool.every(w => w.feeType === '收费' && w.type === '商业服务'), want: true },
  { group: '守卫', label: '收费单都是商业服务（类型与收费一一对应）', got: paidOrders.every(w => w.type === '商业服务'), want: true },
  { group: '守卫', label: '收费单都带价目快照（priceCode/serviceName/serviceCost）', got: paidOrders.filter(w => w.priceCode && w.serviceName && w.serviceCost !== undefined).length, want: paidOrders.length },
  { group: '守卫', label: '抢单池里没有已指派的单', got: grabPool.every(w => !w.assignee), want: true },
  { group: '守卫', label: '公区维修一张都不在抢单池', got: grabPool.filter(w => w.isPublic).length, want: 0 },
  { group: '守卫', label: '收费单的维修项目都能匹配价目', got: paidOrders.filter(w => !priceCats.has(w.category)).length, want: 0 },
  { group: '守卫', label: '收费单金额 = 材料 + 人工', got: paidOrders.filter(w => Math.abs((w.materialFee || 0) + (w.laborFee || 0) - (w.totalFee || 0)) > 0.01).length, want: 0 },
  { group: '守卫', label: '受理时间早于报修时间的单（应为 0）', got: workOrders.filter(w => w.acceptTime && w.createTime && new Date(w.acceptTime.replace(/-/g, '/')) < new Date(w.createTime.replace(/-/g, '/'))).length, want: 0 },
  { group: '守卫', label: '已取消却已支付的单（应为 0）', got: workOrders.filter(w => w.status === '已取消' && w.payStatus === '已支付').length, want: 0 },
  { group: '守卫', label: '租户都能落到真实房屋上', got: tenants.filter(t => !houses.some(h => h.houseId === t.houseId)).length, want: 0 },
  { group: '守卫', label: 'P01 各组织负责人都能在员工档案里查到', got: p01Orgs.filter(o => !employees.some(e => e.empId === o.leaderEmpId)).length, want: 0 },
  { group: '守卫', label: '业主身上的标签都能在字典里找到', got: owners.filter(o => (o.tagIds || []).some(id => !ownerTags.some(t => t.tagId === id))).length, want: 0 },
  { group: '守卫', label: '在住租户都有 tenantId（详情页要按它取数）', got: tenants.filter(t => t.status === '在住' && !t.tenantId).length, want: 0 }
]

for (const g of guards) {
  const ok = g.got === g.want
  if (!ok) failed++
  rows.push({ ...g, ok })
}

/* ---------- 打印 ---------- */
console.log('数据源：' + MOCK)
let currentGroup = ''
for (const r of rows) {
  if (r.group !== currentGroup) {
    currentGroup = r.group
    console.log(`\n【${currentGroup}】`)
  }
  console.log(`  ${r.ok ? '✓' : '✕'} ${r.label.padEnd(28, ' ')} ${String(r.got).padStart(9)}  期望 ${r.want}`)
}
console.log('')
console.log('任务状态：' + Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(' · '))
console.log('工单状态：' + Object.entries(workOrders.reduce((m, w) => ((m[w.status] = (m[w.status] || 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(' · '))
console.log(`欠费账单：${debtBills.length} 张，合计 ¥${Math.round(debtBills.reduce((s, b) => s + (b.unpaid || 0), 0)).toLocaleString()}`)
console.log(`业主标签：${ownerTags.length} 个（启用 ${ownerTags.filter(t => t.enabled).length}）· 已打标签的业主 ${owners.filter(o => (o.tagIds || []).length).length} 位`)
console.log(`租户：${tenants.length} 户（待核验 ${tenants.filter(t => t.verifyStatus === '待核验').length} / 信息不全 ${tenants.filter(t => t.verifyStatus === '信息不全').length}）`)
console.log(`工单待派：${poolRows.length} 张（待派单 + 已派单）· 抢单池 P01：${grabPool.length} 张`)
const paidTotal = paidOrders.reduce((s, w) => s + (w.totalFee || 0), 0)
const paidSettled = paidOrders.filter(w => w.payStatus === '已支付')
console.log(`收费单：${paidOrders.length} 张 ¥${Math.round(paidTotal).toLocaleString()}（已收 ${paidSettled.length} 张 ¥${Math.round(paidSettled.reduce((s, w) => s + (w.totalFee || 0), 0)).toLocaleString()}）`)
const laborSum = paidSettled.reduce((s, w) => s + (w.laborFee || 0), 0)
console.log(`已收单人工费基数 ¥${Math.round(laborSum).toLocaleString()} → 按 P01 的 ${Math.round(prices.projects[0].commissionRate * 100)}% 计提，提成约 ¥${Math.round(laborSum * prices.projects[0].commissionRate).toLocaleString()}`)
console.log(`执行人：${Object.keys(byExecutor).length} 人（其中 ${Object.keys(byExecutor).filter(n => employees.some(e => e.name === n)).length} 人在员工名册）`)

if (failed) {
  console.log(`\n✕ ${failed} 项不一致 —— 两端口径已经分叉`)
  process.exit(1)
}
console.log('\n✓ 全部一致')
