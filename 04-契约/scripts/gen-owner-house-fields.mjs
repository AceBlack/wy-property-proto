/**
 * 增量补齐契约的业主 / 房屋字段：`emergencyContact`、`remark`
 *
 * 为什么需要：员工端「房屋详情」页可以就地改 7 个字段 —— 业主姓名 / 手机号 /
 * 应急联系人 / 业主备注 / 信用等级、房屋备注 / 使用状态、。其中
 * `owners.emergencyContact`、`owners.remark`、`houses.remark` 在契约 fixture 里**没有**，
 * 不开这两个字段，`PATCH` 就没法落库（白名单里没有 = 一律"不支持内联编辑"）。
 *
 * 为什么写增量脚本而不重跑 `gen-fixtures.mjs`：那个脚本会整目录重写，
 * 把 756 套房屋砍回 160（见它文件头的警告）。这里只做字段映射，不动任何一行其它数据。
 *
 * 业主 / 房屋两边 682 / 756 条 ownerId、houseId 完全对得上，所以按 id 直接取。
 *
 * 幂等：字段已有就跳过（不覆盖契约里可能被手工修过的值）。
 *
 *   node scripts/gen-owner-house-fields.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'))
const write = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n')

const OWNERS = path.join(HERE, '../fixtures/owners.json')
const HOUSES = path.join(HERE, '../fixtures/houses.json')
const PC_OWNERS = path.join(HERE, '../../03-原型/src/mock/owners.json')
const PC_HOUSES = path.join(HERE, '../../03-原型/src/mock/houses.json')

/* ---------- 业主 ---------- */
const owners = read(OWNERS)
const pcOwnerOf = new Map(read(PC_OWNERS).map(o => [o.ownerId, o]))
let oPatch = 0
for (const o of owners) {
  const src = pcOwnerOf.get(o.ownerId)
  if (!src) continue
  for (const k of ['emergencyContact', 'remark']) {
    if (k in o) continue          /* 已有就不动 */
    o[k] = src[k] ?? ''
    oPatch += 1
  }
}
write(OWNERS, owners)

/* ---------- 房屋 ---------- */
const houses = read(HOUSES)
const pcHouseOf = new Map(read(PC_HOUSES).map(h => [h.houseId, h]))
let hPatch = 0
for (const h of houses) {
  const src = pcHouseOf.get(h.houseId)
  if (!src) continue
  if ('remark' in h) continue
  h.remark = src.remark ?? ''
  hPatch += 1
}
write(HOUSES, houses)

console.log(`业主补字段 ${oPatch} 处（${owners.length} 条）`)
console.log(`房屋补字段 ${hPatch} 处（${houses.length} 条）`)
