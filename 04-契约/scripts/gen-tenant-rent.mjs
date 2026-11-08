/**
 * 给 tenants.json 增量补 `rent` / `tenantType`（批 B）
 * ----------------------------------------------------------------
 * 为什么是"增量补"而不是重跑 gen-fixtures.mjs：
 *
 *   `fixtures/` 是 **2026-10-30 的快照**（houses 220 套、业主带 `tagIds`、房屋带 `orientation`），
 *   而 `gen-fixtures.mjs` 现在的切片是 `houses.slice(0, 160)`、pick 列表里也没有那两个字段。
 *   整目录重跑会把 220 缩成 160，并让 bills / tenants 里指向 161~220 的房屋全部变成孤儿
 *   —— 契约测试里"张建国的两套房"会直接查不到。
 *
 *   正确做法：先补脚本里缺的字段（本文件 + gen-fixtures 的投影列表都补），
 *   等哪天有人把 160/220 的口径对齐了再整目录重跑。在那之前，缺字段就写增量脚本。
 *
 * 补的是什么：`03-原型/src/mock/tenants.json` 有 `rent`（月租金）与 `tenantType`，
 *   04 的投影把它们漏了。契约 `/mp/houses/{id}/residents` 写明"业主可见租金"，
 *   数据没有这个字段，接口就只能编 —— 所以必须补上，而不是让接口返回 0。
 *
 * 用法：node scripts/gen-tenant-rent.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.resolve(ROOT, '../03-原型/src/mock/tenants.json')
const OUT = path.join(ROOT, 'fixtures/tenants.json')

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const byId = new Map(src.map(t => [t.tenantId, t]))

const rows = JSON.parse(fs.readFileSync(OUT, 'utf8'))
let hit = 0
const missed = []
for (const r of rows) {
  const s = byId.get(r.tenantId)
  if (!s) { missed.push(r.tenantId); continue }
  /* 只补两个字段，其余原样保留（顺序也不动，方便 diff） */
  r.rent = Number(s.rent) || 0
  r.tenantType = s.tenantType || '个人'
  hit += 1
}

fs.writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n')

const zero = rows.filter(r => !r.rent).map(r => r.tenantId)
console.log(`tenants.json 补 rent/tenantType：${hit}/${rows.length} 命中 · 源里查不到 ${missed.length} ${missed.length ? missed.slice(0, 5).join(',') : ''}`)
console.log(`自检：rent 为 0 的 ${zero.length} 条 ${zero.length ? '→ ' + zero.slice(0, 5).join(',') : '✓'}`)
console.log(`租金区间：¥${Math.min(...rows.map(r => r.rent))} ~ ¥${Math.max(...rows.map(r => r.rent))}`)
if (missed.length || zero.length) process.exitCode = 1
