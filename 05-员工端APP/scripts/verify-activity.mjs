/**
 * 邻里「活动」HTTP 切换验证（`npm run verify:activity`）
 *
 * 验的是「代报名」这条线走通：
 *   活动列表（报名中 / 待成行 / 已成行）→ 点进详情 → 报名名单 → 名额与退款档位来自服务端
 *
 * ⚠️ 跑之前重启假服务：报名会往内存里写记录。
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
const failed = []
page.on('response', async r => {
  const u = r.url()
  if (u.includes('4010') && r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${u.replace('http://127.0.0.1:4010', '')}`)
})
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
page.on('request', r => { const u = r.url(); if (u.includes('4010')) calls.push(r.method() + ' ' + u.replace('http://127.0.0.1:4010', '')) })

const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))

/* 登录汪磊（客服主管，有 n.activities.enroll 可代报名） */
await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle2' })
await sleep(1400)
await page.evaluate(() => document.querySelectorAll('.pcard')[1].click())
await sleep(1800)

await page.goto(`${BASE}/#/pages/neighbor/activity`, { waitUntil: 'networkidle2' })
await sleep(2600)
const t = await bodyText()

if (calls.some(c => c.includes('/neighbor/activities'))) ok('活动列表走 /neighbor/activities')
else bad('活动列表没走接口', calls.slice(-3).join(' / '))

/* 列表只出「报名中/待成行/已成行」，草稿与已结束不该出现 */
const cards = await page.evaluate(() => document.querySelectorAll('[id^="act-"], .card').length)
if (cards > 0) ok(`活动卡片 ${cards} 个`) ; else bad('没有活动卡片', t.slice(0, 80))
if (/报名中|待成行|已成行/.test(t)) ok('阶段文案正确') ; else bad('看不到阶段文案', t.slice(0, 60))
if (!/草稿|已流团|已结束/.test(t)) ok('草稿 / 已结束没混进来')
else bad('列表里出现了不该展示的阶段', t.slice(0, 100))

await page.screenshot({ path: '/tmp/activity-list.png' })

/* 点第一场 → 详情 + 报名名单 */
const opened = await page.evaluate(() => {
  const el = document.querySelector('[id^="act-"]') || document.querySelector('.card')
  if (!el) return false
  el.click()
  return true
})
if (opened) {
  await sleep(2600)
  if (calls.some(c => /^GET \/neighbor\/activities\/AC/.test(c))) ok('详情走 /neighbor/activities/{id}')
  else bad('详情没走接口', calls.slice(-3).join(' / '))
  if (calls.some(c => /\/enrolls/.test(c))) ok('报名名单走 /neighbor/activities/{id}/enrolls')
  else bad('名单没走接口', calls.slice(-3).join(' / '))

  const dt = await bodyText()
  if (/报名|名额|已报/.test(dt)) ok('详情显示名额与报名情况') ; else bad('详情缺报名信息', dt.slice(0, 80))
  await page.screenshot({ path: '/tmp/activity-detail.png' })
} else {
  bad('活动卡片点不开', '')
}

if (!errs.length) ok('零控制台错误') ; else bad('控制台报错', errs.slice(0, 3).join(' / '))

if (failed.length) { out.push('\n  失败请求：'); [...new Set(failed)].forEach(f => out.push('    ' + f)) }
out.push(`\n  接口调用（${calls.length} 条）：`)
;[...new Set(calls)].slice(0, 10).forEach(c => out.push('    ' + c))

console.log(out.join('\n'))
await browser.close()
process.exitCode = out.filter(l => l.startsWith('  ✗')).length ? 1 : 0
