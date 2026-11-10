/**
 * 邻里域 HTTP 切换验证（`npm run verify:neighbor`）
 *
 * 验的是「待办按项目过滤 + 审完真的从队列里消失」：
 *   待审 N 条 → 点进闲置详情 → 通过 → 回到待办少一条
 *
 * ⚠️ 跑之前重启假服务：审核会改内存里的状态，跑一次那一条就不再是「待审核」了。
 *
 *   前置：
 *     cd 04-契约 && node mock-server.mjs
 *     cd 05-员工端APP && VITE_USE_API=true npm run dev:h5
 */
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:5199'
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p))
const sleep = ms => new Promise(r => setTimeout(r, ms))

const out = []
const ok = m => out.push('  ✓ ' + m)
const bad = (m, d) => out.push('  ✗ ' + m + (d ? ` — ${d}` : ''))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
const errs = []
const calls = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
page.on('request', r => { const u = r.url(); if (u.includes('4010')) calls.push(r.method() + ' ' + u.replace('http://127.0.0.1:4010', '')) })

const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))

/* 登录汪磊（楼管，有闲置审核与举报处理权） */
await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle2' })
await sleep(1400)
await page.evaluate(() => document.querySelectorAll('.pcard')[1].click())
await sleep(1800)

await page.goto(`${BASE}/#/pages/neighbor/todo`, { waitUntil: 'networkidle2' })
await sleep(2600)
let t = await bodyText()

if (calls.some(c => c.includes('/neighbor/items'))) ok('待办走 /neighbor/items')
else bad('待办没走接口', calls.slice(-3).join(' / '))
if (calls.some(c => c.includes('/neighbor/reports'))) ok('待办走 /neighbor/reports')
else bad('举报没走接口', calls.slice(-3).join(' / '))

const m = t.match(/待审\s*(\d+)[^0-9]*待处理\s*(\d+)/)
if (m) ok(`两段待办：待审 ${m[1]} / 待处理 ${m[2]}`)
else bad('看不到待办计数', t.slice(0, 100))

const beforeItems = m ? Number(m[1]) : 0
await page.screenshot({ path: '/tmp/neighbor-todo.png' })

/* 点第一条闲置进详情 */
const opened = await page.evaluate(() => {
  const el = document.querySelector('[id^="nb-item-"]')
  if (!el) return false
  el.click()
  return true
})
if (opened) {
  await sleep(2400)
  const dt = await bodyText()
  /* 不要卡 id 前缀：闲置是 SH、举报是 RP，写死前缀只在某类数据上成立 */
  if (calls.some(c => /^GET \/neighbor\/items\/[A-Z]+\d+$/.test(c))) ok('详情走 /neighbor/items/{id}')
  else bad('详情没走接口', calls.slice(-3).join(' / '))
  if (/通过|驳回/.test(dt)) ok('详情有审核按钮') ; else bad('看不到审核按钮', dt.slice(0, 60))

  /* 通过 → 回待办应少一条 */
  const passed = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.btn, .foot-btn')].find(e => /^通过/.test(e.innerText.trim()))
    if (!b) return false
    b.click()
    return true
  })
  if (passed) {
    await sleep(2600)
    const posted = calls.some(c => c.startsWith('POST /neighbor/items/') && c.includes('/audit'))
    if (posted) ok('审核动作走了 POST /neighbor/items/{id}/audit') ; else bad('没发审核请求', calls.slice(-4).join(' / '))

    await page.goto(`${BASE}/#/pages/neighbor/todo`, { waitUntil: 'networkidle2' })
    await sleep(2600)
    const t2 = await bodyText()
    const m2 = t2.match(/待审\s*(\d+)/)
    if (m2 && Number(m2[1]) === beforeItems - 1) ok(`审完待办从 ${beforeItems} 降到 ${m2[1]}`)
    else bad('审完待办没变', `前 ${beforeItems} / 后 ${m2 ? m2[1] : '?'}`)
  } else {
    bad('找不到通过按钮', '')
  }
} else {
  bad('没有待审卡片', '')
}

if (!errs.length) ok('零控制台错误') ; else bad('控制台报错', errs.slice(0, 3).join(' / '))

out.push(`\n  接口调用（${calls.length} 条）：`)
;[...new Set(calls)].slice(0, 10).forEach(c => out.push('    ' + c))

console.log(out.join('\n'))
await browser.close()
process.exitCode = out.filter(l => l.startsWith('  ✗')).length ? 1 : 0
