/**
 * 员工端（`/mobile/*` 与巡检/考勤写接口）所需的两份 fixtures
 * ----------------------------------------------------------------
 * 为什么单独一个脚本：这两份的源数据在 `03-原型/src/mock`，但契约侧要**抽样**，
 * 且 `gen-fixtures.mjs` 已经把巡检任务裁到 120 条 —— 模板必须与那 120 条用到的
 * `templateId` 对齐，否则 `GET /mobile/tasks/{id}/exec` 拿不到检查项，
 * 员工端执行页就是一张空表。
 *
 * 用法：node scripts/gen-mobile-fixtures.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.resolve(ROOT, '../03-原型/src/mock')
const OUT = path.join(ROOT, 'fixtures')

const readSrc = f => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'))
const write = (name, rows) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(rows, null, 2) + '\n')
  console.log(`  ${name}  ${rows.length} 条`)
}

/* ---------- ① 巡检模板：只留契约任务真正用到的 ---------- */
const tasks = JSON.parse(fs.readFileSync(path.join(OUT, 'inspect-tasks.json'), 'utf8'))
const used = new Set(tasks.map(t => t.templateId))
const templates = readSrc('inspectTemplates.json')
  .filter(t => used.has(t.templateId))
  .map(t => ({
    templateId: t.templateId,
    name: t.name,
    type: t.type,
    post: t.post,
    targetPost: t.targetPost || '',
    version: t.version,
    /* fields 是执行页的检查项清单：label/type/required/standard 四样缺一不可 */
    fields: (t.fields || []).map(f => ({
      label: f.label,
      type: f.type,
      required: !!f.required,
      standard: f.standard || ''
    }))
  }))

/* ---------- ② 考勤：每人取最新一个月，凑一份能演示"确认 / 申诉"的样本 ---------- */
const empIds = new Set(
  JSON.parse(fs.readFileSync(path.join(OUT, 'employees.json'), 'utf8')).map(e => e.empId)
)
const att = readSrc('attendance.json').filter(a => empIds.has(a.empId))
const byEmp = new Map()
for (const a of att) {
  const cur = byEmp.get(a.empId)
  if (!cur || a.month > cur.month) byEmp.set(a.empId, a)
}
const attendance = [...byEmp.values()].sort((a, b) => a.attId.localeCompare(b.attId))

console.log('生成员工端 fixtures：')
/* ---------- ③ 巡检计划：同样只留契约任务引用到的 ---------- */
/*
 * 为什么要有：`GET /mobile/tasks/{id}/exec` 要回「来源计划 · 周期」，
 * 而契约侧原来**一份巡检计划都没有**（只有部门计划与计划模板，是两回事）。
 * 少了它，员工端详情页的「来源计划」只能拿任务上的 `planName` 凑，
 * `cycle`（每日/每月）永远是空的。
 *
 * 与模板一样的裁剪原则：只留 120 条任务真正引用到的 planId，不把 23 条全搬过来。
 */
const planIds = new Set(tasks.map(t => t.planId).filter(Boolean))
const plans = readSrc('inspectPlans.json')
  .filter(p => planIds.has(p.planId))
  .map(p => ({
    planId: p.planId,
    name: p.name,
    /* cycle 是详情页显示"这个计划多久做一次"的唯一来源 */
    cycle: p.cycle,
    post: p.post,
    communityId: p.communityId,
    taskType: p.taskType
  }))

/* ---------- ④ 审批单据：契约里原来一条都没有 ---------- */
/*
 * `oaRequests` 在假服务里是**内存态空数组**，只有 POST 创建过才有数据 ——
 * 于是员工端审批页切到 HTTP 后是空的，"待我处理 / 我发起 / 我办过"三个页签全 0。
 *
 * 只取 P01 的（员工端四个演示身份都在 P01）。`flow` 里已经由种子的
 * `resolveAssignees` 填好了具体 handler / approvers，
 * 所以"谁能审"可以直接按数据判，不必在服务端重算组织关系。
 */
const allApprovals = readSrc('approvals.json')
const apRows = allApprovals
  .filter(a => a.communityId === 'P01')
  .map(a => ({
    approvalId: a.approvalId,
    approvalNo: a.approvalNo,
    bizType: a.bizType,
    bizId: a.bizId || '',
    title: a.title,
    formData: a.formData || {},
    files: a.files || [],
    communityId: a.communityId,
    communityName: a.communityName,
    amount: a.amount || 0,
    applicant: a.applicant,
    applicantRole: a.applicantRole,
    applyTime: a.applyTime,
    status: a.status,
    currentNode: a.currentNode,
    urgency: a.urgency || '普通',
    waitHours: a.waitHours || 0,
    flow: a.flow || []
  }))

write('inspect-templates.json', templates)
write('attendance.json', attendance)
write('inspect-plans.json', plans)
write('approvals.json', apRows)

/* 自检：执行页要用的模板必须一张不缺 */
const missing = [...used].filter(id => !templates.some(t => t.templateId === id))
console.log(`\n自检：任务用到的 ${used.size} 个模板，缺 ${missing.length} 个${missing.length ? '（' + missing.join(',') + '）' : ''}`)
const withItems = templates.filter(t => t.fields.length).length
console.log(`      有检查项的模板 ${withItems}/${templates.length}；考勤待确认 ${attendance.filter(a => a.status === '待确认').length} 条`)
