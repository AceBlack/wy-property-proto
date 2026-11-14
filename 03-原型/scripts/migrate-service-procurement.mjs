/**
 * 服务外包合同迁到「采购协议 / 服务采购」（2026-11-14）
 * ------------------------------------------------------------
 * 背景：2026-11-13 定稿的六类里没有「环境与秩序外包」，19 份整包服务合同
 * （保洁 / 绿化 / 秩序安保 / 垃圾清运）暂挂「劳动合同 / 劳务协议」。
 * 挂在那里有两处不对：
 *   ① 类型名在说谎 —— 这 19 份是**公司与公司**的服务合同，不是劳务协议；
 *   ② 报表按类型汇总时，它们会被数进「劳动合同」口径，看合同结构的人会以为
 *      公司签了一堆劳务协议。
 * 现在在「采购协议」下增加子类「服务采购」（客户只要六类，不新开第七类），
 * 把这 19 份迁过去。方向同为支出，收支分项不受影响；分类字典二级仍按合同名
 * 细分到 保洁外包 / 绿化养护 / 秩序维护（`contractCategoryOf`）。
 *
 * 判定口径（宁可少迁，不要错迁）：
 *   type === '劳动合同' && subtype === '劳务协议' && 合同名命中整包服务关键词
 * 劳务派遣、临时用工、自有保洁/保安团队的劳务协议**不在**迁移范围内 ——
 * 那是真的人力成本。
 *
 * 幂等：已经是「采购协议/服务采购」的跳过；重复跑不产生新改动。
 * 三个文件一起写：03 原型 mock、02 设计 mock、04 契约 fixture。
 *
 *   node scripts/migrate-service-procurement.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FILES = [
  path.join(ROOT, '03-原型', 'src', 'mock', 'contracts.json'),
  path.join(ROOT, '02-原型设计', 'mock', 'contracts.json'),
  path.join(ROOT, '04-契约', 'fixtures', 'contracts.json')
]

/* 与 api.js 的 SERVICE_OUTSOURCE_HINT 同一套词 */
const HINT = /保洁|绿化|秩序|安保|保安|垃圾清运|清掏|消杀/

let total = 0
for (const file of FILES) {
  if (!fs.existsSync(file)) { console.log('跳过（不存在）', file); continue }
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
  let n = 0
  for (const r of rows) {
    if (r.type !== '劳动合同' || r.subtype !== '劳务协议') continue
    if (!HINT.test(String(r.name || ''))) continue
    r.type = '采购协议'
    r.subtype = '服务采购'
    n += 1
  }
  if (n === 0) {
    console.log('已迁移过，跳过', path.relative(ROOT, file))
    continue
  }
  fs.writeFileSync(file, JSON.stringify(rows, null, 2) + '\n')
  total += n
  const g = {}
  for (const r of rows) g[`${r.type}/${r.subtype}`] = (g[`${r.type}/${r.subtype}`] || 0) + 1
  const left = g['劳动合同/劳务协议'] || 0
  console.log(path.relative(ROOT, file), '迁移', n, '条；剩余劳务协议', left, '条')
}

console.log('合计迁移', total, '条')
