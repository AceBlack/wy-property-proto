/**
 * 公司级费用 fixture（2026-11-15 · 幂等）
 *
 * 03 的 `expenses.json` 里 `level: 'company'` 的那些（总部房租、系统年费、审计、招聘）。
 * 契约数据集没有 expenses 表 —— 支出归集在假服务里走 payrolls + contracts，
 * 所以公司级费用单独出一份，只给 `/reports/company` 的 `overhead` 用。
 *
 * 为什么不做成完整的 expenses fixture：那会引入第二套支出口径，
 * 与 `incomeExpenseOf`（工资 + 合同摊）对不上，联调时更难解释。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SRC = path.resolve(ROOT, '..', '03-原型', 'src', 'mock', 'expenses.json')
const OUT = path.join(ROOT, 'fixtures', 'company-overhead.json')

const KEYS = [
  'expenseId', 'applyNo', 'expenseType', 'categoryId', 'amount', 'period',
  'happenDate', 'payDate', 'applicant', 'reason', 'status'
]

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const rows = src
  .filter(e => e.level === 'company')
  .map(e => Object.fromEntries(KEYS.filter(k => e[k] !== undefined).map(k => [k, e[k]])))
  .sort((a, b) => String(b.period).localeCompare(String(a.period)) || String(a.expenseId).localeCompare(String(b.expenseId)))

fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n')
const paid = rows.filter(r => r.status === '已付款')
console.log(`公司级费用 ${rows.length} 条 → ${path.relative(ROOT, OUT)}`)
console.log(`  已付款 ${paid.length} 条 / ¥${paid.reduce((s, r) => s + r.amount, 0).toLocaleString()}`)
console.log(`  待付款 ${rows.length - paid.length} 条 / ¥${rows.filter(r => r.status !== '已付款').reduce((s, r) => s + r.amount, 0).toLocaleString()}`)
