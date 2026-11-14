/**
 * 楼栋「租户档案」HTTP 切换验证（`npm run verify:tenant`）
 *
 * 验的是「读写同源」：详情走 `/tenants/{id}`，核验/刷脸/退租走对应 POST。
 * 只读不写 —— 核验与退租会改内存状态，跑第二次就不干净了（写操作的规则由契约测试覆盖）。
 *
 *   前置：
 *     cd 04-契约 && node mock-server.mjs
 *     cd 05-员工端APP && VITE_USE_API=true npm run dev:h5
 */
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:5199'
const TENANT = 'TN00003'            /* 林浩然 · 莫瑞名下 H010120102 · 已核验 */
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
page.on('pageerror', e => errs.push('PAGEERROR: ' + String(e.message).slice(0, 160)))
page.on('request', r => { const u = r.url(); if (u.includes('4010')) calls.push(r.method() + ' ' + u.replace('http://127.0.0.1:4010', '')) })

const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))

/* 莫瑞：楼栋管家，只有他能看租户档案 */
await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle2' })
await sleep(1400)
await page.evaluate(() => document.querySelectorAll('.pcard')[2].click())
await sleep(1800)

await page.goto(`${BASE}/#/pages/building/tenant?tenantId=${TENANT}`, { waitUntil: 'networkidle2' })
await sleep(2800)
const t = await bodyText()

if (calls.some(c => c.includes(`/tenants/${TENANT}`))) ok(`租户详情走 /tenants/${TENANT}`)
else bad('没走接口', calls.slice(-4).join(' / '))

if (/林浩然/.test(t)) ok('页面显示租户姓名') ; else bad('看不到租户姓名', t.slice(0, 100))
if (/已核验|核验中|待核验/.test(t)) ok('核验状态可见') ; else out.push('  · 核验状态文案未匹配')
if (/租期|合同|入住/.test(t)) ok('租期信息可见') ; else out.push('  · 租期文案未匹配')

/* 手机号与身份证都该脱敏（租户档案比业主更敏感，没有"揭示"入口） */
if (/\*{4}/.test(t)) ok('证件/手机号已脱敏') ; else out.push('  · 未见掩码')
if (!/1[3-9]\d{9}/.test(t)) ok('没有明文手机号泄露') ; else bad('页面出现明文手机号', '')

await page.screenshot({ path: '/tmp/tenant-detail-api.png' })

if (!errs.length) ok('零控制台错误') ; else bad('控制台报错', errs.slice(0, 3).join(' / '))

out.push(`\n  接口调用（${calls.length} 条）：`)
;[...new Set(calls)].slice(0, 8).forEach(c => out.push('    ' + c))

console.log(out.join('\n'))
await browser.close()
process.exitCode = out.filter(l => l.startsWith('  ✗')).length ? 1 : 0
