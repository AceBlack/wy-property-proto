/**
 * 移动抄表 · 离线验证（`npm run verify:meter-offline`）
 *
 * 楼道里没信号是常态，这条链路必须通：
 *   切离线 → 抄一户 → 存本地并标「待同步」→ 切回在线 → 自动上传 → 该户变已抄
 *
 * 验的是"队列真的存在、回网真的会传"，不是"页面提示了一下"。
 *
 *   前置：cd 05-员工端APP && VITE_USE_API=true npm run dev:h5
 *   （离线这一段不需要假服务：断网就是断网；但回网同步要，所以还是起着）
 */
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:5199'
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p))
const sleep = ms => new Promise(r => setTimeout(r, ms))

const out = []
const ok = m => out.push('  ✓ ' + m)
const bad = (m, d) => out.push('  ✗ ' + m + (d ? ` — ${d}` : ''))
const note = m => out.push('  · ' + m)

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
const errs = []
const posts = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
page.on('pageerror', e => errs.push('PAGEERROR: ' + String(e.message).slice(0, 160)))
page.on('request', r => {
  const u = r.url()
  if (u.includes('4010') && r.method() === 'POST' && u.includes('/mobile/meters/')) posts.push(u.replace('http://127.0.0.1:4010', ''))
})

const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
/* 「我的」页的演示开关：id 形如 net-offline / net-online（见 mine/index.vue） */
const goNet = async v => {
  await page.goto(`${BASE}/#/pages/mine/index`, { waitUntil: 'networkidle2' })
  await sleep(1800)
  const hit = await page.evaluate(id => {
    const el = document.querySelector('#' + id)
    if (!el) return false
    el.click()
    return true
  }, v === '离线' ? 'net-offline' : 'net-online')
  await sleep(1000)
  return hit
}

/* 登录莫瑞（楼栋管家） */
await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle2' })
await sleep(1400)
await page.evaluate(() => document.querySelectorAll('.pcard')[2].click())
await sleep(1800)

/* ① 切离线 */
const off = await goNet('离线')
if (off) ok('已切到离线') ; else bad('找不到离线开关', '')

/* ② 进抄表页，抄一户 */
await page.goto(`${BASE}/#/pages/meter/list`, { waitUntil: 'networkidle2' })
await sleep(2400)

let t = await bodyText()
if (/当前离线/.test(t)) ok('清单页顶部提示当前离线')
else note('未见离线提示（可能离线态没传到页面）')

const opened = await page.evaluate(() => {
  const el = document.querySelector('[id^="mt-"]')
  if (!el) return false
  el.click()
  return true
})
if (opened) {
  await sleep(1300)
  const last = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.last__v')]
    const n = els.length ? Number(els[0].innerText.replace(/[^\d.]/g, '')) : NaN
    return Number.isNaN(n) ? null : n
  })
  if (last !== null) {
    const box = await page.$('#mt-input')
    if (box) {
      await box.click({ clickCount: 3 })
      await page.keyboard.type(String(last + 9), { delay: 40 })
    }
    await sleep(700)

    const before = posts.length
    await page.evaluate(() => {
      const b = document.querySelector('#mt-submit')
      if (b) b.click()
    })
    await sleep(2200)

    if (posts.length === before) ok('离线时没有硬发请求（正确：先存本地）')
    else bad('离线时居然发出了请求', posts.slice(-2).join(' / '))

    t = await bodyText()
    if (/待同步/.test(t)) ok('该户标成「待同步」')
    else bad('没标待同步', t.slice(0, 120))

    if (/存在本地|回网/.test(t)) note('有"回网自动上传"的提示（toast 可能已消失）')

    const pendingCount = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.offline__t, .offline')][0]
      return el ? el.innerText : ''
    })
    if (/1 条|待上传/.test(pendingCount)) ok(`顶部提示队列：${pendingCount.slice(0, 30)}`)
    else note(`队列提示未识别：${pendingCount.slice(0, 30)}`)

    await page.screenshot({ path: '/tmp/meter-offline.png' })
  } else {
    bad('读不到上期读数', '')
  }
} else {
  bad('清单行点不开（离线时清单应为上次的数据）', (await bodyText()).slice(0, 100))
}

/* ③ 切回在线 → 自动同步 */
const on = await goNet('在线')
if (on) ok('已切回在线') ; else bad('切不回在线', '')
await sleep(2600)

if (posts.length > 0) ok(`回网后自动上传：${posts.length} 次 POST`)
else bad('回网后没有自动上传（队列没被消费）', '')

await page.goto(`${BASE}/#/pages/meter/list`, { waitUntil: 'networkidle2' })
await sleep(2400)
t = await bodyText()
if (!/待同步/.test(t)) ok('清单里不再有「待同步」')
else bad('同步后仍标待同步', t.slice(0, 120))

if (!errs.length) ok('零控制台错误') ; else bad('控制台报错', errs.slice(0, 3).join(' / '))

out.push(`\n  上传请求（${posts.length} 条）：`)
posts.slice(0, 3).forEach(p => out.push('    ' + p))

console.log(out.join('\n'))
await browser.close()
process.exitCode = out.filter(l => l.startsWith('  ✗')).length ? 1 : 0
