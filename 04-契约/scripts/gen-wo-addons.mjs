/**
 * 给 work-orders 增量补「增项 / 已付 / 评价」三组字段（批 C）
 * ----------------------------------------------------------------
 * 为什么必须补：
 *   `fixtures/work-orders.json` 里 **一条 `addons` 都没有**。业主端的「三段金额」
 *   （原价 / 增项 / 确认后合计）、「待确认 N 项」、「确认后补付差额」全部依赖它，
 *   没有数据就只能让接口返回 0，那样批 C 等于没验。
 *
 * 为什么是增量脚本而不是重跑 gen-fixtures：
 *   见 `gen-fixtures.mjs` 头部那段 —— `fixtures/` 是 2026-10-30 的快照（houses 220），
 *   重跑会缩成 160，引用全断。
 *
 * 补的四组（目标单写死 woId，不随机 —— 随机的话每次跑出来的演示数字都不一样）：
 *   ① 所有单：`addons`（缺的补空数组）、`paidAmount`（已支付的 = 总额）
 *   ② WO000001（张建国 H010110501）：改成「已预付 125 + 待确认增项 80」
 *      → 首页"待确认 1 项"、详情三段金额 125 / 80 / 205、确认后补付 80。
 *        这一单是业主端演示身份唯一能点到的收费单，不改它就没法演示批 C。
 *   ③ WO000116（真实待确认单，收费已预付）：加一条待确认增项 60
 *   ④ WO000019 / WO000031（已完工、收费、已支付）：加一条**已确认**增项 40，
 *      总额跟着涨、已付不变 → 待付 40，用来验"已完工但还欠增项款"
 *   ⑤ 已评价单：补 `evalTags` / `evaluate` / `evaluateAt`（契约里评价写的就是这三列）
 *
 * 幂等：按 `addons[].code` 判断，重复执行不会叠加。
 * 用法：node scripts/gen-wo-addons.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'fixtures/work-orders.json')
const PRICES = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/repair-prices.json'), 'utf8'))

const rows = JSON.parse(fs.readFileSync(OUT, 'utf8'))
const addonOf = code => {
  const it = PRICES.addons.find(a => a.code === code)
  if (!it) throw new Error(`增项价目里没有 ${code}`)
  return {
    code: it.code,
    name: it.name,
    qty: 1,
    material: it.material,
    labor: it.labor,
    total: Math.round((it.material + it.labor) * 100) / 100
  }
}
const r2 = n => Math.round((Number(n) || 0) * 100) / 100

/* ① 全量补底字段 */
for (const w of rows) {
  if (!Array.isArray(w.addons)) w.addons = []
  /* 已支付 = 全额预付；其余 0。注意增项确认后总额会涨，`paidAmount` 不能跟着涨 ——
     涨了就变成"增项也付过了"，补付那笔钱再也收不上来。 */
  if (w.paidAmount === undefined) w.paidAmount = w.payStatus === '已支付' ? r2(w.totalFee) : 0
}

const byId = new Map(rows.map(w => [w.woId, w]))
const addIfMissing = (w, addon, confirmed, at) => {
  if (w.addons.some(a => a.code === addon.code)) return false
  w.addons.push({
    ...addon,
    at: at || '2026-10-21 15:20',
    by: w.assignee || '莫瑞',
    confirmed,
    ...(confirmed ? { confirmedAt: at || '2026-10-21 15:40', confirmedBy: '业主（小程序）' } : {})
  })
  return true
}

let touched = 0

/* ② 张建国的演示单：已预付 125 + 待确认增项 80 */
const demo = byId.get('WO000001')
if (demo) {
  demo.status = '待确认'
  demo.payStatus = '已支付'
  demo.paidAmount = r2(demo.totalFee) // 125：原价已预付，增项还没确认
  demo.acceptTime = demo.acceptTime || '2026-10-21 10:05'
  demo.arriveTime = demo.arriveTime || '2026-10-21 10:40'
  if (addIfMissing(demo, addonOf('AD-D01'), false, '2026-10-21 11:20')) touched += 1
}

/* ③ 真实待确认单：加一条待确认增项 */
const real = byId.get('WO000116')
if (real && addIfMissing(real, addonOf('AD-D04'), false, '2026-10-20 16:10')) touched += 1

/* ④ 已完工两单：已确认增项，总额上涨、已付不变 → 待付 40 */
for (const id of ['WO000019', 'WO000031']) {
  const w = byId.get(id)
  if (!w || w.addons.some(a => a.code === 'AD-D05')) continue
  const addon = addonOf('AD-D05')
  addIfMissing(w, addon, true, '2026-10-20 17:05')
  w.totalFee = r2(w.totalFee + addon.total)
  w.payStatus = '未支付' // 还欠增项那 40
  touched += 1
}

/* ⑤ 已评价单补评价三列 */
const TAGS = ['准时上门', '讲解清楚', '收拾干净', '收费透明']
const TEXTS = [
  '师傅来得准时，问题说明得很清楚。',
  '处理得挺利索，走的时候把地也擦了。',
  '价格提前说清了，没有临时加钱。'
]
let evaled = 0
for (const w of rows) {
  if (w.status !== '已评价' || !w.score) continue
  if (Array.isArray(w.evalTags) && w.evalTags.length) continue
  w.evalTags = TAGS.slice(0, 1 + (Number(w.score) % 3))
  w.evaluate = TEXTS[Number(w.score) % TEXTS.length]
  w.evaluateAt = w.finishTime || '2026-10-20 18:00'
  evaled += 1
}

fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n')

/* ---------------- 自检 ---------------- */
const bad = []
for (const w of rows) {
  const confirmedAddon = r2(w.addons.filter(a => a.confirmed).reduce((s, a) => s + a.total, 0))
  const origin = r2((w.materialFee || 0) + (w.laborFee || 0))
  /* 总额只能等于「原价 + 已确认增项」：待确认的还没合并进来，不能提前算进总额 */
  if (Math.abs(r2(w.totalFee) - r2(origin + confirmedAddon)) > 0.02) {
    bad.push(`${w.woId} 总额 ${w.totalFee} ≠ 原价 ${origin} + 已确认增项 ${confirmedAddon}`)
  }
  if (w.paidAmount > w.totalFee + 0.02) bad.push(`${w.woId} 已付 ${w.paidAmount} > 总额 ${w.totalFee}`)
  for (const a of w.addons) {
    if (Math.abs(a.total - r2(a.material * a.qty + a.labor * a.qty)) > 0.02) bad.push(`${w.woId} 增项 ${a.code} 合计不符`)
  }
}
const pend = rows.filter(w => w.addons.some(a => !a.confirmed))
console.log(`work-orders.json  ${rows.length} 单`)
console.log(`  增项：补了 ${touched} 处 · 有待确认增项的单 ${pend.length}（${pend.map(w => w.woId).join(',')}）`)
console.log(`  评价：补了 ${evaled} 单`)
console.log(`  预付：已支付的 ${rows.filter(w => w.paidAmount > 0).length} 单`)
console.log(`自检：金额不自洽 ${bad.length}${bad.length ? '\n    ' + bad.slice(0, 6).join('\n    ') : ' ✓'}`)
if (bad.length) process.exitCode = 1
