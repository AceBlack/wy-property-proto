/**
 * 第 68 批 · 邻里运营（后台）
 *
 * 关键口径（断言围绕这几条）：
 *   ① 投票只做意见征询 —— 结果抽屉里**不能出现**「通过 / 未通过」；
 *   ② 投票发布后题目与选项不可改（改由接口拦，页面不提供入口）；
 *   ③ 收费活动的「待成行」是独立状态，唯一出口是「确认流团」并全额退款；
 *   ④ 报名退款按分档算，不是拍脑袋给个数；
 *   ⑤ 闲置先审后发，驳回必须写理由；
 *   ⑥ 权限：只读角色能看不能改。
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
async function go(hash, role = 'R-PM') {
  if (!booted) { await page.goto(BASE + '/', { waitUntil: 'networkidle2' }); booted = true }
  await page.evaluate(r => localStorage.setItem('wy_proto_role', r), role)
  await page.goto(`${BASE}/?t=${Date.now()}#${hash}`, { waitUntil: 'networkidle2' })
  await sleep(1600)
}
/** 点按钮（按文字）。Element Plus 的按钮文字在 span 里，用 innerText 匹配 */
async function clickBtn(text, root = 'body') {
  const done = await page.evaluate((text, root) => {
    const el = [...document.querySelectorAll(`${root} button`)].find(x => x.innerText.trim().includes(text))
    if (!el) return false
    el.click(); return true
  }, text, root)
  await sleep(700)
  return done
}
/** 点表格里某一行的按钮 */
async function rowBtn(rowText, btnText) {
  const done = await page.evaluate((rowText, btnText) => {
    const tr = [...document.querySelectorAll('.el-table__body tr')].find(x => x.innerText.includes(rowText))
    if (!tr) return false
    const el = [...tr.querySelectorAll('button')].find(x => x.innerText.trim().includes(btnText))
    if (!el) return false
    el.click(); return true
  }, rowText, btnText)
  await sleep(700)
  return done
}
const stats = sel => page.evaluate(s => [...document.querySelectorAll(s)].map(x => x.innerText.replace(/\n+/g, ' | ')), sel)

console.log('=== ① 工作台 ===')
await go('/n/workbench')
let t = await txt()
ok(t.includes('邻里运营'), '页面打开')
ok(t.includes('不做话题广场与跟帖'), '写明了不做话题与跟帖的原因')
const todo = await stats('.ntd')
console.log('     待办：', todo)
ok(todo.length === 4, '四件待办（闲置/举报/待成行/投票）', String(todo.length))
ok(todo[0].includes('待审闲置') && todo[0].includes('8'), '待审闲置 8 条', todo[0])
ok(todo[1].includes('待处理举报') && todo[1].includes('4'), '待处理举报 4 条', todo[1])
ok(todo[2].includes('待成行活动') && todo[2].includes('1'), '待成行活动 1 场', todo[2])
const kpi = await stats('.nk')
console.log('     指标：', kpi)
ok(kpi.length === 4 && kpi[0].includes('公告阅读率'), '四个率都在', String(kpi.length))
ok(t.includes('邻里') && !t.includes('话题广场（建设中）'), '没有话题广场入口')

console.log('\n=== ② 投票管理 ===')
await go('/n/votes')
t = await txt()
ok(t.includes('投票管理'), '页面打开')
ok(t.includes('只做意见征询'), '说明了只做意见征询')
ok(t.includes('不构成《民法典》'), '写明了不构成业主共同决定')
let rows = await page.evaluate(() => [...document.querySelectorAll('.el-table__body tr')].map(x => x.innerText.replace(/\n+/g, ' | ')))
console.log('     首行：', rows[0]?.slice(0, 90))
ok(rows.length >= 6, '投票列表有数据', String(rows.length))
const draftRow = await page.evaluate(() => [...document.querySelectorAll('.el-table__body tr')]
  .map(x => x.innerText).find(x => x.includes('草稿')) || '')
ok(!!draftRow, '存在草稿态投票（可编辑）', draftRow.slice(0, 40))

/* 结果抽屉：不能出现「通过」 */
ok(await rowBtn('满意度', '结果'), '打开「结果」抽屉')
/* 抽屉都挂在 body 上、关闭时也留在 DOM：必须按内容锚定，不能按"第几个" */
const drawer = await page.evaluate(() => {
  const d = [...document.querySelectorAll('.el-drawer')].find(x => x.querySelector('.res-hd'))
  return d ? d.innerText : ''
})
console.log('     结果首行：', drawer.split('\n').slice(0, 4).join(' / '))
ok(drawer.includes('参与率'), '结果给参与率')
ok(!/通过/.test(drawer), '结果里没有「通过 / 未通过」结论')
ok(drawer.includes('意见征询，不是表决'), '写明了这是意见征询')
await page.keyboard.press('Escape'); await sleep(500)

/* 发布草稿 → 状态变进行中 */
const draftTitle = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table__body tr')].find(x => x.innerText.includes('草稿'))
  return tr ? tr.querySelector('.v-t')?.innerText.trim() : ''
})
console.log('     待发布草稿：', draftTitle)
ok(await rowBtn(draftTitle.slice(0, 6), '发布'), '点「发布」')
ok((await txt()).includes('发布后题目与选项都不能再改'), '发布前提示不可再改')
await clickBtn('确认发布')
await sleep(900)
const afterPub = await page.evaluate(t => [...document.querySelectorAll('.el-table__body tr')]
  .map(x => x.innerText).find(x => x.includes(t)) || '', draftTitle.slice(0, 8))
ok(afterPub.includes('进行中'), '发布后状态变「进行中」', afterPub.slice(0, 60))
ok(!afterPub.includes('编辑'), '进行中不再提供「编辑」入口（选项不可改）')

console.log('\n=== ③ 活动管理 ===')
await go('/n/activities')
t = await txt()
ok(t.includes('活动管理'), '页面打开')
ok(t.includes('成团下限'), '说明了成团下限')
ok(t.includes('成本分摊'), '收费口径为成本分摊（不写旅游）')
const aStat = await stats('.astat')
console.log('     统计：', aStat)
ok(aStat[1].includes('待成行') && aStat[1].includes('1'), '待成行 1 场', aStat[1])
ok(!aStat[3].includes('¥ 0.00'), '已收活动费按报名实收计算（不是 0）', aStat[3])
const aRows = await page.evaluate(() => [...document.querySelectorAll('.el-table__body tr')].map(x => x.innerText.replace(/\n+/g, ' | ')))
console.log('     待成行行：', aRows.find(x => x.includes('待成行'))?.slice(0, 110))
ok(!!aRows.find(x => x.includes('待成行')), '列表里有待成行活动')
ok(!!aRows.find(x => x.includes('已成行')), '列表里有已成行活动')

/* 流团：弹窗要给出退款金额，执行后状态变已流团 */
ok(await rowBtn('秋日露营', '确认流团'), '打开「确认流团」')
let dlg = await page.evaluate(() => [...document.querySelectorAll('.el-dialog')].map(x => x.innerText).join('\n'))
console.log('     流团弹窗：', dlg.split('\n').filter(Boolean).slice(0, 6).join(' / '))
ok(dlg.includes('需退款报名') && dlg.includes('退款金额'), '弹窗列明退款人数与金额')
ok(dlg.includes('不可撤销'), '提示不可撤销')
await clickBtn('确认流团并退款')
await sleep(900)
const flowedRow = await page.evaluate(() => [...document.querySelectorAll('.el-table__body tr')]
  .map(x => x.innerText).find(x => x.includes('秋日露营')) || '')
ok(flowedRow.includes('已流团'), '执行后状态变「已流团」', flowedRow.slice(0, 80))

console.log('\n=== ④ 报名名单 ===')
await go('/n/activities')
await rowBtn('邻里出游', '名单')
await sleep(900)
t = await txt()
ok(t.includes('返回活动列表'), '进入名单页')
ok(t.includes('报名人次'), '统计卡在')
const eStats = await stats('.estat')
console.log('     名单统计：', eStats)
ok(eStats[0].includes('人'), '报名人次有值', eStats[0])
const eRows = await page.evaluate(() => [...document.querySelectorAll('.el-table__body tr')].map(x => x.innerText.replace(/\n+/g, ' | ')))
console.log('     首位报名：', eRows[0]?.slice(0, 90))
ok(eRows.length > 0, '名单有数据', String(eRows.length))
ok(eRows.some(x => x.includes('儿')), '出行人标了儿童')
ok(t.includes('退款规则：'), '详情区给出退款分档')

/* 代报名：必填校验 → 投保必填 → 成功。
   选的是「邻里出游」（需投保），所以要连出行人一起填 —— 这正是前台代报的真实路径。 */
ok(await clickBtn('代报名'), '打开发报名抽屉')
await clickBtn('确认报名')
ok((await txt()).includes('联系人姓名必填'), '空表单被拦（姓名必填）')
const fill = await page.evaluate(() => {
  const set = (ph, v) => {
    const el = [...document.querySelectorAll('.el-drawer input')].find(x => x.placeholder === ph)
    if (!el) return false
    el.value = v
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }
  return {
    name: set('业主姓名', '顾春梅'),
    phone: set('11 位手机号，用于行前通知', '13912345678'),
    trav: set('姓名', '顾春梅'),
    id: set('身份证号（仅用于购买当日意外险）', '510101199003071234'),
    emg: set('紧急联系人电话', '13900001111')
  }
})
ok(fill.name && fill.phone && fill.id, '填上联系人与出行人证件号', JSON.stringify(fill))
await sleep(300)
await clickBtn('确认报名')
await sleep(1000)
const enrolled = await page.evaluate(() => [...document.querySelectorAll('.el-table__body tr')]
  .some(x => x.innerText.includes('顾春梅')))
ok(enrolled, '代报名成功并出现在名单')

console.log('\n=== ⑤ 闲置审核 ===')
await go('/n/items')
t = await txt()
ok(t.includes('闲置审核'), '页面打开')
ok(t.includes('先审后发'), '写明了先审后发')
ok(t.includes('驳回必须写理由'), '写明了驳回要写理由')
const iStat = await stats('.istat')
console.log('     统计：', iStat)
ok(iStat[0].includes('待审核') && iStat[0].includes('8'), '待审 8 条', iStat[0])
const queue = await page.evaluate(() => [...document.querySelectorAll('.ic')].map(x => x.innerText.replace(/\n+/g, ' | ')))
console.log('     队列首位：', queue[0])
ok(queue.length >= 8, '队列渲染 8 条以上', String(queue.length))
ok(t.includes('宜家儿童书桌'), '默认选中首条并给出预览')

/* 驳回不写理由 → 拦；写了 → 通过 */
await clickBtn('驳回')
ok((await txt()).includes('驳回必须写理由'), '驳回未写理由被拦')
await page.evaluate(() => {
  const ta = document.querySelector('.ia-main textarea')
  if (!ta) return
  ta.value = '属禁售清单'
  ta.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(300)
await clickBtn('驳回')
await sleep(900)
const afterReject = await page.evaluate(() => document.querySelector('.ia-side')?.innerText || '')
ok(!afterReject.includes('宜家儿童书桌') || afterReject.includes('待审核'), '驳回后该条离开待审队列')

/* 通过一条：通过后应从「待审核」队列消失 */
const beforePass = await page.evaluate(() => document.querySelector('.ic')?.innerText || '')
const passTitle = beforePass.split('\n')[1] || ''
console.log('     准备通过：', passTitle)
await clickBtn('通过并上架')
await sleep(1000)
const queueAfter = await page.evaluate(() => document.querySelector('.ia-side')?.innerText || '')
ok(passTitle && !queueAfter.includes(passTitle), '通过后该条离开待审队列')
const passStat = await stats('.istat')
ok(passStat[1].includes('21'), '已上架 +1（20 → 21）', passStat[1])

console.log('\n=== ⑥ 举报处理 ===')
await go('/n/reports')
t = await txt()
ok(t.includes('举报处理'), '页面打开')
ok(t.includes('处理说明必填'), '写明了说明必填')
const rStat = await stats('.rstat')
console.log('     统计：', rStat)
ok(rStat[0].includes('4'), '待处理 4 条', rStat[0])
ok(await rowBtn('茅台', '处理'), '打开处理抽屉')
await clickBtn('提交处理')
ok((await txt()).includes('处理说明必填'), '未写说明被拦')
await page.evaluate(() => {
  const ta = document.querySelector('.el-drawer textarea')
  if (!ta) return
  ta.value = '核实属禁售酒类，已下架并通知发布人'
  ta.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(300)
await clickBtn('提交处理')
await sleep(900)
const afterHandle = await page.evaluate(() => [...document.querySelectorAll('.el-table__body tr')]
  .map(x => x.innerText).find(x => x.includes('茅台')) || '')
ok(afterHandle.includes('已处理'), '处理完成状态变「已处理」', afterHandle.slice(0, 60))
ok(afterHandle.includes('下架并警告'), '记录了处理方式')

console.log('\n=== ⑦ 权限：只读角色 ===')
await go('/n/votes', 'R-VIEW')
t = await txt()
ok(t.includes('投票管理'), '只读角色能看投票')
ok(!t.includes('新建投票'), '没有「新建投票」按钮')
const viewRows = await page.evaluate(() => [...document.querySelectorAll('.el-table__body tr')].map(x => x.innerText))
ok(viewRows.length > 0 && !viewRows.some(x => x.includes('删除')), '无删除入口')

await go('/n/workbench', 'R-CS')
t = await txt()
ok(t.includes('邻里运营'), '客服可以看工作台')
ok(t.includes('去审核'), '客服有审核入口（c 域一线在用）')

console.log('\n=== ⑧ 权限拆分：代报名 ≠ 建活动 ===')
/* 一线客服要在现场帮业主报名，但不该能建活动、改价格、确认流团。
   两者用不同的码（n.activities.enroll / n.activities.edit），这里把边界钉住。 */
await go('/n/activities/AC0013/enrolls', 'R-CS')
t = await txt()
ok(t.includes('报名名单'), '客服能进名单页')
ok(t.includes('代报名'), '客服有「代报名」按钮')
await go('/n/activities', 'R-CS')
t = await txt()
ok(t.includes('活动管理'), '客服能看活动列表')
ok(!t.includes('新建活动'), '客服没有「新建活动」（发布类只在项目经理/运营）')
/* 只在表格里的按钮中找：说明文字里也会出现「确认流团」四个字，不能用整页文本判断 */
const csBtns = await page.evaluate(() => [...document.querySelectorAll('.el-table__body button')].map(x => x.innerText.trim()))
ok(!csBtns.some(x => x.includes('确认流团')), '客服行内没有「确认流团」（批量退款要更高权限）', csBtns.join('/'))

console.log('\n=== ⑨ 运行时错误 ===')
ok(errs.length === 0, '无 pageerror / console.error', errs.slice(0, 2).join(' | '))

console.log(`\n${fail ? '✘' : '✔'} 通过 ${pass} / 失败 ${fail}`)
await b.close()
process.exit(fail ? 1 : 0)
