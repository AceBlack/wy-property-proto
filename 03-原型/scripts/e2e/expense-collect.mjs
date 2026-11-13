/**
 * 批 5 · 支出归集 / 手工补录 / 押金口径 · 验收
 * ------------------------------------------------------------
 * 三条必须成立：
 *   ① 支出归集是四类来源的合并视图，且「合计 = 各来源之和」
 *      —— 差一分钱就说明有一类来源没进来，或者进来了两次
 *   ② 手工补录只收「允许补录」的分类：税费能进（只能补录），办公费不能进（必须走报销）
 *   ③ 押金是负债，不进收入
 */
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://localhost:5186'
const sleep = ms => new Promise(r => setTimeout(r, ms))

let pass = 0
let fail = 0
const ok = (cond, name, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✘ ${name}${extra ? '  → ' + extra : ''}`) }
}

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox']
})
const page = await b.newPage()
const errs = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
page.on('pageerror', e => errs.push('pageerror ' + String(e).slice(0, 140)))
await page.setViewport({ width: 1680, height: 1080 })

const txt = sel => page.evaluate(s => {
  const el = document.querySelector(s)
  return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''
}, sel)
const allTxt = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))

async function open(hash) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
  await page.evaluate(() => localStorage.setItem('wy_proto_role', 'R-GM'))
  await page.goto(`${BASE}/?t=${Date.now()}#${hash}`, { waitUntil: 'networkidle2' })
  await sleep(2400)
}

const num = s => {
  const m = String(s).match(/¥?\s*([\d,]+\.\d{2})/)
  return m ? Number(m[1].replace(/,/g, '')) : 0
}

await open('/b/expense-collect')

console.log('\n【一】支出归集：四类来源')

const kpi = await page.evaluate(() =>
  [...document.querySelectorAll('.rsum')].map(x => x.innerText.replace(/\s+/g, ' ').trim()))
ok(kpi.some(t => t.includes('支出合计')), '有「支出合计」', kpi[0])
ok(kpi.some(t => t.includes('费用报销')), '有「费用报销」')
ok(kpi.some(t => t.includes('工资')), '有「工资」')
ok(kpi.some(t => t.includes('合同支出')), '有「合同支出」')
ok(kpi.some(t => t.includes('手工补录')), '有「手工补录」')

const srcCards = await page.evaluate(() =>
  [...document.querySelectorAll('.src__i')].map(x => x.innerText.replace(/\s+/g, ' ').trim()))
ok(srcCards.length >= 3, '来源构成有至少三类（报销 / 工资 / 合同 / 补录）', `${srcCards.length} 类`)

/* 合计 = 各来源之和：这条对不上就说明有一类没进来，或进来两次。
   用表格合计行（元）而不是 KPI 卡（万元），否则单位不同比不出来 */
const footer = await txt('.el-table__footer')
const totalAmt = num(footer)
const srcSum = srcCards.reduce((s, t) => s + num(t), 0)
ok(totalAmt > 0 && Math.abs(totalAmt - srcSum) < 1,
  '合计 = 各来源之和（不多算、不漏算）', `${totalAmt} vs ${srcSum}`)

const parentTxt = await txt('.two')
ok(/人力成本|合同支出|运营费用/.test(parentTxt), '按一级分类有汇总', parentTxt.slice(0, 50))

/* 指标卡与「按来源」必须逐项相等：不同口径并排会让人以为有一处算错 */
const payCard = kpi.find(t => t.includes('工资')) || ''
const conCard = kpi.find(t => t.includes('合同支出')) || ''
const srcPay = srcCards.find(t => t.includes('工资')) || ''
const srcCon = srcCards.find(t => t.includes('合同支出')) || ''
/* 指标卡用「万元」显示（1 位小数），来源卡用「元」，所以按万元折算后比，容差 1000 元 */
const wanNum = t => { const m = String(t).match(/¥\s*([\d.]+)\s*万/); return m ? Number(m[1]) * 10000 : 0 }
ok(Math.abs(wanNum(payCard) - num(srcPay)) < 1000 && Math.abs(wanNum(conCard) - num(srcCon)) < 1000,
  '指标卡金额 = 来源卡金额（同一口径，只是单位不同）',
  `${wanNum(payCard)}/${num(srcPay)} · ${wanNum(conCard)}/${num(srcCon)}`)

/* 切到 2026-09：季度税费在那个月，四类来源才齐全 */
await page.evaluate(() => {
  document.querySelectorAll('.filter-bar .el-select__wrapper')[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(500)
await page.evaluate(() => {
  [...document.querySelectorAll('.el-select-dropdown__item')]
    .filter(x => x.getBoundingClientRect().height > 0).find(x => x.innerText.trim() === '2026-09')?.click()
})
await sleep(1600)
const src9 = await page.evaluate(() =>
  [...document.querySelectorAll('.src__i')].map(x => x.innerText.replace(/\s+/g, ' ').trim()))
ok(src9.length === 4, '2026-09 四类来源齐全（含季度税费与工资）', src9.map(x => x.split(' ')[0]).join(' / '))
ok(src9.some(t => t.includes('手工补录')), '手工补录在季度末出现（税费按季申报）')

console.log('\n【二】税金及附加只能在补录里出现')

await page.evaluate(() => { location.hash = '#/b/manual-entries' })
await sleep(2000)
const me = await allTxt()
ok(/手工补录/.test(me), '补录页打开')
ok(/税金及附加/.test(me), '列表里能看到税金及附加')
ok(/只能补录/.test(me), '页面写明税费只能补录')

const meKpi = await page.evaluate(() =>
  [...document.querySelectorAll('.rsum')].map(x => x.innerText.replace(/\s+/g, ' ').trim()))
ok(meKpi.some(t => t.includes('税金及附加')), 'KPI 单列税金及附加', meKpi[3])

console.log('\n【三】新建补录：分类只能选「允许补录」的')

await page.evaluate(() => {
  [...document.querySelectorAll('.el-button')].find(x => x.innerText.includes('新建补录'))?.click()
})
await sleep(800)
ok(!!(await page.$('.el-dialog')), '新建对话框打开')

/* 展开费用分类下拉，看选项 */
await page.evaluate(() => {
  const dlg = document.querySelector('.el-dialog')
  dlg?.querySelectorAll('.el-select__wrapper')[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(700)
const catOpts = await page.evaluate(() =>
  [...document.querySelectorAll('.el-select-dropdown__item')]
    .filter(x => x.getBoundingClientRect().height > 0).map(x => x.innerText.trim()))
ok(catOpts.length > 0, '分类下拉有选项', `${catOpts.length} 项`)
ok(catOpts.some(t => t.includes('税金及附加')), '能选到「税金及附加」')
ok(!catOpts.some(t => t.includes('差旅费')) && !catOpts.some(t => t.includes('业务招待')),
  '选不到「差旅费 / 业务招待」（字典里没有 manual 通道）', catOpts.join(' / ').slice(0, 90))

/* 选一个分类并填完整，保存 */
await page.evaluate(() => {
  [...document.querySelectorAll('.el-select-dropdown__item')]
    .filter(x => x.getBoundingClientRect().height > 0)
    .find(x => x.innerText.includes('其他运营费用'))?.click()
})
await sleep(600)
await page.evaluate(() => {
  const dlg = document.querySelector('.el-dialog')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  /* 金额 */
  const amt = dlg?.querySelector('.el-input-number input')
  if (amt) { setter.call(amt, '1280'); amt.dispatchEvent(new Event('input', { bubbles: true })); amt.dispatchEvent(new Event('change', { bubbles: true })) }
  /* 原因 */
  const ta = dlg?.querySelector('textarea')
  if (ta) {
    /* textarea 不是 HTMLInputElement：拿 input 的 setter 去 call 它会报 Illegal invocation */
    const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    taSetter.call(ta, '垃圾清运队无法开票，按实际情况说明补录')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }
})
await sleep(600)
await page.evaluate(() => {
  [...document.querySelectorAll('.el-dialog__footer .el-button')].find(x => x.innerText.includes('确认入账'))?.click()
})
await sleep(1600)
const saveMsg = await page.evaluate(() =>
  [...document.querySelectorAll('.el-message')].map(x => x.innerText).join(' | '))
ok(/已入账/.test(saveMsg), '补录保存成功', saveMsg.slice(0, 80))

const afterSave = await allTxt()
ok(/垃圾清运队无法开票/.test(afterSave), '新记录出现在列表里')

console.log('\n【四】作废必须写原因')

await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body-wrapper tr')]
    .find(x => x.innerText.includes('垃圾清运队无法开票'))
  tr?.querySelector('.el-button')?.click()
})
await sleep(800)
ok(!!(await page.$('.el-message-box')), '作废前弹确认框')
const boxTxt = await txt('.el-message-box')
ok(/作废后/.test(boxTxt), '确认框说明作废后果（留档、不进报表）', boxTxt.slice(0, 50))

await page.evaluate(() => {
  [...document.querySelectorAll('.el-message-box__btns .el-button')].find(x => x.innerText.trim() === '确认作废')?.click()
})
await sleep(700)
ok(!!(await page.$('.el-message-box')), '不写原因不允许作废（还在弹窗里）')

await page.evaluate(() => {
  const inp = document.querySelector('.el-message-box input')
  if (inp) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '测试作废')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
  }
})
await sleep(400)
await page.evaluate(() => {
  [...document.querySelectorAll('.el-message-box__btns .el-button')].find(x => x.innerText.trim() === '确认作废')?.click()
})
await sleep(1400)
const voidMsg = await page.evaluate(() =>
  [...document.querySelectorAll('.el-message')].map(x => x.innerText).join(' | '))
ok(/已作废/.test(voidMsg), '写作废原因后作废成功', voidMsg.slice(0, 60))

console.log('\n【五】押金是负债，不进收入')

await page.evaluate(() => { location.hash = '#/b/deposits' })
await sleep(1800)
const dep = await allTxt()
ok(/押金是负债，不是收入/.test(dep), '押金页写明「负债，不是收入」')
ok(/LIA_DEPOSIT|押金及保证金/.test(dep), '挂到分类「押金及保证金」')
ok(/收 = 退 \+ 扣 \+ 在账|收 = 退/.test(dep), '保留「收 = 退 + 扣 + 在账」口径')

console.log('\n【六】控制台')
ok(errs.length === 0, '零 console 错误', errs.slice(0, 2).join(' | '))

await b.close()
console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
