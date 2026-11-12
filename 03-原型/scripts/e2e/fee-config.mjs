/**
 * 批 1 · 口径底座（2026-11-12）
 *
 * 验收四件事：
 *   ① 费用分类字典：收支两个方向、两级树、编码不可改、停用有连带规则；
 *   ② 减免原因字典：可新增/编辑/启停，且不允许把最后一条启用的停掉；
 *   ③ 项目收费模式：按表计类型分别配，三种模式都能选；
 *   ④ 收费项挂分类：列表能看到归属，缺口当场标出来。
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
  await sleep(1500)
}
async function clickBtn(text) {
  const done = await page.evaluate(t => {
    const el = [...document.querySelectorAll('button')].find(x => x.innerText.trim().includes(t) && x.offsetParent !== null)
    if (!el) return false
    el.click(); return true
  }, text)
  await sleep(600)
  return done
}
const rowsOf = () => page.evaluate(() => [...document.querySelectorAll('.el-table__body tr')].map(x => x.innerText.replace(/\n+/g, ' | ')))
const toast = () => page.evaluate(() => [...document.querySelectorAll('.el-message')].map(x => x.innerText).join(' | '))

/* ==================== ① 费用分类字典 ==================== */
console.log('=== ① 费用分类字典 ===')
await go('/b/fee-categories')
let t = await txt()
ok(t.includes('费用分类字典'), '页面可访问')
ok(t.includes('收入') && t.includes('支出') && t.includes('负债'), '三个方向都有 tab')

const incomeRows = await rowsOf()
ok(incomeRows.length >= 5, '收入树有数据', `${incomeRows.length} 行（含二级）`)
ok(t.includes('主营业务收入') && t.includes('多种经营收入'), '收入一级齐全')
ok(incomeRows.some(r => r.includes('物业费')), '有「物业费」二级')

/* 切到支出 */
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.trim() === '支出')
  tab?.click()
})
await sleep(900)
t = await txt()
const expenseRows = await rowsOf()
ok(t.includes('人力成本') && t.includes('合同支出') && t.includes('运营费用'), '支出三大类齐全')
ok(t.includes('税金及附加'), '支出里有「税金及附加」')
const taxRow = expenseRows.find(r => r.includes('税金及附加')) || ''
ok(taxRow.includes('手工补录'), '税金只允许手工补录（来源列写死了）', taxRow)

/* 停用一级（有子级）应被拒 */
await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tr')].find(x => x.innerText.includes('运营费用') && !x.innerText.includes('税金'))
  tr?.querySelector('.el-switch')?.click()
})
await sleep(800)
let msg = await toast()
ok(msg.includes('先停子级') || msg.includes('还有启用的子分类'), '停一级时若有启用子级被拦', msg)

/* 停用无子级的「押金及保证金」 */
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.includes('负债'))
  tab?.click()
})
await sleep(900)
const okToggle = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tr')].find(x => x.innerText.includes('押金'))
  const sw = tr?.querySelector('.el-switch')
  if (!sw) return false
  sw.click(); return true
})
await sleep(800)
msg = await toast()
ok(okToggle && (msg.includes('已停用') || (await txt()).includes('已停用')), '无子级分类可以停用', msg)
/* 再启用回来，避免污染后续断言 */
await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tr')].find(x => x.innerText.includes('押金'))
  tr?.querySelector('.el-switch')?.click()
})
await sleep(700)

/* 编辑：编码只读、名称可改 */
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.trim() === '收入')
  tab?.click()
})
await sleep(900)
await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tr')].find(x => x.innerText.includes('临时停车费'))
  const btn = [...(tr?.querySelectorAll('button') || [])].find(x => x.innerText.includes('编辑'))
  btn?.click()
})
await sleep(800)
const dlgInfo = await page.evaluate(() => {
  const dlg = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  if (!dlg) return null
  const inputs = [...dlg.querySelectorAll('input')]
  return { open: true, codeDisabled: inputs[0]?.disabled, codeValue: inputs[0]?.value, text: dlg.innerText.slice(0, 80) }
})
ok(dlgInfo?.open, '打开编辑弹窗')
ok(dlgInfo?.codeDisabled === true, '编码不可改（被单据引用）', String(dlgInfo?.codeValue))
ok((await txt()).includes('编码被单据引用'), '弹窗写明为什么不能改编码')

/* 改名并保存，再改回 */
async function renameCategory(from, to) {
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll('.el-table__body tr')].find(x => x.innerText.includes('临时停车费') || x.innerText.includes('临停测试'))
    const btn = [...(tr?.querySelectorAll('button') || [])].find(x => x.innerText.includes('编辑'))
    btn?.click()
  })
  await sleep(700)
  await page.evaluate(name => {
    const dlg = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
    const inp = [...dlg.querySelectorAll('input')][1]
    inp.value = name
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  }, to)
  await sleep(300)
  await clickBtn('保存')
  await sleep(900)
  return (await txt()).includes(to)
}
ok(await renameCategory('临时停车费', '临停测试'), '改名生效')
await renameCategory('临停测试', '临时停车费')
ok((await txt()).includes('临时停车费'), '名称已改回')

/* ==================== ② 减免原因字典 ==================== */
console.log('\n=== ② 减免原因字典 ===')
await go('/b/waive-reasons')
t = await txt()
ok(t.includes('减免原因'), '页面可访问')
let wRows = await rowsOf()
ok(wRows.length === 5, '预置 5 条', `${wRows.length} 条`)
ok(t.includes('政策性') && t.includes('差错'), '类型齐全（政策性 / 个案 / 差错）')
ok(wRows.some(r => r.includes('差错纠正') && r.includes('是')), '差错纠正计入考核')

/* 新增一条 */
await clickBtn('新增原因')
await sleep(700)
await page.evaluate(() => {
  const dlg = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  const inp = dlg.querySelector('input')
  inp.value = '空置房减免'
  inp.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(300)
await clickBtn('保存')
await sleep(900)
wRows = await rowsOf()
ok(wRows.length === 6 && wRows.some(r => r.includes('空置房减免')), '新增成功', `${wRows.length} 条`)

/* 重名被拒 */
await clickBtn('新增原因')
await sleep(700)
await page.evaluate(() => {
  const dlg = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  const inp = dlg.querySelector('input')
  inp.value = '空置房减免'
  inp.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(300)
await clickBtn('保存')
await sleep(700)
msg = await toast()
ok(msg.includes('已存在'), '重名被拒', msg)
await clickBtn('取消')

/* ==================== ③ 项目收费模式 ==================== */
console.log('\n=== ③ 项目收费模式 ===')
await go('/e/config')
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.includes('项目收费模式'))
  tab?.click()
})
await sleep(1200)
t = await txt()
ok(t.includes('项目收费模式'), 'tab 存在')
/* 只看当前可见 tab 里的表：参数页同时还有字典表和参数表，全局数行会串 */
const uRows = await page.evaluate(() => {
  const pane = [...document.querySelectorAll('.el-tab-pane')].find(p => p.offsetParent !== null)
  return [...(pane?.querySelectorAll('.el-table__body tr') || [])].map(x => x.innerText.replace(/\n+/g, ' | '))
})
ok(uRows.length === 3, '三个项目各一行', `${uRows.length} 行`)
ok(t.includes('国网') || t.includes('自缴'), '选项含「自缴」模式')
ok(t.includes('插卡') && (t.includes('抄表') || t.includes('推单')), '选项含插卡与抄表')

/* 改 P02 的电费模式 → 保存并回显 */
async function setUtility(rowText, which, label) {
  const idx = which === 'elec' ? 0 : 1
  await page.evaluate((rt, i) => {
    const pane = [...document.querySelectorAll('.el-tab-pane')].find(p => p.offsetParent !== null)
    const tr = [...(pane?.querySelectorAll('.el-table__body tr') || [])].find(x => x.innerText.includes(rt))
    const sel = tr?.querySelectorAll('.el-select')[i]
    sel?.querySelector('.el-select__wrapper')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, rowText, idx)
  await sleep(600)
  const picked = await page.evaluate(label => {
    const opt = [...document.querySelectorAll('.el-select-dropdown__item')]
      .filter(x => x.getBoundingClientRect().height > 0)
      .find(x => x.innerText.includes(label))
    opt?.click()
    return opt?.innerText || ''
  }, label)
  await sleep(900)
  return picked
}
const nextMode = (await txt()).includes('抄表') ? '国网' : '抄表'
await setUtility('锦绣家园', 'elec', nextMode)
await sleep(600)
const after = (await rowsOf()).find(r => r.includes('锦绣家园')) || ''
ok(after.includes(nextMode === '国网' ? '自缴' : '抄表'), '改项目电费模式生效', after.slice(0, 80))
/* 改回原值：P02 的电原本是"自缴" */
await setUtility('锦绣家园', 'elec', '自缴')
await sleep(500)

/* ==================== ④ 收费项挂分类 ==================== */
console.log('\n=== ④ 收费项挂分类 ===')
await go('/b/fee-items')
t = await txt()
ok(t.includes('收入分类'), '列表出现「收入分类」列')
const fRows = await rowsOf()
ok(fRows.length > 0, '收费项有数据', `${fRows.length} 行`)
ok(!t.includes('未挂分类'), '没有未挂分类的收费项')
ok(fRows.some(r => r.includes('主营业务收入') || r.includes('其他业务收入')), '能看到分类路径', fRows[0]?.slice(0, 90))

/* ==================== 运行时错误 ==================== */
console.log('\n=== 运行时错误 ===')
const real = errs.filter(e => !/favicon|ResizeObserver/i.test(e))
ok(real.length === 0, '零 console / page 错误', real.slice(0, 2).join(' / '))

console.log(`\n通过 ${pass} / 失败 ${fail}`)
await b.close()
process.exit(fail ? 1 : 0)
