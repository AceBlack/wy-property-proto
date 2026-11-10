/**
 * 工单域 HTTP 切换验证（`npm run verify:wo`）
 *
 * 验的是**读写一起切**是否成立：
 *   可抢 1 张 → 抢 → 列表自己变成"我的 1" → 放弃 → 回"可抢 1"
 * 只验读不验写的话，"抢了单但列表还在"这种问题看不出来。
 *
 * ⚠️ 跑之前必须先重启假服务：
 *   假服务是**内存态**，跑一次就改了数据（抢走一张、记一次弃单），
 *   直接重跑会从"可抢 0"开始，断言全挂 —— 看着像代码坏了，其实是数据脏了。
 *
 *   前置：
 *     cd 04-契约 && node mock-server.mjs            # 假服务 :4010
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

/* 登录周明 */
await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle2' })
await sleep(1400)
await page.evaluate(() => document.querySelectorAll('.pcard')[0].click())
await sleep(1800)

/* ① 列表：可抢 1、我的 0（契约数据里 P01 只有 1 张可抢） */
await page.goto(`${BASE}/#/pages/wo/list`, { waitUntil: 'networkidle2' })
await sleep(2000)
let seg = await segText()
if (/可抢\s*1/.test(seg)) ok(`列表页签来自接口：${seg}`) ; else bad('可抢不是 1', seg)

const cards = await page.evaluate(() => document.querySelectorAll('.card').length)
if (cards === 1) ok('抢单池 1 张卡') ; else bad('卡片数不对', `${cards}`)

const listText = await bodyText()
if (/未支付/.test(listText) && /提成/.test(listText)) ok('卡片带收款状态与提成') ; else bad('卡片缺字段', listText.slice(0, 60))

/* ② 详情：金额与提成来自 /mobile/work-orders/{id} */
const woId = await page.evaluate(() => {
  const el = document.querySelector('[id^="wo-card-"]')
  return el ? String(el.id).replace('wo-card-', '') : ''
})
await page.evaluate(() => document.querySelector('[id^="wo-card-"]')?.click())
await sleep(2000)
const detailText = await bodyText()
if (detailText.includes('¥60.00')) ok('详情金额 ¥60.00 与接口一致') ; else bad('金额不对', detailText.slice(0, 80))
if (/提成/.test(detailText)) ok('详情有提成') ; else bad('缺提成')
if (calls.some(c => c.includes(`/mobile/work-orders/${woId}`))) ok(`详情走 /mobile/work-orders/${woId}`)
else bad('详情没走接口', calls.slice(-3).join(' / '))

/* ③ 抢单 → 列表立刻变（读写一致） */
if (woId) {
  await page.goto(`${BASE}/#/pages/wo/list`, { waitUntil: 'networkidle2' })
  await sleep(1600)
  const grabInfo = await page.evaluate(() => {
    const b = document.querySelector('[id^="grab-"]')
    const ids = [...document.querySelectorAll('.card')].map(e => e.id)
    if (!b) return { clicked: false, ids }
    b.click()
    return { clicked: true, ids }
  })
  const grabbed = grabInfo.clicked
  if (!grabbed) out.push('    （页面上的卡片 id：' + grabInfo.ids.join(',') + '）')
  if (!grabbed) bad('找不到抢单按钮', '')
  await sleep(3200)
  seg = await segText()
  /*
   * 抢单成功后"可抢"池空了 —— 按设计，0 计数的页签会整个消失，
   * 所以这里验的是「我的 1 且可抢已不在」，不是「可抢显示 0」。
   */
  if (/我的\s*1/.test(seg) && !/可抢/.test(seg)) ok(`抢单后列表立刻变：${seg}`)
  else bad('抢单后列表没变（双源）', seg)

  /* ④ 放弃 → 退回池子 */
  await page.goto(`${BASE}/#/pages/wo/detail?id=${woId}`, { waitUntil: 'networkidle2' })
  /* 详情页是异步取数：等它把 d 填上，底部才会渲染出"放弃 / 到场"这排按钮 */
  await sleep(3200)
  const back = await page.evaluate(() => {
    const b = document.querySelector('#wo-abandon')
    if (!b) return false
    b.click()
    return true
  })
  /* 「放弃」是直接执行（无确认弹层），点完会 setTimeout 返回列表 */
  if (back) await sleep(3000)
  else bad('找不到放弃按钮', '')
  await page.goto(`${BASE}/#/pages/wo/list`, { waitUntil: 'networkidle2' })
  await sleep(2000)
  seg = await segText()
  if (/可抢\s*1/.test(seg)) ok('放弃后退回抢单池（可抢 1）') ; else bad('放弃后没回池子', seg)
}

if (!errs.length) ok('零控制台错误') ; else bad('控制台报错', errs.slice(0, 3).join(' / '))

out.push(`\n  接口调用（${calls.length} 条）：`)
;[...new Set(calls)].slice(0, 10).forEach(c => out.push('    ' + c))

console.log(out.join('\n'))
await page.screenshot({ path: '/tmp/wo-api.png' })
await browser.close()
const failed = out.filter(l => l.startsWith('  ✗')).length
process.exitCode = failed ? 1 : 0
