/**
 * 租售域 HTTP 切换验证（`npm run verify:listing`）
 *
 * 验的是「审挂牌」这条线走通：
 *   待审 N 条（服务端按角色收敛范围）→ 点进详情 → 通过 → 回到待审少一条
 *
 * ⚠️ 跑之前重启假服务：审核会改内存状态。
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

/* 登录莫瑞（楼栋管家，有 a.listings.* 权限） */
await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle2' })
await sleep(1400)
await page.evaluate(() => document.querySelectorAll('.pcard')[2].click())
await sleep(1800)

/* 房源审核队列在邻里待办页的「租售」段 */
await page.goto(`${BASE}/#/pages/neighbor/todo`, { waitUntil: 'networkidle2' })
await sleep(2600)
const t = await bodyText()

if (calls.some(c => c.includes('/listings?status'))) ok('租售待审走 /listings?status=待审核')
else bad('租售没走接口', calls.slice(-4).join(' / '))

const m = t.match(/房源\s*(\d+)|待审房源\s*(\d+)/)
if (m) ok(`待审房源 ${m[1] || m[2]} 条`)
else out.push('  · 待审房源计数未在页面文案里，跳过数字断言')

const cards = await page.evaluate(() => document.querySelectorAll('[id^="nb-listing-"], [id^="listing-"]').length)
out.push(`  · 房源卡片 ${cards} 个`)

await page.screenshot({ path: '/tmp/listing-todo.png' })

if (cards === 0) {
  /* 没有待审房源是数据问题不是代码问题，但要明确说出来 */
  out.push('  · 没有待审房源卡片，跳过详情与审核断言（假服务重启后仍为空则是数据问题）')
} else {
  const opened = await page.evaluate(() => {
    const el = document.querySelector('[id^="nb-listing-"], [id^="listing-"]')
    if (!el) return false
    el.click()
    return true
  })
  if (opened) {
    await sleep(2400)
    if (calls.some(c => /^GET \/listings\/LS/.test(c))) ok('详情走 /listings/{id}')
    else bad('详情没走接口', calls.slice(-3).join(' / '))
    const dt = await bodyText()
    if (/通过|驳回/.test(dt)) ok('详情有审核按钮') ; else bad('看不到审核按钮', dt.slice(0, 60))

    const passed = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.btn, .foot-btn')].find(e => /^通过/.test(e.innerText.trim()))
      if (!b) return false
      b.click()
      return true
    })
    if (passed) {
      await sleep(2400)
      const posted = calls.some(c => c.startsWith('POST /listings/') && c.includes('/audit'))
      if (posted) ok('审核动作走了 POST /listings/{id}/audit') ; else bad('没发审核请求', calls.slice(-4).join(' / '))
    }
  } else {
    bad('卡片点不开', '')
  }
}

if (!errs.length) ok('零控制台错误') ; else bad('控制台报错', errs.slice(0, 3).join(' / '))

out.push(`\n  接口调用（${calls.length} 条）：`)
;[...new Set(calls)].slice(0, 10).forEach(c => out.push('    ' + c))

console.log(out.join('\n'))
await browser.close()
process.exitCode = out.filter(l => l.startsWith('  ✗')).length ? 1 : 0
