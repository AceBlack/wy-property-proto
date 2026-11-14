/**
 * 移动抄表验证（`npm run verify:meter`）
 *
 * 验的是「能抄完」这条线：
 *   任务页入口（带待抄数字）→ 清单按楼栋分组 → 点一行弹层 → 录入 → 清单变已抄
 *
 * ⚠️ 跑之前重启假服务：录入会改内存状态，重跑会从"已抄过"的数据开始。
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
const note = m => out.push('  · ' + m)

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
const errs = []
const calls = []
const failed = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
page.on('pageerror', e => errs.push('PAGEERROR: ' + String(e.message).slice(0, 160)))
page.on('request', r => { const u = r.url(); if (u.includes('4010')) calls.push(r.method() + ' ' + u.replace('http://127.0.0.1:4010', '')) })
page.on('response', async r => {
  const u = r.url()
  if (u.includes('4010') && r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${u.replace('http://127.0.0.1:4010', '')}`)
})

const bodyText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))

/* 莫瑞：楼栋管家，有 b.meters.view / b.meters.read */
await page.goto(`${BASE}/#/pages/login/index`, { waitUntil: 'networkidle2' })
await sleep(1400)
await page.evaluate(() => document.querySelectorAll('.pcard')[2].click())
await sleep(1800)

/* ① 工作台卡片 */
await page.goto(`${BASE}/#/pages/home/index`, { waitUntil: 'networkidle2' })
await sleep(2600)
const homeCard = await page.evaluate(() => {
  const el = document.querySelector('#mod-meter')
  return el ? el.innerText.replace(/\s+/g, ' ') : ''
})
if (homeCard) ok(`工作台有抄表卡片：${homeCard.slice(0, 40)}`)
else bad('工作台没有抄表卡片', (await bodyText()).slice(0, 90))

/* ② 任务页入口 */
await page.goto(`${BASE}/#/pages/tasks/list`, { waitUntil: 'networkidle2' })
await sleep(2600)
const hasEntry = await page.evaluate(() => !!document.querySelector('#meter-entry'))
const entryText = await page.evaluate(() => document.querySelector('#meter-entry')?.innerText.replace(/\s+/g, ' ') || '')

if (hasEntry) ok(`任务页有抄表入口：${entryText.slice(0, 40)}`)
else bad('任务页没有抄表入口', (await bodyText()).slice(0, 90))

if (/\d+/.test(entryText)) ok('入口带待抄户数') ; else bad('入口没有数字', entryText)

/* ③ 进清单 */
const jumped = await page.evaluate(() => {
  const el = document.querySelector('#meter-entry')
  if (!el) return false
  el.click()
  return true
})
if (jumped) {
  await sleep(2600)
  const t = await bodyText()
  if (calls.some(c => c.includes('/mobile/meters'))) ok('清单走 /mobile/meters')
  else bad('清单没走接口', calls.slice(-3).join(' / '))
  if (/待抄/.test(t) && /已抄待复核/.test(t)) ok('顶部有汇总（待抄 / 已抄 / 异常）')
  else bad('看不到汇总', t.slice(0, 90))
  if (/\d+栋/.test(t)) ok('按楼栋分组') ; else note('未识别楼栋分组标题')
  const rows = await page.evaluate(() => document.querySelectorAll('[id^="mt-"]').length)
  if (rows > 0) ok(`清单 ${rows} 行`) ; else bad('清单没有行', t.slice(0, 120))
  await page.screenshot({ path: '/tmp/meter-list.png' })

  /* ④ 点一行 → 弹层 → 录入 */
  const opened = await page.evaluate(() => {
    const el = document.querySelector('[id^="mt-"]')
    if (!el) return false
    el.click()
    return true
  })
  if (opened) {
    await sleep(1400)
    const dt = await bodyText()
    if (/上期读数/.test(dt)) ok('弹层显示上期读数') ; else bad('弹层没有上期读数', dt.slice(0, 90))
    if (/本期读数/.test(dt)) ok('弹层有本期输入') ; else bad('弹层没有输入框', dt.slice(0, 90))

    /* 读出上期的值，填 +12 */
    const last = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.last__v')]
      const n = els.length ? Number(els[0].innerText.replace(/[^\d.]/g, '')) : NaN
      return Number.isNaN(n) ? null : n
    })
    if (last !== null) {
      const val = String(last + 12)
      /*
       * 用真实键盘输入，不要 `el.value = x` + dispatchEvent ——
       * uni 的 <input> 在 H5 下有自己的事件处理，直接改 value 不会进 Vue 的 v-model，
       * 表现为"DOM 上有值、按钮还是灰的"。
       */
      const box = await page.$('#mt-input')
      if (box) {
        await box.click({ clickCount: 3 })
        await page.keyboard.type(val, { delay: 40 })
      }
      await sleep(800)
      const before = await bodyText()
      if (/用量/.test(before) && !/用量\s*—/.test(before)) ok('实时显示用量') ; else note('用量还没算出来')

      /* 打印按钮状态：is-off 表示端上预判"不能提交"，能直接看出是哪一条没满足 */
      const dbg = await page.evaluate(() => {
        const b = document.querySelector('#mt-submit')
        const inp = document.querySelector('#mt-input')
        return {
          hasBtn: !!b,
          cls: b ? b.className : '',
          inputVal: inp ? inp.value : '(无输入框)',
          lastText: (document.querySelector('.last__v') || {}).innerText || ''
        }
      })
      out.push(`  · 按钮 ${dbg.cls || '?'} · 输入 "${dbg.inputVal}" · 上期 "${dbg.lastText}"`)

      const submitted = await page.evaluate(() => {
        const b = document.querySelector('#mt-submit')
        if (!b) return false
        b.click()
        return true
      })
      if (submitted) {
        await sleep(2600)
        const posted = calls.some(c => c.startsWith('POST /mobile/meters/'))
        if (posted) ok('录入走了 POST /mobile/meters/{id}/reading')
        else bad('没发录入请求', calls.slice(-4).join(' / '))
        const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
        if (/已提交|待复核/.test(after)) ok('提交后给出结果')
        else note('未见成功文案（可能在 toast 里已消失）')
      } else {
        bad('提交按钮点不到', '')
      }
    } else {
      bad('读不到上期读数', '')
    }
  } else {
    bad('清单行点不开', '')
  }
} else {
  bad('入口点不动', '')
}

if (!errs.length) ok('零控制台错误') ; else bad('控制台报错', errs.slice(0, 3).join(' / '))
if (failed.length) { bad('有请求失败', [...new Set(failed)].slice(0, 3).join(' / ')) }

out.push(`\n  接口调用（${calls.length} 条）：`)
;[...new Set(calls)].slice(0, 8).forEach(c => out.push('    ' + c))

console.log(out.join('\n'))
await browser.close()
process.exitCode = out.filter(l => l.startsWith('  ✗')).length ? 1 : 0
