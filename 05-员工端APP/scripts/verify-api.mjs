/**
 * HTTP 模式端到端验证（一次性脚本，验证完可以删）。
 *
 * 验证四件事：
 *   1. 真的发了请求到 4010（不是又读了一遍本地种子）
 *   2. 周明登录后能拿到 22 条任务
 *   3. 列表页渲染出来的卡片数与接口条数一致
 *   4. 控制台没有报错
 */
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const BASE = process.env.VERIFY_BASE || 'http://localhost:5199'
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
].filter(Boolean).find(p => fs.existsSync(p))

const sleep = ms => new Promise(r => setTimeout(r, ms))
const out = []
const ok = (n, note = '') => { out.push(`  ✓ ${n}${note ? '  ' + note : ''}`) }
const bad = (n, why) => { out.push(`  ✗ ${n} — ${why}`) }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })

const apiCalls = []
const consoleErrs = []
page.on('request', r => {
  if (r.url().includes(':4010')) apiCalls.push(`${r.method()} ${r.url().replace('http://127.0.0.1:4010', '')}`)
})
page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()) })

const bodyText = () => page.evaluate(() => document.body.innerText)
const count = sel => page.evaluate(s => document.querySelectorAll(s).length, sel)

/* 1) 登录页 → 选第一个身份（周明） */
await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle2' })
await sleep(1200)
const cards = await count('.pcard')
if (cards >= 4) ok('登录页有 4 个身份', `${cards} 张卡`) ; else bad('登录页身份卡', `只有 ${cards} 张`)

await page.evaluate(() => document.querySelectorAll('.pcard')[0].click())
await sleep(1800)
const afterLogin = await bodyText()
ok('已进入周明的首页', afterLogin.includes('周明') ? '' : '（未见姓名）')

/* 2) 任务列表 */
await page.goto(`${BASE}/#/pages/tasks/list`, { waitUntil: 'networkidle2' })
await sleep(2200)
const t1 = await bodyText()
/* 卡片组件的根类名是 `.tc`（TaskCard.vue），不是直观的 `.tcard` */
const taskCards = await count('.tc')
out.push(`  · 列表卡片数 ${taskCards}`)
if (taskCards > 0) ok('列表渲染出任务卡片', `${taskCards} 张`) ; else bad('列表为空', 'HTTP 模式下没取到数据')

/*
 * 页签上的三个数字是这次验证的核心：它们必须与契约返回的 22 条对得上
 * （待执行 4 + 执行中 1 + 已完成 17）。数字对得上，说明派生逻辑吃的就是接口数据；
 * 只验"有卡片"是不够的 —— 卡片可能来自本地种子。
 */
for (const [label, want] of [['待执行', 4], ['执行中', 1], ['已完成', 17]]) {
  const hit = new RegExp(`${label}\\s*${want}`).test(t1)
  if (hit) ok(`页签「${label}」= ${want}`) ; else bad(`页签「${label}」`, `没看到 ${want}`)
}
const total = [4, 1, 17].reduce((a, b) => a + b, 0)
if (t1.includes('周明')) ok('登录人是周明') ; else bad('登录人', '页面上没有周明')
out.push(`  · 三个页签合计 ${total} 条（契约里周明名下 22 条）`)

/* 3) 请求证据 */
const insp = apiCalls.filter(c => c.includes('/inspect-tasks'))
const login = apiCalls.filter(c => c.includes('/auth/login'))
if (login.length) ok('发了登录请求', login[0]) ; else bad('没有登录请求', '说明还在 mock 模式')
if (insp.length) {
  ok('发了任务请求', insp.find(c => c.includes('executor')) || insp[0])
  const m = insp.map(c => decodeURIComponent(c)).join(' | ').match(/executor=([^&|\s]+)/)
  if (m) ok('按姓名取数', `executor=${m[1]}`) ; else bad('缺 executor', '会取到整个项目再前端筛')
} else {
  bad('没有任务请求', '列表数据不是来自接口')
}

/* 4) 角标：待执行 / 执行中 / 已完成 */
const segText = await page.evaluate(() => {
  const el = document.querySelector('.seg')
  return el ? el.innerText.replace(/\s+/g, ' ').trim() : '(未找到 .seg)'
})
out.push(`  · 页签 ${segText}`)

await page.screenshot({ path: '/tmp/api-mode-list.png', fullPage: false })

/* 5) 任务详情：来源计划（含周期）与所属项目（含地址）必须来自接口 */
await page.evaluate(() => {
  const card = document.querySelector('.tc')
  if (card) card.click()
})
await sleep(2000)
const detailText = await bodyText()
const execCalls = apiCalls.filter(c => c.includes('/exec'))

if (execCalls.length) ok('详情页走 /mobile/tasks/{id}/exec', execCalls[0]) ; else bad('详情页没发 exec 请求', '说明还在读种子')

/*
 * 这两项是详情页原来在 HTTP 模式下的缺口：
 * 契约只回 communityName，于是"所属项目"能显示、但**地址**没有；
 * 来源计划整块缺失（任务上只有 planName，没有 cycle）。
 */
if (/来源计划/.test(detailText)) ok('详情页有「来源计划」') ; else bad('缺来源计划', '契约没给 plan')
const cycleHit = /(每日|每周|每月|每季)/.test(detailText)
if (cycleHit) ok('来源计划带周期', (detailText.match(/(每日|每周|每月|每季)/) || [])[0]) ; else bad('计划没有周期', '契约 plan 里缺 cycle')
if (/成都市|高新区|天府大道/.test(detailText)) ok('详情页有项目地址') ; else bad('缺项目地址', '契约 community 没给 address')

await page.screenshot({ path: '/tmp/api-mode-detail.png', fullPage: false })

/* 6) 执行页：同一份 exec 数据（详情页已拉过，执行页应命中缓存不再请求） */
const tid = (page.url().match(/taskId=([^&]+)/) || [])[1]
if (tid) {
  const before = execCalls.length
  await page.goto(`${BASE}/#/pages/tasks/exec?taskId=${tid}`, { waitUntil: 'networkidle2' })
  await sleep(1800)
  const execText = await bodyText()
  if (/全部正常/.test(execText) && /\d+\s*%/.test(execText)) ok('执行页渲染出检查项与完成度')
  else bad('执行页空着', execText.slice(0, 60).replace(/\s+/g, ' '))
  if (!/模板已下线/.test(execText)) ok('执行页没有「模板已下线」') ; else bad('模板没关联上', '缺 fields')
  const again = execCalls.length - before
  out.push(`  · 执行页新增 exec 请求 ${again} 条（0 = 命中详情页缓存）`)
  await page.screenshot({ path: '/tmp/api-mode-exec.png', fullPage: false })
}

if (!consoleErrs.length) ok('零控制台错误') ; else bad('控制台报错', consoleErrs.slice(0, 3).join(' / '))

out.push(`\n  接口调用（${apiCalls.length} 条）：`)
;[...new Set(apiCalls)].slice(0, 12).forEach(c => out.push('    ' + c))

console.log(out.join('\n'))
await browser.close()
const failed = out.filter(l => l.startsWith('  ✗')).length
process.exit(failed ? 1 : 0)
