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
async function asPersona(idx, name) {
  await goto('/pages/login/index')
  await tapSel('.pcard', idx, 1300)
  return waitText(name)
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
  check('登录页渲染', (await waitText('员工端')) && (await has('演示日期 2026-10-20')))
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
  check('列表顶部出现断网提示', await has('当前离线'))
  await tapSel('.tc', 0, 1100)
  check('详情页也提示离线', await has('当前离线'))
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
  check('我的页列出待同步', await visible('#sync-now'))
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
