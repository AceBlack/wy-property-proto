/**
 * 契约样例数据（fixtures）生成
 * ----------------------------------------------------------------
 * 从 `02-原型设计/mock/` 的 seed 数据里**投影**出契约字段，生成供假服务与后端初始化用的样例。
 * 三个原则：
 *   ① 只保留契约里声明过的字段（多出来的字段会让后端以为要建列）；
 *   ② 数量做裁剪（owners 60 / houses 120 / bills 240 / payments 160 / work-orders 120），
 *      保证仓库不膨胀，又足够覆盖分页、筛选、越权与边界场景；
 *   ③ 金额四舍五入到分、日期统一 `YYYY-MM-DD` / `YYYY-MM-DD HH:mm`。
 *
 * 用法：node scripts/gen-fixtures.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const MOCK = path.resolve(ROOT, '..', '02-原型设计', 'mock')
const OUT = path.resolve(ROOT, 'fixtures')

const read = f => JSON.parse(fs.readFileSync(path.join(MOCK, f), 'utf8'))
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]))

fs.mkdirSync(OUT, { recursive: true })

const houses = read('houses.json')
const ownersRaw = read('owners.json')

/* ---------- 房屋（含空间归属，供其他实体引用） ---------- */
const houseRows = houses.slice(0, 160).map(h => pick(h, [
  'houseId', 'communityId', 'buildingId', 'unitId', 'room', 'floor',
  'fullName', 'shortName', 'usage', 'houseType', 'area', 'innerArea',
  'deliverStatus', 'useStatus', 'propertyStatus', 'ownerId', 'tenantId', 'stewardEmpId'
]))
const houseIds = new Set(houseRows.map(h => h.houseId))

/* ---------- 业主（列表脱敏由服务端做，fixture 保留真值） ---------- */
const ownerRows = ownersRaw.slice(0, 60).map(o => pick(o, [
  'ownerId', 'name', 'phone', 'idCard', 'gender', 'ownerType',
  'certified', 'faceRegistered', 'appRegistered', 'creditLevel', 'registerDate'
]))

/* ---------- 账单 ---------- */
const allBills = read('bills.json')
/* 房屋账单 240 张 + 车位账单 12 张：后者没有 houseId，用于覆盖 subjectType=park 与「无房屋」分支 */
const billSource = [
  ...allBills.filter(b => houseIds.has(b.houseId)).slice(0, 240),
  ...allBills.filter(b => !b.houseId).slice(0, 12)
]
const billRows = billSource
  .slice(0, 260)
  .map(b => ({
    ...pick(b, ['billId', 'communityId', 'houseId', 'ownerId', 'period', 'status', 'itemId', 'itemName', 'unit']),
    amount: r2(b.amount),
    quantity: Number(b.quantity) || 1,
    price: r2(b.price),
    discount: r2(b.discount),
    lateFee: r2(b.lateFee),
    payable: r2(b.payable),
    paidAmount: r2(b.paidAmount),
    unpaid: r2(b.unpaid),
    overdueDays: Number(b.overdueDays) || 0,
    dueDate: b.dueDate,
    payTime: b.payTime || '',
    createTime: b.createTime
  }))

/* ---------- 缴费流水 ---------- */
const payRows = read('payments.json')
  .filter(p => houseIds.has(p.houseId))
  .slice(0, 160)
  .map(p => ({
    ...pick(p, ['payId', 'billId', 'houseId', 'ownerId', 'method', 'channel', 'transNo', 'operator', 'invoiceStatus', 'invoiceNo']),
    amount: r2(p.amount),
    payTime: p.payTime
  }))

/* ---------- 工单 ---------- */
const woRows = read('workOrders.json').slice(0, 120).map(w => ({
  ...pick(w, ['woId', 'woNo', 'communityId', 'houseId', 'houseName', 'ownerId', 'ownerName',
    'type', 'category', 'source', 'priority', 'status', 'title', 'description',
    'dispatchMode', 'assignee', 'createTime', 'acceptTime', 'arriveTime', 'finishTime',
    'feeType', 'payStatus', 'score', 'isPublic']),
  slaHours: Number(w.slaHours) || 24,
  materialFee: r2(w.materialFee),
  laborFee: r2(w.laborFee),
  totalFee: r2(w.totalFee),
  /* SLA 由服务端按工作日历算好下发，前端只展示（契约里是只读字段） */
  slaDueAt: '',
  slaUsedHours: 0,
  slaBreached: false,
  _ver: 1
}))

/* SLA 预计算：与原型 api.js 的 woSlaState 同口径（工作日 9–18 点，跳周末与节假日，待确认停表） */
const CAL = {
  workStart: 9, workEnd: 18,
  holidays: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'],
  now: new Date(2026, 9, 21, 18, 0)
}
const parse = s => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null
}
const fmt = d => {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const isWork = d => d.getDay() !== 0 && d.getDay() !== 6 && !CAL.holidays.includes(fmt(d).slice(0, 10))

function addWorkHours(from, hours) {
  const d = new Date(from.getTime())
  let left = hours
  while (left > 0) {
    if (!isWork(d)) { d.setDate(d.getDate() + 1); d.setHours(CAL.workStart, 0, 0, 0); continue }
    const ds = new Date(d.getFullYear(), d.getMonth(), d.getDate(), CAL.workStart, 0, 0, 0)
    const de = new Date(d.getFullYear(), d.getMonth(), d.getDate(), CAL.workEnd, 0, 0, 0)
    if (d < ds) d.setTime(ds.getTime())
    if (d >= de) { d.setDate(d.getDate() + 1); d.setHours(CAL.workStart, 0, 0, 0); continue }
    const avail = (de - d) / 3600000
    if (left <= avail) { d.setTime(d.getTime() + left * 3600000); left = 0 }
    else { left -= avail; d.setDate(d.getDate() + 1); d.setHours(CAL.workStart, 0, 0, 0) }
  }
  return d
}
function workHours(a, b) {
  if (!a || !b || b <= a) return 0
  let total = 0
  const d = new Date(a.getTime())
  while (d < b) {
    if (!isWork(d)) { d.setDate(d.getDate() + 1); d.setHours(CAL.workStart, 0, 0, 0); continue }
    const ds = new Date(d.getFullYear(), d.getMonth(), d.getDate(), CAL.workStart, 0, 0, 0)
    const de = new Date(d.getFullYear(), d.getMonth(), d.getDate(), CAL.workEnd, 0, 0, 0)
    if (d < ds) d.setTime(ds.getTime())
    const end = b < de ? b : de
    if (end > d) total += (end - d) / 3600000
    if (b <= de) break
    d.setDate(d.getDate() + 1); d.setHours(CAL.workStart, 0, 0, 0)
  }
  return Math.round(total * 10) / 10
}
const DONE = ['已完工', '已关闭', '已评价']
const PAUSE = ['待确认']
for (const w of woRows) {
  const created = parse(w.createTime) || CAL.now
  const finished = DONE.includes(w.status)
  const endAt = finished ? (parse(w.finishTime) || CAL.now) : CAL.now
  const used = workHours(created, endAt)
  w.slaDueAt = fmt(addWorkHours(created, w.slaHours))
  w.slaUsedHours = used
  w.slaBreached = PAUSE.includes(w.status) ? false : (w.slaHours - used) < 0
}

/* ---------- 落盘 ---------- */
const write = (name, rows) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(rows, null, 1) + '\n')
  console.log(`  ${name.padEnd(18)} ${rows.length} 行`)
}

console.log('fixtures 已生成：')
write('owners.json', ownerRows)
write('houses.json', houseRows)
write('bills.json', billRows)
write('payments.json', payRows)
write('work-orders.json', woRows)

/* ---------- 租户（在住人；物业只做补充/核验，不掌握租金） ---------- */
const tenantRows = read('tenants.json').slice(0, 80).map((t, i) => {
  const row = pick(t, [
    'tenantId', 'name', 'phone', 'idCard', 'houseId', 'ownerId',
    'leaseStart', 'leaseEnd', 'relation', 'residents', 'source', 'verifyStatus', 'certified', 'faceRegistered'
  ])
  /* 人为留 6 条「关系」为空的记录：核验门槛是 5 项（姓名/手机/证件/关系/居住人数），
     否则样例里全齐，「核验不通过」这条分支永远测不到 */
  if (i % 13 === 0) row.relation = ''
  return {
    ...row,
    status: t.status || '在住',
    emergencyContact: '',
    remark: '',
    verifiedBy: '', verifiedAt: '', moveOutAt: '', moveOutReason: '',
    _ver: 1
  }
})

/* ---------- 巡检任务（执行 / 监督两类） ---------- */
const allTasks = read('inspectTasks.json')
/* 90 条执行 + 30 条监督：监督任务在 seed 里排在最后，只取前 120 会一条都取不到 */
const taskSource = [
  ...allTasks.filter(t => t.taskType !== '监督').slice(0, 90),
  ...allTasks.filter(t => t.taskType === '监督').slice(0, 30)
]
const taskRows = taskSource.map(t => ({
  ...pick(t, [
    'taskId', 'planId', 'planName', 'post', 'communityId', 'executor', 'executorOrgId',
    'templateId', 'taskType', 'targetPost', 'targetDept', 'scheduledDate', 'scheduledTime',
    'status', 'doneTime', 'duration', 'itemCount', 'normalCount', 'issueCount',
    'photos', 'checkinType', 'checkedIn', 'score', 'refWoId'
  ]),
  issueItems: (t.issueItems || []).map(x => ({
    item: x.item, deduct: x.deduct,
    responsibleName: x.responsibleName || '', responsibleEmpId: x.responsibleEmpId || ''
  })),
  _ver: 1
}))

/* ---------- 整改单（由有扣分项的品质记录派生，与原型 api.js 同口径） ---------- */
const qcRows = read('qualityChecks.json').filter(q => (q.rectifyCount || 0) > 0)
const rectifyRows = qcRows.map((q, i) => {
  const total = q.rectifyCount || 1
  const done = Math.min(q.rectifyDone || 0, total)
  const map = { 已闭环: '已闭环', 待复核: '待复核', 整改中: '待整改', 已超时: '待整改' }
  return {
    rectifyId: 'RC' + String(i + 1).padStart(4, '0'),
    rectifyNo: `ZG-${String(q.checkDate).slice(0, 7)}-${String(i + 1).padStart(4, '0')}`,
    checkId: q.checkId, checkNo: q.checkNo,
    communityId: q.communityId, deptName: q.area, area: q.area,
    level: q.veto ? '重大' : ((q.deductCount || 0) >= 6 ? '一般' : '轻微'),
    status: map[q.status] || '待整改',
    sourceType: '现场抽查',
    items: Array.from({ length: total }, (_, k) => ({
      no: k + 1,
      desc: `${q.area}检查发现问题 ${k + 1}（详见检查记录 ${q.checkNo}）`,
      done: k < done
    })),
    issueDesc: `${q.area}：共 ${total} 项待整改`,
    createdAt: `${q.checkDate} 10:30`,
    dueDate: q.dueDate,
    submitAt: q.status === '已闭环' || q.status === '待复核' ? `${q.dueDate} 17:10` : '',
    /* 提交人必须留：复核规则「提交人不得自己复核」要靠它判定，样例里空着这条规则永远测不到 */
    submitBy: q.status === '已闭环' || q.status === '待复核' ? '部门经理' : '',
    submitRemark: q.status === '已闭环' || q.status === '待复核' ? '已按要求整改并上传现场照片' : '',
    recheckAt: q.status === '已闭环' ? `${q.dueDate} 09:40` : '',
    recheckResult: q.status === '已闭环' ? '通过' : '',
    _ver: 1
  }
})

/* ---------- 品质检查记录（结果台账；达标率/评价另属第三批，待口径拍板） ---------- */
const qualityRows = read('qualityChecks.json').slice(0, 90).map(q => ({
  checkId: q.checkId,
  checkNo: q.checkNo,
  communityId: q.communityId,
  area: q.area,
  type: q.type,
  checker: q.checker,
  checkDate: q.checkDate,
  period: String(q.checkDate).slice(0, 7),
  score: q.score,
  grade: q.grade,
  deductCount: q.deductCount || 0,
  veto: !!q.veto,
  rectifyCount: q.rectifyCount || 0,
  rectifyDone: q.rectifyDone || 0,
  dueDate: q.dueDate,
  status: q.status,
  recheck: !!q.recheck,
  sourceType: '现场抽查',
  _ver: 1
}))

/* ---------- 员工（只为把责任楼管的名字解出来，不做人事模块契约） ---------- */
const empRows = read('employees.json').slice(0, 80).map(e => pick(e, ['empId', 'name', 'position', 'orgId', 'status']))
write('employees.json', empRows)

write('tenants.json', tenantRows)
write('inspect-tasks.json', taskRows)
write('rectify-orders.json', rectifyRows)
write('quality-checks.json', qualityRows)

/* ---------- 项目（报表按项目名展示；主数据只有字典用途，不做增删改契约） ---------- */
const communityRows = read('communities.json').map(c => pick(c, ['communityId', 'name', 'bizType', 'houseCount', 'status']))
write('communities.json', communityRows)

fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
  generatedAt: new Date().toISOString().slice(0, 19),
  source: '02-原型设计/mock/（seed_dataset.py，SEED 20261021）',
  dataDate: '2026-10-21',
  counts: {
    owners: ownerRows.length, houses: houseRows.length, bills: billRows.length,
    payments: payRows.length, workOrders: woRows.length,
    tenants: tenantRows.length, inspectTasks: taskRows.length, rectifyOrders: rectifyRows.length,
    qualityChecks: qualityRows.length, communities: communityRows.length
  },
  note: '样例数据的真值与原型一致；列表接口由服务端脱敏后再下发，不要在前端脱敏'
}, null, 2) + '\n')
console.log('  meta.json')
