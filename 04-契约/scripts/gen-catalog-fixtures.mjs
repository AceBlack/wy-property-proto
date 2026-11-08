/**
 * 房产档案 fixtures 补齐（第 78 批）
 * ----------------------------------------------------------------
 * 为什么写增量脚本而不是重跑 `gen-fixtures.mjs`：那份脚本切片 160 户、字段清单也不一样，
 * 重跑会把 220 户压回 160 户，`bills` / `tenants` 里指向 161~220 的房号立刻变孤儿。
 * 这里只做加法：**现有 220 户逐字节保留**，把缺的 536 户按源数据顺序追加。
 *
 * 补这件事的直接原因：业主端「选房三级」（小区 / 楼栋 / 房间）是最后一处读本地房产档案的页面。
 * 它要显示 3 个小区 / 17 栋楼 / 756 间房，而 fixtures 只有 220 户，切过去就会变成
 * 「页面上点得到的房号，服务端不认」—— 绑定那一步 403，比不切更糟。
 *
 * 附带补两张小表：`buildings`（17）与 `units`（32）。此前假服务靠房屋全名里抠「N栋」
 * 现猜楼栋名（`buildingNameOf`），选房页要展示户数 / 层数 / 单元数，猜不出来。
 *
 * 口径：
 *   ① 只投影契约里声明过的字段（多出来的字段会让后端以为要建列）；
 *   ② `ownerId` 保留源数据的真值，不为"引用闭合"造假 —— 业主档案本来就只导了 60 条，
 *      houses 指向档案外的业主是**样例的固有状态**（改动前 220 户里已有 157 条如此）；
 *   ③ `communities.houseCount` 按真实房号数校正（P02 原写 264，源数据 284），
 *      并补上选房页要显示的 `address`。
 *
 * 用法：node scripts/gen-catalog-fixtures.mjs
 * 自检：脚本末尾直接校验楼栋户数 / 单元数 / bills / tenants 引用，任何一条不闭合就退出 1。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.resolve(ROOT, '../03-原型/src/mock')
const OUT = path.join(ROOT, 'fixtures')

const readSrc = f => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'))
const readFx = f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))
const write = (name, rows) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(rows, null, 2) + '\n')
  console.log(`  ${name}  ${Array.isArray(rows) ? rows.length + ' 条' : '对象'}`)
}

/** 与既有 220 户**同一套字段、同一顺序**（顺序不同会让整文件 diff 成一团） */
const HOUSE_KEYS = [
  'houseId', 'communityId', 'buildingId', 'unitId', 'room', 'floor',
  'fullName', 'shortName', 'usage', 'houseType', 'area', 'innerArea',
  'deliverStatus', 'useStatus', 'propertyStatus', 'ownerId', 'tenantId', 'stewardEmpId',
  'deliverDate', 'decorationViolation', 'decorationResult', 'orientation'
]
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]))

/* ============================ ① 房屋：220 → 756 ============================ */
const srcHouses = readSrc('houses.json')
const fxHouses = readFx('houses.json')
const have = new Set(fxHouses.map(h => h.houseId))
const added = srcHouses.filter(h => !have.has(h.houseId)).map(h => pick(h, HOUSE_KEYS))

/* 追加而不是重排：分页用例、按房号查详情都依赖现有顺序稳定 */
const houses = [...fxHouses, ...added]
write('houses.json', houses)

/* ============================ ② 楼栋 / 单元 ============================ */
const srcBuildings = readSrc('buildings.json')
const srcUnits = readSrc('units.json')

const houseCountOf = key => id => houses.filter(h => h[key] === id).length
const countByBuilding = houseCountOf('buildingId')
const countByUnit = houseCountOf('unitId')

/**
 * 户数按房号实算，不用源表里那个手写数字 —— 两者当前一致（脚本会校验），
 * 但一旦某天房号表变了，"实算"不会跟着错。
 */
const buildings = srcBuildings.map(b => ({
  buildingId: b.buildingId,
  communityId: b.communityId,
  buildingNo: b.buildingNo,
  name: b.name,
  usage: b.usage,
  unitCount: b.unitCount,
  floorCount: b.floorCount,
  houseCount: countByBuilding(b.buildingId),
  hasElevator: !!b.hasElevator
}))
write('buildings.json', buildings)

const units = srcUnits.map(u => ({
  unitId: u.unitId,
  buildingId: u.buildingId,
  communityId: u.communityId,
  unitNo: u.unitNo,
  name: u.name,
  floorCount: u.floorCount,
  housePerFloor: u.housePerFloor
}))
write('units.json', units)

/* ============================ ③ 小区：补地址、校正户数 ============================ */
const srcCommunities = readSrc('communities.json')
const fxCommunities = readFx('communities.json')
const countByCommunity = houseCountOf('communityId')
const communities = fxCommunities.map(c => {
  const src = srcCommunities.find(x => x.communityId === c.communityId) || {}
  return {
    ...c,
    houseCount: countByCommunity(c.communityId),
    /* 选房页第二行要显示「地址 · N 户」，没有地址就只剩一个数字 */
    ...(src.address ? { address: src.address } : {})
  }
})
write('communities.json', communities)

/* ============================ ④ 自检 ============================ */
const problems = []
const ids = new Set(houses.map(h => h.houseId))
if (ids.size !== houses.length) problems.push('houseId 有重复')
if (new Set(buildings.map(b => b.buildingId)).size !== buildings.length) problems.push('buildingId 有重复')
if (new Set(units.map(u => u.unitId)).size !== units.length) problems.push('unitId 有重复')

for (const h of houses) {
  if (!buildings.some(b => b.buildingId === h.buildingId)) problems.push(`房号 ${h.houseId} 的楼栋 ${h.buildingId} 不在表里`)
  if (!units.some(u => u.unitId === h.unitId)) problems.push(`房号 ${h.houseId} 的单元 ${h.unitId} 不在表里`)
}
for (const b of srcBuildings) {
  const real = countByBuilding(b.buildingId)
  if (real !== b.houseCount) problems.push(`楼栋 ${b.buildingId} 源表 ${b.houseCount} 户，实际 ${real} 户`)
}
for (const u of units) {
  const real = countByUnit(u.unitId)
  if (!real) problems.push(`单元 ${u.unitId} 下没有房号`)
}

/* 引用闭合：账单 / 租户指向的房号必须在（这是重跑 gen-fixtures 会踩的地方） */
for (const f of ['bills', 'tenants']) {
  const rows = readFx(`${f}.json`)
  const bad = rows.filter(r => r.houseId && !ids.has(r.houseId))
  if (bad.length) problems.push(`${f}.json 有 ${bad.length} 条指向不存在的房号：${bad.slice(0, 3).map(r => r.houseId).join(' / ')}`)
}

if (problems.length) {
  console.error('\n✘ 自检未通过：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

console.log(`\n✔ ${houses.length} 户 / ${buildings.length} 栋 / ${units.length} 个单元 / ${communities.length} 个小区`)
console.log(`  本次新增 ${added.length} 户（原 ${fxHouses.length} 户保持不变）`)
console.log(`  账单 ${readFx('bills.json').length} 条、租户 ${readFx('tenants.json').length} 条的房号引用全部闭合`)
