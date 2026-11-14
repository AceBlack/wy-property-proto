/**
 * 减免种子投影：把 PC 运行时注入的减免落进契约 fixture（2026-11-14）
 * ------------------------------------------------------------
 * 问题：03 的减免是**运行时注入**（`03/src/utils/api.js` 的 `_seedWaives()`），
 * 而 04 的 `fixtures/bills.json` 是从种子文件静态投影的 —— 种子文件里 `discount` 全是 0。
 * 后果：接口模式下 `GET /reports/waive-analysis` 永远返回空表，
 * 演示时分不清"这小区没人减免"和"这功能没做"。
 *
 * 这里把**同一套规则**施加到 04 的账单 fixture 上。规则逐条照抄 `_seedWaives()`：
 *
 *   候选：有 houseId + 已缴 + 账期在 2026-08~10 + 收费项是按面积/按车位/按户的月费 + 实收 > 0
 *   抽样：按 billId 排序后**每 17 张取第 6 张**（`i % 17 === 5`）
 *   金额：应缴 × 比例，按封顶截断，< 20 元的跳过（凑数的小额减免会把"减免笔数"这个指标做脏）
 *   实收：等额扣掉 —— 账单必须继续满足 `payable = paidAmount + discount`
 *   超额：另补 2 笔困难户 1200 元（审批线 1000），否则报表的「超额度」列永远是空的
 *
 * **03 改规则这里必须跟着改。** 落盘前的自检（笔数 + 2 笔超额 + 恒等式）就是用来发现不同步的。
 *
 * 笔数：主减免 **88** 笔 + 超额 2 笔 = **90** 笔。交接单里写的是 87 笔，那是笔误 ——
 * 把同一套规则跑在 03 的账单上也是 88 笔（两侧账单逐字段相同，不存在只在一侧多出一笔的可能）。
 *
 * 幂等：先还原（上次加过的把实收加回去），再重新施加。重复跑结果一致。
 *
 *   node scripts/gen-waive-seeds.mjs --dry
 *   node scripts/gen-waive-seeds.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const BILLS = path.join(ROOT, 'fixtures', 'bills.json')
const PC = path.resolve(ROOT, '..', '03-原型', 'src', 'mock')
const DRY = process.argv.includes('--dry')

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'))
const r2 = n => Math.round((Number(n) || 0) * 100) / 100

/* 与 api.js 的 WAIVE_SEED_REASONS 一一对应（顺序也一致：顺序决定第 n 笔用哪个原因） */
const REASONS = [
  { reasonId: 'WR03', pct: 0.05, cap: 0 },     /* 差错纠正：小额、笔数最多 */
  { reasonId: 'WR04', pct: 0.15, cap: 500 },   /* 协商减免：投诉补偿 */
  { reasonId: 'WR02', pct: 0.30, cap: 200 },   /* 困难户：比例高但封顶 */
  { reasonId: 'WR05', pct: 0.08, cap: 0 }      /* 其他 */
]
const SEED_PERIODS = new Set(['2026-08', '2026-09', '2026-10'])
const OVER_LIMIT = { reasonId: 'WR02', amount: 1200, minPaid: 1500, count: 2 }

const feeItems = readJson(path.join(PC, 'feeItems.json'))
const reasonDict = new Map(readJson(path.join(PC, 'waiveReasons.json')).map(r => [r.reasonId, r.name]))
/* 与 03 完全同源：不自己写死 FI01，否则将来加了"按户"的月费科目，两边抽样池就不一样了 */
const monthlyItems = new Set(feeItems
  .filter(i => ['按面积', '按车位', '按户'].includes(i.calcType) && i.cycle === '月')
  .map(i => i.itemId))

const bills = readJson(BILLS)

/* ---------------- 1. 还原上一次施加的结果 ---------------- */

let restored = 0
for (const b of bills) {
  if (!b.discountReasonId) continue
  b.paidAmount = r2((Number(b.paidAmount) || 0) + (Number(b.discount) || 0))
  b.discount = 0
  delete b.discountReasonId
  delete b.discountReason
  restored += 1
}

/* ---------------- 2. 施加 ---------------- */

const pool = bills
  .filter(b => b.houseId && b.status === '已缴' && SEED_PERIODS.has(b.period)
    && monthlyItems.has(b.itemId) && (Number(b.paidAmount) || 0) > 0 && !(Number(b.discount) > 0))
  .sort((a, b) => String(a.billId).localeCompare(String(b.billId)))

const seeded = new Set()
let n = 0
for (const b of pool) {
  const i = n++
  if (i % 17 !== 5) continue
  const cfg = REASONS[i % REASONS.length]
  const base = Number(b.payable) || Number(b.amount) || 0
  let amount = r2(base * cfg.pct)
  if (cfg.cap) amount = Math.min(amount, cfg.cap)
  if (amount < 20) continue
  const paidNow = r2((Number(b.paidAmount) || 0) - amount)
  if (paidNow < 0) continue
  b.discount = amount
  b.discountReasonId = cfg.reasonId
  b.discountReason = reasonDict.get(cfg.reasonId) || ''
  b.paidAmount = paidNow
  seeded.add(b.billId)
}

const big = pool.filter(b => !seeded.has(b.billId) && (Number(b.paidAmount) || 0) >= OVER_LIMIT.minPaid)
for (const b of big.slice(0, OVER_LIMIT.count)) {
  b.discount = OVER_LIMIT.amount
  b.discountReasonId = OVER_LIMIT.reasonId
  b.discountReason = reasonDict.get(OVER_LIMIT.reasonId) || ''
  b.paidAmount = r2((Number(b.paidAmount) || 0) - OVER_LIMIT.amount)
  seeded.add(b.billId)
}

/* ---------------- 3. 自检 ---------------- */

const waived = bills.filter(b => (Number(b.discount) || 0) > 0)
const fail = []
const over = waived.filter(b => b.discountReasonId === 'WR02' && b.discount === OVER_LIMIT.amount)
const main = waived.length - over.length
/* 主减免 88 是规则算出来的（池 1836 张，每 17 取 1，扣除 20 笔不足 20 元的）：
   写成常量而不是范围，是为了让"03 悄悄改了比例或抽样间隔"这件事在这里红掉 */
if (main !== 88) fail.push(`主减免 ${main} 笔 ≠ 88（03 的 _seedWaives 规则变了？）`)
if (over.length !== OVER_LIMIT.count) fail.push(`超额 ${OVER_LIMIT.count} 笔，实际 ${over.length}`)

for (const b of bills) {
  const d = Number(b.discount) || 0, p = Number(b.paidAmount) || 0, pay = Number(b.payable) || 0
  if (d < 0 || p < 0) fail.push(`${b.billId} 出现负数（减免 ${d} / 实收 ${p}）`)
  /* 已缴账单：实收 + 减免 = 应缴。这条破了，三率的恒等式就会在页面上对不上 */
  if (b.status === '已缴' && Math.abs(p + d - pay) > 0.02) {
    fail.push(`${b.billId} 实收 ${p} + 减免 ${d} ≠ 应缴 ${pay}`)
  }
}
if (new Set(waived.map(b => b.billId)).size !== waived.length) fail.push('同一张账单被减了两次')

if (fail.length) {
  console.error(`自检失败 ${fail.length} 条：`)
  fail.slice(0, 8).forEach(x => console.error('  · ' + x))
  process.exit(1)
}

const byReason = {}
const byPeriod = {}
let total = 0
for (const b of waived) {
  byReason[b.discountReason] = (byReason[b.discountReason] || 0) + 1
  byPeriod[b.period] = (byPeriod[b.period] || 0) + 1
  total = r2(total + b.discount)
}

console.log(`减免种子：${waived.length} 笔 / ¥${total}（还原上次 ${restored} 笔）`)
console.log('  按原因', byReason)
console.log('  按账期', byPeriod)
console.log(`  超额（WR02 1200）：${over.length} 笔`)

if (DRY) { console.log('\n--dry：未写盘'); process.exit(0) }

fs.writeFileSync(BILLS, JSON.stringify(bills, null, 2) + '\n')
console.log(`\n已写入 fixtures/bills.json`)
