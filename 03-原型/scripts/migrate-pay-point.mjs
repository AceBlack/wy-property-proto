/**
 * 补「收款点 / 收款方式」到存量数据（2026-11-15 · 幂等）
 *
 * 为什么要有这一步：
 *   经营日报的日结差额 = 收入 − 收款点。押金的收与退不进收款点，那一段差额就永远对不平，
 *   只能把押金整段排除在日结之外 —— 这不是口径选择，是数据模型缺字段。
 *   流水那边同样：早先只有 `channel`（钱怎么走的），没有 `payPoint`（谁在收、跟谁交班），
 *   而「车辆现金」「车辆POS」这类收款点在客户表里是单列的（停车场独立交班、独立对账）。
 *
 * 补的规则（都不随机，跑几次结果一样）：
 *   · 押金收款方式按金额档分：大额对公（银行代扣）、小额现金。
 *     没见过任何一户拿着 3000 元装修押金来刷 POS —— 猜也要猜得像。
 *   · 押金收款点全部「前台」：押金在收银台办，停车岗不收押金。
 *   · 流水收款点：线上自助 → 线上；停车类业务 → 停车场；其余 → 前台。
 *
 * 正式实现应当由收款那一刻写入，这两个字段是**投影**出来的 —— 文档里写清了。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MOCKS = [path.join(ROOT, 'src/mock'), path.resolve(ROOT, '../02-原型设计/mock')]

const read = p => JSON.parse(fs.readFileSync(p, 'utf8'))
const write = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n')

/* 大额走对公、小额走现金 —— 按押金类型分，不按金额分（金额会变，类型稳定） */
const LARGE_TYPES = new Set(['装修押金', '履约保证金', '租约押金'])
const PARK_ITEMS = new Set(['FI07', 'FI09'])   // 车位管理服务费 / 临时停车费

function migrateDeposits(dir) {
  const p = path.join(dir, 'decorationDeposits.json')
  if (!fs.existsSync(p)) return null
  const rows = read(p)
  let touched = 0
  for (const d of rows) {
    if (!d.payMethod) {
      d.payMethod = LARGE_TYPES.has(d.type) ? '银行代扣' : '现金'
      touched += 1
    }
    if (!d.payPoint) d.payPoint = '前台'
    if (!d.refundMethod) d.refundMethod = d.payMethod
    if (!d.refundPoint) d.refundPoint = d.payPoint
  }
  write(p, rows)
  return { file: p, rows: rows.length, touched }
}

function migratePayments(dir) {
  const p = path.join(dir, 'payments.json')
  const billPath = path.join(dir, 'bills.json')
  if (!fs.existsSync(p)) return null
  const rows = read(p)
  const bills = fs.existsSync(billPath) ? read(billPath) : []
  const itemOf = new Map(bills.map(b => [b.billId, b.itemId]))

  let touched = 0
  for (const pay of rows) {
    if (pay.payPoint) continue
    const itemId = itemOf.get(pay.billId) || ''
    if (pay.operator === '线上自助') pay.payPoint = '线上'
    else if (PARK_ITEMS.has(itemId)) pay.payPoint = '停车场'
    else pay.payPoint = '前台'
    touched += 1
  }
  write(p, rows)
  return { file: p, rows: rows.length, touched }
}

const out = []
for (const dir of MOCKS) {
  const a = migrateDeposits(dir)
  const b = migratePayments(dir)
  if (a) out.push(`押金 ${a.rows} 条（补 ${a.touched}）→ ${a.file}`)
  if (b) out.push(`流水 ${b.rows} 条（补 ${b.touched}）→ ${b.file}`)
}
console.log(out.join('\n'))

/* 自检：补完不该有缺的，也不该出现白名单外的值 */
for (const dir of MOCKS) {
  const dp = path.join(dir, 'decorationDeposits.json')
  const pp = path.join(dir, 'payments.json')
  if (fs.existsSync(dp)) {
    const rows = read(dp)
    const bad = rows.filter(d => !d.payMethod || !d.payPoint)
    const pts = [...new Set(rows.map(d => d.payPoint))]
    const mts = [...new Set(rows.map(d => d.payMethod))]
    if (bad.length) throw new Error(`押金还有 ${bad.length} 条缺字段`)
    console.log(`  ✓ 押金收款点 ${pts.join('/')} · 方式 ${mts.join('/')}`)
  }
  if (fs.existsSync(pp)) {
    const rows = read(pp)
    const bad = rows.filter(p => !p.payPoint)
    const pts = [...new Set(rows.map(p => p.payPoint))]
    if (bad.length) throw new Error(`流水还有 ${bad.length} 条缺 payPoint`)
    console.log(`  ✓ 流水收款点 ${pts.join('/')}`)
  }
}
