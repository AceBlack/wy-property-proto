/**
 * 楼栋「住户档案」HTTP 切换验证（`npm run verify:house`）
 *
 * 验三件事：
 *   1. 房屋详情走聚合接口 `/mobile/houses/{id}`，页面上有房号 / 业主 / 欠费
 *   2. 业主手机号是全号（这一屏就是要拨出去），不是列表页那种掩码
 *   3. 账单一栏有数据（聚合接口把最近 6 张一起给了）
 *
 * ⚠️ 跑之前重启假服务。
 *
 *   前置：
 *     cd 04-契约 && node mock-server.mjs
 *     cd 05-员工端APP && VITE_USE_API=true npm run dev:h5
 */
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:5199'
const HOUSE = 'H010120101'          /* 翡翠城 1栋2单元0101：莫瑞（楼管）名下 154 套之一 */
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

/* 莫瑞：楼栋管家，唯一有 a.owners.edit 的角色 —— 这一屏对客服主管是锁着的 */
await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle2' })
await sleep(1400)
await page.evaluate(() => document.querySelectorAll('.pcard')[2].click())
await sleep(1800)

await page.goto(`${BASE}/#/pages/building/house?houseId=${HOUSE}`, { waitUntil: 'networkidle2' })
await sleep(2800)
const t = await bodyText()

if (calls.some(c => c.includes(`/mobile/houses/${HOUSE}`))) ok(`房屋详情走 /mobile/houses/${HOUSE}`)
else bad('没走聚合接口', calls.slice(-4).join(' / '))

if (calls.some(c => c.includes('/owner-tags'))) ok('业主标签字典走 /owner-tags')
else out.push('  · 标签字典未请求（可能这户没有标签）')

/* 房号与业主 */
if (/1栋2单元0101|0101/.test(t)) ok('页面显示房号') ; else bad('看不到房号', t.slice(0, 90))
if (/[\u4e00-\u9fa5]{2,4}/.test(t) && /业主/.test(t)) ok('页面显示业主信息') ; else bad('看不到业主姓名', t.slice(0, 90))

/*
 * 手机号：**接口给全号、页面默认脱敏**，点「揭示」才看全。
 * 这是有意的（这一屏会被投屏），所以验的是"揭示后能拿到 11 位明文"，
 * 而不是"一进来就是明文"。
 */
if (/\*{4}/.test(t)) ok('手机号默认脱敏（防投屏）') ; else out.push('  · 未看到掩码样式')
const revealed = await page.evaluate(() => {
  const b = document.querySelector('#reveal-phone')
  if (!b) return false
  b.click()
  return true
})
if (revealed) {
  await sleep(600)
  const t2 = await bodyText()
  const full = t2.match(/1[3-9]\d{9}/)
  if (full) ok(`揭示后是明文（${full[0].slice(0, 3)}****${full[0].slice(-4)}）`)
  else bad('揭示后仍不是明文', t2.slice(0, 120))
} else {
  bad('没有揭示入口', '')
}

/* 账单区 */
if (/物业服务费|电费|水费/.test(t)) ok('账单一栏有数据') ; else bad('账单没显示', t.slice(0, 120))
if (/已缴|欠费|待缴/.test(t)) ok('账单状态可见') ; else out.push('  · 账单状态文案未匹配')

await page.screenshot({ path: '/tmp/house-detail-api.png' })

if (!errs.length) ok('零控制台错误') ; else bad('控制台报错', errs.slice(0, 3).join(' / '))

out.push(`\n  接口调用（${calls.length} 条）：`)
;[...new Set(calls)].slice(0, 8).forEach(c => out.push('    ' + c))

console.log(out.join('\n'))
await browser.close()
process.exitCode = out.filter(l => l.startsWith('  ✗')).length ? 1 : 0
