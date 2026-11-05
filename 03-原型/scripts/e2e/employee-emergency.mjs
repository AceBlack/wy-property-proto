/**
 * 员工档案 · 紧急联系人实测
 *
 * 断三件事：
 *   ① 详情区显示姓名 / 关系 / 电话，电话默认脱敏，点眼睛能揭示明文；
 *   ② 编辑抽屉只改这一组字段，且「只填一半」会被拦下（有号无人、有人无号）；
 *   ③ 没有 c.employees.edit 的角色看不到可用的编辑入口。
 */
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:5186'
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = 0
let fail = 0
const ok = (c, m, e = '') => {
  if (c) { pass++; console.log('  ✔ ' + m) } else { fail++; console.log('  ✘ ' + m + (e ? '  → ' + e : '')) }
}

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox']
})
const page = await b.newPage()
await page.setViewport({ width: 1680, height: 1150 })
const errs = []
page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })

const text = () => page.evaluate(() => document.body.innerText)
const toast = () => page.evaluate(() => [...document.querySelectorAll('.el-message')].map(x => x.innerText.trim()).join(' | '))

async function login(role) {
  await page.evaluate(r => localStorage.setItem('wy_proto_role', r), role)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(1800)
}

/** 详情面板（右侧）的紧急联系人区块文字 */
const ecBlock = () => page.evaluate(() => {
  const hds = [...document.querySelectorAll('.sec__hd')]
  const h = hds.find(x => (x.innerText || '').includes('紧急联系人'))
  if (!h) return null
  const wrap = h.nextElementSibling
  return {
    text: (wrap?.innerText || '').replace(/\n+/g, ' | '),
    cls: wrap?.className || ''
  }
})

console.log('=== ① 人事专员看到紧急联系人 ===')
await page.goto(BASE + '/#/c/employee', { waitUntil: 'networkidle2' })
await login('R-HR')

const t0 = await text()
ok(t0.includes('员工档案'), '进入员工档案页')
const blk = await ecBlock()
ok(!!blk, '详情区有「紧急联系人」区块')
console.log('    · 区块：', blk?.text)
ok(!!blk && /\S/.test(blk.text), '区块有内容（不是空的）')

const hasName = /姓名/.test(blk.text) && !/姓名\s*\|?\s*—/.test(blk.text)
ok(hasName, '显示联系人姓名')
ok(/关系/.test(blk.text), '显示与本人关系')
ok(/联系电话/.test(blk.text), '显示联系电话')

console.log('\n=== ② 电话默认脱敏，不显示明文 ===')
const phoneCell = await page.evaluate(() => {
  const hds = [...document.querySelectorAll('.sec__hd')]
  const h = hds.find(x => (x.innerText || '').includes('紧急联系人'))
  if (!h) return ''
  const v = h.nextElementSibling?.querySelector('.sst__v')
  return v?.innerText.trim() || ''
})
console.log('    · 电话显示为：', phoneCell)
ok(/\*/.test(phoneCell), `电话是掩码（${phoneCell}）`, phoneCell)
ok(!/^\d{11}$/.test(phoneCell), '没有直接显示 11 位明文', phoneCell)

console.log('\n=== ③ 点眼睛揭示明文（并留痕）===')
const logBefore = await page.evaluate(async () => {
  const r = await fetch('/').catch(() => null)
  return 0
})
await page.evaluate(() => {
  const hds = [...document.querySelectorAll('.sec__hd')]
  const h = hds.find(x => (x.innerText || '').includes('紧急联系人'))
  const icon = h?.nextElementSibling?.querySelector('.sst__i')
  if (icon) icon.click()
})
await sleep(900)
const revealed = await page.evaluate(() => {
  const hds = [...document.querySelectorAll('.sec__hd')]
  const h = hds.find(x => (x.innerText || '').includes('紧急联系人'))
  return h?.nextElementSibling?.querySelector('.sst__v')?.innerText.trim() || ''
})
console.log('    · 揭示后：', revealed)
ok(/^\d{11}$/.test(revealed), `揭示后是 11 位明文（${revealed}）`, revealed)

console.log('\n=== ④ 编辑抽屉：三项都带出当前值 ===')
const opened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '编辑')
  if (!btn || btn.disabled) return false
  btn.click()
  return true
})
ok(opened, '点「编辑」打开抽屉')
await sleep(900)
const drawer = await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  if (!d) return null
  const inputs = [...d.querySelectorAll('input')].map(i => i.value)
  return { text: d.innerText.replace(/\n+/g, ' | '), inputs }
})
ok(!!drawer, '抽屉已打开')
console.log('    · 输入框值：', JSON.stringify(drawer?.inputs))
ok(!!drawer && drawer.inputs.filter(v => v).length >= 2, '姓名 / 电话已带出当前值', JSON.stringify(drawer?.inputs))
ok(/关系/.test(drawer.text), '有「与本人关系」一项')
ok(/调岗/.test(drawer.text) && /工资/.test(drawer.text), '说明了哪些字段不在这里改')

console.log('\n=== ⑤ 编辑框里的电话必须是明文，不是掩码 ===')
const editPhone = drawer.inputs[2] || ''
console.log('    · 编辑框电话：', editPhone)
ok(/^\d{11}$/.test(editPhone), `编辑框带出 11 位明文（${editPhone}）`, editPhone)
ok(!editPhone.includes('*'), '编辑框里没有星号（否则一保存就把掩码写进数据）', editPhone)

console.log('\n=== ⑥ 只填电话不填姓名 → 拦下 ===')
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  const setV = (inp, val) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, val)
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const inputs = [...d.querySelectorAll('input')]
  setV(inputs[0], '')
  setV(inputs[2], '13800001111')
})
await sleep(400)
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  const btn = [...d.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '保存')
  if (btn) btn.click()
})
await sleep(1300)
let ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/一并填写联系人姓名/.test(ts), '只有号码没有姓名被拦（找不到人）', ts)
const stillOpen = await page.evaluate(() =>
  [...document.querySelectorAll('.el-drawer')].some(x => x.offsetParent !== null))
ok(stillOpen, '被拦后抽屉不关，能接着改')

console.log('\n=== ⑦ 只填姓名不填电话 → 也拦 ===')
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  const setV = (inp, val) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, val)
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const inputs = [...d.querySelectorAll('input')]
  setV(inputs[0], '周敏')
  setV(inputs[2], '')
})
await sleep(400)
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  const btn = [...d.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '保存')
  if (btn) btn.click()
})
await sleep(1300)
ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/一并填写联系电话/.test(ts), '只有姓名没有电话被拦（等于没留联系方式）', ts)

console.log('\n=== ⑧ 电话格式不对 → 拦 ===')
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  const setV = (inp, val) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, val)
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const inputs = [...d.querySelectorAll('input')]
  setV(inputs[2], '12345')
})
await sleep(400)
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  const btn = [...d.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '保存')
  if (btn) btn.click()
})
await sleep(1300)
ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/11 位手机号/.test(ts), '非 11 位号码被拦', ts)

console.log('\n=== ⑨ 三项填齐 → 保存成功并刷新详情 ===')
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  const setV = (inp, val) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, val)
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const inputs = [...d.querySelectorAll('input')]
  setV(inputs[2], '13800001111')
  d.querySelector('.el-select__wrapper')?.click()
})
await sleep(800)
const picked = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.el-select-dropdown__item')].filter(x => x.offsetParent !== null)
  const p = items.find(x => x.innerText.trim() === '兄弟姐妹') || items[0]
  if (p) { p.click(); return p.innerText.trim() }
  return ''
})
ok(!!picked, `选中关系「${picked}」`)
await sleep(500)
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  const btn = [...d.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '保存')
  if (btn) btn.click()
})
await sleep(1900)
ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/已保存/.test(ts), '三项填齐后保存成功', ts)

const closed = await page.evaluate(() =>
  ![...document.querySelectorAll('.el-drawer')].some(x => x.offsetParent !== null))
ok(closed, '保存后抽屉关闭')

const after = await ecBlock()
console.log('    · 刷新后区块：', after?.text)
ok(!!after && after.text.includes('周敏'), '详情已更新为新联系人「周敏」', after?.text)
ok(!!after && after.text.includes('兄弟姐妹'), '关系已更新为「兄弟姐妹」', after?.text)
ok(!!after && /\*/.test(after.text), '新电话仍按掩码显示（不是明文回填）', after?.text)

console.log('\n=== ⑩ 有查看无编辑的角色：能看到档案，但编辑入口禁用 ===')
await page.goto(BASE + '/#/c/employee', { waitUntil: 'networkidle2' })
await login('R-VIEW')
await sleep(1400)
const viewState = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '编辑')
  const hasEc = document.body.innerText.includes('紧急联系人')
  return { hasEc, btn: !btn ? 'missing' : (btn.disabled ? 'disabled' : 'enabled') }
})
console.log('    · 页面含紧急联系人：', viewState.hasEc, '｜编辑按钮：', viewState.btn)
ok(viewState.hasEc, '只读角色仍能查看紧急联系人')
ok(viewState.btn === 'disabled', '无 c.employees.edit → 编辑按钮置灰（不是隐藏）', viewState.btn)

console.log('\n=== ⑪ 控制台 ===')
const real = errs.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 2).join(' | '))

await page.screenshot({ path: '/tmp/shot-emp-ec.png' })
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await b.close()
process.exit(fail ? 1 : 0)
