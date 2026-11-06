/**
 * 第 66 批 · 通讯录
 *
 * 关键口径（断言围绕这几条）：
 *   ① 只取在职（含试用，排除离职）；
 *   ② 手机号**不脱敏** —— 同事之间看全号，这与员工档案的"揭示留痕"相反；
 *   ③ 字段白名单：姓名/岗位/部门/手机/性别，薪资证件银行卡紧急联系人**数据层就不给**；
 *   ④ 独立权限位 `c.contacts.view`，所有角色默认都有。
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
async function go(hash, role = 'R-CHG') {
  if (!booted) { await page.goto(BASE + '/', { waitUntil: 'networkidle2' }); booted = true }
  await page.evaluate(r => localStorage.setItem('wy_proto_role', r), role)
  await page.goto(`${BASE}/?t=${Date.now()}#${hash}`, { waitUntil: 'networkidle2' })
  await sleep(1800)
}

console.log('=== ① 页面加载：部门树 + 卡片墙 ===')
await go('/c/contacts')
let t = await txt()
ok(t.includes('通讯录'), '页面打开')
ok(t.includes('不脱敏'), '说明了号码不脱敏')
ok(t.includes('只显示在职'), '说明了只显示在职')

const stats = await page.evaluate(() =>
  [...document.querySelectorAll('.ct-stat')].map(x => x.innerText.replace(/\n+/g, ' | ')))
console.log('     统计：', stats)
ok(stats[0] && stats[0].includes('118'), '在职 118 人（120 − 2 离职）', stats[0])

const treeNodes = await page.evaluate(() =>
  [...document.querySelectorAll('.ct-tree .el-tree-node__label, .ct-tree .ct-node__n')].map(x => x.innerText.trim()))
console.log('     部门树（前 8）：', treeNodes.slice(0, 8))
/* 树只列出有人的节点（集团 / 总部 / 财务 / 3 个项目 / 客服组 = 7 个），0 人班组不铺 */
ok(treeNodes.length >= 5 && treeNodes.length <= 12, '部门树只列出有人的节点', String(treeNodes.length))

const cards = await page.evaluate(() => [...document.querySelectorAll('.ct-card')].map(x => ({
  text: x.innerText.replace(/\n+/g, ' | '),
  phone: x.querySelector('.mono')?.innerText.trim() || '',
  hasCall: !!x.querySelector('.ct-call')
})))
console.log('     首张卡片：', cards[0]?.text)
console.log('     卡片数（首屏渲染）：', cards.length)
ok(cards.length > 0, '卡片墙渲染出人')
ok(/^\d{11}$/.test(cards[0].phone), '手机号是**明文 11 位**（不脱敏）', cards[0].phone)
ok(cards[0].hasCall, '有「拨打」链接')

console.log('\n=== ② 离职员工不出现 ===')
const bodyAll = await txt()
ok(!bodyAll.includes('万军'), '离职的「万军」不在列表里')
ok(!bodyAll.includes('邹坤'), '离职的「邹坤」不在列表里')

console.log('\n=== ③ 敏感字段一概不出 ===')
/* 只查卡片区：页面说明条里会主动写「不含薪资、证件、银行卡、紧急联系人」，
   那是解释"这里没有"，不能当成泄漏的证据（第一版就误判了） */
const cardText = await page.evaluate(() =>
  [...document.querySelectorAll('.ct-card')].map(x => x.innerText).join(' '))
for (const word of ['月薪', '基本工资', '银行卡', '身份证', '紧急联系', '合同']) {
  ok(!cardText.includes(word), `卡片上没有「${word}」`)
}

/* 数据层白名单：返回的行只有 6 个字段 */
const fields = await page.evaluate(async () => {
  const m = await import('/src/utils/api.js')
  const res = await m.queryContacts({})
  return { keys: Object.keys(res.rows[0] || {}).sort(), total: res.total, fields: m.CONTACT_FIELDS }
})
console.log('     行字段：', fields.keys.join(','))
ok(fields.keys.join(',') === 'empId,gender,name,orgId,orgName,phone,position'.split(',').sort().join(','),
  '只回 6 个白名单字段（+ orgName 派生）', fields.keys.join(','))
ok(!fields.keys.includes('baseSalary') && !fields.keys.includes('idCard'), '薪资与证件不在返回里')
ok(fields.total === 118, '数据层也是 118 人', String(fields.total))

console.log('\n=== ④ 搜索：姓名 / 手机后 4 位 / 岗位 ===')
const searchInput = async v => {
  await page.evaluate(val => {
    const inp = [...document.querySelectorAll('input')].find(i => (i.placeholder || '').includes('姓名 / 岗位'))
    if (!inp) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, val)
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  }, v)
  await sleep(900)
  return page.evaluate(() => ({
    n: Number((document.querySelector('.ct-bar__n')?.innerText || '').replace(/\D/g, '')) || 0,
    scope: document.querySelector('.ct-bar__scope')?.innerText || '',
    cards: [...document.querySelectorAll('.ct-card')].map(x => x.innerText.replace(/\n+/g, ' | '))
  }))
}

const byName = await searchInput('雷志强')
console.log('     搜「雷志强」：', byName.n, byName.cards[0])
ok(byName.n >= 1 && byName.n <= 3, '按姓名搜到人', String(byName.n))
ok(byName.cards.some(c => c.includes('雷志强')), '结果里有这个人')

const tail = cards[0].phone.slice(-4)
const byTail = await searchInput(tail)
console.log(`     搜手机后 4 位「${tail}」：`, byTail.n, byTail.cards[0])
ok(byTail.n >= 1, '按手机后 4 位能搜到', String(byTail.n))
ok(byTail.cards.some(c => c.includes(tail)), '结果里号码含这个尾号', byTail.cards[0])

const byPos = await searchInput('客服')
ok(byPos.n > 0, '按岗位能搜到', String(byPos.n))
const none = await searchInput('不存在的名字zzz')
ok(none.n === 0, '搜不到时给 0', String(none.n))
const emptyText = await page.evaluate(() => document.body.innerText.includes('没有找到匹配的同事'))
ok(emptyText, '空结果有空状态提示')

await searchInput('')

console.log('\n=== ⑤ 部门树筛选 ===')
const deptPick = await page.evaluate(() => {
  const node = [...document.querySelectorAll('.ct-tree .el-tree-node__content')]
    .find(x => x.innerText.includes('财务管理部'))
  if (!node) return null
  const label = node.innerText.replace(/\n+/g, ' ')
  node.click()
  return label
})
await sleep(1100)
const afterPick = await page.evaluate(() => ({
  n: Number((document.querySelector('.ct-bar__n')?.innerText || '').replace(/\D/g, '')) || 0,
  scope: document.querySelector('.ct-bar__scope')?.innerText || '',
  cards: [...document.querySelectorAll('.ct-card')].map(x => x.innerText.replace(/\n+/g, ' | '))
}))
console.log('     点部门：', deptPick, '→', afterPick.n, '|', afterPick.scope)
ok(!!deptPick, '点到「财务管理部」')
ok(afterPick.n > 0 && afterPick.n < 118, '筛选后人数减少', String(afterPick.n))
ok(afterPick.cards.every(c => c.includes('财务管理部')), '结果都属这个部门')

await page.evaluate(() => {
  const all = document.querySelector('.ct-tree__all')
  all?.click()
})
await sleep(1000)
const afterAll = await page.evaluate(() =>
  Number((document.querySelector('.ct-bar__n')?.innerText || '').replace(/\D/g, '')) || 0)
ok(afterAll === 118, '点「全部同事」回到 118', String(afterAll))

console.log('\n=== ⑥ 复制 ===')
const copied = await page.evaluate(async () => {
  const card = document.querySelector('.ct-card')
  const btn = [...card.querySelectorAll('button')].find(x => x.innerText.trim() === '复制')
  if (!btn) return null
  const phone = card.querySelector('.mono').innerText.trim()
  btn.click()
  await new Promise(r => setTimeout(r, 600))
  const msg = [...document.querySelectorAll('.el-message')].map(x => x.innerText).join(' / ')
  return { phone, msg }
})
console.log('     复制：', JSON.stringify(copied))
ok(!!copied && /已复制/.test(copied.msg), '点复制有反馈', copied?.msg)
ok(!!copied && copied.msg.includes(copied.phone.slice(-4)), '反馈里带号码尾号')

console.log('\n=== ⑦ 权限：所有角色都能进 ===')
for (const role of ['R-VIEW', 'R-PM', 'R-FIN', 'R-GM']) {
  await go('/c/contacts', role)
  const r = await page.evaluate(() => ({
    url: location.hash,
    n: Number((document.querySelector('.ct-bar__n')?.innerText || '').replace(/\D/g, '')) || 0
  }))
  ok(r.n > 0, `${role} 能看通讯录`, `${r.url} · ${r.n} 人`)
}

const real = errs.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 3).join(' | '))

await go('/c/contacts')
await page.screenshot({ path: '/tmp/contacts.png' })
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await b.close()
process.exit(fail ? 1 : 0)
