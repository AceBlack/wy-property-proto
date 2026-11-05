/** 计划链路（第 55 批）：执行填报 → 提交完成情况 → 复评归档 */
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
await page.setViewport({ width: 1680, height: 1200 })
const errs = []
page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })

const text = () => page.evaluate(() => document.body.innerText)
const toast = () => page.evaluate(() => [...document.querySelectorAll('.el-message')].map(x => x.innerText.trim()).join(' | '))
const clickBtn = t => page.evaluate(label => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === label)
  if (b) { b.click(); return true }
  return false
}, t)
async function confirmBox(label) {
  await sleep(600)
  return page.evaluate(l => {
    const btns = [...document.querySelectorAll('.el-message-box__btns button')]
    const b = btns.find(x => (x.innerText || '').trim() === l) || btns[btns.length - 1]
    if (b) { b.click(); return true }
    return false
  }, label)
}
async function login(role) {
  await page.evaluate(r => localStorage.setItem('wy_proto_role', r), role)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(1600)
}

console.log('=== ① 找到执行中的计划 ===')
await page.goto(BASE + '/#/f/plans', { waitUntil: 'networkidle2' })
await login('R-SEC')
let target = await page.evaluate(() => {
  const trs = [...document.querySelectorAll('.el-table')[0].querySelectorAll('.el-table__body tbody tr')]
  const tr = trs.find(r => r.innerText.includes('客服组') && r.innerText.includes('执行中'))
  if (!tr) return null
  tr.click()
  return tr.innerText.replace(/\n+/g, ' | ')
})
ok(!!target, '列表里有执行中的客服组计划', target || '')
await sleep(1800)
ok(/\/f\/plans\/PL\d+/.test(page.url()), '进入详情页', page.url())
const planUrl = page.url()

console.log('\n=== ② 详情页按三段展示 ===')
let t = await text()
ok(t.includes('一、量化指标') && t.includes('二、监控指标') && t.includes('三、重点工作计划'), '三段都在')
ok(t.includes('自评加权合计') && t.includes('复评加权合计') && t.includes('月度总得分'), '三张合计卡都在')
const totals = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.tot__v')]
  return els.map(x => x.innerText.trim())
})
console.log('    · 合计：', totals)
ok(totals.length === 3, '三张合计卡渲染')
ok(Number(totals[0]) > 0, `自评合计 ${totals[0]} > 0`)
ok(totals[2] === '—', '未归档时不显示总分', totals[2])

console.log('\n=== ③ 改实际值 → 自评自动重算 ===')
const before = await page.evaluate(() => {
  const tb = document.querySelectorAll('.el-table')[0]
  const tr = tb.querySelectorAll('.el-table__body tbody tr')[0]
  const tds = [...tr.querySelectorAll('td')]
  return { cells: tds.map(x => x.innerText.trim()), actual: tr.querySelector('input')?.value || '' }
})
console.log('    · 首行：', before.cells.join(' | '), '｜实际 =', before.actual)
await page.evaluate(() => {
  const tr = document.querySelectorAll('.el-table')[0].querySelectorAll('.el-table__body tbody tr')[0]
  const inp = tr.querySelector('input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, '999999')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
  inp.blur()
})
await sleep(1200)
const after = await page.evaluate(() => {
  const tr = document.querySelectorAll('.el-table')[0].querySelectorAll('.el-table__body tbody tr')[0]
  return [...tr.querySelectorAll('td')].map(x => x.innerText.trim())
})
console.log('    · 超额完成后：', after.join(' | '))
/* 列序：# | 考核项 | 目标值 | 否决值 | 挑战值 | 实际完成 | 完成时间 | 权重 | 自评 | 自评加权 | 复评 | 复评加权
   第 60 批在「完成时间」后面插了权重列，所以自评从 [7] 挪到 [8] —— 写死索引的断言要跟着挪 */
const selfAfter = Number(after[8])
ok(selfAfter === 5, '远超挑战值 → 自评封顶 5 分', String(after[8]))
ok(Number(after[9]) > 0, '加权同步更新', after[9])
const totals2 = await page.evaluate(() => [...document.querySelectorAll('.tot__v')].map(x => x.innerText.trim()))
ok(Number(totals2[0]) !== Number(totals[0]), `自评合计跟着变（${totals[0]} → ${totals2[0]}）`)

console.log('\n=== ④ 提交完成情况 ===')
ok(await clickBtn('提交完成情况'), '找到「提交完成情况」')
await confirmBox('提交')
await sleep(1600)
const ts = await toast()
console.log('    · toast：', ts || '(无)')
t = await text()
ok(/待复评/.test(t), '状态进入待复评', t.match(/当前状态[^\n]*/)?.[0])

console.log('\n=== ⑤ 复评（用种子里待复评的那份，避免刷新重置内存态）===')
/* 原型是内存态，reload 会回到种子；所以切角色后从列表里找种子的待复评计划 */
await page.goto(BASE + '/#/f/plans', { waitUntil: 'networkidle2' })
await login('R-QS')
const hitReview = await page.evaluate(() => {
  const trs = [...document.querySelectorAll('.el-table')[0].querySelectorAll('.el-table__body tbody tr')]
  const tr = trs.find(r => r.innerText.includes('待复评'))
  if (!tr) return null
  tr.click()
  return tr.innerText.replace(/\n+/g, ' | ').slice(0, 80)
})
ok(!!hitReview, '列表里有待复评的计划', hitReview || '')
await sleep(2000)
ok((await text()).includes('复评并归档'), '待复评时出现「复评并归档」按钮', page.url())

console.log('\n=== ⑥ 复评并归档 ===')
await clickBtn('复评并归档')
await sleep(900)
const dlgOpen = await page.evaluate(() => [...document.querySelectorAll('.el-dialog')].some(x => x.offsetParent !== null))
ok(dlgOpen, '复评弹层打开')
if (!dlgOpen) {
  console.log(`\n结果：${pass} 通过 / ${fail + 3} 失败`)
  await b.close()
  process.exit(1)
}
const dlgText = await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  return d ? d.innerText.replace(/\n+/g, ' | ') : ''
})
console.log('    · 弹层首段：', dlgText.slice(0, 150))
ok(/复评合计/.test(dlgText), '弹层显示复评合计与预计总分')
const scoreInputs = await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  return d.querySelectorAll('.el-table__body input').length
})
ok(scoreInputs > 0, `弹层里有 ${scoreInputs} 个评分输入`)

await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  const b = [...d.querySelectorAll('button')].find(x => (x.innerText || '').includes('确认归档'))
  if (b) b.click()
})
await sleep(1800)
const ts2 = await toast()
console.log('    · toast：', ts2 || '(无)')
ok(/已归档/.test(ts2), '归档成功并提示总分', ts2)
t = await text()
ok(t.includes('复评结果'), '页面出现「复评结果」区块')

const final = await page.evaluate(() => {
  const el = document.querySelector('.score-bar__v')
  const g = document.querySelector('.score-bar__g')
  const note = document.querySelector('.score-bar .muted')
  return {
    score: el?.innerText.replace(/[^\d.]/g, '') || '',
    grade: g?.innerText.trim() || '',
    note: note?.innerText.trim() || ''
  }
})
console.log('    · 最终：', final)
ok(Number(final.score) > 0 && Number(final.score) <= 5, `总分在 0–5 之间（${final.score}）`)
ok(['优秀', '良好', '合格', '待改进'].includes(final.grade), `档位合法（${final.grade}）`)
ok(/×\s*20%/.test(final.note) || final.note.includes('20%'), '结果区写明 20/80 合成', final.note)

console.log('\n=== ⑦ 归档后不可再改 ===')
const noEdit = await page.evaluate(() =>
  ![...document.querySelectorAll('button')].some(x => /提交完成情况|复评并归档/.test(x.innerText || '')))
ok(noEdit, '归档后不再有填报 / 复评按钮')

console.log('\n=== 控制台 ===')
const real = errs.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 2).join(' | '))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await b.close()
process.exit(fail ? 1 : 0)
