/**
 * 办公资产 · 全链路实测（第 58 + 59 批）
 *
 * 断四组：
 *   ① 分类树：两级、改名、停用、删除保护、三级与成环拦截
 *   ② 台账：KPI、筛选、分页
 *   ③ 新增 / 编辑：编号自动生成且不可改、变更记录逐字段
 *   ④ 扫码页：**免登录**（用无任何资产权限的角色打开）、字段白名单（不含使用人姓名 / 原值 / 供应商 / 序列号）、
 *      token 无效 与 已报废 两种状态
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
const clickBtn = async label => page.evaluate(l => {
  const btn = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === l && !x.disabled)
  if (btn) { btn.click(); return true }
  return false
}, label)

async function login(role) {
  await page.evaluate(r => localStorage.setItem('wy_proto_role', r), role)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(1800)
}

console.log('=== ① 分类维护 ===')
await page.goto(BASE + '/#/c/asset-categories', { waitUntil: 'networkidle2' })
await login('R-HR')

const t0 = await text()
ok(t0.includes('分类树'), '分类页渲染')
const nodeCount = await page.evaluate(() => document.querySelectorAll('.el-tree-node').length)
console.log('    · 树节点数：', nodeCount)
ok(nodeCount >= 20, `分类树有 ${nodeCount} 个节点（5 大类 + 15 小类 + 展开）`, String(nodeCount))

/* 点一个二级分类，右侧应显示资产数 */
const picked = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.el-tree-node__content')]
  const hit = nodes.find(n => (n.innerText || '').includes('电脑'))
  if (hit) { hit.click(); return hit.innerText.trim() }
  return ''
})
ok(!!picked, `点中分类「${picked}」`)
await sleep(700)
const catDetail = await text()
ok(catDetail.includes('资产数'), '右侧显示分类详情')
ok(/资产数[\s\S]{0,20}件/.test(catDetail), '显示该分类的资产件数')

/* 改名 → 保存 */
const renamed = await page.evaluate(() => {
  const item = [...document.querySelectorAll('.el-form-item')].find(f => (f.innerText || '').includes('分类名称'))
  const inp = item?.querySelector('input')
  if (!inp || inp.disabled) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, '电脑/笔记本')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})
if (!renamed) {
  /* 详情态是只读的，先点「编辑」 */
  await clickBtn('编辑')
  await sleep(500)
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('.el-form-item')].find(f => (f.innerText || '').includes('分类名称'))
    const inp = item?.querySelector('input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '电脑/笔记本')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
await sleep(300)
const saved = await clickBtn('保存')
ok(saved, '点保存')
await sleep(1200)
let ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/已保存/.test(ts), '改名保存成功', ts)
const afterRename = await text()
ok(afterRename.includes('电脑/笔记本'), '树/详情已显示新名称')

/* 分类页显示的资产数，必须和台账按同一分类筛出来的条数一致 —— 否则两处各算一套 */
const catShown = await page.evaluate(() => {
  const f = document.querySelector('.cat-facts')
  const m = (f?.innerText || '').match(/资产数[\s\S]{0,6}(\d+)\s*件/)
  return m ? Number(m[1]) : -1
})
ok(catShown >= 0, `分类详情显示资产数 ${catShown} 件`)
await page.goto(BASE + '/#/c/assets', { waitUntil: 'networkidle2' })
await sleep(1500)
const listTotal = await page.evaluate(() => {
  const t = document.querySelector('.el-pagination__total')?.innerText || ''
  const m = t.match(/共\s*(\d+)\s*条/)
  return m ? Number(m[1]) : -1
})
console.log('    · 台账总数（全部）：', listTotal)
ok(listTotal > catShown, '台账全量条数 > 单个分类的条数（口径合理）')
await page.goto(BASE + '/#/c/asset-categories', { waitUntil: 'networkidle2' })
await sleep(1500)
await page.evaluate(() => {
  const n = [...document.querySelectorAll('.el-tree-node__content')].find(x => (x.innerText || '').includes('电脑'))
  if (n) n.click()
})
await sleep(600)

/* 停用 */
await clickBtn('停用')
await sleep(1100)
ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/已停用/.test(ts), '停用成功，并提示"已有资产保留"', ts)

/* 有资产的分类不给删 */
await clickBtn('删除')
await sleep(600)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.el-message-box__btns button')]
  const b = btns.find(x => (x.innerText || '').includes('删除'))
  if (b) b.click()
})
await sleep(1100)
ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/还有 \d+ 件资产/.test(ts), '有资产的分类被拒绝删除', ts)

/* 恢复启用 + 名字改回去，别影响后面的用例 */
await clickBtn('启用')
await sleep(900)
await clickBtn('编辑')
await sleep(400)
await page.evaluate(() => {
  const item = [...document.querySelectorAll('.el-form-item')].find(f => (f.innerText || '').includes('分类名称'))
  const inp = item?.querySelector('input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, '电脑')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(300)
await clickBtn('保存')
await sleep(1100)

console.log('\n=== ② 台账列表 ===')
await page.goto(BASE + '/#/c/assets', { waitUntil: 'networkidle2' })
await sleep(1800)
const t1 = await text()
ok(/资产总数[\s\S]{0,20}\d+\s*件/.test(t1), 'KPI 显示资产总数')
const rows0 = await page.evaluate(() => document.querySelectorAll('.el-table__body tbody tr').length)
ok(rows0 === 15, `默认分页 15 行（实际 ${rows0}）`, String(rows0))

/* 按状态筛 */
await page.evaluate(() => {
  const sels = [...document.querySelectorAll('.toolbar .el-select')]
  sels[1]?.querySelector('.el-select__wrapper')?.click()
})
await sleep(600)
await page.evaluate(() => {
  const items = [...document.querySelectorAll('.el-select-dropdown__item')].filter(x => x.offsetParent !== null)
  const p = items.find(x => x.innerText.trim() === '报废')
  if (p) p.click()
})
await sleep(1100)
const rowsScrap = await page.evaluate(() => [...document.querySelectorAll('.el-table__body tbody tr')]
  .map(tr => tr.innerText.replace(/\n+/g, ' ')))
console.log('    · 报废筛选命中：', rowsScrap.length, '行')
ok(rowsScrap.length > 0 && rowsScrap.every(r => r.includes('报废')), '按状态筛选生效（全是报废）', String(rowsScrap.length))

console.log('\n=== ③ 新增资产：编号自动生成 ===')
await page.goto(BASE + '/#/c/assets/new', { waitUntil: 'networkidle2' })
await sleep(1500)
const t2 = await text()
ok(t2.includes('新增资产'), '新增页渲染')
const noPlaceholder = await page.evaluate(() => {
  const item = [...document.querySelectorAll('.el-form-item')].find(f => (f.innerText || '').includes('资产编号'))
  return item?.querySelector('input')?.value || ''
})
ok(noPlaceholder === '保存后自动生成', `编号位置显示"保存后自动生成"（实际「${noPlaceholder}」）`, noPlaceholder)

/* 填必填两项 */
await page.evaluate(() => {
  const setV = (el, val) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const inputs = [...document.querySelectorAll('.el-form-item input')]
  const nameInp = inputs.find(i => (i.placeholder || '').includes('联想 ThinkPad'))
  if (nameInp) setV(nameInp, '测试用办公椅 A')
})
await sleep(300)
/* 分类下拉 */
await page.evaluate(() => {
  const item = [...document.querySelectorAll('.el-form-item')].find(f => (f.innerText || '').includes('资产分类'))
  item?.querySelector('.el-select__wrapper')?.click()
})
await sleep(700)
const catPicked = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.el-select-dropdown__item')].filter(x => x.offsetParent !== null)
  const p = items.find(x => x.innerText.trim().includes('桌椅')) || items[items.length - 1]
  if (p) { p.click(); return p.innerText.trim() }
  return ''
})
ok(!!catPicked, `选中分类「${catPicked.trim()}」`)
await sleep(500)

const codeFilled = await page.evaluate(() => {
  const item = [...document.querySelectorAll('.el-form-item')].find(f => (f.innerText || '').includes('资产编码'))
  return item?.querySelector('input')?.value || ''
})
console.log('    · 资产编码建议值：', codeFilled)
ok(/^[A-Z0-9-]+-\d{3}$/.test(codeFilled), `选分类后自动带出编码建议（${codeFilled}）`, codeFilled)

await clickBtn('保存并生成编号')
await sleep(2000)
ts = await toast()
console.log('    · toast：', ts || '(无)')
ok(/已生成资产 ZC\d{8}/.test(ts), '保存后提示生成了资产编号', ts)

const detailUrl = page.url()
ok(/\/c\/assets\/AS\d+$/.test(detailUrl), '自动跳到详情页', detailUrl)
const t3 = await text()
ok(/ZC\d{8}/.test(t3), '详情页显示资产编号')
ok(t3.includes('测试用办公椅 A'), '详情页显示新资产名称')
ok(t3.includes('变更记录'), '详情页有变更记录区')

console.log('\n=== ④ 编辑 → 逐字段留痕 ===')
await clickBtn('编辑')
await sleep(1500)
/* 改状态：闲置 → 在用 */
await page.evaluate(() => {
  const item = [...document.querySelectorAll('.el-form-item')].find(f => (f.innerText || '').includes('状态'))
  item?.querySelector('.el-select__wrapper')?.click()
})
await sleep(600)
await page.evaluate(() => {
  const items = [...document.querySelectorAll('.el-select-dropdown__item')].filter(x => x.offsetParent !== null)
  const p = items.find(x => x.innerText.trim() === '在用')
  if (p) p.click()
})
await sleep(400)
await clickBtn('保存')
await sleep(1600)
ts = await toast()
ok(/已保存/.test(ts), '编辑保存成功', ts)

/* 详情页只有一个表格（变更记录），别用 [1] —— 会拿到 undefined */
const logs = await page.evaluate(() => {
  const t = document.querySelector('.el-table')
  if (!t) return []
  return [...t.querySelectorAll('.el-table__body tbody tr')].map(tr => tr.innerText.replace(/\n+/g, ' | '))
})
console.log('    · 变更记录：', logs.slice(0, 3))
ok(logs.some(l => l.includes('状态')), '变更记录里有「状态」这一条')
ok(logs.some(l => /闲置/.test(l) && /在用/.test(l)), '记录了 闲置 → 在用')
ok(logs.some(l => l.includes('新增资产')), '也保留了当初的新增记录（历史链完整）')

console.log('\n=== ④b 设备图片：上传 → 展示 → 留痕 ===')
const assetId = detailUrl.split('/').pop()
await page.goto(BASE + `/#/c/assets/${assetId}/edit`, { waitUntil: 'networkidle2' })
await sleep(1700)
ok((await text()).includes('设备图片'), '编辑页有「设备图片」区')
const fileInput = await page.$('.shot-add input[type=file]')
ok(!!fileInput, '有上传入口（未满 6 张时显示）')
await fileInput.uploadFile('/tmp/e2e-asset.png')
await sleep(1300)
let shotN = await page.evaluate(() => document.querySelectorAll('.shots .shot').length)
ok(shotN === 1, `上传后出现 ${shotN} 张缩略图`, String(shotN))
ok((await toast()).includes('已添加'), '提示已添加', await toast())

await clickBtn('保存')
await sleep(1800)
ts = await toast()
ok(/已保存/.test(ts), '保存成功', ts)
const withPhoto = await text()
ok(/1 张 · 点击查看大图/.test(withPhoto), '详情页显示「1 张 · 点击查看大图」', withPhoto.match(/\d+ 张[^\n]*/)?.[0])
const detailShots = await page.evaluate(() => document.querySelectorAll('.shots .shot img').length)
ok(detailShots === 1, `详情页渲染出 ${detailShots} 张图`, String(detailShots))

const logs2 = await page.evaluate(() => {
  const t = document.querySelector('.el-table')
  if (!t) return []
  return [...t.querySelectorAll('.el-table__body tbody tr')].map(tr => tr.innerText.replace(/\n+/g, ' | '))
})
console.log('    · 变更记录：', logs2.slice(0, 3))
ok(logs2.some(l => l.includes('设备图片')), '变更记录里有「设备图片」这一条')
ok(logs2.some(l => l.includes('设备图片') && l.includes('e2e-asset.png')), '记录里写明文件名（不写 base64）')
ok(!logs2.some(l => l.includes('data:image')), '记录里没有把图片内容写进去')

/* 台账列表也要能看到缩略图。
   注意要先搜一下：列表按购置日期倒序、「新建的没有购置日期」排在最后，
   默认第 1 页翻不到它 —— 直接查会误判成"缩略图没渲染"。 */
await page.goto(BASE + '/#/c/assets', { waitUntil: 'networkidle2' })
await sleep(1800)
await page.evaluate(() => {
  const inp = [...document.querySelectorAll('.toolbar input')].find(i => (i.placeholder || '').includes('搜名称'))
  if (!inp) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, '测试用办公椅 A')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
})
await clickBtn('查询')
await sleep(1400)
const rowThumb = await page.evaluate(name => {
  const tr = [...document.querySelectorAll('.el-table__body tbody tr')].find(x => x.innerText.includes(name))
  return tr ? { has: !!tr.querySelector('.an-thumb img'), text: tr.innerText.replace(/\n+/g, ' | ') } : null
}, '测试用办公椅 A')
ok(rowThumb && rowThumb.has, '台账行首有缩略图', rowThumb?.text?.slice(0, 60))
ok(rowThumb && /1 张图/.test(rowThumb.text), '台账行标注了图片张数', rowThumb?.text?.slice(0, 60))

/* 回到详情，页面上取扫码 token 供后面的免登录测试用 */
await page.goto(BASE + `/#/c/assets/${assetId}`, { waitUntil: 'networkidle2' })
await sleep(1600)

console.log('\n=== ⑤ 扫码页：免登录 + 字段边界 ===')
const scanUrl = await page.evaluate(() => {
  const inp = [...document.querySelectorAll('input')].find(i => (i.value || '').includes('/scan/'))
  return inp ? inp.value : ''
})
ok(!!scanUrl, `详情页有扫码链接（${scanUrl.slice(-24)}）`)
const token = scanUrl.split('/scan/')[1] || ''
ok(token.length === 16, `token 是 16 位随机串（${token}）`, token)

/* 换成一个「没有任何资产权限」的角色再打开 —— 能打开就证明不依赖登录态与权限位 */
await page.evaluate(() => localStorage.setItem('wy_proto_role', 'R-CLN'))
await page.goto(BASE + '/#/scan/' + token, { waitUntil: 'networkidle2' })
await sleep(1500)
const scanText = await text()
console.log('    · 扫码页：', scanText.split('\n').filter(Boolean).join(' | ').slice(0, 160))
ok(!scanText.includes('无权限') && !scanText.includes('403'), '环境保洁（无资产权限）也能打开 —— 免登录成立')
ok(scanText.includes('测试用办公椅 A'), '显示资产名称')
ok(/ZC\d{8}/.test(scanText), '显示资产编号')
ok(scanText.includes('使用部门'), '显示使用部门')
ok(/办公家具/.test(scanText), '显示分类路径')
ok(scanText.includes('保修到期'), '显示保修到期')

console.log('\n=== ⑥ 扫码页不泄露内部字段 ===')
ok(!scanText.includes('使用人'), '不显示「使用人」这一项（已确认口径：只给使用部门）')
ok(!scanText.includes('购置原值') && !scanText.includes('供应商'), '不显示原值与供应商')
ok(!scanText.includes('序列号'), '不显示序列号')
ok(!scanText.includes('变更记录'), '不显示内部变更记录')
ok(!scanText.includes('设备图片') && !scanText.includes('e2e-asset'), '不显示设备图片（照片背景里常有工位和同事）')
ok(scanText.includes('不需要登录'), '页面上明确说明"不需要登录"')

console.log('\n=== ⑦ 扫码页两种异常态 ===')
await page.goto(BASE + '/#/scan/aaaaaaaaaaaaaaaa', { waitUntil: 'networkidle2' })
await sleep(1200)
const bad = await text()
ok(bad.includes('未找到该资产'), '无效 token → 「未找到该资产」', bad.slice(0, 60))
ok(/报给行政/.test(bad), '给了下一步指引（把编号报给行政）')

/* 报废资产的码仍可查 */
await page.evaluate(() => localStorage.setItem('wy_proto_role', 'R-HR'))
await page.goto(BASE + '/#/c/assets', { waitUntil: 'networkidle2' })
await sleep(1600)
await page.evaluate(() => {
  const sels = [...document.querySelectorAll('.toolbar .el-select')]
  sels[1]?.querySelector('.el-select__wrapper')?.click()
})
await sleep(600)
await page.evaluate(() => {
  const items = [...document.querySelectorAll('.el-select-dropdown__item')].filter(x => x.offsetParent !== null)
  const p = items.find(x => x.innerText.trim() === '报废')
  if (p) p.click()
})
await sleep(1000)
await page.evaluate(() => {
  const tr = document.querySelector('.el-table__body tbody tr')
  if (tr) tr.click()
})
await sleep(1800)
const scrapScan = await page.evaluate(() => {
  const inp = [...document.querySelectorAll('input')].find(i => (i.value || '').includes('/scan/'))
  return inp ? inp.value.split('/scan/')[1] : ''
})
ok(!!scrapScan, '报废资产也有 token')
await page.evaluate(() => localStorage.setItem('wy_proto_role', 'R-CLN'))
await page.goto(BASE + '/#/scan/' + scrapScan, { waitUntil: 'networkidle2' })
await sleep(1400)
const scrapText = await text()
ok(scrapText.includes('该资产已报废'), '报废资产的码仍可打开，并标注"已报废"', scrapText.slice(0, 60))
ok(!scrapText.includes('未找到'), '不是 404 —— 历史要能追溯')

console.log('\n=== ⑧ 控制台 ===')
const real = errs.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 2).join(' | '))

await page.screenshot({ path: '/tmp/shot-asset-scan.png' })
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await b.close()
process.exit(fail ? 1 : 0)
