#!/usr/bin/env node
// 静态自检（零依赖，可直接进 CI）：node scripts/check.mjs
//
// 为什么要有它：页面冒烟能发现"打不开"，但发现不了"数字悄悄错了"。
// 这里做五类**静态**检查，和 /e/audit 的运行时检查互补：
//   ① 禁用字面量：曾经引发缺陷的字符串（部分缴费 / 进场 / min-min-width）不得再出现
//   ② 双份 mock 一致：02-原型设计/mock 与 src/mock 必须逐字节一致（否则改了没同步，页面用旧数据）
//   ③ 路由 → 组件文件存在：防止删页/改名后留下死路由
//   ④ 适配层调用的 mock 函数必须真实导出（写过 recalcReportTask → 页面点了才报错）
//   ⑤ 页面里写死的权限码必须在 permissions.json 存在（拼错一个字母，按钮永远禁用而无人察觉）

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const MOCK_A = path.join(ROOT, '..', '02-原型设计', 'mock')
const MOCK_B = path.join(SRC, 'mock')

let failed = 0
const ok = (t, d) => console.log(`\x1b[32m✔\x1b[0m ${t}${d ? `　${d}` : ''}`)
const bad = (t, d) => { failed++; console.log(`\x1b[31m✘\x1b[0m ${t}${d ? `　${d}` : ''}`) }

const walk = (dir, out = []) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name)
    if (f.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/* ---------- ① 禁用字面量 ---------- */
const FORBIDDEN = [
  { text: '部分缴费', why: '账单口径只有「部分缴」，写错会让欠费统计漏算（第 9 批事故）' },
  { text: '进场', why: '通行方向只有「入场 / 出场」' },
  { text: 'min-min-width', why: '非法属性，列宽不会生效' }
]
const files = walk(SRC).filter(f => /\.(vue|js)$/.test(f) && !f.includes(`${path.sep}mock${path.sep}`))
let hit = 0
for (const f of files) {
  const rel = path.relative(SRC, f)
  // 这两处是"讲述历史事故的文档页 / 枚举单一来源"，允许出现被禁字面量
  if (['utils/enums.js', path.join('views', 'e', 'Audit.vue')].includes(rel)) continue
  const text = fs.readFileSync(f, 'utf8')
  for (const rule of FORBIDDEN) {
    if (text.includes(rule.text)) {
      hit++
      bad(`禁用字面量「${rule.text}」出现在 ${rel}`, rule.why)
    }
  }
}
if (!hit) ok('禁用字面量扫描', `${files.length} 个文件无「部分缴费 / 进场 / min-min-width」`)

/* ---------- ② 双份 mock 一致 ---------- */
const md5 = p => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')
if (!fs.existsSync(MOCK_A)) {
  bad('找不到 02-原型设计/mock', MOCK_A)
} else {
  const names = fs.readdirSync(MOCK_A).filter(n => /\.(json|js)$/.test(n))
  const diff = names.filter(n => {
    const b = path.join(MOCK_B, n)
    return !fs.existsSync(b) || md5(path.join(MOCK_A, n)) !== md5(b)
  })
  if (diff.length) bad('mock 双份不一致', `需同步：${diff.join('、')}`)
  else ok('mock 双份一致', `${names.length} 个文件逐字节相同`)
}

/* ---------- ③ 路由 → 组件 ---------- */
const pagesFile = path.join(SRC, 'router', 'pages.js')
const pagesSrc = fs.readFileSync(pagesFile, 'utf8')
const comps = [...pagesSrc.matchAll(/import\(['"]@\/([^'"]+)['"]\)/g)].map(m => m[1])
const missing = comps.filter(rel => !fs.existsSync(path.join(SRC, rel)))
if (missing.length) bad('路由指向的组件缺失', missing.join('、'))
else ok('路由 → 组件', `${comps.length} 个懒加载页面全部存在`)

/* ---------- ③ 适配层委托的 mock 函数必须存在 ----------
 * 为什么加这条：`src/api/*.js` 在 mock 模式下是「转调 utils/api」，
 * 函数名写错时 build 照过、页面照开，直到点了那个按钮才报 `(void 0) is not a function`
 * （第 23 批真的踩了一次：reportRecalcTask 被写成 recalcReportTask）。
 * 这里静态比对一遍，把这类错挡在提交前。
 */
const apiDir = path.join(SRC, 'api')
const apiFiles = fs.existsSync(apiDir) ? walk(apiDir).filter(f => f.endsWith('.js')) : []
const utilsApi = fs.readFileSync(path.join(SRC, 'utils', 'api.js'), 'utf8')
const exported = new Set([
  ...[...utilsApi.matchAll(/export (?:async )?function (\w+)/g)].map(m => m[1]),
  ...[...utilsApi.matchAll(/export (?:const|let) (\w+)/g)].map(m => m[1])
])
const missingMock = []
for (const f of apiFiles) {
  const text = fs.readFileSync(f, 'utf8')
  for (const m of text.matchAll(/mock\.(\w+)/g)) {
    if (!exported.has(m[1])) missingMock.push(`${path.relative(SRC, f)} → mock.${m[1]}`)
  }
}
if (missingMock.length) bad('适配层调用了不存在的 mock 函数', [...new Set(missingMock)].join('、'))
else ok('适配层 → mock 函数', `${apiFiles.length} 个域文件全部对得上（${exported.size} 个导出）`)

/* ---------- ④ 权限码存在性 ----------
 * 页面里手写的权限码拼错一个字母，按钮就永远禁用/永远显示，而且**构建能过、页面能开**，
 * 只有点到那个按钮才发现（或者一直不发现）。这里把写死的权限码逐个核对一遍。
 */
const perms = JSON.parse(fs.readFileSync(path.join(SRC, 'mock', 'permissions.json'), 'utf8'))
const permCodes = new Set(perms.map(p => p.code))
/* 第三段必须是已知操作（view/edit/exec…）：否则 `d.house.houseId` 这类字段名会被误报 */
const permOps = new Set(perms.map(p => p.op))
const CODE_RE = /['"`]([a-f]\.[A-Za-z0-9]+\.[a-z][A-Za-z]*)['"`]/g
const unknownPerm = []
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8')
  for (const m of text.matchAll(CODE_RE)) {
    const op = m[1].split('.')[2]
    if (!permOps.has(op)) continue
    if (!permCodes.has(m[1])) unknownPerm.push(`${path.relative(SRC, f)} → ${m[1]}`)
  }
}
if (unknownPerm.length) bad('权限码不存在（拼错？）', [...new Set(unknownPerm)].slice(0, 6).join('、'))
else ok('权限码存在性', `${permCodes.size} 个权限码，页面引用全部命中`)

/* ---------- ⑤ 骨架一致性（信息项） ---------- */
const viewFiles = walk(path.join(SRC, 'views')).filter(f => f.endsWith('.vue'))
const withTree = viewFiles.filter(f => fs.readFileSync(f, 'utf8').includes('<SpaceTree'))
const withQuick = viewFiles.filter(f => fs.readFileSync(f, 'utf8').includes('<QuickViews'))
console.log(`\x1b[36mℹ\x1b[0m 骨架：A 型（树）${withTree.length} 页 / B 型（快捷视图）${withQuick.length} 页`)
const neither = viewFiles.filter(f => !withTree.includes(f) && !withQuick.includes(f) && !f.includes(`${path.sep}form`) && !f.includes(`${path.sep}shell`))
console.log(`\x1b[36mℹ\x1b[0m 其余页面（表单 / 详情 / 模板）${neither.length} 页`)

console.log(failed ? `\n\x1b[31m${failed} 项未通过\x1b[0m` : '\n\x1b[32m全部通过\x1b[0m')
process.exit(failed ? 1 : 0)
