/**
 * 车位 / 车辆 / 换绑记录 fixtures（批次 82）
 * ----------------------------------------------------------------
 * 业主端在 79 批做了「我的车位」三页 + 自助换绑，但一直读 `@pc/mock`。
 * 切服务端的前提是假服务里得有这批数据 —— 在此之前 04 关于车位**一条接口都没有**，
 * 只有账单的 `subjectType=park`（靠「houseId 为空」认出来）。
 *
 * 只做加法，与 `gen-catalog-fixtures.mjs` 同一套原则：
 *   ① 只导**已导出业主（60 人）名下的**车位（45 个）—— 业主档案本来就是抽样，
 *      导全量 640 个车位会让 595 个指向档案外的 ownerId，比不导更乱；
 *   ② `bills` 只补 `parkId`、并为三个演示业主**追加**车位账单，既有 12 条逐字节保留
 *      （`contract-test` 有「董宇 3 张车位费」这类按条数写的断言，乱改会红）；
 *   ③ 换绑记录种子放在**过去月份**：放在当月会占掉演示业主本月的额度，
 *      演示时点"换绑"直接提示次数用尽。
 *
 * 一个刻意的取舍：`vehicles` 不导完整 IC 卡号，只导后四位（`cardNoTail`）。
 * 业主端本来就只显示后四位（`****2192`），而完整卡号可以复制去开闸 ——
 * 敏感字段不因为"这是样例数据"就发下去。
 *
 * 用法：node scripts/gen-park-fixtures.mjs
 * 自检：车位 / 车辆 / 账单 / 换绑记录四方引用，任一不闭合退出 1。
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
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]))

/* 演示业主：三个人的车位要能被三种情况各覆盖一次 */
const DEMO_OWNERS = ['OW00001', 'OW00002', 'OW00003']

/* ============================ ① 车位 ============================ */
const owners = readFx('owners.json')
const ownerSet = new Set(owners.map(o => o.ownerId))

const srcParkings = readSrc('parkings.json')
const parkings = srcParkings
  .filter(p => ownerSet.has(p.ownerId))
  .map(p => pick(p, [
    'parkId', 'communityId', 'parkNo', 'zone', 'parkType', 'category', 'area',
    'status', 'ownerId', 'plateNo', 'bindStatus', 'feeStandard', 'expireDate', 'chargePile'
  ]))
write('parkings.json', parkings)

/* ============================ ② 车辆 ============================ */
const parkSet = new Set(parkings.map(p => p.parkId))
const srcVehicles = readSrc('vehicles.json')
const vehicles = srcVehicles
  .filter(v => v.ownerId && ownerSet.has(v.ownerId) && parkSet.has(v.parkId))
  .map(v => {
    const row = pick(v, ['vehicleId', 'plateNo', 'ownerId', 'parkId', 'communityId', 'vehicleType', 'brand', 'color', 'authStatus', 'inOutType', 'authStatus'])
    row.cardNoTail = String(v.cardNo || '').slice(-4)
    return row
  })
write('vehicles.json', vehicles)

/* ============================ ③ 换绑记录 ============================ */
/**
 * 两条种子记录，都不是本月：
 *   - 张建国 PK00115 在 8 月由物业代操作换过一次（说明"物业代操作"这个来源长什么样）；
 *   - 王浩然 PK00121 在 9 月自助换过一次（说明"业主自助 + 已同步"长什么样）。
 * 10 月一条都没有 —— 演示时要能真的换一次，否则点进去就是"本月已用完"。
 *
 * `vendorStatus` 只出现「已同步」的历史记录：那是 9 月之前对接过的批次口径。
 * 新的换绑一律「待同步」（车牌识别系统尚未对接），由服务端写，不由客户端传。
 */
const changeLogs = [
  {
    logId: 'PL00001',
    parkId: 'PK00115',
    parkNo: 'B1-115',
    fromPlate: '川B·6Q2M8',
    toPlate: '川B·SFV7D',
    source: '物业代操作',
    operatorName: '周敏',
    vendorStatus: '已同步',
    at: '2026-08-03 10:24',
    reason: '业主到前台提交行驶证变更'
  },
  {
    logId: 'PL00002',
    parkId: 'PK00121',
    parkNo: 'B1-121',
    fromPlate: '川B·OLD11',
    toPlate: '粤B·YK1Q6',
    source: '业主自助',
    operatorName: '王浩然',
    vendorStatus: '已同步',
    at: '2026-09-12 19:41',
    reason: ''
  }
]
write('parking-change-logs.json', changeLogs)

/* ============================ ④ 账单：补 parkId + 追加演示业主 ============================ */
const srcBills = readSrc('bills.json')
const parkBillById = new Map(srcBills.filter(b => b.parkId).map(b => [b.billId, b]))

const fxBills = readFx('bills.json')
const BILL_KEYS = [
  'billId', 'communityId', 'houseId', 'parkId', 'ownerId', 'period', 'status', 'itemId', 'itemName',
  'unit', 'amount', 'quantity', 'price', 'discount', 'lateFee', 'payable', 'paidAmount', 'unpaid',
  'overdueDays', 'dueDate', 'payTime', 'createTime'
]

/**
 * 既有 12 条车位账单：能补上 parkId 的原地补（顺序与其它字段不变），
 * 补不上的**丢掉**。
 *
 * 丢的是 9 条孤儿：`gen-fixtures.mjs` 切 240 条账单时按 `!houseId` 顺手捞了 12 条车位费，
 * 其中 4 位业主（OW00090 / OW00078 / OW00361 等）没被导出（业主档案只导 60 人）。
 * 它们本来就查不到 —— `/mp/bills` 按 ownerId 过滤，这几位的账单永远不会被任何人读到。
 * 留着只会让"车位账单 12 条"这个数字骗人，也让车位与账单的引用不闭合。
 * 删之前已确认：`contract-test.mjs` / `mock-server.mjs` 对这批 billId 零引用。
 */
const dropped = []
const patched = fxBills.flatMap(b => {
  if (b.houseId) return [b]
  const src = parkBillById.get(b.billId)
  const parkId = src?.parkId
  if (!parkId || !parkSet.has(parkId)) {
    dropped.push(b.billId)
    return []
  }
  return [pick({ ...b, parkId }, BILL_KEYS)]
})

/* 演示业主的车位账单：源数据里有、fixtures 里没有的那部分，按 billId 追加 */
const haveBill = new Set(patched.map(b => b.billId))
const extra = srcBills
  .filter(b => b.parkId && DEMO_OWNERS.includes(b.ownerId) && !haveBill.has(b.billId))
  .map(b => pick(b, BILL_KEYS))

const bills = [...patched, ...extra]
write('bills.json', bills)

/* ============================ ⑤ 自检 ============================ */
const problems = []
const parkById = new Map(parkings.map(p => [p.parkId, p]))

if (parkById.size !== parkings.length) problems.push('parkId 有重复')
if (new Set(vehicles.map(v => v.vehicleId)).size !== vehicles.length) problems.push('vehicleId 有重复')
if (new Set(bills.map(b => b.billId)).size !== bills.length) problems.push('billId 有重复（追加时撞了既有账单）')

for (const p of parkings) {
  if (!ownerSet.has(p.ownerId)) problems.push(`车位 ${p.parkId} 的业主 ${p.ownerId} 不在业主档案里`)
  if (!Number.isFinite(Number(p.feeStandard)) || Number(p.feeStandard) <= 0) problems.push(`车位 ${p.parkId} 没有管理费标准`)
  if (!p.expireDate) problems.push(`车位 ${p.parkId} 没有到期日`)
}
for (const v of vehicles) {
  const p = parkById.get(v.parkId)
  if (!p) problems.push(`车辆 ${v.vehicleId} 指向不存在的车位 ${v.parkId}`)
  else if (p.ownerId !== v.ownerId) problems.push(`车辆 ${v.vehicleId} 的业主 ${v.ownerId} 与车位归属 ${p.ownerId} 不一致`)
  if (!/^\d{4}$/.test(String(v.cardNoTail || ''))) problems.push(`车辆 ${v.vehicleId} 的卡号后四位不是 4 位数字`)
  if ('cardNo' in v) problems.push(`车辆 ${v.vehicleId} 仍带完整卡号`)
}

/* 车位上的车牌必须与车辆表里挂该车位的那辆一致（两边不一致，详情页会出现两个车牌） */
for (const p of parkings) {
  if (!p.plateNo) continue
  const hit = vehicles.find(v => v.parkId === p.parkId && v.plateNo === p.plateNo)
  if (!hit) problems.push(`车位 ${p.parkNo} 的车牌 ${p.plateNo} 在车辆表里找不到`)
}

for (const b of bills.filter(x => !x.houseId)) {
  if (!b.parkId) problems.push(`车位账单 ${b.billId} 仍没有 parkId`)
  const p = parkById.get(b.parkId)
  if (!p) problems.push(`车位账单 ${b.billId} 指向不存在的车位 ${b.parkId}`)
  else if (p.ownerId !== b.ownerId) problems.push(`车位账单 ${b.billId} 的业主与车位归属不一致（会串账）`)
}
for (const l of changeLogs) {
  const p = parkById.get(l.parkId)
  if (!p) problems.push(`换绑记录 ${l.logId} 指向不存在的车位 ${l.parkId}`)
  else if (p.parkNo !== l.parkNo) problems.push(`换绑记录 ${l.logId} 的车位号与车位表不一致`)
  if (!['业主自助', '物业代操作', '物业重置'].includes(l.source)) problems.push(`换绑记录 ${l.logId} 来源非法`)
  if (!['待同步', '已同步', '失败'].includes(l.vendorStatus)) problems.push(`换绑记录 ${l.logId} 厂商状态非法`)
  /* 种子放进当月 = 演示业主本月额度被占，点换绑直接"次数用尽" */
  if (String(l.at).slice(0, 7) === '2026-10') problems.push(`换绑记录 ${l.logId} 落在演示当月，会占掉额度`)
}

const demoStat = DEMO_OWNERS.map(oid => {
  const list = parkings.filter(p => p.ownerId === oid)
  return `${oid} ${list.length} 位（${list.map(p => p.parkNo).join(' / ')}）`
})

if (problems.length) {
  console.error('\n✘ 自检未通过：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

console.log(`\n✔ 车位 ${parkings.length} / 车辆 ${vehicles.length} / 换绑记录 ${changeLogs.length} / 账单 ${bills.length}（新增 ${extra.length} 条车位账单${dropped.length ? `，清理 ${dropped.length} 条孤儿车位账单` : ''}）`)
console.log('  演示业主：' + demoStat.join('；'))
console.log(`  车位账单 ${bills.filter(b => !b.houseId).length} 条全部带 parkId，且与车位归属一致`)
