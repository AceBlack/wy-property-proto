import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:5186'
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  ✔ ' + m)) : (fail++, console.log('  ✘ ' + m + (extra ? '  → ' + extra : ''))) }

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox']
})
const page = await browser.newPage()
await page.setViewport({ width: 1680, height: 1100 })
const errs = []
page.on('pageerror', e => errs.push(String(e).slice(0, 300)))
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })

let booted = false
async function go(hash, role = 'R-CHG') {
  if (!booted) { await page.goto(BASE + '/', { waitUntil: 'networkidle2' }); booted = true }
  await page.evaluate(r => localStorage.setItem('wy_proto_role', r), role)
  await page.goto(`${BASE}/?t=${Date.now()}#${hash}`, { waitUntil: 'networkidle2' })
  await sleep(1800)
}
const txt = () => page.evaluate(() => document.body.innerText)

/** 同文档改 hash：**不能 reload** —— 内存态（新收款、销账）会随刷新还原 */
async function nav(hash) {
  await page.evaluate(h => { window.location.hash = h }, hash)
  await sleep(1700)
}

/** 分页器上的总条数 */
const totalOf = () => page.evaluate(() => {
  const t = document.querySelector('.el-pagination__total')?.innerText || ''
  const m = t.match(/([\d,]+)/)
  return m ? Number(m[1].replace(/,/g, '')) : -1
})

const readSplits = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.split-row')].map(r => ({
    method: (r.querySelector('.el-select__wrapper')?.innerText || '').trim(),
    amount: Number(r.querySelector('.el-input-number input')?.value || 0)
  }))
  const chk = document.querySelector('.split-check')
  return {
    rows,
    ok: !!chk && chk.classList.contains('is-ok'),
    warn: !!chk && chk.classList.contains('is-warn'),
    text: (chk?.innerText || '').replace(/\n+/g, ' ')
  }
})

const clickBtn = name => page.evaluate(n => {
  const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === n && !x.disabled)
  if (b) { b.click(); return true }
  return false
}, name)

const setAmount = (i, v) => page.evaluate((idx, val) => {
  const row = [...document.querySelectorAll('.split-row')][idx]
  const inp = row?.querySelector('.el-input-number input')
  if (!inp) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, String(val))
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
  inp.blur()
  return true
}, i, v)

/** 给第 i 行的下拉换方式 */
async function pickMethod(i, name) {
  await page.evaluate(idx => {
    const row = [...document.querySelectorAll('.split-row')][idx]
    row?.querySelector('.el-select input')?.click()
  }, i)
  await sleep(600)
  return page.evaluate(n => {
    const pops = [...document.querySelectorAll('.el-select-dropdown')].filter(p => p.getBoundingClientRect().height > 0)
    const pop = pops[pops.length - 1]
    if (!pop) return { picked: false, reason: 'no popper' }
    const items = [...pop.querySelectorAll('.el-select-dropdown__item')]
    const target = items.find(x => x.innerText.trim() === n)
    if (!target) return { picked: false, reason: items.map(x => x.innerText.trim()).join('/') }
    target.click()
    return { picked: true }
  }, name)
}

/* 日结基线只用 UI 读：evaluate 里 import('/src/utils/api.js') 会拿到模块的**另一个实例**，
   看不到页面内存里刚收的钱（第一版就是这么误判"日结没变"的） */
const methodOf = async (name) => page.evaluate(n => {
  const row = [...document.querySelectorAll('.el-table__body tbody tr')]
    .find(x => x.innerText.includes(n))
  if (!row) return { amount: 0, count: 0 }
  const cells = [...row.querySelectorAll('td')].map(td => td.innerText.trim())
  return { count: Number(cells[1]) || 0, amount: Number((cells[2] || '').replace(/[¥,\s]/g, '')) || 0 }
}, name)

const cashOf = async () => page.evaluate(() => {
  const row = [...document.querySelectorAll('.el-table__body tbody tr')]
    .find(x => x.innerText.includes('现金'))
  if (!row) return 0
  /* 金额是 ¥2,584.61 这种带千分位的，先按 ¥ 抓再剥逗号 ——
     直接 replace(/[^0-9.]/g,' ') 会把 "2,584.61" 拆成 2 和 584.61 两个数 */
  const m = row.innerText.match(/¥\s*[\d,]+(?:\.\d+)?/g) || []
  const nums = m.map(x => Number(x.replace(/[¥,\s]/g, ''))).filter(n => Number.isFinite(n))
  return nums.length ? Math.max(...nums) : 0
})
await go('/b/payments', 'R-CHG')
await sleep(900)
const payTotalBase = await totalOf()
await go('/b/daily-close', 'R-CHG')
await sleep(900)
const cashBase = await cashOf()
const wxBase = await methodOf('微信支付')
console.log('     日结基线：现金', cashBase, '｜微信', JSON.stringify(wxBase))

console.log('=== ① 默认状态：单方式 + 金额自动等于实收 ===')
await go('/b/cashier', 'R-CHG')
let t = await txt()
ok(t.includes('支持组合支付'), '页头说明组合支付')
ok(t.includes('最多 3 种'), '写明最多 3 种')

let st = await readSplits()
console.log('     金额行：', JSON.stringify(st.rows), '|', st.text)
ok(st.rows.length === 1, '默认一行', String(st.rows.length))
ok(st.rows[0].method === '微信支付', '默认方式微信支付', st.rows[0].method)
ok(st.rows[0].amount > 0, '默认金额已带出', String(st.rows[0].amount))
ok(st.ok, '默认即可收款', st.text)

const total0 = st.rows[0].amount
const billRowsBefore = await page.evaluate(() => document.querySelectorAll('.el-table__body tbody tr').length)
console.log('     待收账单行数：', billRowsBefore)

console.log('\n=== ② 拆两种方式：合计不对要拦住 ===')
await clickBtn('+ 再加一种方式')
await sleep(700)
st = await readSplits()
ok(st.rows.length === 2, '加到两行', String(st.rows.length))
console.log('     两行：', JSON.stringify(st.rows), '|', st.text)
ok(st.rows.reduce((a, r) => a + r.amount, 0) === total0, '新行自动补齐差额，合计仍等于实收', st.text)
ok(st.ok, '补齐后仍可收款', st.text)

/* 把第二行改成 50 元现金 → 合计少了，应报"还差" */
const r = await pickMethod(1, '现金')
await sleep(600)
ok(r.picked, '第二行可以选现金', r.reason || '')
await setAmount(1, 50)
await sleep(600)
st = await readSplits()
console.log('     改 50 后：', JSON.stringify(st.rows), '|', st.text)
ok(st.warn && /还差/.test(st.text), '合计不足时提示「还差」', st.text)
const payDisabled = await page.evaluate(() =>
  [...document.querySelectorAll('button')].some(b => b.innerText.trim() === '确认收款' && b.disabled))
ok(payDisabled, '不闭合时「确认收款」置灰')

/* 超过实收也要报 */
await setAmount(1, total0 + 10)
await sleep(600)
st = await readSplits()
ok(st.warn && /超出/.test(st.text), '合计超出时提示「超出」', st.text)

/* 调回正确组合：现金 50 + 微信 剩余 */
await setAmount(1, 50)
await sleep(400)
await setAmount(0, Number((total0 - 50).toFixed(2)))
await sleep(700)
st = await readSplits()
console.log('     调整后：', JSON.stringify(st.rows), '|', st.text)
ok(st.ok, '合计对齐后可收款', st.text)

console.log('\n=== ③ 方式不能重复、最多三种 ===')
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.split-row')][1]
  row?.querySelector('.el-select input')?.click()
})
await sleep(600)
const dupInfo = await page.evaluate(() => {
  const pops = [...document.querySelectorAll('.el-select-dropdown')].filter(p => p.getBoundingClientRect().height > 0)
  const pop = pops[pops.length - 1]
  const items = [...pop.querySelectorAll('.el-select-dropdown__item')]
  return items.filter(x => x.classList.contains('is-disabled')).map(x => x.innerText.trim())
})
await page.keyboard.press('Escape')
await sleep(400)
ok(dupInfo.includes('微信支付'), '已用过的方式在下拉里被禁用', dupInfo.join('/'))

await clickBtn('+ 再加一种方式')
await sleep(600)
st = await readSplits()
ok(st.rows.length === 3, '可以加到三行', String(st.rows.length))
const addDisabled = await page.evaluate(() =>
  [...document.querySelectorAll('button')].some(b => b.innerText.includes('再加一种方式') && b.disabled))
ok(addDisabled, '三行后「再加一种」置灰')
/* 点的是「删」这个按钮：.split-row 里 el-input-number 自带两个加减按钮，
   直接 querySelector('button') 会点到「减」，把金额改小 */
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.split-row')][2]
  const btn = [...row.querySelectorAll('button')].find(b => b.innerText.trim() === '删')
  btn?.click()
})
await sleep(600)
st = await readSplits()
ok(st.rows.length === 2, '删掉一行回到两种', String(st.rows.length))

/* 删掉的是一行金额，前两行已被分半 —— 补回「现金 50 + 微信 剩余」 */
await setAmount(1, 50)
await sleep(400)
await setAmount(0, Number((total0 - 50).toFixed(2)))
await sleep(700)
st = await readSplits()
ok(st.ok, '补回金额后可收款', st.text)

console.log('\n=== ④ 收款：写流水 + 销账 ===')

const res = await clickBtn('确认收款')
await sleep(2000)
ok(res, '点了确认收款')
t = await txt()
ok(t.includes('收款成功'), '出现收款成功条')
const done = await page.evaluate(() => {
  const d = document.querySelector('.pay-done')
  return d ? d.innerText.replace(/\n+/g, ' | ') : ''
})
console.log('     结果：', done)
ok(/SK2026\d{4}-\d{3}/.test(done), '带收款批次号', done)
ok(/现金 50/.test(done) && /2,031\.01/.test(done), '结果里列出组合明细（含金额）', done)

const billRowsAfter = await page.evaluate(() => document.querySelectorAll('.el-table__body tbody tr').length)
console.log('     待收账单行数：', billRowsBefore, '→', billRowsAfter)
ok(billRowsAfter < billRowsBefore, '已缴账单从待收列表移除', `${billRowsBefore} → ${billRowsAfter}`)

console.log('\n=== ⑤ 日结：按方式拆开汇总 ===')
await nav('/b/daily-close')
t = await txt()
await sleep(1000)
const cashAfter = await cashOf()
const dailyRows = await page.evaluate(() =>
  [...document.querySelectorAll('.el-table__body tbody tr')].map(x => x.innerText.replace(/\n+/g, ' ')))
console.log('     日结行：', dailyRows.map(x => x.slice(0, 26)))
ok(dailyRows.length >= 2, '日结按方式分行（现金 + 线上各自一行）', String(dailyRows.length))
ok(Math.abs((cashAfter - cashBase) - 50) < 0.5,
  '现金行正好多了本次的 50 元（组合支付没被整笔记到最大方式上）', `${cashBase} → ${cashAfter}`)

const wxAfter = await methodOf('微信支付')
console.log('     微信支付：', JSON.stringify(wxBase), '→', JSON.stringify(wxAfter))
ok(wxAfter.count - wxBase.count === 8, '微信支付笔数 +8（8 笔账单各写一条流水）', `${wxBase.count} → ${wxAfter.count}`)
ok(Math.abs((wxAfter.amount - wxBase.amount) - 1981.01) < 0.5, '微信金额 +1981.01', `${wxBase.amount} → ${wxAfter.amount}`)

console.log('\n=== ⑥ 流水：这笔收款真实落库 ===')
await go('/b/payments', 'R-CHG')
await sleep(900)
/* 不按关键字搜：这个页面没有文本输入框，而且新收款记在 10-21，
   种子里有 10-31 的记录，按时间倒序翻页根本找不到。用总条数差额判断最稳 */
await nav('/b/payments')
const payTotalAfter = await totalOf()
console.log('     流水总数：', payTotalBase, '→', payTotalAfter)
/* 这里**不能**断言 total 变大：流水页按角色数据范围过滤（收银员=本项目），
   而收银台可以收任意项目的业主，本次这笔可能落在范围外。
   「流水真的落库」已由上一步的日结笔数（微信 +8）证明 —— 日结不按范围过滤。 */
ok(payTotalAfter > 0, '流水页可正常打开', String(payTotalAfter))

console.log('\n=== ⑦ 预存抵扣可以和其他方式组合 ===')
await go('/b/cashier', 'R-CHG')
await sleep(600)
/* 找一位「有房屋欠费 + 该房有预存余额」的业主。雷天佑只有车位费（无 houseId），用不了房屋预存 */
await page.evaluate(() => {
  const inp = [...document.querySelectorAll('input')].find(i => (i.placeholder || '').includes('业主 / 租户姓名'))
  if (!inp) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, '范淑珍')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(900)
const picked2 = await page.evaluate(() => {
  /* 模糊搜索会带出同姓的人，必须按全名点 —— 否则选中的人可能没有预存账户 */
  const it = [...document.querySelectorAll('.oitem')].find(x => x.innerText.includes('范淑珍'))
  if (!it) return ''
  it.click()
  return it.querySelector('.oitem__n')?.innerText || ''
})
console.log('     选中业主：', picked2)
ok(!!picked2, '搜到了有预存余额的业主', picked2)
await sleep(1200)

st = await readSplits()
const total2 = st.rows[0].amount
ok(total2 > 0, '该业主有待收账单', String(total2))
t = await txt()
console.log('     预存相关文本：', (t.match(/预存[^\n]*/g) || []).slice(0, 3))
console.log('     右栏业主：', await page.evaluate(() => document.querySelector('.panel__hd .tag')?.innerText))
ok(/预存可用 ¥/.test(t), '页面显示预存可用余额', t.match(/预存可用[^\n]*/)?.[0])

/* 加一行选预存抵扣，应自动填「余额与剩余额度里较小的那个」 */
await clickBtn('+ 再加一种方式')
await sleep(700)
const pickPre = await pickMethod(1, '预存抵扣')
await sleep(700)
ok(pickPre.picked, '可以选到预存抵扣', pickPre.reason || '')
st = await readSplits()
console.log('     两行：', JSON.stringify(st.rows), '|', st.text)
const preAmt = st.rows[1].amount
ok(preAmt > 0, '预存抵扣金额自动填入', String(preAmt))
ok(st.ok, '预存 + 其他方式合计闭合，可以收款', st.text)

const preBase = await (async () => {
  await nav('/b/daily-close')
  const v = await methodOf('预存抵扣')
  await nav('/b/cashier')
  return v
})()
console.log('     日结预存抵扣基线：', JSON.stringify(preBase))

await page.evaluate(() => {
  const it = [...document.querySelectorAll('.oitem')].find(x => x.innerText.includes('范淑珍')) || document.querySelector('.oitem')
  if (it) it.click()
})
await sleep(1200)
await clickBtn('+ 再加一种方式')
await sleep(600)
await pickMethod(1, '预存抵扣')
await sleep(700)
st = await readSplits()
if (!st.ok) {
  /* 兜底：手动把预存行设成一半 */
  await setAmount(1, Number((st.total || total2) / 2) || 1)
  await sleep(300)
  await setAmount(0, Number((total2 - (Number((total2 / 2).toFixed(2)))).toFixed(2)))
  await sleep(600)
}

const preUsed = (await readSplits()).rows[1]?.amount || 0
const done2 = await clickBtn('确认收款')
await sleep(2000)
t = await txt()
ok(done2 && t.includes('收款成功'), '预存抵扣参与的组合收款成功', t.match(/收款成功[^\n]*/)?.[0])
const doneTxt = await page.evaluate(() => document.querySelector('.pay-done')?.innerText.replace(/\n+/g, ' | ') || '')
console.log('     结果：', doneTxt)
ok(/预存抵扣/.test(doneTxt), '结果里列出预存抵扣', doneTxt)

await nav('/b/daily-close')
const preAfter = await methodOf('预存抵扣')
console.log('     日结预存抵扣：', JSON.stringify(preBase), '→', JSON.stringify(preAfter))
ok(Math.abs((preAfter.amount - preBase.amount) - preUsed) < 0.5,
  '预存抵扣金额进了日结（不是记成微信/现金）', `${preBase.amount} → ${preAfter.amount}`)

console.log('\n=== ⑧ 校验边界（数据层） ===')
/* 直接验证几条不可能从界面构造的情况：同方式重复、超三种、金额不符 */
const apiChecks = await page.evaluate(async () => {
  const m = await import('/src/utils/api.js')
  const out = []
  const push = (name, fn) => { try { out.push([name, fn(), '']) } catch (e) { out.push([name, null, e.message]) } }
  push('重复方式', () => m.paySplitCheck([{ method: '现金', amount: 10 }, { method: '现金', amount: 20 }], 30).msg)
  push('超过三种', () => m.paySplitCheck([
    { method: '现金', amount: 10 }, { method: '微信支付', amount: 10 },
    { method: '支付宝', amount: 10 }, { method: 'POS刷卡', amount: 10 }
  ], 40).msg)
  push('金额不符', () => m.paySplitCheck([{ method: '现金', amount: 10 }], 30).msg)
  push('金额为负', () => m.paySplitCheck([{ method: '现金', amount: -5 }], -5).msg)
  return out
})
for (const [name, val, err] of apiChecks) console.log('     ', name, '→', err || val)
ok(apiChecks[0][1] && /两次/.test(apiChecks[0][1]), '重复方式被拦', apiChecks[0][1])
ok(apiChecks[1][1] && /最多 3 种/.test(apiChecks[1][1]), '超过三种被拦', apiChecks[1][1])
ok(apiChecks[2][1] && /还差/.test(apiChecks[2][1]), '金额不符被拦', apiChecks[2][1])

const real = errs.filter(e => !/favicon|ResizeObserver|Download the Vue Devtools/.test(e))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 3).join(' | '))

await go('/b/cashier', 'R-CHG')
await page.screenshot({ path: '/tmp/i62-cashier.png' })

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exit(fail ? 1 : 0)
