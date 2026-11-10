/**
 * 员工端主线冒烟（自包含）
 * ------------------------------------------------------------
 * 覆盖：四个身份 × 五个模块 —— 巡检、工单、审批、整改、楼栋/欠费，外加考勤、工资条、费用看板与权限门，
 * 以及三态（断网待同步 / 无相机占位 / 超时）与监督分支（漏选责任人拦截）。
 *
 * 用法：
 *   node scripts/smoke.mjs                        # 默认打 http://localhost:5199（没起就自己起 dev:h5）
 *   node scripts/smoke.mjs --base http://localhost:5211
 *   CHROME_PATH=... node scripts/smoke.mjs
 *
 * 退出码：有断言失败或控制台报错 → 1
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SHOTS = path.join(ROOT, 'screenshots')
const argv = process.argv.slice(2)
const argBase = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : ''
const BASE = argBase || 'http://localhost:5199'

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
]
  .filter(Boolean)
  .find(p => fs.existsSync(p))
if (!CHROME) {
  console.error('找不到 Chrome，请设 CHROME_PATH')
  process.exit(2)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const errsByPage = new Map()
function pass(name, note = '') {
  results.push({ name, ok: true })
  console.log(`  ✓ ${name}${note ? '  ' + note : ''}`)
}
function fail(name, why) {
  results.push({ name, ok: false, why })
  console.log(`  ✗ ${name} — ${why}`)
}
function check(name, cond, why = '') {
  cond ? pass(name) : fail(name, why || '条件不成立')
}

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch (e) {
    return false
  }
}

let server = null
async function ensureServer() {
  if (await reachable(BASE)) return
  console.log(`· ${BASE} 未响应，启动 dev:h5 …`)
  server = spawn('npm', ['run', 'dev:h5'], { cwd: ROOT, stdio: 'ignore' })
  for (let i = 0; i < 120; i++) {
    await sleep(1000)
    if (await reachable(BASE)) {
      await sleep(2000)
      return
    }
  }
  throw new Error('dev 服务器 120 秒内没起来')
}

/* ---------------- 页面操作 ---------------- */
let page
const shot = async name => {
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}
const bodyText = () => page.evaluate(() => document.body.innerText)
const has = async needle => (await bodyText()).includes(needle)

async function waitText(needle, timeout = 9000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await has(needle)) return true
    await sleep(200)
  }
  return false
}

/**
 * 等某个元素出现。
 * `visible()` 是"此刻在不在"，页面还在渲染时会直接判 false ——
 * 操作完立刻断言就会偶发失败（负载高时尤其明显）。要断言"操作后应该有"就用这个。
 */
async function waitFor(sel, timeout = 4000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(s => !!document.querySelector(s), sel)) return true
    await sleep(200)
  }
  return false
}

async function tapText(needle, { exact = false } = {}) {
  const clicked = await page.evaluate(
    (needle, exact) => {
      const all = [...document.querySelectorAll('uni-view,uni-text,uni-button,div,span,text')]
      const hit = all
        .filter(n => {
          const s = (n.innerText || '').trim()
          return exact ? s === needle : s.includes(needle)
        })
        .filter(n => ![...n.children].some(c => (c.innerText || '').trim() === needle))
      if (!hit.length) return false
      hit[hit.length - 1].click()
      return true
    },
    needle,
    exact
  )
  if (clicked) await sleep(700)
  return clicked
}

/** 先 scrollIntoView 再在页面里点：避免固定底栏挡住坐标点击 */
async function tapSel(sel, idx = 0, wait = 700) {
  const ok = await page.evaluate(
    (sel, idx) => {
      const el = document.querySelectorAll(sel)[idx]
      if (!el) return false
      el.scrollIntoView({ block: 'center' })
      el.click()
      return true
    },
    sel,
    idx
  )
  if (ok) await sleep(wait)
  return ok
}

async function visible(sel) {
  return (await page.$(sel)) !== null
}

async function count(sel) {
  return (await page.$$(sel)).length
}

/** uni 的 input 外面还有一层容器，直接键入容易残留旧值：用原生 setter + input 事件驱动 v-model */
async function setInputValue(sel, value) {
  const ok = await page.evaluate(
    (sel, value) => {
      const root = document.querySelector(sel)
      if (!root) return false
      /* uni 会把 input/textarea 包一层自定义元素：要拿到真正的表单元素再赋 */
      const el = root.matches('input,textarea') ? root : root.querySelector('input,textarea')
      if (!el) return false
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    },
    sel,
    value
  )
  await sleep(300)
  return ok
}

async function typeInto(sel, text) {
  const el = await page.$(sel)
  if (!el) return false
  await el.click()
  await page.keyboard.type(text, { delay: 12 })
  await sleep(200)
  return true
}

async function goto(hash) {
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'networkidle2' })
  await sleep(1000)
}

async function hOverflow() {
  return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))
}

function collectErrors() {
  page.on('console', m => {
    if (m.type() !== 'error') return
    const arr = errsByPage.get(page.url()) || []
    arr.push('[console] ' + m.text())
    errsByPage.set(page.url(), arr)
  })
  page.on('pageerror', e => {
    const arr = errsByPage.get(page.url()) || []
    arr.push('[pageerror] ' + e.message)
    errsByPage.set(page.url(), arr)
  })
}

/** 用登录页切身份：换人即换权限 */
/**
 * 切身份。
 *
 * 原来只 `return waitText(name)` —— 调用方不看返回值，于是**切换失败时静默继续**：
 * 后面一整段都用错的身份跑，报出来的是"一线看不到邻里入口（其实看得到）"这种
 * 莫名其妙的话，一条真错变成八条假错。
 *
 * 现在最多重试 3 次（负载高时首屏确实会慢到 5 秒以上），
 * 仍然失败就**明确记一条并抛错**，让失败点落在切换本身，而不是后续断言。
 */
async function asPersona(idx, name) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await goto('/pages/login/index')
    await tapSel('.pcard', idx, 1300 + attempt * 600)
    if (await waitText(name, 6000)) return
  }
  throw new Error(`身份切换失败：期望「${name}」，重试 3 次页面都没显示`)
}

async function settleLocation() {
  const t0 = Date.now()
  while (Date.now() - t0 < 14000) {
    const t = await bodyText()
    if (t.includes('定位成功')) return 'ok'
    if (t.includes('无法定位')) return 'fail'
    await sleep(300)
  }
  return 'timeout'
}

/* ---------------- 主流程 ---------------- */
async function main() {
  await ensureServer()
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  collectErrors()

  /* ---------- 1. 登录 ---------- */
  console.log('\n[1] 登录 / 四个身份')
  await goto('/pages/login/index')
  check('登录页渲染', (await waitText('员工端')) && (await has('演示日期 2026-10-21')))
  const names = ['周明', '汪磊', '莫瑞', '徐悦']
  const found = await Promise.all(names.map(n => has(n)))
  check('四个身份都在', (await count('.pcard')) === 4 && found.every(Boolean))
  await shot('01-login')

  /* ---------- 2. 工作台 ---------- */
  console.log('\n[2] 工作台 · 按角色装配')
  await tapSel('.pcard', 1, 1500)
  check('进入工作台', await waitText('工作台'))
  const homeTxt = await bodyText()
  check('班组长看到审批/巡检/工单/整改四类', ['待我审批', '今日巡检', '可接工单', '待办整改'].every(t => homeTxt.includes(t)))
  check('班组长没有「欠费户」入口', !homeTxt.includes('欠费户'))
  check('模块按权限显示（有审批入口、无费用看板入口）', (await visible('#mod-oa')) && !(await visible('#mod-finance')))
  check('工作台无横向溢出', (await hOverflow()) <= 1, `overflow=${await hOverflow()}px`)
  await shot('02-home-lead')

  /* ---------- 3. OA 审批 ---------- */
  console.log('\n[3] OA 审批 · 谁能审由节点决定')
  await tapSel('#mod-oa', 0, 1300)
  check('进入审批列表', await waitText('谁能审，是按节点算的'))
  const oaTodo = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.seg__i')][0]
    return Number((t?.innerText.match(/\d+/) || [0])[0])
  })
  check('客服主管节点有单可处理', oaTodo > 0, `待我处理=${oaTodo}`)
  await shot('03-oa-list')

  await tapSel('.card', 0, 1300)
  check('进入审批详情', await waitText('审批流'))
  check('详情写明这单归我处理', await has('这单归你处理'))
  await shot('04-oa-detail')
  await tapSel('#oa-approve', 0, 800)
  await typeInto('.textarea', '同意，材料齐全')
  await tapSel('#oa-confirm', 0, 1800)
  check('通过后回到列表', await waitText('谁能审，是按节点算的'))
  await tapSel('#oa-done', 0, 900)
  const doneN = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.seg__i')][2]
    return Number((t?.innerText.match(/\d+/) || [0])[0])
  })
  check('已办列表里有刚处理的单', doneN > 0, `已办=${doneN}`)
  await shot('05-oa-done')

  /* ---------- 3b. 会签 / 价目快照 / 移动端不办的节点 ---------- */
  console.log('\n[3b] 会签进度 · 价目快照 · 合同初审')
  await asPersona(3, '徐悦')
  await goto('/pages/oa/detail?id=AP00100')
  check('会签单显示进度与名单', (await has('会签名单')) && (await has('1/2')) && (await has('正职')) && (await has('副职')))
  check('会签节点写明"全部同意才通过"', await has('全部同意才通过'))
  check('已签过的人看不到通过按钮（不是点了没反应）', !(await visible('#oa-approve')))
  await shot('4-oa-sign')

  await goto('/pages/oa/detail?id=AP00092')
  check('合同初审：明确告知去 PC 办', (await waitText('PC 端办理')) && !(await visible('#oa-approve')))

  /* 价目快照：详情读下单时的 priceCode 与总价，不反查字典 */
  const paidWo = JSON.parse(fs.readFileSync(path.resolve(ROOT, '../03-原型/src/mock/workOrders.json'), 'utf8'))
    .find(w => w.type === '商业服务' && w.feeType === '收费' && w.priceCode)
  await goto(`/pages/wo/detail?id=${paidWo.woId}`)
  check(
    '详情按快照显示服务项目与下单总价',
    (await has(paidWo.priceCode)) && (await has('下单总价')) && (await has(`¥${Number(paidWo.totalFee).toFixed(2)}`)),
    `${paidWo.woNo} ${paidWo.priceCode} ¥${paidWo.totalFee}`
  )
  const pubWo = JSON.parse(fs.readFileSync(path.resolve(ROOT, '../03-原型/src/mock/workOrders.json'), 'utf8'))
    .find(w => w.type === '公共区域维修' && w.status === '已完工')
  await goto(`/pages/wo/detail?id=${pubWo.woId}`)
  check('公区单不显示提成，并说明不收费', !(await has('本单提成')) && (await has('不向业主收费')))
  await shot('4b-wo-public')

  /* ---------- 3c. 发起申请（一线也要能报） ---------- */
  console.log('\n[3c] 发起申请：一线也能提交，表单来自后台配置')
  await asPersona(0, '周明')
  await goto('/pages/oa/list')
  check('一线能看到「发起申请」入口', await visible('#oa-apply'))
  check('没有审批权时不出现「待我处理」页签', !(await visible('#oa-todo')))
  await shot('4c-oa-list-lead')
  await tapSel('#oa-apply', 0, 1500)
  check('发起页按配置渲染 6 类单据', (await count('.type')) === 6, `types=${await count('.type')}`)
  await tapSel('#type-LEAVE', 0, 800)
  await tapSel('#opt-leaveType-事假', 0, 300)
  await tapSel('#f-startAt-today', 0, 300)
  await tapSel('#f-endAt-tomorrow', 0, 300)
  await setInputValue('#f-hours', '8')
  await setInputValue('#f-handover', '孙德海')
  await setInputValue('#f-reason', '家中老人住院，需陪护一天')
  check(
    '审批路径给出节点、审批人与时限',
    (await has('直属上级审批')) && (await has('限时')) && (await has('部门负责人复核'))
  )
  await shot('4d-oa-apply')
  await tapSel('#oa-submit', 0, 1700)
  const spNo = await page.evaluate(() => (document.body.innerText.match(/SP-\d{4}-\d{4}/) || [''])[0])
  check('提交成功并给出单据号', !!spNo, spNo)
  check('结果页写明下一站审批人', await has('下一站'))
  await shot('4e-oa-applied')
  await tapSel('#oa-see-mine', 0, 1600)
  check('新单据出现在「我发起」', await has(spNo))

  /* ---------- 4. 工单 ---------- */
  console.log('\n[4] 工单 · 抢单（付费入户）+ 现场增项 + 收款')
  await asPersona(0, '周明')
  await goto('/pages/wo/list')
  check('进入工单列表（可抢页签）', await waitText('可抢'))
  const grabN = await page.evaluate(() => Number(document.querySelector('#wo-grab .seg__n')?.textContent || 0))
  check('抢单池有可抢的付费入户单', grabN > 0, `可抢=${grabN}`)
  check('列表直接给出提成金额', await has('提成'))
  check('本月抢单提成卡可见', await visible('#commission'))
  check('工单列表无横向溢出', (await hOverflow()) <= 1)
  await shot('06-wo-list')

  const grabbedNo = await page.evaluate(() => document.querySelector('.card .foot__no')?.textContent?.trim() || '')
  await tapSel('.grab', 0, 1500)
  check('抢单后落到「我的 / 在办」', (await has('在办')) && (await has(grabbedNo)), grabbedNo)

  await tapSel('.card', 0, 1300)
  check('进入工单详情（费用与提成）', await waitText('费用与提成'))
  check('详情给出价目编码与标准价', await has('RP-'))
  check('业主电话默认脱敏', await has('****'))
  await shot('07-wo-detail')

  await tapSel('#wo-arrive', 0, 1200)
  check('到场打卡记下时间', await has('到场时间'))

  await tapSel('#wo-finish', 0, 900)
  await tapSel('#addon-AD-D01', 0, 800)
  check('增项进入「待业主确认」', await has('待业主确认'))
  await typeInto('.textarea', '已疏通，试水顺畅，拆旧清运已完成')
  await tapSel('#wo-finish-confirm', 0, 900)
  check('增项未确认时不让完工（防结错账）', await visible('#addon-owner-confirm'))
  await shot('08-wo-addon')
  await tapSel('#addon-owner-confirm', 0, 1000)
  check('业主确认后增项合并到本单', await has('业主已确认'))
  await tapSel('#wo-finish-confirm', 0, 1600)
  check('完工成功', await has('已完工'))
  check('收费单完工后出现收款入口', await visible('#wo-pay'))
  await shot('09-wo-finished')

  await tapSel('#wo-pay', 0, 1100)
  check('收款页只出收款码、不经手现金', (await has('收款方为项目账户')) && (await has('现金不在此列')))
  await shot('10-wo-pay')
  await tapSel('#pay-qr-confirm', 0, 1500)
  check('支付后状态转已支付', await has('已支付'))
  check('提成从在途转已结', await has('已结'))
  await shot('11-wo-paid')

  await tapSel('#wo-rate', 0, 900)
  await tapSel('.rate-star', 3, 300)
  await tapSel('#wo-rate-confirm', 0, 1400)
  check('业主配合度已记录', await has('业主配合度'))

  /* 提成结算单：不进工资条，但要在工资条旁边有个入口 */
  console.log('\n[4c] 提成结算单（提成不进工资条）')
  await goto('/pages/payroll/commission')
  check('进入我的提成', await waitText('结算单'))
  check('结算单号与计提口径都在', (await has('TC202610-01')) && (await has('人工费 × 35%')))
  /* 不写死金额：抢到哪一单取决于池子排序，只校验「汇总 = 明细」且不为 0 */
  const cmVals = await page.evaluate(() => [...document.body.innerText.matchAll(/¥([\d.]+)/g)].map(m => Number(m[1])))
  check('已结金额 = 明细行金额且大于 0', cmVals[0] > 0 && cmVals[0] === cmVals[cmVals.length - 1], `¥${cmVals.join(' / ¥')}`)
  check('汇总写明已结单数', await has('已结（1 单）'))
  check('明细列出工单号与结算状态', (await has('BX202600151')) && (await has('已结')))
  check('写明次月随工资并入', await has('次月'))
  await shot('12g-commission')

  await goto('/pages/payroll/index')
  check('工资条页给出提成入口', await visible('#pay-commission'))
  await goto('/pages/mine/index')
  check('「我的」里有提成入口', await visible('#me-commission'))

  /* 派单：付费单只有项目经理能派；班组长只能派公区单 */
  console.log('\n[4b] 派单权限：付费单只有项目经理能派')
  await asPersona(3, '徐悦')
  await goto('/pages/wo/list')
  check('项目经理有「待派」页签', await visible('#wo-dispatch'))
  await goto('/pages/wo/detail?id=WO000153')
  check('项目经理可对付费单指派', await visible('#dispatch-btn'))
  await tapSel('#dispatch-btn', 0, 1100)
  const dispatchedTo = await page.evaluate(() => {
    const el = document.querySelector('.as__item')
    if (!el) return ''
    const name = el.innerText.split('\n')[0].split(' · ')[0]
    el.click()
    return name
  })
  await sleep(1400)
  check('派单后落到「已派单」并记下处理人', (await has('已派单')) && (await has(dispatchedTo)), dispatchedTo)
  await shot('12-wo-dispatched')

  await asPersona(1, '汪磊')
  await goto('/pages/wo/detail?id=WO000155')
  check('班组长能看付费单，但没有派单按钮', (await has('费用与提成')) && !(await visible('#dispatch-btn')))

  /* ---------- 5. 楼管 ---------- */
  console.log('\n[5] 楼栋管家 · 欠费与催收')
  await asPersona(2, '莫瑞')
  check('管家工作台有欠费待办', (await waitText('欠费')) && (await has('户欠费')))
  check('欠费待办只出现一次（不重复推同一条）', (await count('#todo-debt')) === 1, `出现 ${await count('#todo-debt')} 次`)
  await shot('09-home-steward')
  await tapText('户欠费')
  await sleep(1400)
  check('进入我的楼栋', await waitText('责任楼栋'))
  const bldTxt = await bodyText()
  check('汇总给出楼栋/房屋/欠费户/收缴率', ['责任楼栋', '房屋', '欠费户', '收缴率'].every(t => bldTxt.includes(t)))
  check('楼栋页无横向溢出', (await hOverflow()) <= 1)
  await shot('10-building')

  await tapSel('.hh', 0, 1100)
  check('打开一户欠费明细', await waitText('催收跟进'))
  await shot('11-building-house')
  await tapSel('#add-follow', 0, 900)
  await tapText('上门')
  await tapText('家中无人')
  await tapSel('#save-follow', 0, 1300)
  check('催收记录落库（重新打开能看到）', await has('上门'))
  await shot('12-building-follow')

  /* 业主与房屋现场维护：改手机号即时生效 */
  await tapSel('#open-house', 0, 1400)
  check('进入业主与房屋', (await waitText('业主信息')) && (await has('****')))
  await shot('12b-house')
  await tapSel('#edit-phone', 0, 900)
  await setInputValue('.sheet input', '13900001111')
  await tapSel('#edit-save', 0, 1400)
  check('手机号改完即时生效（脱敏也随之变化）', await has('139****1111'))
  await shot('12c-house-phone')

  /* 批量催缴：按房屋聚合 + 7 天去重 + 生成批次 */
  await goto('/pages/building/collect')
  check('进入批量催缴（按房屋聚合）', await waitText('按房屋聚合'))
  const pickN = await page.evaluate(() => Number(document.querySelector('.foot__n')?.textContent || 0))
  check('默认勾选可催的户（7 天内催过的不选）', pickN > 0, `已选=${pickN}`)
  check('催缴页无横向溢出', (await hOverflow()) <= 1)
  await shot('12d-collect')
  await tapSel('#batch-create', 0, 1000)
  await tapSel('#method-微信', 0, 400)
  await tapSel('#batch-confirm', 0, 1700)
  const batchNo = await page.evaluate(() => (document.body.innerText.match(/CJ\d{8}-\d{2}/) || [''])[0])
  check('生成催缴批次并给出批次号', !!batchNo, batchNo)
  check('结果页写明只发提醒不收款', await has('只发提醒，不收款'))
  await shot('12e-collect-batch')
  check('同批户 7 天内不再默认勾选', (await page.evaluate(() => Number(document.querySelector('.foot__n')?.textContent || -1))) === 0)
  await tapSel('#batch-back', 0, 1400)

  /* 租户与共住成员：租金不给管家看 */
  await goto('/pages/building/house?houseId=H010111001')
  check('房屋页展示在住租户与认证状态', (await waitText('住在里面的人')) && (await has('赵娟')) && (await has('信息不全')))
  check('租户不展示租金金额', !(await has('租金 ¥')))
  await shot('12f-house-residents')

  /* 业主标签：只选不建（字典维护要 e.ownerTags.edit，楼管没有） */
  await goto('/pages/building/house?houseId=H010111001')
  await sleep(600)
  check('业主卡显示已有标签', (await count('.otag')) > 0, `tags=${await count('.otag')}`)
  await tapSel('#edit-tags', 0, 1100)
  check('标签字典按分类列出（11 个启用标签）', (await count('.tg-chip')) >= 10, `chips=${await count('.tg-chip')}`)
  const onBefore = await count('.tg-chip.is-on')
  await tapSel('.tg-chip:not(.is-on):not(.is-disabled)', 0, 1000)
  check('点一下即打上标签并即时生效', (await count('.tg-chip.is-on')) === onBefore + 1)
  await shot('12g-owner-tags')
  await page.evaluate(() => document.querySelector('.sheet__mask')?.click())
  await sleep(500)

  /* 租户管理：核验门槛 -> 核验 -> 录人脸 */
  await tapSel('#tn-TN00001', 0, 1500)
  check('租户档案显示核验门槛与完整度', (await has('核验门槛')) && (await has('基础信息')))
  check('租户手机与证件默认脱敏', (await has('****')))
  await shot('12h-tenant')
  await tapSel('#tn-verify', 0, 1300)
  check('核验通过后状态转「已核验」', await has('已核验'))
  await tapSel('#tn-more', 0, 900)
  await tapSel('#tn-face', 0, 1300)
  check('录人脸后门禁状态更新', await has('已录人脸'))
  await shot('12i-tenant-verified')

  await goto('/pages/building/house?houseId=H010110501')
  await sleep(800)
  check('同一路由换房号后仍能重取数据（给出共住家庭成员）', (await waitText('共住家庭成员')) && (await has('配偶')))

  /* ---------- 6. 整改 ---------- */
  console.log('\n[6] 整改闭环（项目经理复核）')
  await asPersona(3, '徐悦')
  check('项目经理工作台有待办整改', await waitText('待办整改'))
  await goto('/pages/rectify/list')
  check('进入整改列表', await waitText('待我处理'))
  const rcN = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.seg__i')][0]
    return Number((t?.innerText.match(/\d+/) || [0])[0])
  })
  check('待复核单落在项目经理头上', rcN > 0, `待我处理=${rcN}`)
  await shot('13-rectify-list')

  await tapSel('.card', 0, 1400)
  check('进入整改详情', await waitText('整改项'))
  check('详情有流程与期限', (await has('流程')) && (await has('期限')))
  check('详情列出整改项', (await count('.it')) > 0, `整改项=${await count('.it')}`)
  check('详情列出整改项', (await count('.it')) > 0, `整改项=${await count('.it')}`)
  await shot('14-rectify-detail')
  if (await visible('#rc-pass')) {
    await tapSel('#rc-pass', 0, 900)
    await typeInto('.textarea', '现场复核到位')
    await tapSel('#rc-recheck-confirm', 0, 1600)
    check('复核通过后状态变已闭环', await waitText('已闭环'))
    await shot('15-rectify-closed')
  } else {
    fail('待复核单上有复核入口', '没找到复核按钮')
  }

  /* ---------- 7. 费用看板 ---------- */
  console.log('\n[7] 费用看板')
  await goto('/pages/finance/index')
  check('项目经理能看费用看板', (await waitText('本月收缴率')) && (await has('欠费 TOP')))
  check('费用看板无横向溢出', (await hOverflow()) <= 1)
  await shot('16-finance')

  /* ---------- 8. 考勤 / 工资条 ---------- */
  console.log('\n[8] 考勤 / 工资条（本人规则）')
  await asPersona(1, '汪磊')
  await goto('/pages/attendance/index')
  check('进入我的考勤', await waitText('近三个月'))
  check('考勤是月度汇总而非打卡', await has('不是逐日打卡'))
  await shot('17-attendance')
  const appealBtn = await page.$('.acts .btn--line')
  if (appealBtn) {
    await tapSel('.acts .btn--line', 0, 900)
    await typeInto('.textarea', '10 月 21 日在外勤，系统记成异常')
    await tapSel('#att-appeal-confirm', 0, 1300)
    check('考勤申诉已提交', await has('申诉记录'))
  } else {
    fail('有可申诉的月份', '没找到申诉入口')
  }

  await goto('/pages/payroll/index')
  check('工资条只列本人', (await waitText('只看本人')) && (await has('实发')))
  if ((await count('.card')) > 0) {
    await tapSel('.card', 0, 1300)
    check('工资条明细给出应发/代扣/实发', (await has('应发明细')) && (await has('代扣明细')))
    await shot('18-payroll')
  }

  /* ---------- 9. 权限门 ---------- */
  console.log('\n[9] 权限门')
  await goto('/pages/finance/index')
  check('班组长看费用看板被拦', await waitText('费用看板只对管理岗开放'))
  await shot('19-noperm-finance')
  await goto('/pages/building/index')
  check('班组长看楼栋工作台被拦', await waitText('楼栋工作台只对楼栋管家开放'))

  /* ---------- 10. 巡检主线（回归） ---------- */
  console.log('\n[10] 巡检主线（回归）')
  await asPersona(0, '周明')
  await goto('/pages/tasks/list')
  check('任务列表渲染', await waitText('我的任务'))
  const listTxt = await bodyText()
  check('三页签与超时置顶都在', ['待执行', '执行中', '已完成', '已超时'].every(t => listTxt.includes(t)))
  check('卡片直接给剩余/超时时间', /剩余 |已超时 /.test(listTxt))
  check('任务列表无横向溢出', (await hOverflow()) <= 1)
  await shot('20-task-list')

  await tapSel('.tc', 0, 1200)
  check('进入任务详情', await waitText('任务信息'))
  check('详情含检查项与位置', (await has('检查项（')) && (await has('作业位置')))
  await shot('21-task-detail')
  await tapSel('#act-btn', 0, 1400)
  check('进入打卡页', await waitText('到位定位'))
  const loc = await settleLocation()
  check('定位有结论（成功或降级）', loc !== 'timeout', `state=${loc}`)
  if (loc === 'fail') {
    check('降级写明人工打卡需复核', (await has('人工打卡')) && (await has('主管复核')))
    await shot('22-checkin-degraded')
  }
  if (await visible('#locate-manual')) await tapSel('#locate-manual', 0, 700)
  if (await visible('.scan__input')) await typeInto('.scan__input', 'P-1F-018')
  await tapSel('#checkin-confirm', 0, 1600)
  check('打卡后进入逐项执行', await waitText('逐项执行'))
  await shot('23-exec')

  await tapSel('#all-ok', 0, 800)
  check('「全部正常」一次判完', await has('已确认'))
  await tapSel('#judge-0-ng', 0, 800)
  check('异常展开说明区', await waitText('问题类型'))
  await tapSel('.ng .chip', 0, 400)
  await typeInto('.ng textarea', '3 号楼大堂地砖有油渍，已拍照留证')
  await tapSel('.pp__add', 0, 700)
  await tapText('相机不可用')
  await sleep(800)
  check('无相机落占位而不是报错', (await count('.pp__ph')) > 0)
  check('占位同时给了说明', await has('记为缺证'))
  await shot('24-exec-ng')

  /* 异常项就地转工单（P1 补的第 9 屏） */
  await tapSel('#to-wo-0', 0, 1400)
  check('进入转单页并带过来源检查项', (await waitText('来自巡检')) && (await has('消防')))
  await tapSel('#pri-紧急', 0, 400)
  await setInputValue('.body .textarea', '消火栓压力表指针在红区，箱内水带缺失，需工程组更换')
  await shot('24b-wo-create')
  await tapSel('#wo-create-submit', 0, 1600)
  const woNo = await page.evaluate(() => (document.body.innerText.match(/BX\d{9}/) || [''])[0])
  check('工单生成并给出工单号', !!woNo, woNo)
  await shot('24c-wo-created')
  await tapSel('#back-exec', 0, 1600)
  check('回到逐项执行且该项标出已转工单', await has('已转工单'))

  await tapSel('#submit-btn', 0, 1800)
  check('提交成功页', await waitText('提交成功'))
  check('给出达标项/异常项/得分', (await has('达标项')) && (await has('本次得分')))
  await shot('25-submit')

  /* ---------- 11. 断网 ---------- */
  console.log('\n[11] 断网 → 本地暂存 → 待同步')
  await goto('/pages/mine/index')
  await tapSel('#net-offline', 0, 700)
  await goto('/pages/tasks/list')
  check('列表顶部出现断网提示', await waitText('当前离线', 4000))
  await tapSel('.tc', 0, 1100)
  check('详情页也提示离线', await waitText('当前离线', 4000))
  await tapSel('#act-btn', 0, 1400)
  if (await waitText('无法定位', 4000)) await tapSel('#locate-manual', 0, 700)
  if (await visible('.scan__input')) await typeInto('.scan__input', 'B1-西坡道')
  await tapSel('#checkin-confirm', 0, 1600)
  if (!(await has('逐项执行'))) {
    if (await visible('#checkin-continue')) await tapSel('#checkin-continue', 0, 1600)
  }
  check('断网下也能进逐项执行', await waitText('逐项执行'))
  await tapSel('#all-ok', 0, 700)
  await tapSel('#submit-btn', 0, 1800)
  check('断网提交进本地队列', await waitText('已存本机'))
  await shot('26-offline-submit')
  await goto('/pages/mine/index')
  check('我的页列出待同步', await waitFor('#sync-now', 4000))
  await tapSel('#net-online', 0, 2500)
  check('回网后自动同步、队列清空', !(await visible('#sync-now')))

  /* ---------- 12. 监督核验 ---------- */
  console.log('\n[12] 监督核验')
  await asPersona(1, '汪磊')
  await goto('/pages/tasks/exec?taskId=IT00289')
  check('监督任务说明要指定责任人', await has('监督任务'))
  await tapSel('#all-ok', 0, 700)
  await tapSel('#judge-0-ng', 0, 700)
  await tapSel('.ng .chip', 0, 400)
  await typeInto('.ng textarea', '前台无人值守，工单超时未受理')
  await tapSel('#submit-btn', 0, 1400)
  check('漏选责任员工被拦下', await has('必须指定责任员工'))
  await tapSel('#resp-0', 0, 1000)
  await shot('27-sup-resp')
  await tapSel('.as__item', 0, 900)
  await tapSel('#submit-btn', 0, 2000)
  check('补齐责任人后提交成功', await waitText('提交成功'))
  check('监督结果标出考核归口', (await has('问题记到')) || (await has('抽查全部达标')))
  await shot('28-sup-submit')

  /* ---------- 13. 数字对齐 ---------- */
  /* ---------- 15. 通讯录 ---------- */
  console.log('\n[15] 通讯录（一线也能找同事）')
  await asPersona(0, '周明')
  await goto('/pages/home/index')
  check('工作台有通讯录入口', await visible('#mod-contacts'))
  await goto('/pages/contacts/index')
  check('通讯录按部门分组列出在职同事', (await count('.p')) > 100, `rows=${await count('.p')}`)
  check('部门 chips 是一级 + 二级（不铺三级班组）', (await count('.chip')) >= 4, `chips=${await count('.chip')}`)
  check('手机号明文（与员工档案的脱敏相反）', !(await has('****')))
  await shot('30-contacts')

  await setInputValue('#ct-kw', '1790')
  await sleep(700)
  check('搜手机后 4 位能命中', (await count('.p')) >= 1 && (await count('.p')) < 20, `hits=${await count('.p')}`)
  await tapSel('.p', 0, 700)
  check('点人能呼叫 / 复制', (await has('呼叫')) && (await has('复制号码')))
  await page.evaluate(() => document.querySelector('.sheet__mask')?.click())
  await sleep(400)

  await goto('/pages/mine/index')
  check('「我的」里也有通讯录入口', await visible('#me-contacts'))

  /* ---------- 16. 邻里（通讯录之外的第二块新功能） ---------- */
  console.log('\n[16] 邻里 · 待办 / 审核 / 举报 / 活动 / 代报名')
  await asPersona(1, '汪磊')
  await goto('/pages/home/index')
  check('班组长工作台有邻里待办卡', await visible('#mod-neighbor'))
  const nbDesc = await page.evaluate(() => document.querySelector('#mod-neighbor')?.innerText || '')
  check('卡片按本项目显示待审 / 待处理', nbDesc.includes('待审 3') && nbDesc.includes('待处理 2'), nbDesc.replace(/\n/g, ' '))

  await goto('/pages/neighbor/todo')
  check('待办分两个队列且数字对', (await has('待审 3')) && (await has('待处理 2')))
  check('闲置队列有 3 条', (await count('[id^=nb-item-]')) === 3, `items=${await count('[id^=nb-item-]')}`)
  await shot('31-neighbor-todo')

  await tapSel('[id^=nb-item-]', 0, 1300)
  check('审核页只到楼栋、不显示门牌', (await has('只到楼栋')) && !(await has('-0602')))
  await shot('32-neighbor-item')
  await tapSel('#nb-pass', 0, 1500)
  check('通过后待审数减少', await waitText('待审 2'))

  await tapSel('#nb-reports', 0, 900)
  check('举报队列有 2 条', (await count('[id^=nb-report-]')) === 2, `reports=${await count('[id^=nb-report-]')}`)
  await tapSel('[id^=nb-report-]', 0, 1300)
  check('举报页给出四个处置动作', (await count('.act')) === 4)
  await tapSel('#nb-act-2', 0, 400)
  await setInputValue('#nb-note', '图片确为活体交易，下架并提醒发布人')
  await shot('33-neighbor-report')
  await tapSel('#nb-handle', 0, 1500)
  check('处理完待处理数减少', await waitText('待处理 1'))

  await goto('/pages/neighbor/activity')
  check('活动只列本项目、未结束', (await has('本项目')) && (await has('待成行')) && (await has('报名中')))
  check('待成行显示还差几人成团', await has('还差'))
  check('报名中的卡片直接给代报名入口', await visible('#nb-ac-enroll-AC0016'))
  check('待成行的卡片没有代报名入口', !(await visible('#nb-ac-enroll-AC0014')))
  await shot('34-neighbor-activity')

  /* 列表内代报名：现场最短路径 —— 不进详情，卡片上直接开表单 */
  await tapSel('#nb-ac-enroll-AC0016', 0, 900)
  check('卡片上打开的就是同一张报名表', await visible('#nb-name'))
  await setInputValue('#nb-name', '王秀兰')
  await setInputValue('#nb-phone', '13800001111')
  await setInputValue('#nb-house', '1-2-0802')
  await tapSel('#nb-people-plus', 0, 400)
  await setInputValue('#nb-at-name-0', '王秀兰')
  await setInputValue('#nb-at-id-0', '510101199001010011')
  await setInputValue('#nb-at-name-1', '李小宝')
  await setInputValue('#nb-at-id-1', '510101201801010022')
  await tapSel('#nb-paid', 0, 300)
  await tapSel('#nb-pay-扫码', 0, 300)
  await shot('35-neighbor-enroll')
  await tapSel('#nb-submit', 0, 1700)
  check('列表内报名后人数当场刷新', await waitText('已报 2/40'))

  await tapSel('#nb-activity-AC0016', 0, 1400)
  check('活动详情给出退款分档', (await has('提前 7 天')) && (await has('100%')))
  check('新报的这条已进名单', (await has('王秀兰')) && (await has('前台代报')))

  await tapSel('#nb-enroll-btn', 0, 900)
  check('详情页打开的还是同一张表单', await visible('#nb-name'))
  await tapSel('.sheet__mask', 0, 500)

  await goto('/pages/neighbor/enroll?activityId=AC0014')
  check('待成行的活动不能报名', (await has('不能报名')) && (await visible('#nb-enroll-off')))

  await asPersona(0, '周明')
  await goto('/pages/home/index')
  check('一线（工程维修）看不到邻里入口', !(await visible('#mod-neighbor')))

  /* ---------- 17. 租售（审房源 / 回看房电话 / 我的联系方式） ---------- */
  console.log('\n[17] 租售 · 房源审核 / 看房请求 / 联系方式')

  /* 楼管：审核人与回拨人，但邻里只有只读权限 */
  await asPersona(2, '莫瑞')
  await goto('/pages/home/index')
  check('楼管工作台有看房请求卡', await visible('#mod-viewing'))
  check('楼管工作台有邻里待办卡（房源待审）', await visible('#mod-neighbor'))
  const mrNb = await page.evaluate(() => document.querySelector('#mod-neighbor')?.innerText || '')
  check('楼管的待审数只算房源', /待审 [1-9]/.test(mrNb), mrNb.replace(/\n/g, ' '))

  await goto('/pages/neighbor/todo')
  const mrListings = await count('[id^=nb-listing-]')
  check('楼管待审核里只有房源、没有闲置', mrListings > 0 && (await count('[id^=nb-item-]')) === 0,
    `房源 ${mrListings} / 闲置 ${await count('[id^=nb-item-]')}`)
  await tapSel('#nb-reports', 0, 700)
  check('楼管没有举报处理权，待处理为空', (await count('[id^=nb-report-]')) === 0)
  await tapSel('#nb-items', 0, 700)
  await shot('36-listing-queue')

  await tapSel('[id^=nb-listing-]', 0, 1400)
  check('审核页给产权核验标记', await has('产权人已核验'))
  check('审核页写明只看图 + 判断话术', (await has('审核只看图')) && (await has('陌生人找到这户人家')))
  check('审核页不核对面积户型', await has('档案派生，不用核对'))
  await shot('37-listing-audit')
  await tapSel('#lv-pass', 0, 1600)
  check('通过后状态变已发布', await waitText('已发布'))
  check('处理过的不能再审', await waitText('已处理，无需再审'))

  /* 驳回要写理由 */
  await goto('/pages/neighbor/todo')
  const rest = await count('[id^=nb-listing-]')
  if (rest > 0) {
    await tapSel('[id^=nb-listing-]', 0, 1400)
    await tapSel('#lv-reject', 0, 900)
    await tapSel('#lv-reject-ok', 0, 600)
    check('驳回不选理由被拦', await has('请选一条驳回理由'))
    await tapSel('#lv-reason-1', 0, 300)
    await setInputValue('#lv-note', '楼道特征明显，能定位到具体楼栋')
    await tapSel('#lv-reject-ok', 0, 1600)
    check('驳回后状态变已驳回', await waitText('已驳回'))
  }

  /* 看房请求：超时要一眼看出来，拨完能记结果 */
  await goto('/pages/listing/viewing')
  const before = await count('[id^=lv-view-]')
  check('看房请求列出待联系', before > 0, `待联系 ${before}`)
  check('超 24 小时的卡片标红', (await count('.vw.is-over')) > 0, `标红 ${await count('.vw.is-over')}`)
  await shot('38-listing-viewing')

  await tapSel('[id^=lv-view-]', 0, 900)
  check('处理弹层给全号与结果输入', (await visible('#lv-result')) && (await visible('#lv-call-sheet')))
  await tapSel('#lv-pick-0', 0, 300)
  await shot('39-listing-contact')
  await tapSel('#lv-contacted', 0, 1600)
  check('标记后待联系减少', (await count('[id^=lv-view-]')) === before - 1, `现在 ${await count('[id^=lv-view-]')}`)

  /* 我的 → 联系方式 */
  await goto('/pages/mine/index')
  check('「我的」有联系方式入口', await visible('#me-contact'))
  await tapSel('#me-contact', 0, 900)
  check('联系方式页写明给谁看', (await has('租售信息页')) && (await has('没有「是否公开」开关')))
  check('联系方式页不给手机号', await has('手机号只在内部通讯录里'))
  await setInputValue('#mc-wechat', 'wx_morui_demo')
  await tapSel('#mc-save', 0, 1600)
  await goto('/pages/mine/contact')
  const wx = await page.evaluate(() => document.querySelector('#mc-wechat input')?.value || '')
  check('保存后重新进页面能回填', wx === 'wx_morui_demo', `实际 ${wx}`)

  /* 客服：能接看房请求，但看不到房源待审 */
  await asPersona(1, '汪磊')
  await goto('/pages/home/index')
  check('客服也有看房请求卡', await visible('#mod-viewing'))
  await goto('/pages/neighbor/todo')
  check('客服待审核里只有闲置、没有房源',
    (await count('[id^=nb-item-]')) > 0 && (await count('[id^=nb-listing-]')) === 0)

  /* 项目经理：两类都有 */
  await asPersona(3, '徐悦')
  await goto('/pages/neighbor/todo')
  check('项目经理两类都能审',
    (await count('[id^=nb-item-]')) > 0 && (await count('[id^=nb-listing-]')) > 0)

  /* 一线：入口不出现 */
  await asPersona(0, '周明')
  await goto('/pages/home/index')
  check('一线看不到看房请求卡', !(await visible('#mod-viewing')))
  await goto('/pages/mine/index')
  check('一线没有联系方式入口', !(await visible('#me-contact')))

  /* ---------- 18. 消息 · 按类型分类 ---------- */
  console.log('\n[18] 消息 · 待办提醒 + 公告分类')
  await goto('/pages/msg/list')
  await sleep(1200)

  const chipTexts = () => page.evaluate(() =>
    [...document.querySelectorAll('.chip')].map(c => c.innerText.replace(/\s+/g, ' ').trim())
  )
  const groupHeads = () => page.evaluate(() =>
    [...document.querySelectorAll('.grp__hd')].map(g => g.innerText.replace(/\s+/g, ' ').trim())
  )

  /* ========== 待办提醒（有待办时默认落在这里） ========== */
  const chipsR = await chipTexts()
  const mHead = chipsR[0]?.match(/^待办\s*(\d+)$/)
  check('页签首位是「待办」且带数量', !!mHead, chipsR[0] || '')

  const groups = await groupHeads()
  check('一线只有工单与巡检两组',
    groups.length === 2 && groups[0].includes('工单') && groups[1].includes('巡检'), groups.join(' | '))

  /*
   * 待办条数**不写死**：前面几段跑过提交巡检、抢单、审核房源，条数到这一步已经不是初始值了
   * （第一版写死 21，实测变 17）。这里守的是内部一致性 ——
   * 顶部数字必须等于各组之和，否则就是"上面说 21、列表里只有 13"那种糊弄。
   */
  const headTotal = mHead ? Number(mHead[1]) : -1
  const groupNums = groups.map(g => Number((g.match(/(\d+)\s*$/) || [])[1] || 0))
  const groupSum = groupNums.reduce((a, b) => a + b, 0)
  check('顶部待办数 = 各组条数之和', headTotal === groupSum, `顶部 ${headTotal} vs 各组 ${groupSum}`)

  /* 每组封顶 5：卡片数 = Σmin(n,5)，多一张少一张都说明截断逻辑错了 */
  const expectCards = groupNums.reduce((a, n) => a + Math.min(n, 5), 0)
  check('卡片数 = 每组封顶 5 之和', (await count('.rm')) === expectCards,
    `实际 ${await count('.rm')} vs 期望 ${expectCards}（各组 ${groupNums.join('/')}）`)
  /* 「还有 N 条」只在某组真的超过 5 时才出现 */
  check('超 5 条的组才有「还有 N 条」',
    (await count('.grp__more')) === groupNums.filter(n => n > 5).length,
    `各组 ${groupNums.join('/')}`)
  await shot('42-msg-remind')

  /*
   * 工单列表与任务列表在 tabBar 上，只能用 switchTab 跳。
   * 用 navigateTo 会**静默失败** —— 页面上表现成"点了没反应"，
   * 而这类 bug 不会报错，只能靠点一下看 URL 变没变来抓。
   */
  if (await count('.grp__more')) {
    await tapSel('.grp__more', 0, 1500)
    check('「还有 N 条」跳到了工单列表', page.url().includes('/pages/wo/list'),
      page.url().split('#')[1] || '(未跳转)')
    await goto('/pages/msg/list')
    await sleep(900)
  }

  /*
   * 楼管必须也能看到待办：他的活是房源审核 + 看房回电。
   * 只做工单/巡检/审批的话他登录后是 0 —— 那这功能对一半身份无效（第一版就是这样）。
   */
  await asPersona(2, '莫瑞')
  await goto('/pages/msg/list')
  await sleep(1500)
  const moGroupsB = await groupHeads()
  /*
   * 这里**不断言"还剩几条"**：上面的租售段已经把莫瑞的待审房源审完了（一条通过、一条驳回），
   * 到这一步待办是 0 才是对的。要守的是**权限过滤** ——
   * 他没有 f.inspect.view 也没有 f.approval.handle，那两个组就不该出现。
   */
  check('楼管的待办里没有巡检与审批',
    !moGroupsB.some(g => g.includes('巡检') || g.includes('审批')), moGroupsB.join(' | '))
  check('楼管的待办只可能来自邻里与租售',
    moGroupsB.every(g => g.includes('邻里') || g.includes('租售')), moGroupsB.join(' | '))

  /* 回到周明，后面的段落按一线视角断言 */
  await asPersona(0, '周明')
  await goto('/pages/msg/list')
  await sleep(1000)

  /* ========== 公告分类 ========== */
  /* 页签第 0 位是「待办」，所以公告是第 1 位 */
  await tapSel('[id^="ntab-"]', 1, 900)
  const chips = await chipTexts()
  check('页签 8 项（待办 + 全部公告 + 6 类）', chips.length === 8, chips.join(' | '))

  /*
   * 公告 28 = 本项目已发布 21 + 集团已发布 7。
   * 这个数字同时是"越权"的守卫：种子里有 12 条草稿 / 待审核 / 已过期 / 已撤回，
   * 只要有一条漏进来，数字就不再是 28。
   */
  check('公告页签 28 条（本项目 21 + 集团 7）', chips[1]?.includes('28'), chips[1] || '')
  const unread0 = await page.evaluate(() =>
    document.querySelector('.hd__r .hd__n')?.innerText.trim() || ''
  )
  check('公告未读 28（本机还没读过任何一条）', unread0 === '28', `实际 ${unread0}`)

  /*
   * 负向守卫用 **ID** 而不是标题：种子里"关于启用新版业主 App 的公告"有 6 条，
   * 其中 3 条是已发布、本该显示 —— 拿标题判会直接把正确行为判成 bug。
   * 这里逐条查"该藏的有没有露出来"：待审核 1 / 草稿 1 / 已撤回 1。
   */
  const hiddenIds = ['NT0077', 'NT0014', 'NT0054']
  const leaked = []
  for (const id of hiddenIds) if (await count(`#nt-${id}`)) leaked.push(id)
  check('待审核 / 草稿 / 已撤回的公告一条都没露出来', leaked.length === 0, leaked.join(','))
  check('集团公告带「集团」标记', (await count('.msg__grp')) > 0)

  /* 切「停水停电」（第 0 位是待办、第 1 位是公告，类型从第 2 位起）：列表只剩这一类 */
  await tapSel('[id^="ntab-"]', 2, 800)
  const types = await page.evaluate(() =>
    [...document.querySelectorAll('.msg__type')].map(e => e.innerText.trim())
  )
  check('切类型后只剩该类', types.length > 0 && types.every(t => t === '停水停电'), types.join(','))

  /* 回公告，展开第一条 → 已读 +1 */
  await tapSel('[id^="ntab-"]', 1, 700)
  await tapSel('.msg', 0, 700)
  const unread1 = await page.evaluate(() =>
    document.querySelector('.hd__r .hd__n')?.innerText.trim() || ''
  )
  check('展开一条后未读 27', unread1 === '27', `实际 ${unread1}`)
  check('展开的那条不再有未读竖条',
    (await count('.msg.is-unread')) === 27, `未读卡片 ${await count('.msg.is-unread')}`)
  await shot('41-msg-types')

  console.log('\n[13] 与 PC 数字对齐')
  await goto('/pages/mine/index')
  const chkRows = await page.evaluate(() =>
    [...document.querySelectorAll('.chk__row')].map(r => r.innerText.replace(/\s+/g, ' ').trim())
  )
  check('五项数字与 PC 一致', chkRows.length === 5 && chkRows.every(t => t.includes('✓')), chkRows.join(' | '))

  /* ---------- 13b. 多屏画廊 ---------- */
  console.log('\n[13b] 多屏画廊')
  /* 画廊是独立静态页，不走 hash 路由 */
  await page.goto(`${BASE}/static/preview.html`, { waitUntil: 'networkidle2' })
  await sleep(2500)
  const frames = await page.evaluate(() => document.querySelectorAll('iframe').length)
  check('画廊按分组渲染了全部屏', frames >= 20, `iframe=${frames}`)
  await shot('29-preview')

  /* ---------- 14. 控制台 ---------- */
  console.log('\n[14] 控制台')
  const allErrs = [...errsByPage.entries()].flatMap(([u, arr]) => arr.map(e => `${u.replace(BASE, '')} → ${e}`))
  check('零 console 错误', allErrs.length === 0, '\n    ' + allErrs.slice(0, 6).join('\n    '))

  await browser.close()

  const bad = results.filter(r => !r.ok)
  console.log(`\n===== 结果：${results.length - bad.length}/${results.length} 通过 =====`)
  if (bad.length) {
    bad.forEach(b => console.log(`  ✗ ${b.name} — ${b.why || ''}`))
    process.exit(1)
  }
  console.log(`截图：${SHOTS}`)
}

main()
  .catch(e => {
    console.error('\n脚本异常：', e)
    process.exit(1)
  })
  .finally(() => {
    if (server) server.kill('SIGTERM')
  })
