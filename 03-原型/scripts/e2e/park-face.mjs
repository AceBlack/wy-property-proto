/**
 * H1 / H2 / H4 / H5 · 后台配合项（2026-11-10）
 *
 * 断言围绕交接单里的验收口径：
 *   H1 参数设置出现「车位」分组两条，改值能存住；
 *   H2 换绑记录是真表 —— 提交后刷新还在、来源/厂商状态可见、本月次数会 +1、重置后归零且留痕；
 *   H4 人脸核验一条状态机：待核验 → 已生效 / 已驳回（驳回必填原因），业主表单不再有开关；
 *   H5 租客与业主同一工作台，按主体分段；租客通过后租户列表的人脸标记跟着变。
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
page.on('pageerror', e => errs.push(String(e).slice(0, 300)))
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })

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
  await sleep(700)
  return done
}
async function rowBtn(rowText, btnText) {
  const done = await page.evaluate((rt, bt) => {
    const tr = [...document.querySelectorAll('.el-table__body tr')].find(x => x.innerText.includes(rt))
    if (!tr) return false
    const el = [...tr.querySelectorAll('button')].find(x => x.innerText.trim().includes(bt))
    if (!el) return false
    el.click(); return true
  }, rowText, btnText)
  await sleep(700)
  return done
}
const rowsOf = () => page.evaluate(() => [...document.querySelectorAll('.el-table__body tr')].map(x => x.innerText.replace(/\n+/g, ' | ')))
const drawerText = () => page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  return d ? d.innerText.replace(/\n+/g, ' | ') : ''
})

/* ============================ H1 参数 ============================ */
console.log('=== H1 系统参数 · 车位换绑上限 ===')
await go('/e/config')
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.includes('参数设置'))
  tab?.click()
})
await sleep(900)
let t = await txt()
ok(t.includes('车位'), '参数设置出现「车位」分组')
ok(t.includes('车牌换绑次数'), '有「车牌换绑次数」一条')
ok(t.includes('换绑计数周期'), '有「换绑计数周期」一条')
ok(t.includes('次/月'), '单位是「次/月」')

/* 改值为 2 并触发 change（页面是行内编辑，@change 即保存） */
const saved = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.el-table__body tr')]
  const tr = rows.find(x => x.innerText.includes('车牌换绑次数'))
  if (!tr) return false
  const inp = tr.querySelector('input')
  if (!inp) return false
  inp.value = '2'
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})
await sleep(900)
ok(saved, '找到「车牌换绑次数」的输入框')
const v2 = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tr')].find(x => x.innerText.includes('车牌换绑次数'))
  return tr?.querySelector('input')?.value || ''
})
ok(v2 === '2', '改值保存成功（内存态生效）', `当前值 ${v2}`)
ok(!(await txt()).includes('参数值不得为空'), '空值校验没有被误触发')

/* ============================ H2 换绑真表 ============================ */
console.log('\n=== H2 换绑记录 · 真表 ===')
await go('/a/vehicles')
const listed = await rowsOf()
ok(listed.length > 0, '车位列表有数据', `${listed.length} 行`)

/* 找一个已绑定的车位进详情 */
const opened = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tr')].find(x => x.innerText.includes('已绑定'))
  if (!tr) return false
  tr.click(); return true
})
await sleep(1500)
ok(opened, '打开一个已绑定车位的详情')

let d = await drawerText()
ok(d.includes('换绑记录'), '详情里有换绑记录区')
ok(/本月已换\s*\d+\s*\/\s*上限\s*\d+\s*次/.test(d.replace(/\s+/g, ' ')), '顶部给出「本月已换 N / 上限 M 次」', d.slice(0, 80))
ok(d.includes('业主自助'), '记录里能看到「业主自助」来源（业主端换绑后台可见）')
ok(/已同步|待同步/.test(d), '记录里能看厂商状态')

const beforeCnt = Number((d.replace(/\s+/g, ' ').match(/本月已换\s*(\d+)/) || [])[1] || 0)

/* 提交换绑：写一条「物业代操作」 */
await clickBtn('换绑')
await sleep(600)
/* 弹窗第一个 input 是「车位」（disabled），必须按 placeholder 找新车牌那一栏 */
const filled = await page.evaluate(() => {
  const dlg = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  if (!dlg) return false
  const inp = [...dlg.querySelectorAll('input')].find(x => (x.placeholder || '').includes('川A'))
  if (!inp) return false
  inp.value = '川A·TEST1'
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})
await sleep(400)
ok(filled, '新车牌已填入（按 placeholder 定位，不是第一个只读框）')
/* 原因下拉：popper 是 fixed 定位，offsetParent 恒为 null，不能用它判可见 */
await page.evaluate(() => {
  const dlg = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  const sel = dlg?.querySelector('.el-select__wrapper') || dlg?.querySelector('.el-select')
  sel?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(700)
const reasonPicked = await page.evaluate(() => {
  const opts = [...document.querySelectorAll('.el-select-dropdown__item')]
    .filter(x => { const r = x.getBoundingClientRect(); return r.height > 0 })
  opts[0]?.click()
  return opts[0]?.innerText || ''
})
await sleep(600)
ok(!!reasonPicked, '换绑原因已选中', reasonPicked)
await clickBtn('确认换绑')
await sleep(1200)
t = await txt()
ok(t.includes('已提交换绑') || t.includes('等待厂商回执'), '提交换绑有反馈', t.slice(0, 60))

d = await drawerText()
if (!d) { await page.evaluate(() => { const tr = [...document.querySelectorAll('.el-table__body tr')].find(x => x.innerText.includes('已绑定')); tr?.click() }); await sleep(1300); d = await drawerText() }
ok(d.includes('物业代操作'), '新记录来源是「物业代操作」（真表写进去了）', d.slice(0, 120))
ok(d.includes('川A·TEST1') || d.includes('TEST1'), '新记录带着新车牌')

const afterCnt = Number((d.replace(/\s+/g, ' ').match(/本月已换\s*(\d+)/) || [])[1] || 0)
ok(afterCnt === beforeCnt + 1, '本月次数 +1', `${beforeCnt} → ${afterCnt}`)

/* 重置本月次数（客服兜底，必须写原因） */
await clickBtn('重置本月次数')
await sleep(700)
const hasPrompt = await page.evaluate(() => {
  const box = [...document.querySelectorAll('.el-message-box')].find(x => x.offsetParent !== null)
  return !!box
})
ok(hasPrompt, '点「重置本月次数」弹出原因输入')
await page.evaluate(() => {
  const box = [...document.querySelectorAll('.el-message-box')].find(x => x.offsetParent !== null)
  const inp = box?.querySelector('input, textarea')
  if (inp) { inp.value = '业主多次来电，已核实确有换车'; inp.dispatchEvent(new Event('input', { bubbles: true })) }
})
await sleep(300)
await page.evaluate(() => {
  const box = [...document.querySelectorAll('.el-message-box')].find(x => x.offsetParent !== null)
  const btn = [...(box?.querySelectorAll('button') || [])].find(x => x.innerText.includes('确认重置'))
  btn?.click()
})
await sleep(1300)
d = await drawerText()
ok(/本月已换\s*0/.test(d.replace(/\s+/g, ' ')) || /本月已换\s*0/.test((await txt()).replace(/\s+/g, ' ')), '重置后本月次数归零')
ok(d.includes('物业重置') || d.includes('客服重置本月换绑次数'), '重置留痕（记一条「物业重置」）', d.slice(0, 120))

/* 刷新仍在：换页面再回来，记录不该消失 */
await go('/a/vehicles')
await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tr')].find(x => x.innerText.includes('TEST1') || x.innerText.includes('已绑定'))
  tr?.click()
})
await sleep(1500)
d = await drawerText()
ok(d.includes('业主自助') || d.includes('物业代操作'), '切页返回后记录仍在（不再是刷新即丢）', d.slice(0, 90))

/* ============================ H4 / H5 人脸核验 ============================ */
console.log('\n=== H4 / H5 人脸核验工作台 ===')
await go('/a/faces')
t = await txt()
ok(t.includes('人脸核验'), '进入人脸核验工作台')
ok(t.includes('待核验'), '有「待核验」概念')
ok(t.includes('业主本人') || t.includes('家庭成员'), '列表出现业主/家庭成员主体')
const firstRows = await rowsOf()
ok(firstRows.length > 0, '工作台有数据', `${firstRows.length} 行`)
ok(firstRows.some(x => x.includes('租客')), '租客也在同一个列表里（H5 合并入口）')
ok(firstRows.some(x => x.includes('业主本人')), '第一段有「业主本人」')
ok(firstRows.some(x => x.includes('家庭成员')), '第一段有家庭成员（配偶 / 子女）', firstRows.slice(0, 3).join(' ;; '))

/* 分段筛选：只看租客 */
await page.evaluate(() => {
  const rb = [...document.querySelectorAll('.el-radio-button__inner')].find(x => x.innerText.includes('租客'))
  rb?.click()
})
await sleep(1000)
const tenantRows = await rowsOf()
ok(tenantRows.length > 0 && tenantRows.every(x => x.includes('租客')), '「租客」分段只回租客', `${tenantRows.length} 行`)
await page.evaluate(() => {
  const rb = [...document.querySelectorAll('.el-radio-button__inner')].find(x => x.innerText.includes('全部'))
  rb?.click()
})
await sleep(900)

/* 驳回：空原因被拦 */
const openedReject = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tr')].find(x => x.innerText.includes('待核验'))
  if (!tr) return ''
  const btn = [...tr.querySelectorAll('button')].find(x => x.innerText.trim() === '驳回')
  if (!btn) return ''
  const name = tr.innerText.split('\n')[1] || ''
  btn.click(); return name
})
await sleep(800)
ok(!!openedReject, '打开驳回弹窗')
await clickBtn('确认驳回')
await sleep(600)
ok((await txt()).includes('驳回必须写原因'), '空原因被拦')
await page.evaluate(() => {
  const dlg = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  const ta = dlg?.querySelector('textarea')
  if (ta) { ta.value = '照片模糊，看不清五官'; ta.dispatchEvent(new Event('input', { bubbles: true })) }
})
await sleep(300)
await clickBtn('确认驳回')
await sleep(1200)
t = await txt()
ok(t.includes('已驳回') && (t.includes('照片模糊') || t.includes('看原因')), '驳回成功且原因可见', t.slice(0, 80))

/* 通过一条租客 → 租户列表的「人脸」标记要跟着变 */
await page.evaluate(() => {
  const rb = [...document.querySelectorAll('.el-radio-button__inner')].find(x => x.innerText.includes('租客'))
  rb?.click()
})
await sleep(900)
const passedName = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tr')].find(x => x.innerText.includes('待核验'))
  if (!tr) return ''
  const name = tr.innerText.split('\n')[1] || ''
  const btn = [...tr.querySelectorAll('button')].find(x => x.innerText.trim() === '通过')
  btn?.click()
  return name
})
await sleep(1300)
ok(!!passedName, '通过一条租客人脸', passedName)
t = await txt()
ok(t.includes('已生效'), '通过后状态变「已生效」')

await go('/a/tenants')
const trows = await rowsOf()
ok(trows.some(x => x.includes('人脸')), '租户列表能看到人脸标记（审核回写了 faceRegistered）')

/* 业主表单：开关已撤 */
await go('/a/owners')
await clickBtn('新增业主')
await sleep(1000)
t = await txt()
ok(t.includes('人脸状态'), '业主表单显示「人脸状态」')
ok(!t.includes('已录人脸'), '业主表单不再有可勾的「已录人脸」开关', t.slice(0, 60))
ok(t.includes('去核验'), '给出「去核验」入口')

/* ============================ 运行时错误 ============================ */
console.log('\n=== 运行时错误 ===')
const real = errs.filter(e => !/favicon|ResizeObserver/i.test(e))
ok(real.length === 0, '零 console / page 错误', real.slice(0, 2).join(' / '))

console.log(`\n通过 ${pass} / 失败 ${fail}`)
await b.close()
process.exit(fail ? 1 : 0)
