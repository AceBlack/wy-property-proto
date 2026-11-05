/**
 * 提报表单实测（第 60 批，含"权重只能按 5% 调"）
 *
 * 断的是「权重怎么填、填错了会怎样」：
 *   ① 模板铺开时权重已经平均分好，合计 100%，且每一项都是 5 的倍数
 *   ② 权重可以改，但**只能按 5% 调**：手输 12 会归到 10，加减也是一档 5
 *   ③ 改成 90% → 提示"还差 10%"、提交按钮禁用
 *   ④ 改成 110% → 提示"超出 10%"
 *   ⑤ 「平均分配」一键回到 100%，且仍是 5 的倍数
 *   ⑥ 草稿允许不闭合（写到一半要能存），只有提交审核才卡
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
const tables = () => page.evaluate(() =>
  [...document.querySelectorAll('.el-table')].map(t => t.querySelectorAll('.el-table__body tbody tr').length))
const wbarText = () => page.evaluate(() => document.querySelector('.wbar')?.innerText.replace(/\n+/g, ' ') || '')
const submitState = () => page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '提交审批')
  return b ? { found: true, disabled: !!b.disabled || b.classList.contains('is-disabled') } : { found: false }
})
const btn = label => page.evaluate(l => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === l)
  if (b) { b.click(); return true }
  return false
}, label)

async function login(role) {
  await page.evaluate(r => localStorage.setItem('wy_proto_role', r), role)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(1800)
}

/** 改第 tableIdx 张表第 rowIdx 行的权重（表格里第一个 el-input-number） */
async function setWeight(tableIdx, rowIdx, value) {
  return page.evaluate((i, r, v) => {
    const t = document.querySelectorAll('.el-table')[i]
    const tr = t?.querySelectorAll('.el-table__body tbody tr')[r]
    if (!tr) return false
    const inp = tr.querySelector('.el-input-number input')
    if (!inp) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, String(v))
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    inp.blur()
    return true
  }, tableIdx, rowIdx, value)
}

const weightCells = tableIdx => page.evaluate(i => {
  const t = document.querySelectorAll('.el-table')[i]
  if (!t) return []
  return [...t.querySelectorAll('.el-table__body tbody tr')]
    .map(tr => tr.querySelector('.el-input-number input')?.value || '')
}, tableIdx)

console.log('=== ① 表单按模板铺开，权重已平均预填（5 的倍数）===')
await page.goto(BASE + '/#/f/plans/new', { waitUntil: 'networkidle2' })
await login('R-GM')
let t = await text()
ok(t.includes('权重由你定'), '说明条写明权重由提报人填')
ok(t.includes('只能按 5% 调'), '说明条写明只能按 5% 调')
ok(t.includes('职能通用月度计划'), '自动匹配到职能兜底模板', t.match(/考核模板[^\n]*/)?.[0])
ok(!/量化 \d+% \+ 重点 \d+%/.test(t), '不再显示"量化 x% + 重点 y%"（模板不带权重了）')
ok(t.includes('一、量化指标') && t.includes('二、监控指标') && t.includes('三、重点工作计划'), '三段都在')

const cnt = await tables()
console.log('    · 各表行数：', cnt)
ok(cnt[0] === 2, '量化段 2 条（职能模板）', String(cnt[0]))
ok(cnt[1] === 4, '监控段 4 条', String(cnt[1]))
ok(cnt[2] === 7, '重点段 7 条', String(cnt[2]))

const qW = await weightCells(0)
const kW = await weightCells(2)
console.log('    · 预填：量化', qW, '重点', kW)
const sum = [...qW, ...kW].map(Number).reduce((a, x) => a + x, 0)
ok(sum === 100, `预填合计正好 100（${sum}）`, String(sum))
ok([...qW, ...kW].every(v => Number(v) % 5 === 0), '每一项都是 5 的倍数', [...qW, ...kW].join('/'))
/* 9 个计分项分 20 个 5% —— 先每项 2 份（10%），多的 2 份给前两项（15%） */
ok(qW.join(',') === '15,15', '量化 2 项各 15%（余数给前几项）', qW.join(','))
ok(kW.every(v => v === '10'), '重点 7 项各 10%', kW.join(','))

let wb = await wbarText()
console.log('    · 权重条：', wb)
ok(/100\s*\/\s*100/.test(wb), '权重合计 100', wb)
ok(wb.includes('可以提报'), '预填后就能提报（不用自己凑）', wb)
let st = await submitState()
ok(st.found && st.disabled === false, '提交按钮可用', JSON.stringify(st))

console.log('\n=== ② 只能按 5% 调：输入框 step=5、手输 12 会归到 10 ===')
const stepAttr = await page.evaluate(() => {
  const inp = document.querySelectorAll('.el-table')[0].querySelector('.el-table__body .el-input-number input')
  return { step: inp?.getAttribute('step'), min: inp?.getAttribute('min'), max: inp?.getAttribute('max') }
})
console.log('    · 输入框属性：', stepAttr)
ok(stepAttr.step === '5', '权重输入框 step=5', String(stepAttr.step))
ok(stepAttr.min === '0' && stepAttr.max === '100', '范围 0–100', JSON.stringify(stepAttr))

await setWeight(0, 0, 12)
await sleep(700)
const snap = await weightCells(0)
console.log('    · 输入 12 之后：', snap)
ok(snap[0] === '10', `手输 12 被归到最近的 5 的倍数（${snap[0]}）`, snap[0])

console.log('\n=== ③ 改成 90% → 还差 10%，提交被拦 ===')
await setWeight(0, 0, 5)
await sleep(700)
wb = await wbarText()
console.log('    · 权重条：', wb)
ok(wb.includes('90'), '合计变成 90', wb)
ok(/还差 10%/.test(wb), '提示"还差 10%"', wb)
st = await submitState()
ok(st.disabled === true, '提交按钮被禁用', JSON.stringify(st))

console.log('\n=== ④ 改成 110% → 超出 10% ===')
await setWeight(0, 0, 15)
await sleep(300)
const k0 = (await weightCells(2))[0]
await setWeight(2, 0, Number(k0) + 10)
await sleep(700)
wb = await wbarText()
console.log('    · 权重条：', wb)
ok(wb.includes('110'), '合计变成 110', wb)
ok(/超出 10%/.test(wb), '提示"超出 10%"', wb)
st = await submitState()
ok(st.disabled === true, '超出时提交也被禁用', JSON.stringify(st))

console.log('\n=== ⑤ 「平均分配」一键回到 100%（仍是 5 的倍数）===')
await btn('平均分配')
await sleep(800)
wb = await wbarText()
console.log('    · 权重条：', wb)
ok(/100\s*\/\s*100/.test(wb), '合计回到 100', wb)
ok(wb.includes('可以提报'), '重新可提报', wb)
const qW2 = await weightCells(0)
const kW2 = await weightCells(2)
const sum2 = [...qW2, ...kW2].map(Number).reduce((a, x) => a + x, 0)
console.log('    · 平摊后：', qW2, kW2, '合计', sum2)
ok(sum2 === 100, '逐项相加正好 100', String(sum2))
ok([...qW2, ...kW2].every(v => Number(v) % 5 === 0), '平均分配也只出 5 的倍数', [...qW2, ...kW2].join('/'))
ok(new Set([...qW2, ...kW2]).size <= 2, '各项只差一档 5%（平均分配的正确含义）', [...new Set([...qW2, ...kW2])].join('/'))

console.log('\n=== ⑥ 草稿允许不闭合 ===')
await setWeight(0, 0, 5)
await sleep(500)
ok((await submitState()).disabled === true, '不闭合时提交仍被禁用')
await btn('保存草稿')
await sleep(1800)
let ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/草稿已保存/.test(ts), '草稿照常保存（不强迫凑够 100 才能存）', ts)
const url = page.url()
ok(/\/f\/plans\/PL\d+\/edit/.test(url), '跳到编辑态', url)
await sleep(600)
t = await text()
ok(t.includes('编辑已保存的计划'), '编辑态标识正确')
const wb3 = await wbarText()
ok(/还差/.test(wb3), '编辑态仍提示差多少', wb3)

console.log('\n=== ⑦ 补回 100% 后可以提交 ===')
await btn('平均分配')
await sleep(600)
await btn('提交审批')
await sleep(2000)
ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/已提交审批|权重校验不通过|要填目标值|填完成时间/.test(ts), '点提交后有明确结果（成功或指出缺什么）', ts)

console.log('\n=== 控制台 ===')
const real = errs.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 2).join(' | '))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await b.close()
process.exit(fail ? 1 : 0)
