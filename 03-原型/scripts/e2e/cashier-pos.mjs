/**
 * 收银台三栏 POS · 验收
 * ------------------------------------------------------------
 * 2026-11-13 收银台从「后台表单」重做成「左找人 / 中收钱 / 右结账」，
 * 旧的 cashier-pay / temp-charges / ticket-issue 三个脚本是按老 UI 写的，
 * 选择器已失效 —— 本脚本覆盖新结构，旧脚本保留作业务逻辑对照。
 *
 * 覆盖四件事：
 *   ① 三类业务各自的形态（账期格子 / 有效期 / 预充或抄表或自缴）
 *   ② 加收三个 tab（其他科目 / 押金 / 临时收费）
 *   ③ 合计必须拆成 收入类 / 押金 / 实收 三行 —— 押金进收入就是虚增营收
 *   ④ 收款后：账单销账、车位有效期前移、清单清空
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
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)) })
page.on('pageerror', e => errs.push('pageerror ' + String(e).slice(0, 120)))
await page.setViewport({ width: 1680, height: 1100 })

const txt = sel => page.evaluate(s => {
  const el = document.querySelector(s)
  return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''
}, sel)

async function open() {
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
  await page.evaluate(() => localStorage.setItem('wy_proto_role', 'R-GM'))
  await page.goto(`${BASE}/?t=${Date.now()}#/b/cashier`, { waitUntil: 'networkidle2' })
  await sleep(2400)
}

await open()

console.log('\n【一】三栏与三类业务')

ok(await page.$('.pos-left'), '左栏（客户）在')
ok(await page.$('.pos-mid'), '中栏（业务）在')
ok(await page.$('.pos-right'), '右栏（结算）在')

const cells = await page.evaluate(() => [...document.querySelectorAll('.pcell')].map(x => ({
  t: x.innerText.replace(/\s+/g, ' ').trim(),
  cls: x.className
})))
const gridCounts = await page.evaluate(() =>
  [...document.querySelectorAll('.pgrid')].map(g => g.children.length))
ok(gridCounts.length === 2, '账期分成两段（欠费段 / 预缴段）', gridCounts.join(' + '))
ok(gridCounts[1] === 12, '预缴段铺满未来 12 期', `${gridCounts[1]} 格`)
ok(cells.filter(c => c.cls.includes('is-due')).length > 0, '有欠费格（红）')
ok(cells.filter(c => c.cls.includes('is-fut')).length > 0, '有未到期格（虚线）')
const psegs = await page.evaluate(() =>
  [...document.querySelectorAll('.pseg')].map(x => x.innerText.replace(/\s+/g, ' ').trim()))
ok(psegs.some(t => t.includes('未来 12 个月')), '预缴段有段头', psegs.join(' | ').slice(0, 60))

const parkTxt = await txt('.park')
ok(parkTxt.includes('有效期至'), '车位块显示有效期而不是"欠几期"', parkTxt.slice(0, 40))
ok(/剩 \d+ 天|已失效/.test(parkTxt), '车位显示剩余天数 / 失效态')

const utilTxt = await txt('.util')
ok(/预充买量|抄表账单|系统不参与/.test(utilTxt), '水电块按项目配置呈现形态')
ok(/元\/度|元\/吨/.test(utilTxt), '水电单价来自价目表')

console.log('\n【二】点账期 + 车位续期 + 押金')

/* 口径一致性：客户条写的"欠 N 期"必须等于红格数，否则前台第一句就被业主问住 */
const redCount = cells.filter(c => c.cls.includes('is-due')).length
const whoTxt = await txt('.who')
ok(new RegExp(`物业费欠 ${redCount} 期`).test(whoTxt), '「欠 N 期」与红格数量一致', whoTxt.slice(0, 46))

await page.evaluate(() => {
  [...document.querySelectorAll('.blk__hd .el-button')].find(x => x.innerText.includes('全选欠费'))?.click()
})
await sleep(700)
const allDebt = await txt('.blk__pick')
ok(new RegExp(`已选 ${redCount} 期`).test(allDebt), '「全选欠费」一次选齐（有单销账 / 无单补缴）', allDebt)

const dueIdx = await page.evaluate(() => [...document.querySelectorAll('.pcell')]
  .map((x, i) => x.className.includes('is-due') ? i : -1).filter(i => i >= 0))
await page.evaluate(n => document.querySelectorAll('.pcell')[n].click(), dueIdx[0])
await sleep(400)
ok((await txt('.cart')).includes('物业服务费'), '点账期格子后进入右栏清单')

await page.evaluate(() => document.querySelector('.park__act .el-button')?.click())
await sleep(700)
ok((await txt('.cart')).includes('车位管理服务费'), '车位续期加入清单')

await page.evaluate(() => {
  [...document.querySelectorAll('.addtabs span')].find(x => x.innerText === '押金')?.click()
})
await sleep(400)
ok((await txt('.addrow')).includes('押金'), '押金面板展开')
await page.evaluate(() => {
  [...document.querySelectorAll('.addrow .el-button')].find(x => x.innerText.includes('加入'))?.click()
})
await sleep(700)
const cartTxt = await txt('.cart')
ok(cartTxt.includes('押金'), '押金进入清单')
ok(cartTxt.includes('不计收入'), '清单上标明押金不计收入')

console.log('\n【三】合计必须拆三行')

const sumTxt = await txt('.sum')
ok(sumTxt.includes('收入类合计'), '有「收入类合计」')
ok(sumTxt.includes('押金'), '有「押金（负债，不计收入）」单独一行')
ok(sumTxt.includes('本次实收'), '有「本次实收」')
const nums = sumTxt.match(/[\d,]+\.\d{2}/g) || []
ok(nums.length >= 3, '三个金额都在（收入 / 押金 / 实收）', nums.join(' / '))

console.log('\n【四】其他科目加收')

await page.evaluate(() => {
  [...document.querySelectorAll('.addtabs span')].find(x => x.innerText === '其他科目')?.click()
})
await sleep(400)
/* el-select 的可点区域是 __wrapper，点外层 .el-select 不展开 */
const itemOpts = await page.evaluate(() => {
  const s = document.querySelector('.addrow .el-select__wrapper')
  s?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return !!s
})
await sleep(600)
const optCount = await page.evaluate(() =>
  [...document.querySelectorAll('.el-select-dropdown__item')].filter(x => x.getBoundingClientRect().height > 0).length)
ok(itemOpts && optCount > 0, '其他科目下拉有可选项', `${optCount} 项`)

console.log('\n【五】收款落库')

/* 不写死 parkId：一户可能多个车位，默认选中的那个才是被续的 */
const parkBefore = await txt('.park__s')
const totalBefore = await txt('.sum__total')
await page.evaluate(() => {
  [...document.querySelectorAll('.pay-actions .el-button')].find(x => x.innerText.includes('收款'))?.click()
})
await sleep(2400)
const msg = await page.evaluate(() =>
  [...document.querySelectorAll('.el-message')].map(x => x.innerText).join(' | '))
ok(/收款 ¥/.test(msg), '收款成功有提示', msg.slice(0, 70))
ok(!(await page.evaluate(() => !!document.querySelector('.cart .ci'))), '收款后清单清空')

const parkAfter = await txt('.park__s')
ok(parkBefore !== parkAfter, '车位有效期已前移（落库后界面跟着变）', `${parkBefore} → ${parkAfter}`)

ok(await page.evaluate(() => !!document.querySelector('.pay-done')), '右栏出现收款结果卡（可当场开票）')

console.log('\n【六】业态取价：商业户单价跟着变')

await open()
const switched = await page.evaluate(() => {
  const hit = [...document.querySelectorAll('.oitem')].find(x => x.innerText.includes('星光天地'))
  if (!hit) return false
  hit.click(); return true
})
ok(switched, '切到星光天地（P03，电=预充 / 水=抄表）')
await sleep(2000)
const bizUtil = await txt('.util')
ok(/0\.8 元\/度|0\.9 元\/度|1 元\/度/.test(bizUtil), '商业电价按业态取到（0.8 / 0.9 / 1.0）', bizUtil.slice(0, 60))
ok(bizUtil.includes('5.55'), '商业水价 5.55')

console.log('\n【七】独立页与入口')

ok(!(await page.evaluate(() => !!document.querySelector('.app-shell'))), '收银台不套后台外壳（无侧栏）')
ok(await page.evaluate(() => !!document.querySelector('.pos-bar')), '自带顶栏（项目 / 收银员 / 退出）')
ok(await page.evaluate(() => {
  const menu = [...document.querySelectorAll('.side-item, .side-group a, .side-group div')]
  return !menu.some(x => (x.innerText || '').trim() === 'PC 收银台')
}), '左侧菜单里不再挂收银台')

console.log('\n【八】物业费预缴：单点 + 快捷 3/6/12 期')

await open()
const futIdx = await page.evaluate(() => [...document.querySelectorAll('.pcell')]
  .map((x, i) => x.className.includes('is-fut') ? i : -1).filter(i => i >= 0))
ok(futIdx.length >= 11, '未来月份可点（不止 2~3 期）', `${futIdx.length} 格`)
await page.evaluate(n => document.querySelectorAll('.pcell')[n].click(), futIdx[0])
await sleep(600)
const prepayCart = await txt('.cart')
ok(prepayCart.includes('预缴'), '点未到期格子生成预缴项（不再提示"先去出单"）', prepayCart.slice(0, 50))
ok(await page.evaluate(() => !!document.querySelector('.pcell.is-picked')), '预缴的格子也有选中态')

/* 快捷 12 个月：一次选满一年，金额直接写在按钮上 */
const clickQuick = n => page.evaluate(m => {
  [...document.querySelectorAll('.pquick > span')].find(x => x.innerText.includes(m + ' 个月'))?.click()
}, n)

await clickQuick(12)
await sleep(700)
const picked12 = await page.evaluate(() => document.querySelectorAll('.pcell.is-picked').length)
ok(picked12 === 12, '点「12 个月」一次选中 12 期', `${picked12} 期`)
const segSum = await txt('.blk__pick')
ok(/已选 12 期/.test(segSum), '块头显示已选期数与合计金额', segSum)
const quickAmt12 = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.pquick > span')].find(x => x.innerText.includes('12 个月'))
  return el ? el.innerText.replace(/\s+/g, ' ') : ''
})
ok(/¥/.test(quickAmt12), '快捷按钮上直接写出该档金额', quickAmt12)
const numOf = s => (String(s).match(/[\d,]+\.\d{2}/) || [''])[0].replace(/,/g, '')
ok(numOf(quickAmt12) && numOf(quickAmt12) === numOf(segSum),
  '按钮金额与「已选合计」一致（月份和费用是同一份数据）', `${numOf(quickAmt12)} vs ${numOf(segSum)}`)
const cart12 = await txt('.cart')
ok(/共 \d+ 期/.test(cart12), '右栏预缴合并成一行（十几条不撑爆清单）', cart12.slice(0, 60))

await clickQuick(6)
await sleep(600)
const picked6 = await page.evaluate(() => document.querySelectorAll('.pcell.is-picked').length)
ok(picked6 === 6, '换成「6 个月」后只留 6 期（快捷档是替换不是叠加）', `${picked6} 期`)

/* 单点仍然可以：清空后点一格 → 只剩 1 期 */
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.pquick > span')].find(x => x.innerText.includes('清空'))
  el?.click()
})
await sleep(500)
ok((await page.evaluate(() => document.querySelectorAll('.pcell.is-picked').length)) === 0, '「清空」撤销预缴选择')
await page.evaluate(n => document.querySelectorAll('.pcell')[n].click(), futIdx[2])
await sleep(500)
ok((await page.evaluate(() => document.querySelectorAll('.pcell.is-picked').length)) === 1, '手点单期仍可用')

console.log('\n【九】水电金额 ⇄ 用量实时换算')

const sw = await page.evaluate(() => {
  const hit = [...document.querySelectorAll('.oitem')].find(x => x.innerText.includes('星光天地'))
  if (!hit) return false
  hit.click(); return true
})
ok(sw, '切到 P03（电=预充）')
await sleep(2000)
/* el-input-number 在 precision 下逐字输入会被重新格式化（输 500 变成 0.50），
   键盘模拟不可靠 —— 用原生 setter 触发一次 input 事件，走组件自己的解析 */
await page.evaluate(() => {
  const inp = document.querySelectorAll('.ucard .el-input-number input')[0]
  if (!inp) return
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, '500')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
})
await sleep(900)
const pair = await page.evaluate(() =>
  [...document.querySelectorAll('.ucard .el-input-number input')].map(x => x.value))
ok(pair[0] === '500.00' && Number(pair[1]) > 0, '输 500 元 → 度数自动算出', pair.join(' / '))
ok(Number(pair[1]) === Math.round(500 / 0.8 * 100) / 100,
  '换算用的是业态价 0.8（不是收费项上的 0.62）', pair[1])

console.log('\n【十】其他科目金额自动带出')

await page.evaluate(() => {
  [...document.querySelectorAll('.addtabs span')].find(x => x.innerText === '其他科目')?.click()
})
await sleep(400)
await page.evaluate(() => {
  document.querySelector('.addrow .el-select__wrapper')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(600)
await page.evaluate(() => {
  [...document.querySelectorAll('.el-select-dropdown__item')].filter(x => x.getBoundingClientRect().height > 0)[0]?.click()
})
await sleep(700)
const amtVal = await page.evaluate(() => {
  const ins = [...document.querySelectorAll('.addrow .el-input-number input')]
  return ins[1]?.value || ''
})
ok(Number(amtVal) > 0, '选科目后金额框自动带出单价（不再是 0.00）', amtVal)
await page.evaluate(() => {
  [...document.querySelectorAll('.addrow .el-button')].find(x => x.innerText.includes('加入'))?.click()
})
await sleep(600)
ok((await page.evaluate(() => document.querySelectorAll('.cart .ci').length)) === 1, '其他科目加入清单')

console.log('\n【十一】散客 / 外来人员（摆摊费，不挂户）')

await open()
const pickedWalkin = await page.evaluate(() => {
  const hit = [...document.querySelectorAll('.oitem')].find(x => x.innerText.includes('散客'))
  if (!hit) return false
  hit.click(); return true
})
ok(pickedWalkin, '左栏有常驻「散客 / 外来人员」入口')
await sleep(1200)
ok(await page.evaluate(() => !!document.querySelector('.who--guest')), '中栏切成散客形态（不套业主档案）')
ok((await txt('.pos-mid')).includes('临时收费'), '中栏仍有临时收费')
ok(await page.evaluate(() => document.querySelectorAll('.pcell').length === 0), '散客没有账期格子（不挂户就没有应收）')
ok(await page.evaluate(() => document.querySelectorAll('.util').length === 0), '散客没有水电块')
ok((await txt('.temphint')).includes('外部人员'), '临时收费标明按「外部人员」入账', await txt('.temphint'))
ok((await txt('.guestwarn')).includes('付款人'), '未填姓名时给出提示')

/* 填姓名 → 金额 → 加入 → 收款 */
const setVal = (sel, v) => page.evaluate((s, val) => {
  const inp = document.querySelector(s)
  if (!inp) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, val)
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}, sel, v)

await setVal('.guestf .el-input input', '陈记糖油果子')
await setVal('.addrow .el-input input', '摆摊费')
await setVal('.addrow .el-input-number input', '200')
await sleep(600)
ok(!(await page.evaluate(() => !!document.querySelector('.guestwarn'))), '填完姓名后提示消失')

await page.evaluate(() => {
  [...document.querySelectorAll('.addrow .el-button')].find(x => x.innerText.includes('加入'))?.click()
})
await sleep(600)
const gcart = await txt('.cart')
ok(gcart.includes('摆摊费'), '散客临时收费进入清单', gcart.slice(0, 50))
ok(gcart.includes('散客'), '清单上标出「散客」')

/* 收款前先确认按钮可用（不能因为 p 为空就禁用） */
ok(await page.evaluate(() => {
  const b = [...document.querySelectorAll('.pay-actions .el-button')].find(x => x.innerText.includes('收款'))
  return b && !b.disabled
}), '收款按钮可用（散客没有业主档案也能收）')

await page.evaluate(() => {
  [...document.querySelectorAll('.pay-actions .el-button')].find(x => x.innerText.includes('收款'))?.click()
})
await sleep(2000)
const gmsg = await page.evaluate(() =>
  [...document.querySelectorAll('.el-message')].map(x => x.innerText).join(' | '))
ok(/收款 ¥/.test(gmsg), '散客收款成功', gmsg.slice(0, 80))
ok((await txt('.pay-done')).includes('散客'), '收款结果标明散客与临时收费', (await txt('.pay-done')).slice(0, 60))
ok((await txt('.recent')).includes('陈记糖油果子'), '「最近散客收款」当场刷新出这笔（可回答"我上午交过了"）')
ok(!(await txt('.recent')).includes('待收款'), '台账状态是「已收款」而不是停在「待收款」', (await txt('.recent')).slice(0, 80))

/* 台账核对：这条钱必须能在临时收费台账里查到，且付款方是「外部」
   走 hash 跳转而不是整页 reload —— mock 数据留在内存里，reload 就没了 */
await page.evaluate(() => { location.hash = '#/b/temp-charges' })
await sleep(1600)
const ledger = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
ok(ledger.includes('陈记糖油果子'), '临时收费台账能查到这笔（付款方 = 外来单位）')
ok(ledger.includes('摆摊费'), '台账上事由是「摆摊费」')

console.log('\n【十二】控制台')
ok(errs.length === 0, '零 console 错误', errs.slice(0, 2).join(' | '))

await b.close()
console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
