/**
 * 全站冒烟（仓库内版）
 * ----------------------------------------------------------------
 * 为什么要有这个：之前冒烟脚本放在 /tmp，人一走就断，也没法进 CI。
 * 这里做成**自包含**：自己起 `vite preview`、自己找 Chrome、跑完自己收摊，一条 `npm run e2e` 即可。
 *
 * 检查项：
 *   ① 每个可见路由能否渲染（`.page` 文本长度 > 30，否则判空页）
 *   ② 控制台错误 / 未捕获异常（按页面去重）
 *   ③ 顺带统计表格行数、KPI 卡数、图表数（便于发现"页面在但表格空了"）
 *
 * 用法：
 *   npm run e2e                  # 自动 build 产物 + 起预览 + 跑
 *   npm run e2e -- --base http://localhost:5186   # 跑已有服务
 *   CHROME_PATH=/path/to/chrome npm run e2e
 *
 * 退出码：有非预期空页或控制台错误 → 1（可直接挂 CI）
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const sleep = ms => new Promise(r => setTimeout(r, ms))

/* 已知空页：shell 索引页本身没有内容，属设计如此，不计失败 */
const BLANK_ALLOW = new Set(['/shell/list'])

const argv = process.argv.slice(2)
const argBase = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : ''

/* ------------------------------ Chrome ------------------------------ */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium'
].filter(Boolean)
const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p))
if (!chromePath) {
  console.error('找不到 Chrome。请设 CHROME_PATH 环境变量指向可执行文件。')
  process.exit(2)
}

/* ------------------------------ 路由清单 ------------------------------ */
const pagesSrc = fs.readFileSync(path.join(ROOT, 'src/router/pages.js'), 'utf8')
const routes = []
for (const line of pagesSrc.split('\n')) {
  const m = line.match(/\{\s*path:\s*'(\/[^']+)'/)
  if (!m) continue
  if (line.includes('hidden: true')) continue
  if (m[1].startsWith('/error/')) continue
  if (m[1].includes(':')) continue          // 动态路由（详情页）不逐个跑
  routes.push(m[1])
}
console.log(`可见路由 ${routes.length} 个`)

/* ------------------------------ 起预览 ------------------------------ */
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer()
  srv.unref()
  srv.on('error', reject)
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address()
    srv.close(() => resolve(port))
  })
})

let child = null
let base = argBase
if (!base) {
  if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
    console.error('没有 dist/，请先 npm run build（或改用 --base 指定已运行的服务）')
    process.exit(2)
  }
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  child = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: false
  })
  /* 把子进程输出留着：超时只说"启动超时"等于没说，看不到是端口占用还是构建产物有问题 */
  const boot = []
  child.stdout.on('data', d => boot.push(String(d)))
  child.stderr.on('data', d => boot.push(String(d)))
  let ready = false
  /* 主包已过 5MB，冷启动在忙的机器上会超过 30s —— 给到 90s；
     真超了也要能看见原因（下面打印），而不是只报一句"超时" */
  for (let i = 0; i < 180; i++) {
    await sleep(500)
    try {
      const r = await fetch(`${base}/`)
      if (r.ok) { ready = true; break }
    } catch { /* 还没起来 */ }
  }
  if (!ready) {
    console.error('预览服务启动超时')
    if (boot.length) console.error(boot.join('').split('\n').slice(-12).join('\n'))
    child.kill('SIGTERM')
    process.exit(2)
  }
}
console.log(`预览地址 ${base}\n`)

/* ------------------------------ 跑 ------------------------------ */
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
})
const page = await browser.newPage()
await page.setViewport({ width: 1920, height: 1080 })

const errors = []
const current = () => page.url().split('#')[1] || '/'
page.on('console', m => {
  if (m.type() !== 'error') return
  const txt = m.text()
  if (/favicon|Failed to load resource: the server responded with a status of 404/.test(txt)) return
  errors.push(`${current()} :: ${txt.slice(0, 160)}`)
})
page.on('pageerror', e => errors.push(`${current()} :: ${String(e).slice(0, 160)}`))

const blanks = []
const stats = []
for (const p of routes) {
  await page.goto(`${base}/#${p}`, { waitUntil: 'domcontentloaded' })
  await sleep(650)
  const info = await page.evaluate(() => ({
    title: document.title.replace(' · 智慧物业 V2 原型', ''),
    rows: document.querySelectorAll('.el-table__body-wrapper tbody tr').length,
    ds: document.querySelectorAll('.dstat, .rsum').length,
    chart: document.querySelectorAll('canvas').length,
    blank: (document.querySelector('.page')?.innerText || '').trim().length < 30
  }))
  stats.push({ p, ...info })
  if (info.blank && !BLANK_ALLOW.has(p)) blanks.push(p)
}

await browser.close()
if (child) child.kill('SIGTERM')

/* ------------------------------ 汇总 ------------------------------ */
const withTable = stats.filter(s => s.rows > 0).length
const withKpi = stats.filter(s => s.ds > 0).length
console.log(`渲染成功 ${stats.length - blanks.length}/${stats.length}｜有表格 ${withTable}｜有 KPI ${withKpi}`)
if (blanks.length) console.log('空页：', blanks)
const uniqErr = [...new Set(errors)]
if (uniqErr.length) console.log(`控制台错误 ${uniqErr.length} 条：\n  - ${uniqErr.slice(0, 12).join('\n  - ')}`)

const failed = blanks.length > 0 || uniqErr.length > 0
console.log(failed ? '\n✗ 冒烟未通过' : '\n✓ 冒烟通过')
process.exit(failed ? 1 : 0)
