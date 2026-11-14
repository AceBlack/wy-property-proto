/**
 * 契约「抄表记录」种子：从 PC 投影 meterReadings
 *
 * 为什么是增量脚本：`gen-fixtures.mjs` 整目录重跑会把 houses 砍回 160（见它文件头的警告），
 * 而抄表数据要挂在真实房屋上，房屋一砍全是孤儿。
 *
 * 数据量：1218 条（待录入 165 / 待复核 102 / 已计费 951）。
 * 裁剪策略：**不裁**。抄表的待抄清单按楼栋收敛，裁了就会出现"某栋只剩两条"。
 *
 * 去掉的字段：`communityName`（服务端能按 communityId 取，重复存一份迟早不一致）。
 *
 * 幂等：整份覆盖（这是纯投影，没有人工修过的值）。
 *
 *   node scripts/gen-meter-fixtures.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '../../03-原型/src/mock/meterReadings.json')
const OUT = path.join(HERE, '../fixtures/meter-readings.json')

const rows = JSON.parse(fs.readFileSync(SRC, 'utf8'))

const projected = rows.map(r => ({
  readingId: r.readingId,
  meterId: r.meterId,
  meterNo: r.meterNo,
  type: r.type,                 /* 水表 / 电表 */
  unit: r.unit,                 /* 吨 / 度 */
  period: r.period,             /* YYYY-MM */
  communityId: r.communityId,
  houseId: r.houseId,
  houseName: r.houseName,
  ownerName: r.ownerName || '',
  lastReading: Number(r.lastReading) || 0,
  /*
   * 「待录入」的读数必须是 0：PC 的 mock 里这类记录还带着上一轮的 currentReading / usage，
   * 直接用会自相矛盾 —— 状态说"还没抄"，字段却说"已抄 5600、用量 81"。
   * 端上清单只显示上期读数，本期由师傅现场填。
   */
  currentReading: r.status === '待录入' ? 0 : (Number(r.currentReading) || 0),
  usage: r.status === '待录入' ? 0 : Math.round((Number(r.usage) || 0) * 100) / 100,
  readDate: r.status === '待录入' ? '' : (r.readDate || ''),
  reader: r.status === '待录入' ? '' : (r.reader || ''),
  status: r.status,             /* 待录入 / 待复核 / 已计费 */
  abnormal: r.status === '待录入' ? false : !!r.abnormal,
  billId: r.billId || ''
}))

fs.writeFileSync(OUT, JSON.stringify(projected, null, 2) + '\n')

const stat = projected.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m }, {})
const p01 = projected.filter(r => r.communityId === 'P01')
const p01Pending = p01.filter(r => r.status === '待录入').length

console.log(`抄表记录 ${projected.length} 条 → ${path.relative(process.cwd(), OUT)}`)
console.log(`状态：${Object.entries(stat).map(([k, v]) => `${k} ${v}`).join(' / ')}`)
console.log(`P01 ${p01.length} 条，其中待录入 ${p01Pending} 条（演示用这批）`)
