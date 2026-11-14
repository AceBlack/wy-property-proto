#!/usr/bin/env node
/**
 * 作废「项目模式不收、却有账单」的水电账单（2026-11-14）
 * ------------------------------------------------------------
 * 水电账单是种子按「每套房 60% 概率出一张」造的，**完全不看项目模式**。于是：
 *
 *   P01 翡翠城   水 meter / 电 meter  → 348 + 306 张，全部合理
 *   P02 锦绣家园 水 card  / 电 none   → 233 + 231 张，**一张都不该有**
 *   P03 星光天地 水 meter / 电 card   →   106 + 103 张，电费这 103 张不该有
 *
 * 插卡表是业主到物业买量插表，国网直收是业主自己交给供电局 —— 两种情况下物业都不该有
 * 这笔应收。端上早就按模式不展示了（06 `utility.js` 的 canPay 只看 meter），
 * 但后台账单列表、欠费、三率报表里这些账还挂着，演示时两边一对就露馅。
 *
 * 处理方式：**作废，不删除**。口径与种子里原有的 11 张已作废账单一致 ——
 * 只改 `status`，金额字段一个不动（`payable = 已收 + 减免 + 未收` 仍成立），
 * 欠费统计按状态排除。真实系统里错开的单也是作废，不是删行。
 *
 * 两个必须留的例外（不是漏掉）：
 *   赵春梅 H030110205 的两张未缴电费 —— 它是 04 契约与 06 `check-data` 里
 *   「card 模式即使有账单也不给支付入口」的唯一反例（`canPay = mode===='meter' && 有账单`）。
 *   一起作废，那条守卫就没有东西可钉了。
 *
 * 幂等：已作废的跳过，重复跑不产生变化。
 *
 *   node scripts/void-card-mode-bills.mjs --dry
 *   node scripts/void-card-mode-bills.mjs
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

/** 反例：这两张留着钉「模式优先于账单」，别顺手一起作废 */
const KEEP = new Set(['H030110205'])

const bills = readJson(path.join(SRC_MOCK, 'bills.json'))
const commUtil = readJson(path.join(SRC_MOCK, 'communityUtility.json'))
const modeOf = cid => commUtil.find(x => x.communityId === cid) || { water: 'meter', elec: 'meter' }

const before = bills.reduce((m, b) => {
  const k = `${b.communityId}|${b.itemName}`
  m[k] = (m[k] || 0) + 1
  return m
}, {})

const touched = []
for (const b of bills) {
  if (b.itemName !== '水费' && b.itemName !== '电费') continue
  if (b.status === '已作废') continue
  const mode = modeOf(b.communityId)[b.itemName === '水费' ? 'water' : 'elec']
  if (mode === 'meter') continue              /* 抄表出账才有应收，这是唯一合法的模式 */
  if (KEEP.has(b.houseId)) continue           /* 反例留一张 */
  b.status = '已作废'
  touched.push(b)
}

/* ---------------- 自检 ---------------- */
const fail = []
const live = k => bills.filter(b => `${b.communityId}|${b.itemName}` === k && b.status !== '已作废').length

for (const k of ['P02|水费', 'P02|电费']) {
  if (live(k) !== 0) fail.push(`${k} 还剩 ${live(k)} 张未作废（该项目不是抄表出账，不该有应收）`)
}
if (live('P03|电费') !== 2) fail.push(`P03 电费应只剩 2 张反例，实际 ${live('P03|电费')}`)
if (live('P03|水费') !== before['P03|水费']) fail.push('P03 水费是 meter，不该被动')
if (live('P01|水费') !== before['P01|水费']) fail.push('P01 水费不该被动')
if (live('P01|电费') !== before['P01|电费']) fail.push('P01 电费不该被动')
if (bills.length !== 4884) fail.push(`账单总数应仍是 4884，实际 ${bills.length}`)

/* 金额一个都不能动：作废只改状态，改金额会让契约里的 payable 恒等式当场破。
   用容差比，不用 === —— 35.87 + 77.59 这种相加会带出 1e-14 的浮点尾差。 */
for (const b of touched) {
  const sum = Number(b.paidAmount) + Number(b.discount) + Number(b.unpaid)
  if (Math.abs(Number(b.payable) - sum) > 0.02) {
    fail.push(`${b.billId} 作废后 payable ${b.payable} ≠ 已收 + 减免 + 未收 ${sum}`)
  }
}

if (fail.length) {
  console.error(`自检失败 ${fail.length} 条：`)
  fail.slice(0, 8).forEach(x => console.error('  · ' + x))
  process.exit(1)
}

const byComm = touched.reduce((m, b) => {
  const k = `${b.communityId}${b.itemName}`
  m[k] = (m[k] || 0) + 1
  return m
}, {})
const waivedSum = touched.reduce((s, b) => s + (Number(b.unpaid) || 0), 0)

console.log(`作废 ${touched.length} 张（只改状态，金额未动）`)
console.log('  按项目科目', byComm)
console.log(`  连带清掉未缴应收 ¥${Math.round(waivedSum * 100) / 100}`)
console.log(`  反例保留：赵春梅 H030110205 两张未缴电费`)

if (DRY) { console.log('\n--dry：未写盘'); process.exit(0) }

const text = JSON.stringify(bills, null, 2) + '\n'
fs.writeFileSync(path.join(SRC_MOCK, 'bills.json'), text)
fs.writeFileSync(path.join(DUP_MOCK, 'bills.json'), text)
console.log('\n已写入 src/mock/bills.json 与 02-原型设计/mock/bills.json')
