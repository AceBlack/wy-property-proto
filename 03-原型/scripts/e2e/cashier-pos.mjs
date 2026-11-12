/**
 * 收银台三栏 POS · 验收
 * ------------------------------------------------------------
 * 2026-11-13 收银台从「后台表单」重做成「左找人 / 中收钱 / 右结账」，
 * 旧的 cashier-pay / temp-charges / ticket-issue 三个脚本是按老 UI 写的，
 * 选择器已失效 —— 本脚本覆盖新结构，旧脚本保留作业务逻辑对照。
 *
 * 覆盖四件事：
 *   ① 三类业务各自的形态（账期格子 / 有效期 / 预充或抄表或自缴）
 *   ② 加收三个 tab（其他科目 / 押金 / 临时收费）
 *   ③ 合计必须拆成 收入类 / 押金 / 实收 三行 —— 押金进收入就是虚增营收
 *   ④ 收款后：账单销账、车位有效期前移、清单清空
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
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)) })
page.on('pageerror', e => errs.push('pageerror ' + String(e).slice(0, 120)))
await page.setViewport({ width: 1680, height: 1100 })

const txt = sel => page.evaluate(s => {
  const el = document.querySelector(s)
  return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''
}, sel)

async function open() {
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
  await page.evaluate(() => localStorage.setItem('wy_proto_role', 'R-GM'))
  await page.goto(`${BASE}/?t=${Date.now()}#/b/cashier`, { waitUntil: 'networkidle2' })
  await sleep(2400)
}

await open()

console.log('\n【一】三栏与三类业务')

ok(await page.$('.pos-left'), '左栏（客户）在')
ok(await page.$('.pos-mid'), '中栏（业务）在')
ok(await page.$('.pos-right'), '右栏（结算）在')

const cells = await page.evaluate(() => [...document.querySelectorAll('.pcell')].map(x => ({
  t: x.innerText.replace(/\s+/g, ' ').trim(),
  cls: x.className
})))
ok(cells.length === 6, '物业费账期 6 格（一行放下，不出现 6+2 折行）', `${cells.length} 格`)
ok(cells.filter(c => c.cls.includes('is-due')).length > 0, '有欠费格（红）')
ok(cells.filter(c => c.cls.includes('is-fut')).length > 0, '有未到期格（虚线）')

const parkTxt = await txt('.park')
ok(parkTxt.includes('有效期至'), '车位块显示有效期而不是"欠几期"', parkTxt.slice(0, 40))
ok(/剩 \d+ 天|已失效/.test(parkTxt), '车位显示剩余天数 / 失效态')

const utilTxt = await txt('.util')
ok(/预充买量|抄表账单|系统不参与/.test(utilTxt), '水电块按项目配置呈现形态')
ok(/元\/度|元\/吨/.test(utilTxt), '水电单价来自价目表')

console.log('\n【二】点账期 + 车位续期 + 押金')

const dueIdx = await page.evaluate(() => [...document.querySelectorAll('.pcell')]
  .map((x, i) => x.className.includes('is-due') ? i : -1).filter(i => i >= 0))
await page.evaluate(n => document.querySelectorAll('.pcell')[n].click(), dueIdx[0])
await sleep(400)
ok((await txt('.cart')).includes('物业服务费'), '点账期格子后进入右栏清单')

await page.evaluate(() => document.querySelector('.park__act .el-button')?.click())
await sleep(700)
ok((await txt('.cart')).includes('车位管理服务费'), '车位续期加入清单')

await page.evaluate(() => {
  [...document.querySelectorAll('.add__tabs span')].find(x => x.innerText === '押金')?.click()
})
await sleep(400)
ok((await txt('.add__body')).includes('押金'), '押金面板展开')
await page.evaluate(() => {
  [...document.querySelectorAll('.add__body .el-button')].find(x => x.innerText.includes('加入'))?.click()
})
await sleep(700)
const cartTxt = await txt('.cart')
ok(cartTxt.includes('押金'), '押金进入清单')
ok(cartTxt.includes('不计收入'), '清单上标明押金不计收入')

console.log('\n【三】合计必须拆三行')

const sumTxt = await txt('.sum')
ok(sumTxt.includes('收入类合计'), '有「收入类合计」')
ok(sumTxt.includes('押金'), '有「押金（负债，不计收入）」单独一行')
ok(sumTxt.includes('本次实收'), '有「本次实收」')
const nums = sumTxt.match(/[\d,]+\.\d{2}/g) || []
ok(nums.length >= 3, '三个金额都在（收入 / 押金 / 实收）', nums.join(' / '))

console.log('\n【四】其他科目加收')

await page.evaluate(() => {
  [...document.querySelectorAll('.add__tabs span')].find(x => x.innerText === '其他科目')?.click()
})
await sleep(400)
/* el-select 的可点区域是 __wrapper，点外层 .el-select 不展开 */
const itemOpts = await page.evaluate(() => {
  const s = document.querySelector('.add__body .el-select__wrapper')
  s?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return !!s
})
await sleep(600)
const optCount = await page.evaluate(() =>
  [...document.querySelectorAll('.el-select-dropdown__item')].filter(x => x.getBoundingClientRect().height > 0).length)
ok(itemOpts && optCount > 0, '其他科目下拉有可选项', `${optCount} 项`)

console.log('\n【五】收款落库')

const parkBefore = await page.evaluate(async () => {
  const m = await import('/src/utils/api.js')
  return m.parkingRenewQuote('PK00115', 1).oldExpire
})
const totalBefore = await txt('.sum__total')
await page.evaluate(() => {
  [...document.querySelectorAll('.pay-actions .el-button')].find(x => x.innerText.includes('收款'))?.click()
})
await sleep(2400)
const msg = await page.evaluate(() =>
  [...document.querySelectorAll('.el-message')].map(x => x.innerText).join(' | '))
ok(/收款 ¥/.test(msg), '收款成功有提示', msg.slice(0, 70))
ok(!(await page.evaluate(() => !!document.querySelector('.cart .ci'))), '收款后清单清空')

const parkAfter = await page.evaluate(async () => {
  const m = await import('/src/utils/api.js')
  return m.parkingRenewQuote('PK00115', 1).oldExpire
})
ok(parkBefore !== parkAfter, '车位有效期已前移（落库，不只是界面）', `${parkBefore} → ${parkAfter}`)

ok(await page.evaluate(() => !!document.querySelector('.pay-done')), '右栏出现收款结果卡（可当场开票）')

console.log('\n【六】业态取价：商业户单价跟着变')

await open()
const switched = await page.evaluate(() => {
  const hit = [...document.querySelectorAll('.oitem')].find(x => x.innerText.includes('星光天地'))
  if (!hit) return false
  hit.click(); return true
})
ok(switched, '切到星光天地（P03，电=预充 / 水=抄表）')
await sleep(2000)
const bizUtil = await txt('.util')
ok(/0\.8 元\/度|0\.9 元\/度|1 元\/度/.test(bizUtil), '商业电价按业态取到（0.8 / 0.9 / 1.0）', bizUtil.slice(0, 60))
ok(bizUtil.includes('5.55'), '商业水价 5.55')

console.log('\n【七】控制台')
ok(errs.length === 0, '零 console 错误', errs.slice(0, 2).join(' | '))

await b.close()
console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
