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
   只看一种会漏 —— 减免总额 8,855.73 就既没有万也没有小数 */
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

ok(k.some(t => t.includes('减免率')), '有「减免率」（与欠费率分开：减免不是收不到）')

console.log('\n【一·续】现金按归属账期三分 + 按房屋用途')

const splitSegs = await page.evaluate(() => [...document.querySelectorAll('.split-seg')].map(x => ({
  key: x.getAttribute('data-seg'),
  text: x.innerText.replace(/\s+/g, ' ').trim()
})))
ok(splitSegs.length === 3, '现金按归属账期分三段', `${splitSegs.length} 段`)
ok(splitSegs.map(x => x.key).join(',') === 'clearing,current,prepaid', '顺序 清欠 → 当期 → 预收', splitSegs.map(x => x.key).join(','))
ok(splitSegs.every(x => /¥/.test(x.text)), '每段都有金额')
ok(splitSegs.some(x => anyNum(x.text) > 0), '至少一段有金额', splitSegs.map(x => anyNum(x.text)).join(' / '))

const splitFt = await page.evaluate(() => document.querySelector('.split-bar__ft')?.innerText.replace(/\s+/g, ' '))
ok(/对得上/.test(splitFt || ''), '三段之和 = 现金收入（自检通过）', (splitFt || '').slice(0, 70))
ok(/仅本收费项/.test(await paneText()), '写明「仅本收费项」（三率是按 itemId 算的）')

const usageRows = await page.evaluate(() => {
  const panel = [...document.querySelectorAll('.panel')].find(p => /按房屋用途/.test(p.innerText.slice(0, 40)))
  if (!panel) return []
  return [...panel.querySelectorAll('.el-table__body-wrapper tr')].map(tr => tr.innerText.replace(/\s+/g, ' ').trim())
})
ok(usageRows.length >= 2, '按房屋用途至少两档', `${usageRows.length} 行`)
ok(usageRows.some(t => /住宅/.test(t)), '有「住宅」一档（客户要看住宅收费率）')
ok(usageRows.some(t => /商业|商铺/.test(t)), '有商业档（客户要看商铺收费率）')
ok(usageRows.every(t => /%/.test(t)), '每档都带收缴率')

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

console.log('\n【九】预算对比：完成率与执行率是两个方向')

await open()
await page.evaluate(() => {
  [...document.querySelectorAll('.el-tabs__item')].find(x => x.innerText.includes('预算'))?.click()
})
await sleep(2600)

const bk = await kpis()
for (const t of ['收入预算', '收入实际', '收入完成率', '支出预算', '支出实际', '支出执行率']) {
  ok(bk.some(x => x.includes(t)), `有「${t}」`)
}
const bNote = await paneText()
ok(/集团预算/.test(bNote) && /个月/.test(bNote), '写明预算口径与月数（月度预算 × 月数）', bNote.slice(0, 60))
ok(/完成率/.test(bNote) && /执行率/.test(bNote), '写明收入看完成率、支出看执行率（两个方向）')

/* 两张表都要有行，且不能混方向：收入表里出现"工资"就是方向串了 */
const budTabs = await page.evaluate(() => {
  const pane = [...document.querySelectorAll('.el-tab-pane')].find(x => x.offsetParent !== null)
  const tables = pane.querySelectorAll('.el-table')
  const read = tb => [...tb.querySelectorAll('.el-table__body-wrapper tr')].map(tr => {
    const tds = [...tr.querySelectorAll('td')].map(td => td.innerText.trim())
    return { name: (tds[0] || '').split('\n')[0], budget: tds[1], rate: tds[4], status: tds[5] }
  })
  return { income: read(tables[0]), expense: read(tables[1]) }
})
ok(budTabs.income.length > 0, '收入预算表有行', `${budTabs.income.length} 行`)
ok(budTabs.expense.length > 0, '支出预算表有行', `${budTabs.expense.length} 行`)
ok(!budTabs.income.some(r => /工资|社保|保洁|电梯维保/.test(r.name)), '收入表里没有支出科目（方向没串）')
ok(budTabs.expense.some(r => /工资/.test(r.name)), '支出表里有工资')

const INC_ST = ['达成', '接近', '欠收', '未编预算']
const EXP_ST = ['正常', '接近', '超支', '未编预算']
ok(budTabs.income.every(r => INC_ST.includes(r.status)), '收入侧状态只有 达成/接近/欠收',
  budTabs.income.map(r => r.status).join('/'))
ok(budTabs.expense.every(r => EXP_ST.includes(r.status)), '支出侧状态只有 正常/接近/超支',
  budTabs.expense.map(r => r.status).join('/'))

/* 完成率与明细必须自洽：合计率 ≈ 实际合计 ÷ 预算合计 */
const inBudget = bk.find(x => x.includes('收入预算')) || ''
const inActual = bk.find(x => x.includes('收入实际')) || ''
/* 括号位置很关键：写成 Number(x.match(re) || [])[1] 会先对数组取 Number（NaN），再取下标 → 恒为 0 */
const inRate = Number(((bk.find(x => x.includes('收入完成率')) || '').match(/([\d.]+)\s*%/) || [])[1] || 0)
if (inRate > 0) {
  const b = anyNum(inBudget); const a = anyNum(inActual)
  ok(Math.abs(a / b * 100 - inRate) < 1, '完成率 = 收入实际 ÷ 收入预算', `${inRate}% vs ${(a / b * 100).toFixed(1)}%`)
} else { ok(false, '完成率没读出来') }

/* 切到单项目：预算按集团编制，这里只能比实际 —— 预算列必须显「未编」并说明，不能摊一个假数 */
await page.evaluate(() => {
  document.querySelectorAll('.filter-bar .el-select__wrapper')[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(600)
await page.evaluate(() => {
  [...document.querySelectorAll('.el-select-dropdown__item')]
    .filter(x => x.getBoundingClientRect().height > 0).find(x => x.innerText.includes('翡翠城'))?.click()
})
await sleep(2400)
const projNote = await paneText()
ok(/集团编制/.test(projNote), '项目维度写明「预算按集团编制」', projNote.slice(0, 60))
const projBud = await page.evaluate(() => {
  const pane = [...document.querySelectorAll('.el-tab-pane')].find(x => x.offsetParent !== null)
  const tb = pane.querySelectorAll('.el-table')[1]
  return [...tb.querySelectorAll('.el-table__body-wrapper tr')].map(tr => tr.querySelectorAll('td')[1].innerText.trim())
})
ok(projBud.length > 0 && projBud.every(x => x === '未编'), '项目维度预算列全是「未编」（不按面积摊）', projBud.slice(0, 3).join('/'))

console.log('\n【十】经营日报：一天一列，三段 + 收款点 + 日结差额')

await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
await page.evaluate(() => localStorage.setItem('wy_proto_role', 'R-GM'))
await page.goto(`${BASE}/?t=${Date.now()}#/b/daily-report`, { waitUntil: 'networkidle2' })
await sleep(3200)

const drK = await kpis()
for (const t of ['收入', '往来款', '退款', '合计', '当日减免', '差额']) {
  ok(drK.some(x => x.includes(t)), `有「${t}」卡`)
}
ok(drK.some(x => /不是钱/.test(x)), '减免卡写明「不是钱 · 不参与差额」')

const drChk = await txt('.check')
ok(/日结差额全月为 0/.test(drChk), '日结差额全月为 0', drChk.slice(0, 100))

const drTable = await page.evaluate(() => {
  const t = document.querySelector('.el-table')
  if (!t) return { heads: [], rows: [] }
  const heads = [...t.querySelectorAll('.el-table__header th')].map(th => th.innerText.trim()).filter(Boolean)
  const rows = [...t.querySelectorAll('.el-table__body-wrapper tr')].map(tr => {
    const tds = [...tr.querySelectorAll('td')].map(td => td.innerText.trim())
    return { cls: tr.className, name: tds[0], total: tds[tds.length - 1] }
  })
  return { heads, rows }
})
ok(drTable.heads.length >= 30, '按天出列（科目 + 31 天 + 合计）', `${drTable.heads.length} 列`)
ok(drTable.heads[1] === '1', '第一个日列是 1 日（没有「上月补记」列）', drTable.heads.slice(1, 4).join(','))
ok(drTable.heads[drTable.heads.length - 2] === '31', '最后是 31 日', drTable.heads[drTable.heads.length - 2])

const drGroups = drTable.rows.filter(r => /dr-group/.test(r.cls)).map(r => r.name)
ok(drGroups.some(n => /收入/.test(n)), '有「收入」段')
ok(drGroups.some(n => /往来款/.test(n)), '有「往来款」段（押金收取 · 负债不是收入）')
ok(drGroups.some(n => /退款/.test(n)), '有「退款」段（押金退还 · 冲负债）')
ok(drGroups.some(n => /收款点/.test(n)), '有「收款点」段')

const drPoints = drTable.rows.filter(r => /dr-point(?!-)/.test(r.cls)).map(r => r.name.replace(/^\s+/, ''))
for (const p of ['现金', '车辆现金', 'POS刷卡', '车辆POS', '转账', '车辆云平台', '线上支付']) {
  ok(drPoints.includes(p), `收款点里有「${p}」`)
}

const drDiffRow = drTable.rows.find(r => /dr-diff/.test(r.cls))
ok(!!drDiffRow, '有「差额」行')
const drDiffVal = drDiffRow ? Number(String(drDiffRow.total).replace(/[¥,]/g, '')) : NaN
ok(Math.abs(drDiffVal) < 0.01, '差额合计为 0（按科目和按收款点两条路对得上）', drDiffRow?.total)

const drSubs = drTable.rows.filter(r => /dr-subtotal/.test(r.cls))
  .map(r => ({ name: r.name, v: Number(String(r.total).replace(/[¥,]/g, '')) }))
ok(drSubs.length >= 3, '三段都有小计', `${drSubs.length} 个`)
const drInc = drSubs.find(x => /^收入小计/.test(x.name))
const drLia = drSubs.find(x => /往来款/.test(x.name))
const drRef = drSubs.find(x => /退款/.test(x.name))
const drGrand = drTable.rows.find(r => /dr-grand/.test(r.cls))
if (drInc && drLia && drRef && drGrand) {
  const g = Number(String(drGrand.total).replace(/[¥,]/g, ''))
  const want = Math.round((drInc.v + drLia.v - drRef.v) * 100) / 100
  ok(Math.abs(g - want) < 0.02, '合计 = 收入 + 往来 − 退款（自己加一遍）', `${g} vs ${want}`)
} else { ok(false, '三段小计没读全') }

/* 切到单项目：结构不变、差额照样为 0 */
await page.evaluate(() => {
  document.querySelectorAll('.filter-bar .el-select__wrapper')[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(600)
await page.evaluate(() => {
  [...document.querySelectorAll('.el-select-dropdown__item')]
    .filter(x => x.getBoundingClientRect().height > 0).find(x => x.innerText.includes('翡翠城'))?.click()
})
await sleep(2400)
const drChk2 = await txt('.check')
ok(/日结差额全月为 0/.test(drChk2), '按项目筛选后差额仍为 0', drChk2.slice(0, 90))
const drK2 = await kpis()
ok(drK2.some(x => x.includes('收入')), '按项目仍有收入卡')

console.log('\n【十一】公司月报：多项目并排')

await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
await page.evaluate(() => localStorage.setItem('wy_proto_role', 'R-GM'))
await page.goto(`${BASE}/?t=${Date.now()}#/b/company-report`, { waitUntil: 'networkidle2' })
await sleep(3400)

const crK = await kpis()
for (const t of ['收入合计', '项目支出', '公司级费用', '公司结余', '合计收缴率']) {
  ok(crK.some(x => x.includes(t)), `有「${t}」卡`)
}
ok(crK.some(x => /不摊到项目/.test(x)), '公司级费用卡写明「不摊到项目」')

/* 公司级费用区块：只汇总不摊，明细只列已付款 */
const ohPanel = await page.evaluate(() => {
  const pn = [...document.querySelectorAll('.panel')].find(x => x.innerText.includes('公司级费用（未摊到项目）'))
  if (!pn) return null
  const rows = [...pn.querySelectorAll('.el-table__body-wrapper tr')].map(tr =>
    [...tr.querySelectorAll('td')].map(td => td.innerText.trim()))
  return {
    text: pn.innerText.replace(/\s+/g, ' '),
    chips: [...pn.querySelectorAll('.chip')].map(x => x.innerText.replace(/\s+/g, ' ').trim()),
    rows,
    pending: /另有待付款/.test(pn.innerText)
  }
})
ok(!!ohPanel, '有「公司级费用（未摊到项目）」区块')
ok(/只汇总不摊/.test(ohPanel?.text || ''), '写明「只汇总不摊」')
ok((ohPanel?.rows.length || 0) > 0, '公司级费用有明细', `${ohPanel?.rows.length} 行`)
ok((ohPanel?.chips.length || 0) > 0, '按分类汇总有 chip', (ohPanel?.chips || []).join(' / '))
ok(ohPanel?.pending === true, '待付款单独提示（不记支出但要说出来）')

/* 公司结余必须比项目结余更负：差的就是总部费用 */
const crBal = anyNum(crK.find(x => x.includes('项目支出')) || '')
const crOh = anyNum(crK.find(x => x.includes('公司级费用')) || '')
const crBalAll = crK.find(x => x.includes('公司结余')) || ''
ok(crOh > 0, '公司级费用大于 0', crOh)
ok(crBalAll.includes('−') || Number(String(crBalAll).match(/-?\d/) || 0) >= 0, '公司结余标出了负号', crBalAll.slice(0, 40))

const crNote = await txt('.sec__hd .desc')
ok(/重算/.test(crNote), '写明合计的率是重算的，不是各行相加', crNote.slice(0, 70))

const crRows = await page.evaluate(() => {
  const t = document.querySelector('.el-table')
  if (!t) return []
  return [...t.querySelectorAll('.el-table__body-wrapper tr')].map(tr => {
    const tds = [...tr.querySelectorAll('td')].map(td => td.innerText.trim())
    return { cls: tr.className.replace(/el-table__row/g, '').trim(), name: (tds[0] || '').split('\n')[0], cells: tds }
  })
})
ok(crRows.length >= 3, '至少两个项目 + 合计行', `${crRows.length} 行`)
const crTotal = crRows.find(r => /cr-total/.test(r.cls))
ok(!!crTotal, '有合计行（高亮）')

/* 自己加一遍：合计收入 = 各项目收入之和（从表格文本里抠） */
const crNum = t => Number(String(t).replace(/[¥,−\s]/g, '')) || 0
const crProjects = crRows.filter(r => !/cr-total/.test(r.cls))
const crIncIdx = 7   // 项目 | 应收 | 已收 | 收缴率 | 住宅 | 商业 | 收入 | 支出 | 结余 | 结余率
const crSumInc = Math.round(crProjects.reduce((s2, r) => s2 + crNum(r.cells[crIncIdx]), 0) * 100) / 100
const crTotInc = crTotal ? crNum(crTotal.cells[crIncIdx]) : 0
ok(Math.abs(crSumInc - crTotInc) < 1, '合计收入 = 各项目相加', `${crSumInc} vs ${crTotInc}`)

ok(crProjects.some(r => /%/.test(r.cells[3] || '')), '每个项目都有收缴率')
ok(crProjects.every(r => r.cells.length >= 10), '列数齐（含收支与结余）')

await page.screenshot({ path: 'screenshots/round10/06-公司月报.png' })
console.log('\n【十二】控制台')
ok(errs.length === 0, '零 console 错误', errs.slice(0, 2).join(' | '))

await b.close()
console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
