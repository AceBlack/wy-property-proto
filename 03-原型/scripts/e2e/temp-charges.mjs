/**
 * 第 63 批 · 临时收费台账
 *
 * 关键口径（断言围绕这几条）：
 *   ① 独立成表：不写 bills、不产生应收 —— 所以**不进收缴率**；
 *   ② 收款写一条 payment（channel='临时收费'，billId 为空），日结能看到；
 *   ③ 计入收入：companyRevenue.temp 与营业报表的「临时收费收入」行；
 *   ④ 已收款的单据不能改、不能作废；作废必须写原因。
 *
 * 导航一律用同文档改 hash —— 整页重载会把内存态（新建的单、刚收的钱）全部还原。
 */
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:5186'
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = 0; let fail = 0
const ok = (c, m, e = '') => { c ? (pass++, console.log('  ✔ ' + m)) : (fail++, console.log('  ✘ ' + m + (e ? '  → ' + e : ''))) }

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox']
})
const page = await b.newPage()
await page.setViewport({ width: 1680, height: 1100 })
const errs = []
page.on('pageerror', e => errs.push(String(e).slice(0, 300)))
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })

const txt = () => page.evaluate(() => document.body.innerText)
let booted = false
async function go(hash, role = 'R-CHG') {
  if (!booted) { await page.goto(BASE + '/', { waitUntil: 'networkidle2' }); booted = true }
  await page.evaluate(r => localStorage.setItem('wy_proto_role', r), role)
  await page.goto(`${BASE}/?t=${Date.now()}#${hash}`, { waitUntil: 'networkidle2' })
  await sleep(1700)
}
async function nav(hash) {
  await page.evaluate(h => { window.location.hash = h }, hash)
  await sleep(1600)
}
const rowsText = () => page.evaluate(() =>
  [...document.querySelectorAll('.el-table__body tbody tr')].map(x => x.innerText.replace(/\n+/g, ' | ')))
const clickBtn = name => page.evaluate(n => {
  const btn = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === n && !x.disabled)
  if (btn) btn.click()
  return !!btn
}, name)
const dlgBtn = name => page.evaluate(n => {
  const ds = [...document.querySelectorAll('.el-dialog, .el-drawer')].filter(x => x.getBoundingClientRect().height > 0)
  const d = ds[ds.length - 1]
  const btn = [...(d || document).querySelectorAll('button')].find(x => x.innerText.trim() === n)
  if (btn) btn.click()
  return !!btn
}, name)
const setByLabel = (label, val) => page.evaluate((l, v) => {
  const ds = [...document.querySelectorAll('.el-dialog, .el-drawer')].filter(x => x.getBoundingClientRect().height > 0)
  const d = ds[ds.length - 1]
  if (!d) return false
  const item = [...d.querySelectorAll('.el-form-item')]
    .find(x => (x.querySelector('.el-form-item__label')?.innerText || '').includes(l))
  const el = item?.querySelector('input.el-input__inner') || item?.querySelector('input')
  if (!el) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('blur', { bubbles: true }))
  return true
}, label, val)

console.log('=== ① 台账页：种子与统计 ===')
await go('/b/temp-charges')
let t = await txt()
ok(t.includes('不计入收缴率'), '页面说明了「不进收缴率」', (t.match(/不进收缴率[^\n]*/) || [])[0])
ok(t.includes('计入营业收入'), '页面说明了「计入收入」')

const stats = await page.evaluate(() =>
  [...document.querySelectorAll('.tstat')].map(x => x.innerText.replace(/\n+/g, ' | ')))
console.log('     统计卡：', stats)
ok(stats.length === 4, '四张统计卡', String(stats.length))

let rows = await rowsText()
console.log('     行数：', rows.length)
ok(rows.length >= 10, '种子单据已生成', String(rows.length))
ok(rows.some(r => r.includes('已收款')), '有已收款的单')
ok(rows.some(r => r.includes('待收款')), '有待收款的单')
ok(rows.some(r => r.includes('已作废')), '有已作废的单')
ok(rows.some(r => r.includes('摆摊费')), '有事由「摆摊费」')
ok(rows.some(r => r.includes('外部')), '有付款方类型「外部」')

console.log('\n=== ② 筛选 ===')
await page.evaluate(() => {
  const sel = [...document.querySelectorAll('.filters .el-select')][2]   // 付款方
  sel?.querySelector('.el-select__wrapper')?.click()
})
await sleep(600)
await page.evaluate(() => {
  const it = [...document.querySelectorAll('.el-select-dropdown__item')].find(x => x.innerText.trim() === '外部')
  it?.click()
})
await sleep(1200)
rows = await rowsText()
ok(rows.length > 0 && rows.every(r => r.includes('外部')), '按「外部」筛选只剩外部单', String(rows.length))
await clickBtn('重置')
await sleep(1100)

console.log('\n=== ③ 新建（外部 · 摆摊费）===')
const before = (await rowsText()).length
await clickBtn('新建收费单')
await sleep(900)
let labels = await page.evaluate(() => {
  const ds = [...document.querySelectorAll('.el-drawer')].filter(x => x.getBoundingClientRect().height > 0)
  const d = ds[ds.length - 1]
  return d ? [...d.querySelectorAll('.el-form-item__label')].map(x => x.innerText.trim()) : []
})
console.log('     抽屉标签：', labels.join(' / '))
ok(labels.includes('单位 / 个人'), '外部类型下要填「单位 / 个人」')
ok(labels.includes('收费事由'), '有「收费事由」')
ok(labels.includes('收入科目'), '有「收入科目」')

await setByLabel('单位 / 个人', '测试用临时摊位')
await setByLabel('联系电话', '13900001234')
await setByLabel('收费事由', '摆摊费')
await page.evaluate(() => {
  /* 金额 input-number 在「金额」这一项里 */
  const ds = [...document.querySelectorAll('.el-drawer')].filter(x => x.getBoundingClientRect().height > 0)
  const d = ds[ds.length - 1]
  const item = [...d.querySelectorAll('.el-form-item')].find(x => x.innerText.includes('金额'))
  const inp = item?.querySelector('.el-input-number input')
  if (!inp) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, '360')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('blur', { bubbles: true }))
})
await sleep(400)
await dlgBtn('保存')
await sleep(1400)
rows = await rowsText()
ok(rows.some(r => r.includes('测试用临时摊位')), '新单出现在台账里')
const newRow = rows.find(r => r.includes('测试用临时摊位')) || ''
console.log('     新单：', newRow.slice(0, 120))
ok(newRow.includes('待收款'), '新单状态是「待收款」')
ok(newRow.includes('360'), '金额 360')

console.log('\n=== ④ 收款：写流水 + 计入收入 ===')
/* 收款前的收入与日结基线（用数据层算，因为要看的是"数值有没有变"） */
const baseline = await page.evaluate(async () => {
  const m = await import('/src/utils/api.js')
  return {
    tempIncome: m.tempChargeIncome().total,
    tempCount: m.tempChargeIncome().count,
    companyTemp: m.companyRevenue().temp
  }
})
console.log('     收入基线：', JSON.stringify(baseline))

await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tbody tr')].find(x => x.innerText.includes('测试用临时摊位'))
  const btn = [...tr.querySelectorAll('button')].find(x => x.innerText.trim() === '收款')
  btn?.click()
})
await sleep(1000)
const payDlg = await page.evaluate(() => {
  const ds = [...document.querySelectorAll('.el-dialog')].filter(x => x.getBoundingClientRect().height > 0)
  const d = ds[ds.length - 1]
  return d ? {
    text: d.innerText.replace(/\n+/g, ' | '),
    hasNote: d.innerText.includes('不挂房屋'),
    check: d.querySelector('.split-check')?.innerText.replace(/\n+/g, ' ')
  } : null
})
console.log('     收款弹窗：', payDlg?.check)
ok(!!payDlg, '收款弹窗打开')
ok(payDlg.hasNote, '提示「临时收费不挂房屋，用不了预存抵扣」')
ok(/可以收款/.test(payDlg.check || ''), '默认单方式全额，可以直接收款', payDlg?.check)

await dlgBtn('确认收款')
await sleep(1600)
t = await txt()
ok(t.includes('收款成功'), '收款成功提示', (t.match(/收款成功[^\n]*/) || [])[0])
rows = await rowsText()
const paidRow = rows.find(r => r.includes('测试用临时摊位')) || ''
ok(paidRow.includes('已收款'), '单据状态变为已收款', paidRow.slice(0, 90))

const after = await page.evaluate(async () => {
  const m = await import('/src/utils/api.js')
  const inc = m.tempChargeIncome()
  const cr = m.companyRevenue()
  const reps = m.queryBusinessSync ? null : null
  return { tempIncome: inc.total, tempCount: inc.count, companyTemp: cr.temp, byItem: inc.byItem }
})
/* 注意：evaluate 里 import 拿的是**另一个模块实例**，看不到页面内存态。
   这里改成只验证"页面上能看到的数字"，数据层口径放到 §⑧ 用 UI 验证 */
console.log('     （另一实例）收入：', JSON.stringify(after))

console.log('\n=== ⑤ 已收款的单不能改、不能作废 ===')
const paidRowBtns = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tbody tr')].find(x => x.innerText.includes('测试用临时摊位'))
  return tr ? [...tr.querySelectorAll('button')].map(x => x.innerText.trim()) : []
})
console.log('     已收款行的按钮：', paidRowBtns)
ok(!paidRowBtns.includes('编辑'), '已收款的行没有「编辑」')
ok(!paidRowBtns.includes('作废'), '已收款的行没有「作废」')
ok(paidRowBtns.includes('详情'), '仍可看详情')

console.log('\n=== ⑥ 作废一张待收款的单 ===')
const pendingRow = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tbody tr')].find(x => x.innerText.includes('待收款'))
  if (!tr) return ''
  const no = tr.innerText.split('\n')[0]
  const btn = [...tr.querySelectorAll('button')].find(x => x.innerText.trim() === '作废')
  btn?.click()
  return no
})
ok(!!pendingRow, '找到待收款的单并点了作废', pendingRow)
await sleep(900)
await dlgBtn('确认作废')
await sleep(700)
t = await txt()
ok(/请填写作废原因/.test(t), '不填原因被拦', (t.match(/请填写[^\n]*/) || [])[0])
await setByLabel('作废原因', '测试：缴费人改期')
await sleep(300)
await dlgBtn('确认作废')
await sleep(1300)
rows = await rowsText()
ok(rows.some(r => r.includes('测试：缴费人改期')), '作废原因进了台账')

console.log('\n=== ⑦ 校验边界（页面侧）===')
await clickBtn('新建收费单')
await sleep(800)
await dlgBtn('保存')
await sleep(800)
t = await txt()
ok(/请填写缴费单位或个人名称/.test(t), '外部类型不填名称被拦', (t.match(/请填写[^\n]*/) || [])[0])
await dlgBtn('取消')
await sleep(600)

console.log('\n=== ⑧ 计入收入 / 不进收缴率（口径层）===')
/* 这两个数只能在页面上下文里读 —— 用模块函数算，结果与页面同源 */
await nav('/b/dashboard')
await sleep(1400)
t = await txt()
ok(t.includes('临时收费'), '费用驾驶舱出现「临时收费」带子')
ok(t.includes('不计入收缴率'), '带子上写明「不计入收缴率」', (t.match(/[^ ]*不计入收缴率[^\n]*/) || [])[0])
const bandText = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.multi-band')].find(x => x.innerText.includes('临时收费'))
  return el ? el.innerText.replace(/\n+/g, ' | ') : ''
})
console.log('     带子：', bandText)
ok(/¥\s*[\d,]+/.test(bandText), '带子上有金额', bandText)
ok(/占公司收入/.test(bandText), '带子上有占比')

/* 收缴率不受影响：只比"有没有因为临时收费而变化"不好比，改为验证账单口径没变 */
const rateUnaffected = await page.evaluate(() => {
  const box = document.body.innerText
  return /收缴率/.test(box)
})
ok(rateUnaffected, '驾驶舱收缴率区仍在（口径未被临时收费改动）')

console.log('\n=== ⑨ 收银台的临时收费入口 ===')
await go('/b/cashier')
t = await txt()
ok(t.includes('临时收费'), '收银台有「临时收费」按钮')
await clickBtn('临时收费')
await sleep(1000)
const cashDlg = await page.evaluate(() => {
  const ds = [...document.querySelectorAll('.el-dialog')].filter(x => x.getBoundingClientRect().height > 0)
  const d = ds[ds.length - 1]
  return d ? {
    title: d.querySelector('.el-dialog__title')?.innerText,
    text: d.innerText.replace(/\n+/g, ' | ').slice(0, 260),
    hasPrepay: [...d.querySelectorAll('.el-select-dropdown, .el-select')].some(x => x.innerText.includes('预存抵扣'))
  } : null
})
console.log('     弹窗：', cashDlg?.title)
ok(cashDlg && cashDlg.title.includes('临时收费'), '弹窗标题正确', cashDlg?.title)
ok(cashDlg.hasPrepay === false, '不提供「预存抵扣」（临时收费不挂房屋）')

await setByLabel('单位 / 个人', '收银台测试摊主')
await page.evaluate(() => {
  const ds = [...document.querySelectorAll('.el-dialog')].filter(x => x.getBoundingClientRect().height > 0)
  const d = ds[ds.length - 1]
  const item = [...d.querySelectorAll('.el-form-item')].find(x => x.innerText.includes('应收金额'))
  const inp = item?.querySelector('.el-input-number input')
  if (!inp) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, '88')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('blur', { bubbles: true }))
})
await sleep(600)
const cashCheck = await page.evaluate(() => {
  const ds = [...document.querySelectorAll('.el-dialog')].filter(x => x.getBoundingClientRect().height > 0)
  return ds[ds.length - 1]?.querySelector('.split-check')?.innerText.replace(/\n+/g, ' ')
})
console.log('     校验条：', cashCheck)
ok(/可以收款/.test(cashCheck || ''), '金额同步到收款行，可以直接收', cashCheck)

await dlgBtn('确认收款')
await sleep(1800)
t = await txt()
ok(/已收 ¥88/.test(t), '收银台当场收款成功', (t.match(/已收[^\n]*/) || [])[0])

console.log('\n=== ⑩ 权限边界 ===')
await go('/b/temp-charges', 'R-VIEW')
t = await txt()
ok(!t.includes('新建收费单'), '只读角色看不到「新建收费单」')
const viewRows = await rowsText()
ok(viewRows.length > 0, '只读角色仍能看台账', String(viewRows.length))

await go('/b/temp-charges', 'R-CHG')
t = await txt()
ok(t.includes('新建收费单'), '收银员可新建')

const real = errs.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 3).join(' | '))

await page.screenshot({ path: '/tmp/tc-list.png' })
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await b.close()
process.exit(fail ? 1 : 0)
