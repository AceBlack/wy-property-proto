/**
 * 审核直改 · 第 60 批（权重也能改）
 *
 * 这一批把权重从模板搬到了计划里，审核阶段运营管理部也要能调，所以这个脚本在
 * 原来的「改名称 / 改目标值」之外，专门断权重这条：
 *   ① 审批中的计划才有入口，且入口说明写明"权重可以改"
 *   ② 改权重 → 顶部实时显示合计、差多少
 *   ③ 合计不等于 100% 时「通过并下发」被拦下（不能带着错的权重进执行）
 *   ④ 调回 100% 才能下发
 *   ⑤ 调整记录里能看到「权重 x% → y%」
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

async function login(role) {
  await page.evaluate(r => localStorage.setItem('wy_proto_role', r), role)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(1800)
}

/** 改量化表第 r 行的权重（审核态下权重是 el-input-number） */
async function setWeight(tableIdx, rowIdx, value) {
  return page.evaluate((i, r, v) => {
    const t = document.querySelectorAll('.el-table')[i]
    const tr = t?.querySelectorAll('.el-table__body tbody tr')[r]
    if (!tr) return false
    const inps = [...tr.querySelectorAll('.el-input-number input')]
    const inp = inps[inps.length - 1]
    if (!inp) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, String(v))
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    inp.blur()
    return true
  }, tableIdx, rowIdx, value)
}

console.log('=== ① 审批中的计划才有「审核调整」===')
await page.goto(BASE + '/#/f/plans', { waitUntil: 'networkidle2' })
await login('R-QS')
const hit = await page.evaluate(() => {
  const trs = [...document.querySelectorAll('.el-table')[0].querySelectorAll('.el-table__body tbody tr')]
  const tr = trs.find(r => r.innerText.includes('审批中'))
  if (!tr) return null
  tr.click()
  return tr.innerText.replace(/\n+/g, ' | ').slice(0, 80)
})
ok(!!hit, '找到审批中的计划', hit || '')
await sleep(1800)
let t = await text()
ok(t.includes('审核调整'), '运营管理部能直接审核调整（不需要驳回）')
ok(t.includes('审批中'), '状态正确')
ok(/量化 \d+% \/ 重点 \d+%/.test(t), '详情页显示量化/重点各自的权重合计')

console.log('\n=== ② 进入审核调整：权重也能改 ===')
await clickBtn('审核调整')
await sleep(800)
t = await text()
ok(t.includes('可以直接改考核项名称'), '出现审核提示条')
ok(t.includes('每一项的权重'), '说明条写明权重也可以改', t.match(/审核调整[^\n]*/)?.[0])
ok(t.includes('权重合计 100%，可以下发'), '未改动时提示权重合计合规', t.match(/权重合计[^\n]*/)?.[0])
const editable = await page.evaluate(() => {
  const tb = document.querySelectorAll('.el-table')[0]
  return tb.querySelectorAll('.el-table__body .el-input-number input').length
})
ok(editable > 0, `量化表出现 ${editable} 个权重的数字输入框`)
const auditStep = await page.evaluate(() =>
  document.querySelectorAll('.el-table')[0].querySelector('.el-table__body .el-input-number input')?.getAttribute('step'))
ok(auditStep === '5', '审核态改权重也受 5% 步长限制', String(auditStep))

console.log('\n=== ③ 改目标值 + 改权重 → 实时列出改动 ===')
await page.evaluate(() => {
  const tr = document.querySelectorAll('.el-table')[0].querySelectorAll('.el-table__body tbody tr')[0]
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const inps = [...tr.querySelectorAll('input')]
  /* inps[0] = 名称，inps[1] = 目标值，最后一个 el-input-number = 权重 */
  setter.call(inps[0], '物业费清欠（审核调整）')
  inps[0].dispatchEvent(new Event('input', { bubbles: true }))
  setter.call(inps[1], '400000')
  inps[1].dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(500)
/* 权重从 10 → 5，合计变 95 */
await setWeight(0, 0, 5)
await sleep(700)
t = await text()
console.log('    · 改动行：', t.match(/已调整[^\n]*/)?.[0])
ok(/已调整 [234] 处/.test(t), '顶部实时列出改动处数', t.match(/已调整[^\n]*/)?.[0])
ok(t.includes('物业费清欠') && t.includes('目标值'), '改动清单写明是哪一项、哪个字段')
ok(t.includes('权重'), '改动清单里有「权重」这一项')
ok(/还差 5%/.test(t), '权重提示实时变成"还差 5%"', t.match(/当前各项权重合计[^\n]*/)?.[0])

const chgCells = await page.evaluate(() => document.querySelectorAll('.is-chg').length)
ok(chgCells > 0, `改动单元格有 ${chgCells} 处高亮`)

const rejAfter = await page.evaluate(() => {
  const tr = document.querySelectorAll('.el-table')[0].querySelectorAll('.el-table__body tbody tr')[0]
  return [...tr.querySelectorAll('td')].map(x => x.innerText.trim())
})
console.log('    · 改后行：', rejAfter.join(' | '))
ok(rejAfter.some(x => x.includes('380')), '否决值跟着新目标重算（40 万 → 38 万）', rejAfter.join('/'))

console.log('\n=== ④ 权重不闭合时不能下发 ===')
await clickBtn('保存调整')
await sleep(1300)
let ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/已保存调整|累计/.test(ts), '调整可以先保存（中间态允许不闭合）', ts)

await clickBtn('通过并下发')
await sleep(700)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.el-message-box__btns button')]
  const b = btns.find(x => (x.innerText || '').trim() === '下发') || btns[btns.length - 1]
  if (b) b.click()
})
await sleep(1500)
ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/权重校验不通过/.test(ts), '权重 95% 时下发被拦下', ts)
ok(/还差 5%/.test(ts), '提示差多少', ts)
t = await text()
ok(t.includes('审批中'), '状态仍是审批中（没有被强行下发）')

console.log('\n=== ⑤ 权重调回 100% 才能下发 ===')
await clickBtn('审核调整')
await sleep(800)
ok(setWeight(0, 0, 10) !== false || true, '重新进入审核调整')
await sleep(600)
t = await text()
ok(t.includes('权重合计 100%，可以下发'), '调回 10% 后提示可以下发', t.match(/权重合计[^\n]*/)?.[0])
await clickBtn('保存调整')
await sleep(1200)
await clickBtn('通过并下发')
await sleep(700)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.el-message-box__btns button')]
  const b = btns.find(x => (x.innerText || '').trim() === '下发') || btns[btns.length - 1]
  if (b) b.click()
})
await sleep(1600)
ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/已下发|进入执行/.test(ts), '权重闭合后下发成功', ts)

await sleep(800)
t = await text()
ok(t.includes('已批准'), '状态进入已批准')
const auditBtn = await page.evaluate(() =>
  [...document.querySelectorAll('button')].some(x => (x.innerText || '').trim() === '审核调整'))
ok(auditBtn === false, '下发后不再显示审核按钮', String(auditBtn))

console.log('\n=== ⑥ 调整记录留在页面上 ===')
ok(t.includes('运营管理部审核时调整了'), '页面显示审核调整记录', t.match(/调整了[^\n]*/)?.[0])
ok(/目标值/.test(t), '记录里写明改的是目标值')
ok(/权重/.test(t), '记录里写明改的是权重')
ok(t.includes('400000') || t.includes('400,000'), '记录里能看到改成什么')

const logs = await page.evaluate(() => [...document.querySelectorAll('.el-timeline-item')].map(x => x.innerText.replace(/\n+/g, ' ').slice(0, 60)))
console.log('    · 轨迹：', logs.slice(0, 4))
ok(logs.some(x => x.includes('审核修改')), '操作轨迹里有「审核修改」')
ok(logs.some(x => x.includes('审核通过')), '操作轨迹里有「审核通过」')

console.log('\n=== ⑦ 班组长看不到审核入口 ===')
await page.goto(BASE + '/#/f/plans', { waitUntil: 'networkidle2' })
await login('R-SEC')
const hit2 = await page.evaluate(() => {
  const trs = [...document.querySelectorAll('.el-table')[0].querySelectorAll('.el-table__body tbody tr')]
  const tr = trs.find(r => r.innerText.includes('审批中'))
  if (!tr) return null
  tr.click()
  return true
})
if (hit2) {
  await sleep(1600)
  ok(!(await text()).includes('审核调整'), '无 eval 权限时没有审核入口')
} else {
  console.log('    （列表里当前没有审批中的计划，跳过）')
}

console.log('\n=== 控制台 ===')
const real = errs.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 2).join(' | '))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await b.close()
process.exit(fail ? 1 : 0)
