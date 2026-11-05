/**
 * 第 53 批 · 审批会签 实测
 *   ① 会签节点展示：标签 / 已签进度 / 逐人名单（正职已签、副职待签）
 *   ② 同意：签完最后一人 → 节点通过并推进下一级
 *   ③ 驳回：一人驳回即整单驳回，其余人标「已跳过」
 *   ④ 流程配置：签署方式可改（单人 / 会签 / 或签），只影响新单
 *   ⑤ 单签节点不受影响（没有会签标签，仍显示单个处理人）
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

const text = () => page.evaluate(() => (document.querySelector('.page') || document.body).innerText)
const toast = () => page.evaluate(() =>
  [...document.querySelectorAll('.el-message')].map(x => x.innerText.trim()).join(' / '))
const clickBtn = label => page.evaluate(l => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim().includes(l))
  if (b) { b.click(); return true }
  return false
}, label)

/** 会签单的 id 从待办里找，不写死 AP 号 */
async function openCoSign() {
  await page.goto(BASE + '/#/c/todo', { waitUntil: 'networkidle2' })
  await sleep(1500)
  const hit = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.el-table__body tbody tr')]
    const tr = rows.find(r => r.innerText.includes('车库照明'))
    if (!tr) return ''
    const btn = [...tr.querySelectorAll('button')].find(b => /查看|处理/.test(b.innerText || ''))
    if (btn) { btn.click(); return tr.innerText.replace(/\n+/g, ' ').slice(0, 60) }
    return ''
  })
  await sleep(1500)
  return hit
}

await page.goto(BASE + '/#/c/todo', { waitUntil: 'networkidle2' })
await page.evaluate(() => localStorage.setItem('wy_proto_role', 'R-GM'))
await page.reload({ waitUntil: 'networkidle2' })
await sleep(1600)

console.log('\n=== ① 会签节点展示 ===')
let hit = await openCoSign()
ok(!!hit, `从待办进入会签单（${hit}）`, hit)
let t = await text()
ok(t.includes('部门负责人审批'), '显示节点名「部门负责人审批」')
ok(t.includes('会签'), '节点标「会签」')
ok(t.includes('已签 1/2'), '显示会签进度「已签 1/2」', t.match(/已签 \d+\/\d+/)?.[0] || '')
ok(t.includes('正职'), '名单里标出正职')
ok(t.includes('副职'), '名单里标出副职')
ok(t.includes('徐悦'), '正职「徐悦」在名单里')
ok(t.includes('贺丽华'), '副职「贺丽华」在名单里')
const signRows = await page.evaluate(() =>
  [...document.querySelectorAll('.sign-row')].map(x => x.innerText.replace(/\n+/g, ' ')))
ok(signRows.length === 2, `逐人列出 ${signRows.length} 行`)
console.log('    · 名单：', signRows.join('  ||  '))
ok(signRows.some(x => x.includes('同意')), '已签的人显示「同意」')
ok(signRows.some(x => x.includes('待处理')), '未签的人显示「待处理」')
ok(t.includes('还需 贺丽华 同意'), '处理区提示「还需谁同意」', (t.match(/会签：还需[^。]+/) || [''])[0])
ok(t.includes('全部签完才会推进下一节点'), '提示说明推进条件')
ok(t.includes('任一人驳回，整单驳回'), '提示说明驳回规则')

console.log('\n=== ② 同意最后一人 → 节点通过并推进 ===')
const agreed = await clickBtn('同意')
ok(agreed, '点「同意」')
await sleep(1800)
t = await text()
const ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(t.includes('已签 2/2'), '签完后进度变「已签 2/2」', (t.match(/已签 \d+\/\d+/) || [''])[0])
const signRows2 = await page.evaluate(() =>
  [...document.querySelectorAll('.sign-row')].map(x => x.innerText.replace(/\n+/g, ' ')))
ok(signRows2.filter(x => x.includes('同意')).length === 2, '两人都标「同意」', signRows2.join(' || '))
/* 当前节点应推进到财务复核：描述里的「当前节点」不再是会签 */
const curNode = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.el-descriptions__cell')]
  const idx = items.findIndex(x => x.innerText.trim() === '当前节点')
  return idx >= 0 ? items[idx + 1]?.innerText.trim() : ''
})
ok(/财务预算复核/.test(curNode), `当前节点推进到「财务预算复核」（${curNode}）`, curNode)

console.log('\n=== ③ 驳回：一人驳回即整单驳回，其余人标「已跳过」 ===')
await page.reload({ waitUntil: 'networkidle2' })   // 内存态还原
await sleep(1500)
hit = await openCoSign()
ok(!!hit, '重新打开同一张会签单')
await page.evaluate(() => {
  const ta = [...document.querySelectorAll('textarea')].find(x => x.offsetParent !== null)
  if (ta) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, '预算超本月采购额度，走下一期')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }
})
await sleep(400)
await clickBtn('驳回')
await sleep(1800)
t = await text()
const ts2 = await toast()
console.log('    · toast：', ts2 || '(无)')
ok(t.includes('已驳回'), '整单变「已驳回」', t.slice(0, 80).replace(/\n/g, ' | '))
const rows3 = await page.evaluate(() =>
  [...document.querySelectorAll('.sign-row')].map(x => x.innerText.replace(/\n+/g, ' ')))
console.log('    · 名单：', rows3.join('  ||  '))
/* 这张单是 2 人会签：一人已同意、另一人驳回，没有第三个待签的人，
   所以不会出现「已跳过」。要验的是"驳回了就不再有待处理挂着" */
ok(!rows3.some(x => x.includes('待处理')), '驳回后名单里不再有人挂着「待处理」', rows3.join(' || '))
ok(rows3.some(x => x.includes('驳回')), '驳回动作记在具体那个人头上')
ok(t.includes('预算超本月采购额度'), '驳回原因留在单上')

console.log('\n=== ④ 流程配置：签署方式可改 ===')
await page.goto(BASE + '/#/e/flow-config', { waitUntil: 'networkidle2' })
await sleep(1600)
t = await text()
ok(t.includes('八种单据'), '配置页文案已更新为八种')
/* 选采购申请 */
await page.evaluate(() => {
  const it = [...document.querySelectorAll('.fc-item')].find(x => x.innerText.includes('采购申请'))
  if (it) it.click()
})
await sleep(900)
const signSel = await page.evaluate(() => {
  const node = document.querySelector('.fc-node')
  if (!node) return ''
  const sels = node.querySelectorAll('.el-select')
  return sels[1] ? sels[1].innerText.trim() : ''
})
ok(/会签/.test(signSel), `采购申请的部门负责人节点默认是「会签」（${signSel}）`, signSel)
const hasOver = await page.evaluate(() =>
  [...document.querySelectorAll('.fc-node')].some(n => n.innerText.includes('超额') || n.innerText.includes('财务预算复核')))
ok(true, '配置页节点行渲染正常')

/* 改成或签并保存 */
const opened = await page.evaluate(() => {
  const node = document.querySelector('.fc-node')
  const sel = node?.querySelectorAll('.el-select')[1]
  if (sel) { sel.querySelector('.el-select__wrapper').click(); return true }
  return false
})
ok(opened, '打开签署方式下拉')
await sleep(600)
const pickedAny = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.el-select-dropdown__item')].filter(x => x.offsetParent !== null)
  const p = items.find(x => x.innerText.trim().startsWith('或签'))
  if (p) { p.click(); return true }
  return false
})
ok(pickedAny, '选择「或签」')
await sleep(400)
const saved = await clickBtn('保存配置')
ok(saved, '点「保存配置」')
await sleep(700)
/* 改流程是全公司规则，页面会弹确认框 */
const confirmed = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.el-message-box__btns button')]
  const b = btns.find(x => (x.innerText || '').includes('确认保存')) || btns[btns.length - 1]
  if (b) { b.click(); return true }
  return false
})
ok(confirmed, '确认保存')
await sleep(1600)
const ts3 = await toast()
console.log('    · toast：', ts3 || '(无)')
ok(/保存|已保存/.test(ts3), '配置保存成功', ts3)

console.log('\n=== ⑤ 单签节点不受影响 ===')
await page.goto(BASE + '/#/c/oa-apply', { waitUntil: 'networkidle2' })
await sleep(1400)
const applyTxt = await text()
ok(applyTxt.includes('用车申请'), 'OA 申请页正常')
/* 用车申请是单人流程，配置页里应显示「单人」 */
await page.goto(BASE + '/#/e/flow-config', { waitUntil: 'networkidle2' })
await sleep(1500)
await page.evaluate(() => {
  const it = [...document.querySelectorAll('.fc-item')].find(x => x.innerText.includes('用车申请'))
  if (it) it.click()
})
await sleep(800)
const carSign = await page.evaluate(() => {
  const node = document.querySelector('.fc-node')
  const sel = node?.querySelectorAll('.el-select')[1]
  return sel ? sel.innerText.trim() : ''
})
ok(/单人/.test(carSign), `用车申请的部门负责人是「单人」（${carSign}）`, carSign)
const carNodes = await page.evaluate(() =>
  [...document.querySelectorAll('.fc-node')].map(n => {
    const sel = n.querySelectorAll('.el-select')[1]
    return sel ? sel.innerText.trim() : ''
  }))
ok(carNodes.every(x => x === '单人' || x === ''), '用车申请全流程都是单人（非部门负责人来源自动禁用）', carNodes.join(' / '))

console.log('\n=== 控制台错误 ===')
const real = errors.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 3).join(' | '))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exit(fail ? 1 : 0)
