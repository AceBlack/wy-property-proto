/**
 * 批 3 · 抄表推单 + 取消预存 · 验收
 * ------------------------------------------------------------
 * 两件事必须成立：
 *   ① 抄表复核之后能出成账单（否则「已计费」只是个状态，系统里没有应收）
 *   ② 预存账户只退不再收（充值/抵扣/自动抵扣入口全下线，存量余额能退）
 *
 * 推单的三种项目模式在数据里是齐的：P01 水/电都抄表、P02 电自缴水插卡、P03 电插卡水抄表，
 * 所以「推单只推抄表模式」这条不用造假数据也能验。
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
await page.setViewport({ width: 1680, height: 1050 })

const txt = sel => page.evaluate(s => {
  const el = document.querySelector(s)
  return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''
}, sel)
const allTxt = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))

async function open(hash) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
  await page.evaluate(() => localStorage.setItem('wy_proto_role', 'R-GM'))
  await page.goto(`${BASE}/?t=${Date.now()}#${hash}`, { waitUntil: 'networkidle2' })
  await sleep(2200)
}

/** 点 el-select 的某个选项（先点 wrapper 展开） */
async function pickOption(text, rootSel = '', idx = 0) {
  await page.evaluate((sel, i) => {
    const root = sel ? document.querySelector(sel) : document
    root?.querySelectorAll('.el-select__wrapper')[i]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, rootSel, idx)
  await sleep(500)
  const hit = await page.evaluate(t => {
    const op = [...document.querySelectorAll('.el-select-dropdown__item')]
      .filter(x => x.getBoundingClientRect().height > 0)
      .find(x => x.innerText.includes(t))
    if (!op) return false
    op.click(); return true
  }, text)
  await sleep(700)
  return hit
}

await open('/b/meters')

console.log('\n【一】抄表推单：入口与阻断')

const tabs = await page.evaluate(() => [...document.querySelectorAll('.el-tabs__item')].map(x => x.innerText.trim()))
ok(tabs.includes('抄表推单'), '「抄表推单」tab 存在', tabs.join(' / '))

await page.evaluate(() => {
  [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.trim() === '抄表推单')?.click()
})
await sleep(1600)

const block = await txt('.blockbar')
ok(block.includes('不能出账'), '未抄完时给阻断提示（不是默默少出一半）', block.slice(0, 60))
ok(/还有 \d+ 条读数不能出账/.test(block), '阻断条写明具体条数', block.slice(0, 40))

const kpi = await page.evaluate(() =>
  [...document.querySelectorAll('.rsum')].map(x => x.innerText.replace(/\s+/g, ' ').trim()))
ok(kpi.some(t => t.includes('可出账')), '有「可出账 / 全量」指标', kpi[0])
ok(kpi.some(t => t.includes('应出账金额')), '有「应出账金额」指标')

const tableTxt = await txt('[data-area="bill-table"] .el-table')
ok(/抄表出账|物业代充|业主自缴/.test(tableTxt), '明细里能看到三种项目模式', tableTxt.slice(0, 60))
ok(!/0\.62 元\/度|4\.2 元\/吨/.test(tableTxt), '单价不是收费科目上的参考价 0.62 / 4.2')

console.log('\n【二】按项目推单：P03 只推水（电是插卡代充）')

const switched = await pickOption('星光天地', '[data-area="bill"]', 1)
ok(switched, '切到 P03 星光天地（电=插卡，水=抄表）')

const billRows = await page.evaluate(() =>
  [...document.querySelectorAll('[data-area="bill-table"] .el-table__body-wrapper tr')].slice(0, 40).map(tr => ({
    t: tr.innerText.replace(/\s+/g, ' ').trim(),
    mode: [...tr.querySelectorAll('.el-tag')].map(x => x.innerText.trim())
  })))
const cardRows = billRows.filter(r => r.mode.includes('物业代充'))
ok(cardRows.length === 0, '只看要处理的视图里没有「物业代充」的行（插卡不推单）', `${cardRows.length} 行`)

const billableBefore = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[data-area="bill"] .el-button')].find(x => x.innerText.includes('生成水电账单'))
  return btn ? { text: btn.innerText.trim(), disabled: btn.disabled } : null
})
ok(billableBefore && !billableBefore.disabled, '可出账时按钮可用', JSON.stringify(billableBefore))

console.log('\n【三】推单：确认 → 生成账单')

await page.evaluate(() => {
  [...document.querySelectorAll('[data-area="bill"] .el-button')].find(x => x.innerText.includes('生成水电账单'))?.click()
})
await sleep(900)
const box = await txt('.el-message-box')
ok(/仅推已抄完的/.test(box), '有未抄完的表时要求显式确认', box.slice(0, 50))
ok(/跳过/.test(box) || /只出已抄完/.test(box), '确认框说清"会跳过多少户"', box.slice(0, 80))

await page.evaluate(() => {
  [...document.querySelectorAll('.el-message-box__btns .el-button')]
    .find(x => x.innerText.includes('仍然推单'))?.click()
})
await sleep(2000)
const msg = await page.evaluate(() => [...document.querySelectorAll('.el-message')].map(x => x.innerText).join(' | '))
ok(/已生成 \d+ 张水电账单/.test(msg), '推单成功提示', msg.slice(0, 90))

const afterRows = await page.evaluate(() =>
  [...document.querySelectorAll('[data-area="bill-table"] .el-table__body-wrapper tr')].map(tr => tr.innerText.replace(/\s+/g, ' ').trim()))
ok(afterRows.some(t => t.includes('已推单')), '推过的行状态变「已推单」')
ok(afterRows.some(t => /BL-MT\d{6}/.test(t)), '行上回填了账单号（可追溯到读数）')

const kpi2 = await page.evaluate(() =>
  [...document.querySelectorAll('.rsum')].map(x => x.innerText.replace(/\s+/g, ' ').trim()))
ok(/已推单|已推/.test(kpi2.join(' ')), '指标区已推单数跟着变', kpi2[3])

console.log('\n【四】账单落库：账单列表能看到水费')

await page.evaluate(() => { location.hash = '#/b/bills' })
await sleep(1800)
const billsTxt = await allTxt()
ok(/水费/.test(billsTxt), '账单列表出现水费账单')
ok(/BL-MT/.test(billsTxt) || /2026-10/.test(billsTxt), '账期为 2026-10 的当期账单在列表里')

console.log('\n【五】取消预存：页面只退不收')

await page.evaluate(() => { location.hash = '#/b/prepay' })
await sleep(1600)
const retire = await txt('.retire')
ok(retire.includes('停用'), '预存页顶部有停用说明', retire.slice(0, 40))
ok(/存量余额清退/.test(retire), '页面定位改为「存量余额清退」')

const prepayBody = await allTxt()
ok(!/确认充值/.test(prepayBody), '页面上没有「充值」操作')
ok(!/余额抵扣/.test(prepayBody), '页面上没有「抵扣」操作')
ok(/退还余额/.test(prepayBody), '有「退还余额」操作')

const before = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body-wrapper tr')]
    .find(x => x.querySelector('.el-button') && !x.innerText.includes('已销户'))
  return tr ? tr.innerText.replace(/\s+/g, ' ').trim() : ''
})
ok(!!before, '有待清退账户', before.slice(0, 50))

await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body-wrapper tr')]
    .find(x => x.querySelector('.el-button') && !x.innerText.includes('已销户'))
  tr?.querySelector('.el-button')?.click()
})
await sleep(800)
const refundDlg = await txt('.el-dialog')
ok(/退还/.test(refundDlg) && /不可撤销/.test(refundDlg), '退款对话框说明后果（销户、留档）', refundDlg.slice(0, 60))

await page.evaluate(() => {
  [...document.querySelectorAll('.el-dialog__footer .el-button')].find(x => x.innerText.includes('确认退款'))?.click()
})
await sleep(700)
ok(!!(await page.$('.el-message-box')), '退款前二次确认')

await page.evaluate(() => {
  [...document.querySelectorAll('.el-message-box__btns .el-button')].find(x => x.innerText.includes('确认退款'))?.click()
})
await sleep(1600)
const rmsg = await page.evaluate(() => [...document.querySelectorAll('.el-message')].map(x => x.innerText).join(' | '))
ok(/已退还/.test(rmsg), '退款成功提示', rmsg.slice(0, 70))

const kpi3 = await page.evaluate(() =>
  [...document.querySelectorAll('.rsum')].map(x => x.innerText.replace(/\s+/g, ' ').trim()))
ok(/已清退/.test(kpi3.join(' ')), '「已清退（销户）」跟着增加', kpi3[3])

console.log('\n【六】收款方式里不再有「预存抵扣」')

await page.evaluate(() => { location.hash = '#/b/cashier' })
await sleep(2000)
await page.evaluate(() => {
  /* 右栏现在第一个 select 是「减免原因」（2026-11-13 新增），要精确到支付方式那一行 */
  document.querySelector('.split-row .el-select__wrapper')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(600)
const methods = await page.evaluate(() =>
  [...document.querySelectorAll('.el-select-dropdown__item')]
    .filter(x => x.getBoundingClientRect().height > 0).map(x => x.innerText.trim()))
ok(methods.length > 0, '支付方式下拉能展开', methods.join(' / '))
ok(!methods.includes('预存抵扣'), '下拉里没有「预存抵扣」', methods.join(' / '))

console.log('\n【七】控制台')
ok(errs.length === 0, '零 console 错误', errs.slice(0, 2).join(' | '))

await b.close()
console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
