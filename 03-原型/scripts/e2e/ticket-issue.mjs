/**
 * 第 64 批 · 收款后同页开票 + 收据打印
 *
 * 关键口径（断言围绕这几条）：
 *   ① 收据与发票是**两个独立状态**（`receiptStatus` / `invoiceStatus`），不是一个"开没开票"；
 *      只开收据的流水**仍然留在待开票池里**（还差一张发票）；
 *   ② 购买方默认房主，有租户档案时可切，多房合并时不能共用一条档案；
 *   ③ 项目名取这一笔的**实际科目**，不写死「物业服务费」；
 *   ④ 收据打印走「开票设置 → 票据模板」的参数：241×140mm、三联、宋体 10pt；
 *   ⑤ 收据有金额大写（财务凭证的行业习惯）。
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
async function nav(hash) {
  await page.evaluate(h => { window.location.hash = h }, hash)
  await sleep(1600)
}
const clickBtn = name => page.evaluate(n => {
  const btn = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === n && !x.disabled)
  if (btn) btn.click()
  return !!btn
}, name)
/* 两个 tab 各有分页器，直接取第一个会读到台账那份 —— 只认可见面板里的 */
const totalOf = () => page.evaluate(() => {
  const pane = [...document.querySelectorAll('.el-tab-pane')].find(x => x.getBoundingClientRect().height > 0)
  const t = (pane || document).querySelector('.el-pagination__total')?.innerText || ''
  const m = t.match(/([\d,]+)/)
  return m ? Number(m[1].replace(/,/g, '')) : -1
})
const dlgBtn = name => page.evaluate(n => {
  const ds = [...document.querySelectorAll('.el-dialog')].filter(x => x.getBoundingClientRect().height > 0)
  const d = ds[ds.length - 1]
  const btn = [...(d || document).querySelectorAll('button')].find(x => x.innerText.trim() === n)
  if (btn) btn.click()
  return !!btn
}, name)

console.log('=== ① 收款成功后右栏出现开票区 ===')
await go('/b/cashier')
await clickBtn('确认收款')
await sleep(2200)
let t = await txt()
ok(t.includes('收款成功'), '收款成功')
const tk = await page.evaluate(() => {
  const el = document.querySelector('.tk')
  if (!el) return null
  return {
    text: el.innerText.replace(/\n+/g, ' | '),
    checks: [...el.querySelectorAll('.el-checkbox')].map(x => ({
      label: x.innerText.trim(),
      checked: x.classList.contains('is-checked')
    })),
    hasBuyer: !!el.querySelector('.el-select'),
    btn: [...el.querySelectorAll('button')].map(x => x.innerText.trim()).filter(Boolean)
  }
})
console.log('     开票区：', tk?.text?.slice(0, 160))
ok(!!tk, '右栏出现「开具票据」区')
ok(tk.checks.some(c => c.label === '收据' && c.checked), '「收据」默认勾选', JSON.stringify(tk.checks))
ok(tk.checks.some(c => c.label === '发票' && !c.checked), '「发票」默认不勾（先给收据）')
ok(tk.hasBuyer, '有购买方下拉')
ok(tk.btn.some(x => x.includes('开具收据')), '按钮文案是「开具收据」', tk.btn.join('/'))

console.log('\n=== ② 只开收据 ===')
await page.evaluate(() => {
  const el = document.querySelector('.tk')
  const btn = [...el.querySelectorAll('button')].find(x => x.innerText.includes('开具收据'))
  btn?.click()
})
await sleep(1800)
t = await txt()
ok(/已开具 \d+ 张 收据/.test(t), '开出收据', (t.match(/已开具[^\n]*/) || [])[0])
const after = await page.evaluate(() => {
  const el = document.querySelector('.tk')
  return {
    text: el.innerText.replace(/\n+/g, ' | '),
    nos: [...el.querySelectorAll('.mono')].map(x => x.innerText.trim()),
    tags: [...el.querySelectorAll('.el-tag')].map(x => x.innerText.trim())
  }
})
console.log('     结果：', after.text.slice(0, 180))
ok(after.nos.length > 0 && after.nos.every(n => n.startsWith('SJ')), '收据号以 SJ 开头', after.nos.join(','))
ok(after.tags.every(x => x === '收据'), '只出了收据（没有发票标签）', after.tags.join(','))
ok(after.text.includes('打印收据'), '出现「打印收据」入口')

console.log('\n=== ③ 收据打印预览 ===')
await page.evaluate(() => {
  const el = document.querySelector('.tk')
  const btn = [...el.querySelectorAll('button')].find(x => x.innerText.trim() === '打印收据')
  btn?.click()
})
await sleep(1400)
const pv = await page.evaluate(() => {
  const ds = [...document.querySelectorAll('.el-dialog')].filter(x => x.getBoundingClientRect().height > 0)
  const d = ds[ds.length - 1]
  if (!d) return null
  const papers = [...d.querySelectorAll('.rp-paper')]
  const first = papers[0]
  const inner = first?.querySelector('.rp-inner')
  return {
    title: d.querySelector('.el-dialog__title')?.innerText,
    copies: papers.length,
    paperW: first ? first.style.width : '',
    paperH: first ? first.style.height : '',
    font: inner ? getComputedStyle(inner).fontSize : '',
    text: first ? first.innerText.replace(/\n+/g, ' | ') : '',
    copyLabels: [...d.querySelectorAll('.rp-copy')].map(x => x.innerText.trim())
  }
})
console.log('     预览：', pv?.text?.slice(0, 200))
ok(!!pv, '打印预览打开', pv?.title)
ok(pv.paperW === '241mm' && pv.paperH === '140mm', '纸张 241×140mm（针打连续纸）', `${pv.paperW} × ${pv.paperH}`)
ok(pv.copies === 3, '三联（存根 / 客户 / 财务）', String(pv.copies))
ok(pv.copyLabels.join('/') === '存根联/客户联/财务联', '联次名正确', pv.copyLabels.join('/'))
ok(/收 款 收 据/.test(pv.text), '标题是「收 款 收 据」', pv.text.slice(0, 40))
ok(/合计人民币（大写）：/.test(pv.text), '有大写金额一栏')
ok(/[壹贰叁肆伍陆柒捌玖拾佰仟]/.test(pv.text), '大写金额是真中文数字', (pv.text.match(/（大写）：[^|]*/) || [])[0])
ok(/收款方式：/.test(pv.text), '收据上写了收款方式（可追溯怎么收的）', (pv.text.match(/收款方式：[^|]*/) || [])[0])
ok(/SJ\d+/.test(pv.text), '收据上有票据号')

/* 打印按钮存在（不真的调 window.print，headless 下会挂起） */
const hasPrintBtn = await page.evaluate(() => {
  const ds = [...document.querySelectorAll('.el-dialog')].filter(x => x.getBoundingClientRect().height > 0)
  const d = ds[ds.length - 1]
  return [...(d || document).querySelectorAll('button')].some(x => x.innerText.includes('打印（3 联）'))
})
ok(hasPrintBtn, '打印按钮写明联数')
await dlgBtn('关闭')
await sleep(600)

console.log('\n=== ④ 双状态：只开收据后发票仍是未开 ===')
const st1 = await page.evaluate(() => {
  const sm = window.__protoApi || null
  return sm
})
/* 页面上看不到状态字段，走流水页的「未开票」视图验证：只开收据的流水还在待开票池 */
await nav('/b/invoices')
await sleep(1200)
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.includes('待开票'))
  tab?.click()
})
await sleep(1300)
const pendTotal = await totalOf()
console.log('     待开票池总数：', pendTotal)
ok(pendTotal > 0, '只开了收据的流水仍在待开票池（还差发票）', String(pendTotal))

console.log('\n=== ⑤ 补开发票：两个状态都齐 ===')
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.el-table__body button')].find(x => x.innerText.trim() === '开票')
  btn?.click()
})
await sleep(1400)
const dlg2 = await page.evaluate(() => {
  const ds = [...document.querySelectorAll('.el-dialog')].filter(x => x.getBoundingClientRect().height > 0)
  const d = ds[ds.length - 1]
  if (!d) return null
  return {
    labels: [...d.querySelectorAll('.el-form-item__label')].map(x => x.innerText.trim()),
    itemValue: d.querySelector('.el-form-item:nth-child(5) .el-select__selected-item')?.innerText || '',
    profiles: [...d.querySelectorAll('.el-select-dropdown__item')].map(x => x.innerText)
  }
})
console.log('     弹窗标签：', dlg2?.labels?.join(' / '))
ok(dlg2.labels.includes('开票信息') || dlg2.labels.includes('发票抬头'), '弹窗有抬头字段', dlg2?.labels?.join('/'))
ok(dlg2.labels.includes('项目名称'), '弹窗有项目名称')
await dlgBtn('确认开具')
await sleep(1600)
t = await txt()
ok(/已开具 \d+ 张/.test(t), '补开发票成功', (t.match(/已开具[^\n]*/) || [])[0])

/* 再回待开票池：刚开过发票的那笔应该消失 */
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.includes('待开票'))
  tab?.click()
})
await sleep(1300)
const pendTotal2 = await totalOf()
ok(pendTotal2 < pendTotal, '开完发票后从待开票池移出', `${pendTotal} → ${pendTotal2}`)

console.log('\n=== ⑥ 临时收费开票：项目名取实际科目 ===')
/* 种子里的外部单**全部是「已收款」**，而业主/租户单都有 houseId（开票走档案下拉），
   所以这一条分支只能现场建单：在收银台用「临时收费」收一笔，才有"没有房屋的流水" */
await nav('/b/cashier')
await sleep(900)
await clickBtn('临时收费')
await sleep(1000)
await page.evaluate(() => {
  const ds = [...document.querySelectorAll('.el-dialog')].filter(x => x.getBoundingClientRect().height > 0)
  const d = ds[ds.length - 1]
  const items = [...d.querySelectorAll('.el-form-item')]
  const find = l => items.find(x => (x.querySelector('.el-form-item__label') || {}).innerText.includes(l))
  const setV = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('blur', { bubbles: true }))
  }
  setV(find('单位 / 个人').querySelector('input'), '开票测试摊主')
  setV(find('应收金额').querySelector('.el-input-number input'), '188')
})
await sleep(700)
await dlgBtn('确认收款')
await sleep(1800)
t = await txt()
ok(/已收 ¥188/.test(t), '临时收费收款成功', (t.match(/已收[^\n]*/) || [])[0])

await nav('/b/invoices')
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.includes('待开票'))
  tab?.click()
})
await sleep(1300)
const tempRow = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tbody tr')].find(x => x.innerText.includes('临时收费'))
  if (!tr) return null
  const btn = [...tr.querySelectorAll('button')].find(x => x.innerText.trim() === '开票')
  btn?.click()
  return tr.innerText.replace(/\n+/g, ' | ')
})
ok(!!tempRow, '临时收费的流水出现在待开票池', String(tempRow).slice(0, 90))
await sleep(1400)
const tDlg = await page.evaluate(() => {
  const ds = [...document.querySelectorAll('.el-dialog')].filter(x => x.getBoundingClientRect().height > 0)
  const d = ds[ds.length - 1]
  if (!d) return null
  const items = [...d.querySelectorAll('.el-form-item')]
  const byLabel = l => items.find(x => (x.querySelector('.el-form-item__label') || {}).innerText.includes(l))
  const buyer = byLabel('发票抬头') || byLabel('开票信息')
  const item = byLabel('项目名称')
  return {
    hasBuyerInput: !!buyer?.querySelector('input'),
    buyerVal: buyer?.querySelector('input')?.value || '',
    /* 不取 .el-select__selected-item：不同版本层级不一样，直接读整个 form-item 的文本更稳 */
    itemDisplay: (item?.innerText || '').replace(/\n+/g, ' '),
    labels: items.map(x => (x.querySelector('.el-form-item__label') || {}).innerText)
  }
})
console.log('     临时收费开票弹窗：', JSON.stringify(tDlg))
ok(!!tDlg && tDlg.hasBuyerInput, '临时收费改用手填抬头（没有房屋就没有档案）')
ok(!!tDlg && tDlg.buyerVal.length > 0, '抬头默认填了付款方名称', tDlg?.buyerVal)
ok(!!tDlg && /摆摊费|场地租用|赔偿款|押金|其他/.test(tDlg.itemDisplay) && !/物业服务费/.test(tDlg.itemDisplay),
  '项目名取实际科目，不是「物业服务费」', tDlg?.itemDisplay)

await dlgBtn('确认开具')
await sleep(1600)
t = await txt()
ok(/已开具 \d+ 张/.test(t), '临时收费开出票据', (t.match(/已开具[^\n]*/) || [])[0])

console.log('\n=== ⑦ 都开：收据 + 发票一次出两张 ===')
await nav('/b/cashier')
await sleep(900)
/* 上一个业主的账单已经收完（收款后 sel 被清空），换一位还有欠费的业主。
   同文档切回不会重新挂载组件，所以要挨个点左栏的人，直到「确认收款」可用 */
let payable = false
for (let i = 0; i < 6 && !payable; i++) {
  await page.evaluate(idx => {
    const items = [...document.querySelectorAll('.oitem')]
    items[idx]?.click()
  }, i)
  await sleep(1100)
  payable = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '确认收款')
    return !!btn && !btn.disabled
  })
}
ok(payable, '找到另一位有欠费的业主', String(payable))
await clickBtn('确认收款')
await sleep(2200)
const hasTk = await page.evaluate(() => {
  const el = document.querySelector('.tk')
  if (!el) return false
  const inv = [...el.querySelectorAll('.el-checkbox')].find(x => x.innerText.trim() === '发票')
  inv?.querySelector('input')?.click()
  return true
})
ok(hasTk, '第二次收款后仍出现开票区')
await sleep(500)
const btnText = await page.evaluate(() => {
  const el = document.querySelector('.tk')
  return [...el.querySelectorAll('button')].map(x => x.innerText.trim()).filter(Boolean)
})
console.log('     按钮：', btnText.join('/'))
ok(btnText.some(x => x.includes('收据 + 发票')), '勾两项后按钮变「开具收据 + 发票」', btnText.join('/'))
await page.evaluate(() => {
  const el = document.querySelector('.tk')
  const btn = [...el.querySelectorAll('button')].find(x => x.innerText.includes('收据 + 发票'))
  btn?.click()
})
await sleep(1800)
const both = await page.evaluate(() => {
  const el = document.querySelector('.tk')
  return {
    tags: [...el.querySelectorAll('.el-tag')].map(x => x.innerText.trim()),
    nos: [...el.querySelectorAll('.mono')].map(x => x.innerText.trim()),
    text: el.innerText.replace(/\n+/g, ' | ')
  }
})
console.log('     结果：', both.text.slice(0, 200))
ok(both.tags.filter(x => x === '收据').length > 0 && both.tags.filter(x => x === '发票').length > 0,
  '收据与发票都出了', both.tags.join(','))
ok(both.nos.some(n => n.startsWith('SJ')) && both.nos.some(n => n.startsWith('0264')),
  '两类票据号都在（SJ / 0264）', both.nos.slice(0, 4).join(','))

console.log('\n=== ⑧ 大写金额 ===')
const words = await page.evaluate(async () => {
  const m = await import('/src/utils/api.js')
  return [1201, 1005.5, 0.5, 100000, 20.05, 3000000.07].map(n => [n, m.amountInWords(n)])
})
console.log('     ', JSON.stringify(words))
ok(words[0][1] === '壹仟贰佰零壹元整', '1201 → 壹仟贰佰零壹元整', words[0][1])
/* 规范：「元位是 0、角位不是 0」时可以写零也可以不写零 —— 两种都合规 */
ok(['伍角整', '零元伍角整'].includes(words[2][1]), '0.5 → 伍角整（元位零可省）', words[2][1])
ok(words[3][1] === '壹拾万元整', '100000 → 壹拾万元整', words[3][1])
ok(/分$/.test(words[4][1]), '20.05 到「分」', words[4][1])

const real = errs.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 3).join(' | '))

await page.screenshot({ path: '/tmp/ticket-cashier.png' })
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await b.close()
process.exit(fail ? 1 : 0)
