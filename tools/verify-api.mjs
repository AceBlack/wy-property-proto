/**
 * 接口模式守门：客户端调用的接口，假服务里到底有没有。
 *
 * 为什么单独做这一层
 * ------------------
 * 契约测试守的是「契约 ↔ 假服务」双向一致，它管不到客户端：
 * 05/06 里写 `get('/mobile/xx')`，只要假服务没注册，运行时才 404 —— 而 404 在页面上
 * 通常表现为"空列表"，看上去像没数据，不像坏了。这类漂移靠人眼是发现不了的。
 *
 * 做法
 * ----
 *   ① 扫 05/src、06/src 里 `get('/x')` / `post(`/x/${id}`)` 这类调用，取出方法与路径；
 *   ② 扫 04 的 mock-server.mjs 注册表 `on('METHOD', '/path')`；
 *   ③ 路径按段比对：`{param}` 与 `${...}` 都归一成通配。
 *
 * 只报"客户端调了、服务没有"，反向不查 —— 服务实现了但没人调是正常的（给后端留的）。
 *
 * 用法：node tools/verify-api.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/* ---------------- ① 假服务的注册表 ---------------- */
const mockSrc = fs.readFileSync(path.join(ROOT, '04-契约/mock-server.mjs'), 'utf8')
const routes = []
const ON_RE = /^on\('(GET|POST|PATCH|PUT|DELETE)',\s*'([^']+)'/gm
let m
while ((m = ON_RE.exec(mockSrc))) routes.push({ method: m[1], path: m[2] })

const toSegs = p => p.split('/').filter(Boolean)
const isWild = s => s.startsWith('{') || s === '*' || s.includes('${')

/** 客户端路径 → 模式（`/a/${id}/b` → ['a','*','b']） */
const toPattern = p => toSegs(p).map(s => (s.includes('${') ? '*' : s))

/** 服务端路径 → 模式（`/a/{id}/b` → ['a','*','b']） */
const routePattern = p => toSegs(p).map(s => (s.startsWith('{') ? '*' : s))

const matchPattern = (client, server) => {
  if (client.length !== server.length) return false
  return client.every((s, i) => s === '*' || server[i] === '*' || s === server[i])
}

/* ---------------- ② 扫客户端调用 ---------------- */
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
  const p = path.join(dir, d.name)
  if (d.isDirectory()) return d.name === 'node_modules' ? [] : walk(p)
  return /\.(js|vue)$/.test(d.name) ? [p] : []
})

const CALL_RE = /\b(get|post|patch|put|del|del\w*)\s*\(\s*[`'"]([^`'"]+)[`'"]/g
const METHOD_OF = { get: 'GET', post: 'POST', patch: 'PATCH', put: 'PUT', del: 'DELETE' }

const projects = [
  { name: '05-员工端', dir: path.join(ROOT, '05-员工端APP/src') },
  { name: '06-业主端', dir: path.join(ROOT, '06-业主端小程序/src') }
]

const missing = []
const seen = new Map()
let totalCalls = 0
let okCalls = 0

for (const proj of projects) {
  for (const file of walk(proj.dir)) {
    const src = fs.readFileSync(file, 'utf8')
    let hit
    CALL_RE.lastIndex = 0
    while ((hit = CALL_RE.exec(src))) {
      const method = METHOD_OF[hit[1]]
      const raw = hit[2]
      /* 只看真接口：以 / 开头，且不是静态资源 */
      if (!method || !raw.startsWith('/')) continue
      if (/\.(png|jpg|svg|css|js)$/.test(raw)) continue
      /* 查询串不参与比对：`?size=100` 会挂在最后一段上，让分段与内容都对不上，
         于是一条真存在的接口被报成"缺失"（2026-11-14 实际踩到：活动报名） */
      const client = toPattern(raw.split('?')[0])
      const ok = routes.some(r => r.method === method && matchPattern(client, routePattern(r.path)))
      totalCalls += 1
      if (ok) okCalls += 1
      if (!ok) {
        const key = `${method} ${raw}`
        if (!seen.has(key)) seen.set(key, { file: path.relative(ROOT, file), method, raw })
        missing.push(key)
      }
    }
  }
}

/* 同一个路径在多处调用只报一次，但要带上出处 */
const uniq = [...seen.values()]

console.log(`假服务注册 ${routes.length} 条 · 客户端调用 ${totalCalls} 处（去重 ${seen.size} 条缺失）`)

if (!uniq.length) {
  console.log('\n✔ 客户端调用的接口在假服务里都有实现')
  process.exit(0)
}

console.log(`\n✘ ${uniq.length} 条客户端调用在假服务里没有对应实现：`)
for (const u of uniq) console.log(`   ${u.method.padEnd(6)} ${u.raw}   ← ${u.file}`)
console.log('\n要么补实现，要么说明为什么不用实现（并在 04/README 记一条）。')
process.exit(1)
