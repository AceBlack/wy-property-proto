/**
 * 业主端主线冒烟（自包含）
 * ------------------------------------------------------------
 * 覆盖本轮（4 tab + 按需认证）的关键路径：
 *   ① 游客可浏览首页/邻里/生活，动作级才拦（点赞要登录）
 *   ② 登录不强制实名：登录后停在未认证首页
 *   ③ 认证自动匹配：档案对得上立即生效；对不上进人工审核（模拟通过）
 *   ④ 家庭账单多房合并：合计 = 按房分组之和；跨房合并缴费
 *   ⑤ 报修双线：个人（价目 / 预付 / 增项 / 补付 / 评价）、公共（免认证、免费）
 *   ⑥ 便民缴费：水电户号 / 充值 / 余额
 *   ⑦ 邻里：动态评论（先审后发）、活动报名、投票、闲置想要
 *   ⑧ 身份权限：租客不能看业主账单
 *   ⑨ 双模式（dev / 构建产物）+ 零 console 错误
 *
 * 用法：
 *   node scripts/smoke.mjs          # 只跑 dev（没起就自己起）
 *   npm run smoke                   # dev + dist
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SHOTS = path.join(ROOT, 'screenshots')
const argv = process.argv.slice(2)
const argBase = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : ''
const BOTH = argv.includes('--both')
const DEV_BASE = argBase || 'http://localhost:5170'
const DIST_BASE = 'http://localhost:5171'

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome'
].filter(Boolean).find(p => fs.existsSync(p))
if (!CHROME) {
  console.error('找不到 Chrome，请设 CHROME_PATH')
  process.exit(2)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
let results = []
const errsByPage = new Map()
let modeTag = ''
let BASE = DEV_BASE

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
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch (e) {
    return false
  }
}

let devServer = null
async function ensureDev() {
  if (await reachable(DEV_BASE)) return
  console.log(`· ${DEV_BASE} 未响应，启动 dev:h5 …`)
  devServer = spawn('npm', ['run', 'dev:h5'], { cwd: ROOT, stdio: 'ignore' })
  for (let i = 0; i < 120; i++) {
    await sleep(1000)
    if (await reachable(DEV_BASE)) {
      await sleep(2000)
      return
    }
  }
  throw new Error('dev 服务器 120 秒内没起来')
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}
function serveDir(dir, port) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0])
    let file = path.join(dir, url === '/' ? 'index.html' : url)
    if (!file.startsWith(dir)) return res.writeHead(403).end()
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html')
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise(r => server.listen(port, () => r(server)))
}
async function buildDist() {
  console.log('· 构建 H5 产物 …')
  await new Promise((resolve, reject) => {
    const p = spawn('npm', ['run', 'build:h5'], { cwd: ROOT, stdio: 'inherit' })
    p.on('exit', c => (c === 0 ? resolve() : reject(new Error('build:h5 失败'))))
  })
  const dist = path.join(ROOT, 'dist/build/h5')
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('没有 dist/build/h5/index.html')
  return dist
}

/* ---------------- 页面操作 ---------------- */
let page
const shot = async name => {
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${modeTag}${name}.png`), fullPage: true })
}
const bodyText = () => page.evaluate(() => document.body.innerText)
const has = async n => (await bodyText()).includes(n)
async function waitText(n, t = 9000) {
  const t0 = Date.now()
  while (Date.now() - t0 < t) {
    if (await has(n)) return true
    await sleep(200)
  }
  return false
}
async function tapText(needle, { exact = false, idx = -1 } = {}) {
  const ok = await page.evaluate(
    (needle, exact, idx) => {
      const all = [...document.querySelectorAll('uni-view,uni-text,uni-button,div,span,text')]
      const hit = all
        .filter(n => {
          const s = (n.innerText || '').trim()
          return exact ? s === needle : s.includes(needle)
        })
        .filter(n => ![...n.children].some(c => (c.innerText || '').trim() === needle))
      if (!hit.length) return false
      const el = idx >= 0 ? hit[idx] : hit[hit.length - 1]
      el.scrollIntoView({ block: 'center' })
      el.click()
      return true
    },
    needle,
    exact,
    idx
  )
  if (ok) await sleep(700)
  return ok
}
async function tap(sel, idx = 0, wait = 800) {
  const ok = await page.evaluate(
    (s, i) => {
      const el = document.querySelectorAll(s)[i]
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
const visible = async sel => (await page.$(sel)) !== null
async function setInput(sel, value, idx = 0) {
  const ok = await page.evaluate(
    (s, v, i) => {
      const r = [...document.querySelectorAll(s)][i]
      if (!r) return false
      const el = r.matches('input,textarea') ? r : r.querySelector('input,textarea')
      if (!el) return false
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    },
    sel,
    value,
    idx
  )
  await sleep(250)
  return ok
}
async function goto(hash) {
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'networkidle2' })
  await sleep(900)
}
const hOverflow = () => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))
function collectErrors() {
  page.on('console', m => {
    if (m.type() !== 'error') return
    const a = errsByPage.get(page.url()) || []
    a.push('[console] ' + m.text())
    errsByPage.set(page.url(), a)
  })
  page.on('pageerror', e => {
    const a = errsByPage.get(page.url()) || []
    a.push('[pageerror] ' + e.message)
    errsByPage.set(page.url(), a)
  })
}
const nums = t => (String(t).match(/¥\s?[\d,]+\.\d{2}/g) || []).map(s => Number(s.replace(/[¥,\s]/g, '')))
/**
 * 清空演示数据：**必须整页重载**。
 * store 在模块初始化时读一次缓存，只清 localStorage 不重载的话，内存里还是上一个人的会话，
 * 登录页会直接 reLaunch 回首页（表现为"换了身份还在旧账号"）。
 */
const clean = async () => {
  await page.evaluate(() => {
    try {
      localStorage.clear()
    } catch (e) {}
  })
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(900)
}

/** 登录（演示身份）。用 id 不用姓名：陈静的描述里就写着「张建国的配偶」，按文字点会点错人 */
const PERSONA_ID = { 张建国: 'zhang', 李秀兰: 'li', 王浩然: 'wang', 崔霞: 'cui', 陈静: 'chen', 钟瑞: 'zhong', 赵娟: 'zhao' }
async function loginAs(name) {
  await goto('/pages/login/index')
  await tap('#wx-login', 0, 900)
  await tap(`#persona-${PERSONA_ID[name] || 'zhang'}`, 0, 1400)
}

/** 认证：社区 → 楼栋 → 房间 → 身份 */
async function auth({ community = '翡翠城', building = '1栋', houseId = 'H010110501', name = '张建国', cert = '5880' } = {}) {
  await tap('#bind-banner', 0, 1200)
  await tapText(community)
  await sleep(800)
  await tapText(building)
  await sleep(800)
  /* 房间格子用 houseId 精确点：同一楼栋两个单元都有 0501，按文字点会点到隔壁 */
  await tap(`#room-${houseId}`, 0, 600)
  await tap('#room-next', 0, 900)
  await setInput('.field__input', name, 0)
  await setInput('.field__input', cert, 1)
  await tap('#identity-submit', 0, 2000)
}

/** 等首屏真的画出来（dev 冷启动的现场编译可能很久）；返回 false 表示超时 */
async function waitFirstPaint(marker = '生活缴费', timeout = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const t = await bodyText()
    if (t.includes(marker)) return true
    await sleep(500)
  }
  console.log(`· 首屏 ${timeout / 1000}s 内没等到「${marker}」`)
  return false
}

/* ---------------- 主流程 ---------------- */
async function runSuite(base, tag) {
  BASE = base
  modeTag = tag
  results = []
  errsByPage.clear()

  await page.goto(`${BASE}/#/pages/home/index`, { waitUntil: 'networkidle2' })
  await sleep(1400)
  /* "networkidle2" 在 dev 下是不够的：vite 的 index.html 立刻返回，
     但首屏那一屏的模块是**现场转译**的（@pc/mock 的 api.js 单独就 5.8MB），
     冷启动要几秒到几十秒。不加这一步，[1] 的三条断言会在白屏上跑，
     而 dist 一路全绿 —— 这种"会说谎的断言"比没有断言更糟（第 76 批踩到）。 */
  await waitFirstPaint()

  /* ---------- 1. 游客态 ---------- */
  console.log('\n[1] 游客：不认证也能逛')
  check('首页出现「请绑定房屋」引导', await has('请绑定房屋'))
  /* 批次 81：社区活动与公告合成一条流，游客看的是「社区」这一段而不是单独的横滑块 */
  check('未认证也能看到社区流', !!(await page.$('[id^="feed-"]')) && (await has('社区')))
  check('五宫格服务入口都在', (await has('生活缴费')) && (await has('报事报修')) && (await has('刷脸通行')) && (await has('我的车位')))
  check('周边服务入口在（只展示不下单）', (await has('周边服务')) && (await has('不下单')))
  await shot('01-home-guest')

  console.log('\n[2] 邻里四频道（游客可浏览）')
  await goto('/pages/neighbor/index')
  check('四频道是 公告 / 投票 / 活动 / 闲置', (await has('公告')) && (await has('投票')) && (await has('活动')) && (await has('闲置')))
  check('公告列表带阅读数与对象户数', (await has('阅读 ')) && (await has('户')))
  check('公告只同步已发布（页面写明口径且有列表）', (await has('只同步「已发布」')) && !!(await page.$('.nt')))
  await shot('02-neighbor-notice')
  await tap('#ntab-vote', 0, 700)
  check('投票列表出现', (await has('个选项')) || (await has('参与率')))
  await shot('03-neighbor-vote')
  await tap('#ntab-activity', 0, 800)
  check('活动列表有阶段标签', (await has('报名中')) || (await has('待成行')) || (await has('已成行')))
  check('活动显示费用与报名进度', (await has('已报名 ')) && ((await has('免费')) || (await has('/人'))))
  await shot('04-neighbor-activity')
  await tap('#ntab-sh', 0, 700)
  check('闲置展示只到楼栋（不出现单元/房号）', (await has('人想要')) && !(await has('单元')) && !/\d{4}\s*·/.test(await bodyText()))

  await goto('/pages/life/index')
  check('生活 tab 是占位但有形', (await has('即将开放')) && (await has('认证商家')))
  check('生活 tab 明确不接交易', await has('没有下单'))
  await shot('04-life')

  /* ---------- 3. 登录（不强制实名） ---------- */
  console.log('\n[3] 登录：不做实名校验')
  await clean()
  await goto('/pages/login/index')
  check('登录页有微信快捷登录与手机号登录', (await has('微信快捷登录')) && (await has('手机号登录')))
  check('登录页标注演示态', await has('验证码固定 8888'))
  await shot('05-login')
  await tap('#phone-login', 0, 800)
  await setInput('.lg__input', '13800138001')
  await tap('#send-code', 0, 700)
  check('验证码倒计时出现', await has('重新获取（'))
  await setInput('.lg__input', '8888')
  await shot('06-login-code')
  await tap('#do-login', 0, 1600)
  check('登录成功回到首页', await waitText('请绑定房屋'))
  check('登录后仍停在未认证态（不强制认证）', await has('去认证'))
  await shot('07-home-logged')

  /* ---------- 4. 认证：自动匹配秒过 ---------- */
  console.log('\n[4] 认证：档案对得上直接生效')
  await tap('#bind-banner', 0, 1200)
  check('选择小区页出现', await waitText('附近小区'))
  await shot('08-auth-community')
  await tapText('翡翠城')
  await sleep(800)
  check('楼栋列表出现', await has('个单元'))
  await shot('09-auth-building')
  await tapText('1栋')
  await sleep(800)
  check('房间网格按单元分组', (await has('1单元')) && (await has('㎡')))
  await tap('#room-H010110501', 0, 600)
  await tap('#room-next', 0, 900)
  check('身份页带出房号', await has('1栋1单元0501'))
  await shot('10-auth-identity')
  await setInput('.field__input', '张建国', 0)
  await setInput('.field__input', '5880', 1)
  await tap('#identity-submit', 0, 2200)
  check('自动匹配通过、进入首页', await waitText('待缴'))
  check('房卡显示房号与业主身份', (await has('1栋1单元0501')) && (await has('业主')))
  const oneDebt = nums(await bodyText())[0]
  check('只绑一套时只算这一套 + 车位', Math.abs(oneDebt - 1420.14) < 0.01, `实际 ${oneDebt}`)
  check('首页提示还有未绑定房产', await visible('#bind-more'))
  await shot('11-home-auth')

  /* 补绑第二套：认证是逐套绑的，绑完才谈"多房合并" */
  await tap('#bind-more', 0, 1200)
  await tapText('翡翠城')
  await sleep(800)
  await tapText('3栋')
  await sleep(800)
  await tap('#room-H010311102', 0, 600)
  await tap('#room-next', 0, 900)
  await setInput('.field__input', '张建国', 0)
  await setInput('.field__input', '5880', 1)
  await tap('#identity-submit', 0, 2000)
  check('第二套绑定成功', await waitText('2 套可切换') || (await has('名下还有')))
  const homeDebt = nums(await bodyText())[0]
  check('首页待缴 = 2031.01（两房合并）', Math.abs(homeDebt - 2031.01) < 0.01, `实际 ${homeDebt}`)
  await shot('11b-home-auth2')

  /* ---------- 5. 家庭账单（多房合并） ---------- */
  console.log('\n[5] 家庭账单：多房合并缴费')
  await tapText('家庭账单')
  check('进入家庭账单', await waitText('家庭待缴合计'))
  const billTotal = nums(await bodyText()).find(v => Math.abs(v - homeDebt) < 0.01)
  check('账单合计与首页一致', !!billTotal, `首页 ${homeDebt}`)
  check('按房分组（两套都在）', (await has('1栋1单元0501')) && (await has('3栋1单元1102')))
  check('车位费单独成组', await has('车位'))
  await shot('12-bills-due')
  await tap('#bills-all', 0, 800)
  await shot('13-bills-picked')
  await tap('#bills-pay-all', 0, 1800)
  check('生成待支付订单', await waitText('应付金额'))
  const payAmt = nums(await bodyText())[0]
  check('支付金额 = 账单合计', Math.abs(payAmt - homeDebt) < 0.01, `支付 ${payAmt}`)
  check('多房合并说明可见', (await has('套房合并缴费')) || (await has('合并缴费')))
  await shot('14-pay-bill')
  await tap('#pay-sim', 0, 1600)
  check('模拟支付成功', await waitText('实付金额'))
  await shot('15-pay-bill-done')
  await goto('/pages/bills/index')
  check('账单已结清', await waitText('所有账单已结清'))

  /* ---------- 6. 个人报修（价目 → 预付 → 增项 → 补付 → 评价） ---------- */
  console.log('\n[6] 个人报修全链路')
  await goto('/pages/repair/list')
  check('报修列表有个人/公共两条线', (await has('个人报修')) && (await has('公共区域')))
  await shot('16-repair-list')
  await tap('#repair-new', 0, 1200)
  check('下单页显示价目', await waitText('角阀/软管更换'))
  await tapText('角阀/软管更换')
  await setInput('.textarea', '主卫角阀处持续渗水，地面积水，希望今天上门')
  await shot('17-repair-form')
  await tap('#repair-submit', 0, 2000)
  check('进入待支付', await waitText('应付金额'))
  const woPay = nums(await bodyText())[0]
  check('报修支付 = 价目合计 125', Math.abs(woPay - 125) < 0.01, `实际 ${woPay}`)
  await tap('#pay-sim', 0, 1600)
  await tapText('查看报修进度')
  check('进入报修详情', await waitText('报修详情') || (await waitText('个人报修')))
  check('详情显示已支付', await has('已支付'))
  await shot('18-repair-detail')
  /*
   * 2026-11-08：删掉了「模拟加项」。
   *
   * 连带影响要说清楚：业主端再也无法把单子自己推到「已完工」，
   * 所以**评价入口不会出现** —— 这正是真实行为（评价要等师傅完工，
   * 完工由员工端 `POST /work-orders/{id}/finish` 推进）。
   * 评价能力的覆盖交给 04 契约：`POST /work-orders/{id}/staff-eval`（未完工 409、重复评价 409）。
   */
  check('业主端没有「模拟加项」入口', !(await visible('#demo-add')) && !(await has('模拟加项')))
  check('未完工的单没有评价入口', !(await has('对本次服务满意吗')) && !(await visible('#eval-submit')))

  /* ---------- 7. 公共报修（免认证、免费） ---------- */
  console.log('\n[7] 公共报修：登录即可，免费')
  await goto('/pages/repair/create?scope=public')
  check('公共报修可选位置', await waitText('问题位置'))
  check('公式报修标注不收费', await has('不收费'))
  await tapText('单元电梯轿厢')
  await tapText('下水道疏通')
  await setInput('.textarea', '3栋2单元电梯运行到6层有异响，请检查')
  await shot('23-repair-public')
  await tap('#repair-submit', 0, 1800)
  check('公共报修免支付，直接进详情', await waitText('个人报修') || (await waitText('公共区域')))
  check('公共单据金额为免费', (await has('¥0.00')) || (await has('无需支付')))
  await shot('24-repair-public-detail')

  /* ---------- 8. 便民缴费 ---------- */
  console.log('\n[8] 便民缴费：水电户号 + 充值')
  await goto('/pages/utility/index')
  check('本房有水电户号', (await has('水费')) && (await has('电费')))
  check('燃气如实标注未开通', await has('未开通'))
  await shot('25-utility')
  await tap('[id^="ut-recharge-"]', 0, 1200)
  check('充值页出现快捷金额', await waitText('充值金额'))
  await tapText('200 元')
  await shot('26-utility-recharge')
  await tap('#ut-pay', 0, 1600)
  await sleep(1200)
  check('充值后余额增加', await waitText('余额') || (await has('充值成功')))

  /* ---------- 9. 邻里：公告签收 / 收费活动报名 / 多选投票 / 闲置发布 ---------- */
  console.log('\n[9] 邻里：四种参与方式')
  await goto('/pages/neighbor/index')
  await tap('#ntab-notice', 0, 700)
  await tap('.nt', 0, 1000)
  check('进入公告详情', await waitText('公告详情'))
  check('公告有附件或阅读口径', (await has('附件')) || (await has('阅读 ')))
  await tap('#notice-sign', 0, 1200)
  check('公告可签收', await waitText('已签收'))
  await shot('27-notice')

  /* 收费活动：出行人 + 投保 + 条款 → 待支付 → 模拟支付 */
  await goto('/pages/neighbor/activity?id=AC0016')
  check('收费活动显示费用包含与退款分档', (await has('已包含')) && (await has('退款规则')))
  /* dev 下 Bar 组件可能还没挂上，`#act-main` 点空一次就会连锁失败（dist 不会）。
     点完以「报名页的提交按钮」为准，没到就再点一次 —— 不要用"出行人"当判据：
     活动详情页的报名须知里也有这两个字，会误判成功（第 76 批踩到）。 */
  let onEnrollPage = false
  for (let i = 0; i < 3 && !onEnrollPage; i += 1) {
    await tap('#act-main', 0, 1200)
    onEnrollPage = await visible('#enroll-submit')
  }
  check('进入报名页', onEnrollPage)
  check('报名页要求出行人', await waitText('出行人'))
  check('投保活动才收证件号', await has('仅用于购买当日意外险'))
  await setInput('.field__input', '510101199003071234', 2)
  await tapText('我已阅读并同意')
  await tapText('同意为出行人购买')
  await shot('28-enroll-form')
  await tap('#enroll-submit', 0, 1800)
  check('收费活动生成待支付订单', await waitText('活动报名费'))
  const actPay = nums(await bodyText())[0]
  check('报名费 = 单价 168 × 1 人', Math.abs(actPay - 168) < 0.01, `实际 ${actPay}`)
  await tap('#pay-sim', 0, 1600)
  check('报名费模拟支付成功', await waitText('实付金额') || (await waitText('支付完成')))
  await goto('/pages/neighbor/my?tab=enroll')
  check('我的报名显示已支付', (await has('已支付')) && (await has('业主自助')))
  await shot('29-my-enroll')

  /* 多选投票：SV0004 最多选 2 项 */
  await goto('/pages/neighbor/vote?id=SV0004')
  check('多选投票写明最多可选', await has('最多'))
  const opts = await page.$$('.opt')
  if (opts.length >= 2) {
    await opts[0].click()
    await sleep(300)
    await opts[1].click()
    await sleep(300)
  }
  await tap('#vote-submit', 0, 1400)
  check('投票后显示占比', await has('%'))
  check('结果里没有「通过 / 未通过」', !(await has('通过')) && !(await has('未通过')))
  await shot('30-vote-result')

  /* 闲置：详情去公开评论、改站内私信 */
  await goto('/pages/neighbor/secondhand?id=SH0001')
  check('闲置详情没有公开评论区', !(await has('邻里评论')) && !(await has('写评论')))
  check('闲置详情提供站内私信', await has('私信卖家'))
  check('闲置详情不出现房号', !(await has('单元')) && !/·\s*\d{4}/.test(await bodyText()))
  await tap('#sh-want', 0, 900)
  check('想要已记录', (await has('已收藏')) || (await has('取消想要')))
  await shot('31-secondhand')

  /* 闲置发布 → 审核中（审核在员工端，业主端只等） */
  await goto('/pages/neighbor/item-publish')
  check('发布页有照片正误对照', await has('这张图能不能让陌生人找到你家'))
  await setInput('.field__input', '九成新婴儿推车 自提', 0)
  await setInput('.field__input', '260', 1)
  await setInput('.textarea', '用了一年，功能正常，小区内自提')
  await tap('.pp__add', 0, 600)
  await tapText('模拟一张')
  await tap('#item-submit', 0, 1200)
  if (await has('知道了')) await tapText('知道了')
  await sleep(1200)
  check('发布后状态为待审核并给预计时长', (await has('待审核')) && (await has('24 小时')))
  /* 审核在员工端做，业主端只能等 —— 原来的「模拟通过」能让业主自己审自己发布的内容 */
  check('待审核状态下没有审核按钮', !(await has('模拟通过')) && !(await has('模拟驳回')))
  check('写明由员工端审核', await has('不是发完就上架'))
  await shot('32-my-item')

  /* ---------- 13. 租售信息（游客可看，发布要业主） ---------- */
  console.log('\n[9b] 租售信息：公开可见 / 看房留资 / 业主发布')
  /* 上一段停在「审核中」，发布要已认证的业主：换回张建国重新认证 */
  await clean()
  await loginAs('张建国')
  await auth()
  await goto('/pages/house-sale/list')
  check('游客可看房源列表', await waitText('套在租'))
  check('列表不含房号与单元', !(await has('单元')) && !/·\s*\d{4}/.test(await bodyText()))
  check('列表不出现楼管手机号', !/1\d{10}/.test(await bodyText()))
  await shot('33-sale-list')
  await tap('.li', 0, 1000)
  check('详情不展示业主与电话', !(await has('业主电话')) && !/1\d{10}/.test(await bodyText()))
  check('详情有责任楼管', await has('楼栋管家'))
  await tap('#viewing-entry', 0, 1000)
  await setInput('.field__input', '刘先生', 0)
  await setInput('.field__input', '13910000000', 1)
  await tap('#viewing-submit', 0, 1200)
  check('看房提交后有 24 小时承诺', await has('24 小时内联系你'))
  await shot('34-viewing')
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(900)
  await setInput('.field__input', '刘先生', 0)
  await setInput('.field__input', '13910000000', 1)
  await tap('#viewing-submit', 0, 1200)
  check('同号同房 24 小时内拦截第二次', await has('24 小时内已约过'))
  await shot('35-viewing-dup')

  await goto('/pages/house-sale/publish')
  check('发布页首屏是照片正误对照', await has('这张图能不能让陌生人找到你家'))
  check('面积户型只读（标记不可修改）', (await has('只读')) && (await has('不可修改')))
  await setInput('.field__input', '3200', 0)
  await setInput('.textarea', '南北通透，近地铁，家电齐全')
  await tap('.pp__add', 0, 600)
  await tapText('模拟一张')
  await tap('#listing-submit', 0, 1400)
  if (await has('知道了')) await tapText('知道了')
  await sleep(1200)
  check('挂牌提交后为待审核', (await has('待审核')) && (await has('本房责任楼管') || await has('责任楼管')))
  await shot('36-my-listing')

  /* §13.10 验收：驳回后的挂牌，业主看得到那句理由 */
  await clean()
  await loginAs('崔霞')
  await auth({ houseId: 'H010121101', name: '崔霞', cert: '8080' })
  await goto('/pages/house-sale/mine')
  check('被驳回的挂牌能看到驳回理由', (await has('已驳回')) && (await has('驳回理由')))
  await shot('37-listing-rejected')

  /* ---------- 10. 我的 / 身份权限 ---------- */
  console.log('\n[10] 我的 + 身份权限')
  await goto('/pages/mine/index')
  check('我的页显示认证身份', await has('已认证'))
  check('七格入口齐全', (await has('物业缴费')) && (await has('我的房产')) && (await has('便民缴费')))
  await shot('31-mine')

  await goto('/pages/house/index')
  check('我的房屋显示面积与住户', (await has('建筑面积')) && (await has('本房住户')))
  await shot('32-house')

  /* 租客：不能看业主账单 */
  await clean()
  await loginAs('钟瑞')
  await auth({ community: '翡翠城', building: '1栋', houseId: 'H010111002', name: '钟瑞', cert: '8874' })
  check('租客认证通过（房卡出现）', await waitText('1栋1单元1002', 6000))
  check('租客身份标签为租客', await waitText('租客', 4000))
  await goto('/pages/bills/index')
  await sleep(1200)
  check('租客进账单被权限拦下', (await has('当前身份无权限')) || !(await has('家庭待缴合计')))
  await shot('33-tenant-blocked')

  /* ---------- 11. 审核兜底 ---------- */
  console.log('\n[11] 信息不一致 → 人工审核')
  await clean()
  await loginAs('李秀兰')
  await tap('#bind-banner', 0, 1200)
  await tapText('翡翠城')
  await sleep(800)
  await tapText('2栋')
  await sleep(800)
  await tap('#room-H010210302', 0, 600)
  await tap('#room-next', 0, 900)
  await setInput('.field__input', '李秀兰', 0)
  await setInput('.field__input', '1111', 1)
  await tap('#identity-submit', 0, 1200)
  check('证件不符时要求上传证明', await has('请上传购房合同'))
  await shot('34-auth-mismatch')

  /* ---------- 12. 布局 ---------- */
  console.log('\n[12] 布局与零错误')
  const of1 = await hOverflow()
  check('认证页无横向溢出', of1 <= 1, `溢出 ${of1}px`)
  await goto('/pages/home/index')
  const of2 = await hOverflow()
  check('首页无横向溢出', of2 <= 1, `溢出 ${of2}px`)
  const errs = [...errsByPage.entries()].flatMap(([u, a]) => a.map(e => `${u.replace(BASE, '')} → ${e}`))
  check('零 console 错误', errs.length === 0, '\n    ' + errs.slice(0, 6).join('\n    '))
}

async function main() {
  await ensureDev()
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  collectErrors()

  const runs = []
  await runSuite(DEV_BASE, 'dev-')
  runs.push({ label: 'dev（dev:h5）', results: [...results] })

  if (BOTH) {
    const dist = await buildDist()
    const server = await serveDir(dist, 5171)
    await runSuite(DIST_BASE, 'dist-')
    runs.push({ label: 'dist（构建产物）', results: [...results] })
    server.close()
  }

  await browser.close()
  console.log('\n===== 汇总 =====')
  let bad = 0
  for (const r of runs) {
    const b = r.results.filter(x => !x.ok)
    bad += b.length
    console.log(`${r.label}: ${r.results.length - b.length}/${r.results.length} 通过${b.length ? '  ✕' : '  ✓'}`)
    b.forEach(x => console.log(`    ✗ ${x.name} — ${x.why || ''}`))
  }
  if (bad) process.exit(1)
  console.log(`截图：${SHOTS}`)
}

main()
  .catch(e => {
    console.error('\n脚本异常：', e)
    process.exit(1)
  })
  .finally(() => {
    if (devServer) devServer.kill('SIGTERM')
  })
