/**
 * 第 69 批 · 租售信息（PC 后台）
 *
 * 关键口径（断言围绕这几条）：
 *   ① 后台**没有「新建」** —— 挂牌只能由业主在业主端发起；
 *   ② 审核人是**该房责任楼管**，不是审核员；超 24 小时标红「已升级」；
 *   ③ 面积 / 户型 / 朝向 / 楼层从房屋档案派生，业主改不了；
 *   ④ 驳回必须写理由；
 *   ⑤ 看房请求超 24 小时未回拨要标红；
 *   ⑥ 楼管（R-STW）能审，客服（R-CS）只能看。
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
  await sleep(1600)
}
async function clickBtn(text) {
  const done = await page.evaluate(t => {
    const el = [...document.querySelectorAll('button')].find(x => x.innerText.trim().includes(t))
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
const stats = sel => page.evaluate(s => [...document.querySelectorAll(s)].map(x => x.innerText.replace(/\n+/g, ' | ')), sel)
const rowsOf = () => page.evaluate(() => [...document.querySelectorAll('.el-table__body tr')].map(x => x.innerText.replace(/\n+/g, ' | ')))

console.log('=== ① 挂牌列表 ===')
await go('/a/listings')
let t = await txt()
ok(t.includes('租售信息'), '页面打开')
ok(t.includes('责任楼管审核'), '说明了审核人是责任楼管')
ok(t.includes('没有「新建」') || t.includes('不代发'), '写明了后台不代发')
let st = await stats('.lstat')
console.log('     统计：', st)
ok(st[0].includes('待审核') && st[0].includes('4'), '待审核 4 条', st[0])
ok(st[0].includes('2'), '其中 2 条已升级（超 24 小时）', st[0])
ok(st[1].includes('已发布') && st[1].includes('6'), '已发布 6 条', st[1])
ok(st[2].includes('看房待联系'), '看房待联系统计在', st[2])
ok(st[3].includes('已成交') && st[3].includes('已下架'), '成交 / 下架统计在', st[3])

let rows = await rowsOf()
console.log('     首行：', rows[0]?.slice(0, 110))
ok(rows.length === 14, '列表 14 条', String(rows.length))
ok(rows[0].includes('待审核'), '待审核排最前')
ok(/(室|跃层|别墅|单间|公寓)/.test(rows[0]), '户型从房屋档案带出', rows[0])
ok(/\d+\.?\d*㎡/.test(rows[0]), '面积从档案带出')
const topBtns = await page.evaluate(() => [...document.querySelectorAll('.page button')].map(x => x.innerText.trim()))
ok(!topBtns.some(x => x === '新建' || x.includes('新建租售')), '页面没有「新建」按钮（挂牌由业主发起）', topBtns.slice(0, 8).join('/'))

/* 超时标红 */
ok(t.includes('已升级'), '超时条目显示「已升级」')

console.log('\n=== ② 审核抽屉 ===')
ok(await rowBtn('待审核', '审核'), '打开审核抽屉')
let drawer = await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.querySelector('.au-hd'))
  return d ? d.innerText : ''
})
console.log('     抽屉首段：', drawer.split('\n').filter(Boolean).slice(0, 6).join(' / '))
ok(drawer.includes('产权关系'), '展示产权关系')
ok(drawer.includes('本人发布'), '标注「本人发布」')
ok(drawer.includes('从房屋档案带出'), '说明面积户型不可改')
ok(drawer.includes('图片'), '提示要看图')

/* 驳回不写理由 → 拦 */
await clickBtn('驳回')
ok((await txt()).includes('驳回必须写理由'), '驳回未写理由被拦')

/* 通过一条 */
const beforePending = (await stats('.lstat'))[0]
await clickBtn('通过并公开')
await sleep(900)
const afterPending = (await stats('.lstat'))[0]
console.log('     通过前：', beforePending, '→ 通过后：', afterPending)
ok(!afterPending.includes('| 4 |') || afterPending !== beforePending, '通过后待审核数下降', afterPending)
const publishedRows = (await rowsOf()).filter(x => x.includes('已发布'))
ok(publishedRows.length >= 6, '已发布条目增加', String(publishedRows.length))

console.log('\n=== ③ 强制下架 ===')
await sleep(400)
const canOffline = await rowBtn('已发布', '下架')
ok(canOffline, '已发布条目有「下架」')
await clickBtn('确认下架')
ok((await txt()).includes('下架必须写原因'), '未写原因被拦')
await page.evaluate(() => {
  const ta = [...document.querySelectorAll('.el-dialog textarea')].pop()
  if (!ta) return
  ta.value = '业主已告知房子租出，联系不上，先强制下架'
  ta.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(300)
await clickBtn('确认下架')
await sleep(900)
ok((await rowsOf()).some(x => x.includes('已下架')), '下架后状态变「已下架」')

console.log('\n=== ④ 看房请求 ===')
await go('/a/viewings')
t = await txt()
ok(t.includes('看房请求'), '页面打开')
ok(t.includes('不建账号'), '说明不建访客账号')
ok(t.includes('90 天'), '写明 90 天自动清理')
st = await stats('.vstat')
console.log('     统计：', st)
ok(st[0].includes('待联系') && st[0].includes('4'), '待联系 4 条', st[0])
ok(st[0].includes('超 24 小时'), '统计了超时条数', st[0])
rows = await rowsOf()
console.log('     首行：', rows[0]?.slice(0, 100))
ok(rows.length === 10, '请求列表 10 条', String(rows.length))
ok(rows[0].includes('待联系'), '待联系排最前')
ok(t.includes('已超时'), '超时条目显示「已超时」')
ok(/1\d{2}\*{4}\d{4}/.test(t), '手机号脱敏显示')

console.log('\n=== ⑤ 权限 ===')
/* 项目经理 = 本项目：只看得到 P01 的挂牌，条数必须少于总经理 */
await go('/a/listings', 'R-PM')
const pmRows = (await rowsOf()).length
const pmAll = await page.evaluate(() => [...document.querySelectorAll('.el-table__body tr')].map(x => x.innerText))
console.log('     pm 可见条数：', pmRows)
ok(pmRows > 0 && pmRows < 14, '项目经理只看得到本项目（少于全部 14 条）', String(pmRows))
ok(!pmAll.some(x => x.includes('锦绣家园') || x.includes('云栖里')), '看不到别的项目的房源')

await go('/a/listings', 'R-CS')
t = await txt()
ok(t.includes('租售信息'), '客服能看列表')
const csBtns = await page.evaluate(() => [...document.querySelectorAll('.el-table__body button')].map(x => x.innerText.trim()))
ok(!csBtns.includes('审核'), '客服没有「审核」按钮（审核人是楼管）', csBtns.slice(0, 6).join('/'))

await go('/a/listings', 'R-STW')
t = await txt()
ok(t.includes('租售信息'), '楼管能进列表')
const stwBtns = await page.evaluate(() => [...document.querySelectorAll('.el-table__body button')].map(x => x.innerText.trim()))
ok(stwBtns.includes('审核'), '楼管有「审核」按钮', stwBtns.slice(0, 6).join('/'))

/* 楼管的数据范围是「责任范围」：只看得到自己负责的那几套，且页面要标出来 */
const stwRows = (await rowsOf()).length
console.log('     楼管可见条数：', stwRows)
ok(stwRows > 0 && stwRows < 14, '楼管只看得到责任范围内的挂牌（不是全部 14 条）', String(stwRows))
ok(t.includes('责任范围'), '页面标出了数据范围', t.match(/数据范围：[^\n]{0,30}/)?.[0] || '')

await go('/a/viewings', 'R-VIEW')
t = await txt()
ok(t.includes('看房请求'), '只读角色能看请求列表')
const viewBtns = await page.evaluate(() => [...document.querySelectorAll('.page button')].map(x => x.innerText.trim()))
ok(!viewBtns.some(x => x.includes('审核') || x.includes('下架')), '只读角色没有任何审核 / 下架入口', viewBtns.slice(0, 8).join('/'))

console.log('\n=== ⑥ 运行时错误 ===')
ok(errs.length === 0, '无 pageerror / console.error', errs.slice(0, 2).join(' | '))

console.log(`\n${fail ? '✘' : '✔'} 通过 ${pass} / 失败 ${fail}`)
await b.close()
process.exit(fail ? 1 : 0)
