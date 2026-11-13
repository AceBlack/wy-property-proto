/**
 * 水电 fixtures（2026-11-13 · 批 3 端上侧）
 * ------------------------------------------------------------
 * 业主端改成「抄表出账 → 待缴账单 → 缴费」之后，`/mp/utility` 需要三样东西：
 *
 *   1. **项目级的水电模式**（`community-utility`）——
 *      P01 电 meter / 水 meter、P02 电 none / 水 card、P03 电 card / 水 meter。
 *      这是"能不能在端上缴费"的唯一依据，**不是"有没有账单"**。
 *   2. **表具**（`meters`）—— 只用来给户号与类型，共 406 条（03 里有、且房屋都在 fixtures 里）。
 *   3. **抄表账单**（`bills` 里的 FI05 / FI06）—— 金额、用量、单价、账期。
 *
 * 三件里只补了两件新文件，账单是**追加**而不是新建：
 *
 *   P03 的 H030110205 是星光天地唯一有业主（赵春梅）的房。03 里它有 5 张账单，
 *   但 `gen-fixtures.mjs` 把 bills 切到 240 条时把它们切掉了 —— 04 一条都没有。
 *   端上要演示「电 card + 水 meter」并存，就得把这 5 张**原样取回来**。
 *   **不造数**：全部来自 `03-原型/src/mock/bills.json`，逐字段照抄（只补 `meterReading`
 *   / `lastReading` 两个读数，也是原数据里就有的）。
 *
 * 另一个口径：这批 5 张里有一张**电费逾期单**（P03 的电是 card 模式）。
 * 这是真实存在的数据矛盾（样板数据早于项目模式配置），正好用来钉住
 * "card 模式即使有账单也不给支付入口" —— 见契约 `MpUtilityAccount.canPay`。
 *
 * 幂等：只按 id 追加/覆盖，重跑哈希不变。
 * 用法：node scripts/gen-utility-fixtures.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* 目录名带中文，`new URL(...).pathname` 会给出百分号编码的路径 —— 必须走 fileURLToPath */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FX = path.join(HERE, '..', 'fixtures')
const SRC = path.join(HERE, '..', '..', '03-原型', 'src', 'mock')

const readFx = f => JSON.parse(fs.readFileSync(path.join(FX, `${f}.json`), 'utf8'))
const readSrc = f => JSON.parse(fs.readFileSync(path.join(SRC, `${f}.json`), 'utf8'))
const write = (f, rows) => fs.writeFileSync(path.join(FX, `${f}.json`), JSON.stringify(rows, null, 2) + '\n')

const houses = readFx('houses')
const houseIds = new Set(houses.map(h => h.houseId))
const houseOf = new Map(houses.map(h => [h.houseId, h]))

/* ---------------- 一、项目水电模式 ---------------- */

const utilRows = readSrc('communityUtility').map(u => ({
  communityId: u.communityId,
  elec: u.elec,
  water: u.water,
  updatedAt: u.updatedAt,
  updatedBy: u.updatedBy
}))

const MODES = ['meter', 'card', 'none']
for (const u of utilRows) {
  if (!MODES.includes(u.elec) || !MODES.includes(u.water)) throw new Error(`${u.communityId} 模式非法`)
  if (!houses.some(h => h.communityId === u.communityId)) {
    throw new Error(`${u.communityId} 在 fixtures 里没有房屋`)
  }
}

/* ---------------- 二、表具 ---------------- */

const METER_KEYS = [
  'meterId', 'meterNo', 'type', 'unit', 'communityId', 'communityName',
  'houseId', 'houseName', 'ownerId', 'ownerName', 'itemId', 'itemName',
  'installDate', 'lastReading', 'lastReadDate', 'status', 'factor'
]
const METER_ITEM = { 水表: 'FI05', 电表: 'FI06' }

const meters = readSrc('meters')
  .filter(m => houseIds.has(m.houseId))
  .map(m => {
    const o = {}
    for (const k of METER_KEYS) if (m[k] !== undefined) o[k] = m[k]
    return o
  })

for (const m of meters) {
  const h = houseOf.get(m.houseId)
  if (!h) throw new Error(`表具 ${m.meterId} 指向不存在的房屋 ${m.houseId}`)
  if (h.communityId !== m.communityId) {
    throw new Error(`表具 ${m.meterId} 的项目 ${m.communityId} 与房屋 ${h.communityId} 不一致`)
  }
  if (METER_ITEM[m.type] !== m.itemId) {
    throw new Error(`表具 ${m.meterId} 类型 ${m.type} 与科目 ${m.itemId} 不匹配`)
  }
}

/* ---------------- 三、抄表账单 ---------------- */

const srcBills = new Map(readSrc('bills').map(b => [b.billId, b]))
const bills = readFx('bills')
const existing = new Set(bills.map(b => b.billId))

/* ① 已有账单：补 `meterReading` / `lastReading`（只有水电单有），供端上回答"怎么用了这么多" */
let readingPatched = 0
for (const b of bills) {
  if (b.itemId !== 'FI05' && b.itemId !== 'FI06') continue
  const src = srcBills.get(b.billId)
  if (!src || b.meterReading !== undefined) continue
  if (src.meterReading === undefined && src.lastReading === undefined) continue
  if (src.meterReading !== undefined) b.meterReading = src.meterReading
  if (src.lastReading !== undefined) b.lastReading = src.lastReading
  readingPatched++
}

/* ② P03 演示房：把被切片丢掉的 5 张取回来（原样，字段一个不改） */
const DEMO_P03 = 'H030110205'
const added = []
for (const b of readSrc('bills')) {
  if (b.houseId !== DEMO_P03 || existing.has(b.billId)) continue
  bills.push({ ...b })
  added.push(b)
}

/* ---------------- 自检 ---------------- */

const byId = new Map(bills.map(b => [b.billId, b]))
if (byId.size !== bills.length) throw new Error('账单 id 重复')

for (const b of bills) {
  /* 车位账单的 `houseId` 是空串（挂 `parkId`），不是孤儿 —— 这条 check 以前写成
     "必须有 houseId"，会给 15 条车位费误报 */
  if (!b.houseId) {
    if (!b.parkId) throw new Error(`账单 ${b.billId} 既没有房屋也没有车位`)
    continue
  }
  if (!houseIds.has(b.houseId)) throw new Error(`账单 ${b.billId} 指向不存在的房屋`)
  const h = houseOf.get(b.houseId)
  if (h.communityId !== b.communityId) throw new Error(`账单 ${b.billId} 项目与房屋不一致`)
}

/* 三个项目都要能演示到：meter / card / none 各至少出现一次 */
const seen = new Set(utilRows.flatMap(u => [u.elec, u.water]))
for (const m of MODES) if (!seen.has(m)) throw new Error(`模式 ${m} 没有任何项目在用，端上三态演示不全`)

/* 每个 meter 模式的项目至少有一套可演示的房（有业主、有账单或至少有表） */
const demo = {
  P01: 'H010110501',
  P02: 'H020110601',
  P03: DEMO_P03
}
for (const [c, hid] of Object.entries(demo)) {
  const h = houseOf.get(hid)
  if (!h || h.communityId !== c) throw new Error(`演示房 ${hid} 不属于 ${c}`)
  if (!h.ownerId) throw new Error(`演示房 ${hid} 没有业主，登不进去`)
}

write('community-utility', utilRows)
write('meters', meters)
write('bills', bills)

const utilBills = bills.filter(b => b.itemId === 'FI05' || b.itemId === 'FI06')
console.log(`✔ 项目模式 ${utilRows.length}（${utilRows.map(u => `${u.communityId} 电${u.elec}/水${u.water}`).join(' · ')}）`)
console.log(`✔ 表具 ${meters.length}（水 ${meters.filter(m => m.type === '水表').length} / 电 ${meters.filter(m => m.type === '电表').length}）`)
console.log(`✔ 账单 ${bills.length}（水电 ${utilBills.length}），补读数 ${readingPatched} 条，追加 P03 演示房 ${added.length} 条`)
for (const [c, hid] of Object.entries(demo)) {
  const u = utilRows.find(x => x.communityId === c)
  const ms = meters.filter(m => m.houseId === hid)
  const bs = bills.filter(b => b.houseId === hid && (b.itemId === 'FI05' || b.itemId === 'FI06'))
  console.log(`  · ${c} ${hid} 电${u.elec}/水${u.water} · 表 ${ms.length} · 水电账单 ${bs.length}（欠 ${bs.filter(b => (b.unpaid || 0) > 0).length}）`)
}
