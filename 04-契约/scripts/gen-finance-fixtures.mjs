/**
 * 财务三张 fixture 补到 PC 口径（2026-11-14）
 * ------------------------------------------------------------
 * 问题：PC 这几天把账期铺满 + 历史推 24 个月，`03/src/mock/bills.json` 长到 4884 张；
 * 契约的 `fixtures/bills.json` 还停在 11-10 的快照（260 张）。后果不是"数字小一点"，
 * 而是**员工端楼栋页的欠费金额和 PC 对不上**（PC 425 条 / ¥88,561，契约 56 条 / ¥12,937），
 * 演示时两个人看两个数，谁也说不清哪个对。
 *
 * 为什么不整目录重跑 `gen-fixtures.mjs`：那个脚本会 houses.slice(0,160)、owners.slice(0,60)，
 * 一跑就把 756 套房子砍回 160 —— 「张建国的两套房」当场查不到。见它头部的警告。
 *
 * 这个脚本只补**三张财务表**，且**保持现有 fixture 的字段集不变**（用当前 CT 行里出现过的
 * key 当白名单投影），所以：
 *   - 房屋 / 工单 / 巡检 / 整改 / 品质检查 一行都不动；
 *   - 三张表的 schema 不变，只是行数补齐；
 *   - owners 一起补齐（682），否则新补的账单会指向不存在的业主，欠费列表按业主查就断链。
 *
 * 口径：bills / payments 全量投影 PC mock（含车位账单，无 houseId）；金额四舍五入到分。
 * 幂等：重复跑结果一致（纯投影，不累加）。
 *
 *   node scripts/gen-finance-fixtures.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const MOCK = path.resolve(ROOT, '..', '02-原型设计', 'mock')
const OUT = path.resolve(ROOT, 'fixtures')
const PC = path.resolve(ROOT, '..', '03-原型', 'src', 'mock')

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'))
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n')
const r2 = n => Math.round((Number(n) || 0) * 100) / 100

/** 当前 fixture 里出现过的全部 key —— 这就是契约认的字段集，不新增不删减 */
const keyOf = rows => {
  const s = new Set()
  for (const r of rows) for (const k of Object.keys(r)) s.add(k)
  return [...s]
}

/** 按白名单投影；数字保留两位，缺字段跳过（不造 null） */
const project = (row, keys, numKeys) =>
  Object.fromEntries(keys
    .filter(k => row[k] !== undefined)
    .map(k => [k, numKeys.has(k) ? r2(row[k]) : row[k]]))

const JOBS = [
  {
    file: 'owners.json',
    from: path.join(PC, 'owners.json'),
    num: [],
    label: '业主'
  },
  {
    file: 'bills.json',
    from: path.join(PC, 'bills.json'),
    num: ['amount', 'quantity', 'price', 'discount', 'lateFee', 'payable', 'paidAmount', 'unpaid', 'overdueDays'],
    label: '账单'
  },
  {
    file: 'payments.json',
    from: path.join(PC, 'payments.json'),
    num: ['amount'],
    /* payPoint 是 2026-11-15 新加的（收款点在哪个岗位收的）。fixture 里原来没有这个字段，
       「按现有 key 投影」会把它丢掉 —— 所以显式补进来，契约 schema 同步加。 */
    extra: ['payPoint'],
    label: '缴费流水'
  }
]

/* `--only=bills.json` 只重投影一张表：三张表的来源不同批次时（比如只改了 03 的账单种子），
   全量跑会把别人正在改的 owners / payments 一起盖掉。不带参数仍是三张全跑。 */
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').replace('--only=', '')
const JOBS_TO_RUN = ONLY ? JOBS.filter(j => j.file === ONLY || j.label === ONLY) : JOBS
if (ONLY && !JOBS_TO_RUN.length) {
  console.error(`--only 只认：${JOBS.map(j => j.file).join(' / ')}`)
  process.exit(1)
}

const report = {}
for (const job of JOBS_TO_RUN) {
  const outPath = path.join(OUT, job.file)
  const existing = readJson(outPath)
  const keys = [...new Set([...keyOf(existing), ...(job.extra || [])])]
  const numKeys = new Set(job.num)
  const src = readJson(job.from)

  /* 引用闭合：账单/流水里的 houseId、ownerId 必须能在 fixtures 里找到对应行 —— 这是补数据的
     唯一硬约束，缺一条就会在列表页出现"孤儿行"。车位账单按设计没有 houseId，跳过。 */
  const houses = new Set(readJson(path.join(OUT, 'houses.json')).map(h => h.houseId))
  const ownerIds = job.file === 'owners.json'
    ? new Set(src.map(o => o.ownerId))
    : new Set(readJson(path.join(OUT, 'owners.json')).map(o => o.ownerId))

  const kept = []
  const dropped = []
  for (const row of src) {
    if (row.houseId && !houses.has(row.houseId)) { dropped.push(row); continue }
    if (row.ownerId && !ownerIds.has(row.ownerId)) { dropped.push(row); continue }
    kept.push(project(row, keys, numKeys))
  }

  writeJson(outPath, kept)
  report[job.file] = { before: existing.length, after: kept.length, dropped: dropped.length }
  console.log(
    `${job.label.padEnd(4, '　')} ${String(existing.length).padStart(5)} → ${String(kept.length).padStart(5)} 条` +
    (dropped.length ? `（丢弃 ${dropped.length} 条：房屋/业主不在 fixtures 里）` : '')
  )
}

/* meta.json 的 counts 跟着改：它被当"数据集说明"读，数不对会误导 */
const metaPath = path.join(OUT, 'meta.json')
const meta = readJson(metaPath)
meta.counts = {
  ...meta.counts,
  ...(report['owners.json'] ? { owners: report['owners.json'].after } : {}),
  ...(report['bills.json'] ? { bills: report['bills.json'].after } : {}),
  ...(report['payments.json'] ? { payments: report['payments.json'].after } : {})
}
meta.financeAlignedAt = '2026-11-14'
meta.financeNote = '财务三表（owners / bills / payments）已按 PC 全量对齐；其余表仍是 10-30 裁剪版'
writeJson(metaPath, meta)
console.log('meta.json counts 已更新', meta.counts)
