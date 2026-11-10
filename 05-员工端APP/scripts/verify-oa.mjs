/**
 * 审批域 HTTP 切换验证（`npm run verify:oa`）
 *
 * 验的是「待办按节点审批人判」能不能真的走通：
 *   徐悦（项目经理）有待办 → 点进详情能看到当前节点与时间线 → 同意 → 状态推进
 *
 * ⚠️ 跑之前先重启假服务：审批动作会改内存态数据（同意后就不在待办里了）。
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
const segText = () => page.evaluate(() =>
  [...document.querySelectorAll('.seg__i')].map(e => e.innerText.replace(/\s+/g, ' ').trim()).join(' | '))

/* 登录徐悦（项目经理，有审批权且有待办） */
await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle2' })
await sleep(1400)
await page.evaluate(() => document.querySelectorAll('.pcard')[3].click())   // 第 4 张：徐悦
await sleep(1800)

await page.goto(`${BASE}/#/pages/oa/list`, { waitUntil: 'networkidle2' })
await sleep(2200)

let seg = await segText()
if (/待我处理\s*[1-9]/.test(seg)) ok(`页签计数来自接口：${seg}`)
else bad('待我处理为 0 或没取到', seg)

const cards = await page.evaluate(() => document.querySelectorAll('.card').length)
if (cards > 0) ok(`待办卡片 ${cards} 张`) ; else bad('没有待办卡片', '')

/* 详情：当前节点 / 时间线 / 审批按钮 */
await page.evaluate(() => document.querySelector('.card')?.click())
await sleep(2200)
const detail = await bodyText()
if (/审批/.test(detail)) ok('详情页打开') ; else bad('详情页空白', detail.slice(0, 60))
if (calls.some(c => /\/mobile\/approvals\/AP/.test(c))) ok('详情走 /mobile/approvals/{id}')
else bad('详情没走接口', calls.slice(-3).join(' / '))
if (/通过|驳回/.test(detail)) ok('有待办的人能看到审批按钮') ; else bad('看不到审批按钮（canHandle 判定没生效）')

await page.screenshot({ path: '/tmp/oa-api.png' })

/* 同意：走 POST /oa/requests/{id}/action，之后待办应少一条 */
const beforeSeg = seg
const acted = await page.evaluate(() => {
  const b = document.querySelector('#oa-approve')
  if (!b) return false
  b.click()
  return true
})
if (acted) {
  /* 底部「通过」先开审批意见弹层，弹层里再点「确认通过」才提交 */
  await sleep(900)
  const confirmed = await page.evaluate(() => {
    const b = document.querySelector('#oa-confirm')
    if (!b) return false
    b.click()
    return true
  })
  if (!confirmed) bad('找不到确认按钮', '')
  await sleep(2600)
  const posted = calls.some(c => c.startsWith('POST /oa/requests/'))
  if (posted) ok('审批动作走了 POST /oa/requests/{id}/action') ; else bad('没发审批请求', calls.slice(-4).join(' / '))
} else {
  bad('找不到同意按钮', '')
}

if (!errs.length) ok('零控制台错误') ; else bad('控制台报错', errs.slice(0, 3).join(' / '))

out.push(`\n  接口调用（${calls.length} 条）：`)
;[...new Set(calls)].slice(0, 10).forEach(c => out.push('    ' + c))

console.log(out.join('\n'))
await browser.close()
process.exitCode = out.filter(l => l.startsWith('  ✗')).length ? 1 : 0
