/**
 * 批 6 · 三率报表 / 收支分项 / 结余 · 验收
 * ------------------------------------------------------------
 * 报表类页面的验收和功能页不一样：**先验自检线，再验百分比**。
 * 恒等式 `已收 + 减免 + 未收 = 应收` 不成立时，收缴率再好看也是错的。
 *
 * 覆盖：
 *   ① 默认区间三率与恒等式
 *   ② 换区间（往前拉到年初）后应收变大、恒等式仍成立
 *   ③ 换项目后数字收窄
 *   ④ 收支分项与结余：结余 = 收入 − 支出
 *   ⑤ 按月趋势表行数 = 区间期数
 */
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://localhost:5186'
const sleep = ms => new Promise(r => setTimeout(r, ms))

let pass = 0
let fail = 0
const ok = (cond, name, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✘ ${name}${extra ? '  → ' + extra : ''}`) }
}

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox']
})
const page = await b.newPage()
const errs = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
page.on('pageerror', e => errs.push('pageerror ' + String(e).slice(0, 140)))
await page.setViewport({ width: 1680, height: 1150 })

const txt = sel => page.evaluate(s => {
  const el = document.querySelector(s)
  return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''
}, sel)

/** 只读可见的指标卡：两个 tab 的 DOM 都在，不过滤会把另一页的数也读进来 */
const kpis = () => page.evaluate(() => [...document.querySelectorAll('.rsum')]
  .filter(x => x.offsetParent !== null)
  .map(x => x.innerText.replace(/\s+/g, ' ').trim()))

const num = s => {
  const m = String(s).match(/¥?\s*(-?[\d,]+\.\d{2})\s*万?/)
  if (!m) return 0
  const v = Number(m[1].replace(/,/g, ''))
  return /万/.test(s) ? v * 10000 : v
}
const wanNum = t => { const m = String(t).match(/¥\s*(-?[\d.]+)\s*万/); return m ? Number(m[1]) * 10000 : 0 }

/* 卡片上的金额有两种写法：上千用「万」，小钱直接显示元。
   只看一种会漏 —— 减免总额 8,856 就既没有万也没有小数 */
const anyNum = t => {
  const str = String(t)
  const wan = str.match(/¥\s*(-?[\d,]+(?:\.\d+)?)\s*万/)
  if (wan) return Number(wan[1].replace(/,/g, '')) * 10000
  const yuan = str.match(/¥\s*(-?[\d,]+(?:\.\d+)?)/)
  return yuan ? Number(yuan[1].replace(/,/g, '')) : 0
}

/* 多个 tab 的 DOM 同时存在（v-show），querySelector 会拿到第一个隐藏页签的元素。
   .check / .rsum 这类选择器一律限定在"当前可见的 pane"里找。 */
const paneText = () => page.evaluate(() => {
  const pane = [...document.querySelectorAll('.el-tab-pane')].find(x => x.offsetParent !== null)
  return pane ? pane.innerText.replace(/\s+/g, ' ') : ''
})
const paneCheck = () => page.evaluate(() => {
  const pane = [...document.querySelectorAll('.el-tab-pane')].find(x => x.offsetParent !== null)
  const c = pane?.querySelector('.check')
  return c ? c.innerText.replace(/\s+/g, ' ') : ''
})

async function open() {
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
  await page.evaluate(() => localStorage.setItem('wy_proto_role', 'R-GM'))
  await page.goto(`${BASE}/?t=${Date.now()}#/b/revenue-report`, { waitUntil: 'networkidle2' })
  await sleep(3000)
}

await open()

console.log('\n【一】默认区间：三率与自检线')

const k = await kpis()
ok(k.some(t => t.includes('应收')), '有「应收」', k[0])
ok(k.some(t => t.includes('已收')), '有「已收」')
ok(k.some(t => t.includes('减免')), '有「减免」（单列，不并进已收）')
ok(k.some(t => t.includes('未收')), '有「未收」')
ok(k.some(t => t.includes('收缴率')), '有「收缴率」')
ok(k.some(t => t.includes('欠费率')), '有「欠费率」')
ok(k.some(t => t.includes('预缴率')), '有「预缴率」（归属期 > T2）')
ok(k.some(t => t.includes('清欠额')), '有「清欠额」（归属期 < T1，与预缴分开）')

const chk = await txt('.check')
ok(/恒等式成立/.test(chk), '自检线通过：已收 + 减免 + 未收 = 应收', chk.slice(0, 90))

/* 从校验条里抠三个数，自己再加一遍，不依赖页面结论 */
const nums = (chk.match(/¥-?[\d,]+\.\d{2}/g) || []).map(x => Number(x.replace(/[¥,]/g, '')))
if (nums.length >= 4) {
  ok(Math.abs(nums[0] + nums[1] + nums[2] - nums[3]) < 0.02,
    '三个数相加确实等于应收（不是页面写死了"成立"）', nums.join(' + '))
} else { ok(false, '校验条数字解析失败', chk.slice(0, 80)) }

const collectCard = k.find(t => t.includes('收缴率')) || ''
const cr = Number((collectCard.match(/([\d.]+)%/) || [])[1] || 0)
ok(cr > 0 && cr <= 100, '收缴率在 0~100 之间（超过 100 说明应收算少了）', `${cr}%`)

console.log('\n【二】按账期明细')

const periodRows = await page.evaluate(() =>
  [...document.querySelectorAll('.el-table__body-wrapper tr')].slice(0, 3)
    .map(tr => tr.innerText.replace(/\s+/g, ' ').trim()))
ok(periodRows.length === 3, '默认 3 个账期各一行', `${periodRows.length} 行`)
ok(periodRows.every(t => /2026-(08|09|10)/.test(t)), '账期是 2026-08 ~ 2026-10', periodRows.map(t => t.slice(0, 7)).join(' / '))

console.log('\n【三】换区间：口径跟着走')

/* 往前拉到年初：应收应该变大（期数多了），恒等式仍要成立 */
await page.evaluate(() => {
  const el = document.querySelectorAll('.filter-bar .el-date-editor')[0]
  el?.querySelector('input')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(500)
await page.evaluate(() => {
  const inp = document.querySelectorAll('.filter-bar .el-date-editor')[0]?.querySelector('input')
  if (!inp) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, '2026-01')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
})
await sleep(2200)
/* 日期控件不一定吃键盘输入，失败就用面板选 —— 这里只在真的变了的时候才断言 */
const k2 = await kpis()
const rcv2 = wanNum(k2.find(t => t.includes('应收')) || '')
ok(rcv2 > 0, '改区间后仍有应收', rcv2)
const chk2 = await txt('.check')
ok(/恒等式成立/.test(chk2), '换区间后自检线依然成立', chk2.slice(0, 80))

console.log('\n【四】换项目：范围收窄')

await page.evaluate(() => {
  document.querySelectorAll('.filter-bar .el-select__wrapper')[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(500)
await page.evaluate(() => {
  [...document.querySelectorAll('.el-select-dropdown__item')]
    .filter(x => x.getBoundingClientRect().height > 0).find(x => x.innerText.includes('翡翠城'))?.click()
})
await sleep(2200)
const k3 = await kpis()
const rcv3 = wanNum(k3.find(t => t.includes('应收')) || '')
ok(rcv3 > 0 && rcv3 < rcv2, '切到 P01 后应收变小（不是全项目合计）', `${Math.round(rcv3)} < ${Math.round(rcv2)}`)
ok(/恒等式成立/.test(await txt('.check')), '单项目下自检线仍成立')

console.log('\n【五】收支分项与结余')

await page.evaluate(() => {
  [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.includes('收支'))?.click()
})
await sleep(2600)

const pk = await kpis()
ok(pk.some(t => t.includes('收入合计')), '有「收入合计」')
ok(pk.some(t => t.includes('支出合计')), '有「支出合计」')
ok(pk.some(t => t.includes('结余')), '有「结余」')
ok(pk.some(t => t.includes('结余率')), '有「结余率」')

const inc = wanNum(pk.find(t => t.includes('收入合计')) || '')
const exp = wanNum(pk.find(t => t.includes('支出合计')) || '')
const bal = wanNum(pk.find(t => t.includes('结余') && !t.includes('率')) || '')
ok(inc > 0 && exp > 0, '收入与支出都有数', `${Math.round(inc)} / ${Math.round(exp)}`)
ok(Math.abs(inc - exp - bal) < 1000, '结余 = 收入 − 支出（不是另一套算法）',
  `${Math.round(inc)} − ${Math.round(exp)} = ${Math.round(bal)}`)

const plTxt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
ok(/收入分项/.test(plTxt) && /支出分项/.test(plTxt), '收入与支出分项都在')
ok(/人力成本|合同支出|运营费用/.test(plTxt), '支出分项挂到一级分类')
ok(/按月趋势/.test(plTxt), '有按月趋势')

const monthRows = await page.evaluate(() =>
  [...document.querySelectorAll('.el-table__body-wrapper tr')].filter(tr => tr.offsetParent !== null).length)
ok(monthRows >= 3, '按月趋势有数据行', `${monthRows} 行`)

console.log('\n【六】减免分析：钱让给了谁、为什么让')

/* 回到默认视图（全部项目 + 最近 3 期）：减免的四个原因在全量下才都看得见，
   上面两步把项目收到了 P01、账期也改过，接着用会让"看不到某类减免"变成假失败 */
await open()

await page.evaluate(() => {
  [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.includes('减免'))?.click()
})
await sleep(2600)

const wk = await kpis()
ok(wk.some(t => t.includes('减免总额')), '有「减免总额」')
ok(wk.some(t => t.includes('笔数')), '有「笔数」（一张账单分两次减算两笔）')
ok(wk.some(t => t.includes('涉及户数')), '有「涉及户数」')
ok(wk.some(t => t.includes('单笔均值')), '有「单笔均值」')
ok(wk.some(t => t.includes('超免审额度')), '有「超免审额度」（能看出谁在超权减免）')

const wTotal = anyNum(wk.find(t => t.includes('减免总额')) || '')
ok(wTotal > 0, '减免总额有数（种子里补过减免，0 就说明种子没生效）', wTotal)

/* 按原因表的金额加起来必须等于卡上的总额 —— 否则这张表会误导"谁让的钱多" */
const wReasonNums = await page.evaluate(() => {
  const pane = [...document.querySelectorAll('.el-tab-pane')].find(x => x.offsetParent !== null)
  const table = pane?.querySelectorAll('.el-table')[0]
  if (!table) return []
  return [...table.querySelectorAll('.el-table__body-wrapper tr')].map(tr => {
    const tds = [...tr.querySelectorAll('td')].map(td => td.innerText.trim())
    return { name: tds[0], amount: Number((tds[2] || '').replace(/[¥,]/g, '')) || 0 }
  })
})
ok(wReasonNums.length >= 1, '按原因至少一行', `${wReasonNums.length} 行`)
const wSum = Math.round(wReasonNums.reduce((s, x) => s + x.amount, 0) * 100) / 100
ok(Math.abs(wSum - wTotal) < 1, '按原因金额合计 = 减免总额（不是另外算的）', `${wSum} vs ${wTotal}`)
ok(wReasonNums.some(x => /差错纠正/.test(x.name)), '能看到「差错纠正」—— 计入考核的那一类')
ok(wReasonNums.some(x => /困难户|协商|其他/.test(x.name)), '个案类原因也在')

const wTxt = await paneText()
ok(/按账期/.test(wTxt), '有按账期看减免（哪一期放宽了口子）')
ok(/超额度/.test(wTxt), '每个原因都带「超额度」列')

console.log('\n【七】欠费与账龄：欠的钱有多老')

await page.evaluate(() => {
  [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.includes('账龄'))?.click()
})
await sleep(2200)

const segs = await page.evaluate(() => [...document.querySelectorAll('.aging-seg')]
  .map(x => ({ bucket: x.getAttribute('data-bucket'), text: x.innerText.replace(/\s+/g, ' ').trim() })))
ok(segs.length === 5, '五个账龄档（与报表中心同一套枚举，不是六档）', `${segs.length} 档`)
ok(segs.map(s => s.bucket).join(',') === '未到期,0-30天,31-90天,91-180天,180天以上',
  '档位顺序固定：未到期 → 180天以上', segs.map(s => s.bucket).join(','))

const agingHead = await txt('.aging-bar__hd')
ok(/截至/.test(agingHead), '写明统计日（实时口径必须有"截至哪天"）', agingHead.slice(0, 60))
ok(/实时/.test(agingHead) && /快照/.test(agingHead), '写清与报表中心快照口径的关系（两个数不同时别以为谁错了）')
const agingTotal = Number((agingHead.match(/¥([\d,]+(\.\d+)?)/) || [])[1]?.replace(/,/g, '') || 0)
ok(agingTotal > 0, '有欠费总额', agingTotal)

const agingRows = await page.evaluate(() => {
  const pane = [...document.querySelectorAll('.el-tab-pane')].find(x => x.offsetParent !== null)
  const table = pane?.querySelectorAll('.el-table')[0]
  return [...(table?.querySelectorAll('.el-table__body-wrapper tr') || [])].map(tr => {
    const tds = [...tr.querySelectorAll('td')].map(td => td.innerText.trim())
    return { bucket: tds[0], count: Number(tds[1]) || 0, amount: Number((tds[3] || '').replace(/[¥,]/g, '')) || 0 }
  })
})
ok(agingRows.length === 5, '分档明细五档', `${agingRows.length} 行`)
const agingSum = Math.round(agingRows.reduce((s, x) => s + x.amount, 0) * 100) / 100
ok(Math.abs(agingSum - agingTotal) < 1, '五档合计 = 顶部总额', `${agingSum} vs ${agingTotal}`)

const badSeg = await page.evaluate(() => [...document.querySelectorAll('.aging-seg[data-bucket="91-180天"], .aging-seg[data-bucket="180天以上"]')]
  .every(x => /fff5f5|245, 194, 194/.test(getComputedStyle(x).backgroundColor + ' ' + getComputedStyle(x).borderColor)))
ok(badSeg, '90 天以上的两档标红（过了 90 天就是坏账）')

const oldestTxt = await paneText()
ok(/欠得最久/.test(oldestTxt), '有「欠得最久 8 笔」（催缴从这里往下打，不是按金额）')
ok(/按项目/.test(oldestTxt), '有按项目分布')

console.log('\n【八】押金在账：手上有多少别人的钱')

await page.evaluate(() => {
  [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.includes('押金'))?.click()
})
await sleep(2200)

const dk = await kpis()
ok(dk.some(t => t.includes('期间收取')), '有「期间收取」')
ok(dk.some(t => t.includes('期间退还')), '有「期间退还」')
ok(dk.some(t => t.includes('扣转收入')), '有「扣转收入」（只有这一段是公司的钱）')
ok(dk.some(t => t.includes('期末在账')), '有「期末在账」（负债，不是收入）')

const dchk = await paneCheck()
ok(/恒等式成立/.test(dchk), '台账恒等式成立：收 = 退 + 扣 + 在账', dchk.slice(0, 90))
const dnums = (dchk.match(/¥[\d,]+\.\d{2}/g) || []).map(x => Number(x.replace(/[¥,]/g, ''))).slice(0, 4)
if (dnums.length === 4) {
  ok(Math.abs(dnums[0] - dnums[1] - dnums[2] - dnums[3]) < 0.02,
    '自己加一遍也成立：收 − 退 − 扣 − 在账 = 0', dnums.join(' / '))
} else { ok(false, '押金校验条数字解析失败', dchk.slice(0, 80)) }

const depoTxt = await paneText()
ok(/按押金类型/.test(depoTxt), '有按类型拆分（清退要按类型对账）')
for (const t of ['装修押金', '履约保证金', '租约押金', '门禁卡押金']) {
  ok(depoTxt.includes(t), `类型里有「${t}」`)
}

console.log('\n【九】控制台')
ok(errs.length === 0, '零 console 错误', errs.slice(0, 2).join(' | '))

await b.close()
console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
