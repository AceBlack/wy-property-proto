#!/usr/bin/env node
/**
 * 水电账单三列对不上的修复（2026-11-14）
 * ------------------------------------------------------------
 * 现象：1327 张水电单里，903 张 `用量 × 单价 ≠ 金额`；1327 张的
 * `本期读数 − 上期读数 ≠ 用量`（读数差对不上的 1324 张）。
 *
 * 根因在种子 `02-原型设计/seed_dataset.py`（水电那段），三个字段各有三个来源：
 *
 *   用量 quantity  ← 正确（就是本期用量，量级也对：水 6~32 吨 / 电 80~520 度）
 *   单价 price     ← 写死成收费项的**基准价**（水 4.20 / 电 0.62）
 *   金额 amount    ← 按**阶梯价**算的（水 4.20 / 5.60 / 7.35，电 0.62 / 0.68 / 0.92）
 *   本期读数       ← `meterReading = 用量`（把用量抄进了读数列）
 *   上期读数       ← `用量 − random(5,40)`，所以会出现负数
 *
 * 也就是说：**错的不是金额，是单价列和读数两列。** 交接单 §33.5 当时判成
 * 「quantity 存的是本期读数」，方向反了 —— 账单金额 = 用量 × 阶梯价，1327/1327 全部成立，
 * 一分钱都不用改。真要改金额，会连带 51 条契约断言、报表三率、收缴率一起飘。
 *
 * 改法（按《开发计划》§二 第 4 条「计量项单价取收费项，**单据存快照**」）：
 *
 *   1. `price` ← `amount ÷ quantity` = 该单**实际执行**的阶梯价（快照）。
 *      算出来必须正好落在收费项 remark 写的档位集合里，否则报错退出 ——
 *      这一条是防"以后有人改了金额却没改档位"。
 *   2. `lastReading / meterReading` ← 以表具 `lastReading` 为锚，按账期逐期推进，
 *      保证 `本期读数 − 上期读数 = 用量`。表具缺失的按「房屋 + 表类」取确定基数
 *      （同一套房每次跑结果一致，不随机）。
 *
 * 金额、应收、已收、欠费、滞纳金、账龄一个数都不动。
 *
 * 幂等：单价是幂等赋值；读数链是从锚点重算的，不读旧读数，所以重复跑结果一致。
 *
 *   node scripts/fix-meter-bills.mjs --dry     # 只报告，不写盘
 *   node scripts/fix-meter-bills.mjs           # 落盘（03/src/mock 与 02/原型设计/mock 双写）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SRC_MOCK = path.join(ROOT, 'src', 'mock')
const DUP_MOCK = path.resolve(ROOT, '..', '02-原型设计', 'mock')
const DRY = process.argv.includes('--dry')

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'))
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const r1 = n => Math.round((Number(n) || 0) * 10) / 10

/* 阶梯档位：与 feeItems.json 的 remark 一一对应，写死在这里是有意的 ——
   从 remark 里正则解析价格，改错一个标点就静默失效 */
const LADDER = {
  水费: { itemId: 'FI05', type: '水表', unit: '吨', prices: [4.2, 5.6, 7.35], est: 15, base: [120, 2000] },
  电费: { itemId: 'FI06', type: '电表', unit: '度', prices: [0.62, 0.68, 0.92], est: 250, base: [3000, 12000] }
}

const bills = readJson(path.join(SRC_MOCK, 'bills.json'))
const meters = readJson(path.join(SRC_MOCK, 'meters.json'))

/* ---------------- 1. 单价改快照 ---------------- */

const bills0 = bills.map(b => ({ ...b }))          // 改动前快照，用来对拍"金额没动"
const util = bills.filter(b => LADDER[b.itemName])
const priceErrors = []

for (const b of util) {
  const spec = LADDER[b.itemName]
  const q = Number(b.quantity)
  if (!(q > 0)) { priceErrors.push(`${b.billId} 用量为 ${b.quantity}，无法反推单价`); continue }
  const p = r2(Number(b.amount) / q)
  /* 容差 1 分：金额是两位小数的乘积，反推回来可能差 0.01 */
  const hit = spec.prices.find(x => Math.abs(x - p) <= 0.011)
  if (!hit) { priceErrors.push(`${b.billId} ${b.itemName} 金额 ${b.amount} ÷ 用量 ${q} = ${p}，不在档位 ${spec.prices.join('/')} 内`); continue }
  b.price = hit
}

if (priceErrors.length) {
  console.error(`单价反推失败 ${priceErrors.length} 条，先查种子：`)
  priceErrors.slice(0, 5).forEach(x => console.error('  · ' + x))
  process.exit(1)
}

/* ---------------- 2. 读数链 ---------------- */

/** 没有表具时的确定基数：同一套房子每次跑都得到同一个数，不引入随机 */
const hashOf = s => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0)
}
const baseOf = (houseId, spec) => {
  const [lo, hi] = spec.base
  return r1(lo + (hashOf(houseId + '|' + spec.type) % 1000) / 1000 * (hi - lo))
}

/* 锚点：优先表具台账里的 lastReading（该表 2026-07-31 的末次读数） */
const meterAnchor = new Map()
for (const m of meters) meterAnchor.set(m.houseId + '|' + m.type, Number(m.lastReading) || 0)

const periods = [...new Set(util.map(b => b.period))].sort()
const groups = new Map()                            // houseId|表类 → 该组的账单
for (const b of util) {
  const spec = LADDER[b.itemName]
  const key = b.houseId + '|' + spec.type
  if (!groups.has(key)) groups.set(key, { houseId: b.houseId, spec, rows: [] })
  groups.get(key).rows.push(b)
}

let advanced = 0
for (const g of groups.values()) {
  g.rows.sort((a, b) => String(a.period).localeCompare(String(b.period)))
  const anchor = meterAnchor.get(g.houseId + '|' + g.spec.type)
  let prev = anchor !== undefined ? r1(anchor) : baseOf(g.houseId, g.spec)

  /* 从第一张单那一期走到最后一期；中间没有单的月份表照样走，
     否则 09 期没出账、10 期的"上期读数"会回退成 08 期的数，读起来像倒转 */
  const first = g.rows[0].period
  const last = g.rows[g.rows.length - 1].period
  const span = periods.filter(p => p >= first && p <= last)
  const est = g.rows.length
    ? r1(g.rows.reduce((s, b) => s + Number(b.quantity), 0) / g.rows.length)
    : g.spec.est

  for (const p of span) {
    const row = g.rows.find(b => b.period === p)
    if (!row) { prev = r1(prev + est); advanced += 1; continue }
    row.lastReading = String(prev)
    row.meterReading = String(r1(prev + Number(row.quantity)))
    prev = Number(row.meterReading)
  }
}

/* ---------------- 3. 落盘前自检 ---------------- */

const fail = []
for (const b of util) {
  const q = Number(b.quantity), p = Number(b.price), a = Number(b.amount)
  if (Math.abs(q * p - a) > 0.02) fail.push(`${b.billId} 量×价 ${r2(q * p)} ≠ 金额 ${a}`)
  const cur = Number(b.meterReading), pre = Number(b.lastReading)
  if (!Number.isFinite(cur) || !Number.isFinite(pre)) { fail.push(`${b.billId} 读数缺失`); continue }
  if (Math.abs((cur - pre) - q) > 0.05) fail.push(`${b.billId} 读数差 ${r1(cur - pre)} ≠ 用量 ${q}`)
  if (pre < 0) fail.push(`${b.billId} 上期读数为负 ${pre}`)
  if (cur <= pre) fail.push(`${b.billId} 本期读数 ${cur} 未大于上期 ${pre}`)
}
const sum = k => Math.round(bills0.filter(b => LADDER[b.itemName]).reduce((s, b) => s + Number(b[k] || 0), 0) * 100) / 100
if (sum('amount') !== Math.round(util.reduce((s, b) => s + Number(b.amount), 0) * 100) / 100) {
  fail.push('金额合计变了 —— 这一列不该被碰')
}
if (fail.length) {
  console.error(`自检失败 ${fail.length} 条：`)
  fail.slice(0, 8).forEach(x => console.error('  · ' + x))
  process.exit(1)
}

const before = bills0.filter(b => LADDER[b.itemName])
const priced = before.filter((b, i) => Number(b.price) !== Number(util[i].price)).length
console.log(`水电账单 ${util.length} 张`)
console.log(`  单价改快照 ${priced} 张（其余 ${util.length - priced} 张本来就是基准价档位）`)
console.log(`  读数链重排 ${util.length} 张，其中跨过 ${advanced} 个"没出账但表在走"的月份`)
console.log(`  量×价 = 金额  ${util.filter(b => Math.abs(Number(b.quantity) * Number(b.price) - Number(b.amount)) <= 0.02).length}/${util.length}`)
console.log(`  读数差 = 用量  ${util.filter(b => Math.abs((Number(b.meterReading) - Number(b.lastReading)) - Number(b.quantity)) <= 0.05).length}/${util.length}`)
console.log(`  金额合计 ${sum('amount')}（未变）`)

if (DRY) { console.log('\n--dry：未写盘'); process.exit(0) }

const text = JSON.stringify(bills, null, 2) + '\n'
fs.writeFileSync(path.join(SRC_MOCK, 'bills.json'), text)
fs.writeFileSync(path.join(DUP_MOCK, 'bills.json'), text)
console.log(`\n已写入 src/mock/bills.json 与 02-原型设计/mock/bills.json`)
