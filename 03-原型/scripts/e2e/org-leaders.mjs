/**
 * 第 52 批 · 组织负责人关系 实测
 *   ① 组织维护表显示多负责人：正职 / 副职 / 代理（含已结束、到期日）
 *   ② 编辑抽屉能加人、改职责、删人
 *   ③ 正职唯一被拦（40927）
 *   ④ 代理必须填结束日期（42213）
 *   ⑤ 代理在期 → 审批人自动切到代理（不再是已离任的正职）
 *   ⑥ 计划提报页的职责标签跟着关系表走
 */
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://localhost:5186'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = ms => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const ok = (c, m, e = '') => { c ? (pass++, console.log('  ✔ ' + m)) : (fail++, console.log('  ✘ ' + m + (e ? '  → ' + e : ''))) }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
})
const page = await browser.newPage()
await page.setViewport({ width: 1680, height: 1150 })
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
page.on('pageerror', e => errors.push('PAGEERROR ' + String(e).slice(0, 200)))

const text = () => page.evaluate(() => document.body.innerText)
const toast = () => page.evaluate(() =>
  [...document.querySelectorAll('.el-message')].map(x => x.innerText.trim()).join(' / '))
const clickBtn = label => page.evaluate(l => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim().includes(l))
  if (b) { b.click(); return true }
  return false
}, label)

await page.goto(BASE + '/#/e/org', { waitUntil: 'networkidle2' })
await page.evaluate(() => localStorage.setItem('wy_proto_role', 'R-HR'))   // 人事有 e.org.edit
await page.reload({ waitUntil: 'networkidle2' })
await sleep(1600)

console.log('\n=== ① 打开组织维护，看多负责人 ===')
/* 组织维护抽屉的入口按钮文案先探一下 */
const entry = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /组织维护|组织架构/.test(x.innerText || ''))
  return b ? b.innerText.trim() : ''
})
ok(!!entry, `找到入口「${entry}」`)
if (entry) {
  await clickBtn(entry)
  await sleep(1500)
}
let t = await text()
ok(t.includes('组织维护'), '组织维护抽屉打开')
ok(t.includes('负责人'), '有负责人列')
ok(t.includes('正职唯一') || t.includes('审批只认正职'), '页脚写明口径（正职唯一 / 审批只认正职）')

/* 表里应能看到「代理」和「副职」两种职责 */
const rowsTxt = await page.evaluate(() =>
  [...document.querySelectorAll('.el-drawer .el-table__body tbody tr')].map(r => r.innerText.replace(/\n+/g, ' ')))
const hasProxy = rowsTxt.some(x => x.includes('代理'))
const hasDeputy = rowsTxt.some(x => x.includes('副职'))
const hasEnded = rowsTxt.some(x => x.includes('已结束'))
ok(hasProxy, '表格里出现「代理」职责', rowsTxt.find(x => x.includes('代理')) || '')
ok(hasDeputy, '表格里出现「副职」职责', rowsTxt.find(x => x.includes('副职')) || '')
ok(hasEnded, '已结束的关系显示「已结束」（不删留档）', rowsTxt.find(x => x.includes('已结束')) || '')

console.log('\n=== ② 编辑：看到该部门的多条负责人 ===')
/* 找安保组那行（O-P01-T3：胡建国已离任 + 龚淼然代理） */
const opened = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.el-drawer .el-table__body tbody tr')]
  const tr = rows.find(r => r.innerText.includes('安保组'))
  if (tr) {
    const btns = [...tr.querySelectorAll('button')]
    const edit = btns.find(b => (b.innerText || '').includes('编辑'))
    if (edit) { edit.click(); return tr.innerText.replace(/\n+/g, ' ').slice(0, 80) }
  }
  return ''
})
ok(!!opened, `打开「安保组」编辑（${opened}）`)
await sleep(1000)
const leaderRows = await page.evaluate(() =>
  [...document.querySelectorAll('.el-dialog .ldr-row')].length)
ok(leaderRows >= 2, `编辑弹窗里有 ${leaderRows} 条负责人记录`)
const dlgText = await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  return d ? d.innerText.replace(/\n+/g, ' | ') : ''
})
ok(dlgText.includes('代理'), '弹窗里保留代理记录')
ok(dlgText.includes('正职'), '弹窗里保留正职记录')

console.log('\n=== ③ 正职唯一：给已有在期正职的部门再加一个正职应被拦 ===')
/* 换到「翡翠城项目部」（O-P01，正职徐悦在期）——刚才的安保组正职已离任，
   再加一个正职是**合法**的（接任），拿它测唯一约束会测不出东西。 */
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.el-drawer .el-table__body tbody tr button')]
  const tr = [...document.querySelectorAll('.el-drawer .el-table__body tbody tr')]
    .find(r => r.innerText.includes('O-P01') && r.innerText.includes('项目'))
  if (tr) {
    const e = [...tr.querySelectorAll('button')].find(x => (x.innerText || '').includes('编辑'))
    if (e) e.click()
  }
})
await sleep(1100)
let dlgOpen = await page.evaluate(() =>
  [...document.querySelectorAll('.el-dialog')].some(x => x.offsetParent !== null))
ok(dlgOpen, '打开翡翠城项目部编辑')

/* 添加一行负责人，默认正职 */
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  const btn = [...d.querySelectorAll('button')].find(x => (x.innerText || '').includes('添加负责人'))
  if (btn) btn.click()
})
await sleep(500)
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  const rows = d.querySelectorAll('.ldr-row')
  const inp = rows[rows.length - 1].querySelector('input')
  if (inp) { inp.focus(); inp.click() }
})
await sleep(600)
const picked = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.el-select-dropdown__item')].filter(x => x.offsetParent !== null)
  if (items.length) { items[0].click(); return items[0].innerText.trim() }
  return ''
})
ok(!!picked, `选到员工「${picked}」`)
await sleep(400)
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  const b = [...d.querySelectorAll('button')].find(x => (x.innerText || '').includes('保存'))
  if (b) b.click()
})
await sleep(1400)
let ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/在期正职/.test(ts), '第二个在期正职被拦', ts)
const stillOpen = await page.evaluate(() =>
  [...document.querySelectorAll('.el-dialog')].some(x => x.offsetParent !== null))
ok(stillOpen, '被拦后弹窗不关，能继续改')

console.log('\n=== ④ 代理必须填结束日期 ===')
/* 把刚加的那行改成「代理」，但不填结束日期 */
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  const rows = d.querySelectorAll('.ldr-row')
  const last = rows[rows.length - 1]
  const sels = last.querySelectorAll('.el-select')
  if (sels[1]) sels[1].querySelector('.el-select__wrapper').click()
})
await sleep(600)
const dutyPicked = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.el-select-dropdown__item')].filter(x => x.offsetParent !== null)
  const p = items.find(x => x.innerText.trim() === '代理')
  if (p) { p.click(); return true }
  return false
})
ok(dutyPicked, '把职责改成「代理」')
await sleep(400)
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  const b = [...d.querySelectorAll('button')].find(x => (x.innerText || '').includes('保存'))
  if (b) b.click()
})
await sleep(1300)
ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/结束日期/.test(ts), '代理未填结束日期被拦', ts)

/* 改成副职 → 应该保存成功（副职不参与审批，可以多个） */
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  const rows = d.querySelectorAll('.ldr-row')
  const last = rows[rows.length - 1]
  const sels = last.querySelectorAll('.el-select')
  if (sels[1]) sels[1].querySelector('.el-select__wrapper').click()
})
await sleep(600)
await page.evaluate(() => {
  const items = [...document.querySelectorAll('.el-select-dropdown__item')].filter(x => x.offsetParent !== null)
  const p = items.find(x => x.innerText.trim() === '副职')
  if (p) p.click()
})
await sleep(400)
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  const b = [...d.querySelectorAll('button')].find(x => (x.innerText || '').includes('保存'))
  if (b) b.click()
})
await sleep(1500)
ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/副职|已保存/.test(ts) && !/在期正职|结束日期/.test(ts), '副职保存成功（可多个，不参与审批）', ts)
const closed = await page.evaluate(() =>
  ![...document.querySelectorAll('.el-dialog')].some(x => x.offsetParent !== null))
ok(closed, '保存成功后弹窗关闭')

console.log('\n=== ⑤ 代理生效：该部门显示在期代理，离任正职留档 ===')
/* 抽屉还开着（刚才只关了编辑弹窗）。O-P01-T3 的种子里正职 10/15 离任、代理在期 ——
   审批解析读的 `orgLeaderOf` 会落到龚淼然，页面上必须看到同一件事。 */
const secRow = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.el-drawer .el-table__body tbody tr')]
  const tr = rows.find(r => r.innerText.includes('O-P01-T3'))
  return tr ? tr.innerText.replace(/\n+/g, ' | ') : ''
})
console.log('    · O-P01-T3 行：', secRow)
ok(!!secRow, '找到 O-P01-T3 行')
ok(secRow.includes('龚淼然'), '该部门显示在期代理「龚淼然」')
ok(secRow.includes('代理'), '职责标为「代理」')
ok(secRow.includes('2026-12-31'), '代理显示到期日（到期自动失效）')
ok(secRow.includes('胡建国'), '离任的正职仍在表里留档')
ok(secRow.includes('已结束'), '离任正职标为「已结束」而不是删掉')

console.log('\n=== ⑥ 计划提报页的职责来自关系表 ===')
await page.evaluate(() => localStorage.setItem('wy_proto_role', 'R-SEC'))
await page.goto(BASE + '/#/f/plans/new', { waitUntil: 'networkidle2' })
await page.reload({ waitUntil: 'networkidle2' })
await sleep(1600)
let t2 = await text()
ok(t2.includes('提报部门'), '计划提报表单可打开')
const dutyShown = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.el-form-item')].find(f => (f.innerText || '').includes('提报身份'))
  return el ? el.innerText.replace(/\n+/g, ' ') : ''
})
ok(/正职|副职|代理/.test(dutyShown), `提报身份显示职责（${dutyShown}）`, dutyShown)
/* 第 55 批重写提报表单后，多部门提示改成「提报部门」表单项 + 下拉（单人时是只读标签），
   不再有 .lead-tip。这里改成按表单项判断，不绑死 class —— 否则版式一调测试就红。 */
const deptItem = await page.evaluate(() => {
  const item = [...document.querySelectorAll('.el-form-item')].find(f => (f.innerText || '').includes('提报部门'))
  return item ? item.innerText.replace(/\n+/g, ' ').trim() : ''
})
ok(!!deptItem, `提报表单有「提报部门」一项（${deptItem.slice(0, 60)}）`, deptItem)

console.log('\n=== 控制台错误 ===')
const real = errors.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 3).join(' | '))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exit(fail ? 1 : 0)
