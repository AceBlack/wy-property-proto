/**
 * 减免种子（2026-11-14 · 收敛成一处）
 * ------------------------------------------------------------
 * 历史：03 的减免原来在**运行时注入**（`utils/api.js` 的 `_seedWaives()`），
 * 04 的 fixture 是种子的静态投影 —— 一边内存里加、一边文件里没有，于是：
 *
 *   · 接口模式下 `/reports/waive-analysis` 恒为空表；
 *   · 补投影之后，两侧各自实现一遍抽样规则，**算出来差 ¥62.66、差 1 笔**
 *     （原型 8,855.72 / 89 笔，契约 8,918.38 / 90 笔）—— 同一个报表两个数。
 *
 * 现在只留这一处：规则施加到**账单数据文件**上，03 / 02 两份 mock 一起写，
 * 04 的 fixture 由 `gen-finance-fixtures.mjs` 从 03 投影过去 —— 三方同源，
 * 运行时不再有任何注入。
 *
 * 规则（照抄原 `_seedWaives()`，一个字没改）：
 *   候选：有 houseId + 已缴 + 账期 2026-08~10 + 月费科目 + 实收 > 0 + 尚无减免
 *   抽样：按 billId 排序后**每 17 张取第 6 张**（`i % 17 === 5`）
 *   金额：应缴 × 比例，按封顶截断，< 20 元的跳过（碎钱会把"减免笔数"做脏）
 *   实收：等额扣掉 —— 账单必须继续满足 `payable = paidAmount + discount`
 *   超限：另补 2 笔困难户 1200（审批线 1000），否则报表的「超额度」列永远是空的
 *
 * 幂等：先把上一次施加的结果还原（只认带 `discountReasonId` 的行），再重新施加。
 *
 *   node scripts/gen-waive-seeds.mjs --dry
 *   node scripts/gen-waive-seeds.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const MOCK = path.join(ROOT, 'src', 'mock')
const MOCK2 = path.resolve(ROOT, '..', '02-原型设计', 'mock')
const DRY = process.argv.includes('--dry')

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'))
const r2 = n => Math.round((Number(n) || 0) * 100) / 100

/* 顺序决定第 n 笔用哪个原因，改顺序会改结果 —— 不要随手调 */
const REASONS = [
  { reasonId: 'WR03', pct: 0.05, cap: 0 },
  { reasonId: 'WR04', pct: 0.15, cap: 500 },
  { reasonId: 'WR02', pct: 0.30, cap: 200 },
  { reasonId: 'WR05', pct: 0.08, cap: 0 }
]
const SEED_PERIODS = new Set(['2026-08', '2026-09', '2026-10'])
const OVER = { reasonId: 'WR02', amount: 1200, minPaid: 1500, count: 2 }

const feeItems = readJson(path.join(MOCK, 'feeItems.json'))
const reasonName = new Map(readJson(path.join(MOCK, 'waiveReasons.json')).map(r => [r.reasonId, r.name]))
const monthly = new Set(feeItems
  .filter(i => ['按面积', '按车位', '按户'].includes(i.calcType) && i.cycle === '月')
  .map(i => i.itemId))

const billsPath = path.join(MOCK, 'bills.json')
const bills = readJson(billsPath)

/* ---------- 1. 还原上一次施加 ---------- */
let restored = 0
for (const b of bills) {
  if (!(Number(b.discount) > 0) || !b.discountReasonId) continue
  b.paidAmount = r2((Number(b.paidAmount) || 0) + Number(b.discount))
  b.discount = 0
  delete b.discountReasonId
  delete b.discountReason
  restored += 1
}

/* ---------- 2. 施加 ---------- */
const candidates = bills
  .filter(b => b.houseId && b.status === '已缴' && SEED_PERIODS.has(b.period)
    && monthly.has(b.itemId) && (Number(b.paidAmount) || 0) > 0 && !(Number(b.discount) > 0))
  .sort((a, b) => String(a.billId).localeCompare(String(b.billId)))

const picked = []
let i = 0
for (const b of candidates) {
  if (i++ % 17 !== 5) continue
  const cfg = REASONS[i % REASONS.length]
  const base = Number(b.payable) || Number(b.amount) || 0
  let amount = r2(base * cfg.pct)
  if (cfg.cap) amount = Math.min(amount, cfg.cap)
  if (amount < 20) continue
  const paidNow = r2((Number(b.paidAmount) || 0) - amount)
  if (paidNow < 0) continue
  b.discount = amount
  b.discountReasonId = cfg.reasonId
  b.discountReason = reasonName.get(cfg.reasonId) || ''
  b.paidAmount = paidNow
  picked.push(b)
}

/* 超额两笔：审批线 1000，1200 才看得出来 */
const big = candidates
  .filter(b => !picked.includes(b) && (Number(b.paidAmount) || 0) >= OVER.minPaid)
  .slice(0, OVER.count)
for (const b of big) {
  b.discount = OVER.amount
  b.discountReasonId = OVER.reasonId
  b.discountReason = reasonName.get(OVER.reasonId) || ''
  b.paidAmount = r2((Number(b.paidAmount) || 0) - OVER.amount)
  picked.push(b)
}

/* ---------- 3. 自检 ---------- */
const seeded = bills.filter(b => Number(b.discount) > 0)
const byReason = {}
for (const b of seeded) byReason[b.discountReason] = (byReason[b.discountReason] || 0) + 1
const bad = bills.filter(b => Math.abs((Number(b.payable) || 0)
  - (Number(b.paidAmount) || 0) - (Number(b.discount) || 0) - (Number(b.unpaid) || 0)) > 0.01
  && ['已缴', '部分缴'].includes(b.status))
const total = r2(seeded.reduce((s, b) => s + Number(b.discount), 0))

if (bad.length) {
  console.error(`恒等式不平 ${bad.length} 张（payable ≠ paidAmount + discount + unpaid），不写盘`)
  console.error(bad.slice(0, 3).map(b => b.billId))
  process.exit(1)
}

console.log(`还原 ${restored} 笔 → 施加 ${seeded.length} 笔，合计 ¥${total}`)
console.log(`  按原因`, byReason)
console.log(`  超额（>¥1000）`, seeded.filter(b => b.discount > 1000).length, '笔')

if (DRY) { console.log('--dry：不写盘'); process.exit(0) }

/* ---------- 4. 两份 mock 一起写（check.mjs 要求逐字节一致） ---------- */
for (const dir of [MOCK, MOCK2]) {
  fs.writeFileSync(path.join(dir, 'bills.json'), JSON.stringify(bills, null, 2) + '\n')
}
console.log('已写入 03 / 02 两份 mock；04 fixture 用 `gen-finance-fixtures.mjs` 重投影')
