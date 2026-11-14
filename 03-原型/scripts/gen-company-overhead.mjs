/**
 * 费用加「归属层级」+ 造公司级费用（2026-11-15 · 幂等）
 *
 * 为什么要有这一步：
 *   客户月报里「管理费用」与「支出」并列 —— 那笔钱是总部花的，不归属任何项目。
 *   系统里所有费用都挂在 `communityId` 上，没有"公司级"这个概念，
 *   于是公司合计只能等于"三个项目相加"，总部费用无处安放。
 *
 * 做什么：
 *   ① 给全部存量费用打 `level: 'project'`（默认值，语义显式）；
 *   ② 新增一批 `level: 'company'` 的费用，`communityId` 为空。
 *
 * 为什么公司级费用 `communityId` 留空：
 *   `incomeExpenseReport` 的过滤是 `if (communityId && x.communityId !== communityId)`——
 *   传了项目就筛掉公司级，传空则全含。**不用改一行过滤逻辑**，这是最省的做法。
 *
 * 造数据的边界：只造「费用」（租房、年费、审计、招聘），**不造总部人力**——
 *   工资走 payrolls 那条链，硬塞进 expenses 会让人力成本算两遍。
 *   总部人力真要摊的时候再说，那属于 C 阶段的事。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MOCKS = [path.join(ROOT, 'src/mock'), path.resolve(ROOT, '../02-原型设计/mock')]

/** 演示用的公司级费用。金额按"总部一个月大概花多少"估，不是客户真实数据。 */
const COMPANY_EXPENSES = [
  {
    expenseId: 'EX9001', applyNo: 'EXP-HQ-2608-01', expenseType: '房租', categoryId: 'EXP_OP_OFFICE',
    amount: 28000, happenDate: '2026-08-01', period: '2026-08',
    applicant: '周敏', applicantEmpId: 'EM0002', status: '已付款', payDate: '2026-08-05',
    reason: '总部办公场地租金（8 月）', invoiceCount: 1
  },
  {
    expenseId: 'EX9002', applyNo: 'EXP-HQ-2608-02', expenseType: '系统年费', categoryId: 'EXP_OP_OFFICE',
    amount: 36000, happenDate: '2026-08-12', period: '2026-08',
    applicant: '周敏', applicantEmpId: 'EM0002', status: '已付款', payDate: '2026-08-15',
    reason: '收费与工单系统年度授权（三个项目共用）', invoiceCount: 1
  },
  {
    expenseId: 'EX9003', applyNo: 'EXP-HQ-2609-01', expenseType: '房租', categoryId: 'EXP_OP_OFFICE',
    amount: 28000, happenDate: '2026-09-01', period: '2026-09',
    applicant: '周敏', applicantEmpId: 'EM0002', status: '已付款', payDate: '2026-09-05',
    reason: '总部办公场地租金（9 月）', invoiceCount: 1
  },
  {
    expenseId: 'EX9004', applyNo: 'EXP-HQ-2609-02', expenseType: '审计费', categoryId: 'EXP_OP_OTHER',
    amount: 15000, happenDate: '2026-09-18', period: '2026-09',
    applicant: '周敏', applicantEmpId: 'EM0002', status: '已付款', payDate: '2026-09-25',
    reason: '半年度财务审计', invoiceCount: 1
  },
  {
    expenseId: 'EX9005', applyNo: 'EXP-HQ-2610-01', expenseType: '房租', categoryId: 'EXP_OP_OFFICE',
    amount: 28000, happenDate: '2026-10-01', period: '2026-10',
    applicant: '周敏', applicantEmpId: 'EM0002', status: '已付款', payDate: '2026-10-08',
    reason: '总部办公场地租金（10 月）', invoiceCount: 1
  },
  {
    expenseId: 'EX9006', applyNo: 'EXP-HQ-2610-02', expenseType: '招聘费', categoryId: 'EXP_OP_OTHER',
    amount: 8000, happenDate: '2026-10-16', period: '2026-10',
    applicant: '周敏', applicantEmpId: 'EM0002', status: '待付款', payDate: '',
    reason: '秩序岗与管理岗招聘渠道费', invoiceCount: 1
  }
]

const read = p => JSON.parse(fs.readFileSync(p, 'utf8'))
const write = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n')

const out = []
for (const dir of MOCKS) {
  const p = path.join(dir, 'expenses.json')
  if (!fs.existsSync(p)) continue
  const rows = read(p)

  /* ① 存量打标 —— 已有 level 的不动 */
  let tagged = 0
  for (const e of rows) {
    if (!e.level) { e.level = 'project'; tagged += 1 }
  }

  /* ② 补公司级费用 —— 按 expenseId 判重，跑几次结果一样 */
  const ids = new Set(rows.map(e => e.expenseId))
  let added = 0
  for (const c of COMPANY_EXPENSES) {
    if (ids.has(c.expenseId)) continue
    rows.push({
      ...c,
      communityId: '', communityName: '',
      orgId: 'O-HQ', level: 'company'
    })
    added += 1
  }

  write(p, rows)
  out.push(`${p}：共 ${rows.length} 条（打标 ${tagged}，新增公司级 ${added}）`)
}
console.log(out.join('\n'))

/* 自检：公司级必须没有 communityId；项目级必须有 */
for (const dir of MOCKS) {
  const p = path.join(dir, 'expenses.json')
  if (!fs.existsSync(p)) continue
  const rows = read(p)
  const badCo = rows.filter(e => e.level === 'company' && e.communityId)
  const badPr = rows.filter(e => e.level === 'project' && !e.communityId)
  const noLevel = rows.filter(e => !e.level)
  if (badCo.length) throw new Error(`公司级费用仍挂着项目：${badCo.length} 条`)
  if (badPr.length) throw new Error(`项目级费用没有项目：${badPr.length} 条`)
  if (noLevel.length) throw new Error(`还有 ${noLevel.length} 条没有 level`)
  const co = rows.filter(e => e.level === 'company')
  const sum = co.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const paid = co.filter(e => e.status === '已付款').reduce((s, e) => s + (Number(e.amount) || 0), 0)
  console.log(`  ✓ 公司级 ${co.length} 条 / 合计 ¥${sum.toLocaleString()}（已付款 ¥${paid.toLocaleString()}）`)
}
