/**
 * 报修价目样例生成（批 B）
 * ----------------------------------------------------------------
 * 价目表只有一个源：`03-原型/src/mock/repairPrices.json`。
 * 它不在 `02/mock` 里（不是种子数据，是手写的业务配置），所以 `gen-fixtures.mjs` 没带它 ——
 * `/mp/pricing` 要上线就得先把它导进 `04/fixtures`。
 *
 * **投影时剥掉三类字段**，这是本脚本存在的主要理由：
 *   `materialCost` / `laborCost` / `cost`  → 采购成本与人工成本，业主看到就等于看到毛利
 *   `projects[].commissionRate` / `minCommission` / `materialsChargedAtCost` → 提成规则
 *   `laborHourCost`                         → 工时成本
 *
 * 顺带一提：`price`（= material + labor）也不给 —— 契约里业主端按 `material` / `labor`
 * 两列展示（业主最常问"为什么人工比材料贵"），给个总价反而会诱导前端只显示总数，
 * 然后跟员工端的增项核算对不上。
 *
 * 用法：node scripts/gen-pricing-fixture.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.resolve(ROOT, '../03-原型/src/mock/repairPrices.json')
const OUT = path.join(ROOT, 'fixtures')

const read = p => JSON.parse(fs.readFileSync(p, 'utf8'))
const raw = read(SRC)

/** 业主视角的一条价目：没有成本、没有提成、没有总价 */
const project = it => ({
  code: it.code,
  category: it.category || '',
  name: it.name,
  trade: it.trade,
  material: Number(it.material) || 0,
  labor: Number(it.labor) || 0,
  unit: it.unit || '次',
  minutes: Number(it.minutes) || 0
})

const rows = {
  chargeMode: {
    prepayWhenOrder: !!raw.chargeMode?.prepayWhenOrder,
    addonPaidOnSite: !!raw.chargeMode?.addonPaidOnSite
  },
  tradeOpts: raw.tradeOpts || [],
  /* 只带"这个项目开不开"和"多久上门"，不带费率 */
  projects: (raw.projects || []).map(p => ({
    communityId: p.communityId,
    name: p.name || '',
    enabled: p.enabled !== false,
    grabArriveMinutes: Number(p.grabArriveMinutes) || 0,
    abandonLimit: Number(p.abandonLimit) || 0
  })),
  items: (raw.items || []).filter(i => i.enabled !== false).map(project),
  addons: (raw.addons || []).filter(i => i.enabled !== false).map(project)
}

fs.writeFileSync(path.join(OUT, 'repair-prices.json'), JSON.stringify(rows, null, 2) + '\n')

/* ---------------- 自检 ---------------- */
const BANNED = ['materialCost', 'laborCost', 'cost', 'price', 'commissionRate', 'minCommission']
const leaked = []
for (const it of [...rows.items, ...rows.addons]) {
  for (const k of BANNED) if (k in it) leaked.push(`${it.code}.${k}`)
}
for (const p of rows.projects) {
  for (const k of ['commissionRate', 'minCommission', 'materialsChargedAtCost']) {
    if (k in p) leaked.push(`project.${p.communityId}.${k}`)
  }
}
const dupCode = rows.items.map(i => i.code).filter((c, i, a) => a.indexOf(c) !== i)

console.log(`repair-prices.json  items ${rows.items.length} · addons ${rows.addons.length} · projects ${rows.projects.length}`)
console.log(`自检：成本/提成字段泄露 ${leaked.length}${leaked.length ? ' → ' + leaked.slice(0, 6).join(', ') : ' ✓'}`)
console.log(`自检：code 重复 ${dupCode.length} ${dupCode.length ? '→ ' + dupCode.join(',') : '✓'}`)
console.log(`充值口径：下单先付=${rows.chargeMode.prepayWhenOrder} · 增项后付=${rows.chargeMode.addonPaidOnSite}`)
if (leaked.length || dupCode.length) process.exitCode = 1
