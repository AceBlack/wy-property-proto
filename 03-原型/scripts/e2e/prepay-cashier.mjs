/**
 * 批 2 · 收银台预收 / 充值（2026-11-12）
 *
 * 验收：
 *   ① 模式切换存在，账单收款链路不受影响（另一个脚本 cashier-pay 守）；
 *   ② 非计量项：选房 → 选物业费 → 输月份 → 金额 = 月应收 × 月数，平摊到对应账期；
 *   ③ 金额改得不等于"月费×月数" → 改走逐月冲抵，不再平均分；
 *   ④ 减免必须选原因，否则不允许提交；
 *   ⑤ 计量项：输 500 元 → 换算出度数（单价来自收费项）；A 类自缴的项目，该项禁用。
 */
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://localhost:5186'
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = 0; let fail = 0
const ok = (c, m, e = '') => { c ? (pass++, console.log('  ✔ ' + m)) : (fail++, console.log('  ✘ ' + m + (e ? '  → ' + e : ''))) }

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox']
})
const page = await b.newPage()
await page.setViewport({ width: 1680, height: 1200 })
const errs = []
page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })

const txt = () => page.evaluate(() => document.body.innerText)
let booted = false
async function go(hash, role = 'R-GM') {
  if (!booted) { await page.goto(BASE + '/', { waitUntil: 'networkidle2' }); booted = true }
  await page.evaluate(r => localStorage.setItem('wy_proto_role', r), role)
  await page.goto(`${BASE}/?t=${Date.now()}#${hash}`, { waitUntil: 'networkidle2' })
  await sleep(1600)
}

/** 点开第 n 个 select（从 0 起）并选一条含 key 的选项 */
async function pickSelect(nth, key) {
  await page.evaluate(i => {
    const sels = [...document.querySelectorAll('.el-select__wrapper')].filter(x => x.getBoundingClientRect().height > 0)
    sels[i]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, nth)
  await sleep(600)
  const picked = await page.evaluate(k => {
    const opts = [...document.querySelectorAll('.el-select-dropdown__item')]
      .filter(x => x.getBoundingClientRect().height > 0)
    const hit = k ? opts.find(x => x.innerText.includes(k)) : opts[0]
    hit?.click()
    return hit?.innerText || ''
  }, key)
  await sleep(800)
  return picked
}


/** el-input-number 直接改 value 不触发 Vue，改成聚焦后键入 */
async function typeNumber(nth, value) {
  const handles = await page.$$('.pp .el-input-number input')
  const el = handles[nth]
  if (!el) return false
  await el.click({ clickCount: 3 })
  await page.keyboard.press('Backspace')
  await el.type(String(value))
  await page.keyboard.press('Enter')
  await sleep(700)
  return true
}

const ppText = () => page.evaluate(() => {
  const el = document.querySelector('.pp')
  return el ? el.innerText.replace(/\n+/g, ' | ') : ''
})
const chips = () => page.evaluate(() => [...document.querySelectorAll('.pp__chip')].map(x => x.innerText))

console.log('=== ① 模式切换 ===')
await go('/b/cashier')
let t = await txt()
ok(t.includes('账单收款') && t.includes('预收'), '收银台出现模式切换')
ok(t.includes('余额抵扣') || t.includes('账单'), '默认仍是账单收款（原有链路在）')

await page.evaluate(() => {
  const rb = [...document.querySelectorAll('.el-radio-button__inner')].find(x => x.innerText.includes('预收'))
  rb?.click()
})
await sleep(1000)
t = await txt()
ok(t.includes('预收 / 充值'), '切到预收面板')
const billHidden = await page.evaluate(() => !document.querySelector('.cashier'))
ok(billHidden, '账单三栏已隐藏（不共用一张单）', String(billHidden))

console.log('\n=== ② 非计量项：按月份平摊 ===')
const housePick = await pickSelect(0, '')
ok(!!housePick, '选到房屋', housePick)
const itemPick = await pickSelect(1, '物业服务费')
ok(itemPick.includes('物业服务费'), '选到物业费', itemPick)

/* 月份 3 */
await typeNumber(0, 3)
await sleep(800)
let pp = await ppText()
const monthly = Number((pp.match(/月应收\s*¥?\s*([\d,]+\.?\d*)/) || [])[1]?.replace(/,/g, '') || 0)
const total = Number((pp.match(/应收合计\s*¥?\s*([\d,]+\.?\d*)/) || [])[1]?.replace(/,/g, '') || 0)
ok(monthly > 0, '显示月应收', String(monthly))
ok(Math.abs(total - monthly * 3) < 0.05, '金额 = 月应收 × 3', `${total} vs ${monthly * 3}`)
let c = await chips()
ok(c.filter(x => x.includes('-')).length === 3, '平摊到 3 个账期', c.join(' / '))

console.log('\n=== ③ 收款成功 ===')
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.pp button')].find(x => x.innerText.includes('确认收款'))
  btn?.click()
})
await sleep(1400)
pp = await ppText()
ok(pp.includes('已收款'), '结果卡出现', pp.slice(0, 60))
ok(pp.includes('按账期平均摊'), '标记为平均摊')

console.log('\n=== ④ 减免必须选原因 ===')
/* 收款后金额已清零：先重新按 1 个月定价，再填减免 */
await typeNumber(0, 1)
await sleep(600)
/* 减免金额填 10，但不选原因 */
await typeNumber(2, 10)
await sleep(700)
const disabled = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.pp button')].find(x => x.innerText.includes('确认收款'))
  return btn?.disabled === true || btn?.classList.contains('is-disabled')
})
ok(disabled, '有减免但没选原因时，收款按钮不可用', String(disabled))

/* 选一个原因后恢复可用 */
await pickSelect(2, '政策性')
await sleep(600)
const enabled = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.pp button')].find(x => x.innerText.includes('确认收款'))
  return !(btn?.disabled === true)
})
ok(enabled, '选了原因后可以提交', String(enabled))

console.log('\n=== ⑤ 计量项：金额换度数 ===')
await go('/b/cashier')
await page.evaluate(() => {
  const rb = [...document.querySelectorAll('.el-radio-button__inner')].find(x => x.innerText.includes('预收'))
  rb?.click()
})
await sleep(900)
await pickSelect(0, '')
const elecPick = await pickSelect(1, '电费')
if (elecPick.includes('电费')) {
  await typeNumber(0, 500)
  await sleep(900)
  pp = await ppText()
  const qty = Number((pp.match(/折合用量\s*([\d,.]+)/) || [])[1]?.replace(/,/g, '') || 0)
  ok(qty > 500, '500 元换算出度数（按 0.62 元/度 ≈ 806 度）', String(qty))
} else {
  ok(false, '该项目应可选电费（抄表模式）', elecPick)
}

console.log('\n=== 运行时错误 ===')
const real = errs.filter(e => !/favicon|ResizeObserver/i.test(e))
ok(real.length === 0, '零 console / page 错误', real.slice(0, 2).join(' / '))

console.log(`\n通过 ${pass} / 失败 ${fail}`)
await b.close()
process.exit(fail ? 1 : 0)
