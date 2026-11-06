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
await page.setViewport({ width: 1680, height: 1150 })
const errs = []
page.on('pageerror', e => errs.push(String(e).slice(0, 300)))
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })

/**
 * 切角色 + 进路由。两步顺序不能反：
 * 先 goto 目标再切角色 → 没权限时会被重定向到 /error/403，reload 仍停在 403；
 * 用 page.goto 改 hash 又会被应用首屏的重定向抢掉（实测会退回 /shell/list）。
 * 所以：在当前文档里写 localStorage + 改 hash，最后 reload 让应用按新角色重新初始化。
 */
let booted = false
async function go(hash, role) {
  if (!booted) {
    await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
    booted = true
  }
  await page.evaluate(r => localStorage.setItem('wy_proto_role', r), role)
  /* 必须整页重载：只改 hash 的话路由守卫会先用**旧角色**拦一次（403 页里的
     replace 会把 URL 改回 /error/403，reload 就永远回不到目标页）。
     带一个变化的 query 才能触发完整导航。 */
  await page.goto(`${BASE}/?t=${Date.now()}#${hash}`, { waitUntil: 'networkidle2' })
  await sleep(1700)
}
const txt = () => page.evaluate(() => document.body.innerText)

/* 只在指定 tab 面板里找表格 —— .el-tab-pane 用 display 切换，DOM 一直在，
   直接用 [0] 会一直读到第一个页签的表格（第一版就踩了这个） */
const rowsIn = pane => page.evaluate(p => {
  const root = document.querySelector('#pane-' + p)
  if (!root) return []
  return [...root.querySelectorAll('.el-table')][0]
    ? [...root.querySelectorAll('.el-table')[0].querySelectorAll('.el-table__body tbody tr')].map(tr => tr.innerText.replace(/\n+/g, ' | '))
    : []
}, pane)

const clickTab = async name => {
  await page.evaluate(n => {
    const it = [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.includes(n))
    if (it) it.click()
  }, name)
  await sleep(900)
}

/* 抽屉里按 label 取值。**只认可见的抽屉** —— 关闭后的 drawer 仍在 DOM 里，
   不加过滤会读到上一次那个抽屉的框（第一版税号"没带入"就是这么来的） */
const fieldVal = label => page.evaluate(l => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  if (!d) return ''
  const item = [...d.querySelectorAll('.el-form-item')]
    .find(x => (x.querySelector('.el-form-item__label')?.innerText || '').includes(l))
  return item?.querySelector('input')?.value || ''
}, label)

/* 往可见抽屉里按 label 写值。必须按 label：手动模式下第一个 form-item 是
   「抬头类型」单选组，按下标会写到 radio 上（第一版就是这么写错的，
   抬头为空 → 保存被拦 → 抽屉不关 → 后面所有抽屉操作都串到这一个上） */
const setDrawerByLabel = (label, val) => page.evaluate((l, v) => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  if (!d) return false
  const item = [...d.querySelectorAll('.el-form-item')]
    .find(x => (x.querySelector('.el-form-item__label')?.innerText || '').includes(l))
  const el = item?.querySelector('input.el-input__inner') || item?.querySelector('input')
  if (!el) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('blur', { bubbles: true }))
  return true
}, label, val)

const clickDrawerBtn = name => page.evaluate(n => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
  const b = [...(d || document).querySelectorAll('button')].find(x => x.innerText.trim() === n)
  if (b) b.click()
}, name)

/* 打开某个下拉并点选第 n 项（只认可见的那个 popper） */
async function pickSelect(selIndex, itemText = '', nth = 0) {
  await page.evaluate(i => {
    const d = [...document.querySelectorAll('.el-drawer')].find(x => x.offsetParent !== null)
    const sels = d ? d.querySelectorAll('.el-select') : []
    sels[i]?.querySelector('input')?.click()
  }, selIndex)
  await sleep(700)
  return page.evaluate((t, n) => {
    const pops = [...document.querySelectorAll('.el-select-dropdown')].filter(p => p.offsetParent !== null || p.getBoundingClientRect().height > 0)
    const pop = pops[pops.length - 1]
    if (!pop) return null
    const items = [...pop.querySelectorAll('.el-select-dropdown__item')]
    const target = t ? items.find(x => x.innerText.includes(t)) : items[n]
    if (!target) return items.map(x => x.innerText).join('/')
    const label = target.innerText
    target.click()
    return label
  }, itemText, nth)
}

console.log('=== ① 开票信息 ===')
await go('/b/invoice-settings', 'R-CHG')
let t = await txt()
ok(t.includes('开票设置'), '页面标题正确')
ok(t.includes('手填是常态'), '说明条写明「手填是常态」')

const stats = await page.evaluate(() => [...document.querySelectorAll('.rsum')].map(x => x.innerText.replace(/\n+/g, ' ')))
console.log('     ', stats.join(' ｜ '))
ok(stats[0].includes('10'), '抬头档案 10 条', stats[0])
ok(/个人 4/.test(stats[0]) && /企业 6/.test(stats[0]), '个人 4 / 企业 6', stats[0])

let rows = await rowsIn('profiles')
console.log('     第 1 行：', rows[0]?.slice(0, 90))
ok(rows.length === 10, `表格 10 行（实际 ${rows.length}）`)
ok(rows.some(r => r.includes('成都味知香餐饮有限公司') && r.includes('91510102AM1CP3ER5X')), '企业租户带入：名称 + 统一社会信用代码都在')
ok(rows.some(r => r.includes('个人')), '有个人抬头')
ok(rows.some(r => r.includes('默认')), '有一条默认抬头')

/* 筛选企业 */
await page.evaluate(() => {
  document.querySelector('#pane-profiles .toolbar .el-select input').click()
})
await sleep(600)
await page.evaluate(() => {
  const pops = [...document.querySelectorAll('.el-select-dropdown')].filter(p => p.getBoundingClientRect().height > 0)
  const pop = pops[pops.length - 1]
  const it = [...pop.querySelectorAll('.el-select-dropdown__item')].find(x => x.innerText.trim() === '企业')
  if (it) it.click()
})
await sleep(900)
rows = await rowsIn('profiles')
ok(rows.length === 6 && rows.every(r => r.includes('企业')), `按「企业」筛选剩 6 行且都是企业（${rows.length}）`)

/* 清掉筛选 */
await go('/b/invoice-settings', 'R-CHG')

console.log('\n=== ② 从租户带入 ===')
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('新增开票信息'))
  if (b) b.click()
})
await sleep(500)
await page.evaluate(() => {
  const it = [...document.querySelectorAll('.el-dropdown-menu__item')].find(x => x.innerText.includes('从租户信息带入'))
  if (it) it.click()
})
await sleep(900)
t = await txt()
ok(t.includes('带入只'), '抽屉里有「带入只预填」提示')

const picked = await pickSelect(0, '有限公司')
console.log('     选中租户：', picked)
await sleep(1000)
const title = await fieldVal('单位名称') || await fieldVal('姓名')
const taxNo = await fieldVal('纳税人识别号')
console.log('     带入后抬头：', title, '| 税号：', taxNo)
ok(!!title, '抬头被带入', title)
ok(/^[0-9A-Z]{15,20}$/.test(taxNo), '税号被带入', taxNo)
ok((await fieldVal('注册地址')).length > 2, '注册地址被带入', await fieldVal('注册地址'))

/* 保存：这个企业租户在种子里已经建过档，应当被"已存在"拦下 —— 同抬头同税号不该有两条 */
await clickDrawerBtn('保存')
await sleep(1200)
t = await txt()
ok(t.includes('已经存在'), '同一抬头+税号重复建档被拦', t.match(/抬头「[^」]*」[^；\n]*已经存在/)?.[0])

/* 关掉抽屉，改用「手动填写」建一条新档案 */
await clickDrawerBtn('取消')
await sleep(500)
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('新增开票信息'))
  if (b) b.click()
})
await sleep(500)
await page.evaluate(() => {
  const it = [...document.querySelectorAll('.el-dropdown-menu__item')].find(x => x.innerText.includes('手动填写'))
  if (it) it.click()
})
await sleep(700)
await setDrawerByLabel('姓名', '青羊区花市管理服务中心')   // 个人抬头时 label 是「姓名」
await sleep(200)
await clickDrawerBtn('保存')
await sleep(1200)
rows = await rowsIn('profiles')
if (rows.length !== 11) { await clickDrawerBtn('取消'); await sleep(400) }
ok(rows.length === 11, `手动新增后 11 行（实际 ${rows.length}）`, rows.length)
ok(rows.some(r => r.includes('青羊区花市管理服务中心')), '新档案出现在列表')
ok(rows.some(r => r.includes('手动')), '来源标记为「手动」')

console.log('\n=== ③ 费用项目 ===')
await clickTab('费用项目')
const itemHeads = await page.evaluate(() => [...document.querySelectorAll('#pane-items .el-table__header th')].map(x => x.innerText.trim()))
console.log('     表头：', itemHeads.join(' / '))
let items = await rowsIn('items')
console.log('     行：', items.map(r => r.slice(0, 26)).join(' ｜ '))
ok(items.length === 5, `内置 5 项（实际 ${items.length}）`)
ok(items[0]?.includes('摆摊费') && items[0]?.includes('6%'), '摆摊费 6%', items[0]?.slice(0, 30))
ok(items[1]?.includes('场地租用') && items[1]?.includes('9%'), '场地租用 9%', items[1]?.slice(0, 30))
ok(items[2]?.includes('赔偿款') && items[2]?.includes('0%'), '赔偿款 0%', items[2]?.slice(0, 30))
ok(items[3]?.includes('押金') && items[3]?.includes('0%'), '押金 0%', items[3]?.slice(0, 30))
ok(items[4]?.includes('其他'), '其他', items[4]?.slice(0, 30))
t = await txt()
ok(t.includes('0% 不是'), '页面解释了 0% 的原因')

/* 新增项目 */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '新增项目')
  if (b) b.click()
})
await sleep(900)
await setDrawerByLabel('项目名称', '垃圾清运费')
await sleep(500)
const typed = await fieldVal('项目名称')
ok(typed === '垃圾清运费', '抽屉里名称已写入', typed)
await clickDrawerBtn('保存')
await sleep(1400)
t = await txt()
const msg = t.match(/(已新增费用项目|项目名称不能为空|费用项目「[^」]*」已经存在|没有「开票设置」[^\n]*)/)?.[0]
console.log('     保存提示：', msg || '(无)')
items = await rowsIn('items')
ok(items.length === 6, `新增后 6 项（实际 ${items.length}）`, items.map(r => r.slice(0, 10)).join('/'))
ok(items.some(r => r.includes('垃圾清运费')), '新项目出现在列表')

/* 重名拦截 */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '新增项目')
  if (b) b.click()
})
await sleep(600)
await setDrawerByLabel('项目名称', '摆摊费')
await sleep(300)
await clickDrawerBtn('保存')
await sleep(900)
t = await txt()
ok(t.includes('已经存在'), '重名项目被拦', t.match(/费用项目「[^」]*」已经存在/)?.[0])
await clickDrawerBtn('取消')
await sleep(400)

console.log('\n=== ④ 票据模板 ===')
await clickTab('票据模板')
t = await txt()
ok(t.includes('版式参数') && t.includes('打印预览'), '模板页左右两栏')
const paper = await page.evaluate(() => {
  const p = document.querySelector('.tpl-paper')
  if (!p) return null
  const cs = getComputedStyle(p)
  const r = p.getBoundingClientRect()
  return { w: cs.width, h: cs.height, visual: r.width, wmm: p.style.width, hmm: p.style.height, zoom: cs.zoom, font: getComputedStyle(p.querySelector('.pp-inner')).fontSize }
})
console.log('     纸面：', JSON.stringify(paper))
ok(paper && paper.wmm === '241mm' && paper.hmm === '140mm', '默认纸张 241×140mm', JSON.stringify(paper))
ok(paper && paper.zoom !== '1', '预览按比例缩小（zoom）', paper?.zoom)
ok(paper && paper.visual > 300 && paper.visual < 900, '纸面缩放后在视口内（视觉宽度）', `${Math.round(paper?.visual)}px / 布局 ${paper?.w}`)

ok(t.includes('叁佰贰拾元整'), '大写金额正确渲染', t.match(/（大写）：[^\n]*/)?.[0])
ok(t.includes('客户联'), '联次角标显示客户联')

/* 改字号 */
const beforeFont = paper.font
await page.evaluate(() => {
  const item = [...document.querySelectorAll('.tpl-form .el-form-item')].find(x => x.innerText.includes('字体'))
  const inp = item?.querySelector('.el-input-number input')
  if (inp) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '13')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('blur', { bubbles: true }))
  }
})
await sleep(800)
const afterFont = await page.evaluate(() => getComputedStyle(document.querySelector('.tpl-paper .pp-inner')).fontSize)
ok(beforeFont !== afterFont, '改字号后预览字号变化', `${beforeFont} → ${afterFont}`)

/* 组合约束：单值都有 min/max 挡着，真正能出错的是组合（左右边距吃掉内容区）。
   把纸宽压到 100mm、左右边距各 30mm → 内容区只剩 40mm，正好卡在阈值上 */
const setTplNum = (labelText, val) => page.evaluate((l, v) => {
  const item = [...document.querySelectorAll('.tpl-form .el-form-item')].find(x => x.innerText.includes(l))
  const inp = item?.querySelector('.el-input-number input')
  if (!inp) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, String(v))
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('blur', { bubbles: true }))
}, labelText, val)

const setTplNumAt = (labelText, idx, val) => page.evaluate((l, i, v) => {
  const item = [...document.querySelectorAll('.tpl-form .el-form-item')].find(x => x.innerText.includes(l))
  const inp = item ? [...item.querySelectorAll('.el-input-number input')][i] : null
  if (!inp) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, String(v))
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('blur', { bubbles: true }))
}, labelText, idx, val)

await setTplNumAt('宽 × 高', 0, 100)
await sleep(300)
await setTplNumAt('左 / 右', 0, 30)
await sleep(300)
await setTplNumAt('左 / 右', 1, 30)
await sleep(700)
t = await txt()
ok(/内容区宽度不足|参数还有/.test(t), '边距吃掉内容区时给出提示', t.match(/参数还有[^\n]*|内容区宽度不足[^\n]*/)?.[0])

/* 恢复默认 */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '恢复默认')
  if (b) b.click()
})
await sleep(500)
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.el-message-box button')].find(x => x.innerText.includes('确定'))
  if (b) b.click()
})
await sleep(1100)
const restored = await page.evaluate(() => document.querySelector('.tpl-paper').style.width)
ok(restored === '241mm', '恢复默认后纸面尺寸复原', restored)

await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '保存模板')
  if (b) b.click()
})
await sleep(1000)
t = await txt()
ok(t.includes('模板已保存'), '保存模板成功')

/* 换纸张预设 */
await page.evaluate(() => {
  const item = [...document.querySelectorAll('.tpl-form .el-form-item')].find(x => x.innerText.includes('纸张规格'))
  item?.querySelector('input')?.click()
})
await sleep(600)
await page.evaluate(() => {
  const pops = [...document.querySelectorAll('.el-select-dropdown')].filter(p => p.getBoundingClientRect().height > 0)
  const pop = pops[pops.length - 1]
  const it = [...pop.querySelectorAll('.el-select-dropdown__item')].find(x => x.innerText.includes('A4'))
  if (it) it.click()
})
await sleep(900)
const a4 = await page.evaluate(() => {
  const p = document.querySelector('.tpl-paper')
  return { w: p.style.width, h: p.style.height }
})
ok(a4.w === '210mm' && a4.h === '297mm', '切到 A4 预设后纸面跟着变', JSON.stringify(a4))

console.log('\n=== ⑤ 开票页接入 ===')
await go('/b/invoices', 'R-CHG')
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.includes('待开票'))
  if (t) t.click()
})
await sleep(1400)
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.el-table__body button')].find(x => x.innerText.trim() === '开票')
  if (b) b.click()
})
await sleep(1200)
const dlg = await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  return {
    text: (d?.innerText || '').replace(/\n+/g, ' | '),
    labels: d ? [...d.querySelectorAll('.el-form-item__label')].map(x => x.innerText.trim()) : []
  }
})
console.log('     弹窗标签：', dlg.labels.join(' / '))
ok(dlg.labels.includes('开票信息'), '开票弹窗有「开票信息」')
ok(dlg.labels.includes('项目名称'), '开票弹窗有「项目名称」')

/* 项目名称选「摆摊费」 */
await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  const item = [...d.querySelectorAll('.el-form-item')].find(x => x.innerText.includes('项目名称'))
  item?.querySelector('.el-select input')?.click()
})
await sleep(700)
const pickedItem = await page.evaluate(() => {
  const pops = [...document.querySelectorAll('.el-select-dropdown')].filter(p => p.getBoundingClientRect().height > 0)
  const pop = pops[pops.length - 1]
  const it = [...pop.querySelectorAll('.el-select-dropdown__item')].find(x => x.innerText.includes('摆摊费'))
  if (!it) return null
  const label = it.innerText
  it.click()
  return label
})
ok(!!pickedItem, '项目名称可以选到「摆摊费」', String(pickedItem))

await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-dialog')].find(x => x.offsetParent !== null)
  const b = [...d.querySelectorAll('button')].find(x => x.innerText.trim() === '确认开具')
  if (b) b.click()
})
await sleep(1600)
t = await txt()
ok(/已开具 \d+ 张/.test(t), '开票成功', t.match(/已开具[^\n]*/)?.[0])

/* 台账第一行应带购买方与项目名 */
await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.el-tabs__item')]
  const t1 = tabs.find(x => x.innerText.includes('票据台账'))
  if (t1) t1.click()
})
await sleep(1200)
const firstRow = await page.evaluate(() => {
  const tr = document.querySelector('.el-table__body tbody tr')
  return tr ? tr.innerText.replace(/\n+/g, ' | ') : ''
})
console.log('     台账首行：', firstRow.slice(0, 120))
ok(firstRow.includes('摆摊费'), '台账显示这笔的项目名称', firstRow.slice(0, 80))

console.log('\n=== ⑤ 权限边界 ===')
await go('/b/invoice-settings', 'R-CS')
t = await txt()
ok(t.includes('403') || t.includes('无权限') || t.includes('没有访问'), '客服专员被拦到 403', t.slice(0, 60).replace(/\n/g, ' '))
await go('/b/invoice-settings', 'R-GM')
t = await txt()
const urlGM = page.url()
console.log('     R-GM URL：', urlGM, '| 文本前 60：', t.replace(/\n/g, ' ').slice(0, 60))
ok(t.includes('开票信息') && !t.includes('暂无访问权限'), '总经理可访问', urlGM)
const hasAdd = await page.evaluate(() => [...document.querySelectorAll('button')].some(x => x.textContent.includes('新增开票信息')))
ok(hasAdd, '总经理有新增按钮')

const real = errs.filter(e => !/favicon|ResizeObserver|Download the Vue Devtools/.test(e))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 3).join(' | '))

await page.screenshot({ path: '/tmp/inv-tpl.png', fullPage: false })
await go('/b/invoice-settings', 'R-CHG')
await page.screenshot({ path: '/tmp/inv-profiles.png' })
await clickTab('费用项目')
await page.screenshot({ path: '/tmp/inv-items.png' })
await clickTab('票据模板')
await page.screenshot({ path: '/tmp/inv-tpl2.png' })

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exit(fail ? 1 : 0)
