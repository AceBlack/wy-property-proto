/**
 * 批 4 · 合同收支方向 + 类型两级 + 公共收益台账 · 验收
 * ------------------------------------------------------------
 * 核心口径（做错了数字会很好看，但是错的）：
 *   ① **方向看合同类型**，不是看 incomeCategory —— 6 份物业服务合同标了「不计入」，
 *      意思是钱已按物业费账单收过；把它们当支出，成本会虚增 322 万。
 *   ② 收入合同 ≠ 计入收入的合同：23 份收入合同里只有 17 份计收入。
 *   ③ 公共收益归业主，台账三个数必须是「合同额 = 归业主 + 归物业」。
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
  await sleep(2400)
}

/** 点 el-select 第 idx 个选项框，选文本包含 text 的项 */
async function pickSelect(rootSel, idx, text) {
  await page.evaluate((sel, i) => {
    const root = document.querySelector(sel)
    root?.querySelectorAll('.el-select__wrapper')[i]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, rootSel, idx)
  await sleep(500)
  const hit = await page.evaluate(t => {
    const op = [...document.querySelectorAll('.el-select-dropdown__item')]
      .filter(x => x.getBoundingClientRect().height > 0)
      .find(x => x.innerText.trim() === t || x.innerText.includes(t))
    if (!op) return false
    op.click(); return true
  }, text)
  await sleep(1200)
  return hit
}

await open('/c/contracts')

console.log('\n【一】顶部统计：收入与支出必须分列')

const dstat = await page.evaluate(() =>
  [...document.querySelectorAll('.dstat')].map(x => x.innerText.replace(/\s+/g, ' ').trim()))
ok(dstat.some(t => t.includes('收入合同（期间额）')), '有「收入合同」指标', dstat.slice(0, 2).join(' | '))
ok(dstat.some(t => t.includes('支出合同（期间额）')), '有「支出合同」指标')
ok(dstat.some(t => t.includes('计入收入')), '收入卡里点明「其中计入收入 N 份」', dstat[1])
const note = await txt('.sum-note')
ok(/方向看合同类型/.test(note), '口径说明写清「方向看类型、计收入看分类」', note.slice(0, 60))
ok(/不再重复计一笔收入/.test(note), '解释 6 份物业服务合同为何标「不计入」')

console.log('\n【二】方向筛选 → 类型下拉联动')

const filterLabels = await page.evaluate(() =>
  [...document.querySelectorAll('.filter-bar .el-form-item__label')].map(x => x.innerText.trim()))
ok(filterLabels.includes('方向'), '筛选项里有「方向」', filterLabels.join(' / '))

const pickedExpense = await pickSelect('.filter-bar', 0, '支出')
ok(pickedExpense, '方向选「支出」')

const typeOptsExpense = await page.evaluate(async () => {
  const sel = document.querySelectorAll('.filter-bar .el-select__wrapper')[1]
  sel?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise(r => setTimeout(r, 400))
  return [...document.querySelectorAll('.el-select-dropdown__item')]
    .filter(x => x.getBoundingClientRect().height > 0).map(x => x.innerText.trim())
})
await page.keyboard.press('Escape')
await sleep(400)
ok(typeOptsExpense.length > 0, '支出方向下类型下拉有选项', typeOptsExpense.join(' / '))
ok(!typeOptsExpense.some(t => t === '租赁'), '支出方向下没有「租赁」（那是收入类型）', typeOptsExpense.join(' / '))

const rowsExpense = await page.evaluate(() =>
  [...document.querySelectorAll('.el-table__body-wrapper tr')].map(tr => tr.innerText.replace(/\s+/g, ' ').trim()))
ok(rowsExpense.length > 0, '支出筛选后有数据', `${rowsExpense.length} 行`)
ok(rowsExpense.every(t => t.includes('支出')), '每行都标「支出」', rowsExpense[0]?.slice(0, 40))

const pickedIncome = await pickSelect('.filter-bar', 0, '收入')
ok(pickedIncome, '方向改选「收入」')
const rowsIncome = await page.evaluate(() =>
  [...document.querySelectorAll('.el-table__body-wrapper tr')].map(tr => tr.innerText.replace(/\s+/g, ' ').trim()))
ok(rowsIncome.length > 0 && rowsIncome.every(t => t.includes('收入')), '收入筛选后每行都标「收入」', rowsIncome[0]?.slice(0, 40))
ok(rowsIncome.some(t => t.includes('租赁')) || rowsIncome.some(t => t.includes('物业服务')),
  '收入合同是租赁 / 物业服务', rowsIncome.slice(0, 2).join(' || '))

console.log('\n【三】收入合同 ≠ 计入收入的合同')

/* 6 份物业服务合同标「不计入」：方向是收入，但不重复计收入 */
const keyRow = rowsIncome.find(t => t.includes('物业服务') && t.includes('不计入'))
ok(!!keyRow, '能同时看到「收入」+「不计入」的行（两个维度不冲突）', keyRow?.slice(0, 60))
ok(rowsIncome.some(t => t.includes('多种经营')), '经营合同标「多种经营」')

console.log('\n【四】公共收益台账')

await page.evaluate(() => { location.hash = '#/b/public-revenue' })
await sleep(2000)
const ledger = await allTxt()
ok(/公共收益台账/.test(ledger), '台账页打开')
ok(/产权归全体业主/.test(ledger), '页面开头说明归属口径')

const kpi = await page.evaluate(() =>
  [...document.querySelectorAll('.dstat')].map(x => x.innerText.replace(/\s+/g, ' ').trim()))
ok(kpi.some(t => t.includes('期间归业主')), '有「期间归业主」', kpi[1])
ok(kpi.some(t => t.includes('年化归业主')), '有「年化归业主」')
ok(kpi.some(t => t.includes('年化归物业')), '有「年化归物业」（只有这部分是公司收入）')

const byItems = await page.evaluate(() =>
  [...document.querySelectorAll('.byitem')].map(x => x.innerText.replace(/\s+/g, ' ').trim()))
ok(byItems.length > 0, '按项目汇总有条目（公示按小区出）', `${byItems.length} 个项目`)

/* 三个数必须对得上：合同额 = 归业主 + 归物业 */
const firstRow = await page.evaluate(() => {
  const tr = document.querySelector('.el-table__body-wrapper tr')
  if (!tr) return null
  const td = [...tr.querySelectorAll('td')].map(x => x.innerText.replace(/\s+/g, ' ').trim())
  return { all: td.join(' | '), cells: td }
})
ok(!!firstRow, '明细有行')
const nums = (firstRow?.all || '').match(/¥([\d,]+\.\d{2})/g) || []
ok(nums.length >= 3, '一行里能看到合同额 / 归业主 / 归物业三个金额', nums.join(' / '))
if (nums.length >= 3) {
  const n = nums.map(x => Number(x.replace(/[¥,]/g, '')))
  /* 列顺序：合同金额、归业主、归物业 —— 合同额 = 两者之和 */
  ok(Math.abs(n[0] - (n[1] + n[2])) < 0.02,
    '合同额 = 归业主 + 归物业（不重复、不漏项）', `${n[0]} vs ${n[1]} + ${n[2]}`)
}

const exportBtn = await page.evaluate(() =>
  [...document.querySelectorAll('.el-button')].some(x => x.innerText.includes('导出公示表')))
ok(exportBtn, '有「导出公示表」（公示稿要能直接出）')

console.log('\n【五】多种经营页 → 台账的下钻')

await page.evaluate(() => { location.hash = '#/b/multi-revenue' })
await sleep(2000)
const multi = await allTxt()
ok(/多种经营收入/.test(multi), '多种经营页打开')
ok(multi.includes('看台账'), '「公共收益」那一行有「看台账」入口')

await page.evaluate(() => {
  [...document.querySelectorAll('.el-button')].find(x => x.innerText.includes('看台账'))?.click()
})
await sleep(1600)
ok(await page.evaluate(() => location.hash.includes('public-revenue')), '点「看台账」跳到公共收益台账')

console.log('\n【六】控制台')
ok(errs.length === 0, '零 console 错误', errs.slice(0, 2).join(' | '))

await b.close()
console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
