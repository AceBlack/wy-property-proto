/**
 * 押金 fixture 从「合成 12 条」换成「投影真实 352 条」（2026-11-14）
 * ------------------------------------------------------------
 * 原来 `04/mock-server.mjs` 里的押金是**现场造**的：拿前 12 套房、类型轮换、
 * 金额按标准额、退款/扣款按下标取模。能跑通接口，但三个问题：
 *   ① 报表（押金在账）算出来的在账余额和真实台账没关系，数字对不上 03；
 *   ② 分页 / 按类型筛选 / 按状态筛选都只有 12 条可玩，翻不出边界；
 *   ③ 与「收 = 退 + 扣 + 在账」的演示口径脱节 —— 恒等式成立，但成立得很假。
 *
 * 这里按契约 `Deposit` schema 的字段投影 03 的 `decorationDeposits.json`：
 *   - 只保留 schema 声明过的字段（多出来的 houseName / ownerName / phone / overdueDays
 *     是页面展示用的，契约里没有，传过去后端会以为要建列）；
 *   - `quantity` 补 1（契约有、03 没有）；
 *   - 日期类 null 统一成 ''（schema 里只有 checkDate / refundDate 允许 null）。
 *
 * 幂等：纯投影，重复跑结果一致。
 *
 *   node scripts/gen-deposit-fixtures.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SRC = path.resolve(ROOT, '..', '03-原型', 'src', 'mock', 'decorationDeposits.json')
const OUT = path.join(ROOT, 'fixtures', 'deposits.json')

/* 与 openapi.yaml 的 Deposit 一一对应，多一个都不要 */
const KEYS = [
  'depositId', 'applyNo', 'type', 'communityId', 'houseId', 'ownerId',
  'amount', 'quantity', 'paidDate', 'startDate', 'planEndDate', 'checkDate',
  'status', 'deductAmount', 'deductReason', 'refundAmount', 'refundDate',
  'balance', 'operator', 'remark',
  /* 2026-11-15：收款方式与收款点。没有这两组字段，押金就进不了经营日报的收款点，
     日结差额只能把押金整段排除 —— 那是数据缺字段，不是口径选择。 */
  'payMethod', 'payPoint', 'refundMethod', 'refundPoint'
]
const OPTIONAL_NULL = new Set(['checkDate', 'refundDate'])
const NUM = new Set(['amount', 'quantity', 'deductAmount', 'refundAmount', 'balance'])
const r2 = n => Math.round((Number(n) || 0) * 100) / 100

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const rows = src.map(d => {
  const out = {}
  for (const k of KEYS) {
    if (NUM.has(k)) {
      out[k] = k === 'quantity' ? (Number(d[k]) || 1) : r2(d[k])
      continue
    }
    if (OPTIONAL_NULL.has(k)) {
      out[k] = d[k] || null
      continue
    }
    out[k] = d[k] === null || d[k] === undefined ? '' : d[k]
  }
  return out
})

/* 落盘前自检：恒等式与引用闭合不通过就别写了，改数据的人要知道 */
const bad = rows.filter(r => Math.abs(r.amount - r.refundAmount - r.deductAmount - r.balance) > 0.01)
if (bad.length) {
  console.error(`恒等式不平 ${bad.length} 条，先修数据：`, bad.slice(0, 3).map(x => x.depositId))
  process.exit(1)
}
const houses = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'houses.json'), 'utf8')).map(h => h.houseId))
const owners = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'owners.json'), 'utf8')).map(o => o.ownerId))
const orphanHouse = rows.filter(r => r.houseId && !houses.has(r.houseId))
const orphanOwner = rows.filter(r => r.ownerId && !owners.has(r.ownerId))
if (orphanHouse.length || orphanOwner.length) {
  console.error(`引用不闭合：房屋孤儿 ${orphanHouse.length} 条、业主孤儿 ${orphanOwner.length} 条`)
  process.exit(1)
}

fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n')

const by = k => rows.reduce((m, r) => { m[r[k]] = (m[r[k]] || 0) + 1; return m }, {})
const sum = k => r2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0))
console.log(`押金 ${rows.length} 条 → fixtures/deposits.json`)
console.log('  按类型', by('type'))
console.log('  按状态', by('status'))
console.log(`  收 ${sum('amount')} / 退 ${sum('refundAmount')} / 扣 ${sum('deductAmount')} / 在账 ${sum('balance')}`)
