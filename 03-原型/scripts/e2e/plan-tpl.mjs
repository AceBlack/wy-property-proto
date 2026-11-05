/**
 * 计划模板页实测（第 60 批重写）
 *
 * 第 60 批把权重从模板里拿掉了：模板只定「考什么、怎么算分」，
 * 「每项占多少」由提报人在计划里填。这个脚本断四件事：
 *   ① 列表：六套模板，条目数对，**没有权重列**
 *   ② 抽屉：三段条目铺开，**没有权重输入框**，监控段仍只改文字
 *   ③ 规则校验：把量化段删空 → 保存被拦下并说明原因
 *   ④ 权限：班组长只能看不能改
 */
import puppeteer from 'puppeteer-core'

const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (c, m, e = '') => { c ? (pass++, console.log('  ✔ ' + m)) : (fail++, console.log('  ✘ ' + m + (e ? '  → ' + e : ''))) }

const BASE = 'http://localhost:5186'
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox']
})
const page = await b.newPage()
await page.setViewport({ width: 1680, height: 1100 })
const errs = []
page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })

const text = () => page.evaluate(() => document.body.innerText)
const rowsText = () => page.evaluate(() =>
  [...document.querySelectorAll('.el-table__body tbody tr')].map(t => t.innerText.replace(/\n+/g, ' | ')))
const toast = () => page.evaluate(() => [...document.querySelectorAll('.el-message')].map(x => x.innerText.trim()).join(' | '))
const clickBtn = t => page.evaluate(label => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === label)
  if (b) { b.click(); return true }
  return false
}, t)
const drawerText = () => page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  return d ? d.innerText : ''
})

async function login(role) {
  await page.evaluate(r => localStorage.setItem('wy_proto_role', r), role)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(1500)
}

console.log('=== ① 列表：六套模板，且不再有权重 ===')
await page.goto(BASE + '/#/f/plan-templates', { waitUntil: 'networkidle2' })
await login('R-QS')
let t = await text()
ok(t.includes('计划模板'), '页面标题正确')
ok(t.includes('模板里没有权重'), '说明条写明权重不在模板里')
let rows = await rowsText()
console.log('    · 模板行：', rows.length)
rows.forEach(r => console.log('      ', r.slice(0, 110)))
ok(rows.length === 6, '六套模板（项目 + 四班组 + 职能兜底）', rows.length)
ok(rows.some(r => r.includes('项目经理')), '有项目经理模板')
ok(rows.some(r => r.includes('客服组')), '有客服组模板')
ok(rows.some(r => r.includes('工程组')), '有工程组模板')
ok(rows.some(r => r.includes('秩序组')), '有秩序组模板')
ok(rows.some(r => r.includes('环境组')), '有环境组模板')
ok(rows.some(r => r.includes('职能')), '有职能兜底模板')
ok(rows.every(r => r.includes('权重由提报人填')), '每行都标注"权重由提报人填"')
ok(!rows.some(r => /\d+% \+ \d+%/.test(r)), '列表不再显示「量化 x% + 重点 y%」')

const pm = rows.find(r => r.includes('项目经理'))
ok(/5 \/ 5 \/ 5/.test(pm), '项目经理 5/5/5 条', pm)
const cs = rows.find(r => r.includes('客服组'))
ok(/3 \/ 5 \/ 8/.test(cs), '客服组 3/5/8 条', cs)
const gc = rows.find(r => r.includes('工程组'))
ok(/2 \/ 6 \/ 8/.test(gc), '工程组 2/6/8 条（多一条年度维保）', gc)

const heads = await page.evaluate(() =>
  [...document.querySelectorAll('.el-table__header th')].map(x => (x.innerText || '').trim()).filter(Boolean))
console.log('    · 表头：', heads.join(' | '))
ok(!heads.some(h => h.includes('权重')), '列表表头里没有「权重」列', heads.join('/'))
ok(heads.some(h => h.includes('条目')), '有「条目」列')

console.log('\n=== ② 打开编辑：条目铺开，但没有权重输入 ===')
await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tbody tr')].find(x => x.innerText.includes('项目经理'))
  const btn = [...tr.querySelectorAll('button')].find(x => (x.innerText || '').includes('编辑'))
  if (btn) btn.click()
})
await sleep(1100)
const drawerOpen = await page.evaluate(() => [...document.querySelectorAll('.el-drawer')].some(x => x.offsetParent !== null))
ok(drawerOpen, '打开编辑抽屉')
let dt = await drawerText()
ok(dt.includes('量化指标') && dt.includes('监控指标') && dt.includes('重点工作计划'), '三段都在')
ok(dt.includes('模板不设权重'), '抽屉里明确写"模板不设权重"')
ok(/5 条/.test(dt), '量化段标题显示"5 条"', dt.match(/\d+ 条[^\n]*/)?.[0])
ok(dt.includes('评价标准（只可改文字，系统不校验扣分上限）'), '监控段的评价标准可改、不做上限校验')

/* 抽屉里三张表的表头都不该有「权重 %」 */
const drawerHeads = await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  return [...d.querySelectorAll('.el-table__header th')].map(x => (x.innerText || '').trim()).filter(Boolean)
})
console.log('    · 抽屉表头：', drawerHeads.join(' | '))
ok(!drawerHeads.some(h => h.includes('权重')), '抽屉表格里没有权重列', drawerHeads.join('/'))

console.log('\n=== ③ 把量化段删空 → 保存被拦下 ===')
/* 逐条点掉量化段（左侧第一张表）的「删」 */
for (let i = 0; i < 6; i++) {
  const clicked = await page.evaluate(() => {
    const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
    const tb = d.querySelectorAll('.el-table')[0]
    const tr = tb?.querySelector('.el-table__body tbody tr')
    if (!tr) return false
    const btn = [...tr.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '删')
    if (!btn) return false
    btn.click()
    return true
  })
  if (!clicked) break
  await sleep(220)
}
dt = await drawerText()
ok(/0 条 · 至少 1 条/.test(dt), '量化段计数变成 0 条并提示"至少 1 条"', dt.match(/0 条[^\n]*/)?.[0])

await clickBtn('保存模板')
await sleep(1100)
let ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/还有 \d+ 处要改/.test(ts), '保存被拦下并提示还有几处', ts)
const errBox = await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  return d?.querySelector('.chk-err')?.innerText.replace(/\n+/g, ' | ') || ''
})
console.log('    · 错误清单：', errBox)
ok(errBox.includes('量化指标至少要有一条考核项'), '错误清单说明量化段不能为空', errBox)
ok(!errBox.includes('权重'), '错误清单里不再出现权重相关的话', errBox)

console.log('\n=== ④ 补一条并填名 → 保存通过 ===')
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  const firstSec = d.querySelector('.sec')
  const btn = [...firstSec.querySelectorAll('button')].find(x => (x.innerText || '').includes('加一条'))
  if (btn) btn.click()
})
await sleep(400)
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  const tb = d.querySelectorAll('.el-table')[0]
  const tr = tb.querySelector('.el-table__body tbody tr')
  const inp = tr?.querySelector('input')
  if (!inp) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, '月度收费率')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(300)
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  const real = [...d.querySelectorAll('input')].find(i => i.placeholder === '一句话说明这套模板管什么')
  if (real) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(real, '实测改过的说明')
    real.dispatchEvent(new Event('input', { bubbles: true }))
  }
})
await sleep(300)
await clickBtn('保存模板')
await sleep(1400)
ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/已保存|v\d/.test(ts), '保存成功并提示版本', ts)
const closed = await page.evaluate(() => ![...document.querySelectorAll('.el-drawer')].some(x => x.offsetParent !== null))
ok(closed, '保存后抽屉关闭')
await sleep(600)
rows = await rowsText()
const pm2 = rows.find(r => r.includes('项目经理'))
ok(pm2 && pm2.includes('实测改过的说明'), '列表已刷新出新说明', pm2?.slice(0, 80))
ok(/v2/.test(pm2 || ''), '版本号递增到 v2', pm2?.match(/v\d+/)?.[0])

console.log('\n=== ⑤ 权限：班组长只能看不能改 ===')
await login('R-SEC')
await page.goto(BASE + '/#/f/plan-templates', { waitUntil: 'networkidle2' })
await sleep(1400)
const t3 = await text()
ok(t3.includes('没有「计划模板」维护权限'), '无 edit 时给出说明')
const addDisabled = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').includes('新增模板'))
  return b ? b.disabled || b.classList.contains('is-disabled') : null
})
ok(addDisabled === true, '新增按钮禁用', String(addDisabled))
const editDisabled = await page.evaluate(() => {
  const tr = document.querySelector('.el-table__body tbody tr')
  const b = tr && [...tr.querySelectorAll('button')].find(x => (x.innerText || '').includes('编辑'))
  return b ? b.disabled || b.classList.contains('is-disabled') : null
})
ok(editDisabled === true, '编辑按钮禁用', String(editDisabled))

console.log('\n=== 控制台 ===')
const real = errs.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 2).join(' | '))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await b.close()
process.exit(fail ? 1 : 0)
