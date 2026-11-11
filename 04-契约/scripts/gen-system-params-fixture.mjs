/**
 * 系统参数 fixtures
 * ----------------------------------------------------------------
 * 与 `03-原型/src/utils/api.js` 的 `PARAMS` 一一对应。改那边就要跑一次这里，
 * 否则后台改参数、业主端读阈值会读到两套值。
 *
 * 为什么参数要单独一个接口：`park.plateChangeLimit` 这类阈值以前写死在客户端常量里，
 * 运营想从 1 次/月 调到 2 次/月 得发一次版。参数一旦下发，客户端就只负责展示与校验。
 *
 * 用法：node scripts/gen-system-params-fixture.mjs
 * 自检：key 唯一、分组非空、值非空（空值在接口层也是 422）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(path.resolve(__dirname, '..'), 'fixtures')

const rows = [
  { key: 'bill.generateDay', name: '账单生成日', value: '1', unit: '号', group: '计费', desc: '每月几号生成当月账单' },
  { key: 'bill.dueDays', name: '账单账期', value: '15', unit: '天', group: '计费', desc: '生成后多少天内应缴清' },
  { key: 'fee.lateFeeRate', name: '违约金日利率', value: '0.05', unit: '%', group: '计费', desc: '逾期每日加收比例' },
  { key: 'collect.autoDays', name: '自动催缴触发', value: '30', unit: '天', group: '催缴', desc: '逾期多少天后自动进入催缴池' },
  { key: 'wo.slaHours', name: '工单默认 SLA', value: '24', unit: '小时', group: '现场', desc: '普通优先级工单完成时限' },
  { key: 'deposit.decorationBase', name: '装修押金基准', value: '3000', unit: '元', group: '押金', desc: '90–140㎡ 房屋的押金收取标准' },
  { key: 'export.maxRows', name: '导出单次上限', value: '50000', unit: '条', group: '导出', desc: '超过则走异步任务并分页导出' },
  { key: 'login.sessionHours', name: '会话有效期', value: '8', unit: '小时', group: '安全', desc: '超时后需重新登录' },
  /* 2026-11-10（H1）：业主端自助换绑的上限，阈值必须在后台可配 */
  { key: 'park.plateChangeLimit', name: '车牌换绑次数', value: '1', unit: '次/月', group: '车位', desc: '每车位每自然月业主可自助换绑的次数' },
  { key: 'park.plateChangeWindow', name: '换绑计数周期', value: '自然月', unit: '', group: '车位', desc: '自然月 = 每月 1 日重置' }
]

const problems = []
if (new Set(rows.map(r => r.key)).size !== rows.length) problems.push('key 有重复')
for (const r of rows) {
  if (!r.group) problems.push(`${r.key} 没有分组，参数页会把它挂到空白组`)
  if (!String(r.value).trim()) problems.push(`${r.key} 值为空`)
  if (!/^[a-z]+\.[a-zA-Z]+$/.test(r.key)) problems.push(`${r.key} 不符合「域.参数」命名`)
}
if (problems.length) {
  console.error('\n✘ 自检未通过：')
  problems.forEach(p => console.error('  - ' + p))
  process.exit(1)
}

fs.writeFileSync(path.join(OUT, 'system-params.json'), JSON.stringify(rows, null, 2) + '\n')
const groups = [...new Set(rows.map(r => r.group))]
console.log(`✔ system-params.json  ${rows.length} 条 · 分组 ${groups.join(' / ')}`)
