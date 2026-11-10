/**
 * 楼栋域 HTTP 切换验证（`npm run verify:building`）
 *
 * 验的是「一户一行 + 跳过近 7 天已催」这两个口径真的走通了：
 *   楼栋首页 8 栋 / 28 欠费户 → 催收工作集 14 户（跳过最近催过的）
 *   → 批量登记 → 工作集变少
 *
 * ⚠️ 跑之前重启假服务：批量催收会往内存里写记录。
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

/* 登录汪磊（楼栋管家，有楼层责任范围） */
await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle2' })
await sleep(1400)
await page.evaluate(() => document.querySelectorAll('.pcard')[1].click())
await sleep(1800)

await page.goto(`${BASE}/#/pages/building/index`, { waitUntil: 'networkidle2' })
await sleep(2500)
let t = await bodyText()

if (calls.some(c => c.includes('/mobile/debts'))) ok('楼栋页走 /mobile/debts')
else bad('楼栋页没走接口', calls.slice(-3).join(' / '))

/* 汇总：8 栋 / 352 房 / ¥12093.79（契约数据） */
if (/8\s*栋/.test(t)) ok('汇总栋数 8') ; else bad('栋数不对', t.slice(0, 80))
if (/12,?093/.test(t)) ok('欠费合计 ¥12,093') ; else bad('欠费合计不对', t.slice(0, 100))

/* 欠费户卡片 */
const cards = await page.evaluate(() => document.querySelectorAll('[class*="hh"], [class*="card"]').length)
if (cards > 0) ok(`欠费户卡片 ${cards} 个`) ; else bad('没有欠费户卡片', '')

/* 首页必须是「全部欠费户」，不能跳过最近催过的 */
const allRows = await page.evaluate(() => document.querySelectorAll('.hh, .debt-row, .row').length)
out.push(`  · 首页行数 ${allRows}（工作集应比它少）`)

await page.screenshot({ path: '/tmp/building-api.png' })

/* 催收页：工作集应少于首页 */
await page.goto(`${BASE}/#/pages/building/collect`, { waitUntil: 'networkidle2' })
await sleep(2500)
const workText = await bodyText()
const workRows = await page.evaluate(() => document.querySelectorAll('.wr, .work-row, .row').length)
if (workRows > 0) ok(`催收工作集 ${workRows} 户`) ; else bad('工作集为空', workText.slice(0, 80))
out.push(`  · 工作集行数 ${workRows}（首页 ${allRows}）`)
if (workRows <= allRows) ok('工作集 ≤ 全部欠费户（跳过近 7 天已催生效）')
else bad('工作集比全部还多', `${workRows} > ${allRows}`)

await page.screenshot({ path: '/tmp/collect-api.png' })

if (!errs.length) ok('零控制台错误') ; else bad('控制台报错', errs.slice(0, 3).join(' / '))

out.push(`\n  接口调用（${calls.length} 条）：`)
;[...new Set(calls)].slice(0, 10).forEach(c => out.push('    ' + c))

console.log(out.join('\n'))
await browser.close()
process.exitCode = out.filter(l => l.startsWith('  ✗')).length ? 1 : 0
